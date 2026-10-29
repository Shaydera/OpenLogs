mod support;

use openlogs_analysis::{
    AbilityAmount, Absorbed, Damage, DamageVia, EventKind, Heal, LethalBurst, MissType, Missed,
    NOBODY, Resurrection, UnitHp, deaths,
};
use support::{FightBuilder, HOSTILE_FLAGS, MELEE, damage, heal};

#[test]
fn death_with_killing_blow_window_and_hp_before() {
    let mut b = FightBuilder::new(60_000);
    let player = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let spit = b.spell(1, "Virulent Spit");
    let venom = b.spell(2, "Deadly Venom");
    b.fight.events.push(openlogs_analysis::Event {
        t: 30_000,
        source: boss,
        target: player,
        spell: venom,
        kind: EventKind::Damage(damage(DamageVia::Periodic, 10, 0)),
        source_hostile: true,
        target_hostile: false,
        unit_hp: Some(UnitHp {
            actor: player,
            current: 830,
            max: 1_000,
        }),
    });
    b.push(
        36_000,
        boss,
        player,
        venom,
        EventKind::Damage(damage(DamageVia::Periodic, 100, 0)),
    );
    b.push(
        37_000,
        boss,
        player,
        spit,
        EventKind::Damage(damage(DamageVia::Spell, 400, 0)),
    );
    b.push(37_500, NOBODY, player, 3, EventKind::Heal(heal(300, 100)));
    b.push(
        38_000,
        boss,
        player,
        spit,
        EventKind::Damage(damage(DamageVia::Spell, 600, 50)),
    );
    b.push(
        38_000,
        NOBODY,
        player,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    let fight = b.build();

    let deaths = deaths(&fight);
    assert_eq!(deaths.len(), 1);
    let death = &deaths[0];
    assert_eq!((death.player, death.t), (player, 38_000));
    let kb = death.killing_blow.unwrap();
    assert_eq!(
        (kb.t, kb.spell, kb.source, kb.amount, kb.overkill),
        (38_000, spit, boss, 600, 50)
    );
    assert_eq!(
        death.damage_last_5s,
        [
            AbilityAmount {
                spell: spit,
                amount: 1_000,
                environmental: false,
            },
            AbilityAmount {
                spell: venom,
                amount: 100,
                environmental: false,
            }
        ]
    );
    assert_eq!(
        (death.damage_taken_5s, death.healing_taken_5s),
        (1_100, 200)
    );
    assert_eq!(death.hp_5s_before_pct, Some(83.0));
    assert_eq!(death.resurrected_at, None);
}

#[test]
fn healing_before_death_counts_shields_and_absorbed_heals_but_no_support_shares() {
    let mut b = FightBuilder::new(60_000);
    let player = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let priest = b.player("Player-2", "Mirelle-Emberfall-EU", 256);
    let evoker = b.player("Player-3", "Ysolde-Emberfall-EU", 1473);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let flash_heal = b.spell(3, "Flash Heal");
    b.push(
        36_000,
        priest,
        player,
        flash_heal,
        EventKind::Heal(heal(300, 100)),
    );
    b.push(
        36_000,
        priest,
        player,
        flash_heal,
        EventKind::Heal(Heal {
            supporter: evoker,
            ..heal(60, 0)
        }),
    );
    b.push(
        36_500,
        priest,
        player,
        flash_heal,
        EventKind::Heal(Heal {
            absorbed: 120,
            ..heal(0, 0)
        }),
    );
    b.push(
        37_000,
        boss,
        player,
        1,
        EventKind::Absorbed(Absorbed {
            absorber: priest,
            absorb_spell: 17,
            amount: 150,
            supporter: NOBODY,
        }),
    );
    b.push(
        38_000,
        NOBODY,
        player,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    let fight = b.build();

    assert_eq!(deaths(&fight)[0].healing_taken_5s, 470);
}

#[test]
fn damage_before_death_counts_what_shields_absorbed() {
    let mut b = FightBuilder::new(60_000);
    let player = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let spit = b.spell(1, "Virulent Spit");
    b.push(
        36_000,
        boss,
        player,
        spit,
        EventKind::Damage(Damage {
            absorbed: 100,
            ..damage(DamageVia::Spell, 300, 0)
        }),
    );
    b.push(
        37_000,
        boss,
        player,
        spit,
        EventKind::Missed(Missed {
            via: DamageVia::Spell,
            miss_type: MissType::Absorb,
            amount_missed: 250,
            critical: false,
        }),
    );
    b.push(
        38_000,
        NOBODY,
        player,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    let death = &deaths(&b.build())[0];

    assert_eq!(
        death.damage_last_5s,
        [AbilityAmount {
            spell: spit,
            amount: 650,
            environmental: false,
        }]
    );
    assert_eq!(death.damage_taken_5s, 650);
}

#[test]
fn melee_killing_blow_and_landed_copy_counted_once() {
    let mut b = FightBuilder::new(60_000);
    let player = b.player("Player-1", "Wendel-Emberfall-EU", 71);
    let add = b.unit("Creature-0-1-1-1-1-01", "Gore Rattle", HOSTILE_FLAGS);
    b.push(
        33_100,
        add,
        player,
        MELEE,
        EventKind::Damage(damage(DamageVia::Swing, 2_420_251, 1_380_351)),
    );
    b.push(
        33_100,
        add,
        player,
        MELEE,
        EventKind::Damage(damage(DamageVia::SwingLanded, 2_420_251, 1_380_351)),
    );
    b.push(
        33_200,
        NOBODY,
        player,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    let fight = b.build();
    let death = &deaths(&fight)[0];
    let kb = death.killing_blow.unwrap();
    assert_eq!((kb.spell, kb.source, kb.amount), (MELEE, add, 2_420_251));
    assert_eq!(death.damage_taken_5s, 2_420_251);
}

#[test]
fn only_a_lethal_last_hit_is_a_killing_blow() {
    let spell_hit =
        |amount, overkill| EventKind::Damage(damage(DamageVia::Spell, amount, overkill));
    let cases = [
        (
            "non-lethal last hit",
            spell_hit(26_000, 0),
            Some(458_000),
            None,
        ),
        (
            "zero HP left",
            spell_hit(300_000, 0),
            Some(0),
            Some((300_000, 0)),
        ),
        (
            "overkill",
            spell_hit(300_000, 40_000),
            None,
            Some((300_000, 40_000)),
        ),
        ("instakill", EventKind::Instakill, None, Some((0, 0))),
    ];
    for (case, kind, hp_left, expected) in cases {
        let mut b = FightBuilder::new(60_000);
        let player = b.player("Player-1", "Faelan-Emberfall-EU", 62);
        let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
        let spit = b.spell(1, "Virulent Spit");
        b.fight.events.push(openlogs_analysis::Event {
            t: 9_000,
            source: boss,
            target: player,
            spell: spit,
            kind,
            source_hostile: true,
            target_hostile: false,
            unit_hp: hp_left.map(|current| UnitHp {
                actor: player,
                current,
                max: 1_000_000,
            }),
        });
        b.push(
            9_500,
            NOBODY,
            player,
            MELEE,
            EventKind::Died { unconscious: false },
        );
        let killing_blow = deaths(&b.build())[0].killing_blow;
        assert_eq!(
            killing_blow.map(|kb| (kb.spell, kb.source, kb.amount, kb.overkill)),
            expected.map(|(amount, overkill)| (spit, boss, amount, overkill)),
            "{case}"
        );
    }
}

#[test]
fn death_after_battle_res_counts_again() {
    let mut b = FightBuilder::new(60_000);
    let player = b.player("Player-1", "Wendel-Emberfall-EU", 71);
    let druid = b.player("Player-2", "Serrik-Silverbrook-EU", 105);
    let rebirth = b.spell(20484, "Rebirth");
    b.push(
        10_000,
        NOBODY,
        player,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    b.push(14_000, druid, player, rebirth, EventKind::Resurrect);
    b.push(
        40_000,
        NOBODY,
        player,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    // A second resurrect of the same life changes nothing.
    b.push(15_000, NOBODY, player, 0, EventKind::Resurrect);
    let deaths = deaths(&b.build());
    assert_eq!(deaths.len(), 2);
    assert_eq!(
        (deaths[0].resurrected_at, deaths[0].dead_until),
        (Some(14_000), Some(14_000))
    );
    assert_eq!(
        deaths[0].resurrected_by,
        Some(Resurrection {
            spell: rebirth,
            source: druid
        })
    );
    assert_eq!((deaths[1].t, deaths[1].resurrected_at), (40_000, None));
}

#[test]
fn second_unit_died_without_resurrect_is_the_same_death() {
    let mut b = FightBuilder::new(60_000);
    let druid = b.player("Player-1", "Pyrrin-Emberfall-EU", 105);
    for t in [10_000, 25_000] {
        b.push(
            t,
            NOBODY,
            druid,
            MELEE,
            EventKind::Died { unconscious: false },
        );
    }
    let deaths = deaths(&b.build());
    assert_eq!(deaths.iter().map(|d| d.t).collect::<Vec<_>>(), [10_000]);
}

#[test]
fn npc_and_prelude_deaths_are_ignored() {
    let mut b = FightBuilder::new(60_000);
    let player = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let add = b.unit("Creature-0-1-1-1-1-01", "Gore Rattle", HOSTILE_FLAGS);
    b.push(
        -3_000,
        NOBODY,
        player,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    b.push(
        5_000,
        player,
        add,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    assert!(deaths(&b.build()).is_empty());
}

#[test]
fn feign_death_is_not_a_death() {
    let mut b = FightBuilder::new(300_000);
    let hunter = b.player("Player-1", "Mira-Emberfall-EU", 253);
    let kill_command = b.spell(34026, "Kill Command");
    b.push(
        21_000,
        NOBODY,
        hunter,
        MELEE,
        EventKind::Died { unconscious: true },
    );
    b.push(23_000, hunter, NOBODY, kill_command, EventKind::CastSuccess);
    b.push(
        226_000,
        NOBODY,
        hunter,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    let deaths = deaths(&b.build());
    assert_eq!(deaths.len(), 1);
    assert_eq!(deaths[0].t, 226_000);
}

#[test]
fn reincarnation_ends_the_death() {
    let mut b = FightBuilder::new(600_000);
    let shaman = b.player("Player-1", "Nadrik-Emberfall-EU", 264);
    let reincarnation = b.spell(21169, "Reincarnation");
    let other = b.spell(1064, "Chain Heal");
    b.push(
        291_000,
        NOBODY,
        shaman,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    // A cast of another spell does not revive anybody.
    b.push(292_000, shaman, NOBODY, other, EventKind::CastSuccess);
    b.push(
        297_000,
        shaman,
        NOBODY,
        reincarnation,
        EventKind::CastSuccess,
    );
    b.push(
        424_000,
        NOBODY,
        shaman,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    let deaths = deaths(&b.build());
    assert_eq!(deaths.len(), 2);
    assert_eq!(deaths[0].resurrected_at, Some(297_000));
    assert_eq!(deaths[1].t, 424_000);
}

#[test]
fn the_lethal_burst_counts_close_hits_of_the_killing_spell() {
    let mut b = FightBuilder::new(60_000);
    let player = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let spit = b.spell(1, "Virulent Spit");
    let venom = b.spell(2, "Deadly Venom");
    // A Spit 3.1 s before the burst is not part of it; Deadly Venom in between does not break it.
    b.push(
        35_000,
        boss,
        player,
        spit,
        EventKind::Damage(damage(DamageVia::Spell, 100, 0)),
    );
    b.push(
        38_100,
        boss,
        player,
        spit,
        EventKind::Damage(damage(DamageVia::Spell, 300, 0)),
    );
    b.push(
        38_500,
        boss,
        player,
        venom,
        EventKind::Damage(damage(DamageVia::Periodic, 50, 0)),
    );
    b.push(
        39_100,
        boss,
        player,
        spit,
        EventKind::Damage(damage(DamageVia::Spell, 400, 120)),
    );
    b.push(
        39_100,
        NOBODY,
        player,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    let death = &deaths(&b.build())[0];
    assert_eq!(
        death.lethal_burst,
        Some(LethalBurst {
            spell: spit,
            count: 2,
            window_ms: 1_000
        })
    );
    assert_eq!(death.resurrected_by, None);
}

/// A player's own HP snapshot, as a cast's advanced block reports it.
fn own_hp(b: &mut FightBuilder, t: i32, player: u32, current: u64) {
    b.fight.events.push(openlogs_analysis::Event {
        t,
        source: player,
        target: NOBODY,
        spell: 116,
        kind: EventKind::CastSuccess,
        source_hostile: false,
        target_hostile: false,
        unit_hp: Some(UnitHp {
            actor: player,
            current,
            max: 1_000,
        }),
    });
}

#[test]
fn a_released_player_is_dead_until_alive_again() {
    // Mythic+: the player releases and runs back; the log has no resurrect, but his next
    // cast reports him with HP again.
    let mut b = FightBuilder::new(600_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let boss = b.unit(
        "Creature-0-1-1-1-207939-01",
        "Baron Braunpyke",
        HOSTILE_FLAGS,
    );
    b.push(
        260_000,
        NOBODY,
        mage,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    own_hp(&mut b, 260_500, mage, 0);
    // A projectile in flight lands after the death: no sign of life.
    b.push(
        261_000,
        mage,
        boss,
        44425,
        EventKind::Damage(damage(DamageVia::Spell, 100, 0)),
    );
    own_hp(&mut b, 300_000, mage, 900);
    b.push(
        400_000,
        NOBODY,
        mage,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    let deaths = deaths(&b.build());
    let spans: Vec<_> = deaths
        .iter()
        .map(|d| (d.t, d.resurrected_at, d.dead_until))
        .collect();
    assert_eq!(
        spans,
        vec![(260_000, None, Some(300_000)), (400_000, None, None)],
        "alive at the first own HP snapshot above 0; the next death counts"
    );
}

#[test]
fn the_death_window_starts_at_the_last_full_hp_sample() {
    let mut b = FightBuilder::new(60_000);
    let player = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    own_hp(&mut b, 1_000, player, 1_000);
    own_hp(&mut b, 4_000, player, 1_000);
    own_hp(&mut b, 6_000, player, 600);
    b.push(
        9_000,
        NOBODY,
        player,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    let deaths = deaths(&b.build());
    assert_eq!(
        (deaths[0].life_start_ms, deaths[0].last_full_hp_ms),
        (0, Some(4_000))
    );
}

#[test]
fn a_death_after_a_battle_res_starts_its_life_at_the_return() {
    let mut b = FightBuilder::new(60_000);
    let player = b.player("Player-1", "Wendel-Emberfall-EU", 71);
    own_hp(&mut b, 2_000, player, 1_000);
    b.push(
        5_000,
        NOBODY,
        player,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    own_hp(&mut b, 20_000, player, 500);
    b.push(
        30_000,
        NOBODY,
        player,
        MELEE,
        EventKind::Died { unconscious: false },
    );
    let deaths = deaths(&b.build());
    assert_eq!(
        (deaths[1].life_start_ms, deaths[1].last_full_hp_ms),
        (20_000, None)
    );
}
