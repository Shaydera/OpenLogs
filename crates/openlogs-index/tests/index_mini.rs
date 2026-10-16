use openlogs_index::{Outcome, RosterEntry, difficulty_label, index_bytes};
use openlogs_parser::Timestamp;

const FIXTURE: &str = include_str!("fixtures/mini_raid.txt");

fn offset_of(line_prefix: &str) -> u64 {
    FIXTURE.find(line_prefix).expect("line in fixture") as u64
}

fn ts(text: &str) -> Timestamp {
    Timestamp::parse(text).unwrap()
}

#[test]
fn file_level_summary() {
    let index = index_bytes(FIXTURE.as_bytes());
    assert_eq!(index.log_version, Some(22));
    assert_eq!(index.build.as_deref(), Some("12.1.0"));
    assert!(index.advanced_logging);
    assert!(index.warnings.is_empty());
    assert_eq!(index.line_count, 18);
    assert_eq!(index.broken_lines, 1);
    assert!(index.unhandled_in_fights.is_empty());
    assert_eq!(index.fights.len(), 3);
    for fight in &index.fights {
        assert_eq!(fight.zone.as_deref(), Some("The Venomous Abyss"));
    }
}

#[test]
fn wipe_with_roster_boss_hp_and_prelude() {
    let index = index_bytes(FIXTURE.as_bytes());
    let fight = &index.fights[0];
    assert_eq!(fight.index, 1);
    assert_eq!((fight.encounter_id, fight.name.as_str()), (3492, "Ula'tek"));
    assert_eq!(
        (fight.difficulty, fight.group_size, fight.instance_id),
        (15, 23, 3004)
    );
    assert_eq!(fight.outcome, Outcome::Wipe);
    assert_eq!(fight.duration_ms, 60_000);
    assert_eq!(fight.start, ts("10/7/2026 19:03:02.0762"));
    assert_eq!(fight.end, ts("10/7/2026 19:04:02.0762"));
    assert_eq!(
        fight.start_offset,
        offset_of("10/7/2026 19:03:02.0762  ENCOUNTER_START")
    );
    assert_eq!(
        fight.prelude_offset,
        offset_of("10/7/2026 19:02:50.0000"),
        "15 s lookback"
    );
    assert_eq!(
        fight.end_offset,
        offset_of("10/7/2026 19:10:00.0000"),
        "just past ENCOUNTER_END"
    );
    let hp = fight.boss_hp_percent.expect("boss HP");
    assert!(
        (hp - 75.0).abs() < 0.01,
        "small add must not count, got {hp}"
    );
    assert_eq!(
        fight.roster,
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
    assert_eq!(fight.broken_lines, 1);
}

#[test]
fn aborted_and_unfinished_pulls() {
    let index = index_bytes(FIXTURE.as_bytes());
    let aborted = &index.fights[1];
    assert_eq!((aborted.outcome, aborted.duration_ms), (Outcome::Wipe, 19));
    assert_eq!(aborted.boss_hp_percent, None);
    assert!(aborted.roster.is_empty());
    assert_eq!(
        aborted.prelude_offset, aborted.start_offset,
        "nothing within 15 s before"
    );

    let unfinished = &index.fights[2];
    assert_eq!(unfinished.outcome, Outcome::Incomplete);
    assert_eq!(unfinished.duration_ms, 30_500);
    assert_eq!(unfinished.end_offset, FIXTURE.len() as u64);
    assert!((unfinished.boss_hp_percent.unwrap() - 50.0).abs() < 0.01);
}

#[test]
fn difficulty_labels() {
    for (id, label) in [
        (8, Some("Mythic+")),
        (15, Some("Heroic")),
        (16, Some("Mythic")),
        (233, Some("Mythic")),
        (999, None),
    ] {
        assert_eq!(difficulty_label(id), label, "{id}");
    }
}
