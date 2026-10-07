use openlogs_index::{FightSummary, LogIndex, Outcome, difficulty_label};
use openlogs_parser::Timestamp;
use serde::Serialize;

use crate::recent::RecentEntry;

/// JSON shapes mirrored by `ui/src/api/types.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OutcomeDto {
    Kill,
    Wipe,
    Incomplete,
}

impl From<Outcome> for OutcomeDto {
    fn from(outcome: Outcome) -> Self {
        match outcome {
            Outcome::Kill => Self::Kill,
            Outcome::Wipe => Self::Wipe,
            Outcome::Incomplete => Self::Incomplete,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FightRow {
    pub index: u32,
    pub encounter_id: u32,
    pub name: String,
    pub difficulty: u32,
    pub difficulty_label: Option<String>,
    pub outcome: OutcomeDto,
    pub duration_ms: u64,
    pub boss_hp_percent: Option<f32>,
    pub player_count: u32,
    pub start_unix_ms: i64,
    pub zone: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogView {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub cache_hit: bool,
    pub log_version: Option<u32>,
    pub build: Option<String>,
    pub advanced_logging: bool,
    pub broken_lines: u64,
    pub warnings: Vec<String>,
    pub zone: Option<String>,
    pub start_unix_ms: Option<i64>,
    pub fights: Vec<FightRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentLog {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub zone: Option<String>,
    pub start_unix_ms: Option<i64>,
    pub pull_count: u32,
    pub opened_at_unix_ms: i64,
    pub exists: bool,
}

/// One downloaded game-data table in the Settings dialog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStatusDto {
    /// Entries of the table in use; `None` while the app has none.
    pub entries: Option<usize>,
    /// When the stored table was downloaded (a real instant, Unix ms).
    pub fetched_unix_ms: Option<i64>,
    /// Why the last download failed; `None` after a successful one.
    pub error: Option<String>,
}

/// The Settings dialog's game-data section.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDataStatusDto {
    pub spell_icons: TableStatusDto,
    pub boss_portraits: TableStatusDto,
    /// A sync (startup or "Refresh now") is running.
    pub refreshing: bool,
}

/// Zone-less log wall-clock time as Unix milliseconds (the UI formats it as UTC).
pub fn unix_ms(timestamp: Timestamp) -> i64 {
    timestamp.0.div_euclid(1_000)
}

pub fn fight_row(fight: &FightSummary) -> FightRow {
    FightRow {
        index: fight.index,
        encounter_id: fight.encounter_id,
        name: fight.name.clone(),
        difficulty: fight.difficulty,
        difficulty_label: difficulty_label(fight.difficulty).map(str::to_string),
        outcome: fight.outcome.into(),
        duration_ms: fight.duration_ms,
        boss_hp_percent: fight.boss_hp_percent,
        player_count: fight.roster.len() as u32,
        start_unix_ms: unix_ms(fight.start),
        zone: fight.zone.clone(),
    }
}

pub const NOT_A_LOG_WARNING: &str = "This file does not look like a WoW combat log.";

pub fn log_view(
    path: &str,
    file_name: &str,
    size_bytes: u64,
    cache_hit: bool,
    index: &LogIndex,
) -> LogView {
    let mut warnings = index.warnings.clone();
    if index.log_version.is_none() {
        warnings.push(NOT_A_LOG_WARNING.to_string());
    }
    let first = index.fights.first();
    LogView {
        path: path.to_string(),
        file_name: file_name.to_string(),
        size_bytes,
        cache_hit,
        log_version: index.log_version,
        build: index.build.clone(),
        advanced_logging: index.advanced_logging,
        broken_lines: index.broken_lines,
        warnings,
        zone: first.and_then(|fight| fight.zone.clone()),
        start_unix_ms: first.map(|fight| unix_ms(fight.start)),
        fights: index.fights.iter().map(fight_row).collect(),
    }
}

pub fn recent_log(entry: &RecentEntry, exists: bool) -> RecentLog {
    RecentLog {
        path: entry.path.clone(),
        file_name: entry.file_name.clone(),
        size_bytes: entry.size_bytes,
        zone: entry.zone.clone(),
        start_unix_ms: entry.start_unix_ms,
        pull_count: entry.pull_count,
        opened_at_unix_ms: entry.opened_at_unix_ms,
        exists,
    }
}
