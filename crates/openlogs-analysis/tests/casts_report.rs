mod support;

use openlogs_analysis::{
    AbilityRef, Attribution, AuraAction, AuraType, CastsReport, CellKind, Dimension, EventKind,
    NO_SPELL, NOBODY, ReportFilter, RowKey, Scope, Side, UnitRef, casts_report,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS};

fn cast(b: &mut FightBuilder, t: i32, source: u32, spell: u32) {
    b.push(t, source, NOBODY, spell, EventKind::CastSuccess);
}

fn whole() -> ReportFilter {
    ReportFilter::whole(Attribution::Augmented)
}

fn report(fight: &openlogs_analysis::Fight, scope: &Scope, group: Dimension) -> CastsReport {
    casts_report(fight, &Curated::bundled(), &whole(), scope, group, false)
}

/// (ability, casts, kind) of a player's row split by ability.
fn spells_of(report: &CastsReport, player: u32) -> Vec<(AbilityRef, i64, CellKind)> {
    let row = report
        .breakdown
        .rows
        .iter()
        .find(|r| r.row.key == RowKey::Unit(UnitRef::Player(player)))
        .unwrap();
    row.splits[0]
        .rows
        .iter()
        .map(|r| match &r.key {
            RowKey::Ability { ability, kind } => (ability.clone(), r.amount, *kind),
            RowKey::Unit(_) => unreachable!(),
        })
        .collect()
}

#[test]
fn uptime_follows_an_aura_of_the_same_id_or_name() {
    let mut b = FightBuilder::new(20_000);
    let druid = b.player("Player-1", "Pyrrin-Emberfall-EU", 105);
    let tank = b.player("Player-2", "Edrin-Emberfall-EU", 581);
    let mage = b.player("Player-3", "Faelan-Emberfall-EU", 62);
    let aura = |action| EventKind::Aura {
        action,
        aura_type: AuraType::Buff,
        stacks: None,
        broken_by: NO_SPELL,
    };
    cast(&mut b, 0, druid, 774);
    b.push(0, druid, tank, 774, aura(AuraAction::Applied));
    b.push(10_000, druid, tank, 774, aura(AuraAction::Removed));
    cast(&mut b, 5_000, druid, 774);
    b.push(5_000, druid, mage, 774, aura(AuraAction::Applied));
    b.push(15_000, druid, mage, 774, aura(AuraAction::Removed));
    cast(&mut b, 6_000, druid, 48438);
    // Arcane Surge: the buff has another ID than the cast, but the same name.
    b.spell(365350, "Arcane Surge");
    b.spell(365362, "Arcane Surge");
    cast(&mut b, 1_000, mage, 365350);
    b.push(1_000, mage, mage, 365362, aura(AuraAction::Applied));
    b.push(5_000, mage, mage, 365362, aura(AuraAction::Removed));
    // Spells without a known name are matched by ID only.
    cast(&mut b, 2_000, mage, 900_001);
    b.push(2_000, mage, mage, 900_002, aura(AuraAction::Applied));
    let report = report(&b.build(), &Scope::default(), Dimension::Source);

    let uptimes = |player: u32| -> Vec<(AbilityRef, Option<f64>)> {
        report
            .extras
            .iter()
            .filter(|e| e.player == player)
            .map(|e| (e.ability.clone(), e.uptime))
            .collect()
    };
    assert_eq!(
        uptimes(druid),
        [
            (AbilityRef::Id(774), Some(0.75)),
            (AbilityRef::Id(48438), None)
        ]
    );
    assert_eq!(
        uptimes(mage),
        [
            (AbilityRef::Name("Arcane Surge".into()), Some(0.2)),
            (AbilityRef::Id(900_001), None),
        ]
    );
}

