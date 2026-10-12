//! Mythic+ rules for what the log leaves open: what `success` in `CHALLENGE_MODE_END`
//! means, whether a reconnect or /reload writes `CHALLENGE_MODE_START` again, and whether
//! the run's end can come before the last `ENCOUNTER_END` of the same moment.

use openlogs_index::{END_GRACE_LINES, LogIndex, Outcome, index_bytes};
use openlogs_parser::Timestamp;

/// A +12 Priory of the Sacred Flame: Captain Dailcry (kill), Baron Braunpyke (wipe, then
/// kill), trash, `CHALLENGE_MODE_END` at 20:10 with success 1 and 600000 ms.
const FIXTURE: &str = include_str!("fixtures/mythic_plus.txt");
/// The fixture with the key started again at 20:03:30 (between boss pulls) and at 20:04:15
/// (inside the Baron wipe), each time after the log header and the zone, as a reconnect or
/// /reload may write it.
const RECONNECT: &str = include_str!("fixtures/mythic_plus_reconnect.txt");
/// The fixture with the Baron wipe ended while offline (no `ENCOUNTER_END`), then the
/// reconnect at 20:05:00 (header, zone, START) and trash at 20:05:30.
const OFFLINE_WIPE: &str = include_str!("fixtures/mythic_plus_offline_wipe.txt");
/// The fixture with the run's end at 20:07:00, logged before the boss's death and the
/// Baron kill of the same moment; the group leaves at 20:12.
const END_FIRST: &str = include_str!("fixtures/mythic_plus_end_first.txt");
/// (index, is run, outcome, run index) of the fixture's entries.
const FIXTURE_ROWS: [(u32, bool, Outcome, Option<u32>); 4] = [
    (1, true, Outcome::Kill, None),
    (2, false, Outcome::Kill, Some(1)),
    (3, false, Outcome::Wipe, Some(1)),
    (4, false, Outcome::Kill, Some(1)),
];
const END: &str = "10/8/2026 20:10:00.0000  CHALLENGE_MODE_END";
const LAST_KILL: &str = "10/8/2026 20:07:00.0000  ENCOUNTER_END";

fn ts(text: &str) -> Timestamp {
    Timestamp::parse(text).unwrap()
}

/// (index, is run, outcome, run index) per entry.
fn rows(index: &LogIndex) -> Vec<(u32, bool, Outcome, Option<u32>)> {
    index
        .fights
        .iter()
        .map(|f| (f.index, f.is_run(), f.outcome, f.run_index))
        .collect()
}

/// The fixture's lines without their line breaks (the checkout may use CRLF).
fn fixture_lines() -> Vec<String> {
    FIXTURE.lines().map(str::to_string).collect()
}

fn line_at(lines: &[String], prefix: &str) -> usize {
    lines
        .iter()
        .position(|line| line.starts_with(prefix))
        .unwrap_or_else(|| panic!("no line {prefix:?}"))
}

fn log(lines: &[String]) -> String {
    lines.iter().map(|line| format!("{line}\n")).collect()
}

/// The fixture with the fields of its `CHALLENGE_MODE_END` replaced.
fn with_end(fields: &str) -> String {
    let mut lines = fixture_lines();
    let end = line_at(&lines, END);
    lines[end] = format!("{END},{fields}");
    log(&lines)
}

fn key_start(ts: &str, level: u32) -> String {
    format!(
        "{ts}  CHALLENGE_MODE_START,\"Priory of the Sacred Flame\",2649,499,{level},[10,147,9]\n"
    )
}

fn key_end(ts: &str, success: u8, total_ms: u64) -> String {
    format!("{ts}  CHALLENGE_MODE_END,2649,{success},12,{total_ms}\n")
}

fn boss_start(ts: &str, id: u32, name: &str) -> String {
    format!("{ts}  ENCOUNTER_START,{id},\"{name}\",8,5,2649\n")
}

