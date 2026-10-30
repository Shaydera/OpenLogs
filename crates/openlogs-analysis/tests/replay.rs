mod support;

use openlogs_analysis::{
    ActorId, AuraAction, AuraCategory, AuraType, DamageVia, EventKind, Fight, HealthTrack,
    NO_SPELL, NOBODY, Replay, ReplayCast, ReplayCastOutcome, ReplayDeath, ReplayPowerTrack,
    ReplayUnit, SpellId, StackChange, TargetTrack, Track, UnitKind, quick_overview, replay,
};
use openlogs_gamedata::{ArenaFrame, ChannelSpells, Curated, SpellClasses};
use openlogs_index::MapBounds;
use support::{ARENA_MAP, FightBuilder, HOSTILE_FLAGS, MELEE, PET_FLAGS, damage, heal};

const PAIN_SUPPRESSION: SpellId = 33206;
const ICE_BLOCK: SpellId = 45438;
const ANTI_MAGIC_ZONE: SpellId = 51052;
const ARCANE_INTELLECT: SpellId = 1459;
const NEUTRAL_FLAGS: u32 = 0x10a28;

fn replay_of(fight: &Fight) -> Replay {
    replay(
        fight,
        &Curated::bundled(),
        &ChannelSpells::default(),
        &SpellClasses::default(),
    )
}

fn boss(b: &mut FightBuilder) -> ActorId {
    b.unit("Creature-0-1-1-1-100-0000000001", "Vexmora", HOSTILE_FLAGS)
}

fn aura(action: AuraAction, aura_type: AuraType, stacks: Option<u32>) -> EventKind {
    EventKind::Aura {
        action,
        aura_type,
        stacks,
        broken_by: NO_SPELL,
    }
}

fn died() -> EventKind {
    EventKind::Died { unconscious: false }
}

#[test]
fn tracks_are_columnar_per_unit_and_sorted() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let priest = b.player("Player-2", "Somra", 256);
    b.position(200, mage, 3.0, 4.0)
        .position(100, priest, 5.0, 6.0)
        .position(0, mage, 1.0, 2.0)
        .position(300, priest, 7.0, 8.0);

    let replay = replay_of(&b.build());

    assert_eq!(
        replay.tracks,
        vec![
            Track {
                actor: mage,
                t: vec![0, 200],
                x: vec![1.0, 3.0],
                y: vec![2.0, 4.0],
                facing: vec![0.0, 0.0],
                map: vec![ARENA_MAP, ARENA_MAP],
            },
            Track {
                actor: priest,
                t: vec![100, 300],
                x: vec![5.0, 7.0],
                y: vec![6.0, 8.0],
                facing: vec![0.0, 0.0],
                map: vec![ARENA_MAP, ARENA_MAP],
            },
        ]
    );
}

#[test]
fn a_track_starts_with_its_last_sample_before_the_pull() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    b.position(-600, mage, 1.0, 1.0)
        .position(-300, mage, 2.0, 2.0)
        .position(500, mage, 3.0, 3.0);

    let replay = replay_of(&b.build());

    assert_eq!(replay.tracks[0].t, vec![-300, 500]);
    assert_eq!(replay.tracks[0].x, vec![2.0, 3.0]);
}

