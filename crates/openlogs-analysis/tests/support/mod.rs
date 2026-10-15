// Each test binary uses a different subset of these helpers.
#![allow(dead_code)]

use std::collections::BTreeMap;

use openlogs_analysis::{
    ActorId, Actors, Damage, DamageVia, Event, EventKind, Fight, FightKind, Heal, NO_SPELL, NOBODY,
    PowerSample, SpellId, SpellInfo, UnitHp,
};
use openlogs_index::Outcome;
use openlogs_parser::Unit;

pub const PLAYER_FLAGS: u32 = 0x514;
pub const PET_FLAGS: u32 = 0x2114;
pub const HOSTILE_FLAGS: u32 = 0x10a48;

/// Builds a `Fight` event by event for analysis tests.
pub struct FightBuilder {
    pub fight: Fight,
}

impl FightBuilder {
    pub fn new(duration_ms: u64) -> Self {
        Self {
            fight: Fight {
                kind: FightKind::Pull,
                encounter_id: 3492,
                name: "Ula'tek".into(),
                difficulty: 15,
                outcome: Outcome::Wipe,
                duration_ms,
                events: Vec::new(),
                power: Vec::new(),
                actors: Actors::new(),
                spells: BTreeMap::new(),
                broken_lines: 0,
                encounters: Vec::new(),
                fail_reasons: Vec::new(),
            },
        }
    }

    pub fn player(&mut self, guid: &str, name: &str, spec_id: u32) -> ActorId {
        let id = self.unit(guid, name, PLAYER_FLAGS);
        self.fight.actors.set_spec(id, spec_id);
        id
    }

    pub fn unit(&mut self, guid: &str, name: &str, flags: u32) -> ActorId {
        self.fight.actors.intern(&Unit {
            guid,
            name: Some(name),
            flags,
            raid_flags: 0x8000_0000,
        })
    }

    pub fn spell(&mut self, id: SpellId, name: &str) -> SpellId {
        self.fight.spells.insert(
            id,
            SpellInfo {
                name: name.into(),
                school: 1,
            },
        );
        id
    }

    pub fn push(
        &mut self,
        t: i32,
        source: ActorId,
        target: ActorId,
        spell: SpellId,
        kind: EventKind,
    ) -> &mut Self {
        self.fight.events.push(Event {
            t,
            source,
            target,
            spell,
            kind,
            source_hostile: self.fight.actors.get(source).is_hostile(),
            target_hostile: self.fight.actors.get(target).is_hostile(),
            unit_hp: None,
        });
        self
    }

    /// A hit that also reports the target's HP after it.
    pub fn hit(
        &mut self,
        t: i32,
        source: ActorId,
        target: ActorId,
        spell: SpellId,
        amount: u64,
        hp: (u64, u64),
    ) -> &mut Self {
        self.fight.events.push(Event {
            t,
            source,
            target,
            spell,
            kind: EventKind::Damage(damage(DamageVia::Spell, amount, 0)),
            source_hostile: self.fight.actors.get(source).is_hostile(),
            target_hostile: self.fight.actors.get(target).is_hostile(),
            unit_hp: Some(UnitHp {
                actor: target,
                current: hp.0,
                max: hp.1,
            }),
        });
        self
    }

    /// A power sample for `actor`.
    pub fn power(
        &mut self,
        t: i32,
        actor: ActorId,
        power_type: i32,
        current: i64,
        max: i64,
    ) -> &mut Self {
        self.fight.power.push(PowerSample {
            t,
            actor,
            power_type,
            current,
            max,
        });
        self
    }

    pub fn build(&mut self) -> Fight {
        self.fight.events.sort_by_key(|event| event.t);
        self.fight.power.sort_by_key(|p| p.t);
        self.fight.clone()
    }
}

pub fn damage(via: DamageVia, amount: u64, overkill: u64) -> Damage {
    Damage {
        via,
        amount,
        overkill,
        school: 1,
        resisted: 0,
        blocked: 0,
        absorbed: 0,
        critical: false,
        supporter: NOBODY,
    }
}

pub fn heal(amount: u64, overheal: u64) -> Heal {
    Heal {
        periodic: false,
        amount,
        overheal,
        absorbed: 0,
        critical: false,
        supporter: NOBODY,
    }
}

pub const MELEE: SpellId = NO_SPELL;
