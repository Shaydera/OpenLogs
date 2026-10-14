mod support;

use openlogs_analysis::{
    AbilityRef, Attribution, DamageVia, Dimension, EventKind, Fight, NOBODY, OptionValue,
    ReportFilter, Scope, ScopeMetric, Side, UnitRef, deaths_report, filter_options,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS, PET_FLAGS, damage};

fn died() -> EventKind {
    EventKind::Died { unconscious: false }
}

fn whole() -> ReportFilter {
    ReportFilter::whole(Attribution::Augmented)
}

fn lethal(amount: u64) -> EventKind {
    EventKind::Damage(damage(DamageVia::Spell, amount, 50))
}

struct Raid {
    fight: Fight,
    mage: u32,
    priest: u32,
    hunter: u32,
    adds: [u32; 2],
}

/// The boss kills the mage with Virulent Spit; the priest dies without a lethal hit in the log;
/// the hunter's pet kills one add, the mage the other.
fn raid() -> Raid {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let priest = b.player("Player-2", "Ulvara-Emberfall-EU", 256);
    let hunter = b.player("Player-3", "Toran-Emberfall-EU", 253);
    let wolf = b.unit("Creature-0-1-1-1-1-0001", "Wolf", PET_FLAGS);
    b.fight.actors.set_owner(wolf, hunter);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let adds = [1, 2].map(|i| {
        b.unit(
            &format!("Creature-0-1-1-1-261874-0{i}"),
            "Blightscale Rawling",
            HOSTILE_FLAGS,
        )
    });
    b.spell(5, "Virulent Spit");
    b.spell(30451, "Arcane Blast");
    b.spell(17253, "Bite");
    b.push(10_000, boss, mage, 5, lethal(600));
    b.push(10_000, NOBODY, mage, 0, died());
    b.push(20_000, NOBODY, priest, 0, died());
    b.push(30_000, mage, adds[0], 30451, lethal(900));
    b.push(30_000, NOBODY, adds[0], 0, died());
    b.push(31_000, wolf, adds[1], 17253, lethal(900));
    b.push(41_000, wolf, adds[1], 17253, lethal(900));
    b.push(41_000, NOBODY, adds[1], 0, died());
    Raid {
        fight: b.build(),
        mage,
        priest,
        hunter,
        adds,
    }
}

#[test]
fn source_and_ability_match_the_killing_blow() {
    let r = raid();
    let curated = Curated::bundled();
    let report = |scope: Scope| deaths_report(&r.fight, &curated, &whole(), &scope);
    let all = report(Scope::default());
    assert_eq!(all.recaps.len(), 2);
    assert_eq!((all.dead_units, all.most_lethal), (2, Some((5, false, 1))));

    let by_boss = report(Scope {
        source: vec![UnitRef::Unit("Ula'tek".into())],
        ..Scope::default()
    });
    let players: Vec<u32> = by_boss.recaps.iter().map(|d| d.death.player).collect();
    assert_eq!(
        players,
        [r.mage],
        "a death without a lethal hit has no source"
    );

    let priest = report(Scope {
        target: vec![UnitRef::Player(r.priest)],
        ..Scope::default()
    });
    assert_eq!(priest.recaps.len(), 1);
    assert_eq!(priest.recaps[0].number, 2, "numbered among every death");
    assert_eq!(priest.dead_ms, 40_000);

    let spit = report(Scope {
        ability: vec![AbilityRef::Name("Virulent Spit".into())],
        target: vec![UnitRef::Player(r.priest)],
        ..Scope::default()
    });
    assert!(spit.recaps.is_empty());
}

#[test]
fn dead_units_ignore_the_killing_blow_selections() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let priest = b.player("Player-2", "Ulvara-Emberfall-EU", 256);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(5, "Virulent Spit");
    b.spell(6, "Cleave");
    b.push(10_000, boss, mage, 5, lethal(600));
    b.push(10_000, NOBODY, mage, 0, died());
    b.push(20_000, boss, priest, 6, lethal(600));
    b.push(20_000, NOBODY, priest, 0, died());
    let fight = b.build();
    let report = deaths_report(
        &fight,
        &Curated::bundled(),
        &whole(),
        &Scope {
            ability: vec![AbilityRef::Name("Virulent Spit".into())],
            ..Scope::default()
        },
    );
    assert_eq!((report.recaps.len(), report.dead_units), (1, 2));
}

