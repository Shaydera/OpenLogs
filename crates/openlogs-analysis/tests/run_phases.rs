mod support;

use openlogs_analysis::{FightKind, Phase, PhaseKind, RunEncounter, run_phases};
use openlogs_index::Outcome;
use support::FightBuilder;

fn encounter(name: &str, start_ms: i32, end_ms: i32, outcome: Outcome) -> RunEncounter {
    RunEncounter {
        encounter_id: 2835,
        name: name.to_string(),
        start_ms,
        end_ms,
        outcome,
    }
}

/// A completed 10-minute +12 Priory of the Sacred Flame with these boss encounters.
fn run(encounters: Vec<RunEncounter>) -> FightBuilder {
    let mut b = FightBuilder::new(600_000);
    b.fight.kind = FightKind::Run;
    b.fight.encounter_id = 0;
    b.fight.name = "Priory of the Sacred Flame".into();
    b.fight.difficulty = 8;
    b.fight.outcome = Outcome::Kill;
    b.fight.encounters = encounters;
    b
}

type Span<'a> = (PhaseKind, u32, u32, u32, Option<&'a str>);

fn spans(phases: &[Phase]) -> Vec<Span<'_>> {
    phases
        .iter()
        .map(|p| (p.kind, p.number, p.start_ms, p.end_ms, p.name.as_deref()))
        .collect()
}

#[test]
fn a_boss_pulled_twice_gets_two_phases_with_trash_between() {
    let fight = run(vec![
        encounter("Captain Dailcry", 60_000, 120_000, Outcome::Kill),
        encounter("Baron Braunpyke", 240_000, 270_000, Outcome::Wipe),
        encounter("Baron Braunpyke", 360_000, 420_000, Outcome::Kill),
    ])
    .build();
    assert_eq!(
        spans(&run_phases(&fight)),
        [
            (PhaseKind::Trash, 1, 0, 60_000, None),
            (PhaseKind::Boss, 1, 60_000, 120_000, Some("Captain Dailcry")),
            (PhaseKind::Trash, 2, 120_000, 240_000, None),
            (
                PhaseKind::Boss,
                2,
                240_000,
                270_000,
                Some("Baron Braunpyke")
            ),
            (PhaseKind::Trash, 3, 270_000, 360_000, None),
            (
                PhaseKind::Boss,
                3,
                360_000,
                420_000,
                Some("Baron Braunpyke")
            ),
            (PhaseKind::Trash, 4, 420_000, 600_000, None),
        ]
    );
}

#[test]
fn bosses_at_the_edges_leave_no_empty_trash_and_stay_inside_the_run() {
    let fight = run(vec![
        encounter("Captain Dailcry", 0, 100_000, Outcome::Kill),
        encounter("Prioress Murrpray", 500_000, 650_000, Outcome::Incomplete),
    ])
    .build();
    assert_eq!(
        spans(&run_phases(&fight)),
        [
            (PhaseKind::Boss, 1, 0, 100_000, Some("Captain Dailcry")),
            (PhaseKind::Trash, 1, 100_000, 500_000, None),
            (
                PhaseKind::Boss,
                2,
                500_000,
                600_000,
                Some("Prioress Murrpray")
            ),
        ]
    );
}

#[test]
fn an_aborted_boss_pull_counts_as_trash() {
    let fight = run(vec![
        encounter("Baron Braunpyke", 200_000, 200_019, Outcome::Wipe),
        encounter("Baron Braunpyke", 300_000, 360_000, Outcome::Kill),
    ])
    .build();
    assert_eq!(
        spans(&run_phases(&fight)),
        [
            (PhaseKind::Trash, 1, 0, 300_000, None),
            (
                PhaseKind::Boss,
                1,
                300_000,
                360_000,
                Some("Baron Braunpyke")
            ),
            (PhaseKind::Trash, 2, 360_000, 600_000, None),
        ]
    );
}
