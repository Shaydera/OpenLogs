mod support;

use openlogs_analysis::{
    Attribution, AuraAction, AuraScope, AuraType, EventKind, NO_SPELL, ReportFilter, auras_report,
};
use support::{FightBuilder, HOSTILE_FLAGS};

fn aura(action: AuraAction, aura_type: AuraType) -> EventKind {
    EventKind::Aura {
        action,
        aura_type,
        stacks: None,
        broken_by: NO_SPELL,
    }
}

fn whole() -> ReportFilter {
    ReportFilter::whole(Attribution::Augmented)
}

struct Scene {
    b: FightBuilder,
    mage: u32,
    warrior: u32,
    priest: u32,
    boss: u32,
    adds: [u32; 3],
}

fn scene() -> Scene {
    let mut b = FightBuilder::new(20_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let warrior = b.player("Player-2", "Wendel-Emberfall-EU", 71);
    let priest = b.player("Player-3", "Ulvara-Emberfall-EU", 256);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let adds = [1, 2, 3].map(|i| {
        b.unit(
            &format!("Creature-0-1-1-1-261874-0{i}"),
            "Blightscale Rawling",
            HOSTILE_FLAGS,
        )
    });
    Scene {
        b,
        mage,
        warrior,
        priest,
        boss,
        adds,
    }
}

#[test]
fn buffs_on_players_average_uptime_over_targets() {
    let mut s = scene();
    s.b.push(
        0,
        s.priest,
        s.mage,
        10060,
        aura(AuraAction::Applied, AuraType::Buff),
    );
    s.b.push(
        10_000,
        s.priest,
        s.mage,
        10060,
        aura(AuraAction::Removed, AuraType::Buff),
    );
    s.b.push(
        0,
        s.priest,
        s.warrior,
        10060,
        aura(AuraAction::Applied, AuraType::Buff),
    );
    s.b.push(
        5_000,
        s.priest,
        s.warrior,
        10060,
        aura(AuraAction::Removed, AuraType::Buff),
    );
    s.b.push(
        1_000,
        s.boss,
        s.mage,
        9,
        aura(AuraAction::Applied, AuraType::Debuff),
    );
    let rows = auras_report(&s.b.build(), &whole(), AuraScope::BuffsOnPlayers);
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!((row.spell, row.applications, row.uptime), (10060, 2, 0.375));
    let targets: Vec<_> = row
        .targets
        .iter()
        .map(|t| (t.player, t.uptime, t.intervals.clone()))
        .collect();
    assert_eq!(
        targets,
        [
            (Some(s.mage), 0.5, vec![(0, 10_000)]),
            (Some(s.warrior), 0.25, vec![(0, 5_000)])
        ]
    );
}

#[test]
fn enemy_debuffs_group_targets_by_name() {
    let mut s = scene();
    let [a, b, c] = s.adds;
    for (target, start, end) in [(a, 0, 4_000), (b, 2_000, 6_000), (c, 10_000, 12_000)] {
        s.b.push(
            start,
            s.mage,
            target,
            172,
            aura(AuraAction::Applied, AuraType::Debuff),
        );
        s.b.push(
            end,
            s.mage,
            target,
            172,
            aura(AuraAction::Removed, AuraType::Debuff),
        );
    }
    s.b.push(
        0,
        s.mage,
        s.boss,
        172,
        aura(AuraAction::Applied, AuraType::Debuff),
    );
    s.b.push(
        4_000,
        s.boss,
        s.boss,
        99,
        aura(AuraAction::Applied, AuraType::Debuff),
    );
    let rows = auras_report(&s.b.build(), &whole(), AuraScope::DebuffsOnEnemies);
    assert_eq!(rows.len(), 1, "the boss's own debuff is not a player's");
    let targets: Vec<_> = rows[0]
        .targets
        .iter()
        .map(|t| (t.name.as_str(), t.uptime, t.intervals.clone()))
        .collect();
    assert_eq!(
        targets,
        [
            ("Ula'tek", 1.0, vec![(0, 20_000)]),
            (
                "Blightscale Rawling",
                0.4,
                vec![(0, 6_000), (10_000, 12_000)]
            )
        ]
    );
    assert_eq!(rows[0].applications, 4);
}

#[test]
fn auras_of_one_name_from_unrelated_specs_stay_apart() {
    let mut s = scene();
    let druid = s.b.player("Player-5", "Pyrrin-Emberfall-EU", 105);
    s.b.spell(263725, "Clearcasting");
    s.b.spell(16870, "Clearcasting");
    let buff = |action| aura(action, AuraType::Buff);
    s.b.push(0, s.mage, s.mage, 263725, buff(AuraAction::Applied));
    s.b.push(10_000, s.mage, s.mage, 263725, buff(AuraAction::Removed));
    s.b.push(0, druid, druid, 16870, buff(AuraAction::Applied));
    s.b.push(2_000, druid, druid, 16870, buff(AuraAction::Removed));
    let rows = auras_report(&s.b.build(), &whole(), AuraScope::BuffsOnPlayers);
    let mut rows: Vec<(Vec<u32>, Vec<u32>, f64)> = rows
        .iter()
        .map(|r| (r.spells.clone(), r.sources.clone(), r.uptime))
        .collect();
    rows.sort_by_key(|r| r.0.clone());
    assert_eq!(
        rows,
        vec![
            (vec![16870], vec![druid], 0.1),
            (vec![263725], vec![s.mage], 0.5)
        ],
        "a mage's and a druid's Clearcasting are two auras"
    );
}
