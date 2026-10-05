use std::fmt::Write;
use std::path::Path;
use std::time::Duration;

use openlogs_index::{CacheStatus, FightSummary, LogIndex, Outcome, difficulty_label};

/// Human-readable fight table for `openlogs-cli dump-fights`.
pub fn report(
    file: &Path,
    size: u64,
    index: &LogIndex,
    elapsed: Duration,
    cache: Option<CacheStatus>,
) -> String {
    let name = file.file_name().map_or_else(
        || file.display().to_string(),
        |n| n.to_string_lossy().into_owned(),
    );
    let cache = match cache {
        Some(CacheStatus::Hit) => ", from cache",
        Some(CacheStatus::Miss) => ", cached",
        Some(CacheStatus::Uncached) => ", cache not writable",
        None => "",
    };
    let version = index
        .log_version
        .map_or_else(|| "unknown".to_string(), |v| v.to_string());

    let mut out = String::new();
    let _ = writeln!(
        out,
        "{name}  ({}, {} lines, {} broken, indexed in {:.2} s{cache})",
        megabytes(size),
        thousands(index.line_count),
        thousands(index.broken_lines),
        elapsed.as_secs_f64()
    );
    let _ = writeln!(
        out,
        "Log version {version}, build {}, advanced logging {}",
        index.build.as_deref().unwrap_or("unknown"),
        if index.advanced_logging { "on" } else { "off" }
    );
    for warning in &index.warnings {
        let _ = writeln!(out, "warning: {warning}");
    }
    let _ = writeln!(out);
    let _ = writeln!(
        out,
        "{:>3}  {:<28} {:<10} {:<10} {:>9} {:>8} {:>7}  Start",
        "#", "Encounter", "Difficulty", "Result", "Duration", "Boss HP", "Players"
    );
    for fight in &index.fights {
        let _ = writeln!(out, "{}", fight_row(fight));
    }
    out
}

fn fight_row(fight: &FightSummary) -> String {
    let difficulty = difficulty_label(fight.difficulty)
        .map_or_else(|| fight.difficulty.to_string(), str::to_string);
    let result = match fight.outcome {
        Outcome::Kill => "Kill",
        Outcome::Wipe => "Wipe",
        Outcome::Incomplete => "Incomplete",
    };
    let boss_hp = fight
        .boss_hp_percent
        .map_or_else(|| "-".to_string(), |hp| format!("{hp:.1}%"));
    let (hour, minute, second) = fight.start.time_of_day();
    format!(
        "{:>3}  {:<28} {:<10} {:<10} {:>9} {:>8} {:>7}  {hour:02}:{minute:02}:{second:02}",
        fight.index,
        fight.name,
        difficulty,
        result,
        duration(fight.duration_ms),
        boss_hp,
        fight.roster.len()
    )
}

/// `m:ss.t`, e.g. `7:58.6`.
fn duration(ms: u64) -> String {
    format!(
        "{}:{:02}.{}",
        ms / 60_000,
        ms / 1_000 % 60,
        ms % 1_000 / 100
    )
}

/// Binary megabytes with one decimal, e.g. `219.7 MB`.
fn megabytes(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / 1_048_576.0)
}

/// `705319` → `705,319`.
fn thousands(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, digit) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}
