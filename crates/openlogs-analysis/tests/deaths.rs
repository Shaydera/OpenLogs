mod support;

use openlogs_analysis::{DamageVia, EventKind, NOBODY, UnitHp, deaths};
use support::{FightBuilder, HOSTILE_FLAGS, MELEE, damage};

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
    let deaths = deaths(&b.build());
    assert_eq!(
        deaths.iter().map(|d| d.t).collect::<Vec<_>>(),
        [10_000, 40_000]
    );
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
    b.push(
        291_000,
        NOBODY,
        shaman,
        MELEE,
        EventKind::Died { unconscious: false },
    );
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
    assert_eq!(
        deaths.iter().map(|d| d.t).collect::<Vec<_>>(),
        [291_000, 424_000]
    );
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
fn a_released_player_dies_again_once_alive() {
    // The player releases and runs back; the log has no resurrect, but his next cast reports
    // him with HP again.
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
    assert_eq!(
        deaths.iter().map(|d| d.t).collect::<Vec<_>>(),
        [260_000, 400_000],
        "alive at the first own HP snapshot above 0; the next death counts"
    );
}
