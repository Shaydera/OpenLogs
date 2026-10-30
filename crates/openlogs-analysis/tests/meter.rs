mod support;

use openlogs_analysis::{
    Absorbed, ActorId, Attribution, AuraType, Damage, DamageVia, Dimension, EventKind, Fight, Heal,
    MeterCategory, MeterEntry, MeterKey, Metric, NOBODY, Overkill, ReportFilter, RowKind, Scope,
    damage_done, damage_taken, healing, interrupts_report, meter, player_detail,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS, MELEE, PET_FLAGS, damage, heal};

const EBON_MIGHT: u32 = 395152;
const PYROBLAST: u32 = 11366;
const FIRE_BREATH: u32 = 357208;
const MORTAL_STRIKE: u32 = 12294;
const VIRULENT_SPIT: u32 = 1;
const FLASH_HEAL: u32 = 2061;
const SPIRIT_MEND: u32 = 90361;
const POWER_WORD_SHIELD: u32 = 17;

const MODES: [Attribution; 2] = [Attribution::Augmented, Attribution::Reattributed];

struct Raid {
    fight: Fight,
    mage: ActorId,
    evoker: ActorId,
    priest: ActorId,
    warrior: ActorId,
    hunter: ActorId,
}

fn spell_hit(amount: u64) -> EventKind {
    EventKind::Damage(damage(DamageVia::Spell, amount, 0))
}

fn supported(amount: u64, evoker: ActorId) -> EventKind {
    EventKind::Damage(Damage {
        supporter: evoker,
        ..damage(DamageVia::Spell, amount, 0)
    })
}

fn absorbed(absorber: ActorId, absorb_spell: u32, amount: u64, supporter: ActorId) -> EventKind {
    EventKind::Absorbed(Absorbed {
        absorber,
        absorber_hostile: false,
        absorb_spell,
        amount,
        supporter,
    })
}

fn interrupt(interrupted: u32) -> EventKind {
    EventKind::Interrupt { interrupted }
}

fn raid() -> Raid {
    let mut b = FightBuilder::new(20_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let evoker = b.player("Player-2", "Speronis-Stonevale-EU", 1473);
    let priest = b.player("Player-3", "Ulvara-Emberfall-EU", 256);
    let warrior = b.player("Player-4", "Wendel-Emberfall-EU", 71);
    let hunter = b.player("Player-5", "Brannoc-Emberfall-EU", 253);
    let beast = b.unit("Pet-0-1-1-1-1-0001", "Spirit Beast", PET_FLAGS);
    b.fight.actors.set_owner(beast, hunter);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);

    b.push(1_000, mage, boss, PYROBLAST, spell_hit(1_000));
    b.push(2_500, mage, boss, PYROBLAST, spell_hit(2_000));
    b.push(2_500, mage, boss, EBON_MIGHT, supported(200, evoker));
    b.push(3_000, evoker, boss, FIRE_BREATH, spell_hit(800));
    b.push(3_000, warrior, boss, MORTAL_STRIKE, spell_hit(1_500));

    b.push(4_000, boss, warrior, VIRULENT_SPIT, spell_hit(900));
    b.push(
        4_000,
        boss,
        warrior,
        MELEE,
        EventKind::Damage(damage(DamageVia::Swing, 400, 0)),
    );
    b.push(4_100, boss, mage, VIRULENT_SPIT, spell_hit(300));
    b.push(
        4_200,
        NOBODY,
        warrior,
        MELEE,
        EventKind::Damage(damage(DamageVia::Environmental, 250, 0)),
    );
    b.push(8_000, boss, warrior, VIRULENT_SPIT, spell_hit(5_000));

    b.push(
        4_500,
        priest,
        warrior,
        FLASH_HEAL,
        EventKind::Heal(heal(600, 100)),
    );
    b.push(
        4_600,
        beast,
        warrior,
        SPIRIT_MEND,
        EventKind::Heal(heal(300, 0)),
    );
    b.push(
        5_000,
        boss,
        warrior,
        VIRULENT_SPIT,
        absorbed(priest, POWER_WORD_SHIELD, 250, NOBODY),
    );
    b.push(
        5_001,
        boss,
        warrior,
        VIRULENT_SPIT,
        absorbed(priest, 413984, 40, evoker),
    );
    b.push(
        5_500,
        priest,
        warrior,
        EBON_MIGHT,
        EventKind::Heal(Heal {
            supporter: evoker,
            ..heal(30, 0)
        }),
    );

    b.push(3_500, mage, boss, 2139, interrupt(5));
    b.push(3_600, beast, boss, 19647, interrupt(6));
    b.push(6_000, warrior, boss, 6552, interrupt(5));
    b.push(6_500, mage, boss, 2139, interrupt(5));
    b.push(6_800, mage, boss, 2139, interrupt(7));
    b.push(
        4_200,
        priest,
        warrior,
        527,
        EventKind::Dispel {
            removed: 9,
            aura_type: AuraType::Debuff,
        },
    );
    b.push(
        4_300,
        mage,
        boss,
        30449,
        EventKind::Stolen {
            removed: 11,
            aura_type: AuraType::Buff,
        },
    );
    b.push(
        9_000,
        priest,
        warrior,
        527,
        EventKind::Dispel {
            removed: 9,
            aura_type: AuraType::Debuff,
        },
    );

    Raid {
        fight: b.build(),
        mage,
        evoker,
        priest,
        warrior,
        hunter,
    }
}

