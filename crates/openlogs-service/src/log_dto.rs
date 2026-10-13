use openlogs_analysis::{BossProgress, run_result};
use openlogs_gamedata::{DungeonTable, KeyTimer};
use openlogs_index::{FightSummary, LogIndex, Outcome, difficulty_label};
use openlogs_parser::Timestamp;
use serde::Serialize;

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

/// Bosses of the dungeon killed in a run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct BossProgressDto {
    pub killed: u32,
    pub total: u32,
}

impl From<BossProgress> for BossProgressDto {
    fn from(progress: BossProgress) -> Self {
        Self {
            killed: progress.killed,
            total: progress.total,
        }
    }
}

/// A completed key against its time limits: `{ "kind": "inTime", "upgrades": 2 }` or
/// `{ "kind": "overTime" }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TimerDto {
    InTime { upgrades: u32 },
    OverTime,
}

impl From<KeyTimer> for TimerDto {
    fn from(timer: KeyTimer) -> Self {
        match timer {
            KeyTimer::InTime { upgrades } => Self::InTime { upgrades },
            KeyTimer::OverTime => Self::OverTime,
        }
    }
}

/// Key details of a Mythic+ run row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDto {
    pub challenge_mode_id: u32,
    pub keystone_level: u32,
    /// Raw IDs until curated affix names exist.
    pub affix_ids: Vec<u32>,
    /// From `CHALLENGE_MODE_END`; `None` for incomplete runs.
    pub total_time_ms: Option<u64>,
    /// Bosses of the dungeon killed in the run; `None` without the dungeon's boss list.
    pub bosses: Option<BossProgressDto>,
    /// Only for a run the boss list shows completed, with a logged time.
    pub timer: Option<TimerDto>,
}

/// A boss pull or a whole Mythic+ run; both open the same way by `index`.
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
    /// Set when the row is a whole Mythic+ run; its boss pulls are rows of their own.
    pub run: Option<RunDto>,
    /// `index` of the run this boss pull belongs to.
    pub run_index: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogView {
    /// Identifies the log across sessions: its file name.
    pub id: String,
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

/// Zone-less log wall-clock time as Unix milliseconds (the UI formats it as UTC).
pub fn unix_ms(timestamp: Timestamp) -> i64 {
    timestamp.0.div_euclid(1_000)
}

/// A row of the pull list. A run's result comes from the dungeon data when `dungeons`
/// knows its boss list, otherwise from the index.
pub fn fight_row(
    fight: &FightSummary,
    fights: &[FightSummary],
    dungeons: Option<&DungeonTable>,
) -> FightRow {
    let result = run_result(fight, fights, dungeons);
    FightRow {
        index: fight.index,
        encounter_id: fight.encounter_id,
        name: fight.name.clone(),
        difficulty: fight.difficulty,
        difficulty_label: difficulty_label(fight.difficulty).map(str::to_string),
        outcome: result.outcome.into(),
        duration_ms: fight.duration_ms,
        boss_hp_percent: fight.boss_hp_percent,
        player_count: fight.roster.len() as u32,
        start_unix_ms: unix_ms(fight.start),
        zone: fight.zone.clone(),
        run: fight.challenge.as_ref().map(|challenge| RunDto {
            challenge_mode_id: challenge.challenge_mode_id,
            keystone_level: challenge.keystone_level,
            affix_ids: challenge.affix_ids.clone(),
            total_time_ms: challenge.total_time_ms,
            bosses: result.bosses.map(Into::into),
            timer: result.timer.map(Into::into),
        }),
        run_index: fight.run_index,
    }
}

pub const NOT_A_LOG_WARNING: &str = "This file does not look like a WoW combat log.";

pub fn log_view(
    id: &str,
    file_name: &str,
    size_bytes: u64,
    cache_hit: bool,
    index: &LogIndex,
    dungeons: Option<&DungeonTable>,
) -> LogView {
    let mut warnings = index.warnings.clone();
    if index.log_version.is_none() {
        warnings.push(NOT_A_LOG_WARNING.to_string());
    }
    let first = index.fights.first();
    LogView {
        id: id.to_string(),
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
        fights: index
            .fights
            .iter()
            .map(|fight| fight_row(fight, &index.fights, dungeons))
            .collect(),
    }
}
