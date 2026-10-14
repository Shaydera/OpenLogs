use std::collections::{HashMap, HashSet};

use crate::actors::ActorId;
use crate::breakdown::{Dimension, RowKey, effective_group, key_of};
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

/// One row of the table: interrupts and dispels of one unit or one stopped spell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KickRow {
    pub key: RowKey,
    /// Ability rows: the stopped spell ID counted most often (for the icon); 0 for unit rows.
    pub spell: SpellId,
    pub interrupts: u32,
    pub dispels: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InterruptsReport {
    pub group: Dimension,
    pub rows: Vec<KickRow>,
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
fn kicks<'a>(
    fight: &'a Fight,
    filter: &'a ReportFilter,
    side: Side,
) -> impl Iterator<Item = (&'a Event, SpellId)> + 'a {
    fight
        .events
        .iter()
        .filter(move |e| filter.contains(e.t))
        .filter_map(|event| match event.kind {
            EventKind::Interrupt { interrupted } => Some((event, interrupted)),
            EventKind::Dispel { removed, .. } | EventKind::Stolen { removed, .. } => {
                Some((event, removed))
            }
            _ => None,
        })
        .filter(move |(event, _)| side_of(fight, event.source, event.source_hostile) == Some(side))
}

fn cell_of(fight: &Fight, event: &Event, stopped: SpellId) -> Cell {
    Cell {
        source: unit_of(fight, event.source),
        spell: stopped,
        kind: CellKind::Own,
        target: unit_of(fight, event.target),
        amount: 1,
        absorbed: 0,
        hits: 1,
        crits: 0,
    }
}

pub(crate) fn book_kicks(fight: &Fight, filter: &ReportFilter, side: Side, map: &mut Facts) {
    for (event, stopped) in kicks(fight, filter, side) {
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
    let mut rows: HashMap<RowKey, (KickRow, HashMap<SpellId, u32>)> = HashMap::new();
    for (event, stopped) in kicks(fight, filter, scope.perspective) {
        let cell = cell_of(fight, event, stopped);
        if !in_scope(scope, fight, &cell) {
            continue;
        }
        let key = key_of(fight, &cell, group);
        let (row, spells) = rows.entry(key.clone()).or_insert_with(|| {
            (
                KickRow {
                    key,
                    spell: 0,
                    interrupts: 0,
                    dispels: 0,
                },
                HashMap::new(),
            )
        });
        *spells.entry(stopped).or_default() += 1;
        match event.kind {
            EventKind::Interrupt { .. } => {
                row.interrupts += 1;
                interrupts.push(InterruptEntry {
                    t: event.t,
                    source: event.source,
                    spell: event.spell,
                    target: event.target,
                    interrupted: stopped,
                });
            }
            _ => {
                row.dispels += 1;
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
    let mut rows: Vec<KickRow> = rows
        .into_values()
        .map(|(mut row, spells)| {
            if let RowKey::Ability { .. } = row.key {
                row.spell = spells
                    .into_iter()
                    .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0)))
                    .map_or(0, |(spell, _)| spell);
            }
            row
        })
        .collect();
    rows.sort_by(|a, b| {
        (b.interrupts + b.dispels)
            .cmp(&(a.interrupts + a.dispels))
            .then(b.interrupts.cmp(&a.interrupts))
            .then_with(|| a.key.cmp(&b.key))
    });
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
        rows,
        interrupts,
        dispels,
        missed,
        most_interrupted,
        kickers,
        dispellers,
    }
}