#[test]
fn units_are_classified_and_adds_numbered_per_name() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let boss = boss(&mut b);
    let first_clutch = b.unit("Creature-0-1-1-1-101-0000000002", "Clutch", HOSTILE_FLAGS);
    let second_clutch = b.unit("Creature-0-1-1-1-101-0000000003", "Clutch", HOSTILE_FLAGS);
    let spark = b.unit("Pet-0-1-1-1-102-0000000004", "Spark", PET_FLAGS);
    b.fight.actors.set_owner(spark, mage);
    let bolt = b.spell(116, "Frostbolt");
    b.hit(1_000, mage, boss, bolt, 50_000, (950_000, 1_000_000))
        .hit(1_500, mage, first_clutch, bolt, 1_000, (99_000, 100_000))
        .hit(1_600, mage, second_clutch, bolt, 1_000, (99_000, 100_000))
        .position(1_000, boss, 0.0, 0.0)
        .position(2_000, second_clutch, 1.0, 0.0)
        .position(3_000, first_clutch, 2.0, 0.0)
        .position(4_000, spark, 3.0, 0.0);

    let replay = replay_of(&b.build());

    let unit = |actor, name: &str, kind| ReplayUnit {
        actor,
        name: name.into(),
        kind,
        spec_id: None,
        class_id: None,
        owner: None,
        add_number: None,
    };
    assert_eq!(
        replay.units,
        vec![
            ReplayUnit {
                spec_id: Some(62),
                class_id: Some(8),
                ..unit(mage, "Ilvaren", UnitKind::Player)
            },
            unit(boss, "Vexmora", UnitKind::Boss),
            ReplayUnit {
                add_number: Some(2),
                ..unit(first_clutch, "Clutch", UnitKind::Add)
            },
            ReplayUnit {
                add_number: Some(1),
                ..unit(second_clutch, "Clutch", UnitKind::Add)
            },
            ReplayUnit {
                owner: Some(mage),
                ..unit(spark, "Spark", UnitKind::Pet)
            },
        ]
    );
}

#[test]
fn health_is_thinned_to_100_ms_but_keeps_the_last_sample_before_death() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let druid = b.player("Player-2", "Thornwick", 105);
    let boss = boss(&mut b);
    let slam = b.spell(900_001, "Slam");
    let rebirth = b.spell(20484, "Rebirth");
    b.hit(1_000, boss, mage, slam, 10, (90, 100))
        .hit(1_030, boss, mage, slam, 10, (80, 100))
        .hit(1_060, boss, mage, slam, 10, (70, 100))
        .hit(1_110, boss, mage, slam, 70, (0, 100))
        .push(1_110, NOBODY, mage, MELEE, died())
        .push(1_140, druid, mage, rebirth, EventKind::Resurrect)
        .hit(1_150, boss, mage, slam, 10, (40, 100))
        .hit(1_300, boss, mage, slam, 0, (40, 100));

    let replay = replay_of(&b.build());

    assert_eq!(
        replay.health,
        vec![HealthTrack {
            actor: mage,
            t: vec![1_060, 1_110, 1_150],
            current: vec![70, 0, 40],
            max: vec![100, 100, 100],
        }]
    );
}

#[test]
fn boss_cast_bar_spans_start_to_success_and_interrupts_are_marked() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let boss = boss(&mut b);
    let onlooker = b.unit("Creature-0-1-1-1-200-0000000009", "Onlooker", HOSTILE_FLAGS);
    let inferno = b.spell(900_010, "Inferno");
    let quake = b.spell(900_011, "Quake");
    let roar = b.spell(900_012, "Roar");
    let counterspell = b.spell(2139, "Counterspell");
    b.position(0, boss, 0.0, 0.0)
        .push(2_000, boss, mage, inferno, EventKind::CastStart)
        .push(4_500, boss, mage, inferno, EventKind::CastSuccess)
        .push(6_000, boss, NOBODY, quake, EventKind::CastStart)
        .push(
            7_000,
            mage,
            boss,
            counterspell,
            EventKind::Interrupt { interrupted: quake },
        )
        .push(9_000, boss, NOBODY, roar, EventKind::CastSuccess)
        .push(9_500, onlooker, mage, roar, EventKind::CastSuccess);

    let replay = replay_of(&b.build());

    let cast = |spell, target, start_ms, end_ms, outcome| ReplayCast {
        caster: boss,
        spell,
        target,
        start_ms,
        end_ms,
        outcome,
    };
    assert_eq!(
        replay.casts,
        vec![
            cast(
                inferno,
                Some(mage),
                2_000,
                4_500,
                ReplayCastOutcome::Completed
            ),
            cast(quake, None, 6_000, 7_000, ReplayCastOutcome::Interrupted),
            cast(roar, None, 9_000, 9_000, ReplayCastOutcome::Completed),
        ]
    );
}

