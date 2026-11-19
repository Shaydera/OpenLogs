mod common;

use common::{
    BASILISK, BRD, BRD_NAME, GUARDSMAN, OTHER_COPY_GUARDSMAN, RAVEL, Unit, WARDEN, boss_end,
    boss_start, died, dungeon_log, enter_brd, hit, leave, pack, ts, zone,
};
use openlogs_index::{FightSummary, Outcome, RunKind, difficulty_label, index_bytes};

const MYTHIC_PLUS: &str = include_str!("fixtures/mythic_plus.txt");

const OTHER_MAP_CRITTER: Unit = Unit {
    guid: "Creature-0-5250-1-67303-4075-000016CCCC",
    name: "Rat",
    flags: "0xa28",
};

fn entries(fights: &[FightSummary]) -> Vec<(u32, bool, Option<u32>)> {
    fights
        .iter()
        .map(|fight| (fight.index, fight.is_run(), fight.run_index))
        .collect()
}

fn runs(fights: &[FightSummary]) -> Vec<&FightSummary> {
    fights.iter().filter(|fight| fight.is_run()).collect()
}

fn gerstahn(minute: u32, success: bool) -> String {
    [
        boss_start(
            &format!("11/17/2026 20:{minute:02}:30.0000"),
            227,
            "High Interrogator Gerstahn",
            BRD,
        ),
        hit(
            &format!("11/17/2026 20:{minute:02}:31.0000"),
            &RAVEL,
            &GUARDSMAN,
            100,
        ),
        boss_end(
            &format!("11/17/2026 20:{minute:02}:40.0000"),
            227,
            "High Interrogator Gerstahn",
            success,
        ),
    ]
    .concat()
}

#[test]
fn a_dungeon_visit_becomes_a_run_with_its_pulls() {
    let log = [
        enter_brd(0),
        pack(0, &GUARDSMAN),
        gerstahn(0, true),
        leave(1),
    ]
    .concat();
    let index = index_bytes(log.as_bytes());
    assert_eq!(
        entries(&index.fights),
        [(1, true, None), (2, false, Some(1)), (3, false, Some(1))]
    );
    let run = &index.fights[0];
    assert_eq!(
        (
            run.name.as_str(),
            run.difficulty,
            run.instance_id,
            &run.run,
            run.outcome
        ),
        (BRD_NAME, 1, BRD, &Some(RunKind::Dungeon), Outcome::Ended)
    );
    assert_eq!(index.fights[2].outcome, Outcome::Kill);
    assert_eq!(run.start, ts("11/17/2026 20:00:00.0000"));
    assert_eq!(run.duration_ms, 40_000);
}

#[test]
fn the_next_visit_of_the_same_copy_continues_the_run() {
    let log = [
        enter_brd(0),
        pack(0, &GUARDSMAN),
        leave(1),
        enter_brd(2),
        pack(2, &WARDEN),
        leave(3),
    ]
    .concat();
    let index = index_bytes(log.as_bytes());
    assert_eq!(
        entries(&index.fights),
        [(1, true, None), (2, false, Some(1)), (3, false, Some(1))]
    );
    assert_eq!(index.fights[0].duration_ms, 132_000);
}

#[test]
fn a_visit_of_another_copy_starts_a_new_run() {
    let log = [
        enter_brd(0),
        pack(0, &GUARDSMAN),
        leave(1),
        enter_brd(2),
        pack(2, &OTHER_COPY_GUARDSMAN),
        leave(3),
    ]
    .concat();
    let index = index_bytes(log.as_bytes());
    assert_eq!(
        entries(&index.fights),
        [
            (1, true, None),
            (2, false, Some(1)),
            (3, true, None),
            (4, false, Some(3))
        ]
    );
}

#[test]
fn a_visit_without_a_fight_between_two_visits_of_the_same_copy_keeps_one_run() {
    let log = [
        enter_brd(0),
        pack(0, &GUARDSMAN),
        leave(1),
        enter_brd(2),
        leave(3),
        enter_brd(4),
        pack(4, &WARDEN),
        leave(5),
    ]
    .concat();
    let index = index_bytes(log.as_bytes());
    assert_eq!(
        entries(&index.fights),
        [(1, true, None), (2, false, Some(1)), (3, false, Some(1))]
    );
}

#[test]
fn a_pull_outside_between_two_visits_of_the_same_copy_joins_the_run() {
    let index = index_bytes(dungeon_log().as_bytes());
    assert_eq!(
        entries(&index.fights),
        [
            (1, true, None),
            (2, false, Some(1)),
            (3, false, Some(1)),
            (4, false, Some(1))
        ]
    );
    assert_eq!(index.fights[2].name, BASILISK.name);
}

#[test]
fn a_pull_outside_stays_outside_when_the_next_visit_is_another_copy() {
    let log = [
        enter_brd(0),
        pack(0, &GUARDSMAN),
        leave(1),
        pack(1, &BASILISK),
        enter_brd(2),
        pack(2, &OTHER_COPY_GUARDSMAN),
        leave(3),
    ]
    .concat();
    let index = index_bytes(log.as_bytes());
    assert_eq!(
        entries(&index.fights),
        [
            (1, true, None),
            (2, false, Some(1)),
            (3, false, None),
            (4, true, None),
            (5, false, Some(4))
        ]
    );
}

#[test]
fn a_visit_without_a_pull_is_not_listed() {
    let log = [enter_brd(0), leave(1), pack(1, &BASILISK)].concat();
    let index = index_bytes(log.as_bytes());
    assert_eq!(entries(&index.fights), [(1, false, None)]);
}

