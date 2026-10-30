mod support;

use openlogs_analysis::{
    Attribution, Damage, DamageVia, EventKind, NOBODY, Overkill, ReportFilter, damage_taken,
};
use support::{FightBuilder, HOSTILE_FLAGS, MELEE, damage};

fn hit(amount: u64) -> EventKind {
    EventKind::Damage(damage(DamageVia::Spell, amount, 0))
}

#[test]
fn groups_by_spell_and_source_name() {
    let mut b = FightBuilder::new(10_000);
    let tank = b.player("Player-1", "Edrin-Emberfall-EU", 581);
    let mage = b.player("Player-2", "Faelan-Emberfall-EU", 62);
    let add1 = b.unit("Creature-0-1-1-1-1-01", "Gore Rattle", HOSTILE_FLAGS);
    let add2 = b.unit("Creature-0-1-1-1-1-02", "Gore Rattle", HOSTILE_FLAGS);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(5, "Virulent Spit");
    b.push(
        1_000,
        add1,
        tank,
        MELEE,
        EventKind::Damage(Damage {
            absorbed: 100,
            ..damage(DamageVia::Swing, 1_000, 0)
        }),
    );
    b.push(
        1_100,
        add1,
        tank,
        MELEE,
        EventKind::Damage(damage(DamageVia::SwingLanded, 1_100, 0)),
    );
    b.push(
        2_000,
        add2,
        mage,
        MELEE,
        EventKind::Damage(damage(DamageVia::Swing, 500, 0)),
    );
    b.push(3_000, boss, mage, 5, hit(2_000));
    b.push(
        4_000,
        NOBODY,
        tank,
        7,
        EventKind::Damage(damage(DamageVia::Environmental, 300, 0)),
    );
    b.push(5_000, tank, boss, 8, hit(9_999));
    let report = damage_taken(&b.build(), &ReportFilter::whole(Attribution::Augmented));

    assert_eq!(report.total, 1_100 + 500 + 2_000 + 300);
    let rows: Vec<_> = report
        .by_ability
        .iter()
        .map(|a| {
            (
                a.spell,
                a.source_name.as_deref(),
                a.amount,
                a.absorbed,
                a.hits,
                a.players_hit,
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            (5, Some("Ula'tek"), 2_000, 0, 1, 1),
            (MELEE, Some("Gore Rattle"), 1_600, 100, 2, 2),
            (7, None, 300, 0, 1, 1),
        ]
    );

    let players: Vec<_> = report
        .by_player
        .iter()
        .map(|p| (p.player, p.amount))
        .collect();
    assert_eq!(players, [(mage, 2_500), (tank, 1_400)]);
    let mage_rows: Vec<_> = report.by_player[0]
        .abilities
        .iter()
        .map(|a| (a.spell, a.source_name.as_deref(), a.amount, a.players_hit))
        .collect();
    assert_eq!(
        mage_rows,
        [
            (5, Some("Ula'tek"), 2_000, 1),
            (MELEE, Some("Gore Rattle"), 500, 1)
        ]
    );
}

#[test]
fn fully_absorbed_hits_count_as_damage_taken() {
    use openlogs_analysis::{MissType, Missed};
    let mut b = FightBuilder::new(10_000);
    let tank = b.player("Player-1", "Edrin-Emberfall-EU", 581);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(5, "Virulent Spit");
    b.push(1_000, boss, tank, 5, hit(1_000));
    b.push(
        2_000,
        boss,
        tank,
        5,
        EventKind::Missed(Missed {
            via: DamageVia::Spell,
            miss_type: MissType::Absorb,
            amount_missed: 400,
            critical: false,
        }),
    );
    b.push(
        3_000,
        boss,
        tank,
        5,
        EventKind::Missed(Missed {
            via: DamageVia::Spell,
            miss_type: MissType::Dodge,
            amount_missed: 0,
            critical: false,
        }),
    );
    let report = damage_taken(&b.build(), &ReportFilter::whole(Attribution::Augmented));
    assert_eq!(report.total, 1_400);
    let row = &report.by_ability[0];
    assert_eq!((row.amount, row.absorbed, row.hits), (1_400, 400, 2));
    assert_eq!(
        (report.by_player[0].amount, report.by_player[0].absorbed),
        (1_400, 400)
    );
}

#[test]
fn world_damage_stays_apart_from_melee() {
    let mut b = FightBuilder::new(10_000);
    let tank = b.player("Player-1", "Edrin-Emberfall-EU", 581);
    let add = b.unit("Creature-0-1-1-1-1-01", "Gore Rattle", HOSTILE_FLAGS);
    b.push(
        1_000,
        add,
        tank,
        MELEE,
        EventKind::Damage(damage(DamageVia::Swing, 300, 0)),
    );
    b.push(
        2_000,
        NOBODY,
        tank,
        MELEE,
        EventKind::Damage(damage(DamageVia::Environmental, 900, 0)),
    );
    let report = damage_taken(&b.build(), &ReportFilter::whole(Attribution::Augmented));
    let rows: Vec<_> = report
        .by_ability
        .iter()
        .map(|a| (a.spell, a.environmental, a.source_name.as_deref(), a.amount))
        .collect();
    assert_eq!(
        rows,
        [
            (MELEE, true, None, 900),
            (MELEE, false, Some("Gore Rattle"), 300)
        ]
    );
    let tank_rows: Vec<_> = report.by_player[0]
        .abilities
        .iter()
        .map(|a| (a.spell, a.environmental, a.amount))
        .collect();
    assert_eq!(tank_rows, [(MELEE, true, 900), (MELEE, false, 300)]);
}

#[test]
fn a_lethal_hit_counts_with_its_overkill_whatever_the_overkill_option() {
    let mut b = FightBuilder::new(10_000);
    let tank = b.player("Player-1", "Edrin-Emberfall-EU", 581);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(5, "Virulent Spit");
    b.push(
        1_000,
        boss,
        tank,
        5,
        EventKind::Damage(Damage {
            absorbed: 100,
            ..damage(DamageVia::Spell, 1_000, 300)
        }),
    );
    let fight = b.build();
    let total_with = |overkill| {
        let filter = ReportFilter {
            overkill,
            ..ReportFilter::whole(Attribution::Augmented)
        };
        damage_taken(&fight, &filter).total
    };
    assert_eq!(
        (
            total_with(Overkill::Excluded),
            total_with(Overkill::Included)
        ),
        (1_100, 1_100)
    );
}

#[test]
fn damage_taken_over_for_another_player_counts_on_the_one_who_took_it() {
    let mut b = FightBuilder::new(10_000);
    let paladin = b.player("Player-1", "Puran-Ironmoor-EU", 65);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(6940, "Blessing of Sacrifice");
    b.push(
        1_000,
        boss,
        paladin,
        6940,
        EventKind::Damage(damage(DamageVia::Split, 300, 0)),
    );
    let report = damage_taken(&b.build(), &ReportFilter::whole(Attribution::Augmented));
    assert_eq!(report.total, 300);
}

#[test]
fn damage_that_comes_back_from_a_delaying_absorb_is_not_damage_taken() {
    let mut b = FightBuilder::new(10_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(5, "Virulent Spit");
    b.spell(1309786, "Refraction");
    b.push(1_000, boss, mage, 5, hit(500));
    b.push(
        2_000,
        mage,
        mage,
        1309786,
        EventKind::Damage(damage(DamageVia::Periodic, 200, 0)),
    );
    let report = damage_taken(&b.build(), &ReportFilter::whole(Attribution::Augmented));
    assert_eq!(report.total, 500);
}
