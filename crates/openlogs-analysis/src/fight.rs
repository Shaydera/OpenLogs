use std::collections::BTreeMap;

use openlogs_index::{MapBounds, Outcome};
pub use openlogs_parser::{AuraAction, AuraType, DamageVia};

use crate::actors::{ActorId, Actors, NOBODY};

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
    /// Power samples of the other units (bosses, adds), sorted by `t`.
    pub npc_power: Vec<PowerSample>,
    pub actors: Actors,
    /// Every spell referenced by `events`, with the name the log used.
    pub spells: BTreeMap<SpellId, SpellInfo>,
    pub broken_lines: u64,
    /// The boss encounters of a run in log order; empty for a boss pull.
    pub encounters: Vec<RunEncounter>,
    /// The texts of [`FailReason::Other`], in first-seen order.
    pub fail_reasons: Vec<String>,
    /// Where units were, sorted by `t`; samples without a known position are not kept.
    pub positions: Vec<PositionSample>,
    pub raid_markers: Vec<MarkerInterval>,
    pub world_markers: Vec<WorldMarkerInterval>,
    /// The map most position samples were logged on.
    pub ui_map_id: Option<u32>,
    /// Bounds of every map the log wrote before the end of the fight (latest wins), sorted by
    /// map ID; for a run only those written during it.
    pub map_bounds: Vec<MapBounds>,
    /// When a mechanic turned the logging player against the raid, as sorted, inclusive
    /// `(start_ms, end_ms)` spans. The log then shows enemies friendly and the raid hostile.
    pub logger_turned: Vec<(i32, i32)>,
    /// Who put a buff that grants heals on whom, as `(holder, t, granter)` sorted by holder and
    /// time, with granter [`NOBODY`] where one ended; see [`Fight::heal_granter`].
    pub heal_grants: Vec<(ActorId, i32, ActorId)>,
    /// What Refractive Images took of hits, as `(event index, amount)` sorted by index, on the
    /// line the hit counts on; see [`Fight::delayed_part`].
    pub delayed_hits: Vec<(u32, u64)>,
}

impl Fight {
    /// Whether the logging player was turned against the raid at `t`.
    pub fn logger_turned_at(&self, t: i32) -> bool {
        let next = self.logger_turned.partition_point(|&(start, _)| start <= t);
        next > 0 && self.logger_turned[next - 1].1 >= t
    }

    /// Who granted the heal `holder` logged at `t` as his own: the latest to buff him with it,
    /// unless that buff ended since.
    pub fn heal_granter(&self, holder: ActorId, t: i32) -> Option<ActorId> {
        let end = self
            .heal_grants
            .partition_point(|&(h, at, _)| (h, at) <= (holder, t));
        let &(h, _, granter) = self.heal_grants.get(end.checked_sub(1)?)?;
        (h == holder && granter != NOBODY).then_some(granter)
    }

    /// What a delaying absorb took of the hit at `index`.
    pub fn delayed_part(&self, index: usize) -> u64 {
        u32::try_from(index)
            .ok()
            .and_then(|index| {
                self.delayed_hits
                    .binary_search_by_key(&index, |&(hit, _)| hit)
                    .ok()
            })
            .map_or(0, |found| self.delayed_hits[found].1)
    }

    /// Whether the event's source stands against the raid at the event.
    pub fn source_against_raid(&self, event: &Event) -> bool {
        self.against_raid_at(event.source, event.source_logged_hostile, event.t)
    }

    /// Whether the event's target stands against the raid at the event.
    pub fn target_against_raid(&self, event: &Event) -> bool {
        self.against_raid_at(event.target, event.target_logged_hostile, event.t)
    }

    /// Whether `actor`, logged `hostile` on a line at `t`, stands against the raid. While the
    /// logging player is turned the log swaps the sides: an unowned NPC then counts by how it
    /// was logged over the pull, and players and their pets by the swapped flag.
    pub fn against_raid_at(&self, actor: ActorId, hostile: bool, t: i32) -> bool {
        if actor == NOBODY || !self.logger_turned_at(t) {
            return hostile;
        }
        if self.actors.is_unowned_npc(actor) {
            self.actors.is_enemy(actor)
        } else {
            !hostile
        }
    }

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

/// A unit's power is kept at most this often per power type.
pub const POWER_SAMPLE_MS: i32 = 500;

/// A unit's power from an advanced block.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PowerSample {
    pub t: i32,
    pub actor: ActorId,
    /// WoW power type (0 mana, 1 rage, 3 energy, …).
    pub power_type: i32,
    pub current: i64,
    pub max: i64,
    /// First entry of the advanced block's power list.
    pub primary: bool,
}

/// A unit's position from an advanced block, in log coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PositionSample {
    pub t: i32,
    pub actor: ActorId,
    pub x: f32,
    pub y: f32,
    pub facing: f32,
    pub ui_map_id: u32,
}

/// A raid target icon on a unit, from the first event showing it to the first later event
/// showing another icon or none.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MarkerInterval {
    pub actor: ActorId,
    /// 1..=8, the raid target icon index.
    pub marker: u8,
    pub start_ms: i32,
    pub end_ms: i32,
}

/// A ground marker placed in the world.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WorldMarkerInterval {
    pub marker: u8,
    pub x: f32,
    pub y: f32,
    pub start_ms: i32,
    pub end_ms: i32,
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
    /// Hostile reaction flag of source and target as this line logged them. Units can change
    /// reaction during a fight (adds turning neutral), so this, not the actor's latest flags,
    /// is the line's view; while the logging player is turned it shows the sides swapped, so
    /// whether a unit stands against the raid is [`Fight::source_against_raid`] and
    /// [`Fight::target_against_raid`].
    pub source_logged_hostile: bool,
    pub target_logged_hostile: bool,
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
    HealAbsorbed(HealAbsorbed),
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
    /// For a `SWING_DAMAGE_LANDED`: the index in [`Fight::events`] of the hit's attacker-side
    /// line, set by [`crate::pair_melee_lines`].
    pub attacker_line: Option<u32>,
    /// A swing whose `SWING_DAMAGE_LANDED` copy is logged after the pull's end.
    pub lands_after_end: bool,
}

impl Damage {
    /// A `SWING_DAMAGE_LANDED` the log has no attacker-side line for: it is the hit.
    pub(crate) fn is_landed_only(&self) -> bool {
        self.via == DamageVia::SwingLanded
            && self.supporter == NOBODY
            && self.attacker_line.is_none()
    }

    /// What a melee hit's swing and its landed copy both log: they may split the hit
    /// differently between `amount` and `absorbed`.
    pub(crate) fn melee_total(&self) -> u64 {
        self.amount + self.absorbed
    }
}

/// A melee hit's landed copy is logged at most this long before or after its swing.
pub const LANDED_MATCH_MS: i32 = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Missed {
    pub via: DamageVia,
    pub miss_type: MissType,
    /// Prevented amount for partial misses, else 0.
    pub amount_missed: u64,
    pub critical: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
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
    /// As logged; see [`Event::source_logged_hostile`].
    pub absorber_logged_hostile: bool,
    pub absorb_spell: SpellId,
    pub amount: u64,
    pub supporter: ActorId,
}

/// The event's spell, a heal absorb its source put on its target, took `amount` of `healer`'s
/// `heal_spell`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HealAbsorbed {
    pub healer: ActorId,
    pub heal_spell: SpellId,
    pub amount: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Energize {
    pub power_type: i32,
    pub amount: f64,
    pub over_energize: f64,
}