fn boss_end(ts: &str, id: u32, name: &str, success: u8, ms: u32) -> String {
    format!("{ts}  ENCOUNTER_END,{id},\"{name}\",8,5,{success},{ms}\n")
}

fn died(ts: &str) -> String {
    format!(
        "{ts}  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,Player-4101-8E8C0182,\"Faelan-Emberfall-EU\",0x512,0x80000000,0\n"
    )
}

/// A key whose run ends at 20:02:00 while Captain Dailcry is pulled, then `between`, then
/// the kill's `ENCOUNTER_END` at `kill_ts`.
fn end_before_kill(between: &[String], kill_ts: &str) -> String {
    let mut lines = vec![
        key_start("10/8/2026 20:00:00.0000", 12),
        boss_start("10/8/2026 20:01:00.0000", 2847, "Captain Dailcry"),
        died("10/8/2026 20:01:30.0000"),
        key_end("10/8/2026 20:02:00.0000", 1, 120_000),
    ];
    lines.extend_from_slice(between);
    lines.push(boss_end(kill_ts, 2847, "Captain Dailcry", 1, 60_000));
    lines.concat()
}

/// A key from 20:00 to 20:10 with `between` in between and the given end fields.
fn key(between: &[String], success: u8, total_ms: u64) -> String {
    let mut lines = vec![key_start("10/8/2026 20:00:00.0000", 12)];
    lines.extend_from_slice(between);
    lines.push(key_end("10/8/2026 20:10:00.0000", success, total_ms));
    lines.concat()
}

#[test]
fn a_run_result_follows_its_logged_time_then_its_last_boss_pull_then_its_success_flag() {
    let last_pull_wiped = |flag: u8| {
        let mut lines = fixture_lines();
        let kill = line_at(&lines, LAST_KILL);
        lines[kill] = format!("{LAST_KILL},2835,\"Baron Braunpyke\",8,5,0,60000");
        let end = line_at(&lines, END);
        lines[end] = format!("{END},2649,{flag},12,600000");
        log(&lines)
    };
    let unfinished_pull = [
        boss_start("10/8/2026 20:01:00.0000", 2847, "Captain Dailcry"),
        died("10/8/2026 20:01:30.0000"),
    ];
    for (case, data, outcome, total_ms) in [
        (
            "last pull killed, flag 0",
            with_end("2649,0,12,600000,312.5,2645.0"),
            Outcome::Kill,
            600_000,
        ),
        (
            "last pull killed, flag 1",
            with_end("2649,1,12,600000,312.5,2645.0"),
            Outcome::Kill,
            600_000,
        ),
        (
            "last pull wiped, flag 0",
            last_pull_wiped(0),
            Outcome::Wipe,
            600_000,
        ),
        (
            "last pull wiped, flag 1",
            last_pull_wiped(1),
            Outcome::Wipe,
            600_000,
        ),
        ("logged time 0", with_end("2649,1,12,0"), Outcome::Wipe, 0),
        (
            "no pulls, flag 1",
            key(&[], 1, 600_123),
            Outcome::Kill,
            600_123,
        ),
        (
            "no pulls, flag 0",
            key(&[], 0, 600_123),
            Outcome::Wipe,
            600_123,
        ),
        ("no pulls, logged time 0", key(&[], 1, 0), Outcome::Wipe, 0),
        (
            "last pull unfinished, flag 1",
            key(&unfinished_pull, 1, 600_123),
            Outcome::Kill,
            600_123,
        ),
        (
            "last pull unfinished, flag 0",
            key(&unfinished_pull, 0, 600_123),
            Outcome::Wipe,
            600_123,
        ),
    ] {
        let index = index_bytes(data.as_bytes());
        let run = &index.fights[0];
        assert_eq!(
            (
                run.outcome,
                run.challenge.as_ref().unwrap().total_time_ms,
                run.duration_ms
            ),
            (outcome, Some(total_ms), 600_000),
            "{case}"
        );
    }
}

