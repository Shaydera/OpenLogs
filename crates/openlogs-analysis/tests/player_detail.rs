mod support;

use openlogs_analysis::{
    Attribution, AuraAction, AuraType, BuffKind, CastKind, Damage, DamageVia, EventKind, Metric,
    NO_SPELL, NOBODY, ReportFilter, RowKind, player_detail,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS, damage, heal};

const AUG: Attribution = Attribution::Augmented;
const RE: Attribution = Attribution::Reattributed;

fn hit(amount: u64) -> EventKind {
    EventKind::Damage(damage(DamageVia::Spell, amount, 0))
}

fn supported(amount: u64, evoker: u32) -> EventKind {
    EventKind::Damage(Damage {
        supporter: evoker,
        ..damage(DamageVia::Spell, amount, 0)
    })
}

fn whole(mode: Attribution) -> ReportFilter {
    ReportFilter::whole(mode)
}

fn buff(b: &mut FightBuilder, source: u32, target: u32, spell: u32, from: i32, to: i32) {
    let aura = |action| EventKind::Aura {
        action,
        aura_type: AuraType::Buff,
        stacks: None,
        broken_by: NO_SPELL,
    };
    b.push(from, source, target, spell, aura(AuraAction::Applied));
    b.push(to, source, target, spell, aura(AuraAction::Removed));
}

struct Raid {
    b: FightBuilder,
    mage: u32,
    warrior: u32,
    evoker: u32,
    priest: u32,
    boss: u32,
}

