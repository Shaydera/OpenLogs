mod support;

use openlogs_analysis::{
    Attribution, DamageVia, EventKind, NOBODY, ReportFilter, quick_overview, quick_overview_in,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS, MELEE, damage};

#[test]
fn kpis_summarise_the_pull() {
    let curated = Curated::bundled();
    let mut b = FightBuilder::new(10_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let druid = b.player("Player-2", "Pyrrin-Emberfall-EU", 105);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let potion = b.spell(1236994, "Potion of Recklessness");
    let stone = b.spell(6262, "Healthstone");
    b.push(-1_000, mage, NOBODY, potion, EventKind::CastSuccess);
    b.push(4_000, druid, NOBODY, stone, EventKind::CastSuccess);
    b.push(
        1_000,
        mage,
        boss,
        1,
        EventKind::Damage(damage(DamageVia::Spell, 30_000, 0)),
    );
    b.push(
        2_000,
        druid,
        boss,
        2,
        EventKind::Damage(damage(DamageVia::Spell, 20_000, 0)),
    );
    b.push(
        6_000,
        NOBODY,
        mage,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    let overview = quick_overview(&b.build(), &curated);

    let k = &overview.kpis;
    assert_eq!(
        (k.players, k.duration_ms, k.raid_damage),
        (2, 10_000, 50_000)
    );
    assert!((k.raid_dps - 5_000.0).abs() < 1e-9);
    assert_eq!((k.deaths, k.first_death_ms), (1, Some(6_000)));
    assert_eq!((k.combat_potions, k.players_without_combat_potion), (1, 1));
    assert_eq!((k.healthstones, k.health_potions), (1, 0));

    assert_eq!(overview.deaths.len(), 1);
    assert!(!overview.deaths[0].context.is_empty());
    assert_eq!(overview.timeline.boss_hp_step_ms, 1_000);
    assert_eq!(overview.timeline.raid_dps.len(), 2);
    assert_eq!(overview.consumables.len(), 2);
}

#[test]
fn overview_range_filters_lists_but_keeps_the_timeline() {
    let curated = Curated::bundled();
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.hit(5_000, mage, boss, 1, 1_000, (900_000, 1_000_000));
    b.hit(30_000, mage, boss, 1, 2_000, (800_000, 1_000_000));
    let time_warp = b.spell(80353, "Time Warp");
    b.push(1_000, mage, NOBODY, time_warp, EventKind::CastSuccess);
    b.push(20_000, boss, NOBODY, 7, EventKind::CastStart);
    b.push(50_000, boss, NOBODY, 7, EventKind::CastStart);
    b.push(
        40_000,
        NOBODY,
        mage,
        0,
        EventKind::Died { unconscious: false },
    );
    let fight = b.build();

    let whole = quick_overview(&fight, &curated);
    let window = quick_overview_in(
        &fight,
        &curated,
        &ReportFilter {
            start_ms: 10_000,
            end_ms: 35_000,
            attribution: Attribution::Augmented,
        },
    );
    assert_eq!(
        (
            window.kpis.raid_damage,
            window.kpis.duration_ms,
            window.kpis.deaths
        ),
        (2_000, 25_000, 0)
    );
    assert!(window.deaths.is_empty() && window.cooldowns.is_empty());
    assert_eq!(
        window.timeline, whole.timeline,
        "the brush timeline always covers the pull"
    );
    assert_eq!(whole.timeline.markers.deaths, vec![(40_000, mage)]);
    assert_eq!(whole.timeline.markers.bloodlust, vec![(1_000, mage, 80353)]);
    assert_eq!(
        whole.timeline.markers.boss_casts,
        vec![(20_000, 7), (50_000, 7)]
    );

    let quiet = quick_overview_in(
        &fight,
        &curated,
        &ReportFilter {
            start_ms: 55_000,
            end_ms: 58_000,
            attribution: Attribution::Augmented,
        },
    );
    assert_eq!(
        (
            quiet.kpis.raid_damage,
            quiet.kpis.raid_dps,
            quiet.kpis.deaths
        ),
        (0, 0.0, 0)
    );
}
