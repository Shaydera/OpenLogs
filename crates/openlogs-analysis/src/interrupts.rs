use std::collections::{HashMap, HashSet};

use crate::actors::ActorId;
use crate::breakdown::{Dimension, RowKey, effective_group, key_of, largest_first, top_spell};
use crate::cells::{Cell, CellKind, Facts, ScopeMetric, book, in_scope};
use crate::fight::{Event, EventKind, Fight, SpellId};
use crate::filter::ReportFilter;
use crate::scope::{Scope, Side, side_of, unit_of};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InterruptEntry {
    pub t: i32,
    /// The unit that interrupted; a pet's interrupt is its owner's on the rows.
    pub source: ActorId,
    /// The interrupt spell (Counterspell, Kick …).
    pub spell: SpellId,
    pub target: ActorId,
    pub interrupted: SpellId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DispelEntry {
    pub t: i32,
    pub source: ActorId,
    pub spell: SpellId,
    pub target: ActorId,
    pub removed: SpellId,
    /// Spellsteal and similar: the aura moved to the player.
    pub stolen: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MissedCast {
    pub t: i32,
    pub source: ActorId,
    pub spell: SpellId,
}

/// One row of the interrupts or the dispels table: one unit or one stopped spell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KickRow {
    pub key: RowKey,
    /// Ability rows: the stopped spell ID counted most often (for the icon); 0 for unit rows.
    pub spell: SpellId,
    /// Ability rows: how often each stopped spell ID was counted, by ID.
    pub spell_counts: Vec<(SpellId, u32)>,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InterruptsReport {
    pub group: Dimension,
    /// Most first; each table only lists rows with at least one of its kind.
    pub interrupt_rows: Vec<KickRow>,
    pub dispel_rows: Vec<KickRow>,
    pub interrupts: Vec<InterruptEntry>,
    pub dispels: Vec<DispelEntry>,
    /// Friendlies only: casts of spells the raid interrupted at least once, completed without an
    /// interrupt.
    pub missed: Vec<MissedCast>,
    /// The interrupted spell stopped most often, and how often; the earlier one on a tie.
    pub most_interrupted: Option<(SpellId, u32)>,
    /// Units that interrupted and units that dispelled; pets count as their owner.
    pub kickers: u32,
    pub dispellers: u32,
}

/// An interrupt or dispel by `side` in the range, as a fact: the stopped spell is its ability.
pub(crate) fn kicks<'a>(
    fight: &'a Fight,
    filter: &'a ReportFilter,
    side: Side,
) -> impl Iterator<Item = (usize, &'a Event, SpellId)> + 'a {
    fight
        .events
        .iter()
        .enumerate()
        .filter(move |(_, e)| filter.contains(e.t))
        .filter_map(|(index, event)| match event.kind {
            EventKind::Interrupt { interrupted } => Some((index, event, interrupted)),
            EventKind::Dispel { removed, .. } | EventKind::Stolen { removed, .. } => {
                Some((index, event, removed))
            }
            _ => None,
        })
        .filter(move |(_, event, _)| {
            side_of(fight, event.source, event.source_hostile, event.t) == Some(side)
        })
}

pub(crate) fn cell_of(fight: &Fight, event: &Event, stopped: SpellId) -> Cell {
    Cell {
        amount: 1,
        hits: 1,
        ..Cell::scope_probe(fight, event.source, stopped, CellKind::Own, event.target)
    }
}

pub(crate) fn book_kicks(fight: &Fight, filter: &ReportFilter, side: Side, map: &mut Facts) {
    for (_, event, stopped) in kicks(fight, filter, side) {
        let cell = cell_of(fight, event, stopped);
        book(
            map,
            (cell.source, cell.spell, cell.kind, cell.target),
            1,
            0,
            true,
            false,
        );
    }
}

/// Casts of spells the raid interrupted at least once that started and completed without an
/// interrupt, by units the raid does not own.
fn missed_casts(fight: &Fight, filter: &ReportFilter) -> Vec<MissedCast> {
    let interruptible: HashSet<SpellId> = fight
        .events
        .iter()
        .filter_map(|e| match e.kind {
            EventKind::Interrupt { interrupted }
                if fight.actors.credited_player(e.source).is_some() =>
            {
                Some(interrupted)
            }
            _ => None,
        })
        .collect();
    let mut missed = Vec::new();
    let mut pending: HashMap<(ActorId, SpellId), i32> = HashMap::new();
    for event in &fight.events {
        let owned = fight.actors.credited_player(event.source).is_some();
        match event.kind {
            EventKind::Interrupt { interrupted } => {
                pending.remove(&(event.target, interrupted));
            }
            EventKind::CastStart if !owned && interruptible.contains(&event.spell) => {
                pending.insert((event.source, event.spell), event.t);
            }
            EventKind::CastSuccess if !owned && interruptible.contains(&event.spell) => {
                // Remove first: a completed cast ends the pending start either way.
                let started = pending.remove(&(event.source, event.spell)).is_some();
                if started && filter.contains(event.t) {
                    missed.push(MissedCast {
                        t: event.t,
                        source: event.source,
                        spell: event.spell,
                    });
                }
            }
            _ => {}
        }
    }
    missed
}

fn distinct_units(fight: &Fight, sources: impl Iterator<Item = ActorId>) -> u32 {
    sources
        .map(|source| unit_of(fight, source).grouped(fight))
        .collect::<HashSet<_>>()
        .len() as u32
}

#[derive(Default)]
struct Tally {
    count: u32,
    ability_spell_counts: HashMap<SpellId, u32>,
}

type RowTally = HashMap<RowKey, Tally>;

fn tally(rows: &mut RowTally, key: RowKey, stopped: SpellId) {
    let ability = matches!(key, RowKey::Ability { .. });
    let tally = rows.entry(key).or_default();
    tally.count += 1;
    if ability {
        *tally.ability_spell_counts.entry(stopped).or_default() += 1;
    }
}

fn ranked(rows: RowTally) -> Vec<KickRow> {
    let mut rows: Vec<KickRow> = rows
        .into_iter()
        .map(|(key, tally)| {
            let mut spell_counts: Vec<(SpellId, u32)> =
                tally.ability_spell_counts.into_iter().collect();
            spell_counts.sort_by_key(|&(spell, _)| spell);
            KickRow {
                key,
                spell: top_spell(spell_counts.iter().copied()).unwrap_or(0),
                spell_counts,
                count: tally.count,
            }
        })
        .collect();
    rows.sort_by(|a, b| largest_first(a.count, &a.key).cmp(&largest_first(b.count, &b.key)));
    rows
}

/// The stopped spell is the ability: a selection answers "who kicked X" and "which X went through".
pub fn interrupts_report(
    fight: &Fight,
    filter: &ReportFilter,
    scope: &Scope,
    wanted: Dimension,
) -> InterruptsReport {
    let group = effective_group(scope, ScopeMetric::Interrupts, wanted);
    let mut interrupts = Vec::new();
    let mut dispels = Vec::new();
    let mut interrupt_rows = RowTally::new();
    let mut dispel_rows = RowTally::new();
    for (_, event, stopped) in kicks(fight, filter, scope.perspective) {
        let cell = cell_of(fight, event, stopped);
        if !in_scope(scope, fight, &cell) {
            continue;
        }
        let key = key_of(fight, &cell, group, ScopeMetric::Interrupts);
        match event.kind {
            EventKind::Interrupt { .. } => {
                tally(&mut interrupt_rows, key, stopped);
                interrupts.push(InterruptEntry {
                    t: event.t,
                    source: event.source,
                    spell: event.spell,
                    target: event.target,
                    interrupted: stopped,
                });
            }
            _ => {
                tally(&mut dispel_rows, key, stopped);
                dispels.push(DispelEntry {
                    t: event.t,
                    source: event.source,
                    spell: event.spell,
                    target: event.target,
                    removed: stopped,
                    stolen: matches!(event.kind, EventKind::Stolen { .. }),
                });
            }
        }
    }
    let missed = match scope.perspective {
        Side::Friendly => missed_casts(fight, filter)
            .into_iter()
            .filter(|m| {
                let caster = unit_of(fight, m.source);
                scope.accepts(fight, None, Some(m.spell), Some(&caster))
            })
            .collect(),
        Side::Enemy => Vec::new(),
    };
    let mut counts: Vec<(SpellId, u32)> = Vec::new();
    for kick in &interrupts {
        match counts
            .iter_mut()
            .find(|(spell, _)| *spell == kick.interrupted)
        {
            Some((_, count)) => *count += 1,
            None => counts.push((kick.interrupted, 1)),
        }
    }
    let most_interrupted = counts
        .into_iter()
        .reduce(|best, next| if next.1 > best.1 { next } else { best });
    let kickers = distinct_units(fight, interrupts.iter().map(|k| k.source));
    let dispellers = distinct_units(fight, dispels.iter().map(|d| d.source));
    InterruptsReport {
        group,
        interrupt_rows: ranked(interrupt_rows),
        dispel_rows: ranked(dispel_rows),
        interrupts,
        dispels,
        missed,
        most_interrupted,
        kickers,
        dispellers,
    }
}