#[test]
fn the_enemy_side_lists_kills_with_killer_and_time_alive() {
    let r = raid();
    let enemies = Scope {
        perspective: Side::Enemy,
        ..Scope::default()
    };
    let report = deaths_report(&r.fight, &Curated::bundled(), &whole(), &enemies);
    let kills: Vec<_> = report
        .kills
        .iter()
        .map(|k| (k.unit, k.t, k.killing_blow.map(|h| h.spell), k.alive_ms))
        .collect();
    assert_eq!(
        kills,
        [
            (r.adds[0], 30_000, Some(30451), Some(0)),
            (r.adds[1], 41_000, Some(17253), Some(10_000)),
        ]
    );
    assert!(report.recaps.is_empty());
    assert_eq!(report.avg_alive_ms, Some(5_000));
    let by_hunter = deaths_report(
        &r.fight,
        &Curated::bundled(),
        &whole(),
        &Scope {
            source: vec![UnitRef::Player(r.hunter)],
            ..enemies
        },
    );
    assert_eq!(
        by_hunter.kills.len(),
        1,
        "a pet's killing blow is its owner's"
    );
    assert_eq!(by_hunter.top_killer, Some((UnitRef::Player(r.hunter), 1)));
}

#[test]
fn the_pickers_offer_who_died_and_who_landed_a_killing_blow() {
    let r = raid();
    let options = |dimension| -> Vec<OptionValue> {
        filter_options(
            &r.fight,
            &Curated::bundled(),
            &whole(),
            &Scope::default(),
            ScopeMetric::Deaths,
            dimension,
        )
        .into_iter()
        .map(|o| o.value)
        .collect()
    };
    let mut died = options(Dimension::Target);
    died.sort();
    assert_eq!(
        died,
        [
            OptionValue::Unit(UnitRef::Player(r.mage)),
            OptionValue::Unit(UnitRef::Player(r.priest)),
        ]
    );
    assert_eq!(
        options(Dimension::Source),
        [OptionValue::Unit(UnitRef::Unit("Ula'tek".into()))],
        "no option for a death without a lethal hit"
    );
}

#[test]
fn a_boss_killed_on_a_kill_pull_dies_at_the_end_of_the_slice() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(30451, "Arcane Blast");
    b.hit(500, mage, boss, 30451, 1_000, (900_000, 1_000_000));
    b.push(59_000, mage, boss, 30451, lethal(900));
    b.fight.outcome = openlogs_index::Outcome::Kill;
    let fight = b.build();
    let enemies = Scope {
        perspective: Side::Enemy,
        ..Scope::default()
    };
    let last_phase = ReportFilter {
        start_ms: 40_000,
        end_ms: 60_000,
        ..whole()
    };
    for filter in [whole(), last_phase] {
        let report = deaths_report(&fight, &Curated::bundled(), &filter, &enemies);
        let kills: Vec<_> = report
            .kills
            .iter()
            .map(|k| (k.unit, k.t, k.killing_blow.map(|h| h.spell), k.alive_ms))
            .collect();
        assert_eq!(kills, [(boss, 60_000, Some(30451), Some(59_500))]);
    }
}

#[test]
fn unfiltered_friendly_deaths_are_the_full_recap_list() {
    let mut b = FightBuilder::new(60_000);
    let player = b.player("Player-1", "Wendel-Emberfall-EU", 71);
    let druid = b.player("Player-2", "Serrik-Silverbrook-EU", 105);
    let rebirth = b.spell(20484, "Rebirth");
    b.push(10_000, NOBODY, player, 0, died());
    b.push(14_000, druid, player, rebirth, EventKind::Resurrect);
    b.push(40_000, NOBODY, player, 0, died());
    let fight = b.build();
    let curated = Curated::bundled();
    let report = deaths_report(&fight, &curated, &whole(), &Scope::default());
    assert_eq!(
        report.recaps,
        openlogs_analysis::death_recaps(&fight, &curated, &whole())
    );
    assert_eq!((report.recaps.len(), report.rezzed), (2, 1));
}
