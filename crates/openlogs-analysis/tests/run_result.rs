//! A run's result from the dungeon data: the synthetic +12 Priory of the Sacred Flame
//! against trimmed real wago.tools exports (Priory: Captain Dailcry, Baron Braunpyke,
//! Prioress Murrpray; limits 1950/1560/1170 s).

use openlogs_analysis::{BossProgress, RunResult, run_result};
use openlogs_gamedata::{DungeonTable, KeyTimer};
use openlogs_index::{LogIndex, Outcome, index_bytes};

/// Captain Dailcry (kill), Baron Braunpyke (wipe, then kill), trash, then
/// `CHALLENGE_MODE_END` at 20:10 with success 1 and 600000 ms; Prioress Murrpray is never
/// pulled.
const FIXTURE: &str = include_str!("../../openlogs-index/tests/fixtures/mythic_plus.txt");
const END: &str = "10/8/2026 20:10:00.0000  CHALLENGE_MODE_END";
const START: &str = "10/8/2026 20:00:00.0000  CHALLENGE_MODE_START";

fn table() -> DungeonTable {
    DungeonTable::from_csv(
        include_bytes!("../../openlogs-gamedata/tests/fixtures/MapChallengeMode.csv"),
        include_bytes!("../../openlogs-gamedata/tests/fixtures/DungeonEncounter.csv"),
    )
    .unwrap()
}

/// The fixture's lines; `edit` may change them before they are joined into a log.
fn log_with(edit: impl FnOnce(&mut Vec<String>)) -> LogIndex {
    let mut lines: Vec<String> = FIXTURE.lines().map(str::to_string).collect();
    edit(&mut lines);
    let text: String = lines.iter().map(|line| format!("{line}\n")).collect();
    index_bytes(text.as_bytes())
}

fn position(lines: &[String], prefix: &str) -> usize {
    lines
        .iter()
        .position(|line| line.starts_with(prefix))
        .unwrap_or_else(|| panic!("no line {prefix:?}"))
}

/// Prioress Murrpray killed at 20:09, before the run's end.
fn kill_prioress(lines: &mut Vec<String>) {
    let end = position(lines, END);
    lines.insert(
        end,
        "10/8/2026 20:09:50.0000  ENCOUNTER_END,2848,\"Prioress Murrpray\",8,5,1,50000".into(),
    );
    lines.insert(
        end,
        "10/8/2026 20:09:00.0000  ENCOUNTER_START,2848,\"Prioress Murrpray\",8,5,2649".into(),
    );
}

fn set_end(lines: &mut [String], fields: &str) {
    let end = position(lines, END);
    lines[end] = format!("{END},{fields}");
}

fn result(index: &LogIndex, dungeons: Option<&DungeonTable>) -> RunResult {
    run_result(&index.fights[0], &index.fights, dungeons)
}

fn bosses(killed: u32) -> Option<BossProgress> {
    Some(BossProgress { killed, total: 3 })
}

#[test]
fn a_key_ended_after_a_mid_dungeon_kill_is_not_completed() {
    let index = log_with(|_| {});
    assert_eq!(
        index.fights[0].outcome,
        Outcome::Kill,
        "the index trusts the logged success flag"
    );
    assert_eq!(
        result(&index, Some(&table())),
        RunResult {
            outcome: Outcome::Wipe,
            bosses: bosses(2),
            timer: None,
        }
    );
}

#[test]
fn a_key_with_every_boss_killed_is_completed_with_its_timer() {
    let table = table();
    for (total_ms, timer) in [
        (600_000, KeyTimer::InTime { upgrades: 3 }),
        (1_950_000, KeyTimer::InTime { upgrades: 1 }),
        (1_950_001, KeyTimer::OverTime),
    ] {
        let index = log_with(|lines| {
            kill_prioress(lines);
            set_end(lines, &format!("2649,1,12,{total_ms}"));
        });
        assert_eq!(
            result(&index, Some(&table)),
            RunResult {
                outcome: Outcome::Kill,
                bosses: bosses(3),
                timer: Some(timer),
            },
            "{total_ms} ms"
        );
    }
}

#[test]
fn a_logged_time_of_zero_is_not_completed_even_with_every_boss_killed() {
    let index = log_with(|lines| {
        kill_prioress(lines);
        set_end(lines, "2649,0,12,0");
    });
    assert_eq!(
        result(&index, Some(&table())),
        RunResult {
            outcome: Outcome::Wipe,
            bosses: bosses(3),
            timer: None,
        }
    );
}

#[test]
fn without_a_boss_list_the_index_result_stays() {
    let table = table();
    let unchanged = RunResult {
        outcome: Outcome::Kill,
        bosses: None,
        timer: None,
    };
    let index = log_with(|_| {});
    assert_eq!(result(&index, None), unchanged, "no dungeon data");
    for key in [9999, 463, 353] {
        let index = log_with(|lines| {
            let start = position(lines, START);
            lines[start] =
                format!("{START},\"Priory of the Sacred Flame\",2649,{key},12,[10,147,9]");
        });
        assert_eq!(result(&index, Some(&table)), unchanged, "key {key}");
    }
}