#[test]
fn a_channel_lasts_until_its_aura_ends() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let boss = boss(&mut b);
    let missiles = b.spell(5143, "Arcane Missiles");
    let tick = EventKind::Damage(damage(DamageVia::Spell, 1_000, 0));
    b.push(10_000, mage, boss, missiles, EventKind::CastSuccess)
        .push(
            10_000,
            mage,
            mage,
            missiles,
            aura(AuraAction::Applied, AuraType::Buff, None),
        )
        .push(10_400, mage, boss, missiles, tick)
        .push(10_800, mage, boss, missiles, tick)
        .push(
            11_200,
            mage,
            mage,
            missiles,
            aura(AuraAction::Removed, AuraType::Buff, None),
        );

    let replay = replay_of(&b.build());

    assert_eq!(
        replay.casts,
        vec![ReplayCast {
            caster: mage,
            spell: missiles,
            target: Some(boss),
            start_ms: 10_000,
            end_ms: 11_200,
            outcome: ReplayCastOutcome::Completed,
        }]
    );
}

#[test]
fn tick_casts_of_a_channel_are_not_cast_bars() {
    let mut b = FightBuilder::new(60_000);
    let priest = b.player("Player-1", "Ilvaren", 257);
    let hymn = b.spell(64843, "Divine Hymn");
    let ally = b.player("Player-2", "Torvik", 65);
    let hymn_tick = b.spell(64844, "Divine Hymn");
    b.push(10_000, priest, priest, hymn, EventKind::CastSuccess)
        .push(
            10_000,
            priest,
            priest,
            hymn,
            aura(AuraAction::Applied, AuraType::Buff, None),
        );
    for t in [11_000, 12_000, 13_000, 14_000] {
        b.push(t, priest, priest, hymn_tick, EventKind::CastSuccess)
            .push(t, priest, ally, hymn_tick, EventKind::Heal(heal(1_000, 0)));
    }
    b.push(
        14_000,
        priest,
        priest,
        hymn,
        aura(AuraAction::Removed, AuraType::Buff, None),
    );

    let replay = replay_of(&b.build());

    assert_eq!(
        replay.casts,
        vec![ReplayCast {
            caster: priest,
            spell: hymn,
            target: Some(priest),
            start_ms: 10_000,
            end_ms: 14_000,
            outcome: ReplayCastOutcome::Completed,
        }]
    );
}

#[test]
fn raid_frame_priority_follows_the_curated_rules() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let priest = b.player("Player-2", "Somra", 256);
    let death_knight = b.player("Player-3", "Grimhold", 250);
    let boss = boss(&mut b);
    let searing = b.spell(900_020, "Searing Mark");
    let doom = b.spell(900_021, "Lingering Doom");
    let auras = [
        (boss, searing, AuraType::Debuff),
        (boss, doom, AuraType::Debuff),
        (priest, PAIN_SUPPRESSION, AuraType::Buff),
        (mage, ICE_BLOCK, AuraType::Buff),
        (death_knight, ANTI_MAGIC_ZONE, AuraType::Buff),
        (mage, ARCANE_INTELLECT, AuraType::Buff),
    ];
    for (source, spell, aura_type) in auras {
        b.push(
            1_000,
            source,
            mage,
            spell,
            aura(AuraAction::Applied, aura_type, None),
        )
        .push(
            5_000,
            source,
            mage,
            spell,
            aura(AuraAction::Removed, aura_type, None),
        );
    }
    let fight = b.build();
    let mut curated = Curated::bundled();
    curated.raid_frame_auras.exclude.push(doom);

    let replay = replay(
        &fight,
        &curated,
        &ChannelSpells::default(),
        &SpellClasses::default(),
    );

    let mut frames: Vec<(SpellId, bool, Option<u8>)> = replay
        .auras
        .iter()
        .map(|aura| (aura.spell, aura.buff, aura.raid_frame))
        .collect();
    frames.sort_unstable();
    assert_eq!(
        frames,
        vec![
            (ARCANE_INTELLECT, true, None),
            (PAIN_SUPPRESSION, true, Some(0)),
            (ICE_BLOCK, true, Some(20)),
            (ANTI_MAGIC_ZONE, true, Some(30)),
            (searing, false, Some(10)),
            (doom, false, None),
        ]
    );
}