#[test]
fn a_repeated_start_of_the_same_key_continues_the_run_and_its_open_pull() {
    let original = index_bytes(FIXTURE.as_bytes());
    let index = index_bytes(RECONNECT.as_bytes());
    assert!(index.warnings.is_empty(), "{:?}", index.warnings);
    assert_eq!(rows(&index), FIXTURE_ROWS);
    let (run, before) = (&index.fights[0], &original.fights[0]);
    assert_eq!(
        (run.start, run.end, run.duration_ms),
        (before.start, before.end, before.duration_ms)
    );
    assert_eq!(
        (&run.challenge, &run.roster),
        (&before.challenge, &before.roster)
    );
    let offset = |prefix: &str| RECONNECT.find(prefix).unwrap() as u64;
    assert_eq!(
        (run.prelude_offset, run.start_offset, run.end_offset),
        (
            offset("10/8/2026 19:59:50.0000"),
            offset("10/8/2026 20:00:00.0000  CHALLENGE_MODE_START"),
            offset("10/8/2026 20:15:00.0000")
        )
    );

    let wipe = &index.fights[2];
    assert_eq!(
        (wipe.name.as_str(), wipe.outcome, wipe.duration_ms, wipe.end),
        (
            "Baron Braunpyke",
            Outcome::Wipe,
            30_000,
            ts("10/8/2026 20:04:30.0000")
        )
    );
    assert!((wipe.boss_hp_percent.unwrap() - 87.5).abs() < 0.01);
    assert_eq!(wipe.roster.len(), 2);
    assert_eq!(
        wipe.end_offset,
        offset("10/8/2026 20:06:00.0000  ENCOUNTER_START")
    );
}

#[test]
fn another_key_or_the_same_key_after_ten_minutes_starts_a_new_run() {
    // The run's last line is at 20:01:30; RESUME_MAX_GAP_MICROS is 10 minutes.
    let other_dungeon = "10/8/2026 20:30:00.0000  CHALLENGE_MODE_START,\"Cinderbrew Meadery\",2661,506,12,[10,147,9]\n";
    for (next, new_run) in [
        (key_start("10/8/2026 20:30:00.0000", 13), true),
        (other_dungeon.to_string(), true),
        (key_start("10/8/2026 20:11:30.0000", 12), false),
        (key_start("10/8/2026 20:11:30.0001", 12), true),
    ] {
        let data = [
            key_start("10/8/2026 20:00:00.0000", 12),
            boss_start("10/8/2026 20:01:00.0000", 2847, "Captain Dailcry"),
            died("10/8/2026 20:01:30.0000"),
            next.clone(),
        ]
        .concat();
        let index = index_bytes(data.as_bytes());
        let mut expected = vec![
            (1, true, Outcome::Incomplete, None),
            (2, false, Outcome::Incomplete, Some(1)),
        ];
        let (run, pull) = (&index.fights[0], &index.fights[1]);
        if new_run {
            expected.push((3, true, Outcome::Incomplete, None));
            let next_offset = data.find(&next).unwrap() as u64;
            assert_eq!(run.end, ts("10/8/2026 20:01:30.0000"), "{next}");
            assert_eq!(
                (run.end_offset, pull.end_offset),
                (next_offset, next_offset),
                "{next}"
            );
        } else {
            assert_eq!(run.end_offset, data.len() as u64, "{next}");
        }
        assert_eq!(rows(&index), expected, "{next}");
    }
}

#[test]
fn the_same_key_after_its_end_starts_a_new_run() {
    let data = [
        key_start("10/8/2026 20:00:00.0000", 12),
        key_end("10/8/2026 20:10:00.0000", 1, 600_000),
        key_start("10/8/2026 20:12:00.0000", 12),
    ]
    .concat();
    assert_eq!(
        rows(&index_bytes(data.as_bytes())),
        [
            (1, true, Outcome::Kill, None),
            (2, true, Outcome::Incomplete, None),
        ]
    );
}

