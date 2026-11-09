use std::fmt::Write;
use std::path::Path;
use std::time::Duration;

use openlogs_index::{
    CacheStatus, ChallengeMode, FightSummary, GameFlavor, LogIndex, Outcome, difficulty_label,
};

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
        "{}, log version {version}, build {}, advanced logging {}",
        GameFlavor::describe(index.flavor),
        index.build.as_deref().unwrap_or("unknown"),
        if index.advanced_logging { "on" } else { "off" }
    );
    if !index.broken_by_event.is_empty() {
        let events: Vec<String> = index
            .broken_by_event
            .iter()
            .map(|(event, count)| format!("{event} {}", thousands(*count)))
            .collect();
        let _ = writeln!(out, "Broken lines by event: {}", events.join(", "));
    }
    for warning in &index.warnings {
        let _ = writeln!(out, "warning: {warning}");
    }
    let _ = writeln!(out);
    let _ = writeln!(
        out,
        "{:>3}  {:<28} {:<10} {:<13} {:>9} {:>8} {:>7}  Start",
        "#", "Encounter", "Difficulty", "Result", "Duration", "Boss HP", "Players"
    );
    for fight in &index.fights {
        let _ = writeln!(out, "{}", fight_row(fight));
    }
    let runs: Vec<String> = index
        .fights
        .iter()
        .filter_map(|fight| Some(run_line(fight, fight.challenge.as_ref()?, &index.fights)))
        .collect();
    if !runs.is_empty() {
        let _ = writeln!(out);
        let _ = writeln!(out, "Mythic+ runs");
        for line in runs {
            let _ = writeln!(out, "{line}");
        }
    }
    out
}

fn fight_row(fight: &FightSummary) -> String {
    let (difficulty, result) = match &fight.challenge {
        Some(challenge) => (
            format!("+{}", challenge.keystone_level),
            run_result(fight.outcome),
        ),
        None if fight.is_combat() => ("Combat".to_string(), pull_result(fight.outcome)),
        None => (
            difficulty_label(fight.difficulty)
                .map_or_else(|| fight.difficulty.to_string(), str::to_string),
            pull_result(fight.outcome),
        ),
    };
    let enemies = match &fight.combat {
        Some(combat) if combat.enemy_count > 1 => format!(" +{}", combat.enemy_count - 1),
        _ => String::new(),
    };
    // Pulls of a Mythic+ run sit indented under their run.
    let name = match fight.run_index {
        Some(_) => format!("  {}{enemies}", fight.name),
        None => format!("{}{enemies}", fight.name),
    };
    let boss_hp = fight
        .boss_hp_percent
        .map_or_else(|| "-".to_string(), |hp| format!("{hp:.1}%"));
    let (hour, minute, second) = fight.start.time_of_day();
    format!(
        "{:>3}  {:<28} {:<10} {:<13} {:>9} {:>8} {:>7}  {hour:02}:{minute:02}:{second:02}",
        fight.index,
        name,
        difficulty,
        result,
        duration(fight.duration_ms),
        boss_hp,
        fight.roster.len()
    )
}

fn pull_result(outcome: Outcome) -> &'static str {
    match outcome {
        Outcome::Kill => "Kill",
        Outcome::Wipe => "Wipe",
        Outcome::Ended => "Ended",
        Outcome::Incomplete => "Incomplete",
    }
}

/// A run's result as the index reads it from the log (see `FightSummary::outcome`).
fn run_result(outcome: Outcome) -> &'static str {
    match outcome {
        Outcome::Kill => "Completed",
        Outcome::Wipe | Outcome::Ended => "Not completed",
        Outcome::Incomplete => "Incomplete",
    }
}

