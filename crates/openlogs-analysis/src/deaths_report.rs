use std::collections::{HashMap, HashSet};

use openlogs_gamedata::Curated;
use openlogs_index::Outcome;

use crate::actors::ActorId;
use crate::cells::{CellKind, Facts, book};
use crate::deaths::{Death, Hit, death_at, deaths};
use crate::fight::{EventKind, Fight, SpellId};
use crate::filter::ReportFilter;
use crate::links::{SpellKey, spell_key};
use crate::recap::{DeathRecap, death_recaps_where};
use crate::scope::{Scope, Side, UnitRef, side_of, unit_of};
use crate::targets::hits_by_unit;
use crate::timeline::boss_units;

/// An enemy's death: the unit, when, the lethal hit and how long it lived.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Kill {
    pub unit: ActorId,
    pub t: i32,
    /// `None` when the log holds no lethal hit.
    pub killing_blow: Option<Hit>,
    /// From the first hit on the unit to its death.
    pub alive_ms: Option<i32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DeathsReport {
    /// Friendlies: player deaths with their recap.
    pub recaps: Vec<DeathRecap>,
    /// Enemies: kills.
    pub kills: Vec<Kill>,
    /// The killing spell that killed most often (spell, world damage, count); the earlier on a tie.
    pub most_lethal: Option<(SpellId, bool, u32)>,
    /// Deaths a resurrect ended.
    pub rezzed: u32,
    /// Units that died at least once; the source and ability selections are ignored.
    pub dead_units: u32,
    /// Time dead inside the range, over the listed deaths.
    pub dead_ms: u64,
    /// Enemies: the unit with the most killing blows (pets count as their owner) and how many.
    pub top_killer: Option<(UnitRef, u32)>,
    /// Enemies: mean time alive of the killed units.
    pub avg_alive_ms: Option<i32>,
}

/// The killing blow's source and spell as the scope sees them; both unknown without a lethal hit.
pub(crate) fn parts(
    fight: &Fight,
    killing_blow: Option<Hit>,
) -> (Option<UnitRef>, Option<SpellId>) {
    match killing_blow {
        Some(hit) => (Some(unit_of(fight, hit.source)), Some(hit.spell)),
        None => (None, None),
    }
}

/// Enemy deaths in the range, first death per unit. A boss killed on a kill pull has no death in
/// the slice (its UNIT_DIED is logged after ENCOUNTER_END), so it dies at the pull's end.
pub(crate) fn enemy_kills(fight: &Fight, filter: &ReportFilter) -> Vec<Kill> {
    let first_hit: HashMap<ActorId, i32> =
        hits_by_unit(fight, |t| t >= 0, filter.overkill, &Scope::default())
            .into_iter()
            .map(|(unit, (_, first, _))| (unit, first))
            .collect();
    let kill_at = |unit: ActorId, t: i32| {
        let first = first_hit.get(&unit).copied();
        Kill {
            unit,
            t,
            killing_blow: death_at(fight, unit, t, first.unwrap_or(0)).killing_blow,
            alive_ms: first.map(|first| t - first),
        }
    };
    let mut seen: HashSet<ActorId> = HashSet::new();
    let mut kills = Vec::new();
    for event in &fight.events {
        if matches!(event.kind, EventKind::Died { unconscious: false })
            && event.t >= 0
            && side_of(fight, event.target, event.target_hostile, event.t) == Some(Side::Enemy)
            && seen.insert(event.target)
            && filter.contains(event.t)
        {
            kills.push(kill_at(event.target, event.t));
        }
    }
    let pull_end = fight.duration_ms.min(i32::MAX as u64) as i32;
    if fight.outcome == Outcome::Kill && (filter.start_ms..=filter.end_ms).contains(&pull_end) {
        for boss in boss_units(fight) {
            if !seen.contains(&boss) {
                kills.push(kill_at(boss, pull_end));
            }
        }
        kills.sort_by_key(|k| (k.t, k.unit));
    }
    kills
}

fn book_death(fight: &Fight, map: &mut Facts, killing_blow: Option<Hit>, dead: ActorId) {
    let (source, spell, kind) = match killing_blow {
        Some(hit) => (unit_of(fight, hit.source), hit.spell, CellKind::Own),
        None => (UnitRef::Environment, 0, CellKind::Unattributed),
    };
    book(
        map,
        (source, spell, kind, unit_of(fight, dead)),
        1,
        0,
        true,
        false,
    );
}

