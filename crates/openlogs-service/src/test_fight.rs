//! Hand-built fights for DTO unit tests.

use std::collections::BTreeMap;

use openlogs_analysis::{
    ActorId, Actors, Damage, DamageVia, Event, EventKind, Fight, FightKind, Heal, NOBODY, SpellId,
};
use openlogs_index::Outcome;
use openlogs_parser::Unit;

pub const PLAYER_FLAGS: u32 = 0x514;
pub const PET_FLAGS: u32 = 0x2114;
pub const HOSTILE_FLAGS: u32 = 0x10a48;

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
        kind: FightKind::Pull,
        encounter_id: 3492,
        name: "Ula'tek".into(),
        difficulty: 15,
        outcome: Outcome::Wipe,
        duration_ms: 20_000,
        events,
        power: Vec::new(),
        actors,
        spells: BTreeMap::new(),
        broken_lines: 0,
        encounters: Vec::new(),
        fail_reasons: Vec::new(),
        positions: Vec::new(),
        raid_markers: Vec::new(),
        world_markers: Vec::new(),
        ui_map_id: None,
        map_bounds: Vec::new(),
    }
}

/// A hit on a hostile unit; `supporter` is the Evoker of a support share, else `NOBODY`.
pub fn damage_event(
    t: i32,
    source: ActorId,
    target: ActorId,
    spell: SpellId,
    amount: u64,
    supporter: ActorId,
) -> Event {
    Event {
        t,
        source,
        target,
        spell,
        kind: EventKind::Damage(Damage {
            via: DamageVia::Spell,
            amount,
            overkill: 0,
            school: 1,
            resisted: 0,
            blocked: 0,
            absorbed: 0,
            critical: false,
            supporter,
        }),
        source_hostile: false,
        target_hostile: true,
        unit_hp: None,
    }
}

/// An effective heal on a friendly unit.
pub fn heal_event(t: i32, source: ActorId, target: ActorId, spell: SpellId, amount: u64) -> Event {
    Event {
        t,
        source,
        target,
        spell,
        kind: EventKind::Heal(Heal {
            periodic: false,
            amount,
            overheal: 0,
            absorbed: 0,
            critical: false,
            supporter: NOBODY,
        }),
        source_hostile: false,
        target_hostile: false,
        unit_hp: None,
    }
}
