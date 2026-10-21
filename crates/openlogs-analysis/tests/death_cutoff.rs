mod support;

use openlogs_analysis::{
    Attribution, DamageVia, EventKind, Fight, NOBODY, ReportFilter, Scope, Side, damage_taken,
    deaths_report, nth_death_ms,
};
use openlogs_gamedata::Curated;
use openlogs_index::Outcome;
use support::{FightBuilder, HOSTILE_FLAGS, MELEE, PET_FLAGS, damage};

fn died() -> EventKind {
    EventKind::Died { unconscious: false }
}

fn whole() -> ReportFilter {
    ReportFilter::whole(Attribution::Augmented)
}

#[test]
fn nth_death_is_the_nth_entry_of_deaths() {
    let mut b = FightBuilder::new(60_000);
    for (i, t) in [10_000, 20_000, 30_000].into_iter().enumerate() {
        let player = b.player(
            &format!("Player-{i}"),
            &format!("Faelan{i}-Emberfall-EU"),
            62,
        );
        b.push(t, NOBODY, player, MELEE, died());
    }
    let fight = b.build();
    assert_eq!(nth_death_ms(&fight, 3), Some(30_000));
    assert_eq!(nth_death_ms(&fight, 4), None);
    assert_eq!(nth_death_ms(&fight, 0), None);
}

#[test]
fn revived_player_dying_again_counts_twice() {
    let mut b = FightBuilder::new(60_000);
    let a = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let other = b.player("Player-2", "Ulvara-Emberfall-EU", 256);
    let rebirth = b.spell(20484, "Rebirth");
    b.push(10_000, NOBODY, a, MELEE, died());
    b.push(12_000, other, a, rebirth, EventKind::Resurrect);
    b.push(15_000, NOBODY, a, MELEE, died());
    b.push(20_000, NOBODY, other, MELEE, died());
    let fight = b.build();
    assert_eq!(nth_death_ms(&fight, 2), Some(15_000));
    assert_eq!(nth_death_ms(&fight, 3), Some(20_000));
}

#[test]
fn feign_death_and_pets_do_not_count() {
    let mut b = FightBuilder::new(60_000);
    let hunter = b.player("Player-1", "Toran-Emberfall-EU", 253);
    let other = b.player("Player-2", "Ulvara-Emberfall-EU", 256);
    let wolf = b.unit("Creature-0-1-1-1-1-0001", "Wolf", PET_FLAGS);
    b.fight.actors.set_owner(wolf, hunter);
    b.push(
        5_000,
        NOBODY,
        hunter,
        MELEE,
        EventKind::Died { unconscious: true },
    );
    b.push(8_000, NOBODY, wolf, MELEE, died());
    b.push(25_000, NOBODY, other, MELEE, died());
    let fight = b.build();
    assert_eq!(nth_death_ms(&fight, 1), Some(25_000));
}

fn two_deaths_in_one_millisecond() -> (Fight, [u32; 3]) {
    let mut b = FightBuilder::new(60_000);
    let players = [0, 1, 2].map(|i| {
        b.player(
            &format!("Player-{i}"),
            &format!("Faelan{i}-Emberfall-EU"),
            62,
        )
    });
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.push(10_000, NOBODY, players[0], MELEE, died());
    b.push(20_000, NOBODY, players[1], MELEE, died());
    b.push(20_000, NOBODY, players[2], MELEE, died());
    let hit = |amount| EventKind::Damage(damage(DamageVia::Spell, amount, 0));
    b.push(20_000, boss, players[0], 1, hit(300));
    b.push(20_001, boss, players[0], 1, hit(500));
    (b.build(), players)
}

#[test]
fn cut_keeps_the_whole_millisecond_of_the_nth_death() {
    let (fight, _) = two_deaths_in_one_millisecond();
    let filter = whole().cut_at_death(&fight, Some(2));
    assert_eq!(filter.end_ms, 20_001);
    assert_eq!(damage_taken(&fight, &filter).total, 300);
    let report = deaths_report(&fight, &Curated::bundled(), &filter, &Scope::default());
    assert_eq!(report.recaps.len(), 3);
}

#[test]
fn cut_never_extends_a_range() {
    let (fight, _) = two_deaths_in_one_millisecond();
    let filter = ReportFilter {
        start_ms: 0,
        end_ms: 15_000,
        ..whole()
    };
    assert_eq!(filter.cut_at_death(&fight, Some(2)).end_ms, 15_000);
}

#[test]
fn cut_kill_loses_the_boss_kill() {
    let mut b = FightBuilder::new(60_000);
    let players = [0, 1].map(|i| {
        b.player(
            &format!("Player-{i}"),
            &format!("Faelan{i}-Emberfall-EU"),
            62,
        )
    });
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(30451, "Arcane Blast");
    b.hit(500, players[0], boss, 30451, 1_000, (900_000, 1_000_000));
    b.push(10_000, NOBODY, players[0], MELEE, died());
    b.push(20_000, NOBODY, players[1], MELEE, died());
    b.push(
        59_000,
        players[0],
        boss,
        30451,
        EventKind::Damage(damage(DamageVia::Spell, 900, 50)),
    );
    b.fight.outcome = Outcome::Kill;
    let fight = b.build();
    let enemies = Scope {
        perspective: Side::Enemy,
        ..Scope::default()
    };
    let kills = |death| {
        let filter = whole().cut_at_death(&fight, Some(death));
        deaths_report(&fight, &Curated::bundled(), &filter, &enemies)
            .kills
            .len()
    };
    assert_eq!(kills(2), 0);
    assert_eq!(kills(3), 1);
}
