use openlogs_index::{
    ChallengeMode, MYTHIC_KEYSTONE_DIFFICULTY, Outcome, RosterEntry, difficulty_label, index_bytes,
};
use openlogs_parser::Timestamp;

/// A +12 Priory of the Sacred Flame: trash, Captain Dailcry (kill), Baron Braunpyke (wipe,
/// then kill), more trash, `CHALLENGE_MODE_END`, then the group leaves.
const FIXTURE: &str = include_str!("fixtures/mythic_plus.txt");

fn offset_of(line_prefix: &str) -> u64 {
    FIXTURE.find(line_prefix).expect("line in fixture") as u64
}

fn ts(text: &str) -> Timestamp {
    Timestamp::parse(text).unwrap()
}

fn key_start(ts: &str) -> String {
    format!("{ts}  CHALLENGE_MODE_START,\"Priory of the Sacred Flame\",2649,499,12,[10,147,9]\n")
}

fn key_end(ts: &str, success: u8, total_ms: u64) -> String {
    format!("{ts}  CHALLENGE_MODE_END,2649,{success},12,{total_ms},312.5,2645.0\n")
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

fn zone(ts: &str, id: u32, name: &str) -> String {
    format!("{ts}  ZONE_CHANGE,{id},\"{name}\",0\n")
}

#[test]
fn a_run_is_indexed_with_its_key_its_roster_and_its_prelude() {
    let index = index_bytes(FIXTURE.as_bytes());
    assert!(index.warnings.is_empty(), "{:?}", index.warnings);
    assert_eq!(index.broken_lines, 0);
    assert!(index.unhandled_in_fights.is_empty());
    assert_eq!(index.fights.len(), 4);

    let run = &index.fights[0];
    assert!(run.is_run());
    assert_eq!(
        (run.index, run.name.as_str(), run.zone.as_deref()),
        (
            1,
            "Priory of the Sacred Flame",
            Some("Priory of the Sacred Flame")
        )
    );
    assert_eq!(
        run.challenge,
        Some(ChallengeMode {
            challenge_mode_id: 499,
            keystone_level: 12,
            affix_ids: vec![10, 147, 9],
            total_time_ms: Some(600_000),
        })
    );
    assert_eq!(
        (
            run.encounter_id,
            run.difficulty,
            run.instance_id,
            run.group_size
        ),
        (0, MYTHIC_KEYSTONE_DIFFICULTY, 2649, 2)
    );
    assert_eq!(
        (
            run.outcome,
            run.duration_ms,
            run.boss_hp_percent,
            run.run_index
        ),
        (Outcome::Kill, 600_000, None, None)
    );
    assert_eq!(
        (run.start, run.end),
        (ts("10/8/2026 20:00:00.0000"), ts("10/8/2026 20:10:00.0000"))
    );
    assert_eq!(
        run.prelude_offset,
        offset_of("10/8/2026 19:59:50.0000"),
        "15 s before the key"
    );
    assert_eq!(
        run.start_offset,
        offset_of("10/8/2026 20:00:00.0000  CHALLENGE_MODE_START")
    );
    assert_eq!(
        run.end_offset,
        offset_of("10/8/2026 20:15:00.0000  ZONE_CHANGE"),
        "just past CHALLENGE_MODE_END"
    );
    assert_eq!(
        run.roster,
        [
            RosterEntry {
                guid: "Player-4101-8E8C0182".into(),
                name: Some("Faelan-Emberfall-EU".into()),
                spec_id: 62
            },
            RosterEntry {
                guid: "Player-4101-77D4A765".into(),
                name: Some("Pyrrin-Emberfall-EU".into()),
                spec_id: 105
            },
        ]
    );
}

#[test]
fn boss_pulls_of_a_run_come_after_it_and_know_it() {
    let index = index_bytes(FIXTURE.as_bytes());
    let pulls: Vec<_> = index.fights[1..]
        .iter()
        .map(|f| {
            (
                f.index,
                f.name.as_str(),
                f.outcome,
                f.duration_ms,
                f.run_index,
                f.is_run(),
            )
        })
        .collect();
    assert_eq!(
        pulls,
        [
            (2, "Captain Dailcry", Outcome::Kill, 60_000, Some(1), false),
            (3, "Baron Braunpyke", Outcome::Wipe, 30_000, Some(1), false),
            (4, "Baron Braunpyke", Outcome::Kill, 60_000, Some(1), false),
        ]
    );
    let wipe = &index.fights[2];
    assert!((wipe.boss_hp_percent.unwrap() - 87.5).abs() < 0.01);
    assert_eq!(difficulty_label(wipe.difficulty), Some("Mythic+"));
    assert_eq!(wipe.roster.len(), 2);
}

#[test]
fn a_run_without_end_lasts_to_the_end_of_the_file() {
    let data = [
        key_start("10/8/2026 20:00:00.0000"),
        boss_start("10/8/2026 20:01:00.0000", 2847, "Captain Dailcry"),
        boss_end(
            "10/8/2026 20:02:00.0000",
            2847,
            "Captain Dailcry",
            1,
            60_000,
        ),
        died("10/8/2026 20:05:00.0000"),
    ]
    .concat();
    let index = index_bytes(data.as_bytes());
    let run = &index.fights[0];
    assert_eq!(
        (run.outcome, run.duration_ms, run.end_offset),
        (Outcome::Incomplete, 300_000, data.len() as u64)
    );
    assert_eq!(run.challenge.as_ref().unwrap().total_time_ms, None);
    assert_eq!(index.fights[1].run_index, Some(1));
}

#[test]
fn leaving_the_dungeon_ends_an_open_run_and_later_pulls_are_not_part_of_it() {
    let leave = zone("10/8/2026 20:20:00.0000", 2552, "Dornogal");
    let data = [
        key_start("10/8/2026 20:00:00.0000"),
        boss_start("10/8/2026 20:01:00.0000", 2847, "Captain Dailcry"),
        died("10/8/2026 20:01:30.0000"),
        leave.clone(),
        zone("10/8/2026 20:30:00.0000", 3004, "The Venomous Abyss"),
        "10/8/2026 20:35:00.0000  ENCOUNTER_START,3492,\"Ula'tek\",15,20,3004\n".to_string(),
        "10/8/2026 20:36:00.0000  ENCOUNTER_END,3492,\"Ula'tek\",15,20,1,60000\n".to_string(),
    ]
    .concat();
    let index = index_bytes(data.as_bytes());
    let run = &index.fights[0];
    assert_eq!(
        (run.outcome, run.end, run.end_offset),
        (
            Outcome::Incomplete,
            ts("10/8/2026 20:01:30.0000"),
            data.find(&leave).unwrap() as u64
        )
    );
    assert_eq!(index.fights[1].run_index, Some(1));
    let raid = &index.fights[2];
    assert_eq!(
        (raid.name.as_str(), raid.outcome, raid.run_index),
        ("Ula'tek", Outcome::Kill, None)
    );
}

#[test]
fn an_end_for_another_dungeon_does_not_close_the_run() {
    let data = [
        key_start("10/8/2026 20:00:00.0000"),
        "10/8/2026 20:10:00.0000  CHALLENGE_MODE_END,2652,1,12,600000\n".to_string(),
        died("10/8/2026 20:12:00.0000"),
    ]
    .concat();
    let run = &index_bytes(data.as_bytes()).fights[0];
    assert_eq!(
        (run.outcome, run.end),
        (Outcome::Incomplete, ts("10/8/2026 20:12:00.0000"))
    );
    assert_eq!(run.challenge.as_ref().unwrap().total_time_ms, None);
}

#[test]
fn a_run_prelude_never_reaches_into_the_previous_run() {
    let second = key_start("10/8/2026 20:10:05.0000");
    let data = [
        key_start("10/8/2026 20:00:00.0000"),
        key_end("10/8/2026 20:10:00.0000", 1, 600_000),
        died("10/8/2026 20:10:02.0000"),
        second.clone(),
    ]
    .concat();
    let index = index_bytes(data.as_bytes());
    assert_eq!(index.fights[1].prelude_offset, index.fights[0].end_offset);
    assert!(index.fights[1].prelude_offset < data.find(&second).unwrap() as u64);
}
