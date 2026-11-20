use std::collections::{BTreeMap, BTreeSet};

use openlogs_parser::Timestamp;
use serde::{Deserialize, Serialize};

/// Bumped whenever the index layout or its rules change; invalidates cached indexes.
pub const INDEX_FORMAT_VERSION: u32 = 18;
/// The combat log format this tool is built and tested against.
pub const SUPPORTED_LOG_VERSION: u32 = 22;
/// Lookback before `ENCOUNTER_START` that belongs to a fight (pre-pots, pre-casts).
pub const PRELUDE_MICROS: i64 = 15_000_000;
/// Time after a run's `CHALLENGE_MODE_END` in which a boss pull still open may log its
/// `ENCOUNTER_END` and keep its result. Real logs put 1 to 425 ms before an `ENCOUNTER_END`.
pub const END_GRACE_MICROS: i64 = 1_000_000;
/// Lines after a run's `CHALLENGE_MODE_END`, within [`END_GRACE_MICROS`], in which a boss
/// pull still open may log its `ENCOUNTER_END`. Real logs hold up to 161 lines in 50 ms.
pub const END_GRACE_LINES: u32 = 200;
/// Longest time since a run's last line after which a repeated `CHALLENGE_MODE_START` of
/// its key still continues it (reconnect, /reload); a later one is a new key.
pub const RESUME_MAX_GAP_MICROS: i64 = 600_000_000;
/// Time after its last exchange of damage after which a combat pull has ended.
pub const COMBAT_QUIET_MICROS: i64 = 10_000_000;
/// Time after a boss pull's end in which exchanges with its hostile units that did not die are
/// trailing lines of it (a last hit, a DoT tick) and start no combat pull.
pub const BOSS_TAIL_MICROS: i64 = 1_000_000;
/// Time before `ENCOUNTER_START` in which a combat pull that fought only the boss pull's enemies
/// began with the boss pull's first hit, which the log often writes a few ms before the START.
pub const LEAD_MAX_MICROS: i64 = 1_000_000;
/// Time without a line naming a dead enemy after which it is forgotten, which bounds the dead
/// enemies kept. NPC GUIDs are per spawn, so a forgotten one rarely comes back.
pub const DEAD_ENEMY_MEMORY_MICROS: i64 = 60_000_000;

/// The game a log comes from, by the `PROJECT_ID` of its header. Only retail is fully
/// supported; the others are read with retail's rules.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GameFlavor {
    Retail,
    ClassicEra,
    Forever,
    Other(u32),
}

impl GameFlavor {
    pub fn from_project_id(id: u32) -> Self {
        match id {
            1 => Self::Retail,
            2 => Self::ClassicEra,
            18 => Self::Forever,
            other => Self::Other(other),
        }
    }

    pub fn name(self) -> String {
        match self {
            Self::Retail => "Retail".to_string(),
            Self::ClassicEra => "Classic Era".to_string(),
            Self::Forever => "Forever".to_string(),
            Self::Other(id) => format!("Project {id}"),
        }
    }

    /// [`Self::name`], or "Unknown game" for a header without a `PROJECT_ID`.
    pub fn describe(flavor: Option<Self>) -> String {
        flavor.map_or_else(|| "Unknown game".to_string(), Self::name)
    }

    /// A player's name as shown, from the logged `Name-Realm-Region`. A Forever name may itself
    /// contain `-` ("Ravel-Ashwood-Normal-EU" is "Ravel Ashwood"); elsewhere the first part.
    pub fn player_name(flavor: Option<Self>, logged: &str) -> String {
        let parts: Vec<&str> = logged.split('-').collect();
        match flavor {
            Some(Self::Forever) if parts.len() > 2 => parts[..parts.len() - 2].join(" "),
            _ => parts[0].to_string(),
        }
    }
}

