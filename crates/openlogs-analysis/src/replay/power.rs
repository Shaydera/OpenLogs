use std::collections::{BTreeMap, HashMap};

use crate::actors::ActorId;
use crate::fight::{Fight, PowerSample};
use crate::replay::units::Roster;

/// A unit's primary power as columns, one sample per change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PowerTrack {
    pub actor: ActorId,
    pub power_type: i32,
    pub t: Vec<i32>,
    pub current: Vec<i64>,
    pub max: Vec<i64>,
}

pub(super) fn power(fight: &Fight, roster: &Roster) -> Vec<PowerTrack> {
    let samples = || {
        fight
            .power
            .iter()
            .chain(&fight.npc_power)
            .filter(|sample| sample.primary && roster.kind(sample.actor).is_some())
    };
    let primary = primary_types(samples());
    let mut by_actor: HashMap<ActorId, PowerTrack> = HashMap::new();
    let mut prelude: HashMap<ActorId, (i64, i64)> = HashMap::new();
    for sample in samples().filter(|s| primary.get(&s.actor) == Some(&s.power_type)) {
        let track = by_actor.entry(sample.actor).or_insert_with(|| PowerTrack {
            actor: sample.actor,
            power_type: sample.power_type,
            t: Vec::new(),
            current: Vec::new(),
            max: Vec::new(),
        });
        if sample.t < 0 {
            prelude.insert(sample.actor, (sample.current, sample.max));
            continue;
        }
        if let Some((current, max)) = prelude.remove(&sample.actor) {
            keep(track, 0, current, max);
        }
        keep(track, sample.t, sample.current, sample.max);
    }
    for (actor, (current, max)) in prelude {
        if let Some(track) = by_actor.get_mut(&actor) {
            keep(track, 0, current, max);
        }
    }
    roster
        .units
        .iter()
        .filter_map(|unit| by_actor.remove(&unit.actor))
        .collect()
}

/// The type most of a unit's samples list first; the lower type on a tie.
fn primary_types<'a>(samples: impl Iterator<Item = &'a PowerSample>) -> HashMap<ActorId, i32> {
    let mut counts: HashMap<ActorId, BTreeMap<i32, usize>> = HashMap::new();
    for sample in samples {
        *counts
            .entry(sample.actor)
            .or_default()
            .entry(sample.power_type)
            .or_default() += 1;
    }
    counts
        .into_iter()
        .filter_map(|(actor, types)| {
            let (power_type, _) = types
                .into_iter()
                .max_by_key(|&(power_type, count)| (count, std::cmp::Reverse(power_type)))?;
            Some((actor, power_type))
        })
        .collect()
}

fn keep(track: &mut PowerTrack, t: i32, current: i64, max: i64) {
    if track.current.last() == Some(&current) && track.max.last() == Some(&max) {
        return;
    }
    track.t.push(t);
    track.current.push(current);
    track.max.push(max);
}