#[test]
fn a_debuff_keeps_its_hostile_rank_when_its_source_turns_friendly() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let boss = boss(&mut b);
    let searing = b.spell(900_020, "Searing Mark");
    b.push(
        1_000,
        boss,
        mage,
        searing,
        aura(AuraAction::Applied, AuraType::Debuff, None),
    );
    b.unit("Creature-0-1-1-1-100-0000000001", "Vexmora", NEUTRAL_FLAGS);
    b.push(
        5_000,
        boss,
        mage,
        searing,
        aura(AuraAction::Removed, AuraType::Debuff, None),
    );

    let replay = replay_of(&b.build());

    assert_eq!(replay.auras[0].raid_frame, Some(10));
}

#[test]
fn aura_stacks_follow_the_logged_doses() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let boss = boss(&mut b);
    let venom = b.spell(900_030, "Venom");
    let brand = b.spell(900_031, "Brand");
    let debuff = |action, stacks| aura(action, AuraType::Debuff, stacks);
    b.push(1_000, boss, mage, venom, debuff(AuraAction::Applied, None))
        .push(
            2_000,
            boss,
            mage,
            venom,
            debuff(AuraAction::AppliedDose, Some(2)),
        )
        .push(
            3_000,
            boss,
            mage,
            venom,
            debuff(AuraAction::AppliedDose, Some(3)),
        )
        .push(
            4_000,
            boss,
            mage,
            venom,
            debuff(AuraAction::RemovedDose, Some(2)),
        )
        .push(5_000, boss, mage, venom, debuff(AuraAction::Removed, None))
        .push(-2_000, boss, mage, brand, debuff(AuraAction::Applied, None))
        .push(
            -1_000,
            boss,
            mage,
            brand,
            debuff(AuraAction::AppliedDose, Some(4)),
        )
        .push(
            1_500,
            boss,
            mage,
            brand,
            debuff(AuraAction::AppliedDose, Some(5)),
        )
        .push(3_000, boss, mage, brand, debuff(AuraAction::Removed, None));

    let replay = replay_of(&b.build());

    let stacks_of = |spell| {
        let aura = replay.auras.iter().find(|a| a.spell == spell).unwrap();
        let changes: Vec<(i32, u32)> = aura
            .stacks
            .iter()
            .map(|&StackChange { t, stacks }| (t, stacks))
            .collect();
        (aura.start_ms, aura.end_ms, changes)
    };
    assert_eq!(
        stacks_of(venom),
        (1_000, 5_000, vec![(2_000, 2), (3_000, 3), (4_000, 2)])
    );
    assert_eq!(stacks_of(brand), (0, 3_000, vec![(0, 4), (1_500, 5)]));
}

#[test]
fn a_battle_rez_ends_the_death() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let druid = b.player("Player-2", "Thornwick", 105);
    let clutch = b.unit("Creature-0-1-1-1-101-0000000002", "Clutch", HOSTILE_FLAGS);
    let rebirth = b.spell(20484, "Rebirth");
    b.position(0, clutch, 0.0, 0.0)
        .push(5_000, NOBODY, mage, MELEE, died())
        .push(7_000, mage, clutch, MELEE, died())
        .push(9_000, druid, mage, rebirth, EventKind::Resurrect);

    let replay = replay_of(&b.build());

    assert_eq!(
        replay.deaths,
        vec![
            ReplayDeath {
                actor: mage,
                t: 5_000,
                until: Some(9_000),
            },
            ReplayDeath {
                actor: clutch,
                t: 7_000,
                until: None,
            },
        ]
    );
}

#[test]
fn a_death_without_a_resurrect_ends_when_the_player_shows_hp_again() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let boss = boss(&mut b);
    let slam = b.spell(900_001, "Slam");
    b.push(5_000, NOBODY, mage, MELEE, died())
        .hit(12_000, boss, mage, slam, 10, (50, 100));

    let replay = replay_of(&b.build());

    assert_eq!(
        replay.deaths,
        vec![ReplayDeath {
            actor: mage,
            t: 5_000,
            until: Some(12_000),
        }]
    );
}