/// Difficulty ID of Mythic+ (Mythic Keystone) dungeons; run entries carry it too.
pub const MYTHIC_KEYSTONE_DIFFICULTY: u32 = 8;
/// Difficulties whose visit is a dungeon run: Normal, Heroic, Mythic, Timewalking, Follower.
pub const DUNGEON_DIFFICULTIES: [u32; 5] = [1, 2, 23, 24, 205];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LogIndex {
    pub format_version: u32,
    pub log_version: Option<u32>,
    pub build: Option<String>,
    /// `None` for headers without a `PROJECT_ID`.
    pub flavor: Option<GameFlavor>,
    pub advanced_logging: bool,
    pub line_count: u64,
    /// Only lines the index parses: inside boss pulls, and meta, damage, miss and death events
    /// everywhere. Other lines outside boss pulls are skipped unread, so a layout break there
    /// goes unnoticed.
    pub broken_lines: u64,
    /// Broken lines by event name; lines without a readable name are only in `broken_lines`.
    pub broken_by_event: BTreeMap<String, u64>,
    /// Lines inside fights whose event the parser does not model, by event name.
    pub unhandled_in_fights: BTreeMap<String, u64>,
    pub warnings: Vec<String>,
    /// Boss pulls, combat pulls and runs, in the order of their start lines.
    pub fights: Vec<FightSummary>,
    /// `index` of the entries a later line may still change; only in a settled index of a log
    /// still being written: the open run, a left run and the entries after it that may join it.
    #[serde(default)]
    pub provisional: Vec<u32>,
}

impl LogIndex {
    pub fn empty() -> Self {
        Self {
            format_version: INDEX_FORMAT_VERSION,
            log_version: None,
            build: None,
            flavor: None,
            advanced_logging: false,
            line_count: 0,
            broken_lines: 0,
            broken_by_event: BTreeMap::new(),
            unhandled_in_fights: BTreeMap::new(),
            warnings: Vec::new(),
            fights: Vec::new(),
            provisional: Vec::new(),
        }
    }
}

/// One boss pull, a combat pull when `combat` is set, or a whole run when `run` is set.
/// A Mythic+ run spans `CHALLENGE_MODE_START` to `CHALLENGE_MODE_END`; it has encounter ID 0,
/// the dungeon as `name` and `zone`, difficulty [`MYTHIC_KEYSTONE_DIFFICULTY`], its roster size
/// as `group_size` and no boss HP. Its boss and combat pulls are entries of their own with
/// `run_index`.
///
/// A dungeon run is a visit of a dungeon difficulty ([`DUNGEON_DIFFICULTIES`]) with at least one
/// pull, from its `ZONE_CHANGE` to the last line before leaving. A later visit of the same
/// instance copy continues it, together with the pulls outside in between. It has the zone's
/// difficulty and is numbered by its first pull's start.
///
/// A combat pull is a fight outside boss encounters, from the first exchange of damage between
/// the group and an enemy NPC. It has encounter ID 0, the enemy that took the most damage from
/// the group as `name`, difficulty and instance of the latest `ZONE_CHANGE`, the number of the
/// group's players as `group_size`, no boss HP, and every player who fought an enemy NPC
/// meanwhile, outsiders included, in its roster.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FightSummary {
    /// 1-based position of the start line in the file; a run comes before its boss pulls.
    pub index: u32,
    pub encounter_id: u32,
    pub name: String,
    pub difficulty: u32,
    pub group_size: u32,
    pub instance_id: u32,
    /// Zone of the last `ZONE_CHANGE` before the start line, if any; a run's dungeon.
    pub zone: Option<String>,
    /// For a Mythic+ run: `Kill` = completed (`CHALLENGE_MODE_END` after a killed last boss
    /// pull), `Wipe` = not completed (any other end, or a logged time of 0), `Incomplete` = no
    /// end. The `success` flag decides only when no boss pull tells. For a dungeon run: `Ended`
    /// once left or ended by a key's start, `Incomplete` when the log ends inside.
    pub outcome: Outcome,
    pub start: Timestamp,
    pub end: Timestamp,
    /// From the start line to the `ENCOUNTER_END` line (its duration field can be a millisecond
    /// shorter), or end − start for incomplete fights and for every run.
    pub duration_ms: u64,
    /// First line within [`PRELUDE_MICROS`] before the start line.
    pub prelude_offset: u64,
    pub start_offset: u64,
    /// Just past the fight's last line.
    pub end_offset: u64,
    pub boss_hp_percent: Option<f32>,
    pub roster: Vec<RosterEntry>,
    pub broken_lines: u64,
    /// Set when this entry is a whole run: a Mythic+ key or a dungeon visit.
    pub run: Option<RunKind>,
    /// `index` of the run this boss or combat pull belongs to.
    pub run_index: Option<u32>,
    /// World markers active at the start line, sorted by marker; empty for runs.
    #[serde(default)]
    pub world_markers: Vec<WorldMarker>,
    /// Bounds of every map the log wrote before the start line (latest wins), sorted by
    /// map ID; empty for runs.
    #[serde(default)]
    pub map_bounds: Vec<MapBounds>,
    /// Set when this entry is a combat pull.
    pub combat: Option<CombatPull>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CombatPull {
    /// Enemy NPCs that traded damage or misses with the group.
    pub enemy_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WorldMarker {
    pub marker: u8,
    pub x: f32,
    pub y: f32,
}

/// World-coordinate extent of a UI map, from `MAP_CHANGE`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct MapBounds {
    pub ui_map_id: u32,
    pub min_x: f32,
    pub max_x: f32,
    pub min_y: f32,
    pub max_y: f32,
}

