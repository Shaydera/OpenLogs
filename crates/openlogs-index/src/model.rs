use std::collections::BTreeMap;

use openlogs_parser::Timestamp;
use serde::{Deserialize, Serialize};

/// Bumped whenever the index layout or its rules change; invalidates cached indexes.
pub const INDEX_FORMAT_VERSION: u32 = 8;
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

/// Difficulty ID of Mythic+ (Mythic Keystone) dungeons; run entries carry it too.
pub const MYTHIC_KEYSTONE_DIFFICULTY: u32 = 8;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LogIndex {
    pub format_version: u32,
    pub log_version: Option<u32>,
    pub build: Option<String>,
    pub advanced_logging: bool,
    pub line_count: u64,
    pub broken_lines: u64,
    /// Lines inside fights whose event the parser does not model, by event name.
    pub unhandled_in_fights: BTreeMap<String, u64>,
    pub warnings: Vec<String>,
    /// Boss pulls and Mythic+ runs, in the order of their start lines.
    pub fights: Vec<FightSummary>,
}

impl LogIndex {
    pub fn empty() -> Self {
        Self {
            format_version: INDEX_FORMAT_VERSION,
            log_version: None,
            build: None,
            advanced_logging: false,
            line_count: 0,
            broken_lines: 0,
            unhandled_in_fights: BTreeMap::new(),
            warnings: Vec::new(),
            fights: Vec::new(),
        }
    }
}

/// One boss pull, or a whole Mythic+ run when `challenge` is set. A run spans
/// `CHALLENGE_MODE_START` to `CHALLENGE_MODE_END`; it has encounter ID 0, the dungeon as
/// `name` and `zone`, difficulty [`MYTHIC_KEYSTONE_DIFFICULTY`], its roster size as
/// `group_size` and no boss HP. Its boss pulls are entries of their own with `run_index`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FightSummary {
    /// 1-based position of the start line in the file; a run comes before its boss pulls.
    pub index: u32,
    pub encounter_id: u32,
    pub name: String,
    pub difficulty: u32,
    pub group_size: u32,
    pub instance_id: u32,
    /// Zone of the last `ZONE_CHANGE` before `ENCOUNTER_START`, if any; a run's dungeon.
    pub zone: Option<String>,
    /// For a run: `Kill` = completed (`CHALLENGE_MODE_END` after a killed last boss pull),
    /// `Wipe` = not completed (any other end, or a logged time of 0), `Incomplete` = no
    /// end. The `success` flag decides only when no boss pull tells.
    pub outcome: Outcome,
    pub start: Timestamp,
    pub end: Timestamp,
    /// From `ENCOUNTER_END`, or end − start for incomplete fights and for every run.
    pub duration_ms: u64,
    /// First line within [`PRELUDE_MICROS`] before the start line.
    pub prelude_offset: u64,
    pub start_offset: u64,
    /// Just past the fight's last line.
    pub end_offset: u64,
    pub boss_hp_percent: Option<f32>,
    pub roster: Vec<RosterEntry>,
    pub broken_lines: u64,
    /// Key details when this entry is a whole Mythic+ run.
    pub challenge: Option<ChallengeMode>,
    /// `index` of the Mythic+ run this boss pull belongs to.
    pub run_index: Option<u32>,
    /// World markers active at the start line, sorted by marker; empty for runs.
    #[serde(default)]
    pub world_markers: Vec<WorldMarker>,
    /// Bounds of every map the log wrote before the start line (latest wins), sorted by
    /// map ID; empty for runs.
    #[serde(default)]
    pub map_bounds: Vec<MapBounds>,
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
    /// Whether this entry is a whole Mythic+ run rather than a boss pull.
    pub fn is_run(&self) -> bool {
        self.challenge.is_some()
    }
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
    /// No matching `ENCOUNTER_END` or `CHALLENGE_MODE_END` (crash, disconnect, log still
    /// being written).
    Incomplete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RosterEntry {
    pub guid: String,
    /// `None` if the player never appeared in a combat event during the fight.
    pub name: Option<String>,
    pub spec_id: u32,
}

/// Display name of a difficulty ID; `None` for unknown IDs, which are shown raw.
pub fn difficulty_label(id: u32) -> Option<&'static str> {
    match id {
        MYTHIC_KEYSTONE_DIFFICULTY => Some("Mythic+"),
        14 => Some("Normal"),
        15 => Some("Heroic"),
        // 233: Mythic with a flexible raid size, logged by Nymrissa Wavecaller.
        16 | 233 => Some("Mythic"),
        17 => Some("LFR"),
        _ => None,
    }
}