fn raid() -> Raid {
    let mut b = FightBuilder::new(20_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let warrior = b.player("Player-2", "Wendel-Emberfall-EU", 71);
    let evoker = b.player("Player-3", "Speronis-Stonevale-EU", 1473);
    let priest = b.player("Player-4", "Ulvara-Emberfall-EU", 256);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    for (id, name) in [
        (44425, "Arcane Barrage"),
        (12294, "Mortal Strike"),
        (395152, "Ebon Might"),
        (404908, "Fate Mirror"),
        (1, "Virulent Spit"),
        (2061, "Flash Heal"),
    ] {
        b.spell(id, name);
    }
    Raid {
        b,
        mage,
        warrior,
        evoker,
        priest,
        boss,
    }
}

#[test]
fn summary_totals_rank_and_support() {
    let mut r = raid();
    r.b.push(1_000, r.mage, NOBODY, 44425, EventKind::CastSuccess);
    r.b.push(1_100, r.mage, r.boss, 44425, hit(1_000));
    r.b.push(1_100, r.mage, r.boss, 395152, supported(100, r.evoker));
    r.b.push(2_000, r.warrior, r.boss, 12294, hit(5_000));
    r.b.push(3_000, r.boss, r.mage, 1, hit(700));
    r.b.push(
        3_500,
        r.priest,
        r.mage,
        2061,
        EventKind::Heal(heal(500, 200)),
    );
    r.b.push(
        10_000,
        NOBODY,
        r.mage,
        0,
        EventKind::Died { unconscious: false },
    );
    let fight = r.b.build();
    let curated = Curated::bundled();

    let aug = player_detail(&fight, &curated, r.mage, Metric::Damage, &whole(AUG)).unwrap();
    assert_eq!(
        (
            aug.total,
            aug.other_mode_total,
            aug.rank,
            aug.ranked_players
        ),
        (1_000, 900, 2, 2)
    );
    assert_eq!(aug.support_received, 100);
    assert_eq!(aug.support_received_from, vec![(r.evoker, 100)]);
    assert_eq!(aug.support_by_spell, vec![(395152, 100)]);
    assert_eq!(aug.healing_received, 300);
    assert_eq!(aug.taken_by_spell, vec![(1, false, 700)]);
    assert_eq!(aug.deaths.len(), 1);
    let barrage = aug.abilities.iter().find(|a| a.row.spell == 44425).unwrap();
    assert_eq!((barrage.casts, barrage.aug), (Some(1), false));

    let re = player_detail(&fight, &curated, r.mage, Metric::Damage, &whole(RE)).unwrap();
    assert_eq!(
        (re.total, re.other_mode_total, re.ranked_players),
        (900, 1_000, 3)
    );
    let deduction = re
        .abilities
        .iter()
        .find(|a| a.row.kind == RowKind::SupportDeducted)
        .unwrap();
    assert_eq!((deduction.row.amount, deduction.casts), (-100, None));
}

#[test]
fn cast_rows_order_major_cooldowns_rotation_then_defensives() {
    let mut r = raid();
    for (id, name) in [
        (365350, "Arcane Surge"),
        (414658, "Ice Cold"),
        (321507, "Touch of the Magi"),
        (153626, "Arcane Orb"),
        (235450, "Prismatic Barrier"),
    ] {
        r.b.spell(id, name);
    }
    for (t, spell) in [
        (1_000, 235450),
        (2_000, 365350),
        (3_000, 44425),
        (5_000, 321507),
        (9_000, 414658),
        (12_000, 153626),
        (15_000, 365350),
    ] {
        r.b.push(t, r.mage, NOBODY, spell, EventKind::CastSuccess);
    }
    let detail = player_detail(
        &r.b.build(),
        &Curated::bundled(),
        r.mage,
        Metric::Damage,
        &whole(AUG),
    )
    .unwrap();
    let rows: Vec<_> = detail
        .cast_rows
        .iter()
        .map(|c| (c.spell, c.duration_ms, c.times.clone()))
        .collect();
    assert_eq!(
        rows,
        [
            (365350, 15_000, vec![2_000, 15_000]),
            (321507, 0, vec![5_000]),
            (153626, 0, vec![12_000]),
            (235450, 0, vec![1_000]),
            (414658, 0, vec![9_000])
        ]
    );
}

#[test]
fn buff_rows_keep_only_curated_buffs_by_kind() {
    let mut r = raid();
    let forrin = r.b.player("Player-5", "Forrin-Emberfall-EU", 63);
    for (id, name) in [
        (80353, "Time Warp"),
        (365362, "Arcane Surge"),
        (263725, "Clearcasting"),
        (235450, "Prismatic Barrier"),
        (1295057, "Tidal Insight"),
        (10060, "Power Infusion"),
        (157047, "Saved by the Light"),
    ] {
        r.b.spell(id, name);
    }
    buff(&mut r.b, r.mage, r.mage, 1295057, 0, 19_000); // an uncurated proc: no row
    buff(&mut r.b, r.mage, r.mage, 235450, 1_000, 3_000);
    buff(&mut r.b, r.mage, r.mage, 263725, 2_000, 6_000);
    buff(&mut r.b, r.mage, r.mage, 365362, 4_000, 7_000);
    buff(&mut r.b, forrin, r.mage, 80353, 5_000, 13_000);
    buff(&mut r.b, r.priest, r.mage, 10060, 6_000, 8_000);
    buff(&mut r.b, r.priest, r.mage, 157047, 6_000, 9_000); // an uncurated external: no row
    buff(&mut r.b, r.evoker, r.mage, 395152, 1_000, 2_000);
    let detail = player_detail(
        &r.b.build(),
        &Curated::bundled(),
        r.mage,
        Metric::Damage,
        &whole(AUG),
    )
    .unwrap();
    let rows: Vec<_> = detail.buff_rows.iter().map(|b| (b.spell, b.kind)).collect();
    assert_eq!(
        rows,
        [
            (395152, BuffKind::Aug),
            (80353, BuffKind::Lust),
            (10060, BuffKind::External),
            (365362, BuffKind::Cooldown),
            (263725, BuffKind::Proc),
            (235450, BuffKind::Shield)
        ]
    );
}

#[test]
fn a_player_dead_for_the_whole_range_is_shown_dead() {
    let mut r = raid();
    r.b.push(
        2_000,
        NOBODY,
        r.mage,
        0,
        EventKind::Died { unconscious: false },
    );
    let fight = r.b.build();
    let curated = Curated::bundled();
    let window = ReportFilter {
        start_ms: 5_000,
        end_ms: 9_000,
        attribution: AUG,
    };
    let detail = player_detail(&fight, &curated, r.mage, Metric::Damage, &window).unwrap();
    assert!(detail.deaths.is_empty());
    assert_eq!(
        (detail.dead.clone(), detail.dead_since),
        (vec![(5_000, 9_000)], Some(2_000))
    );
    let detail = player_detail(&fight, &curated, r.mage, Metric::Damage, &whole(AUG)).unwrap();
    assert_eq!(
        (detail.dead, detail.dead_since),
        (vec![(2_000, 20_000)], None)
    );
}

#[test]
fn pets_merge_into_one_row_named_after_the_largest() {
    let mut r = raid();
    r.b.spell(88092, "Mirror Image");
    r.b.spell(59638, "Frostbolt");
    r.b.spell(449569, "Meteorite");
    let image = r.b.unit(
        "Creature-0-1-1-1-31216-01",
        "Mirror Image",
        support::PET_FLAGS,
    );
    r.b.fight.actors.set_owner(image, r.mage);
    let phoenix = r.b.unit(
        "Creature-0-1-1-1-221187-01",
        "Arcane Phoenix",
        support::PET_FLAGS,
    );
    r.b.fight.actors.set_owner(phoenix, r.mage);
    r.b.push(1_000, r.mage, image, 88092, EventKind::Summon);
    r.b.push(1_500, image, r.boss, 59638, hit(3_000));
    r.b.push(1_600, image, r.boss, 59638, hit(2_000));
    r.b.push(2_000, phoenix, r.boss, 449569, hit(1_000));
    r.b.push(2_100, r.mage, r.boss, 44425, hit(10_000));
    let detail = player_detail(
        &r.b.build(),
        &Curated::bundled(),
        r.mage,
        Metric::Damage,
        &whole(AUG),
    )
    .unwrap();
    let rows: Vec<_> = detail
        .abilities
        .iter()
        .map(|a| {
            (
                a.row.kind,
                a.row.spell,
                a.row.actor,
                a.row.amount,
                a.pets,
                a.casts,
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            (RowKind::Own, 44425, r.mage, 10_000, 0, None),
            (RowKind::Pet, 88092, image, 6_000, 2, None)
        ],
        "one pet row, named and iconed after Mirror Image's summon"
    );
}

#[test]
fn specs_without_catalogue_entries_show_their_most_cast_spells_as_rotation() {
    let mut r = raid();
    for (id, name) in [
        (107574, "Avatar"),
        (118038, "Die by the Sword"),
        (6262, "Healthstone"),
    ] {
        r.b.spell(id, name);
    }
    // Eight other spells cast 10, 9, … 3 times, and one cast twice; the least cast starts first.
    for (i, spell) in (1001..=1009).enumerate() {
        r.b.spell(spell, &format!("Strike {i}"));
        let count = 10 - i as i32;
        let first = 1_000 + (9 - i as i32) * 10;
        for n in 0..count.max(2) {
            r.b.push(
                first + n * 1_500,
                r.warrior,
                NOBODY,
                spell,
                EventKind::CastSuccess,
            );
        }
    }
    r.b.push(500, r.warrior, NOBODY, 107574, EventKind::CastSuccess);
    r.b.push(900, r.warrior, NOBODY, 118038, EventKind::CastSuccess);
    for t in [2_000, 4_000, 6_000] {
        r.b.push(t, r.warrior, NOBODY, 6262, EventKind::CastSuccess);
    }
    let detail = player_detail(
        &r.b.build(),
        &Curated::bundled(),
        r.warrior,
        Metric::Damage,
        &whole(AUG),
    )
    .unwrap();
    let rows: Vec<_> = detail.cast_rows.iter().map(|c| (c.spell, c.kind)).collect();
    assert_eq!(
        rows,
        [
            (107574, CastKind::Major),
            (1006, CastKind::Rotation),
            (1005, CastKind::Rotation),
            (1004, CastKind::Rotation),
            (1003, CastKind::Rotation),
            (1002, CastKind::Rotation),
            (1001, CastKind::Rotation),
            (118038, CastKind::Defensive)
        ],
        "six most-cast spells with three casts or more, first cast first; no consumables"
    );
}