#[test]
fn a_revisit_starting_with_a_boss_pull_starts_a_new_run() {
    let log = [
        enter_brd(0),
        pack(0, &GUARDSMAN),
        leave(1),
        enter_brd(2),
        gerstahn(2, true),
        leave(3),
    ]
    .concat();
    let index = index_bytes(log.as_bytes());
    assert_eq!(
        entries(&index.fights),
        [
            (1, true, None),
            (2, false, Some(1)),
            (3, true, None),
            (4, false, Some(3))
        ]
    );
}

#[test]
fn an_npc_of_another_map_never_decides_the_copy() {
    let log = [
        enter_brd(0),
        pack(0, &GUARDSMAN),
        leave(1),
        enter_brd(2),
        died("11/17/2026 20:02:05.0000", &OTHER_MAP_CRITTER),
        pack(2, &WARDEN),
        leave(3),
    ]
    .concat();
    let index = index_bytes(log.as_bytes());
    assert_eq!(runs(&index.fights).len(), 1, "{:?}", entries(&index.fights));
}

/// Retail logs a key's entry as Mythic, then `CHALLENGE_MODE_START`, then Mythic+.
fn with_mythic_entry(extra_before_start: &str) -> String {
    let start = MYTHIC_PLUS
        .find("10/8/2026 20:00:00.0000  CHALLENGE_MODE_START")
        .unwrap();
    let after_start = start + MYTHIC_PLUS[start..].find('\n').unwrap() + 1;
    [
        MYTHIC_PLUS[..start].replace(
            r#""Priory of the Sacred Flame",8"#,
            r#""Priory of the Sacred Flame",23"#,
        ),
        extra_before_start.to_string(),
        MYTHIC_PLUS[start..after_start].to_string(),
        zone(
            "10/8/2026 20:00:00.0000",
            2649,
            "Priory of the Sacred Flame",
            8,
        ),
        MYTHIC_PLUS[after_start..].to_string(),
    ]
    .concat()
}

fn without_offsets(fights: &[FightSummary]) -> Vec<FightSummary> {
    fights
        .iter()
        .cloned()
        .map(|mut fight| {
            (fight.prelude_offset, fight.start_offset, fight.end_offset) = (0, 0, 0);
            fight
        })
        .collect()
}

#[test]
fn a_mythic_zero_entry_before_a_key_changes_nothing() {
    let plain = index_bytes(MYTHIC_PLUS.as_bytes());
    let entered = index_bytes(with_mythic_entry("").as_bytes());
    assert_eq!(
        without_offsets(&entered.fights),
        without_offsets(&plain.fights)
    );
}

#[test]
fn a_pull_before_a_key_start_gets_a_mythic_run_that_ends_at_the_start() {
    const FAELAN: Unit = Unit {
        guid: "Player-4101-8E8C0182",
        name: "Faelan-Emberfall-EU",
        flags: "0x512",
    };
    const KNIGHT: Unit = Unit {
        guid: "Creature-0-3892-2649-1387-206698-0000468009",
        name: "Arathi Knight",
        flags: "0xa48",
    };
    let trash = [
        hit("10/8/2026 19:59:51.0000", &FAELAN, &KNIGHT, 100),
        died("10/8/2026 19:59:53.0000", &KNIGHT),
    ]
    .concat();
    let index = index_bytes(with_mythic_entry(&trash).as_bytes());
    let runs = runs(&index.fights);
    assert_eq!(runs.len(), 2, "{:?}", entries(&index.fights));
    let (mythic, key) = (runs[0], runs[1]);
    assert_eq!(
        (&mythic.run, mythic.difficulty, mythic.outcome),
        (&Some(RunKind::Dungeon), 23, Outcome::Ended)
    );
    assert!(key.keystone().is_some());
    assert!(mythic.end < key.start, "{:?} {:?}", mythic.end, key.start);
    assert!(
        key.prelude_offset < mythic.end_offset,
        "the key keeps the lines before its start in its prelude"
    );
}

#[test]
fn a_log_ending_inside_the_dungeon_leaves_the_run_incomplete() {
    let log = [enter_brd(0), pack(0, &GUARDSMAN)].concat();
    let index = index_bytes(log.as_bytes());
    assert_eq!(index.fights[0].outcome, Outcome::Incomplete);
}

#[test]
fn only_dungeon_difficulties_open_a_run() {
    for difficulty in [1, 2, 23, 24, 205] {
        let log = [
            zone("11/17/2026 20:00:00.0000", BRD, BRD_NAME, difficulty),
            pack(0, &GUARDSMAN),
        ]
        .concat();
        let index = index_bytes(log.as_bytes());
        assert_eq!(
            entries(&index.fights),
            [(1, true, None), (2, false, Some(1))],
            "difficulty {difficulty}"
        );
    }
    let raid = [
        zone("11/17/2026 20:00:00.0000", 2810, "Manaforge Omega", 14),
        pack(0, &GUARDSMAN),
    ]
    .concat();
    assert_eq!(
        entries(&index_bytes(raid.as_bytes()).fights),
        [(1, false, None)]
    );
}

#[test]
fn dungeon_difficulties_have_labels() {
    let labels: Vec<_> = [1, 2, 23, 24, 205].map(difficulty_label).into();
    assert_eq!(
        labels,
        [
            Some("Normal"),
            Some("Heroic"),
            Some("Mythic"),
            Some("Timewalking"),
            Some("Follower")
        ]
    );
}