#[test]
fn phases_match_the_quick_overview() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let boss = boss(&mut b);
    let bolt = b.spell(116, "Frostbolt");
    let mut hp = 1_000_000;
    for second in (1..=10).chain(31..=40) {
        hp -= 10_000;
        b.hit(second * 1_000, mage, boss, bolt, 10_000, (hp, 1_000_000));
    }
    let fight = b.build();

    let replay = replay_of(&fight);

    assert_eq!(replay.phases.len(), 3);
    assert_eq!(
        replay.phases,
        quick_overview(&fight, &Curated::bundled()).timeline.phases
    );
}

#[test]
fn trash_killed_before_the_pull_is_left_out() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let boss = boss(&mut b);
    let trash = b.unit(
        "Creature-0-1-1-1-103-0000000005",
        "Gloomfang",
        HOSTILE_FLAGS,
    );
    let clutch = b.unit("Creature-0-1-1-1-101-0000000002", "Clutch", HOSTILE_FLAGS);
    b.position(-4_000, trash, 9.0, 9.0)
        .push(-3_000, mage, trash, MELEE, died())
        .position(-1_000, clutch, 1.0, 1.0)
        .position(2_000, clutch, 2.0, 1.0)
        .position(1_000, boss, 0.0, 0.0)
        .push(8_000, mage, clutch, MELEE, died());

    let replay = replay_of(&b.build());

    let units: Vec<ActorId> = replay.units.iter().map(|unit| unit.actor).collect();
    assert_eq!(units, [mage, boss, clutch]);
    assert!(replay.tracks.iter().all(|track| track.actor != trash));
    assert_eq!(
        replay.deaths,
        vec![ReplayDeath {
            actor: clutch,
            t: 8_000,
            until: None,
        }]
    );
}

fn bounds(ui_map_id: u32) -> MapBounds {
    MapBounds {
        ui_map_id,
        min_x: -10.0,
        max_x: 10.0,
        min_y: -20.0,
        max_y: 20.0,
    }
}

#[test]
fn tracks_carry_the_floor_per_sample() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    b.position_on(-600, mage, 1.0, 1.0, 2601)
        .position_on(-300, mage, 2.0, 2.0, 2602)
        .position_on(500, mage, 3.0, 3.0, 2602)
        .position_on(900, mage, 4.0, 4.0, 2603);

    let replay = replay_of(&b.build());

    assert_eq!(replay.tracks[0].t, vec![-300, 500, 900]);
    assert_eq!(replay.tracks[0].map, vec![2602, 2602, 2603]);
}

#[test]
fn the_bundle_lists_bounds_for_the_floors_it_uses() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let priest = b.player("Player-2", "Somra", 256);
    b.position_on(-600, mage, 1.0, 1.0, 2700)
        .position_on(-300, mage, 2.0, 2.0, 2608)
        .position_on(500, priest, 3.0, 3.0, 2609)
        .position_on(800, priest, 3.0, 3.0, 2650);
    b.fight.map_bounds = vec![bounds(2600), bounds(2608), bounds(2609), bounds(2700)];

    let replay = replay_of(&b.build());

    assert_eq!(replay.maps, vec![bounds(2608), bounds(2609)]);
}

#[test]
fn an_arena_frame_reaches_the_bundle() {
    let mut b = FightBuilder::new(60_000);
    b.player("Player-1", "Ilvaren", 62);
    let fight = b.build();
    let frame = |encounter_id| ArenaFrame {
        encounter_id,
        ui_map_id: 2608,
        x: 512.5,
        y: -340.25,
        size_yd: 110.0,
    };
    let mut curated = Curated::bundled();
    curated.arena_frames = vec![frame(fight.encounter_id + 1), frame(fight.encounter_id)];

    let replay = replay(
        &fight,
        &curated,
        &ChannelSpells::default(),
        &SpellClasses::default(),
    );

    assert_eq!(replay.arena_frame, Some(frame(fight.encounter_id)));
}

#[test]
fn replay_power_keeps_the_primary_power_per_unit() {
    let mut b = FightBuilder::new(60_000);
    let rogue = b.player("Player-1", "Ilvaren", 261);
    b.power(-500, rogue, 3, 90, 100)
        .secondary_power(-500, rogue, 4, 2, 5)
        .power(1_000, rogue, 3, 60, 100)
        .secondary_power(1_000, rogue, 4, 3, 5)
        .power(1_500, rogue, 3, 60, 100)
        .power(2_000, rogue, 3, 85, 100);

    let replay = replay_of(&b.build());

    assert_eq!(
        replay.power,
        vec![ReplayPowerTrack {
            actor: rogue,
            power_type: 3,
            t: vec![0, 1_000, 2_000],
            current: vec![90, 60, 85],
            max: vec![100, 100, 100],
        }]
    );
}

