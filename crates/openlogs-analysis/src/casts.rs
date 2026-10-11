use std::collections::{HashMap, HashSet};

use openlogs_gamedata::Curated;

use crate::actors::{ActorId, ActorKind};
use crate::auras::{aura_intervals, union_ms};
use crate::fight::{Event, EventKind, Fight, SpellId};
use crate::filter::ReportFilter;
use crate::links::{AbilityIndex, AbilityLink, SpellKey, spell_key};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpellCasts {
    /// The spell's cast ID with the most casts; other IDs of the same name are counted in.
    pub spell: SpellId,
    pub casts: u32,
    /// Time of the first cast in the range (ms from the pull); equal counts are ordered by it.
    pub first_cast_ms: i32,
    /// Curated as a proc or passive trigger, not a player action.
    pub proc_trigger: bool,
    /// Share of the range during which the player's own aura with this spell's name (or ID,
    /// without a known name) was on any target; `None` when there is no such aura.
    pub uptime: Option<f64>,
    /// The ability page with this spell's hits; `None` when it has none.
    pub link: Option<AbilityLink>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerCasts {
    pub player: ActorId,
    pub spells: Vec<SpellCasts>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CastsReport {
    pub duration_ms: u64,
    pub players: Vec<PlayerCasts>,
}

/// A cast ID with its casts and the time of its first cast.
type CastIdCount = (SpellId, u32, i32);

/// A cast that comes at most this long after a counted cast of the same name with another ID is
/// part of that press (Exterminate's second swing 0.5 s later, Flame Shock's and Verdant Embrace's
/// two IDs within 25 ms, The Hunt's impact 0.45–0.65 s later). Separate presses of two IDs of one
/// name come later (Reaver's Glaive's two IDs ≥ 1.02 s apart in 12.x logs).
const SAME_PRESS_MS: i32 = 1_000;
/// A cast ID that only ever comes right after a cast of another ID of its name, at most this long
/// after it, is that press's follow-up (Frostwyrm's Fury's 1265384, 2.0–8.0 s after every 279302).
const FOLLOW_UP_MS: i32 = 10_000;

/// Indices into `fight.events` of the follow-up casts of `wanted` players: casts of spells that log
/// several IDs per press after the press itself. Curated procs are not looked at (the Casts tab keeps
/// them in rows of their own; the player and ability pages drop them, see `non_press_casts`).
/// Counts are presses everywhere: the Casts tab, the player page and the ability page.
pub(crate) fn follow_up_casts(
    fight: &Fight,
    curated: &Curated,
    wanted: impl Fn(ActorId) -> bool,
) -> HashSet<usize> {
    let mut skip = HashSet::new();
    let mut by_name: HashMap<(ActorId, SpellKey<'_>), Vec<usize>> = HashMap::new();
    for (i, event) in fight.events.iter().enumerate() {
        if matches!(event.kind, EventKind::CastSuccess)
            && wanted(event.source)
            && !curated.is_proc(event.spell)
        {
            by_name
                .entry((event.source, spell_key(fight, event.spell)))
                .or_default()
                .push(i);
        }
    }
    let at = |i: usize| &fight.events[i];
    for casts in by_name.values() {
        let ids: HashSet<SpellId> = casts.iter().map(|&i| at(i).spell).collect();
        if ids.len() < 2 {
            continue;
        }
        let is_follow_up = |id: SpellId| {
            casts.iter().enumerate().all(|(k, &i)| {
                at(i).spell != id
                    || k > 0 && {
                        let previous = at(casts[k - 1]);
                        previous.spell != id && at(i).t - previous.t <= FOLLOW_UP_MS
                    }
            })
        };
        let follow_ups: HashSet<SpellId> =
            ids.iter().copied().filter(|&id| is_follow_up(id)).collect();
        let mut last: Option<&Event> = None;
        for &i in casts {
            let event = at(i);
            let same_press =
                last.is_some_and(|l| l.spell != event.spell && event.t - l.t <= SAME_PRESS_MS);
            if follow_ups.contains(&event.spell) || same_press {
                skip.insert(i);
            } else {
                last = Some(event);
            }
        }
    }
    skip
}

/// Indices into `fight.events` of `player`'s own casts that are no press of their own: curated
/// procs and the follow-up casts of spells that log several IDs per press.
pub(crate) fn non_press_casts(fight: &Fight, curated: &Curated, player: ActorId) -> HashSet<usize> {
    let mut skip = follow_up_casts(fight, curated, |actor| actor == player);
    skip.extend(fight.events.iter().enumerate().filter_map(|(i, event)| {
        (matches!(event.kind, EventKind::CastSuccess)
            && event.source == player
            && curated.is_proc(event.spell))
        .then_some(i)
    }));
    skip
}

pub fn casts_report(fight: &Fight, curated: &Curated, filter: &ReportFilter) -> CastsReport {
    let (start, end) = filter.clipped(fight);
    let is_player = |actor: ActorId| fight.actors.get(actor).kind == ActorKind::Player;
    // One cast per press, as on the player and ability pages; curated procs keep their own rows.
    let follow_ups = follow_up_casts(fight, curated, is_player);
    // Casts and the first cast's time per player and cast ID.
    let mut counts: HashMap<ActorId, HashMap<SpellId, (u32, i32)>> = HashMap::new();
    for (i, event) in fight
        .events
        .iter()
        .enumerate()
        .filter(|(_, e)| filter.contains(e.t))
    {
        if matches!(event.kind, EventKind::CastSuccess)
            && is_player(event.source)
            && !follow_ups.contains(&i)
        {
            let entry = counts
                .entry(event.source)
                .or_default()
                .entry(event.spell)
                .or_insert((0, event.t));
            entry.0 += 1;
            entry.1 = entry.1.min(event.t);
        }
    }
    let mut auras: HashMap<(ActorId, SpellKey<'_>), Vec<(i32, i32)>> = HashMap::new();
    for interval in aura_intervals(fight) {
        if counts.contains_key(&interval.source) {
            auras
                .entry((interval.source, spell_key(fight, interval.spell)))
                .or_default()
                .push((interval.start_ms, interval.end_ms));
        }
    }
    let index = AbilityIndex::new(fight, filter, None);
    let len = end - start;
    let uptime = |intervals: &[(i32, i32)]| {
        if len > 0 {
            union_ms(intervals, start, end) as f64 / f64::from(len)
        } else {
            0.0
        }
    };
    let mut players: Vec<PlayerCasts> = counts
        .into_iter()
        .map(|(player, spells)| {
            // One row per name and proc flag; the ID with the most casts represents it.
            let mut groups: HashMap<(SpellKey<'_>, bool), Vec<CastIdCount>> = HashMap::new();
            for (spell, (casts, first)) in spells {
                groups
                    .entry((spell_key(fight, spell), curated.is_proc(spell)))
                    .or_default()
                    .push((spell, casts, first));
            }
            let mut spells: Vec<SpellCasts> = groups
                .into_iter()
                .map(|((key, proc_trigger), mut ids)| {
                    ids.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
                    SpellCasts {
                        spell: ids[0].0,
                        casts: ids.iter().map(|&(_, casts, _)| casts).sum(),
                        first_cast_ms: ids.iter().map(|&(_, _, first)| first).min().unwrap_or(0),
                        proc_trigger,
                        uptime: auras.get(&(player, key)).map(Vec::as_slice).map(uptime),
                        link: ids
                            .iter()
                            .find_map(|&(spell, _, _)| index.link(fight, player, spell)),
                    }
                })
                .collect();
            spells.sort_by(|a, b| {
                b.casts
                    .cmp(&a.casts)
                    .then(a.first_cast_ms.cmp(&b.first_cast_ms))
                    .then(a.spell.cmp(&b.spell))
            });
            PlayerCasts { player, spells }
        })
        .collect();
    let total = |p: &PlayerCasts| p.spells.iter().map(|s| s.casts).sum::<u32>();
    players.sort_by(|a, b| total(b).cmp(&total(a)).then(a.player.cmp(&b.player)));
    CastsReport {
        duration_ms: filter.duration_ms(fight),
        players,
    }
}
