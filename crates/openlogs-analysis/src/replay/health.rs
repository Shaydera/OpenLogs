use std::collections::HashMap;

use crate::actors::ActorId;
use crate::fight::{EventKind, Fight};
use crate::replay::units::Roster;

/// A unit keeps at most one HP sample per slot of this length, the slot's last.
const HEALTH_SLOT_MS: i32 = 100;

/// A unit's HP as columns, one sample per change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HealthTrack {
    pub actor: ActorId,
    pub t: Vec<i32>,
    pub current: Vec<u64>,
    pub max: Vec<u64>,
}

type Hp = (u64, u64);

struct Thinning {
    track: HealthTrack,
    /// The last HP before the pull, kept as the sample at 0.
    prelude: Option<Hp>,
    /// The latest sample of the current slot.
    pending: Option<(i32, Hp)>,
}

impl Thinning {
    fn new(actor: ActorId) -> Self {
        Self {
            track: HealthTrack {
                actor,
                t: Vec::new(),
                current: Vec::new(),
                max: Vec::new(),
            },
            prelude: None,
            pending: None,
        }
    }

    fn sample(&mut self, t: i32, hp: Hp) {
        if t < 0 {
            self.prelude = Some(hp);
            return;
        }
        self.flush_prelude();
        if self.latest() == Some(hp) {
            return;
        }
        if self
            .pending
            .is_some_and(|(at, _)| at / HEALTH_SLOT_MS != t / HEALTH_SLOT_MS)
        {
            self.flush();
        }
        self.pending = Some((t, hp));
    }

    /// A death closes the slot: the HP it died at must not be replaced by a later sample.
    fn died(&mut self, t: i32) {
        if t >= 0 {
            self.flush_prelude();
            self.flush();
        }
    }

    fn finish(mut self) -> HealthTrack {
        self.flush_prelude();
        self.flush();
        self.track
    }

    fn latest(&self) -> Option<Hp> {
        self.pending.map(|(_, hp)| hp).or_else(|| self.last_kept())
    }

    fn last_kept(&self) -> Option<Hp> {
        Some((*self.track.current.last()?, *self.track.max.last()?))
    }

    fn flush_prelude(&mut self) {
        if let Some(hp) = self.prelude.take() {
            self.keep(0, hp);
        }
    }

    fn flush(&mut self) {
        if let Some((t, hp)) = self.pending.take() {
            self.keep(t, hp);
        }
    }

    fn keep(&mut self, t: i32, (current, max): Hp) {
        if self.last_kept() != Some((current, max)) {
            self.track.t.push(t);
            self.track.current.push(current);
            self.track.max.push(max);
        }
    }
}

pub(super) fn health(fight: &Fight, roster: &Roster) -> Vec<HealthTrack> {
    let mut by_actor: HashMap<ActorId, Thinning> = HashMap::new();
    for event in &fight.events {
        if let Some(hp) = event.unit_hp
            && roster.kind(hp.actor).is_some()
        {
            by_actor
                .entry(hp.actor)
                .or_insert_with(|| Thinning::new(hp.actor))
                .sample(event.t, (hp.current, hp.max));
        }
        if let EventKind::Died { .. } = event.kind
            && let Some(thinning) = by_actor.get_mut(&event.target)
        {
            thinning.died(event.t);
        }
    }
    roster
        .units
        .iter()
        .filter_map(|unit| by_actor.remove(&unit.actor))
        .map(Thinning::finish)
        .collect()
}