#[test]
fn the_last_pull_keeps_its_kill_when_its_end_follows_the_run_end_in_the_same_moment() {
    let index = index_bytes(END_FIRST.as_bytes());
    assert_eq!(rows(&index), FIXTURE_ROWS);
    let (run, kill) = (&index.fights[0], &index.fights[3]);
    assert_eq!(
        (kill.duration_ms, kill.boss_hp_percent, kill.end),
        (60_000, Some(0.0), ts("10/8/2026 20:07:00.0000"))
    );
    assert_eq!(
        (
            run.end,
            run.duration_ms,
            run.challenge.as_ref().unwrap().total_time_ms
        ),
        (ts("10/8/2026 20:07:00.0000"), 420_000, Some(420_000))
    );
    let leave = END_FIRST.find("10/8/2026 20:12:00.0000").unwrap() as u64;
    assert_eq!((kill.end_offset, run.end_offset), (leave, leave));
}

#[test]
fn the_pull_keeps_its_kill_when_its_end_comes_within_the_grace_after_the_run_end() {
    let other_encounter_end = boss_end(
        "10/8/2026 20:02:00.0000",
        2848,
        "Prioress Murrpray",
        1,
        1_000,
    );
    let mut most_lines = vec![other_encounter_end];
    most_lines.extend((2..END_GRACE_LINES).map(|_| died("10/8/2026 20:02:00.0000")));
    let deaths_every_30_ms: Vec<String> = (1..=25)
        .map(|i| died(&format!("10/8/2026 20:02:00.{:04}", i * 300)))
        .collect();
    for (between, kill_ts) in [
        (&[][..], "10/8/2026 20:02:00.0010"),
        (&[], "10/8/2026 20:02:00.2500"),
        (&[], "10/8/2026 20:02:01.0000"),
        (&deaths_every_30_ms, "10/8/2026 20:02:00.8000"),
        (&most_lines, "10/8/2026 20:02:00.0000"),
    ] {
        let data = end_before_kill(between, kill_ts);
        let index = index_bytes(data.as_bytes());
        let case = format!("kill at {kill_ts} after {} lines", between.len());
        assert_eq!(
            rows(&index),
            [
                (1, true, Outcome::Kill, None),
                (2, false, Outcome::Kill, Some(1))
            ],
            "{case}"
        );
        let (run, pull) = (&index.fights[0], &index.fights[1]);
        assert_eq!(
            (pull.end, pull.duration_ms, pull.end_offset),
            (ts(kill_ts), 60_000, data.len() as u64),
            "{case}"
        );
        assert_eq!(
            (run.end, run.duration_ms, run.end_offset),
            (ts("10/8/2026 20:02:00.0000"), 120_000, data.len() as u64),
            "the run ends at its END while its range covers the pull's end: {case}"
        );
    }
}

#[test]
fn a_pull_end_that_comes_too_late_leaves_the_pull_incomplete_before_the_run_end() {
    let end = key_end("10/8/2026 20:02:00.0000", 1, 120_000);
    let too_many: Vec<String> = (0..END_GRACE_LINES)
        .map(|_| died("10/8/2026 20:02:00.0000"))
        .collect();
    let same_zone =
        "10/8/2026 20:02:00.0000  ZONE_CHANGE,2649,\"Priory of the Sacred Flame\",8\n".to_string();
    let broken = "10/8/2026 20:02:00.0000  ENCOUNTER_END,2847\n".to_string();
    for (case, data, broken_lines) in [
        (
            "after the grace lines",
            end_before_kill(&too_many, "10/8/2026 20:02:00.0000"),
            0,
        ),
        (
            "just after the grace window",
            end_before_kill(&[], "10/8/2026 20:02:01.0001"),
            0,
        ),
        (
            "after another event",
            end_before_kill(&[same_zone], "10/8/2026 20:02:00.0000"),
            0,
        ),
        (
            "after a broken line",
            end_before_kill(&[broken], "10/8/2026 20:02:00.0000"),
            1,
        ),
    ] {
        let index = index_bytes(data.as_bytes());
        let (run, pull) = (&index.fights[0], &index.fights[1]);
        let end_offset = data.find(&end).unwrap();
        assert_eq!(
            (pull.outcome, pull.end, pull.end_offset),
            (
                Outcome::Incomplete,
                ts("10/8/2026 20:01:30.0000"),
                end_offset as u64
            ),
            "{case}"
        );
        assert_eq!(
            (run.outcome, run.end, run.end_offset, run.broken_lines),
            (
                Outcome::Kill,
                ts("10/8/2026 20:02:00.0000"),
                (end_offset + end.len()) as u64,
                0
            ),
            "{case}"
        );
        assert_eq!(index.broken_lines, broken_lines, "{case}");
    }
}