fn span(attribution: Attribution) -> ReportFilter {
    ReportFilter {
        start_ms: 2_000,
        end_ms: 7_000,
        attribution,
        overkill: Overkill::Excluded,
    }
}

fn rows(fight: &Fight, filter: &ReportFilter, category: MeterCategory) -> Vec<(ActorId, i64)> {
    meter(fight, filter, category, None)
        .rows
        .iter()
        .map(|r| (r.player, r.amount))
        .collect()
}

fn spell(spell: u32) -> MeterKey {
    MeterKey::Spell {
        spell,
        environmental: false,
    }
}

fn entries(list: &[MeterEntry]) -> Vec<(MeterKey, i64)> {
    list.iter().map(|e| (e.key, e.amount)).collect()
}

#[test]
fn meter_damage_equals_the_damage_done_report() {
    let r = raid();
    for mode in MODES {
        let filter = span(mode);
        let report = damage_done(&r.fight, &filter);
        let meter = meter(&r.fight, &filter, MeterCategory::DamageDone, None);
        let expected: Vec<_> = report
            .players
            .iter()
            .map(|p| (p.player, p.total as i64, p.per_second))
            .collect();
        let actual: Vec<_> = meter
            .rows
            .iter()
            .map(|row| (row.player, row.amount, row.per_second))
            .collect();
        assert_eq!(actual, expected, "{mode:?}");
        assert_eq!(meter.duration_ms, 5_000);
    }
}

#[test]
fn meter_healing_equals_the_healing_report() {
    let r = raid();
    for mode in MODES {
        let filter = span(mode);
        let expected: Vec<_> = healing(&r.fight, &filter)
            .players
            .iter()
            .map(|p| (p.player, p.total as i64))
            .collect();
        assert!(!expected.is_empty());
        assert_eq!(
            rows(&r.fight, &filter, MeterCategory::HealingDone),
            expected,
            "{mode:?}"
        );
    }
}

#[test]
fn meter_damage_taken_equals_the_damage_taken_report() {
    let r = raid();
    let filter = span(Attribution::Reattributed);
    let report = damage_taken(&r.fight, &filter);
    let expected: Vec<_> = report
        .by_player
        .iter()
        .map(|p| (p.player, p.amount as i64))
        .collect();
    assert_eq!(
        rows(&r.fight, &filter, MeterCategory::DamageTaken),
        expected
    );
    let warrior = meter(
        &r.fight,
        &filter,
        MeterCategory::DamageTaken,
        Some(r.warrior),
    );
    assert_eq!(
        entries(&warrior.breakdown),
        [
            (spell(VIRULENT_SPIT), 900),
            (spell(MELEE), 400),
            (
                MeterKey::Spell {
                    spell: MELEE,
                    environmental: true
                },
                250
            )
        ],
        "world damage stays apart from melee"
    );
}