#[test]
fn bosses_get_power_tracks_from_their_advanced_blocks() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let boss = boss(&mut b);
    b.position(0, mage, 0.0, 0.0)
        .position(0, boss, 5.0, 5.0)
        .npc_power(1_000, boss, 3, 40, 100);

    let replay = replay_of(&b.build());

    assert_eq!(
        replay.power,
        vec![ReplayPowerTrack {
            actor: boss,
            power_type: 3,
            t: vec![1_000],
            current: vec![40],
            max: vec![100],
        }]
    );
}

#[test]
fn a_unit_logging_an_empty_power_pool_has_no_power_track() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let boss = boss(&mut b);
    let add = b.unit(
        "Creature-0-1-1-1-200-0000000002",
        "Grasping Tendril",
        HOSTILE_FLAGS,
    );
    b.position(0, mage, 0.0, 0.0)
        .position(0, boss, 5.0, 5.0)
        .position(0, add, 8.0, 8.0)
        .npc_power(1_000, boss, 3, 40, 100)
        .npc_power(1_000, add, 1, 0, 0)
        .npc_power(2_000, add, 1, 0, 0);

    let replay = replay_of(&b.build());

    assert_eq!(
        replay
            .power
            .iter()
            .map(|track| track.actor)
            .collect::<Vec<_>>(),
        vec![boss]
    );
}

fn swing(via: DamageVia) -> EventKind {
    EventKind::Damage(damage(via, 100, 0))
}

#[test]
fn a_bosses_target_follows_its_melee_swings() {
    let mut b = FightBuilder::new(60_000);
    let tank_a = b.player("Player-1", "Ilvaren", 73);
    let tank_b = b.player("Player-2", "Thornwick", 66);
    let boss = boss(&mut b);
    b.position(0, boss, 5.0, 5.0)
        .push(1_000, boss, tank_a, MELEE, swing(DamageVia::Swing))
        .push(1_000, boss, tank_a, MELEE, swing(DamageVia::SwingLanded))
        .push(2_000, boss, tank_a, MELEE, swing(DamageVia::Swing))
        .push(
            3_000,
            boss,
            tank_b,
            MELEE,
            EventKind::Missed(openlogs_analysis::Missed {
                via: DamageVia::Swing,
                miss_type: openlogs_analysis::MissType::Dodge,
                amount_missed: 0,
                critical: false,
            }),
        );

    let replay = replay_of(&b.build());

    assert_eq!(
        replay.targets,
        vec![TargetTrack {
            actor: boss,
            t: vec![1_000, 3_000],
            target: vec![tank_a, tank_b],
        }]
    );
}

#[test]
fn a_cast_with_a_target_sets_the_target_and_repeats_are_not_stored() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let boss = boss(&mut b);
    let bolt = b.spell(116, "Frostbolt");
    b.position(0, boss, 5.0, 5.0)
        .push(1_000, mage, boss, bolt, EventKind::CastSuccess)
        .push(2_500, mage, boss, bolt, EventKind::CastSuccess)
        .push(3_000, mage, NOBODY, bolt, EventKind::CastSuccess);

    let replay = replay_of(&b.build());

    assert_eq!(
        replay.targets,
        vec![TargetTrack {
            actor: mage,
            t: vec![1_000],
            target: vec![boss],
        }]
    );
}

#[test]
fn a_target_before_the_pull_is_kept_at_zero() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let boss = boss(&mut b);
    let bolt = b.spell(116, "Frostbolt");
    b.position(0, boss, 5.0, 5.0)
        .push(-3_000, mage, boss, bolt, EventKind::CastSuccess)
        .push(-1_000, mage, boss, bolt, EventKind::CastSuccess);

    let replay = replay_of(&b.build());

    assert_eq!(
        replay.targets,
        vec![TargetTrack {
            actor: mage,
            t: vec![0],
            target: vec![boss],
        }]
    );
}

