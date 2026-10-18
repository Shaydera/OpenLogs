mod support;

use openlogs_analysis::{
    AbilityRef, Attribution, CellKind, Damage, DamageVia, Dimension, EventKind, ReportFilter,
    RowKey, Scope, ScopeMetric, Side, UnitRef, breakdown, effective_group,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS, MELEE, PET_FLAGS, damage};

fn hit(amount: u64) -> EventKind {
    EventKind::Damage(damage(DamageVia::Spell, amount, 0))
}

#[test]
fn a_narrowed_grouping_falls_back_and_returns_when_cleared() {
    let all = Scope::default();
    assert_eq!(
        effective_group(&all, ScopeMetric::DamageDone, Dimension::Source),
        Dimension::Source
    );
    let one_source = Scope {
        source: vec![UnitRef::Player(1)],
        ..Scope::default()
    };
    assert_eq!(
        effective_group(&one_source, ScopeMetric::DamageDone, Dimension::Source),
        Dimension::Ability
    );
    let source_and_ability = Scope {
        ability: vec![AbilityRef::Id(1)],
        ..one_source.clone()
    };
    assert_eq!(
        effective_group(
            &source_and_ability,
            ScopeMetric::DamageDone,
            Dimension::Source
        ),
        Dimension::Target
    );
    let one_taker = Scope {
        target: vec![UnitRef::Player(1)],
        ..Scope::default()
    };
    assert_eq!(
        effective_group(&one_taker, ScopeMetric::DamageTaken, Dimension::Target),
        Dimension::Ability
    );
    assert_eq!(
        effective_group(&all, ScopeMetric::DamageTaken, Dimension::Target),
        Dimension::Target
    );
}