#[test]
fn meter_healing_received_by_healer_sums_to_the_player_detail() {
    let r = raid();
    let filter = span(Attribution::Reattributed);
    let meter = meter(
        &r.fight,
        &filter,
        MeterCategory::HealingReceived,
        Some(r.warrior),
    );
    let detail = player_detail(
        &r.fight,
        &Curated::bundled(),
        r.warrior,
        Metric::Healing,
        &filter,
        &Scope::default(),
    )
    .unwrap();
    let row = meter
        .rows
        .iter()
        .find(|row| row.player == r.warrior)
        .unwrap();
    assert_eq!(row.amount, detail.healing_received as i64);
    assert_eq!(
        meter.breakdown.iter().map(|e| e.amount).sum::<i64>(),
        row.amount
    );
    assert_eq!(
        entries(&meter.breakdown),
        [
            (MeterKey::Unit(r.priest), 750),
            (MeterKey::Unit(r.hunter), 300)
        ],
        "the Spirit Beast's heal sits under the hunter"
    );
}

#[test]
fn meter_interrupts_count_and_list_the_stopped_spells() {
    let r = raid();
    let filter = span(Attribution::Reattributed);
    let report = interrupts_report(&r.fight, &filter, &Scope::default(), Dimension::Source);
    assert_eq!(report.interrupts.len(), 5);
    let kicks = meter(&r.fight, &filter, MeterCategory::Interrupts, Some(r.mage));
    let actual: Vec<_> = kicks
        .rows
        .iter()
        .map(|row| (row.player, row.amount, row.per_second))
        .collect();
    assert_eq!(
        actual,
        [(r.mage, 3, 0.0), (r.warrior, 1, 0.0), (r.hunter, 1, 0.0)]
    );
    assert_eq!(entries(&kicks.breakdown), [(spell(5), 2), (spell(7), 1)]);
}

#[test]
fn meter_dispels_count_spellsteal() {
    let r = raid();
    let filter = span(Attribution::Reattributed);
    assert_eq!(
        rows(&r.fight, &filter, MeterCategory::Dispels),
        [(r.mage, 1), (r.priest, 1)]
    );
    let mage = meter(&r.fight, &filter, MeterCategory::Dispels, Some(r.mage));
    assert_eq!(entries(&mage.breakdown), [(spell(11), 1)]);
}

#[test]
fn meter_follows_the_attribution_mode() {
    let r = raid();
    let has_support_row = |mode| {
        meter(
            &r.fight,
            &span(mode),
            MeterCategory::DamageDone,
            Some(r.evoker),
        )
        .breakdown
        .iter()
        .any(|e| {
            matches!(
                e.key,
                MeterKey::Ability {
                    kind: RowKind::SupportGiven,
                    ..
                }
            )
        })
    };
    assert!(has_support_row(Attribution::Reattributed));
    assert!(!has_support_row(Attribution::Augmented));
}

#[test]
fn an_empty_span_has_no_rows() {
    let r = raid();
    let filter = ReportFilter {
        start_ms: 5_000,
        end_ms: 5_000,
        attribution: Attribution::Reattributed,
        overkill: Overkill::Excluded,
    };
    for category in [
        MeterCategory::DamageDone,
        MeterCategory::HealingDone,
        MeterCategory::DamageTaken,
        MeterCategory::HealingReceived,
        MeterCategory::Interrupts,
        MeterCategory::Dispels,
    ] {
        let meter = meter(&r.fight, &filter, category, Some(r.warrior));
        assert_eq!(meter.duration_ms, 0);
        assert!(meter.rows.is_empty(), "{category:?}");
        assert!(meter.breakdown.is_empty(), "{category:?}");
    }
}
