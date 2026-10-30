use std::collections::{BTreeMap, HashMap};

use crate::actors::{ActorId, NOBODY};
use crate::cells::{CellKind, Facts, book};
use crate::deaths::deaths;
use crate::fight::{EventKind, Fight, NO_SPELL, PowerSample, SpellId};
use crate::filter::ReportFilter;
use crate::scope::{Scope, Side, UnitRef, shown_on, side_at, unit_of};

pub const RESOURCE_STEP_MS: u32 = 5_000;
/// The track of a unit's health (WoW's power type for health costs): HP from the advanced log
/// fields; its gains are the heals the unit received.
pub const HEALTH: i32 = -2;
/// Samples at or above this percentage count as capped.
const CAPPED_PCT: f32 = 99.0;
/// Longer gaps between power samples count as unknown time for "time at cap".
const MAX_KNOWN_GAP_MS: u32 = 10_000;

#[derive(Debug, Clone, PartialEq)]
pub struct PowerTrack {
    pub power_type: i32,
    /// Percent of max per step: the last sample in the step.
    pub series: Vec<Option<f32>>,
    pub avg_pct: Option<f32>,
    pub min_pct: Option<f32>,
    /// Time spent at or above 99 %: from a capped sample to the next one. Gaps over 10 s
    /// count as unknown (a form can hide the power), even though `series` carries the
    /// last value through them.
    pub capped_ms: u32,
    pub gained: f64,
    pub wasted: f64,
    /// Energize (heals for health) by spell: (spell, gained, wasted), largest first.
    pub gains: Vec<(SpellId, f64, f64)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UnitResources {
    /// A player for friendlies; one enemy unit for enemies.
    pub unit: ActorId,
    pub tracks: Vec<PowerTrack>,
    /// The unit's dead phases overlapping the range, clipped to it (the chart's dead band).
    pub dead: Vec<(i32, i32)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResourcesReport {
    pub start_ms: i32,
    pub end_ms: i32,
    pub step_ms: u32,
    pub units: Vec<UnitResources>,
}

fn pct(sample: &PowerSample) -> Option<f32> {
    (sample.max > 0)
        .then(|| (sample.current as f64 * 100.0 / sample.max as f64).clamp(0.0, 100.0) as f32)
}

fn steps(start: i32, end: i32, step_ms: u32) -> usize {
    ((end - start).max(0) as u32).div_ceil(step_ms) as usize
}

/// Percent of max per step from samples in `[start, end)`: the last sample in each step. Power is a
/// state, not a rate: steps between two samples keep the last value. Empty without samples.
fn series_of<'a>(
    samples: impl Iterator<Item = &'a PowerSample>,
    start: i32,
    end: i32,
    step_ms: u32,
) -> Vec<Option<f32>> {
    let mut series = vec![None; steps(start, end, step_ms)];
    let mut any = false;
    for sample in samples.filter(|p| p.t >= start && p.t < end) {
        series[((sample.t - start) as u32 / step_ms) as usize] = pct(sample);
        any = true;
    }
    if !any {
        return Vec::new();
    }
    let first = series.iter().position(Option::is_some);
    let last = series.iter().rposition(Option::is_some);
    if let (Some(first), Some(last)) = (first, last) {
        for i in first + 1..=last {
            if series[i].is_none() {
                series[i] = series[i - 1];
            }
        }
    }
    series
}

/// Average percent where each sample counts until the unit's next one (the last until `end`);
/// health snapshots cluster in busy moments, so a plain mean would overweight them.
fn time_weighted_avg(samples: &[PowerSample], end: i32) -> Option<f32> {
    let (mut weighted, mut total) = (0.0_f64, 0.0_f64);
    for (i, sample) in samples.iter().enumerate() {
        let until = samples.get(i + 1).map_or(end, |next| next.t);
        let span = (until - sample.t).max(0) as f64;
        if let Some(p) = pct(sample) {
            weighted += p as f64 * span;
            total += span;
        }
    }
    (total > 0.0).then(|| (weighted / total) as f32)
}

/// The player's power of one type per step; see [`series_of`].
pub(crate) fn power_series(
    fight: &Fight,
    player: ActorId,
    power_type: i32,
    start: i32,
    end: i32,
    step_ms: u32,
) -> Vec<Option<f32>> {
    series_of(
        fight
            .power
            .iter()
            .filter(|p| p.actor == player && p.power_type == power_type),
        start,
        end,
        step_ms,
    )
}

/// Every HP snapshot of `side`'s units in the range as a health sample; none is dropped, so the
/// lowest logged HP stays the minimum.
fn health_samples(fight: &Fight, side: Side, start: i32, end: i32) -> Vec<PowerSample> {
    let mut samples = Vec::new();
    for event in fight.events.iter().filter(|e| e.t >= start && e.t < end) {
        let Some(hp) = event.unit_hp else {
            continue;
        };
        if !shown_on(fight, side, hp.actor, side_at(fight, event, hp.actor)) {
            continue;
        }
        samples.push(PowerSample {
            t: event.t,
            actor: hp.actor,
            power_type: HEALTH,
            current: hp.current as i64,
            max: hp.max as i64,
            primary: true,
        });
    }
    samples
}

pub(crate) type Gains = HashMap<(ActorId, i32), HashMap<SpellId, (f64, f64)>>;

/// What units gained in the range by power type and spell: energize, and heals for health.
pub(crate) fn gains(fight: &Fight, start: i32, end: i32) -> Gains {
    let mut gains: Gains = HashMap::new();
    for event in fight.events.iter().filter(|e| e.t >= start && e.t < end) {
        let (power_type, gained, wasted) = match event.kind {
            // Some spells drain power through a negative energize; that is no gain.
            EventKind::Energize(e) if e.amount >= 0.0 => (e.power_type, e.amount, e.over_energize),
            // The Evoker's share of a heal is logged on top of the full heal.
            // What a heal absorb took is healing (`healing_amount`) but restores no HP.
            EventKind::Heal(heal) if heal.supporter == NOBODY => (
                HEALTH,
                heal.amount.saturating_sub(heal.overheal) as f64,
                heal.overheal as f64,
            ),
            _ => continue,
        };
        let entry = gains
            .entry((event.target, power_type))
            .or_default()
            .entry(event.spell)
            .or_default();
        entry.0 += gained;
        entry.1 += wasted;
    }
    gains
}

/// Power and health samples of `side`'s units in the range, by unit and power type.
pub(crate) fn samples_by_track(
    fight: &Fight,
    side: Side,
    start: i32,
    end: i32,
) -> BTreeMap<(ActorId, i32), Vec<PowerSample>> {
    let mut tracks: BTreeMap<(ActorId, i32), Vec<PowerSample>> = BTreeMap::new();
    let power = match side {
        Side::Friendly => fight
            .power
            .iter()
            .filter(|p| p.t >= start && p.t < end)
            .copied()
            .collect(),
        // Only players' power is kept from the log.
        Side::Enemy => Vec::new(),
    };
    for sample in power
        .into_iter()
        .chain(health_samples(fight, side, start, end))
    {
        tracks
            .entry((sample.actor, sample.power_type))
            .or_default()
            .push(sample);
    }
    tracks
}

pub(crate) fn book_resources(fight: &Fight, filter: &ReportFilter, side: Side, map: &mut Facts) {
    let (start, end) = filter.clipped(fight);
    let tracks = samples_by_track(fight, side, start, end);
    for &(unit, _) in tracks.keys() {
        book(
            map,
            (
                unit_of(fight, unit),
                NO_SPELL,
                CellKind::State,
                UnitRef::Environment,
            ),
            0,
            0,
            true,
            false,
        );
    }
    for ((unit, power_type), by_spell) in gains(fight, start, end) {
        if !tracks.contains_key(&(unit, power_type)) {
            continue;
        }
        for (spell, (gained, _)) in by_spell {
            book(
                map,
                (
                    unit_of(fight, unit),
                    spell,
                    CellKind::Own,
                    UnitRef::Environment,
                ),
                gained.round() as i64,
                0,
                true,
                false,
            );
        }
    }
}

/// Units with power or health samples in the range. An ability selection keeps the units that
/// gained from it and their gains of it; the curves stay whole, power is a state.
pub fn resources_report(fight: &Fight, filter: &ReportFilter, scope: &Scope) -> ResourcesReport {
    let (start, end) = filter.clipped(fight);
    let side = scope.perspective;
    let tracks = samples_by_track(fight, side, start, end);
    let gains = gains(fight, start, end);
    // Resources have no other side: a target selection of another tab does not apply. The
    // ability selection narrows the gains, not the units' samples.
    let scope = Scope {
        target: Vec::new(),
        ..scope.clone()
    };
    let holders = Scope {
        ability: Vec::new(),
        ..scope.clone()
    };
    let mut units: BTreeMap<ActorId, Vec<PowerTrack>> = BTreeMap::new();
    for ((unit, power_type), list) in &tracks {
        let holder = unit_of(fight, *unit);
        if !holders.accepts(fight, Some(&holder), None, None) {
            continue;
        }
        let pcts: Vec<f32> = list.iter().filter_map(pct).collect();
        let capped_ms = list
            .windows(2)
            .filter(|w| pct(&w[0]).is_some_and(|p| p >= CAPPED_PCT))
            // A form can hide the power for minutes: such gaps are unknown, not capped.
            .map(|w| (w[1].t - w[0].t) as u32)
            .filter(|&gap| gap <= MAX_KNOWN_GAP_MS)
            .sum();
        let mut gains: Vec<(SpellId, f64, f64)> = gains
            .get(&(*unit, *power_type))
            .map(|by_spell| {
                by_spell
                    .iter()
                    .filter(|&(&spell, _)| scope.accepts(fight, Some(&holder), Some(spell), None))
                    .map(|(&s, &(g, w))| (s, g, w))
                    .collect()
            })
            .unwrap_or_default();
        gains.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        units.entry(*unit).or_default().push(PowerTrack {
            power_type: *power_type,
            series: series_of(list.iter(), start, end, RESOURCE_STEP_MS),
            avg_pct: if *power_type == HEALTH {
                time_weighted_avg(list, end)
            } else {
                (!pcts.is_empty()).then(|| pcts.iter().sum::<f32>() / pcts.len() as f32)
            },
            min_pct: pcts.iter().copied().reduce(f32::min),
            capped_ms,
            // `fold` from +0.0: an empty `sum` of floats is -0.0, which renders as "-0".
            gained: gains.iter().fold(0.0, |acc, g| acc + g.1),
            wasted: gains.iter().fold(0.0, |acc, g| acc + g.2),
            gains,
        });
    }
    if !scope.ability.is_empty() {
        units.retain(|_, tracks| tracks.iter().any(|t| !t.gains.is_empty()));
    }
    let dead = dead_phases(fight, side, |unit| units.contains_key(&unit), start, end);
    ResourcesReport {
        start_ms: start,
        end_ms: end,
        step_ms: RESOURCE_STEP_MS,
        units: units
            .into_iter()
            .map(|(unit, mut tracks)| {
                // Health last: the first track is the unit's primary resource.
                tracks.sort_by_key(|t| (t.power_type == HEALTH, t.power_type));
                UnitResources {
                    unit,
                    tracks,
                    dead: dead.get(&unit).cloned().unwrap_or_default(),
                }
            })
            .collect(),
    }
}

/// When the `wanted` units of `side` were dead, clipped to `[start, end)`: players from death to
/// their resurrect, enemies from their first death on.
pub(crate) fn dead_phases(
    fight: &Fight,
    side: Side,
    wanted: impl Fn(ActorId) -> bool,
    start: i32,
    end: i32,
) -> HashMap<ActorId, Vec<(i32, i32)>> {
    let pull_end = fight.duration_ms.min(i32::MAX as u64) as i32;
    let mut deaths_of: HashMap<ActorId, Vec<(i32, Option<i32>)>> = HashMap::new();
    match side {
        Side::Friendly => {
            for death in deaths(fight).into_iter().filter(|d| wanted(d.player)) {
                deaths_of
                    .entry(death.player)
                    .or_default()
                    .push((death.t, death.dead_until));
            }
        }
        Side::Enemy => {
            for event in &fight.events {
                if matches!(event.kind, EventKind::Died { unconscious: false })
                    && wanted(event.target)
                {
                    deaths_of
                        .entry(event.target)
                        .or_insert_with(|| vec![(event.t, None)]);
                }
            }
        }
    }
    deaths_of
        .into_iter()
        .map(|(unit, deaths)| {
            let phases = deaths
                .into_iter()
                .map(|(t, until)| (t.max(start), until.unwrap_or(pull_end).min(end)))
                .filter(|(a, b)| b > a)
                .collect();
            (unit, phases)
        })
        .collect()
}