pub(crate) fn book_deaths(fight: &Fight, filter: &ReportFilter, side: Side, map: &mut Facts) {
    match side {
        Side::Friendly => {
            for death in deaths(fight).into_iter().filter(|d| filter.contains(d.t)) {
                book_death(fight, map, death.killing_blow, death.player);
            }
        }
        Side::Enemy => {
            for kill in enemy_kills(fight, filter) {
                book_death(fight, map, kill.killing_blow, kill.unit);
            }
        }
    }
}

fn most_lethal<'a>(
    fight: &Fight,
    blows: impl Iterator<Item = &'a Hit>,
) -> Option<(SpellId, bool, u32)> {
    let mut counts: Vec<((Option<SpellKey<'_>>, bool), SpellId, u32)> = Vec::new();
    for hit in blows {
        let key = (
            (!hit.environmental).then(|| spell_key(fight, hit.spell)),
            hit.environmental,
        );
        match counts.iter_mut().find(|(k, _, _)| *k == key) {
            Some((_, _, count)) => *count += 1,
            None => counts.push((key, hit.spell, 1)),
        }
    }
    counts
        .into_iter()
        .reduce(|best, next| if next.2 > best.2 { next } else { best })
        .map(|((_, environmental), spell, count)| (spell, environmental, count))
}

/// Friendlies: player deaths with recaps; enemies: kills. Source and ability match the killing
/// blow, so a death without a lethal hit passes only while both select everything.
pub fn deaths_report(
    fight: &Fight,
    curated: &Curated,
    filter: &ReportFilter,
    scope: &Scope,
) -> DeathsReport {
    let accepts = |killing_blow: Option<Hit>, dead: ActorId| {
        let (source, spell) = parts(fight, killing_blow);
        scope.accepts(fight, source.as_ref(), spell, Some(&unit_of(fight, dead)))
    };
    let dead_side = scope.dead_side();
    let dead_selected =
        |dead: ActorId| dead_side.accepts(fight, None, None, Some(&unit_of(fight, dead)));
    let (_, end) = filter.clipped(fight);
    match scope.perspective {
        Side::Friendly => {
            let recaps = death_recaps_where(fight, curated, filter, |death: &Death| {
                accepts(death.killing_blow, death.player)
            });
            let listed: Vec<&Death> = recaps.iter().map(|r| &r.death).collect();
            DeathsReport {
                most_lethal: most_lethal(
                    fight,
                    listed.iter().filter_map(|d| d.killing_blow.as_ref()),
                ),
                rezzed: listed.iter().filter(|d| d.resurrected_at.is_some()).count() as u32,
                dead_units: deaths(fight)
                    .iter()
                    .filter(|d| filter.contains(d.t))
                    .filter(|d| dead_selected(d.player))
                    .map(|d| d.player)
                    .collect::<HashSet<_>>()
                    .len() as u32,
                dead_ms: listed
                    .iter()
                    .map(|d| (d.dead_until.unwrap_or(end).min(end) - d.t).max(0) as u64)
                    .sum(),
                top_killer: None,
                avg_alive_ms: None,
                kills: Vec::new(),
                recaps,
            }
        }
        Side::Enemy => {
            let kills: Vec<Kill> = enemy_kills(fight, filter)
                .into_iter()
                .filter(|k| accepts(k.killing_blow, k.unit))
                .collect();
            let mut killers: Vec<(UnitRef, u32)> = Vec::new();
            for hit in kills.iter().filter_map(|k| k.killing_blow) {
                let killer = unit_of(fight, hit.source).grouped(fight);
                match killers.iter_mut().find(|(unit, _)| *unit == killer) {
                    Some((_, count)) => *count += 1,
                    None => killers.push((killer, 1)),
                }
            }
            let lives: Vec<i32> = kills.iter().filter_map(|k| k.alive_ms).collect();
            DeathsReport {
                most_lethal: most_lethal(
                    fight,
                    kills.iter().filter_map(|k| k.killing_blow.as_ref()),
                ),
                rezzed: 0,
                dead_units: kills.len() as u32,
                dead_ms: 0,
                top_killer: killers
                    .into_iter()
                    .reduce(|best, next| if next.1 > best.1 { next } else { best }),
                avg_alive_ms: (!lives.is_empty()).then(|| {
                    (lives.iter().map(|&l| i64::from(l)).sum::<i64>() / lives.len() as i64) as i32
                }),
                recaps: Vec::new(),
                kills,
            }
        }
    }
}