#[test]
fn casts_count_presses_not_follow_up_casts() {
    let mut b = FightBuilder::new(30_000);
    let p = b.player("Player-1", "Selwyn-Ironmoor-EU", 251);
    for (id, name) in [
        (263642, "Fracture"),
        (225919, "Fracture"),
        (225921, "Fracture"),
        (441424, "Exterminate"),
        (441426, "Exterminate"),
        (279302, "Frostwyrm's Fury"),
        (1265384, "Frostwyrm's Fury"),
        (188389, "Flame Shock"),
        (470411, "Flame Shock"),
    ] {
        b.spell(id, name);
    }
    // Fracture: one press, two curated proc casts in the same ms (the proc row stays as it is).
    for t in [1_000, 4_000] {
        for spell in [263642, 225919, 225921] {
            cast(&mut b, t, p, spell);
        }
    }
    // Exterminate's second swing 513 ms later, Flame Shock's two IDs 1 ms apart.
    for t in [5_000, 6_300] {
        cast(&mut b, t, p, 441424);
        cast(&mut b, t + 513, p, 441426);
    }
    for t in [2_000, 8_420] {
        cast(&mut b, t, p, 188389);
        cast(&mut b, t + 1, p, 470411);
    }
    // Frostwyrm's Fury's second wyrm 2–8 s after every cast.
    for (t, later) in [(10_000, 2_027), (20_000, 7_970)] {
        cast(&mut b, t, p, 279302);
        cast(&mut b, t + later, p, 1265384);
    }
    let report = report(&b.build(), &Scope::default(), Dimension::Source);
    let mut rows = spells_of(&report, p);
    rows.sort();
    let name = |n: &str| AbilityRef::Name(n.into());
    assert_eq!(
        rows,
        [
            (name("Exterminate"), 2, CellKind::Own),
            (name("Flame Shock"), 2, CellKind::Own),
            (name("Fracture"), 2, CellKind::Own),
            (name("Fracture"), 4, CellKind::Proc),
            (name("Frostwyrm's Fury"), 2, CellKind::Own),
        ],
        "one cast per press; curated procs keep their own row"
    );
}