#[test]
fn self_casts_and_casts_on_units_outside_the_roster_keep_the_target() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let boss = boss(&mut b);
    let critter = b.unit(
        "Creature-0-1-1-1-300-0000000003",
        "Dusk Moth",
        NEUTRAL_FLAGS,
    );
    let bolt = b.spell(116, "Frostbolt");
    let barrier = b.spell(11426, "Ice Barrier");
    b.position(0, boss, 5.0, 5.0)
        .push(1_000, mage, boss, bolt, EventKind::CastSuccess)
        .push(2_000, mage, mage, barrier, EventKind::CastSuccess)
        .push(3_000, mage, critter, bolt, EventKind::CastSuccess);

    let replay = replay_of(&b.build());

    assert_eq!(
        replay.targets,
        vec![TargetTrack {
            actor: mage,
            t: vec![1_000],
            target: vec![boss],
        }]
    );
}

const MYSTIC_TOUCH: SpellId = 113746;
const SATED: SpellId = 57724;

/// A loaded spell-classes table listing `class_spells`, of which `crowd_control` take control.
fn spell_classes(class_spells: &[SpellId], crowd_control: &[SpellId]) -> SpellClasses {
    let deltas = |ids: &[SpellId]| {
        let mut ids = ids.to_vec();
        ids.sort_unstable();
        let mut previous = 0;
        ids.iter()
            .map(|&id| {
                let delta = id - previous;
                previous = id;
                delta.to_string()
            })
            .collect::<Vec<_>>()
            .join(",")
    };
    SpellClasses::from_json(&format!(
        r#"{{ "classSpells": [{}], "crowdControl": [{}] }}"#,
        deltas(class_spells),
        deltas(crowd_control)
    ))
    .unwrap()
}

fn apply_aura(
    b: &mut FightBuilder,
    source: ActorId,
    target: ActorId,
    spell: SpellId,
    aura_type: AuraType,
) {
    b.push(
        1_000,
        source,
        target,
        spell,
        aura(AuraAction::Applied, aura_type, None),
    )
    .push(
        5_000,
        source,
        target,
        spell,
        aura(AuraAction::Removed, aura_type, None),
    );
}

/// Each aura's spell with its category and crediting player.
fn categorised(
    fight: &Fight,
    spell_classes: &SpellClasses,
) -> Vec<(SpellId, AuraCategory, Option<ActorId>)> {
    let replay = replay(
        fight,
        &Curated::bundled(),
        &ChannelSpells::default(),
        spell_classes,
    );
    let mut auras: Vec<_> = replay
        .auras
        .iter()
        .map(|aura| (aura.spell, aura.category, aura.source_player))
        .collect();
    auras.sort_unstable_by_key(|&(spell, ..)| spell);
    auras
}

#[test]
fn a_hostile_debuff_is_encounter() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let boss = boss(&mut b);
    let shackle = b.spell(900_040, "Shadow Shackle");
    apply_aura(&mut b, boss, mage, shackle, AuraType::Debuff);

    let auras = categorised(&b.build(), &spell_classes(&[shackle], &[shackle]));

    assert_eq!(auras, vec![(shackle, AuraCategory::Encounter, None)]);
}

#[test]
fn a_mechanic_spread_by_a_player_is_encounter() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let priest = b.player("Player-2", "Somra", 256);
    let blight = b.spell(900_041, "Spreading Blight");
    apply_aura(&mut b, mage, priest, blight, AuraType::Debuff);

    let auras = categorised(&b.build(), &spell_classes(&[ICE_BLOCK], &[]));

    assert_eq!(auras, vec![(blight, AuraCategory::Encounter, Some(mage))]);
}

#[test]
fn a_class_stun_is_crowd_control() {
    let mut b = FightBuilder::new(60_000);
    let rogue = b.player("Player-1", "Tavish", 259);
    let boss = boss(&mut b);
    let stun = b.spell(900_042, "Gut Strike");
    b.position(0, boss, 0.0, 0.0);
    apply_aura(&mut b, rogue, boss, stun, AuraType::Debuff);

    let auras = categorised(&b.build(), &spell_classes(&[stun], &[stun]));

    assert_eq!(auras, vec![(stun, AuraCategory::CrowdControl, Some(rogue))]);
}

