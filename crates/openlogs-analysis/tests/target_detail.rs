mod support;

use openlogs_analysis::{
    Attribution, EventKind, NOBODY, ReportFilter, UnitLife, Wave, enemy_groups, target_detail,
};
use support::{FightBuilder, HOSTILE_FLAGS};

const AUG: Attribution = Attribution::Augmented;

fn whole(attribution: Attribution) -> ReportFilter {
    ReportFilter::whole(attribution)
}

fn died() -> EventKind {
    EventKind::Died { unconscious: false }
}

struct Scene {
    b: FightBuilder,
    mage: u32,
    warrior: u32,
    rawlings: [u32; 3],
}

fn scene() -> Scene {
    let mut b = FightBuilder::new(60_000);
    b.fight.name = "Ula'tek".to_string();
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let warrior = b.player("Player-2", "Wendel-Emberfall-EU", 71);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let rawlings = [1, 2, 3].map(|i| {
        b.unit(
            &format!("Creature-0-1-1-1-261874-0{i}"),
            "Blightscale Rawling",
            HOSTILE_FLAGS,
        )
    });
    let rattle = b.unit("Creature-0-1-1-1-262000-01", "Gore Rattle", HOSTILE_FLAGS);
    b.spell(1, "Arcane Barrage");
    // Boss and Gore Rattle share a 1 M health pool; Rawlings have 50 k.
    b.hit(500, mage, boss, 1, 1_000, (900_000, 1_000_000));
    b.hit(600, mage, rattle, 1, 100, (900_000, 1_000_000));
    let [r1, r2, r3] = rawlings;
    b.hit(1_000, mage, r1, 1, 100, (40_000, 50_000));
    b.hit(7_000, warrior, r1, 1, 50, (0, 50_000));
    b.push(8_000, NOBODY, r1, 0, died());
    b.hit(3_000, mage, r2, 1, 100, (45_000, 50_000));
    b.hit(9_000, mage, r2, 1, 100, (40_000, 50_000));
    b.hit(20_000, warrior, r3, 1, 200, (0, 50_000));
    b.push(30_000, NOBODY, r3, 0, died());
    Scene {
        b,
        mage,
        warrior,
        rawlings,
    }
}

#[test]
fn enemy_groups_merge_units_by_name() {
    let mut s = scene();
    let groups = enemy_groups(&s.b.build(), &whole(AUG));
    let rows: Vec<_> = groups
        .iter()
        .map(|g| (g.name.as_str(), g.units, g.damage_taken, g.is_boss))
        .collect();
    assert_eq!(
        rows,
        [
            ("Ula'tek", 1, 1_000, true),
            ("Blightscale Rawling", 3, 550, false),
            ("Gore Rattle", 1, 100, false)
        ]
    );
}

#[test]
fn target_detail_lifetimes_waves_and_players() {
    let mut s = scene();
    let fight = s.b.build();
    let [r1, r2, r3] = s.rawlings;
    let detail = target_detail(&fight, "Blightscale Rawling", &whole(AUG)).unwrap();
    assert_eq!(
        (detail.damage_taken, detail.raid_damage, detail.max_hp),
        (550, 1_650, Some(50_000))
    );
    assert_eq!(
        detail.units,
        [
            UnitLife {
                actor: r1,
                first_hit: 1_000,
                last_hit: 7_000,
                death: Some(8_000)
            },
            UnitLife {
                actor: r2,
                first_hit: 3_000,
                last_hit: 9_000,
                death: None
            },
            UnitLife {
                actor: r3,
                first_hit: 20_000,
                last_hit: 20_000,
                death: Some(30_000)
            },
        ]
    );
    assert_eq!(
        detail.waves,
        [
            Wave {
                start_ms: 1_000,
                units: 2,
                killed: 1,
                clear_ms: 8_000,
                avg_life_ms: Some(7_000)
            },
            Wave {
                start_ms: 20_000,
                units: 1,
                killed: 1,
                clear_ms: 10_000,
                avg_life_ms: Some(10_000)
            },
        ]
    );
    assert_eq!(detail.by_player, vec![(s.mage, 300), (s.warrior, 250)]);

    let late = ReportFilter {
        start_ms: 10_000,
        end_ms: 60_000,
        attribution: AUG,
    };
    let detail = target_detail(&fight, "Blightscale Rawling", &late).unwrap();
    assert_eq!(
        detail.units.iter().map(|u| u.actor).collect::<Vec<_>>(),
        [r3]
    );
    assert_eq!(detail.damage_taken, 200);
}

#[test]
fn bosses_count_as_killed_on_a_kill() {
    let mut s = scene();
    s.b.fight.outcome = openlogs_index::Outcome::Kill;
    let fight = s.b.build();
    // The boss's UNIT_DIED is logged just after ENCOUNTER_END, outside the fight slice.
    let boss = target_detail(&fight, "Ula'tek", &whole(AUG)).unwrap();
    assert_eq!(boss.units[0].death, Some(60_000));
    let rattle = target_detail(&fight, "Gore Rattle", &whole(AUG)).unwrap();
    assert_eq!(
        rattle.units[0].death, None,
        "only boss units die with the encounter"
    );
}
