mod support;

use openlogs_analysis::{
    AbilityRef, ActorId, Attribution, AuraAction, AuraType, CastOutcome, Damage, DamageVia,
    Dimension, EventKind, EventsPage, FailReason, Fight, MissType, Missed, NO_SPELL, NOBODY, Page,
    ReportFilter, RowType, Scope, ScopeMetric, Side, UnitHp, UnitRef, ViewOptions, breakdown,
    casts_report, events,
};
use openlogs_gamedata::Curated;
use openlogs_index::Outcome;
use support::{FightBuilder, HOSTILE_FLAGS, MELEE, damage, heal};

const EBON_MIGHT: u32 = 395152;
const FIRE_BREATH: u32 = 357208;
const PYROBLAST: u32 = 11366;
const RENEW: u32 = 139;
const CLEAVE: u32 = 1286835;

struct Raid {
    fight: Fight,
    mage: ActorId,
    warrior: ActorId,
    evoker: ActorId,
}

fn supported(via: DamageVia, amount: u64, evoker: ActorId) -> EventKind {
    EventKind::Damage(Damage {
        supporter: evoker,
        ..damage(via, amount, 0)
    })
}

/// A mage hit with Ebon Might support, a warrior swing whose support follows its landed copy,
/// support no hit matches, the Evoker's own hit, a heal and two hits on the raid.
fn raid() -> Raid {
    let mut b = FightBuilder::new(20_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let warrior = b.player("Player-2", "Washed-Frostwolf-EU", 71);
    let evoker = b.player("Player-3", "Sparkyevo-Rexxar-EU", 1473);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    for (id, name) in [
        (EBON_MIGHT, "Ebon Might"),
        (PYROBLAST, "Pyroblast"),
        (RENEW, "Renew"),
        (CLEAVE, "Necrotic Vapors"),
    ] {
        b.spell(id, name);
    }
    let spell_hit = |amount| EventKind::Damage(damage(DamageVia::Spell, amount, 0));
    b.push(1_000, mage, boss, PYROBLAST, spell_hit(1_000));
    b.push(
        1_001,
        mage,
        boss,
        EBON_MIGHT,
        supported(DamageVia::Spell, 100, evoker),
    );
    b.push(
        2_000,
        warrior,
        boss,
        MELEE,
        EventKind::Damage(damage(DamageVia::Swing, 800, 0)),
    );
    b.push(
        2_013,
        warrior,
        boss,
        MELEE,
        EventKind::Damage(damage(DamageVia::SwingLanded, 800, 0)),
    );
    b.push(
        2_013,
        warrior,
        boss,
        EBON_MIGHT,
        supported(DamageVia::SwingLanded, 60, evoker),
    );
    b.push(
        3_000,
        mage,
        boss,
        EBON_MIGHT,
        supported(DamageVia::Periodic, 40, evoker),
    );
    b.push(4_000, evoker, boss, PYROBLAST, spell_hit(300));
    b.push(5_000, evoker, mage, RENEW, EventKind::Heal(heal(500, 100)));
    b.push(6_000, boss, warrior, CLEAVE, spell_hit(700));
    b.push(
        6_500,
        boss,
        mage,
        CLEAVE,
        EventKind::Missed(Missed {
            via: DamageVia::Spell,
            miss_type: MissType::Absorb,
            amount_missed: 250,
        }),
    );
    Raid {
        fight: b.build(),
        mage,
        warrior,
        evoker,
    }
}

fn filter(attribution: Attribution) -> ReportFilter {
    ReportFilter::whole(attribution)
}

fn page_of(fight: &Fight, f: &ReportFilter, scope: &Scope, metric: ScopeMetric) -> EventsPage {
    events(
        fight,
        &Curated::bundled(),
        f,
        scope,
        metric,
        &ViewOptions::default(),
        Page::From {
            offset: 0,
            limit: 100,
        },
    )
}

#[test]
fn amounts_add_up_to_the_table_under_every_selection() {
    let r = raid();
    let curated = Curated::bundled();
    let by = |source: Vec<UnitRef>, ability: Vec<AbilityRef>, target: Vec<UnitRef>| Scope {
        source,
        ability,
        target,
        ..Scope::default()
    };
    let scopes = [
        Scope::default(),
        by(vec![UnitRef::Player(r.evoker)], vec![], vec![]),
        by(vec![UnitRef::Player(r.mage)], vec![], vec![]),
        by(vec![], vec![AbilityRef::Id(EBON_MIGHT)], vec![]),
        by(vec![], vec![AbilityRef::Id(MELEE)], vec![]),
        by(vec![], vec![], vec![UnitRef::Player(r.warrior)]),
    ];
    for attribution in [Attribution::Augmented, Attribution::Reattributed] {
        let f = filter(attribution);
        for metric in [
            ScopeMetric::DamageDone,
            ScopeMetric::Healing,
            ScopeMetric::DamageTaken,
        ] {
            for perspective in [Side::Friendly, Side::Enemy] {
                for scope in &scopes {
                    let scope = Scope {
                        perspective,
                        ..scope.clone()
                    };
                    let table =
                        breakdown(&r.fight, &curated, &f, &scope, metric, Dimension::Source);
                    let page = page_of(&r.fight, &f, &scope, metric);
                    assert_eq!(
                        page.amount,
                        Some(table.total),
                        "{metric:?} {perspective:?} {attribution:?} {scope:?}"
                    );
                }
            }
        }
    }
}

#[test]
fn support_shares_stay_inline_in_the_hit_they_belong_to() {
    let r = raid();
    let f = filter(Attribution::Reattributed);
    let page = page_of(&r.fight, &f, &Scope::default(), ScopeMetric::DamageDone);
    let rows: Vec<(RowType, ActorId, u64, Vec<u64>)> = page
        .rows
        .iter()
        .map(|row| {
            (
                row.row_type,
                row.source,
                row.amount.unwrap(),
                row.shares.iter().map(|s| s.amount).collect(),
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            (RowType::Damage, r.mage, 1_000, vec![100]),
            (RowType::Melee, r.warrior, 800, vec![60]),
            (RowType::Damage, r.evoker, 300, vec![]),
        ],
        "the landed copy is hidden and its support moves to the swing"
    );
    assert_eq!(
        page.unlisted_support, 0,
        "net of the credit and the deduction"
    );
    assert_eq!(page.rows[0].event, "SPELL_DAMAGE");
    assert_eq!(page.rows[1].event, "SWING_DAMAGE");

    let evoker = Scope {
        source: vec![UnitRef::Player(r.evoker)],
        ..Scope::default()
    };
    let his = page_of(&r.fight, &f, &evoker, ScopeMetric::DamageDone);
    assert_eq!(
        his.rows.iter().map(|row| row.source).collect::<Vec<_>>(),
        [r.mage, r.warrior, r.evoker],
        "hits that carry his share keep their logged source"
    );
    assert!(his.rows[0].shares[0].selected);
    assert!(
        his.narrowed.is_empty(),
        "rows matched through his share keep their source column"
    );
    assert_eq!(his.unlisted_support, 40, "the support no hit matches");
    assert_eq!(his.amount, Some(100 + 60 + 40 + 300));
    let augmented = page_of(
        &r.fight,
        &filter(Attribution::Augmented),
        &evoker,
        ScopeMetric::DamageDone,
    );
    assert_eq!(augmented.total, 1, "as logged, only his own hit is his");
    assert_eq!(augmented.narrowed, [Dimension::Source]);
    assert!(!page.rows[0].shares[0].selected);
}

#[test]
fn target_hp_shows_only_when_the_log_names_the_target() {
    let mut b = FightBuilder::new(10_000);
    let warrior = b.player("Player-2", "Washed-Frostwolf-EU", 71);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.hit(1_000, warrior, boss, PYROBLAST, 500, (9_500, 10_000));
    b.push(
        2_000,
        warrior,
        boss,
        MELEE,
        EventKind::Damage(damage(DamageVia::Swing, 400, 0)),
    );
    let mut fight = b.build();
    fight.events[1].unit_hp = Some(UnitHp {
        actor: warrior,
        current: 80,
        max: 100,
    });
    let page = page_of(
        &fight,
        &filter(Attribution::Augmented),
        &Scope::default(),
        ScopeMetric::DamageDone,
    );
    assert_eq!(page.rows[0].target_hp, Some((9_500, 10_000)));
    assert_eq!(
        page.rows[1].target_hp, None,
        "a swing's HP is the attacker's"
    );
}

#[test]
fn pages_count_every_row_and_find_the_page_of_a_time() {
    let mut b = FightBuilder::new(10_000);
    let warrior = b.player("Player-2", "Washed-Frostwolf-EU", 71);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    for i in 0..5 {
        b.push(
            1_000 * (i + 1),
            warrior,
            boss,
            PYROBLAST,
            EventKind::Damage(damage(DamageVia::Spell, 100, 0)),
        );
    }
    let fight = b.build();
    let f = filter(Attribution::Augmented);
    let page = |page| {
        events(
            &fight,
            &Curated::bundled(),
            &f,
            &Scope::default(),
            ScopeMetric::DamageDone,
            &ViewOptions::default(),
            page,
        )
    };
    let second = page(Page::From {
        offset: 2,
        limit: 2,
    });
    assert_eq!((second.total, second.offset), (5, 2));
    assert_eq!(
        second.rows.iter().map(|r| r.t).collect::<Vec<_>>(),
        [3_000, 4_000]
    );
    let last = page(Page::From {
        offset: 4,
        limit: 2,
    });
    assert_eq!(last.rows.iter().map(|r| r.t).collect::<Vec<_>>(), [5_000]);
    let at = page(Page::At { t: 4_500, limit: 2 });
    assert_eq!(at.offset, 4, "the row at 5:00 is the fifth");
    assert_eq!(at.rows[0].t, 5_000);
}

fn casts_page(fight: &Fight, options: ViewOptions) -> EventsPage {
    events(
        fight,
        &Curated::bundled(),
        &filter(Attribution::Augmented),
        &Scope::default(),
        ScopeMetric::Casts,
        &options,
        Page::From {
            offset: 0,
            limit: 100,
        },
    )
}

#[test]
fn casts_pair_their_begin_success_empower_and_interrupt_lines() {
    let mut b = FightBuilder::new(20_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let evoker = b.player("Player-3", "Sparkyevo-Rexxar-EU", 1473);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.fight.fail_reasons.push("Not yet recovered".into());
    let (frostbolt, upheaval, fire_blast, arcane_blast, kick) = (116, 396286, 108853, 30451, 1766);
    b.push(1_000, mage, boss, PYROBLAST, EventKind::CastStart);
    b.push(2_500, mage, boss, PYROBLAST, EventKind::CastSuccess);
    b.push(3_000, evoker, boss, upheaval, EventKind::EmpowerStart);
    b.push(3_000, evoker, boss, upheaval, EventKind::CastSuccess);
    b.push(
        4_800,
        evoker,
        boss,
        upheaval,
        EventKind::EmpowerEnd { stage: 3 },
    );
    b.push(5_000, mage, boss, frostbolt, EventKind::CastStart);
    b.push(
        5_950,
        boss,
        mage,
        kick,
        EventKind::Interrupt {
            interrupted: frostbolt,
        },
    );
    b.push(
        5_950,
        mage,
        boss,
        frostbolt,
        EventKind::CastFailed {
            reason: FailReason::Interrupted,
        },
    );
    b.push(
        6_000,
        mage,
        boss,
        fire_blast,
        EventKind::CastFailed {
            reason: FailReason::Other(0),
        },
    );
    b.push(7_000, mage, boss, arcane_blast, EventKind::CastStart);
    b.push(8_000, mage, boss, fire_blast, EventKind::CastSuccess);
    b.push(10_000, evoker, evoker, FIRE_BREATH, EventKind::EmpowerStart);
    b.push(10_000, evoker, NOBODY, FIRE_BREATH, EventKind::CastSuccess);
    b.push(
        11_230,
        evoker,
        NOBODY,
        FIRE_BREATH,
        EventKind::EmpowerInterrupt { stage: 1 },
    );
    b.push(
        11_230,
        boss,
        evoker,
        kick,
        EventKind::Interrupt {
            interrupted: FIRE_BREATH,
        },
    );
    b.push(12_000, evoker, NOBODY, FIRE_BREATH, EventKind::EmpowerStart);
    b.push(12_000, evoker, NOBODY, FIRE_BREATH, EventKind::CastSuccess);
    let fight = b.build();

    let plain = casts_page(&fight, ViewOptions::default());
    let rows: Vec<_> = plain
        .rows
        .iter()
        .map(|r| (r.t, r.row_type, r.duration_ms, r.stage))
        .collect();
    assert_eq!(
        rows,
        [
            (2_500, RowType::Cast, Some(1_500), None),
            (3_000, RowType::Cast, Some(1_800), Some(3)),
            (5_950, RowType::Interrupted, Some(950), None),
            (8_000, RowType::Cast, None, None),
            (10_000, RowType::Cast, Some(1_230), Some(1)),
            (11_230, RowType::Interrupted, Some(1_230), Some(1)),
            (12_000, RowType::Cast, None, None),
        ],
        "an empower is one cast; an interrupt logged twice is one row"
    );
    assert_eq!(plain.rows[2].by, Some((boss, kick)));

    let all = casts_page(
        &fight,
        ViewOptions {
            begin_casts: true,
            rejected: true,
            ..ViewOptions::default()
        },
    );
    let begins: Vec<_> = all
        .rows
        .iter()
        .filter(|r| r.row_type == RowType::BeginCast)
        .map(|r| (r.t, r.outcome, r.duration_ms))
        .collect();
    assert_eq!(
        begins,
        [
            (1_000, Some(CastOutcome::Completed), Some(1_500)),
            (3_000, Some(CastOutcome::Released), Some(1_800)),
            (5_000, Some(CastOutcome::Interrupted), Some(950)),
            (7_000, Some(CastOutcome::NoOutcome), None),
            (10_000, Some(CastOutcome::Interrupted), Some(1_230)),
            (12_000, Some(CastOutcome::NoOutcome), None),
        ]
    );
    let rejected = all
        .rows
        .iter()
        .find(|r| r.row_type == RowType::Rejected)
        .unwrap();
    assert_eq!(
        (rejected.t, fight.fail_reason(rejected.reason.unwrap())),
        (6_000, "Not yet recovered")
    );
    let at_3s: Vec<_> = all
        .rows
        .iter()
        .filter(|r| r.t == 3_000)
        .map(|r| r.event)
        .collect();
    assert_eq!(at_3s, ["SPELL_EMPOWER_START", "SPELL_CAST_SUCCESS"]);
}

#[test]
fn cast_rows_are_the_tables_presses_with_their_follow_ups_flagged() {
    let mut b = FightBuilder::new(20_000);
    let dh = b.player("Player-1", "Selwyn-Ironmoor-EU", 581);
    b.spell(441424, "Exterminate");
    b.spell(441426, "Exterminate");
    b.spell(204255, "Soul Fragment");
    for t in [1_000, 4_000] {
        b.push(t, dh, 0, 441424, EventKind::CastSuccess);
        b.push(t + 513, dh, 0, 441426, EventKind::CastSuccess);
        b.push(t + 600, dh, 0, 204255, EventKind::CastSuccess);
    }
    let fight = b.build();
    let curated = Curated::bundled();
    let table = casts_report(
        &fight,
        &curated,
        &filter(Attribution::Augmented),
        &Scope::default(),
        Dimension::Source,
        true,
    );
    let page = casts_page(
        &fight,
        ViewOptions {
            hide_procs: true,
            ..ViewOptions::default()
        },
    );
    let presses = page.rows.iter().filter(|r| r.press_ms.is_none()).count();
    assert_eq!(presses as i64, table.breakdown.total);
    assert_eq!(
        page.rows
            .iter()
            .filter_map(|r| r.press_ms.map(|press| (r.t, press)))
            .collect::<Vec<_>>(),
        [(1_513, 1_000), (4_513, 4_000)],
        "the second Exterminate swing is part of its press"
    );
    assert_eq!(page.hidden_procs, 2);
}
fn aura(action: AuraAction, aura_type: AuraType, stacks: Option<u32>) -> EventKind {
    EventKind::Aura {
        action,
        aura_type,
        stacks,
        broken_by: NO_SPELL,
    }
}

#[test]
fn aura_rows_list_the_sides_holders_and_name_what_broke_an_aura() {
    let mut b = FightBuilder::new(20_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let (invisibility, vapors, bond) = (110960, CLEAVE, 1290779);
    b.push(
        1_000,
        mage,
        mage,
        invisibility,
        aura(AuraAction::Applied, AuraType::Buff, None),
    );
    b.push(
        2_000,
        boss,
        mage,
        vapors,
        aura(AuraAction::Applied, AuraType::Debuff, None),
    );
    b.push(
        2_500,
        boss,
        mage,
        vapors,
        aura(AuraAction::AppliedDose, AuraType::Debuff, Some(2)),
    );
    b.push(
        2_700,
        boss,
        mage,
        vapors,
        aura(AuraAction::RemovedDose, AuraType::Debuff, Some(1)),
    );
    b.push(
        3_000,
        boss,
        boss,
        bond,
        aura(AuraAction::Applied, AuraType::Buff, None),
    );
    b.push(
        4_000,
        boss,
        mage,
        invisibility,
        EventKind::Aura {
            action: AuraAction::BrokenSpell,
            aura_type: AuraType::Buff,
            stacks: None,
            broken_by: vapors,
        },
    );
    b.push(
        4_000,
        mage,
        mage,
        invisibility,
        aura(AuraAction::Removed, AuraType::Buff, None),
    );
    let fight = b.build();
    let f = filter(Attribution::Augmented);
    let buffs = page_of(&fight, &f, &Scope::default(), ScopeMetric::Buffs);
    let rows: Vec<_> = buffs
        .rows
        .iter()
        .map(|r| (r.t, r.row_type, r.aura_kind, r.by))
        .collect();
    assert_eq!(
        rows,
        [
            (1_000, RowType::Apply, Some(AuraType::Buff), None),
            (
                4_000,
                RowType::Remove,
                Some(AuraType::Buff),
                Some((boss, vapors))
            ),
        ],
        "the break is no row of its own; the boss's buff is no friendly's"
    );
    let debuffs = page_of(&fight, &f, &Scope::default(), ScopeMetric::Debuffs);
    assert_eq!(
        debuffs
            .rows
            .iter()
            .map(|r| (r.row_type, r.aura_kind, r.stacks))
            .collect::<Vec<_>>(),
        [
            (RowType::Apply, Some(AuraType::Debuff), None),
            (RowType::StackGained, Some(AuraType::Debuff), Some(2)),
            (RowType::StackLost, Some(AuraType::Debuff), Some(1))
        ]
    );
    let enemies = Scope {
        perspective: Side::Enemy,
        ..Scope::default()
    };
    let theirs = page_of(&fight, &f, &enemies, ScopeMetric::Buffs);
    assert_eq!(
        theirs.rows.iter().map(|r| r.spell).collect::<Vec<_>>(),
        [bond]
    );
}

#[test]
fn death_rows_lead_with_their_recap_and_only_deaths_count() {
    let mut b = FightBuilder::new(20_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let priest = b.player("Player-4", "Tyreeze-Eredar-EU", 257);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.push(1_000, priest, mage, RENEW, EventKind::Heal(heal(300, 0)));
    b.push(
        2_000,
        boss,
        mage,
        CLEAVE,
        EventKind::Damage(damage(DamageVia::Spell, 900, 150)),
    );
    b.push(2_000, 0, mage, 0, EventKind::Died { unconscious: false });
    b.push(5_000, 0, priest, 0, EventKind::Died { unconscious: false });
    let fight = b.build();
    let f = filter(Attribution::Augmented);
    let page = page_of(&fight, &f, &Scope::default(), ScopeMetric::Deaths);
    let rows: Vec<_> = page
        .rows
        .iter()
        .map(|r| (r.t, r.row_type, r.amount, r.unknown_blow))
        .collect();
    assert_eq!(
        rows,
        [
            (1_000, RowType::Recap, Some(300), false),
            (2_000, RowType::Recap, Some(900), false),
            (2_000, RowType::Died, Some(150), false),
            (5_000, RowType::Died, None, true),
        ]
    );
    assert_eq!(page.total, 2, "recap rows are context");
    assert_eq!(page.rows[0].context_of, Some(page.rows[2].index));
    let by_boss = Scope {
        source: vec![UnitRef::Unit("Ula'tek".into())],
        ..Scope::default()
    };
    let killed = page_of(&fight, &f, &by_boss, ScopeMetric::Deaths);
    assert_eq!(
        killed.total, 1,
        "a death without a lethal hit passes only while every source is selected"
    );
}

#[test]
fn kills_keep_the_boss_that_dies_at_the_pull_end() {
    let mut b = FightBuilder::new(20_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let add = b.unit(
        "Creature-0-1-1-1-261874-01",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    b.hit(1_000, mage, boss, PYROBLAST, 9_000, (1_000, 10_000));
    b.hit(2_000, mage, add, PYROBLAST, 500, (0, 500));
    b.push(2_000, 0, add, 0, EventKind::Died { unconscious: false });
    b.fight.outcome = Outcome::Kill;
    let fight = b.build();
    let enemies = Scope {
        perspective: Side::Enemy,
        ..Scope::default()
    };
    let last_phase = ReportFilter {
        start_ms: 10_000,
        end_ms: 20_000,
        attribution: Attribution::Augmented,
    };
    let page = page_of(&fight, &last_phase, &enemies, ScopeMetric::Deaths);
    let rows: Vec<_> = page.rows.iter().map(|r| (r.t, r.target, r.event)).collect();
    assert_eq!(rows, [(20_000, boss, "ENCOUNTER_END")]);
    let whole = page_of(
        &fight,
        &filter(Attribution::Augmented),
        &enemies,
        ScopeMetric::Deaths,
    );
    assert_eq!(
        whole
            .rows
            .iter()
            .map(|r| (r.target, r.alive_ms))
            .collect::<Vec<_>>(),
        [(add, Some(0)), (boss, Some(19_000))]
    );
}

#[test]
fn interrupt_rows_carry_the_stopped_spell_as_their_ability() {
    let mut b = FightBuilder::new(20_000);
    let warrior = b.player("Player-2", "Washed-Frostwolf-EU", 71);
    let priest = b.player("Player-4", "Tyreeze-Eredar-EU", 257);
    let warden = b.unit(
        "Creature-0-1-1-1-264045-01",
        "Doomscale Warden",
        HOSTILE_FLAGS,
    );
    let (pummel, malice, purify, vapors) = (6552, 1290779, 527, CLEAVE);
    b.push(
        1_000,
        warrior,
        warden,
        pummel,
        EventKind::Interrupt {
            interrupted: malice,
        },
    );
    b.push(
        2_000,
        priest,
        warrior,
        purify,
        EventKind::Dispel {
            removed: vapors,
            aura_type: AuraType::Debuff,
        },
    );
    let fight = b.build();
    let f = filter(Attribution::Augmented);
    let page = page_of(&fight, &f, &Scope::default(), ScopeMetric::Interrupts);
    let rows: Vec<_> = page
        .rows
        .iter()
        .map(|r| (r.row_type, r.spell, r.used))
        .collect();
    assert_eq!(
        rows,
        [
            (RowType::Interrupt, malice, Some(pummel)),
            (RowType::Dispel, vapors, Some(purify)),
        ]
    );
    let malice_only = Scope {
        ability: vec![AbilityRef::Id(malice)],
        ..Scope::default()
    };
    let page = page_of(&fight, &f, &malice_only, ScopeMetric::Interrupts);
    assert_eq!(page.total, 1);
    assert_eq!(page.narrowed, [Dimension::Ability]);
}

#[test]
fn casts_events_reconcile_with_the_table_under_a_target_selection() {
    let mut b = FightBuilder::new(20_000);
    let evoker = b.player("Player-3", "Sparkyevo-Rexxar-EU", 1473);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.push(1_000, evoker, evoker, FIRE_BREATH, EventKind::EmpowerStart);
    b.push(1_000, evoker, NOBODY, FIRE_BREATH, EventKind::CastSuccess);
    b.push(
        2_000,
        evoker,
        NOBODY,
        FIRE_BREATH,
        EventKind::EmpowerEnd { stage: 2 },
    );
    b.push(3_000, evoker, boss, PYROBLAST, EventKind::CastSuccess);
    let fight = b.build();
    let curated = Curated::bundled();
    for target in [boss, evoker] {
        let scope = Scope {
            target: vec![UnitRef::Instance(target), UnitRef::Player(target)],
            ..Scope::default()
        };
        let table = casts_report(
            &fight,
            &curated,
            &filter(Attribution::Augmented),
            &scope,
            Dimension::Source,
            true,
        );
        let page = events(
            &fight,
            &curated,
            &filter(Attribution::Augmented),
            &scope,
            ScopeMetric::Casts,
            &ViewOptions::default(),
            Page::From {
                offset: 0,
                limit: 100,
            },
        );
        let presses = page.rows.iter().filter(|r| r.press_ms.is_none()).count();
        assert_eq!(presses as i64, table.breakdown.total);
    }
}

#[test]
fn a_selection_is_narrowed_only_when_every_row_shows_one_identity() {
    let mut b = FightBuilder::new(10_000);
    let warlock = b.player("Player-1", "Wendel-Emberfall-EU", 265);
    let mage = b.player("Player-2", "Faelan-Emberfall-EU", 63);
    let imp = b.unit("Pet-0-0-0-0-416-0000000001", "Wild Imp", 0x1111);
    let boss = b.unit("Creature-0-0-0-0-1-0000000001", "Ula'tek", HOSTILE_FLAGS);
    b.fight.actors.set_owner(imp, warlock);
    b.spell(PYROBLAST, "Pyroblast");
    b.push(
        1_000,
        warlock,
        boss,
        PYROBLAST,
        EventKind::Damage(damage(DamageVia::Spell, 10, 0)),
    );
    b.push(
        1_100,
        imp,
        boss,
        PYROBLAST,
        EventKind::Damage(damage(DamageVia::Spell, 5, 0)),
    );
    let fight = b.build();
    let source = |unit| Scope {
        source: vec![unit],
        ..Scope::default()
    };
    let narrowed = |scope: &Scope| {
        page_of(
            &fight,
            &filter(Attribution::Augmented),
            scope,
            ScopeMetric::DamageDone,
        )
        .narrowed
    };
    assert!(
        narrowed(&source(UnitRef::Player(warlock))).is_empty(),
        "the warlock's pet shows its own name"
    );
    assert_eq!(
        narrowed(&source(UnitRef::Player(mage))),
        [Dimension::Source]
    );
    assert_eq!(
        narrowed(&source(UnitRef::Pet {
            owner: warlock,
            name: "Wild Imp".into()
        })),
        [Dimension::Source]
    );
    assert!(narrowed(&source(UnitRef::Unit("Ula'tek".into()))).is_empty());
    assert_eq!(
        narrowed(&source(UnitRef::Instance(boss))),
        [Dimension::Source]
    );
}
