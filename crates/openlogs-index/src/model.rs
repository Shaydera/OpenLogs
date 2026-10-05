use std::collections::BTreeMap;

use openlogs_parser::Timestamp;
use serde::{Deserialize, Serialize};

/// Bumped whenever the index layout or its rules change; invalidates cached indexes.
pub const INDEX_FORMAT_VERSION: u32 = 5;
/// The combat log format this tool is built and tested against.
pub const SUPPORTED_LOG_VERSION: u32 = 22;
/// Lookback before `ENCOUNTER_START` that belongs to a fight (pre-pots, pre-casts).
pub const PRELUDE_MICROS: i64 = 15_000_000;

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FightSummary {
    /// 1-based position in the file.
    pub index: u32,
    pub encounter_id: u32,
    pub name: String,
    pub difficulty: u32,
    pub group_size: u32,
    pub instance_id: u32,
    /// Zone of the last `ZONE_CHANGE` before `ENCOUNTER_START`, if any.
    pub zone: Option<String>,
    pub outcome: Outcome,
    pub start: Timestamp,
    pub end: Timestamp,
    /// From `ENCOUNTER_END`, or end − start for incomplete fights.
    pub duration_ms: u64,
    /// First line within [`PRELUDE_MICROS`] before `ENCOUNTER_START`.
    pub prelude_offset: u64,
    pub start_offset: u64,
    /// Just past the fight's last line.
    pub end_offset: u64,
    pub boss_hp_percent: Option<f32>,
    pub roster: Vec<RosterEntry>,
    pub broken_lines: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Outcome {
    Kill,
    Wipe,
    /// No matching `ENCOUNTER_END` (crash, disconnect, log still being written).
    Incomplete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RosterEntry {
    pub guid: String,
    /// `None` if the player never appeared in a combat event during the fight.
    pub name: Option<String>,
    pub spec_id: u32,
}

/// Display name of a raid difficulty ID; `None` for unknown IDs, which are shown raw.
pub fn difficulty_label(id: u32) -> Option<&'static str> {
    match id {
        14 => Some("Normal"),
        15 => Some("Heroic"),
        // 233: Mythic with a flexible raid size, logged by Nymrissa Wavecaller.
        16 | 233 => Some("Mythic"),
        17 => Some("LFR"),
        _ => None,
    }
}
