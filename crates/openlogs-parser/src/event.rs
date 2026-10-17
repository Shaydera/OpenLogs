//! Typed view of one combat log line. All strings borrow from the line.

use crate::Timestamp;

/// GUID WoW writes for an empty unit slot (e.g. the source of environmental damage).
pub const NULL_GUID: &str = "0000000000000000";

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LogLine<'a> {
    pub timestamp: Timestamp,
    pub event: Event<'a>,
}

// Events are short-lived stack values on the per-line hot path; boxing the large combat
// variant would cost one heap allocation per line.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Event<'a> {
    CombatLogVersion {
        version: u32,
        advanced: bool,
        build: &'a str,
    },
    ZoneChange {
        zone_id: u32,
        name: &'a str,
        difficulty: u32,
    },
    WorldMarkerPlaced {
        instance_id: u32,
        marker: u8,
        x: f32,
        y: f32,
    },
    WorldMarkerRemoved {
        marker: u8,
    },
    EncounterStart(EncounterStart<'a>),
    EncounterEnd(EncounterEnd<'a>),
    ChallengeModeStart(ChallengeModeStart<'a>),
    ChallengeModeEnd(ChallengeModeEnd),
    CombatantInfo(CombatantInfo<'a>),
    Combat(CombatEvent<'a>),
    /// A well-formed line whose event the parser does not model (emotes, stagger, …).
    Unhandled {
        name: &'a str,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncounterStart<'a> {
    pub encounter_id: u32,
    pub name: &'a str,
    pub difficulty: u32,
    pub group_size: u32,
    pub instance_id: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncounterEnd<'a> {
    pub encounter_id: u32,
    pub name: &'a str,
    pub difficulty: u32,
    pub group_size: u32,
    pub success: bool,
    pub duration_ms: u32,
}

/// Start of a Mythic+ run:
/// `CHALLENGE_MODE_START,"Zone",instanceID,challengeModeID,keystoneLevel,[affixIDs]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChallengeModeStart<'a> {
    pub zone_name: &'a str,
    pub instance_id: u32,
    pub challenge_mode_id: u32,
    pub keystone_level: u32,
    /// The affix list as logged, e.g. `[10,147,9]`; empty when the line has none.
    pub affixes: &'a str,
}

impl ChallengeModeStart<'_> {
    /// Affix IDs in log order; entries that are not numbers are skipped.
    pub fn affix_ids(&self) -> Vec<u32> {
        self.affixes
            .trim_start_matches('[')
            .trim_end_matches(']')
            .split(',')
            .filter_map(|id| id.trim().parse().ok())
            .collect()
    }
}

/// End of a Mythic+ run: `CHALLENGE_MODE_END,instanceID,success,keystoneLevel,totalTimeMs`.
/// Newer patches append more fields; they are ignored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChallengeModeEnd {
    pub instance_id: u32,
    pub success: bool,
    pub keystone_level: u32,
    pub total_time_ms: u64,
}

/// Player snapshot written right after `ENCOUNTER_START`. Talents and gear are not
/// modelled yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CombatantInfo<'a> {
    pub guid: &'a str,
    pub faction: u32,
    pub spec_id: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Unit<'a> {
    pub guid: &'a str,
    /// `None` when the log writes `nil`.
    pub name: Option<&'a str>,
    pub flags: u32,
    pub raid_flags: u32,
}

impl Unit<'_> {
    pub fn is_empty(&self) -> bool {
        self.guid == NULL_GUID
    }

    pub fn is_player(&self) -> bool {
        self.guid.starts_with("Player-")
    }

    /// `COMBATLOG_OBJECT_REACTION_HOSTILE`.
    pub fn is_hostile(&self) -> bool {
        self.flags & 0x40 != 0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Spell<'a> {
    pub id: u32,
    pub name: &'a str,
    pub school: u32,
}

/// The 19-field advanced logging block. It describes `info_guid`, which is the source
/// for some events and the target for others, so always compare GUIDs.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AdvancedInfo<'a> {
    pub info_guid: &'a str,
    /// Owner of a pet or guardian; `None` for everything else.
    pub owner_guid: Option<&'a str>,
    pub current_hp: u64,
    pub max_hp: u64,
    /// `|`-separated lists with one entry per power the unit has (e.g. `9|0`).
    pub power_types: &'a str,
    pub current_powers: &'a str,
    pub max_powers: &'a str,
    pub x: f32,
    pub y: f32,
    pub ui_map_id: u32,
    pub facing: f32,
    /// Item level for players, unit level for NPCs.
    pub level: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Power {
    pub power_type: i32,
    pub current: i64,
    pub max: i64,
}

impl<'a> AdvancedInfo<'a> {
    /// Powers of the unit; entries that fail to parse are skipped.
    pub fn powers(&self) -> impl Iterator<Item = Power> + 'a {
        let (types, currents, maxes) = (self.power_types, self.current_powers, self.max_powers);
        types
            .split('|')
            .zip(currents.split('|'))
            .zip(maxes.split('|'))
            .filter_map(|((power_type, current), max)| {
                Some(Power {
                    power_type: power_type.parse().ok()?,
                    current: current.parse().ok()?,
                    max: max.parse().ok()?,
                })
            })
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CombatEvent<'a> {
    /// Raw subevent name, e.g. `SPELL_PERIODIC_DAMAGE_SUPPORT`.
    pub name: &'a str,
    pub source: Unit<'a>,
    pub target: Unit<'a>,
    /// The spell prefix; `None` for melee swings, environmental damage and deaths.
    /// For `SPELL_ABSORBED` it is the attacking spell, if any.
    pub spell: Option<Spell<'a>>,
    pub advanced: Option<AdvancedInfo<'a>>,
    pub kind: CombatKind<'a>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CombatKind<'a> {
    Damage(Damage<'a>),
    Missed(Missed<'a>),
    Heal(Heal<'a>),
    Absorbed(Absorbed<'a>),
    Energize(Energize),
    CastStart,
    CastSuccess,
    CastFailed {
        reason: &'a str,
    },
    Aura(AuraChange<'a>),
    Interrupt {
        interrupted: Spell<'a>,
    },
    Dispel {
        removed: Spell<'a>,
        aura_type: AuraType,
    },
    Stolen {
        removed: Spell<'a>,
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
    UnitDied {
        unconscious: bool,
    },
    UnitDestroyed,
    PartyKill,
}

/// How damage was dealt. `Swing` and `SwingLanded` describe the same melee hit from the
/// attacker's and the victim's side, so count only one of them. Augmentation support for
/// melee exists only as `SWING_DAMAGE_LANDED_SUPPORT`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DamageVia {
    Swing,
    SwingLanded,
    Range,
    Spell,
    Periodic,
    Building,
    Environmental,
    Split,
    Shield,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Damage<'a> {
    pub via: DamageVia,
    /// `Falling`, `Lava`, … for environmental damage.
    pub environmental_type: Option<&'a str>,
    pub amount: u64,
    pub base_amount: u64,
    pub overkill: u64,
    pub school: u32,
    pub resisted: u64,
    pub blocked: u64,
    pub absorbed: u64,
    pub critical: bool,
    pub glancing: bool,
    pub crushing: bool,
    /// Augmentation Evoker GUID on `*_SUPPORT` events. `amount` is then the Evoker's
    /// share of a hit that the source has already logged in full.
    pub supporter: Option<&'a str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Missed<'a> {
    pub via: DamageVia,
    /// `ABSORB`, `PARRY`, `IMMUNE`, …
    pub miss_type: &'a str,
    pub offhand: bool,
    /// Present for partial misses (`ABSORB`, `BLOCK`, `RESIST`).
    pub amount_missed: Option<u64>,
    pub critical: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealVia {
    Direct,
    Periodic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Heal<'a> {
    pub via: HealVia,
    pub amount: u64,
    pub base_amount: u64,
    pub overheal: u64,
    pub absorbed: u64,
    pub critical: bool,
    /// Augmentation Evoker GUID on `*_SUPPORT` events.
    pub supporter: Option<&'a str>,
}

/// `SPELL_ABSORBED[_SUPPORT]`: the event's source attacked its target, and the
/// `absorber`'s `absorb_spell` prevented `amount`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Absorbed<'a> {
    pub absorber: Unit<'a>,
    pub absorb_spell: Spell<'a>,
    pub amount: u64,
    pub critical: bool,
    pub supporter: Option<&'a str>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Energize {
    pub periodic: bool,
    pub amount: f64,
    pub over_energize: f64,
    pub power_type: i32,
    pub max_power: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuraType {
    Buff,
    Debuff,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuraAction {
    Applied,
    Removed,
    Refresh,
    AppliedDose,
    RemovedDose,
    Broken,
    BrokenSpell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuraChange<'a> {
    pub action: AuraAction,
    pub aura_type: AuraType,
    /// New stack count for `AppliedDose` / `RemovedDose`.
    pub stacks: Option<u32>,
    /// The spell that broke the aura for `BrokenSpell`.
    pub broken_by: Option<Spell<'a>>,
}
