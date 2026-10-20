use std::collections::{HashMap, HashSet};

use openlogs_gamedata::Curated;

use crate::actors::{ActorId, ActorKind};
use crate::auras::{aura_intervals, union_ms};
use crate::breakdown::{Breakdown, Dimension, group_cells};
use crate::cells::{Cell, CellKind, Facts, ScopeMetric, book, in_scope, into_cells};
use crate::fight::{Event, EventKind, Fight, SpellId};
use crate::filter::ReportFilter;
use crate::links::{AbilityIndex, AbilityLink, SpellKey, spell_key};
use crate::scope::{AbilityRef, Scope, Side, UnitRef, side_of, unit_of};

/// A row of one player and one ability, with what the breakdown does not carry.
#[derive(Debug, Clone, PartialEq)]
pub struct CastExtra {
    pub player: ActorId,
    pub ability: AbilityRef,
    pub kind: CellKind,
    /// The row's cast ID with the most casts; other IDs of the same name are counted in.
    pub spell: SpellId,
    /// Casts per cast ID, most casts first, the lowest ID on a tie.
    pub casts_by_spell: Vec<(SpellId, u32)>,
    pub casts: u32,
    /// The first cast in the range; equal counts are ordered by it.
    pub first_cast_ms: i32,
    /// Share of the range during which the player's own aura with this spell's name (or ID,
    /// without a known name) was on any target; `None` when there is no such aura.
    pub uptime: Option<f64>,
    /// The ability page with this spell's hits; `None` when it has none.
    pub link: Option<AbilityLink>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CastsReport {
    pub breakdown: Breakdown,
    /// One per player and ability row in scope.
    pub extras: Vec<CastExtra>,
}

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

/// Casts of `side`'s casters in the range, one per press: players for friendlies (their pets'
/// casts are not counted), units hostile at the cast for enemies.
pub(crate) fn presses<'a>(
    fight: &'a Fight,
    curated: &Curated,
    filter: &ReportFilter,
    side: Side,
) -> Vec<&'a Event> {
    let caster = |actor: ActorId| match side {
        Side::Friendly => fight.actors.get(actor).kind == ActorKind::Player,
        Side::Enemy => fight.actors.credited_player(actor).is_none(),
    };
    let follow_ups = follow_up_casts(fight, curated, caster);
    fight
        .events
        .iter()
        .enumerate()
        .filter(|(i, event)| {
            filter.contains(event.t)
                && matches!(event.kind, EventKind::CastSuccess)
                && caster(event.source)
                && !follow_ups.contains(i)
                && (side == Side::Friendly
                    || side_of(fight, event.source, event.source_hostile) == Some(Side::Enemy))
        })
        .map(|(_, event)| event)
        .collect()
}

/// Only player procs are curated, so enemy casts are all presses.
pub(crate) fn book_casts(fight: &Fight, curated: &Curated, presses: &[&Event], map: &mut Facts) {
    for event in presses {
        let player = fight.actors.get(event.source).kind == ActorKind::Player;
        let kind = if player && curated.is_proc(event.spell) {
            CellKind::Proc
        } else {
            CellKind::Own
        };
        book(
            map,
            (
                unit_of(fight, event.source),
                event.spell,
                kind,
                unit_of(fight, event.target),
            ),
            1,
            0,
            true,
            false,
        );
    }
}

fn spell_key_of(ability: &AbilityRef) -> SpellKey<'_> {
    match ability {
        AbilityRef::Name(name) => SpellKey::Name(name),
        AbilityRef::Id(id) => SpellKey::Id(*id),
    }
}

/// Casts in the scope by `wanted` (or its fallback). Hide procs drops curated procs unless an
/// ability is selected: a selection always shows what it names.
pub fn casts_report(
    fight: &Fight,
    curated: &Curated,
    filter: &ReportFilter,
    scope: &Scope,
    wanted: Dimension,
    hide_procs: bool,
) -> CastsReport {
    let presses = presses(fight, curated, filter, scope.perspective);
    let mut map = Facts::new();
    book_casts(fight, curated, &presses, &mut map);
    let hidden =
        |cell: &Cell| hide_procs && scope.ability.is_empty() && cell.kind == CellKind::Proc;
    let all: Vec<Cell> = into_cells(map).into_iter().filter(|c| !hidden(c)).collect();
    let breakdown = group_cells(fight, filter, scope, ScopeMetric::Casts, &all, wanted);

    // Casts per cast ID of each player and ability row.
    let mut rows: HashMap<(ActorId, AbilityRef, CellKind), HashMap<SpellId, u32>> = HashMap::new();
    for cell in all.iter().filter(|c| in_scope(scope, fight, c)) {
        if let UnitRef::Player(player) = cell.source {
            *rows
                .entry((player, AbilityRef::of(fight, cell.spell), cell.kind))
                .or_default()
                .entry(cell.spell)
                .or_default() += cell.hits;
        }
    }
    let mut first: HashMap<(ActorId, SpellId), i32> = HashMap::new();
    for event in &presses {
        first.entry((event.source, event.spell)).or_insert(event.t);
    }
    let players: HashSet<ActorId> = rows.keys().map(|(player, _, _)| *player).collect();
    let mut auras: HashMap<(ActorId, SpellKey<'_>), Vec<(i32, i32)>> = HashMap::new();
    for interval in aura_intervals(fight) {
        if players.contains(&interval.source) {
            auras
                .entry((interval.source, spell_key(fight, interval.spell)))
                .or_default()
                .push((interval.start_ms, interval.end_ms));
        }
    }
    let (start, end) = filter.clipped(fight);
    let uptime = |intervals: &Vec<(i32, i32)>| {
        if end > start {
            union_ms(intervals, start, end) as f64 / f64::from(end - start)
        } else {
            0.0
        }
    };
    let index = AbilityIndex::new(fight, filter, None);
    let mut extras: Vec<CastExtra> = rows
        .into_iter()
        .map(|((player, ability, kind), casts)| {
            let mut ids: Vec<(SpellId, u32)> = casts.into_iter().collect();
            ids.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
            CastExtra {
                spell: ids[0].0,
                casts: ids.iter().map(|(_, casts)| casts).sum(),
                first_cast_ms: ids
                    .iter()
                    .filter_map(|(spell, _)| first.get(&(player, *spell)).copied())
                    .min()
                    .unwrap_or(0),
                uptime: auras.get(&(player, spell_key_of(&ability))).map(uptime),
                link: ids
                    .iter()
                    .find_map(|&(spell, _)| index.link(fight, player, spell)),
                casts_by_spell: ids,
                player,
                ability,
                kind,
            }
        })
        .collect();
    extras.sort_by(|a, b| (a.player, &a.ability, a.kind).cmp(&(b.player, &b.ability, b.kind)));
    CastsReport { breakdown, extras }
}
