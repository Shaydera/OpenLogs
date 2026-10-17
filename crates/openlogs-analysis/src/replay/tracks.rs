use std::collections::HashMap;

use crate::actors::ActorId;
use crate::fight::Fight;
use crate::replay::ReplayUnit;

/// A unit's positions as columns, sorted by `t`. It starts with the last sample before the
/// pull, so the position at 0 can be interpolated.
#[derive(Debug, Clone, PartialEq)]
pub struct Track {
    pub actor: ActorId,
    pub t: Vec<i32>,
    pub x: Vec<f32>,
    pub y: Vec<f32>,
    pub facing: Vec<f32>,
}

impl Track {
    fn new(actor: ActorId) -> Self {
        Self {
            actor,
            t: Vec::new(),
            x: Vec::new(),
            y: Vec::new(),
            facing: Vec::new(),
        }
    }

    fn clear(&mut self) {
        self.t.clear();
        self.x.clear();
        self.y.clear();
        self.facing.clear();
    }
}

pub(super) fn tracks(fight: &Fight, units: &[ReplayUnit]) -> Vec<Track> {
    let mut by_actor: HashMap<ActorId, Track> = HashMap::new();
    for sample in &fight.positions {
        let track = by_actor
            .entry(sample.actor)
            .or_insert_with(|| Track::new(sample.actor));
        if sample.t < 0 {
            track.clear();
        }
        track.t.push(sample.t);
        track.x.push(sample.x);
        track.y.push(sample.y);
        track.facing.push(sample.facing);
    }
    units
        .iter()
        .filter_map(|unit| by_actor.remove(&unit.actor))
        .collect()
}
