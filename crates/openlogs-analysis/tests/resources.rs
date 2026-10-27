mod support;

use openlogs_analysis::{
    AbilityRef, Attribution, Dimension, Energize, EventKind, HEALTH, NOBODY, OptionValue,
    ReportFilter, ResourcesReport, Scope, ScopeMetric, Side, UnitRef, filter_options,
    resources_report,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS, heal};

fn report(fight: &openlogs_analysis::Fight, scope: &Scope) -> ResourcesReport {
    resources_report(fight, &ReportFilter::whole(Attribution::Augmented), scope)
}

fn energize(power_type: i32, amount: f64, over: f64) -> EventKind {
    EventKind::Energize(Energize {
        power_type,
        amount,
        over_energize: over,
    })
}

#[test]
fn resources_track_power_and_energize() {
    let mut b = FightBuilder::new(15_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let warrior = b.player("Player-2", "Wendel-Emberfall-EU", 71);
    b.power(0, mage, 0, 250_000, 250_000);
    b.power(4_000, mage, 0, 125_000, 250_000);
    b.power(6_000, mage, 0, 250_000, 250_000);
    b.power(12_000, mage, 0, 200_000, 250_000);
    b.spell(12051, "Evocation");
    b.push(5_000, mage, mage, 12051, energize(0, 50_000.0, 10_000.0));
    b.push(5_000, NOBODY, warrior, 0, energize(1, 20.0, 0.0));
    let report = report(&b.build(), &Scope::default());
    assert_eq!(
        (report.start_ms, report.end_ms, report.step_ms),
        (0, 15_000, 5_000)
    );
    assert_eq!(
        report.units.len(),
        1,
        "players without samples have no tracks"
    );
    let track = &report.units[0].tracks[0];
    assert_eq!(track.power_type, 0);
    assert_eq!(track.series, vec![Some(50.0), Some(100.0), Some(80.0)]);
    assert_eq!(
        (track.avg_pct, track.min_pct, track.capped_ms),
        (Some(82.5), Some(50.0), 10_000)
    );
    assert_eq!((track.gained, track.wasted), (50_000.0, 10_000.0));
    assert_eq!(track.gains, vec![(12051, 50_000.0, 10_000.0)]);
}

#[test]
fn sparse_tracks_carry_forward_and_skip_unknown_gaps() {
    let mut b = FightBuilder::new(30_000);
    let druid = b.player("Player-1", "Serrik-Silverbrook-EU", 102);
    b.power(1_000, druid, 0, 100, 100);
    b.power(21_000, druid, 0, 50, 100);
    let report = report(&b.build(), &Scope::default());
    let track = &report.units[0].tracks[0];
    assert_eq!(
        track.series,
        vec![
            Some(100.0),
            Some(100.0),
            Some(100.0),
            Some(100.0),
            Some(50.0),
            None
        ]
    );
    assert_eq!(track.capped_ms, 0, "a 20 s gap is unknown, not capped");
}

#[test]
fn health_comes_from_hp_snapshots_and_heals_received() {
    let mut b = FightBuilder::new(10_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let priest = b.player("Player-2", "Ulvara-Emberfall-EU", 256);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.power(0, mage, 0, 100, 100);
    b.hit(0, boss, mage, 5, 400, (600, 1_000));
    b.hit(6_000, boss, mage, 5, 100, (1_000, 1_000));
    b.spell(2061, "Flash Heal");
    b.push(3_000, priest, mage, 2061, EventKind::Heal(heal(300, 100)));
    let report = report(&b.build(), &Scope::default());
    let tracks = &report.units[0].tracks;
    assert_eq!(
        tracks.iter().map(|t| t.power_type).collect::<Vec<_>>(),
        [0, HEALTH],
        "health comes after the primary resource"
    );
    let health = &tracks[1];
    assert_eq!(health.series, vec![Some(60.0), Some(100.0)]);
    assert_eq!((health.avg_pct, health.min_pct), (Some(76.0), Some(60.0)));
    assert_eq!(health.gains, vec![(2061, 200.0, 100.0)]);
}

#[test]
fn enemies_show_their_health_until_they_die() {
    let mut b = FightBuilder::new(10_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let add = b.unit(
        "Creature-0-1-1-1-261874-0001",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    b.hit(1_000, mage, add, 5, 400, (600, 1_000));
    b.hit(2_000, mage, add, 5, 600, (0, 1_000));
    b.push(
        2_000,
        NOBODY,
        add,
        0,
        EventKind::Died { unconscious: false },
    );
    let enemies = Scope {
        perspective: Side::Enemy,
        ..Scope::default()
    };
    let report = report(&b.build(), &enemies);
    let unit = &report.units[0];
    assert_eq!(unit.unit, add);
    assert_eq!(unit.tracks[0].power_type, HEALTH);
    assert_eq!(unit.dead, vec![(2_000, 10_000)]);
}

#[test]
fn an_ability_keeps_the_units_that_gained_from_it() {
    let mut b = FightBuilder::new(15_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let warrior = b.player("Player-2", "Wendel-Emberfall-EU", 71);
    b.power(0, mage, 0, 100, 100);
    b.power(0, warrior, 1, 0, 100);
    b.spell(12051, "Evocation");
    b.spell(29131, "Bloodrage");
    b.push(5_000, mage, mage, 12051, energize(0, 50.0, 0.0));
    b.push(5_000, warrior, warrior, 29131, energize(1, 20.0, 0.0));
    let fight = b.build();
    let evocation = Scope {
        ability: vec![AbilityRef::Name("Evocation".into())],
        ..Scope::default()
    };
    let narrowed = report(&fight, &evocation);
    assert_eq!(
        narrowed.units.iter().map(|u| u.unit).collect::<Vec<_>>(),
        [mage]
    );
    assert_eq!(narrowed.units[0].tracks[0].gains, vec![(12051, 50.0, 0.0)]);
    let holders: Vec<OptionValue> = filter_options(
        &fight,
        &Curated::bundled(),
        &ReportFilter::whole(Attribution::Augmented),
        &Scope::default(),
        ScopeMetric::Resources,
        Dimension::Source,
    )
    .into_iter()
    .map(|o| o.value)
    .collect();
    assert_eq!(
        holders,
        [
            OptionValue::Unit(UnitRef::Player(mage)),
            OptionValue::Unit(UnitRef::Player(warrior)),
        ]
    );
}

#[test]
fn health_keeps_the_lowest_logged_hp_and_gains_only_restored_hp() {
    let mut b = FightBuilder::new(10_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let priest = b.player("Player-2", "Ulvara-Emberfall-EU", 256);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.hit(1_000, boss, mage, 5, 300, (700, 1_000));
    b.hit(1_200, boss, mage, 5, 600, (100, 1_000));
    b.spell(2061, "Flash Heal");
    b.push(3_000, priest, mage, 2061, EventKind::Heal(heal(300, 100)));
    let mut support = heal(60, 0);
    support.supporter = priest;
    b.push(3_000, priest, mage, 2061, EventKind::Heal(support));
    let mut absorbed_by_debuff = heal(0, 0);
    absorbed_by_debuff.absorbed = 400;
    b.push(
        4_000,
        priest,
        mage,
        2061,
        EventKind::Heal(absorbed_by_debuff),
    );
    let report = report(&b.build(), &Scope::default());
    let health = &report.units[0].tracks[0];
    assert_eq!(health.power_type, HEALTH);
    assert_eq!(health.min_pct, Some(10.0));
    assert_eq!((health.gained, health.wasted), (200.0, 100.0));
}

#[test]
fn health_belongs_to_the_unit_whose_hp_is_logged_even_as_the_source() {
    let mut b = FightBuilder::new(10_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.hit(1_000, mage, boss, 5, 100, (500, 1_000));
    let mut fight = b.build();
    fight.events[0].unit_hp = Some(openlogs_analysis::UnitHp {
        actor: mage,
        current: 250,
        max: 1_000,
    });
    let friendly = report(&fight, &Scope::default());
    assert_eq!(friendly.units[0].unit, mage);
    assert_eq!(friendly.units[0].tracks[0].series, vec![Some(25.0), None]);
    let enemies = Scope {
        perspective: Side::Enemy,
        ..Scope::default()
    };
    assert!(report(&fight, &enemies).units.is_empty());
}

#[test]
fn health_average_weighs_each_snapshot_by_the_time_it_holds() {
    let mut b = FightBuilder::new(2_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.hit(0, boss, mage, 5, 0, (1_000, 1_000));
    b.hit(1_000, boss, mage, 5, 500, (500, 1_000));
    b.hit(1_100, boss, mage, 5, 0, (500, 1_000));
    let report = report(&b.build(), &Scope::default());
    assert_eq!(report.units[0].tracks[0].avg_pct, Some(75.0));
}
