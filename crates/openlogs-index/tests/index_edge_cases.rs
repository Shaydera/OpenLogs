use openlogs_index::{Outcome, index_bytes};
use openlogs_parser::Timestamp;

fn start(ts: &str, id: u32, name: &str) -> String {
    format!("{ts}  ENCOUNTER_START,{id},\"{name}\",15,20,3004\n")
}

fn end(ts: &str, id: u32, name: &str, success: u8, ms: u32) -> String {
    format!("{ts}  ENCOUNTER_END,{id},\"{name}\",15,20,{success},{ms}\n")
}

fn died(ts: &str) -> String {
    format!(
        "{ts}  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,Player-4101-8E8C0182,\"Faelan-Emberfall-EU\",0x512,0x80000000,0\n"
    )
}

fn version(ts: &str, version: u32, advanced: u8) -> String {
    format!(
        "{ts}  COMBAT_LOG_VERSION,{version},ADVANCED_LOG_ENABLED,{advanced},BUILD_VERSION,12.1.0,PROJECT_ID,1\n"
    )
}

fn zone(ts: &str, id: u32, name: &str) -> String {
    format!("{ts}  ZONE_CHANGE,{id},\"{name}\",15\n")
}

fn hit(ts: &str, guid: &str, name: &str, current: u64, max: u64, amount: u64) -> String {
    format!(
        "{ts}  SPELL_DAMAGE,Player-4101-8E8C0182,\"Faelan-Emberfall-EU\",0x512,0x80000000,{guid},\"{name}\",0x10a48,0x80000000,44425,\"Arcane Barrage\",0x40,{guid},0000000000000000,{current},{max},0,0,1470,0,0,0,3,0,100,0,1599.81,-1.23,2610,3.1461,93,{amount},{amount},-1,64,0,0,0,nil,nil,nil,ST\n"
    )
}

fn ts(text: &str) -> Timestamp {
    Timestamp::parse(text).unwrap()
}

#[test]
fn an_unfinished_fight_runs_to_its_latest_line_and_the_end_of_the_file() {
    let data = [
        start("10/7/2026 19:03:02.0762", 3492, "Ula'tek"),
        died("10/7/2026 19:03:10.0040"),
        died("10/7/2026 19:03:10.0000"),
        "10/7/2026 19:03:11.0000  SPELL_DAMAGE,Player-4101-8E8C0182,\"Faelan-Fro".to_string(),
    ]
    .concat();
    let index = index_bytes(data.as_bytes());
    assert_eq!(index.fights.len(), 1);
    let fight = &index.fights[0];
    assert_eq!(fight.outcome, Outcome::Incomplete);
    assert_eq!(
        (fight.end, fight.duration_ms),
        (ts("10/7/2026 19:03:10.0040"), 7_927),
        "out-of-order timestamps never shrink a fight"
    );
    assert_eq!(fight.broken_lines, 1);
    assert_eq!(fight.end_offset, data.len() as u64);
}

#[test]
fn a_fight_without_its_own_end_closes_at_the_next_start() {
    let second_start = start("10/7/2026 19:05:00.0000", 3470, "Nek'zali the Soulcoiler");
    let data = [
        start("10/7/2026 19:03:02.0762", 3492, "Ula'tek"),
        died("10/7/2026 19:03:10.0000"),
        end(
            "10/7/2026 19:04:00.0000",
            3470,
            "Nek'zali the Soulcoiler",
            1,
            1_000,
        ),
        second_start.clone(),
        end(
            "10/7/2026 19:06:00.0000",
            3470,
            "Nek'zali the Soulcoiler",
            1,
            60_000,
        ),
    ]
    .concat();
    let index = index_bytes(data.as_bytes());
    assert_eq!(index.fights.len(), 2);
    let first = &index.fights[0];
    assert_eq!(first.outcome, Outcome::Incomplete);
    assert_eq!(first.end, ts("10/7/2026 19:04:00.0000"));
    assert_eq!(first.end_offset, data.find(&second_start).unwrap() as u64);
    let second = &index.fights[1];
    assert_eq!(
        (second.name.as_str(), second.outcome, second.boss_hp_percent),
        ("Nek'zali the Soulcoiler", Outcome::Kill, Some(0.0))
    );
}

#[test]
fn only_leaving_the_instance_closes_an_open_fight() {
    let leave = zone("10/7/2026 19:05:00.0000", 2916, "Vaults of Atal'Utek");
    let left = [
        start("10/7/2026 19:03:02.0762", 3492, "Ula'tek"),
        died("10/7/2026 19:03:10.0000"),
        leave.clone(),
        died("10/7/2026 19:20:00.0000"),
    ]
    .concat();
    let index = index_bytes(left.as_bytes());
    assert_eq!(index.fights.len(), 1);
    let fight = &index.fights[0];
    assert_eq!(
        (fight.outcome, fight.end, fight.end_offset),
        (
            Outcome::Incomplete,
            ts("10/7/2026 19:03:10.0000"),
            left.find(&leave).unwrap() as u64
        )
    );

    let stayed = [
        start("10/7/2026 19:03:02.0762", 3492, "Ula'tek"),
        zone("10/7/2026 19:03:30.0000", 3004, "The Venomous Abyss"),
        end("10/7/2026 19:04:02.0762", 3492, "Ula'tek", 0, 60_000),
    ]
    .concat();
    let fight = &index_bytes(stayed.as_bytes()).fights[0];
    assert_eq!((fight.outcome, fight.duration_ms), (Outcome::Wipe, 60_000));
}

