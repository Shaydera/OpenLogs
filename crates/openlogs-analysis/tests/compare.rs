mod support;

use openlogs_analysis::{
    Attribution, Damage, DamageVia, EventKind, Fight, NOBODY, Overkill, PlayerSide, PullComparison,
    compare_pulls,
};
use openlogs_gamedata::Curated;
use openlogs_index::Outcome;
use support::{FightBuilder, HOSTILE_FLAGS, MELEE, damage, heal};

/// Ebon Might's support spell; the event's source is the buffed player.
const EBON_MIGHT_SUPPORT: u32 = 395152;

/// A 10 s wipe: Faelan hits for 30k, Wendel for 50k and dies at 6 s, Pyrrin heals 20k.
fn wipe() -> Fight {
    let mut b = FightBuilder::new(10_000);
    let faelan = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let pyrrin = b.player("Player-2", "Pyrrin-Emberfall-EU", 105);
    let wendel = b.player("Player-3", "Wendel-Emberfall-EU", 71);
    let boss = b.unit("Creature-0-1-1-1-3420-01", "Sszorak", HOSTILE_FLAGS);
    b.push(
        1_000,
        faelan,
        boss,
        1,
        EventKind::Damage(damage(DamageVia::Spell, 30_000, 0)),
    );
    b.push(
        2_000,
        wendel,
        boss,
        2,
        EventKind::Damage(damage(DamageVia::Spell, 50_000, 0)),
    );
    b.push(3_000, pyrrin, faelan, 774, EventKind::Heal(heal(20_000, 0)));
    b.push(
        6_000,
        NOBODY,
        wendel,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    b.build()
}

/// A 20 s kill: Spero (Augmentation) replaces Wendel and is interned first, so every actor
/// id differs from the wipe. Spero's Ebon Might adds 10k to Faelan's 100k hit.
fn kill() -> Fight {
    let mut b = FightBuilder::new(20_000);
    let spero = b.player("Player-4", "Spero-Stonevale-EU", 1473);
    let boss = b.unit("Creature-0-1-1-1-3420-02", "Sszorak", HOSTILE_FLAGS);
    let pyrrin = b.player("Player-2", "Pyrrin-Emberfall-EU", 105);
    let faelan = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    b.push(
        1_000,
        faelan,
        boss,
        1,
        EventKind::Damage(damage(DamageVia::Spell, 100_000, 0)),
    );
    b.push(
        1_000,
        faelan,
        boss,
        EBON_MIGHT_SUPPORT,
        EventKind::Damage(Damage {
            supporter: spero,
            ..damage(DamageVia::Spell, 10_000, 0)
        }),
    );
    b.push(
        2_000,
        spero,
        boss,
        3,
        EventKind::Damage(damage(DamageVia::Spell, 40_000, 0)),
    );
    b.push(3_000, pyrrin, faelan, 774, EventKind::Heal(heal(10_000, 0)));
    let mut fight = b.build();
    fight.outcome = Outcome::Kill;
    fight
}

/// (dps, hps, deaths) of one pull.
type Figures = Option<(f64, f64, u32)>;

/// Each row as (name, figures in A, figures in B).
fn rows(a: &Fight, b: &Fight, comparison: &PullComparison) -> Vec<(String, Figures, Figures)> {
    comparison
        .players
        .iter()
        .map(|row| {
            let actor = match (row.a, row.b) {
                (_, Some(side)) => b.actors.get(side.actor),
                (Some(side), None) => a.actors.get(side.actor),
                (None, None) => panic!("a row without a pull"),
            };
            let figures = |side: Option<PlayerSide>| side.map(|s| (s.dps, s.hps, s.deaths));
            (
                actor.name.clone().unwrap_or_default(),
                figures(row.a),
                figures(row.b),
            )
        })
        .collect()
}

fn kill_dps(kill: &Fight, comparison: &PullComparison, name: &str) -> f64 {
    comparison
        .players
        .iter()
        .filter_map(|row| row.b)
        .find(|side| kill.actors.get(side.actor).name.as_deref() == Some(name))
        .map_or(0.0, |side| side.dps)
}

#[test]
fn players_are_matched_by_guid_and_sorted_by_the_dps_difference() {
    let (wipe_pull, kill_pull) = (wipe(), kill());
    let comparison = compare_pulls(
        &wipe_pull,
        &kill_pull,
        &Curated::bundled(),
        Attribution::Augmented,
        Overkill::Excluded,
        None,
    );
    assert_eq!(
        rows(&wipe_pull, &kill_pull, &comparison),
        vec![
            (
                "Faelan-Emberfall-EU".to_string(),
                Some((3_000.0, 0.0, 0)),
                Some((5_000.0, 0.0, 0))
            ),
            (
                "Pyrrin-Emberfall-EU".to_string(),
                Some((0.0, 2_000.0, 0)),
                Some((0.0, 500.0, 0))
            ),
            (
                "Wendel-Emberfall-EU".to_string(),
                Some((5_000.0, 0.0, 1)),
                None
            ),
            (
                "Spero-Stonevale-EU".to_string(),
                None,
                Some((2_000.0, 0.0, 0))
            ),
        ]
    );
    let faelan = comparison.players[0];
    assert_ne!(
        faelan.a.unwrap().actor,
        faelan.b.unwrap().actor,
        "actor ids differ per pull; the GUID matched them"
    );
    assert_eq!(faelan.dps_delta(), Some(2_000.0));
    assert_eq!(comparison.players[2].dps_delta(), None);
}

#[test]
fn the_aug_mode_moves_support_to_the_evoker() {
    let (wipe_pull, kill_pull) = (wipe(), kill());
    let curated = Curated::bundled();
    let augmented = compare_pulls(
        &wipe_pull,
        &kill_pull,
        &curated,
        Attribution::Augmented,
        Overkill::Excluded,
        None,
    );
    let reattributed = compare_pulls(
        &wipe_pull,
        &kill_pull,
        &curated,
        Attribution::Reattributed,
        Overkill::Excluded,
        None,
    );
    assert_eq!(
        kill_dps(&kill_pull, &augmented, "Faelan-Emberfall-EU"),
        5_000.0
    );
    assert_eq!(
        kill_dps(&kill_pull, &augmented, "Spero-Stonevale-EU"),
        2_000.0
    );
    assert_eq!(
        kill_dps(&kill_pull, &reattributed, "Faelan-Emberfall-EU"),
        4_500.0
    );
    assert_eq!(
        kill_dps(&kill_pull, &reattributed, "Spero-Stonevale-EU"),
        2_500.0
    );
    assert_eq!(
        augmented.b.kpis, reattributed.b.kpis,
        "KPIs do not depend on the mode"
    );
}

#[test]
fn comparison_cuts_each_pull_at_its_own_death() {
    let pull = |duration, death_at| {
        let mut b = FightBuilder::new(duration);
        let faelan = b.player("Player-1", "Faelan-Emberfall-EU", 62);
        b.push(
            death_at,
            NOBODY,
            faelan,
            MELEE,
            EventKind::Died { unconscious: false },
        );
        b.build()
    };
    let (a, b) = (pull(60_000, 30_000), pull(60_000, 50_000));
    let comparison = compare_pulls(
        &a,
        &b,
        &Curated::bundled(),
        Attribution::Augmented,
        Overkill::Excluded,
        Some(1),
    );
    assert_eq!(
        (comparison.a.kpis.duration_ms, comparison.b.kpis.duration_ms),
        (30_001, 50_001)
    );
}