#[test]
fn one_spell_under_two_cast_ids_is_one_row() {
    let mut b = FightBuilder::new(20_000);
    let dk = b.player("Player-1", "Aleth-Emberfall-EU", 250);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let aura = |action| EventKind::Aura {
        action,
        aura_type: AuraType::Buff,
        stacks: None,
        broken_by: NO_SPELL,
    };
    b.spell(256948, "Spatial Rift");
    b.spell(257040, "Spatial Rift");
    b.spell(204255, "Soul Fragment");
    b.spell(900_010, "Soul Fragment");
    cast(&mut b, 1_000, dk, 257040);
    cast(&mut b, 2_000, dk, 256948);
    b.push(2_000, dk, dk, 256948, aura(AuraAction::Applied));
    b.push(2_100, dk, dk, 256948, aura(AuraAction::Removed));
    b.hit(2_500, dk, boss, 257040, 1_000, (900_000, 1_000_000));
    // A curated proc and a real cast that share a name stay apart (Hide procs hides one).
    cast(&mut b, 3_000, dk, 204255);
    cast(&mut b, 4_000, dk, 900_010);
    let report = report(&b.build(), &Scope::default(), Dimension::Source);
    let rows: Vec<_> = report
        .extras
        .iter()
        .map(|e| {
            (
                e.ability.clone(),
                e.kind,
                e.spell,
                e.casts,
                e.first_cast_ms,
                e.uptime,
                e.link.map(|l| l.spell),
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            (
                AbilityRef::Name("Soul Fragment".into()),
                CellKind::Own,
                900_010,
                1,
                4_000,
                None,
                None
            ),
            (
                AbilityRef::Name("Soul Fragment".into()),
                CellKind::Proc,
                204255,
                1,
                3_000,
                None,
                None
            ),
            // The teleport (256948) only ever follows the rift (257040): one press, one row.
            (
                AbilityRef::Name("Spatial Rift".into()),
                CellKind::Own,
                257040,
                1,
                1_000,
                Some(0.005),
                Some(257040)
            ),
        ]
    );
    assert_eq!(report.breakdown.rows[0].row.amount, 3);
}

struct Raid {
    fight: openlogs_analysis::Fight,
    mage: u32,
    priest: u32,
}

/// A mage casting at the boss, a priest healing the mage, the boss casting at both.
fn raid() -> Raid {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let priest = b.player("Player-2", "Ulvara-Emberfall-EU", 256);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(30451, "Arcane Blast");
    b.spell(2061, "Flash Heal");
    b.spell(1302982, "Virulent Spit");
    for t in [1_000, 3_000, 5_000] {
        b.push(t, mage, boss, 30451, EventKind::CastSuccess);
    }
    b.push(2_000, priest, mage, 2061, EventKind::CastSuccess);
    b.push(4_000, boss, mage, 1302982, EventKind::CastSuccess);
    b.push(6_000, boss, priest, 1302982, EventKind::CastSuccess);
    Raid {
        fight: b.build(),
        mage,
        priest,
    }
}

#[test]
fn narrowing_falls_back_to_the_free_grouping() {
    let r = raid();
    let one_mage = Scope {
        source: vec![UnitRef::Player(r.mage)],
        ..Scope::default()
    };
    let by_ability = report(&r.fight, &one_mage, Dimension::Source).breakdown;
    assert_eq!(by_ability.group, Dimension::Ability);
    assert_eq!(by_ability.side, Vec::<Dimension>::new());
    assert_eq!(by_ability.total, 3);

    let blast = Scope {
        ability: vec![AbilityRef::Name("Arcane Blast".into())],
        ..Scope::default()
    };
    let who_cast = report(&r.fight, &blast, Dimension::Ability).breakdown;
    assert_eq!(who_cast.group, Dimension::Source);
    assert_eq!(
        who_cast.rows[0].row.key,
        RowKey::Unit(UnitRef::Player(r.mage))
    );

    let both = Scope {
        ability: blast.ability.clone(),
        ..one_mage
    };
    let line = report(&r.fight, &both, Dimension::Source).breakdown;
    assert_eq!((line.rows.len(), line.total), (1, 3));
}

#[test]
fn a_target_selection_keeps_casts_on_that_unit_only() {
    let r = raid();
    let on_mage = Scope {
        target: vec![UnitRef::Player(r.mage)],
        ..Scope::default()
    };
    let rows: Vec<(RowKey, i64)> = report(&r.fight, &on_mage, Dimension::Source)
        .breakdown
        .rows
        .iter()
        .map(|g| (g.row.key.clone(), g.row.amount))
        .collect();
    assert_eq!(rows, [(RowKey::Unit(UnitRef::Player(r.priest)), 1)]);
}

#[test]
fn the_enemy_side_counts_what_hostile_units_cast() {
    let r = raid();
    let enemies = Scope {
        perspective: Side::Enemy,
        ..Scope::default()
    };
    let report = report(&r.fight, &enemies, Dimension::Source);
    let rows: Vec<(RowKey, i64)> = report
        .breakdown
        .rows
        .iter()
        .map(|g| (g.row.key.clone(), g.row.amount))
        .collect();
    assert_eq!(rows, [(RowKey::Unit(UnitRef::Unit("Ula'tek".into())), 2)]);
    assert!(report.extras.is_empty());
}

#[test]
fn hide_procs_yields_to_an_ability_selection() {
    let mut b = FightBuilder::new(20_000);
    let dh = b.player("Player-1", "Selwyn-Ironmoor-EU", 581);
    b.spell(204255, "Soul Fragment");
    b.spell(263642, "Fracture");
    cast(&mut b, 1_000, dh, 263642);
    cast(&mut b, 1_000, dh, 204255);
    let fight = b.build();
    let curated = Curated::bundled();
    let total = |scope: &Scope| {
        casts_report(&fight, &curated, &whole(), scope, Dimension::Source, true)
            .breakdown
            .total
    };
    assert_eq!(total(&Scope::default()), 1);
    let fragments = Scope {
        ability: vec![AbilityRef::Name("Soul Fragment".into())],
        ..Scope::default()
    };
    assert_eq!(total(&fragments), 1);
}
