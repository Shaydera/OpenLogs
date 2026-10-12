use openlogs_analysis::{FightKind, RunEncounter, load_fight};
use openlogs_index::{Outcome, index_bytes};

/// A synthetic +12 in the real line format.
const FIXTURE: &str = include_str!("../../openlogs-index/tests/fixtures/mythic_plus.txt");
/// The fixture with the key started again between and inside boss pulls (reconnect, /reload).
const RECONNECT: &str =
    include_str!("../../openlogs-index/tests/fixtures/mythic_plus_reconnect.txt");
/// The fixture with the run's end at 20:07:00, logged before the Baron kill of the same moment.
const END_FIRST: &str =
    include_str!("../../openlogs-index/tests/fixtures/mythic_plus_end_first.txt");

fn encounter(
    encounter_id: u32,
    name: &str,
    start_ms: i32,
    end_ms: i32,
    outcome: Outcome,
) -> RunEncounter {
    RunEncounter {
        encounter_id,
        name: name.to_string(),
        start_ms,
        end_ms,
        outcome,
    }
}

#[test]
fn a_run_loads_from_its_start_to_its_end_with_the_prelude() {
    let index = index_bytes(FIXTURE.as_bytes());
    let run = load_fight(FIXTURE.as_bytes(), &index.fights[0]);
    assert_eq!(run.kind, FightKind::Run);
    assert_eq!(
        (run.name.as_str(), run.outcome, run.duration_ms),
        ("Priory of the Sacred Flame", Outcome::Kill, 600_000)
    );
    // The Rejuvenation 10 s before the key, trash, both bosses, the death and the last
    // trash pack; the cast 20 s before the key lies outside the prelude.
    let times: Vec<i32> = run.events.iter().map(|e| e.t).collect();
    assert_eq!(
        times,
        [
            -10_000, 10_000, 65_000, 70_000, 80_000, 180_000, 250_000, 260_000, 370_000, 480_000
        ]
    );
    let mut players: Vec<_> = run
        .actors
        .players()
        .map(|p| (p.name.clone().unwrap(), p.spec_id))
        .collect();
    players.sort();
    assert_eq!(
        players,
        [
            ("Faelan-Emberfall-EU".to_string(), Some(62)),
            ("Pyrrin-Emberfall-EU".to_string(), Some(105)),
        ]
    );
}

#[test]
fn an_encounter_without_end_inside_a_run_ends_at_its_last_line() {
    let died = |ts: &str| {
        format!(
            "{ts}  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,Player-4101-8E8C0182,\"Faelan-Emberfall-EU\",0x512,0x80000000,0\n"
        )
    };
    let data = [
        "10/8/2026 20:00:00.0000  CHALLENGE_MODE_START,\"Priory of the Sacred Flame\",2649,499,12,[10,147,9]\n".to_string(),
        "10/8/2026 20:01:00.0000  ENCOUNTER_START,2847,\"Captain Dailcry\",8,5,2649\n".to_string(),
        died("10/8/2026 20:01:30.0000"),
        "10/8/2026 20:02:00.0000  ENCOUNTER_START,2847,\"Captain Dailcry\",8,5,2649\n".to_string(),
        died("10/8/2026 20:02:40.0000"),
        "10/8/2026 20:03:00.0000  CHALLENGE_MODE_END,2649,0,12,180000\n".to_string(),
    ]
    .concat();
    let index = index_bytes(data.as_bytes());
    let run = load_fight(data.as_bytes(), &index.fights[0]);
    let spans: Vec<_> = run
        .encounters
        .iter()
        .map(|e| (e.start_ms, e.end_ms, e.outcome))
        .collect();
    assert_eq!(
        spans,
        [
            (60_000, 90_000, Outcome::Incomplete),
            (120_000, 160_000, Outcome::Incomplete),
        ]
    );
}

#[test]
fn a_reconnect_leaves_the_run_and_its_encounters_whole() {
    let index = index_bytes(RECONNECT.as_bytes());
    let run = load_fight(RECONNECT.as_bytes(), &index.fights[0]);
    assert_eq!(
        (run.kind, run.outcome, run.duration_ms),
        (FightKind::Run, Outcome::Kill, 600_000)
    );
    assert_eq!(
        run.encounters,
        [
            encounter(2847, "Captain Dailcry", 60_000, 120_000, Outcome::Kill),
            encounter(2835, "Baron Braunpyke", 240_000, 270_000, Outcome::Wipe),
            encounter(2835, "Baron Braunpyke", 360_000, 420_000, Outcome::Kill),
        ]
    );
    let times: Vec<i32> = run.events.iter().map(|e| e.t).collect();
    assert_eq!(
        times,
        [
            -10_000, 10_000, 65_000, 70_000, 80_000, 180_000, 250_000, 260_000, 370_000, 480_000
        ]
    );
}

#[test]
fn the_last_encounter_keeps_its_kill_when_its_end_follows_the_run_end() {
    let index = index_bytes(END_FIRST.as_bytes());
    let run = load_fight(END_FIRST.as_bytes(), &index.fights[0]);
    assert_eq!((run.outcome, run.duration_ms), (Outcome::Kill, 420_000));
    assert_eq!(
        run.encounters,
        [
            encounter(2847, "Captain Dailcry", 60_000, 120_000, Outcome::Kill),
            encounter(2835, "Baron Braunpyke", 240_000, 270_000, Outcome::Wipe),
            encounter(2835, "Baron Braunpyke", 360_000, 420_000, Outcome::Kill),
        ]
    );
}
