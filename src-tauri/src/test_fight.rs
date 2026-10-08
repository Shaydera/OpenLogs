//! Hand-built fights for DTO unit tests.

use std::collections::BTreeMap;

use openlogs_analysis::{ActorId, Actors, Event, Fight};
use openlogs_index::Outcome;
use openlogs_parser::Unit;

pub const PLAYER_FLAGS: u32 = 0x514;

pub fn unit(actors: &mut Actors, guid: &str, name: &str, flags: u32) -> ActorId {
    actors.intern(&Unit {
        guid,
        name: Some(name),
        flags,
        raid_flags: 0x8000_0000,
    })
}

/// A 20 s Heroic Ula'tek wipe with these actors and events (sorted by time).
pub fn fight(actors: Actors, mut events: Vec<Event>) -> Fight {
    events.sort_by_key(|e| e.t);
    Fight {
        encounter_id: 3492,
        name: "Ula'tek".into(),
        difficulty: 15,
        outcome: Outcome::Wipe,
        duration_ms: 20_000,
        events,
        actors,
        spells: BTreeMap::new(),
        broken_lines: 0,
    }
}
