mod support;

use openlogs_analysis::{EventKind, NOBODY, configured_phases, fight_timeline};
use openlogs_gamedata::{Curated, PhaseConfig, PhaseRule, PhaseTrigger};
use support::{FightBuilder, HOSTILE_FLAGS};

fn config(rules: Vec<(&str, PhaseTrigger)>) -> PhaseConfig {
    PhaseConfig {
        version: 1,
        encounter_id: 3492,
        phases: rules
            .into_iter()
            .map(|(name, start)| PhaseRule {
                name: name.to_string(),
                start,
            })
            .collect(),
    }
}

struct Scene {
    b: FightBuilder,
    hp: Vec<Option<f32>>,
}

fn scene() -> Scene {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let add = b.unit(
        "Creature-0-1-1-1-261874-01",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    b.hit(10_000, mage, add, 1, 100, (900, 1_000));
    b.push(30_000, boss, NOBODY, 5, EventKind::CastStart);
    let mut hp = vec![Some(100.0); 60];
    for v in hp.iter_mut().skip(40) {
        *v = Some(25.0);
    }
    Scene { b, hp }
}

#[test]
fn triggers_name_phases_in_order() {
    let mut s = scene();
    let fight = s.b.build();
    let rules = config(vec![
        ("P1", PhaseTrigger::Pull),
        (
            "Adds",
            PhaseTrigger::UnitAppears {
                name: "Blightscale Rawling".into(),
            },
        ),
        ("Burn", PhaseTrigger::BossHpBelow { percent: 30 }),
        ("Spit", PhaseTrigger::Cast { spell_id: 5 }),
    ]);
    let phases: Vec<_> = configured_phases(&fight, &rules, &s.hp, 1_000)
        .into_iter()
        .map(|p| (p.name.unwrap(), p.number, p.start_ms, p.end_ms))
        .collect();
    // The Spit cast at 30 s comes before Burn started (40 s), so it is not searched for.
    assert_eq!(
        phases,
        [
            ("P1".to_string(), 1, 0, 10_000),
            ("Adds".to_string(), 2, 10_000, 40_000),
            ("Burn".to_string(), 3, 40_000, 60_000)
        ]
    );
}

#[test]
fn aborted_pulls_ignore_phase_configs() {
    let mut b = FightBuilder::new(4_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let add = b.unit(
        "Creature-0-1-1-1-261874-01",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    b.hit(1_000, mage, add, 1, 100, (900, 1_000));
    let fight = b.build();
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("phases")).unwrap();
    std::fs::write(
        dir.path().join("phases/3492.json"),
        r#"{ "version": 1, "encounter_id": 3492, "phases": [
            { "name": "P1", "start": { "type": "pull" } },
            { "name": "Adds", "start": { "type": "unit_appears", "name": "Blightscale Rawling" } } ] }"#,
    )
    .unwrap();
    let timeline = fight_timeline(&fight, &Curated::load(Some(dir.path())));
    assert!(timeline.phases.is_empty());
}
