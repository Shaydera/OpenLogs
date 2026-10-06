mod support;

use openlogs_analysis::{
    EventKind, MIN_INTERMISSION_MS, NOBODY, PhaseKind, boss_hp_series, boss_units, detect_phases,
    fight_timeline, raid_dps_series,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS};

#[test]
fn council_bosses_are_the_damaged_big_units() {
    let mut b = FightBuilder::new(60_000);
    let player = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let npc = b.unit("Creature-0-1-1-1-1000-01", "Mor'zahi", HOSTILE_FLAGS);
    let nama = b.unit("Creature-0-1-1-1-1001-01", "First Mate Nama", HOSTILE_FLAGS);
    let iku = b.unit("Creature-0-1-1-1-1002-01", "Scrollsage Iku", HOSTILE_FLAGS);
    let add = b.unit("Creature-0-1-1-1-1003-01", "Rawling", HOSTILE_FLAGS);
    b.hit(1_000, player, npc, 1, 0, (530, 530));
    b.hit(2_000, player, nama, 1, 55, (216, 271));
    b.hit(3_000, player, iku, 1, 165, (86, 251));
    b.hit(4_000, player, add, 1, 30, (0, 30));
    let fight = b.build();
    assert_eq!(boss_units(&fight), vec![nama, iku]);
}

#[test]
fn phases_split_on_long_gaps_only() {
    let mut hp: Vec<Option<f32>> = vec![Some(90.0); 100];
    for value in &mut hp[20..40] {
        *value = None; // 20 s gap → intermission
    }
    for value in &mut hp[60..70] {
        *value = None; // 10 s gap → too short
    }
    let phases = detect_phases(&hp, 1_000, 100_000);
    let summary: Vec<_> = phases
        .iter()
        .map(|p| (p.kind, p.number, p.start_ms, p.end_ms))
        .collect();
    assert_eq!(
        summary,
        [
            (PhaseKind::Boss, 1, 0, 20_000),
            (PhaseKind::Intermission, 1, 20_000, 40_000),
            (PhaseKind::Boss, 2, 40_000, 100_000),
        ]
    );
    assert_eq!(MIN_INTERMISSION_MS, 15_000);
}

#[test]
fn damage_counts_when_the_target_was_hostile_at_the_hit() {
    // Long enough not to be an aborted pull, which has no boss.
    let mut b = FightBuilder::new(10_000);
    let player = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let add = b.unit(
        "Creature-0-1-1-1-261874-01",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    b.hit(100, player, add, 1, 1_000, (1_000, 2_000));
    b.unit("Creature-0-1-1-1-261874-01", "Blightscale Rawling", 0xa28); // turns neutral later
    let fight = b.build();
    assert_eq!(raid_dps_series(&fight, 1_000)[0], 1_000.0);
    assert_eq!(boss_units(&fight), vec![add]);
}

#[test]
fn silent_boss_drops_out_of_the_hp_aggregate_but_dead_ones_stay() {
    let mut b = FightBuilder::new(60_000);
    let player = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let heart = b.unit("Creature-0-1-1-1-1000-01", "Venomous Heart", HOSTILE_FLAGS);
    let twin = b.unit("Creature-0-1-1-1-1001-01", "Twin", HOSTILE_FLAGS);
    // The heart reports 50% once and then goes silent without dying.
    b.hit(1_000, player, heart, 1, 10, (50, 100));
    // The twin dies at 2 s and must keep counting as 0%.
    b.hit(2_000, player, twin, 1, 10, (0, 100));
    b.push(
        2_000,
        player,
        twin,
        0,
        EventKind::Died { unconscious: false },
    );
    b.hit(5_000, player, boss, 1, 10, (60, 100));
    b.hit(55_000, player, boss, 1, 10, (2, 100));
    let fight = b.build();
    let series = boss_hp_series(&fight, &[boss, heart, twin], 10_000);
    // 0–10 s: (50 + 0 + 60) / 300; 50–60 s: heart silent for 54 s → (0 + 2) / 200.
    assert_eq!(series[0], Some(110.0 * 100.0 / 300.0));
    assert_eq!(series[5], Some(1.0));
}

#[test]
fn fight_timeline_samples_the_pull_and_lists_its_deaths() {
    let mut b = FightBuilder::new(10_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.hit(1_000, mage, boss, 1, 30_000, (900_000, 1_000_000));
    b.push(
        6_000,
        NOBODY,
        mage,
        0,
        EventKind::Died { unconscious: false },
    );
    let timeline = fight_timeline(&b.build(), &Curated::bundled());
    assert_eq!(
        (timeline.boss_hp_step_ms, timeline.boss_hp.len()),
        (1_000, 10)
    );
    assert_eq!((timeline.dps_step_ms, timeline.raid_dps.len()), (5_000, 2));
    assert_eq!(timeline.deaths, [6_000]);
}