#[test]
fn a_curated_amp_is_amp() {
    let mut b = FightBuilder::new(60_000);
    let monk = b.player("Player-1", "Lirien", 269);
    let boss = boss(&mut b);
    b.position(0, boss, 0.0, 0.0);
    apply_aura(&mut b, monk, boss, MYSTIC_TOUCH, AuraType::Debuff);

    let auras = categorised(&b.build(), &spell_classes(&[MYSTIC_TOUCH], &[]));

    assert_eq!(auras, vec![(MYSTIC_TOUCH, AuraCategory::Amp, Some(monk))]);
}

#[test]
fn a_defensive_buff_is_cooldown() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    apply_aura(&mut b, mage, mage, ICE_BLOCK, AuraType::Buff);
    apply_aura(&mut b, mage, mage, ARCANE_INTELLECT, AuraType::Buff);

    let auras = categorised(
        &b.build(),
        &spell_classes(&[ICE_BLOCK, ARCANE_INTELLECT], &[ICE_BLOCK]),
    );

    assert_eq!(
        auras,
        vec![
            (ARCANE_INTELLECT, AuraCategory::Other, Some(mage)),
            (ICE_BLOCK, AuraCategory::Cooldown, Some(mage)),
        ]
    );
}

#[test]
fn a_lockout_debuff_is_other_even_without_a_class_family() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let sated = b.spell(SATED, "Sated");
    apply_aura(&mut b, mage, mage, sated, AuraType::Debuff);

    let auras = categorised(&b.build(), &spell_classes(&[ICE_BLOCK], &[]));

    assert_eq!(auras, vec![(SATED, AuraCategory::Other, Some(mage))]);
}

#[test]
fn a_class_dot_is_other_and_credits_the_pet_owner() {
    let mut b = FightBuilder::new(60_000);
    let hunter = b.player("Player-1", "Corvane", 253);
    let wolf = b.unit("Pet-0-1-1-1-102-0000000004", "Wolf", PET_FLAGS);
    b.fight.actors.set_owner(wolf, hunter);
    let boss = boss(&mut b);
    let bite = b.spell(900_043, "Venom Bite");
    b.position(0, boss, 0.0, 0.0);
    apply_aura(&mut b, wolf, boss, bite, AuraType::Debuff);

    let auras = categorised(&b.build(), &spell_classes(&[bite], &[]));

    assert_eq!(auras, vec![(bite, AuraCategory::Other, Some(hunter))]);
}

#[test]
fn without_spell_classes_encounter_is_the_hostile_source_only() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let priest = b.player("Player-2", "Somra", 256);
    let boss = boss(&mut b);
    let shackle = b.spell(900_040, "Shadow Shackle");
    let blight = b.spell(900_041, "Spreading Blight");
    b.position(0, boss, 0.0, 0.0);
    apply_aura(&mut b, boss, mage, shackle, AuraType::Debuff);
    apply_aura(&mut b, mage, priest, blight, AuraType::Debuff);
    apply_aura(&mut b, priest, boss, MYSTIC_TOUCH, AuraType::Debuff);

    let auras = categorised(&b.build(), &SpellClasses::default());

    assert_eq!(
        auras,
        vec![
            (MYSTIC_TOUCH, AuraCategory::Amp, Some(priest)),
            (shackle, AuraCategory::Encounter, None),
            (blight, AuraCategory::Other, Some(mage)),
        ]
    );
}

#[test]
fn a_trinket_debuff_a_player_puts_on_a_boss_is_other() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Ilvaren", 62);
    let boss = boss(&mut b);
    let rune = b.spell(900_044, "Rune of Lingering");
    b.position(0, boss, 0.0, 0.0);
    apply_aura(&mut b, mage, boss, rune, AuraType::Debuff);

    let auras = categorised(&b.build(), &spell_classes(&[ICE_BLOCK], &[]));

    assert_eq!(auras, vec![(rune, AuraCategory::Other, Some(mage))]);
}