#[test]
fn rows_group_pets_with_owners_and_offer_only_free_dimensions() {
    let mut b = FightBuilder::new(10_000);
    let warlock = b.player("Player-1", "Areus-Stonevale-EU", 266);
    let imp = b.unit("Creature-0-1-1-1-55659-0001", "Wild Imp", PET_FLAGS);
    b.fight.actors.set_owner(imp, warlock);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let add = b.unit(
        "Creature-0-1-1-1-261874-0001",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    b.spell(1, "Shadow Bolt");
    b.spell(2, "Fel Firebolt");
    b.push(1_000, warlock, boss, 1, hit(500));
    b.push(1_100, imp, boss, 2, hit(300));
    b.push(1_200, imp, add, 2, hit(200));
    let fight = b.build();
    let filter = ReportFilter::whole(Attribution::Reattributed);

    let all = breakdown(
        &fight,
        &Curated::bundled(),
        &filter,
        &Scope::default(),
        ScopeMetric::DamageDone,
        Dimension::Source,
    );
    assert_eq!(all.group, Dimension::Source);
    assert_eq!(all.side, vec![Dimension::Ability, Dimension::Target]);
    assert_eq!(all.rows.len(), 1);
    assert_eq!(
        (all.rows[0].row.key.clone(), all.rows[0].row.amount),
        (RowKey::Unit(UnitRef::Player(warlock)), 1_000)
    );

    let only_imps = Scope {
        source: vec![UnitRef::Pet {
            owner: warlock,
            name: "Wild Imp".into(),
        }],
        ..Scope::default()
    };
    let imps = breakdown(
        &fight,
        &Curated::bundled(),
        &filter,
        &only_imps,
        ScopeMetric::DamageDone,
        Dimension::Source,
    );
    assert_eq!(imps.group, Dimension::Ability);
    assert_eq!(imps.side, vec![Dimension::Target]);
    assert_eq!(
        imps.rows[0].row.key,
        RowKey::Ability {
            ability: AbilityRef::Name("Fel Firebolt".into()),
            kind: CellKind::Own,
            pet: Some("Wild Imp".into())
        }
    );
    assert_eq!(imps.rows[0].row.amount, 500);
    let targets: Vec<(RowKey, i64)> = imps.rows[0].splits[0]
        .rows
        .iter()
        .map(|r| (r.key.clone(), r.amount))
        .collect();
    assert_eq!(
        targets,
        vec![
            (RowKey::Unit(UnitRef::Unit("Ula'tek".into())), 300),
            (
                RowKey::Unit(UnitRef::Unit("Blightscale Rawling".into())),
                200
            ),
        ]
    );
    assert_eq!(imps.total, 500);
}

#[test]
fn one_instance_narrows_to_that_unit_only() {
    let mut b = FightBuilder::new(10_000);
    let warrior = b.player("Player-1", "Wendel-Emberfall-EU", 71);
    let first = b.unit(
        "Creature-0-1-1-1-261874-0001",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    let second = b.unit(
        "Creature-0-1-1-1-261874-0002",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    b.spell(1, "Mortal Strike");
    b.push(1_000, warrior, first, 1, hit(400));
    b.push(2_000, warrior, second, 1, hit(100));
    let fight = b.build();
    let filter = ReportFilter::whole(Attribution::Reattributed);
    let scope = Scope {
        target: vec![UnitRef::Instance(second)],
        ..Scope::default()
    };
    assert_eq!(
        breakdown(
            &fight,
            &Curated::bundled(),
            &filter,
            &scope,
            ScopeMetric::DamageDone,
            Dimension::Source
        )
        .total,
        100
    );
}

#[test]
fn unmatched_support_stays_a_negative_ability_row() {
    let mut b = FightBuilder::new(10_000);
    let warrior = b.player("Player-1", "Wendel-Emberfall-EU", 71);
    let evoker = b.player("Player-2", "Speronis-Stonevale-EU", 1473);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(1, "Mortal Strike");
    b.spell(395152, "Ebon Might");
    b.push(1_000, warrior, boss, 1, hit(1_000));
    b.push(
        5_000,
        warrior,
        boss,
        395152,
        EventKind::Damage(Damage {
            supporter: evoker,
            ..damage(DamageVia::Spell, 50, 0)
        }),
    );
    let fight = b.build();
    let filter = ReportFilter::whole(Attribution::Reattributed);
    let scope = Scope {
        source: vec![UnitRef::Player(warrior)],
        ..Scope::default()
    };
    let rows = breakdown(
        &fight,
        &Curated::bundled(),
        &filter,
        &scope,
        ScopeMetric::DamageDone,
        Dimension::Source,
    )
    .rows;
    let amounts: Vec<(RowKey, i64)> = rows
        .iter()
        .map(|r| (r.row.key.clone(), r.row.amount))
        .collect();
    assert_eq!(
        amounts,
        vec![
            (
                RowKey::Ability {
                    ability: AbilityRef::Name("Mortal Strike".into()),
                    kind: CellKind::Own,
                    pet: None
                },
                1_000
            ),
            (
                RowKey::Ability {
                    ability: AbilityRef::Id(0),
                    kind: CellKind::Unmatched,
                    pet: None
                },
                -50
            ),
        ]
    );
}

#[test]
fn selecting_melee_leaves_out_unmatched_support() {
    let mut b = FightBuilder::new(10_000);
    let warrior = b.player("Player-1", "Wendel-Emberfall-EU", 71);
    let evoker = b.player("Player-2", "Speronis-Stonevale-EU", 1473);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(395152, "Ebon Might");
    b.push(
        1_000,
        warrior,
        boss,
        MELEE,
        EventKind::Damage(damage(DamageVia::Swing, 700, 0)),
    );
    b.push(
        5_000,
        warrior,
        boss,
        395152,
        EventKind::Damage(Damage {
            supporter: evoker,
            ..damage(DamageVia::Spell, 50, 0)
        }),
    );
    let fight = b.build();
    let scope = Scope {
        ability: vec![AbilityRef::Id(MELEE)],
        ..Scope::default()
    };
    let melee = breakdown(
        &fight,
        &Curated::bundled(),
        &ReportFilter::whole(Attribution::Reattributed),
        &scope,
        ScopeMetric::DamageDone,
        Dimension::Source,
    );
    assert_eq!(melee.total, 700);
}

#[test]
fn damage_taken_rows_carry_hits_and_absorbed_damage_on_both_sides() {
    use openlogs_analysis::{MissType, Missed};
    let mut b = FightBuilder::new(10_000);
    let tank = b.player("Player-1", "Edrin-Emberfall-EU", 581);
    let mage = b.player("Player-2", "Faelan-Emberfall-EU", 62);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(5, "Virulent Spit");
    b.push(
        1_000,
        boss,
        tank,
        5,
        EventKind::Damage(Damage {
            absorbed: 100,
            ..damage(DamageVia::Spell, 1_000, 0)
        }),
    );
    b.push(
        2_000,
        boss,
        tank,
        5,
        EventKind::Missed(Missed {
            via: DamageVia::Spell,
            miss_type: MissType::Absorb,
            amount_missed: 400,
        }),
    );
    b.push(
        3_000,
        boss,
        mage,
        5,
        EventKind::Damage(Damage {
            absorbed: 50,
            ..damage(DamageVia::Spell, 500, 0)
        }),
    );
    b.push(
        4_000,
        tank,
        boss,
        6,
        EventKind::Damage(Damage {
            absorbed: 300,
            ..damage(DamageVia::Spell, 2_000, 0)
        }),
    );
    let fight = b.build();
    let filter = ReportFilter::whole(Attribution::Reattributed);
    let scope = Scope {
        target: vec![UnitRef::Player(tank)],
        ..Scope::default()
    };
    let taken = breakdown(
        &fight,
        &Curated::bundled(),
        &filter,
        &scope,
        ScopeMetric::DamageTaken,
        Dimension::Target,
    );
    assert_eq!(taken.group, Dimension::Ability);
    let row = &taken.rows[0].row;
    assert_eq!((row.amount, row.hits, row.absorbed), (1_500, 2, 500));
    let by_source = &taken.rows[0].splits[0].rows[0];
    assert_eq!((by_source.hits, by_source.absorbed), (2, 500));

    let enemy = Scope {
        perspective: Side::Enemy,
        ..Scope::default()
    };
    let boss_row = &breakdown(
        &fight,
        &Curated::bundled(),
        &filter,
        &enemy,
        ScopeMetric::DamageTaken,
        Dimension::Target,
    )
    .rows[0]
        .row;
    assert_eq!((boss_row.amount, boss_row.absorbed), (2_300, 300));
}

#[test]
fn pet_abilities_get_rows_of_their_own_that_narrow_to_the_pets() {
    let mut b = FightBuilder::new(10_000);
    let first = b.player("Player-1", "Tarvo-Emberfall-EU", 253);
    let second = b.player("Player-2", "Ilsa-Stonevale-EU", 253);
    let first_wolf = b.unit("Pet-0-1-1-1-165189-0001", "Wolf", PET_FLAGS);
    let second_wolf = b.unit("Pet-0-1-1-1-165189-0002", "Wolf", PET_FLAGS);
    b.fight.actors.set_owner(first_wolf, first);
    b.fight.actors.set_owner(second_wolf, second);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let swing = |amount| EventKind::Damage(damage(DamageVia::Swing, amount, 0));
    b.push(1_000, first, boss, MELEE, swing(500));
    b.push(1_100, first_wolf, boss, MELEE, swing(300));
    b.push(1_200, second_wolf, boss, MELEE, swing(250));
    let fight = b.build();
    let filter = ReportFilter::whole(Attribution::Reattributed);
    let by_ability = breakdown(
        &fight,
        &Curated::bundled(),
        &filter,
        &Scope::default(),
        ScopeMetric::DamageDone,
        Dimension::Ability,
    );
    let rows: Vec<(Option<String>, i64, Vec<UnitRef>)> = by_ability
        .rows
        .iter()
        .map(|r| match &r.row.key {
            RowKey::Ability { pet, .. } => (pet.clone(), r.row.amount, r.row.pets.clone()),
            RowKey::Unit(_) => unreachable!(),
        })
        .collect();
    let wolves = vec![
        UnitRef::Pet {
            owner: first,
            name: "Wolf".into(),
        },
        UnitRef::Pet {
            owner: second,
            name: "Wolf".into(),
        },
    ];
    assert_eq!(
        rows,
        vec![
            (Some("Wolf".into()), 550, wolves.clone()),
            (None, 500, vec![]),
        ]
    );

    let only_the_wolves = Scope {
        source: wolves,
        ability: vec![AbilityRef::Id(MELEE)],
        ..Scope::default()
    };
    let narrowed = breakdown(
        &fight,
        &Curated::bundled(),
        &filter,
        &only_the_wolves,
        ScopeMetric::DamageDone,
        Dimension::Ability,
    );
    assert_eq!(narrowed.group, Dimension::Target);
    assert_eq!(narrowed.total, 550);
}
