use std::collections::{HashMap, HashSet};

use crate::actors::ActorId;
use crate::fight::{EventKind, Fight, SpellId};
use crate::filter::ReportFilter;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InterruptEntry {
    pub t: i32,
    pub player: ActorId,
    /// The interrupt spell (Counterspell, Kick …).
    pub spell: SpellId,
    pub target: ActorId,
    pub interrupted: SpellId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DispelEntry {
    pub t: i32,
    pub player: ActorId,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InterruptsReport {
    pub interrupts: Vec<InterruptEntry>,
    pub dispels: Vec<DispelEntry>,
    pub missed: Vec<MissedCast>,
}

pub fn interrupts_report(fight: &Fight, filter: &ReportFilter) -> InterruptsReport {
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

    let mut interrupts = Vec::new();
    let mut dispels = Vec::new();
    let mut missed = Vec::new();
    let mut pending: HashMap<(ActorId, SpellId), i32> = HashMap::new();
    for event in &fight.events {
        let player = fight.actors.credited_player(event.source);
        match event.kind {
            EventKind::Interrupt { interrupted } => {
                pending.remove(&(event.target, interrupted));
                if let Some(player) = player
                    && filter.contains(event.t)
                {
                    interrupts.push(InterruptEntry {
                        t: event.t,
                        player,
                        spell: event.spell,
                        target: event.target,
                        interrupted,
                    });
                }
            }
            EventKind::Dispel { removed, .. } | EventKind::Stolen { removed, .. } => {
                if let Some(player) = player
                    && filter.contains(event.t)
                {
                    let stolen = matches!(event.kind, EventKind::Stolen { .. });
                    dispels.push(DispelEntry {
                        t: event.t,
                        player,
                        spell: event.spell,
                        target: event.target,
                        removed,
                        stolen,
                    });
                }
            }
            EventKind::CastStart if player.is_none() && interruptible.contains(&event.spell) => {
                pending.insert((event.source, event.spell), event.t);
            }
            EventKind::CastSuccess if player.is_none() && interruptible.contains(&event.spell) => {
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
    InterruptsReport {
        interrupts,
        dispels,
        missed,
    }
}