#[test]
fn each_fight_takes_the_zone_of_the_latest_zone_change() {
    let data = [
        start("10/7/2026 18:50:00.0000", 3492, "Ula'tek"),
        end("10/7/2026 18:51:00.0000", 3492, "Ula'tek", 0, 60_000),
        zone("10/7/2026 19:00:00.0000", 3004, "The Venomous Abyss"),
        start("10/7/2026 19:03:02.0762", 3492, "Ula'tek"),
        end("10/7/2026 19:04:02.0762", 3492, "Ula'tek", 0, 60_000),
        zone("10/7/2026 19:10:00.0000", 2987, "Tidecaller's Reach"),
        start("10/7/2026 19:15:16.4072", 3379, "Nymrissa Wavecaller"),
    ]
    .concat();
    let zones: Vec<_> = index_bytes(data.as_bytes())
        .fights
        .iter()
        .map(|fight| fight.zone.clone())
        .collect();
    assert_eq!(
        zones,
        [
            None,
            Some("The Venomous Abyss".to_string()),
            Some("Tidecaller's Reach".to_string())
        ]
    );
}

#[test]
fn version_headers_warn_about_unsupported_logs_once() {
    for (data, warning) in [
        (
            [
                version("10/7/2026 18:58:23.0202", 22, 1),
                version("10/7/2026 18:58:23.0242", 22, 1),
            ]
            .concat(),
            None,
        ),
        (version("10/7/2026 18:58:23.0202", 21, 1), Some("21")),
        (
            version("10/7/2026 18:58:23.0202", 22, 0),
            Some("Advanced combat logging"),
        ),
    ] {
        let index = index_bytes(data.as_bytes());
        match warning {
            None => assert!(index.warnings.is_empty(), "{:?}", index.warnings),
            Some(text) => {
                assert_eq!(index.warnings.len(), 1, "{:?}", index.warnings);
                assert!(index.warnings[0].contains(text), "{:?}", index.warnings);
            }
        }
    }
}

#[test]
fn prelude_never_reaches_into_the_previous_fight() {
    let second = start("10/7/2026 19:03:10.0000", 3492, "Ula'tek");
    let data = [
        start("10/7/2026 19:03:00.0000", 3492, "Ula'tek"),
        end("10/7/2026 19:03:00.0190", 3492, "Ula'tek", 0, 19),
        died("10/7/2026 19:03:05.0000"),
        second.clone(),
        died("10/7/2026 19:03:20.0000"),
    ]
    .concat();
    let index = index_bytes(data.as_bytes());
    assert_eq!(index.fights.len(), 2);
    assert_eq!(index.fights[1].prelude_offset, index.fights[0].end_offset);
    assert!(
        index.fights[1].prelude_offset < data.find(&second).unwrap() as u64,
        "lines between the fights stay in the prelude"
    );
}

#[test]
fn council_boss_hp_aggregates_the_damaged_bosses_only() {
    // The Lost Explorers: a large encounter NPC nobody attacks plus three council members.
    let data = [
        start("9/6/2026 12:10:24.5252", 3497, "The Lost Explorers"),
        hit(
            "9/6/2026 12:10:30.0000",
            "Creature-0-1-3004-1-1000-01",
            "Mor'zahi",
            530_900_000,
            530_900_000,
            0,
        ),
        hit(
            "9/6/2026 12:11:00.0000",
            "Creature-0-1-3004-1-1001-01",
            "First Mate Nama",
            215_875_200,
            271_200_000,
            55_324_800,
        ),
        hit(
            "9/6/2026 12:11:30.0000",
            "Creature-0-1-3004-1-1002-01",
            "Scrollsage Iku",
            86_309_600,
            250_900_000,
            164_590_400,
        ),
        hit(
            "9/6/2026 12:12:00.0000",
            "Creature-0-1-3004-1-1003-01",
            "Trader Gebbo",
            137_310_000,
            230_000_000,
            92_690_000,
        ),
        end(
            "9/6/2026 12:13:24.9232",
            3497,
            "The Lost Explorers",
            0,
            180_423,
        ),
    ]
    .concat();
    let hp = index_bytes(data.as_bytes()).fights[0]
        .boss_hp_percent
        .unwrap();
    assert!((hp - 58.44).abs() < 0.01, "got {hp}");
}
