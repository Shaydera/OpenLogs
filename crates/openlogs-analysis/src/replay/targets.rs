use std::collections::HashMap;

use crate::actors::{ActorId, NOBODY};
use crate::cells::is_swing;
use crate::fight::{EventKind, Fight};
use crate::replay::units::Roster;

/// Who a unit acts on, one entry per change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetTrack {
    pub actor: ActorId,
    pub t: Vec<i32>,
    pub target: Vec<ActorId>,
}

#[derive(Default)]
struct Retarget {
    t: Vec<i32>,
    target: Vec<ActorId>,
    /// The last target before the pull, kept as the sample at 0.
    prelude: Option<ActorId>,
}

impl Retarget {
    fn set(&mut self, t: i32, target: ActorId) {
        if t < 0 {
            self.prelude = Some(target);
            return;
        }
        if let Some(prelude) = self.prelude.take() {
            self.keep(0, prelude);
        }
        self.keep(t, target);
    }

    fn keep(&mut self, t: i32, target: ActorId) {
        if self.target.last() != Some(&target) {
            self.t.push(t);
            self.target.push(target);
        }
    }

    fn finish(mut self) -> Self {
        if let Some(prelude) = self.prelude.take() {
            self.keep(0, prelude);
        }
        self
    }
}

pub(super) fn targets(fight: &Fight, roster: &Roster) -> Vec<TargetTrack> {
    let mut by_actor: HashMap<ActorId, Retarget> = HashMap::new();
    for event in &fight.events {
        let targeted = match event.kind {
            EventKind::CastSuccess => event.target != NOBODY,
            _ => is_swing(event),
        };
        if targeted
            && event.source != event.target
            && roster.kind(event.source).is_some()
            && roster.kind(event.target).is_some()
        {
            by_actor
                .entry(event.source)
                .or_default()
                .set(event.t, event.target);
        }
    }
    roster
        .units
        .iter()
        .filter_map(|unit| {
            let retarget = by_actor.remove(&unit.actor)?.finish();
            Some(TargetTrack {
                actor: unit.actor,
                t: retarget.t,
                target: retarget.target,
            })
        })
        .collect()
}