/// E.g. `  #1 Priory of the Sacred Flame +12: Completed in 10:00.0 (logged 10:00.0),
/// affixes 10, 147, 9, boss pulls 2, 3, 4`.
fn run_line(run: &FightSummary, challenge: &ChallengeMode, fights: &[FightSummary]) -> String {
    let list = |items: Vec<String>| {
        if items.is_empty() {
            "none".to_string()
        } else {
            items.join(", ")
        }
    };
    let logged = challenge
        .total_time_ms
        .map_or_else(String::new, |ms| format!(" (logged {})", duration(ms)));
    let affixes = list(challenge.affix_ids.iter().map(u32::to_string).collect());
    let pulls = list(
        fights
            .iter()
            .filter(|fight| fight.run_index == Some(run.index) && !fight.is_combat())
            .map(|fight| fight.index.to_string())
            .collect(),
    );
    format!(
        "  #{} {} +{}: {} in {}{logged}, affixes {affixes}, boss pulls {pulls}",
        run.index,
        run.name,
        challenge.keystone_level,
        run_result(run.outcome),
        duration(run.duration_ms)
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
pub(crate) fn thousands(n: u64) -> String {
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

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::time::Duration;

    use openlogs_index::index_bytes;

    use super::*;

    #[test]
    fn report_lists_runs_with_their_boss_pulls() {
        let log = include_str!("../../openlogs-index/tests/fixtures/mythic_plus.txt");
        let last_trash = log
            .lines()
            .find(|line| line.starts_with("10/8/2026 20:08:00.0000"))
            .unwrap();
        let second_knight = last_trash
            .replace("20:08:00.0000", "20:08:01.0000")
            .replace("0000468006", "0000468007");
        let log = log.replacen(
            last_trash,
            &format!(
                "{last_trash}
{second_knight}"
            ),
            1,
        );
        let index = index_bytes(log.as_bytes());
        let text = report(
            Path::new("Logs/mplus.txt"),
            8192,
            &index,
            Duration::from_millis(3),
            None,
        );
        let rows: Vec<&str> = text
            .lines()
            .filter(|line| line.trim_start().starts_with(|c: char| c.is_ascii_digit()))
            .collect();
        let words = |row: &str| row.split_whitespace().collect::<Vec<_>>().join(" ");
        assert_eq!(
            rows.iter().map(|row| words(row)).collect::<Vec<_>>(),
            [
                "1 Priory of the Sacred Flame +12 Completed 10:00.0 - 2 20:00:00",
                "2 Arathi Knight Combat Ended 0:00.0 - 1 20:00:10",
                "3 Captain Dailcry Mythic+ Kill 1:00.0 0.0% 2 20:01:00",
                "4 Arathi Knight Combat Ended 0:00.0 - 1 20:03:00",
                "5 Baron Braunpyke Mythic+ Wipe 0:30.0 87.5% 2 20:04:00",
                "6 Baron Braunpyke Mythic+ Kill 1:00.0 0.0% 2 20:06:00",
                "7 Arathi Knight +1 Combat Ended 0:01.0 - 1 20:08:00",
            ]
        );
        assert!(
            rows[4].starts_with("  5    Baron Braunpyke"),
            "boss pulls are indented under their run: {}",
            rows[4]
        );
        assert!(
            text.contains(
                "Completed in 10:00.0 (logged 10:00.0), affixes 10, 147, 9, boss pulls 3, 5, 6"
            ),
            "{text}"
        );
    }

    #[test]
    fn report_marks_combat_pulls() {
        let index = index_bytes(
            include_str!("../../openlogs-index/tests/fixtures/forever_open_world.txt").as_bytes(),
        );
        let text = report(
            Path::new("Logs/open_world.txt"),
            8192,
            &index,
            Duration::from_millis(3),
            None,
        );
        let row = text
            .lines()
            .find(|line| line.contains("Vile Fin Minor Oracle"))
            .expect("combat row");
        let words: Vec<&str> = row.split_whitespace().collect();
        assert!(
            words.contains(&"Combat") && words.contains(&"Kill"),
            "{row}"
        );
    }
}
