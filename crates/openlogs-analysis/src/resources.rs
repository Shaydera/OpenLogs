use std::collections::{BTreeMap, HashMap};

use crate::actors::ActorId;
use crate::deaths::deaths;
use crate::fight::{EventKind, Fight, PowerSample, SpellId};
use crate::filter::ReportFilter;

pub const RESOURCE_STEP_MS: u32 = 5_000;
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
    /// Energize by spell: (spell, gained, wasted), largest first.
    pub gains: Vec<(SpellId, f64, f64)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerResources {
    pub player: ActorId,
    pub tracks: Vec<PowerTrack>,
    /// The player's dead phases overlapping the range, clipped to it (the chart's dead band).
    pub dead: Vec<(i32, i32)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResourcesReport {
    pub start_ms: i32,
    pub end_ms: i32,
    pub step_ms: u32,
    pub players: Vec<PlayerResources>,
}

fn pct(sample: &PowerSample) -> Option<f32> {
    (sample.max > 0)
        .then(|| (sample.current as f64 * 100.0 / sample.max as f64).clamp(0.0, 100.0) as f32)
}

fn steps(start: i32, end: i32, step_ms: u32) -> usize {
    ((end - start).max(0) as u32).div_ceil(step_ms) as usize
}

/// Percent of max per step from the player's samples in `[start, end)`: the last sample in
/// each step. Power is a state, not a rate: steps between two samples keep the last value.
/// Empty without samples.
pub(crate) fn power_series(
    fight: &Fight,
    player: ActorId,
    power_type: i32,
    start: i32,
    end: i32,
    step_ms: u32,
) -> Vec<Option<f32>> {
    let mut series = vec![None; steps(start, end, step_ms)];
    let mut any = false;
    for sample in fight
        .power
        .iter()
        .filter(|p| p.actor == player && p.power_type == power_type && p.t >= start && p.t < end)
    {
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

pub fn resources_report(fight: &Fight, filter: &ReportFilter) -> ResourcesReport {
    let (start, end) = filter.clipped(fight);
    let mut samples: BTreeMap<(ActorId, i32), Vec<&PowerSample>> = BTreeMap::new();
    for sample in fight.power.iter().filter(|p| p.t >= start && p.t < end) {
        samples
            .entry((sample.actor, sample.power_type))
            .or_default()
            .push(sample);
    }
    let mut energize: HashMap<(ActorId, i32), HashMap<SpellId, (f64, f64)>> = HashMap::new();
    for event in fight.events.iter().filter(|e| e.t >= start && e.t < end) {
        if let EventKind::Energize(e) = event.kind {
            // Some spells drain power through a negative energize; that is no gain.
            if e.amount < 0.0 {
                continue;
            }
            let entry = energize
                .entry((event.target, e.power_type))
                .or_default()
                .entry(event.spell)
                .or_default();
            entry.0 += e.amount;
            entry.1 += e.over_energize;
        }
    }
    let mut players: BTreeMap<ActorId, Vec<PowerTrack>> = BTreeMap::new();
    for ((player, power_type), list) in samples {
        let pcts: Vec<f32> = list.iter().filter_map(|s| pct(s)).collect();
        let capped_ms = list
            .windows(2)
            .filter(|w| pct(w[0]).is_some_and(|p| p >= CAPPED_PCT))
            // A form can hide the power for minutes: such gaps are unknown, not capped.
            .map(|w| (w[1].t - w[0].t) as u32)
            .filter(|&gap| gap <= MAX_KNOWN_GAP_MS)
            .sum();
        let mut gains: Vec<(SpellId, f64, f64)> = energize
            .get(&(player, power_type))
            .map(|by_spell| by_spell.iter().map(|(&s, &(g, w))| (s, g, w)).collect())
            .unwrap_or_default();
        gains.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        players.entry(player).or_default().push(PowerTrack {
            power_type,
            series: power_series(fight, player, power_type, start, end, RESOURCE_STEP_MS),
            avg_pct: (!pcts.is_empty()).then(|| pcts.iter().sum::<f32>() / pcts.len() as f32),
            min_pct: pcts.iter().copied().reduce(f32::min),
            capped_ms,
            // `fold` from +0.0: an empty `sum` of floats is -0.0, which renders as "-0".
            gained: gains.iter().fold(0.0, |acc, g| acc + g.1),
            wasted: gains.iter().fold(0.0, |acc, g| acc + g.2),
            gains,
        });
    }
    let pull_end = fight.duration_ms.min(i32::MAX as u64) as i32;
    let all_deaths = deaths(fight);
    let dead_of = |player: ActorId| -> Vec<(i32, i32)> {
        all_deaths
            .iter()
            .filter(|d| d.player == player)
            .map(|d| (d.t.max(start), d.dead_until.unwrap_or(pull_end).min(end)))
            .filter(|(a, b)| b > a)
            .collect()
    };
    ResourcesReport {
        start_ms: start,
        end_ms: end,
        step_ms: RESOURCE_STEP_MS,
        players: players
            .into_iter()
            .map(|(player, tracks)| PlayerResources {
                player,
                tracks,
                dead: dead_of(player),
            })
            .collect(),
    }
}