/// The fixture's first Baron pull: damage leaving him at 87.5 % (350 of 400 M), at `ts`.
fn baron_hit(ts: &str) -> String {
    let lines = fixture_lines();
    let hit = &lines[line_at(&lines, "10/8/2026 20:04:10.0000  SPELL_DAMAGE")];
    format!("{ts}{}\n", &hit["10/8/2026 20:04:10.0000".len()..])
}

fn baron_died(ts: &str) -> String {
    format!(
        "{ts}  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,Creature-0-3892-2649-1387-207939-0000468004,\"Baron Braunpyke\",0x10a48,0x80000000,0\n"
    )
}

#[test]
fn a_pull_cut_back_to_the_run_end_forgets_the_lines_after_it() {
    let data = [
        key_start("10/8/2026 20:00:00.0000", 12),
        boss_start("10/8/2026 20:01:00.0000", 2835, "Baron Braunpyke"),
        baron_hit("10/8/2026 20:01:10.0000"),
        key_end("10/8/2026 20:02:00.0000", 1, 120_000),
        baron_died("10/8/2026 20:02:00.0100"),
        "10/8/2026 20:02:00.0200  WORLD_MARKER_PLACED,3004,1,1525.40,11.09\n".to_string(),
        boss_end(
            "10/8/2026 20:02:01.5000",
            2835,
            "Baron Braunpyke",
            1,
            61_500,
        ),
    ]
    .concat();
    let index = index_bytes(data.as_bytes());
    let pull = &index.fights[1];
    assert_eq!(
        (pull.outcome, pull.end),
        (Outcome::Incomplete, ts("10/8/2026 20:01:10.0000"))
    );
    assert!(
        (pull.boss_hp_percent.unwrap() - 87.5).abs() < 0.01,
        "{:?}",
        pull.boss_hp_percent
    );
    assert!(
        index.unhandled_in_fights.is_empty(),
        "{:?}",
        index.unhandled_in_fights
    );
}

#[test]
fn a_pull_whose_end_was_missed_offline_ends_where_the_key_was_started_again() {
    let index = index_bytes(OFFLINE_WIPE.as_bytes());
    assert_eq!(
        rows(&index),
        [
            (1, true, Outcome::Kill, None),
            (2, false, Outcome::Kill, Some(1)),
            (3, false, Outcome::Incomplete, Some(1)),
            (4, false, Outcome::Kill, Some(1)),
        ]
    );
    let wipe = &index.fights[2];
    assert_eq!(
        (wipe.end, wipe.duration_ms, wipe.end_offset),
        (
            ts("10/8/2026 20:05:00.0000"),
            60_000,
            OFFLINE_WIPE
                .find("10/8/2026 20:05:00.0000  CHALLENGE_MODE_START")
                .unwrap() as u64
        )
    );
    // The trash after the reconnect leaves the boss's HP alone.
    assert!(
        (wipe.boss_hp_percent.unwrap() - 87.5).abs() < 0.01,
        "{:?}",
        wipe.boss_hp_percent
    );
}
