use std::collections::BTreeMap;

use openlogs_index::Outcome;
pub use openlogs_parser::{AuraAction, AuraType, DamageVia};

use crate::actors::{ActorId, Actors};

pub type SpellId = u32;
/// Spell of melee swings, environmental damage and deaths.
pub const NO_SPELL: SpellId = 0;

/// One fight, owned and ready for analysis: a boss pull or a whole Mythic+ run. Every
/// report works on both.
#[derive(Debug, Clone, PartialEq)]
pub struct Fight {
    pub kind: FightKind,
    /// 0 for a run.
    pub encounter_id: u32,
    /// The boss, or the dungeon of a run.
    pub name: String,
    pub difficulty: u32,
    pub outcome: Outcome,
    pub duration_ms: u64,
    /// Sorted by `t`; prelude events (before the start line) have `t < 0`.
    pub events: Vec<Event>,
    /// Players' power samples, sorted by `t`.
    pub power: Vec<PowerSample>,
    pub actors: Actors,
    /// Every spell referenced by `events`, with the name the log used.
    pub spells: BTreeMap<SpellId, SpellInfo>,
    pub broken_lines: u64,
    /// The boss encounters of a run in log order; empty for a boss pull.
    pub encounters: Vec<RunEncounter>,
    /// The texts of [`FailReason::Other`], in first-seen order.
    pub fail_reasons: Vec<String>,
}

impl Fight {
    /// The reason text as the log wrote it.
    pub fn fail_reason(&self, reason: FailReason) -> &str {
        match reason {
            FailReason::Interrupted => FailReason::INTERRUPTED,
            FailReason::Other(index) => self
                .fail_reasons
                .get(usize::from(index))
                .map_or("", String::as_str),
        }
    }
}

/// What a [`Fight`] covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FightKind {
    /// `ENCOUNTER_START` to `ENCOUNTER_END`.
    Pull,
    /// A Mythic+ run, `CHALLENGE_MODE_START` to `CHALLENGE_MODE_END`.
    Run,
}

/// A boss encounter inside a Mythic+ run, in ms since the run started.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunEncounter {
    pub encounter_id: u32,
    pub name: String,
    pub start_ms: i32,
    /// `ENCOUNTER_END`; without it the encounter's last line before the next encounter
    /// or the end of the run.
    pub end_ms: i32,
    pub outcome: Outcome,
}

/// Players' power is kept at most this often per power type.
pub const POWER_SAMPLE_MS: i32 = 500;

/// A player's power from an advanced block.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PowerSample {
    pub t: i32,
    pub actor: ActorId,
    /// WoW power type (0 mana, 1 rage, 3 energy, …).
    pub power_type: i32,
    pub current: i64,
    pub max: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpellInfo {
    pub name: String,
    pub school: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Event {
    /// Milliseconds since the start line (`ENCOUNTER_START`, for a run
    /// `CHALLENGE_MODE_START`).
    pub t: i32,
    pub source: ActorId,
    pub target: ActorId,
    pub spell: SpellId,
    pub kind: EventKind,
    /// Hostile reaction flag of source and target at this event. Units can change
    /// reaction during a fight (adds turning neutral), so this, not the actor's latest
    /// flags, decides friend or foe.
    pub source_hostile: bool,
    pub target_hostile: bool,
    /// HP snapshot from the advanced block, of whichever unit it describes.
    pub unit_hp: Option<UnitHp>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnitHp {
    pub actor: ActorId,
    pub current: u64,
    pub max: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EventKind {
    Damage(Damage),
    Missed(Missed),
    Heal(Heal),
    Absorbed(Absorbed),
    Energize(Energize),
    CastStart,
    CastSuccess,
    /// Logged only for the logging player.
    CastFailed {
        reason: FailReason,
    },
    Aura {
        action: AuraAction,
        aura_type: AuraType,
        stacks: Option<u32>,
        /// The breaking spell for `AuraAction::BrokenSpell`, else [`NO_SPELL`].
        broken_by: SpellId,
    },
    Interrupt {
        interrupted: SpellId,
    },
    Dispel {
        removed: SpellId,
        aura_type: AuraType,
    },
    Stolen {
        removed: SpellId,
        aura_type: AuraType,
    },
    Summon,
    Create,
    Resurrect,
    Instakill,
    EmpowerStart,
    EmpowerEnd {
        stage: u32,
    },
    EmpowerInterrupt {
        stage: u32,
    },
    Died {
        unconscious: bool,
    },
    Destroyed,
    PartyKill,
}

/// Why a cast failed. "Interrupted" is a real interrupted cast; every other reason ("Not yet
/// recovered", "Out of range" …) is a rejected input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailReason {
    Interrupted,
    /// An index into [`Fight::fail_reasons`].
    Other(u16),
}

impl FailReason {
    pub const INTERRUPTED: &'static str = "Interrupted";
}

/// Damage as logged. `amount` includes `overkill`; on support events (`supporter` set)
/// it is the Evoker's share of a hit the source already logged in full.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Damage {
    pub via: DamageVia,
    pub amount: u64,
    pub overkill: u64,
    pub school: u32,
    pub resisted: u64,
    pub blocked: u64,
    pub absorbed: u64,
    pub critical: bool,
    /// Augmentation Evoker for `*_SUPPORT` events, else `NOBODY`.
    pub supporter: ActorId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Missed {
    pub via: DamageVia,
    pub miss_type: MissType,
    /// Prevented amount for partial misses, else 0.
    pub amount_missed: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MissType {
    Absorb,
    Block,
    Deflect,
    Dodge,
    Evade,
    Immune,
    Miss,
    Parry,
    Reflect,
    Resist,
    Other,
}

impl MissType {
    pub fn from_log(text: &str) -> Self {
        match text {
            "ABSORB" => Self::Absorb,
            "BLOCK" => Self::Block,
            "DEFLECT" => Self::Deflect,
            "DODGE" => Self::Dodge,
            "EVADE" => Self::Evade,
            "IMMUNE" => Self::Immune,
            "MISS" => Self::Miss,
            "PARRY" => Self::Parry,
            "REFLECT" => Self::Reflect,
            "RESIST" => Self::Resist,
            _ => Self::Other,
        }
    }
}

/// Healing as logged. `amount` includes `overheal`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Heal {
    pub periodic: bool,
    pub amount: u64,
    pub overheal: u64,
    pub absorbed: u64,
    pub critical: bool,
    /// Augmentation Evoker for `*_SUPPORT` events, else `NOBODY`.
    pub supporter: ActorId,
}

/// The event's source attacked its target and `absorber`'s `absorb_spell` prevented
/// `amount`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Absorbed {
    pub absorber: ActorId,
    pub absorb_spell: SpellId,
    pub amount: u64,
    pub supporter: ActorId,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Energize {
    pub power_type: i32,
    pub amount: f64,
    pub over_energize: f64,
}
