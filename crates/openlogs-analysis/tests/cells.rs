mod support;

use std::collections::HashMap;

use openlogs_analysis::{
    Attribution, Cell, CellKind, Damage, DamageVia, EventKind, NO_SPELL, ReportFilter, ScopeMetric,
    Side, UnitRef, cells, damage_done, damage_taken,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS, damage};

fn hit(amount: u64) -> EventKind {
    EventKind::Damage(damage(DamageVia::Spell, amount, 0))
}

fn supported(amount: u64, evoker: u32) -> EventKind {
    EventKind::Damage(Damage {
        supporter: evoker,
        ..damage(DamageVia::Spell, amount, 0)
    })
}

struct Raid {
    b: FightBuilder,
    warrior: u32,
    boss: u32,
}

fn raid() -> Raid {
    let mut b = FightBuilder::new(10_000);
    let warrior = b.player("Player-1", "Wendel-Emberfall-EU", 71);
    let evoker = b.player("Player-2", "Speronis-Stonevale-EU", 1473);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(1, "Mortal Strike");
    b.spell(395152, "Ebon Might");
    b.spell(9, "Necrotic Vapors");
    b.push(1_000, warrior, boss, 1, hit(1_000));
    b.push(1_000, warrior, boss, 395152, supported(100, evoker));
    b.push(2_000, evoker, boss, 1, hit(300));
    b.push(3_000, boss, warrior, 9, hit(700));
    b.push(4_000, boss, evoker, 9, hit(200));
    b.push(5_000, warrior, boss, 395152, supported(50, evoker));
    Raid { b, warrior, boss }
}

fn by_grouped_source(fight: &openlogs_analysis::Fight, list: &[Cell]) -> HashMap<UnitRef, i64> {
    let mut sums = HashMap::new();
    for c in list {
        *sums.entry(c.source.grouped(fight)).or_default() += c.amount;
    }
    sums
}

#[test]
fn friendly_damage_done_matches_the_damage_report_in_both_modes() {
    let r = raid();
    let fight = {
        let mut b = r.b;
        b.build()
    };
    for mode in [Attribution::Augmented, Attribution::Reattributed] {
        let filter = ReportFilter::whole(mode);
        let report = damage_done(&fight, &filter);
        let sums = by_grouped_source(
            &fight,
            &cells(
                &fight,
                &Curated::bundled(),
                &filter,
                Side::Friendly,
                ScopeMetric::DamageDone,
            ),
        );
        for p in &report.players {
            assert_eq!(sums[&UnitRef::Player(p.player)], p.total as i64, "{mode:?}");
        }
    }
    let reattributed = cells(
        &fight,
        &Curated::bundled(),
        &ReportFilter::whole(Attribution::Reattributed),
        Side::Friendly,
        ScopeMetric::DamageDone,
    );
    let unmatched = reattributed
        .iter()
        .find(|c| c.kind == CellKind::Unmatched)
        .unwrap();
    assert_eq!(
        (&unmatched.source, unmatched.spell, unmatched.amount),
        (&UnitRef::Player(r.warrior), NO_SPELL, -50)
    );
}

#[test]
fn friendly_damage_taken_matches_the_taken_report() {
    let fight = raid().b.build();
    let filter = ReportFilter::whole(Attribution::Reattributed);
    let total: i64 = cells(
        &fight,
        &Curated::bundled(),
        &filter,
        Side::Friendly,
        ScopeMetric::DamageTaken,
    )
    .iter()
    .map(|c| c.amount)
    .sum();
    assert_eq!(total, damage_taken(&fight, &filter).total as i64);
}

#[test]
fn the_enemy_side_swaps_who_did_and_who_took() {
    let r = raid();
    let fight = {
        let mut b = r.b;
        b.build()
    };
    let filter = ReportFilter::whole(Attribution::Reattributed);
    let enemy_done = cells(
        &fight,
        &Curated::bundled(),
        &filter,
        Side::Enemy,
        ScopeMetric::DamageDone,
    );
    assert!(
        enemy_done
            .iter()
            .all(|c| matches!(c.source, UnitRef::Instance(id) if id == r.boss))
    );
    assert_eq!(enemy_done.iter().map(|c| c.amount).sum::<i64>(), 900);
    let enemy_taken = cells(
        &fight,
        &Curated::bundled(),
        &filter,
        Side::Enemy,
        ScopeMetric::DamageTaken,
    );
    assert_eq!(
        enemy_taken,
        cells(
            &fight,
            &Curated::bundled(),
            &filter,
            Side::Friendly,
            ScopeMetric::DamageDone
        )
    );
}