impl FightSummary {
    /// Whether this entry is a whole run rather than a pull.
    pub fn is_run(&self) -> bool {
        self.run.is_some()
    }

    /// Encounter IDs of the boss pulls killed in this run, among the index's `fights`.
    pub fn killed_encounters(&self, fights: &[FightSummary]) -> BTreeSet<u32> {
        fights
            .iter()
            .filter(|fight| {
                fight.run_index == Some(self.index)
                    && !fight.is_combat()
                    && fight.outcome == Outcome::Kill
            })
            .map(|fight| fight.encounter_id)
            .collect()
    }

    /// Key details when this entry is a Mythic+ run.
    pub fn keystone(&self) -> Option<&ChallengeMode> {
        match &self.run {
            Some(RunKind::Keystone(key)) => Some(key),
            _ => None,
        }
    }

    /// Whether this entry is a combat pull outside boss encounters.
    pub fn is_combat(&self) -> bool {
        self.combat.is_some()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RunKind {
    Keystone(ChallengeMode),
    Dungeon,
}

/// Key details of a Mythic+ run from `CHALLENGE_MODE_START` and `CHALLENGE_MODE_END`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChallengeMode {
    pub challenge_mode_id: u32,
    pub keystone_level: u32,
    pub affix_ids: Vec<u32>,
    /// Run time from `CHALLENGE_MODE_END`; `None` without an end.
    pub total_time_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Outcome {
    Kill,
    Wipe,
    /// No matching `ENCOUNTER_END` or `CHALLENGE_MODE_END`, or a combat pull still going on
    /// (crash, disconnect, log still being written).
    Incomplete,
    /// A combat pull that ended after quiet time.
    Ended,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RosterEntry {
    pub guid: String,
    /// `None` if the player never appeared in a combat event during the fight.
    pub name: Option<String>,
    pub spec_id: u32,
    /// `(node, rank)` of each talent; kept for Forever only, whose spec comes from them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub talents: Vec<(u32, u32)>,
}

/// Display name of a difficulty ID; `None` for unknown IDs, which are shown raw.
pub fn difficulty_label(id: u32) -> Option<&'static str> {
    match id {
        MYTHIC_KEYSTONE_DIFFICULTY => Some("Mythic+"),
        1 | 14 => Some("Normal"),
        2 | 15 => Some("Heroic"),
        // 233: Mythic with a flexible raid size, logged by Nymrissa Wavecaller.
        16 | 23 | 233 => Some("Mythic"),
        24 => Some("Timewalking"),
        205 => Some("Follower"),
        17 => Some("LFR"),
        _ => None,
    }
}
