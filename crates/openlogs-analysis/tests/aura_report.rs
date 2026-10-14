mod support;

use openlogs_analysis::{
    AbilityRef, Attribution, AuraAction, AuraType, AurasReport, Dimension, EventKind, NO_SPELL,
    ReportFilter, Scope, Side, UnitRef, auras_report,
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

fn report(
    fight: &openlogs_analysis::Fight,
    side: Side,
    aura_type: AuraType,
    scope: Scope,
) -> AurasReport {
    let scope = Scope {
        perspective: side,
        ..scope
    };
    auras_report(fight, &whole(), &scope, aura_type, Dimension::Ability)
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
    let rows = report(
        &s.b.build(),
        Side::Friendly,
        AuraType::Buff,
        Scope::default(),
    )
    .rows;
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!((row.spell, row.applications, row.uptime), (10060, 2, 0.375));
    let targets: Vec<_> = row
        .lanes
        .iter()
        .map(|t| (t.holder.player, t.uptime, t.intervals.clone()))
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
    let rows = report(
        &s.b.build(),
        Side::Enemy,
        AuraType::Debuff,
        Scope::default(),
    )
    .rows;
    assert_eq!(
        rows.iter().map(|r| r.spell).collect::<Vec<_>>(),
        [99, 172],
        "the boss's own debuff is an enemy's debuff too"
    );
    let targets: Vec<_> = rows[1]
        .lanes
        .iter()
        .map(|t| (t.holder.name.as_str(), t.uptime, t.intervals.clone()))
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
    assert_eq!(rows[1].applications, 4);
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
    let rows = report(
        &s.b.build(),
        Side::Friendly,
        AuraType::Buff,
        Scope::default(),
    )
    .rows;
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

#[test]
fn one_aura_lists_its_holders_and_one_holder_lists_its_auras() {
    let mut s = scene();
    let buff = |action| aura(action, AuraType::Buff);
    s.b.spell(10060, "Power Infusion");
    s.b.spell(1459, "Arcane Intellect");
    s.b.push(0, s.priest, s.mage, 10060, buff(AuraAction::Applied));
    s.b.push(10_000, s.priest, s.mage, 10060, buff(AuraAction::Removed));
    s.b.push(0, s.priest, s.warrior, 10060, buff(AuraAction::Applied));
    s.b.push(5_000, s.priest, s.warrior, 10060, buff(AuraAction::Removed));
    s.b.push(0, s.mage, s.mage, 1459, buff(AuraAction::Applied));
    let fight = s.b.build();
    let infusion = Scope {
        ability: vec![AbilityRef::Name("Power Infusion".into())],
        ..Scope::default()
    };
    let by_target = report(&fight, Side::Friendly, AuraType::Buff, infusion);
    assert_eq!(by_target.group, Dimension::Target);
    let rows: Vec<_> = by_target
        .rows
        .iter()
        .map(|r| (r.holder.as_ref().unwrap().player, r.uptime, r.lanes.len()))
        .collect();
    assert_eq!(rows, [(Some(s.mage), 0.5, 1), (Some(s.warrior), 0.25, 1)]);

    let one_mage = Scope {
        target: vec![UnitRef::Player(s.mage)],
        ..Scope::default()
    };
    let by_aura = report(&fight, Side::Friendly, AuraType::Buff, one_mage);
    assert_eq!(by_aura.group, Dimension::Ability);
    let auras: Vec<_> = by_aura.rows.iter().map(|r| (r.spell, r.uptime)).collect();
    assert_eq!(auras, [(1459, 1.0), (10060, 0.5)]);
    assert_eq!(by_aura.players, 1);

    let from_mage = Scope {
        source: vec![UnitRef::Player(s.mage)],
        ..Scope::default()
    };
    let applied = report(&fight, Side::Friendly, AuraType::Buff, from_mage);
    assert_eq!(
        applied.rows.iter().map(|r| r.spell).collect::<Vec<_>>(),
        [1459]
    );
}

#[test]
fn enemies_have_buffs_of_their_own() {
    let mut s = scene();
    s.b.push(
        2_000,
        s.boss,
        s.boss,
        77,
        aura(AuraAction::Applied, AuraType::Buff),
    );
    s.b.push(
        6_000,
        s.boss,
        s.boss,
        77,
        aura(AuraAction::Removed, AuraType::Buff),
    );
    s.b.push(
        0,
        s.priest,
        s.mage,
        10060,
        aura(AuraAction::Applied, AuraType::Buff),
    );
    let rows = report(&s.b.build(), Side::Enemy, AuraType::Buff, Scope::default()).rows;
    let shields: Vec<_> = rows
        .iter()
        .map(|r| (r.spell, r.lanes[0].holder.name.as_str(), r.uptime))
        .collect();
    assert_eq!(shields, [(77, "Ula'tek", 0.2)]);
}
