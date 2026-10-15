mod support;

use openlogs_analysis::{
    AbilityRef, ActorId, AmountRule, Attribution, AuraAction, AuraType, Damage, DamageVia,
    Dimension, EventKind, Fight, ItemKind, ReportFilter, RowKey, Scope, ScopeMetric, Side,
    Timeline, UnitRef, ViewOptions, Window, breakdown, timeline,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS, damage};

const EBON_MIGHT: u32 = 395152;
const PYROBLAST: u32 = 11366;
const FLAMESTRIKE: u32 = 2120;
const FIRE_BLAST: u32 = 108853;
const ERUPTION: u32 = 395160;
const CAUSTIC: u32 = 1287012;

struct Pull {
    fight: Fight,
    mage: ActorId,
    evoker: ActorId,
    boss: ActorId,
    add_a: ActorId,
}

fn spell_hit(amount: u64) -> EventKind {
    EventKind::Damage(damage(DamageVia::Spell, amount, 0))
}

/// A mage's cast-time Pyroblast, an AoE Flamestrike without a target, an Evoker's Ebon Might
/// whose support lands on the mage's hits, and a boss cast.
fn pull() -> Pull {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let evoker = b.player("Player-3", "Sparkyevo-Rexxar-EU", 1473);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let add_a = b.unit(
        "Creature-0-1-1-1-261874-01",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    let add_b = b.unit(
        "Creature-0-1-1-1-261874-02",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    for (id, name) in [
        (EBON_MIGHT, "Ebon Might"),
        (PYROBLAST, "Pyroblast"),
        (FLAMESTRIKE, "Flamestrike"),
        (FIRE_BLAST, "Fire Blast"),
        (ERUPTION, "Eruption"),
        (CAUSTIC, "Caustic Waves"),
    ] {
        b.spell(id, name);
    }
    b.push(1_000, evoker, evoker, EBON_MIGHT, EventKind::CastSuccess);
    b.push(2_000, mage, boss, PYROBLAST, EventKind::CastStart);
    b.push(4_500, mage, boss, PYROBLAST, EventKind::CastSuccess);
    b.hit(5_000, mage, boss, PYROBLAST, 1_000, (9_000, 10_000));
    b.push(
        5_001,
        mage,
        boss,
        EBON_MIGHT,
        EventKind::Damage(Damage {
            supporter: evoker,
            ..damage(DamageVia::Spell, 100, 0)
        }),
    );
    b.push(6_000, mage, 0, FLAMESTRIKE, EventKind::CastSuccess);
    b.push(6_500, mage, add_a, FLAMESTRIKE, spell_hit(300));
    b.push(6_500, mage, add_b, FLAMESTRIKE, spell_hit(200));
    b.push(30_000, mage, boss, PYROBLAST, EventKind::CastSuccess);
    b.push(31_000, mage, boss, PYROBLAST, spell_hit(700));
    b.push(40_000, mage, boss, FIRE_BLAST, EventKind::CastSuccess);
    b.push(48_000, evoker, boss, ERUPTION, EventKind::CastSuccess);
    b.push(48_500, evoker, boss, ERUPTION, spell_hit(400));
    b.push(10_000, boss, 0, CAUSTIC, EventKind::CastStart);
    b.push(12_000, boss, 0, CAUSTIC, EventKind::CastSuccess);
    b.push(13_000, boss, mage, CAUSTIC, spell_hit(900));
    b.hit(14_000, mage, boss, PYROBLAST, 50, (8_000, 10_000));
    Pull {
        fight: b.build(),
        mage,
        evoker,
        boss,
        add_a,
    }
}

fn view(
    p: &Pull,
    scope: &Scope,
    metric: ScopeMetric,
    lanes: Dimension,
    window: (i32, i32),
    attribution: Attribution,
) -> Timeline {
    timeline(
        &p.fight,
        &Curated::bundled(),
        &ReportFilter::whole(attribution),
        scope,
        metric,
        lanes,
        &ViewOptions::default(),
        Window {
            start_ms: window.0,
            end_ms: window.1,
        },
    )
}

fn lane_keys(view: &Timeline) -> Vec<Option<RowKey>> {
    view.lanes.iter().map(|l| l.key.clone()).collect()
}

#[test]
fn lanes_follow_the_chosen_dimension_unless_it_is_narrowed() {
    let p = pull();
    let whole = (0, 60_000);
    let casts = |scope: &Scope, lanes| {
        view(
            &p,
            scope,
            ScopeMetric::Casts,
            lanes,
            whole,
            Attribution::Augmented,
        )
    };
    let by_source = casts(&Scope::default(), Dimension::Source);
    assert_eq!(by_source.axis, Some(Dimension::Source));
    assert_eq!(
        lane_keys(&by_source),
        [
            Some(RowKey::Unit(UnitRef::Player(p.mage))),
            Some(RowKey::Unit(UnitRef::Player(p.evoker))),
        ],
        "ordered by casts, as the table"
    );
    let mage = Scope {
        source: vec![UnitRef::Player(p.mage)],
        ..Scope::default()
    };
    assert_eq!(
        casts(&mage, Dimension::Source).axis,
        Some(Dimension::Ability)
    );
    let pyroblasts = Scope {
        ability: vec![AbilityRef::Name("Pyroblast".into())],
        ..mage.clone()
    };
    let one = casts(&pyroblasts, Dimension::Source);
    assert_eq!(one.axis, None);
    assert_eq!(lane_keys(&one), [None]);
    let damage = view(
        &p,
        &pyroblasts,
        ScopeMetric::DamageDone,
        Dimension::Source,
        whole,
        Attribution::Augmented,
    );
    assert_eq!(
        damage.axis,
        Some(Dimension::Target),
        "Damage Done falls back to its targets"
    );
}

#[test]
fn a_cast_carries_its_lines_and_the_hits_until_the_next_cast_of_its_name() {
    let p = pull();
    let mage = Scope {
        source: vec![UnitRef::Player(p.mage)],
        ..Scope::default()
    };
    let casts = view(
        &p,
        &mage,
        ScopeMetric::Casts,
        Dimension::Ability,
        (0, 20_000),
        Attribution::Augmented,
    );
    let pyroblast = casts
        .lanes
        .iter()
        .find(|l| {
            l.key
                == Some(RowKey::Ability {
                    ability: AbilityRef::Name("Pyroblast".into()),
                    kind: openlogs_analysis::CellKind::Own,
                })
        })
        .unwrap();
    assert_eq!(pyroblast.total, 2, "both presses count in the range");
    assert_eq!(pyroblast.items.len(), 1, "only the window's cast is drawn");
    let cast = &pyroblast.items[0];
    assert_eq!(
        (cast.kind, cast.start_ms, cast.end_ms),
        (ItemKind::CastTime, 2_000, Some(4_500))
    );
    assert_eq!(
        cast.log.iter().map(|l| l.event).collect::<Vec<_>>(),
        ["SPELL_CAST_START", "SPELL_CAST_SUCCESS"]
    );
    let amount = cast.amount.unwrap();
    assert_eq!(amount.rule, AmountRule::UntilNextCast);
    assert_eq!(
        (amount.amount, amount.hits),
        (1_050, 2),
        "the hit 9.5 s after the cast counts, the cast at 0:30 starts anew"
    );
}

#[test]
fn a_narrowed_target_keeps_the_aoe_cast_that_hit_it() {
    let p = pull();
    let on_a = Scope {
        target: vec![UnitRef::Instance(p.add_a)],
        ..Scope::default()
    };
    let damage = view(
        &p,
        &on_a,
        ScopeMetric::DamageDone,
        Dimension::Source,
        (0, 60_000),
        Attribution::Augmented,
    );
    let marks: Vec<_> = damage
        .lanes
        .iter()
        .flat_map(|l| l.items.iter())
        .map(|i| (i.spell, i.amount.unwrap().amount, i.amount.unwrap().targets))
        .collect();
    assert_eq!(marks, [(FLAMESTRIKE, 300, 1)]);
}

#[test]
fn damage_lanes_add_up_like_the_table_and_support_lands_on_the_buff() {
    let p = pull();
    let curated = Curated::bundled();
    let whole = ReportFilter::whole(Attribution::Reattributed);
    let damage = view(
        &p,
        &Scope::default(),
        ScopeMetric::DamageDone,
        Dimension::Source,
        (0, 60_000),
        Attribution::Reattributed,
    );
    let table = breakdown(
        &p.fight,
        &curated,
        &whole,
        &Scope::default(),
        ScopeMetric::DamageDone,
        Dimension::Source,
    );
    let totals: Vec<_> = damage
        .lanes
        .iter()
        .map(|l| (l.key.clone(), l.total))
        .collect();
    let rows: Vec<_> = table
        .rows
        .iter()
        .map(|r| (Some(r.row.key.clone()), r.row.amount))
        .collect();
    assert_eq!(totals, rows);
    let evoker = damage
        .lanes
        .iter()
        .find(|l| l.key == Some(RowKey::Unit(UnitRef::Player(p.evoker))))
        .unwrap();
    let ebon = evoker
        .items
        .iter()
        .find(|i| i.spell == EBON_MIGHT)
        .unwrap()
        .amount
        .unwrap();
    assert_eq!((ebon.amount, ebon.support), (100, 100));
    let mage = damage
        .lanes
        .iter()
        .find(|l| l.key == Some(RowKey::Unit(UnitRef::Player(p.mage))))
        .unwrap();
    let pyroblast = mage.items[0].amount.unwrap();
    assert_eq!(
        (pyroblast.amount, pyroblast.support),
        (1_050, 100),
        "the hits as logged, with the Aug support inside named"
    );
}

#[test]
fn the_context_lane_shows_boss_casts_except_for_enemy_casts() {
    let p = pull();
    let friendly = view(
        &p,
        &Scope::default(),
        ScopeMetric::Casts,
        Dimension::Source,
        (0, 60_000),
        Attribution::Augmented,
    );
    let boss_cast = &friendly.context[0];
    assert_eq!(
        (
            boss_cast.source,
            boss_cast.kind,
            boss_cast.start_ms,
            boss_cast.end_ms
        ),
        (p.boss, ItemKind::CastTime, 10_000, Some(12_000))
    );
    let amount = boss_cast.amount.unwrap();
    assert_eq!((amount.rule, amount.amount), (AmountRule::BossCast, 900));
    let enemies = Scope {
        perspective: Side::Enemy,
        ..Scope::default()
    };
    let theirs = view(
        &p,
        &enemies,
        ScopeMetric::Casts,
        Dimension::Source,
        (0, 60_000),
        Attribution::Augmented,
    );
    assert!(theirs.context.is_empty());
    assert_eq!(
        lane_keys(&theirs),
        [Some(RowKey::Unit(UnitRef::Unit("Ula'tek".into())))],
        "enemy casters are lanes by name"
    );
}

fn aura(action: AuraAction, aura_type: AuraType, stacks: Option<u32>) -> EventKind {
    EventKind::Aura {
        action,
        aura_type,
        stacks,
        broken_by: 0,
    }
}

fn plain(
    fight: &Fight,
    scope: &Scope,
    metric: ScopeMetric,
    lanes: Dimension,
    options: ViewOptions,
    window: (i32, i32),
) -> Timeline {
    timeline(
        fight,
        &Curated::bundled(),
        &ReportFilter::whole(Attribution::Augmented),
        scope,
        metric,
        lanes,
        &options,
        Window {
            start_ms: window.0,
            end_ms: window.1,
        },
    )
}

#[test]
fn damage_taken_draws_the_other_sides_debuffs_hits_and_deaths_on_the_lanes_unit() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let paladin = b.player("Player-5", "Purepala-Blackhand-EU", 65);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let forbearance = 25771;
    b.spell(CAUSTIC, "Caustic Waves");
    b.spell(forbearance, "Forbearance");
    b.push(
        1_000,
        boss,
        mage,
        CAUSTIC,
        aura(AuraAction::Applied, AuraType::Debuff, None),
    );
    b.push(2_000, boss, mage, CAUSTIC, spell_hit(400));
    b.push(3_000, boss, mage, CAUSTIC, spell_hit(500));
    b.push(
        4_000,
        boss,
        mage,
        CAUSTIC,
        aura(AuraAction::Removed, AuraType::Debuff, None),
    );
    b.push(5_000, boss, mage, CAUSTIC, spell_hit(600));
    b.push(
        1_500,
        paladin,
        mage,
        forbearance,
        aura(AuraAction::Applied, AuraType::Debuff, None),
    );
    b.push(6_000, 0, mage, 0, EventKind::Died { unconscious: false });
    let fight = b.build();
    let taken = plain(
        &fight,
        &Scope::default(),
        ScopeMetric::DamageTaken,
        Dimension::Target,
        ViewOptions::default(),
        (0, 60_000),
    );
    assert_eq!(
        taken.legend,
        [CAUSTIC],
        "a raid member's debuff is not drawn"
    );
    let lane = &taken.lanes[0];
    assert_eq!(lane.total, 1_500);
    let kinds: Vec<_> = lane.items.iter().map(|i| (i.kind, i.spell)).collect();
    assert_eq!(kinds, [(ItemKind::Aura, CAUSTIC), (ItemKind::Death, 0)]);
    let up = lane.items[0].amount.unwrap();
    assert_eq!(
        (up.rule, up.amount, up.hits),
        (AmountRule::WhileUp, 900, 2),
        "the hit after the debuff fell off is not its damage"
    );
    let paladin_only = Scope {
        source: vec![UnitRef::Player(paladin)],
        ..Scope::default()
    };
    let his = plain(
        &fight,
        &paladin_only,
        ScopeMetric::DamageTaken,
        Dimension::Target,
        ViewOptions::default(),
        (0, 60_000),
    );
    assert_eq!(his.legend, [forbearance]);
    let with_hits = plain(
        &fight,
        &Scope::default(),
        ScopeMetric::DamageTaken,
        Dimension::Target,
        ViewOptions {
            hits: true,
            ..ViewOptions::default()
        },
        (0, 60_000),
    );
    assert_eq!(
        with_hits.lanes[0]
            .items
            .iter()
            .filter(|i| i.kind == ItemKind::Hit)
            .count(),
        3
    );
}

#[test]
fn auras_that_never_overlap_share_a_track() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let (arcane, power, surge) = (1459, 10060, 365362);
    b.spell(arcane, "Arcane Intellect");
    b.spell(power, "Power Infusion");
    b.spell(surge, "Arcane Surge");
    let buff = |action| aura(action, AuraType::Buff, None);
    b.push(0, mage, mage, arcane, buff(AuraAction::Applied));
    b.push(10_000, mage, mage, arcane, buff(AuraAction::Removed));
    b.push(12_000, mage, mage, power, buff(AuraAction::Applied));
    b.push(20_000, mage, mage, power, buff(AuraAction::Removed));
    b.push(5_000, mage, mage, surge, buff(AuraAction::Applied));
    b.push(
        6_000,
        mage,
        mage,
        surge,
        aura(AuraAction::AppliedDose, AuraType::Buff, Some(3)),
    );
    b.push(15_000, mage, mage, surge, buff(AuraAction::Removed));
    let fight = b.build();
    let buffs = plain(
        &fight,
        &Scope::default(),
        ScopeMetric::Buffs,
        Dimension::Target,
        ViewOptions::default(),
        (0, 60_000),
    );
    let lane = &buffs.lanes[0];
    assert_eq!(lane.tracks, 2);
    let track = |spell| lane.items.iter().find(|i| i.spell == spell).unwrap().track;
    assert_eq!(track(arcane), track(power));
    assert_ne!(track(arcane), track(surge));
    let surge_bar = lane.items.iter().find(|i| i.spell == surge).unwrap();
    assert_eq!(surge_bar.stacks, Some(3));
    assert_eq!(
        surge_bar.log.iter().map(|l| l.event).collect::<Vec<_>>(),
        [
            "SPELL_AURA_APPLIED",
            "SPELL_AURA_APPLIED_DOSE",
            "SPELL_AURA_REMOVED"
        ]
    );
    let one_aura = Scope {
        ability: vec![AbilityRef::Name("Arcane Surge".into())],
        ..Scope::default()
    };
    let narrowed = plain(
        &fight,
        &one_aura,
        ScopeMetric::Buffs,
        Dimension::Target,
        ViewOptions::default(),
        (0, 60_000),
    );
    assert_eq!(narrowed.lanes[0].tracks, 1);
}

#[test]
fn death_lanes_start_with_the_first_death_and_kills_share_a_lane_per_name() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let priest = b.player("Player-4", "Tyreeze-Eredar-EU", 257);
    let add_a = b.unit(
        "Creature-0-1-1-1-261874-01",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    let add_b = b.unit(
        "Creature-0-1-1-1-261874-02",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    b.push(5_000, 0, mage, 0, EventKind::Died { unconscious: false });
    b.push(2_000, 0, priest, 0, EventKind::Died { unconscious: false });
    b.hit(1_000, mage, add_a, PYROBLAST, 100, (0, 100));
    b.hit(1_000, mage, add_b, PYROBLAST, 100, (0, 100));
    b.push(1_000, 0, add_a, 0, EventKind::Died { unconscious: false });
    b.push(3_000, 0, add_b, 0, EventKind::Died { unconscious: false });
    let fight = b.build();
    let deaths = plain(
        &fight,
        &Scope::default(),
        ScopeMetric::Deaths,
        Dimension::Target,
        ViewOptions::default(),
        (0, 60_000),
    );
    assert_eq!(
        lane_keys(&deaths),
        [
            Some(RowKey::Unit(UnitRef::Player(priest))),
            Some(RowKey::Unit(UnitRef::Player(mage))),
        ]
    );
    let mage_death = &deaths.lanes[1].items[0];
    assert_eq!(
        (mage_death.start_ms, mage_death.end_ms),
        (0, Some(5_000)),
        "the recap band starts at the pull"
    );
    let kills = plain(
        &fight,
        &Scope {
            perspective: Side::Enemy,
            ..Scope::default()
        },
        ScopeMetric::Deaths,
        Dimension::Target,
        ViewOptions::default(),
        (0, 60_000),
    );
    assert_eq!(kills.lanes.len(), 1);
    assert_eq!(
        kills.lanes[0]
            .items
            .iter()
            .map(|i| (i.target, i.alive_ms))
            .collect::<Vec<_>>(),
        [(add_a, Some(0)), (add_b, Some(2_000))]
    );
}

#[test]
fn an_interrupt_knows_how_far_into_the_cast_it_came() {
    let mut b = FightBuilder::new(60_000);
    let warrior = b.player("Player-2", "Washed-Frostwolf-EU", 71);
    let warden = b.unit(
        "Creature-0-1-1-1-264045-01",
        "Doomscale Warden",
        HOSTILE_FLAGS,
    );
    let (pummel, malice) = (6552, 1290779);
    b.push(1_000, warden, warrior, malice, EventKind::CastStart);
    b.push(
        1_950,
        warrior,
        warden,
        pummel,
        EventKind::Interrupt {
            interrupted: malice,
        },
    );
    let fight = b.build();
    let kicks = plain(
        &fight,
        &Scope::default(),
        ScopeMetric::Interrupts,
        Dimension::Source,
        ViewOptions::default(),
        (0, 60_000),
    );
    let kick = &kicks.lanes[0].items[0];
    assert_eq!(
        (kick.kind, kick.spell, kick.used, kick.cast_start_ms),
        (ItemKind::Interrupt, malice, Some(pummel), Some(1_000))
    );
}

#[test]
fn resource_lines_keep_the_lowest_sample_of_a_crowded_window() {
    let mut b = FightBuilder::new(60_000);
    let priest = b.player("Player-4", "Tyreeze-Eredar-EU", 257);
    for i in 0..1_500 {
        let current = if i == 1_234 { 400 } else { 1_000 };
        b.power(i * 10, priest, 0, current, 1_000);
    }
    b.power(45_000, priest, 0, 900, 1_000);
    let fight = b.build();
    let power = plain(
        &fight,
        &Scope::default(),
        ScopeMetric::Resources,
        Dimension::Source,
        ViewOptions::default(),
        (0, 20_000),
    );
    let mana = &power.lanes[0].power[0];
    assert!(mana.samples.len() < 1_300, "{} samples", mana.samples.len());
    assert!(mana.samples.contains(&(12_340, 400, 1_000)));
    assert_eq!(
        mana.samples.last(),
        Some(&(45_000, 900, 1_000)),
        "the next sample after the window carries the line to its edge"
    );
}

fn mark_amount(view: &Timeline, spell: u32, start_ms: i32) -> Option<(i64, u32)> {
    view.lanes
        .iter()
        .flat_map(|l| l.items.iter())
        .chain(view.context.iter())
        .find(|i| i.spell == spell && i.start_ms == start_ms)
        .and_then(|i| i.amount)
        .map(|a| (a.amount, a.hits))
}

#[test]
fn a_cast_keeps_its_hits_despite_rejected_inputs_interrupted_recasts_and_filters() {
    let mut b = FightBuilder::new(30_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(PYROBLAST, "Pyroblast");
    b.push(1_000, mage, boss, PYROBLAST, EventKind::CastSuccess);
    b.push(2_000, mage, boss, PYROBLAST, spell_hit(500));
    b.push(
        3_000,
        mage,
        boss,
        PYROBLAST,
        EventKind::CastFailed {
            reason: openlogs_analysis::FailReason::Other(0),
        },
    );
    b.push(4_000, mage, boss, PYROBLAST, EventKind::CastStart);
    b.push(
        4_500,
        mage,
        boss,
        PYROBLAST,
        EventKind::CastFailed {
            reason: openlogs_analysis::FailReason::Interrupted,
        },
    );
    b.push(6_000, mage, boss, PYROBLAST, spell_hit(300));
    let fight = b.build();
    let amount = |scope: &Scope| {
        let view = timeline(
            &fight,
            &Curated::bundled(),
            &ReportFilter::whole(Attribution::Augmented),
            scope,
            ScopeMetric::Casts,
            Dimension::Ability,
            &ViewOptions {
                rejected: true,
                ..ViewOptions::default()
            },
            Window {
                start_ms: 0,
                end_ms: 30_000,
            },
        );
        mark_amount(&view, PYROBLAST, 1_000)
    };
    assert_eq!(amount(&Scope::default()), Some((800, 2)));
    let on_boss = Scope {
        target: vec![UnitRef::Instance(boss)],
        ..Scope::default()
    };
    assert_eq!(amount(&on_boss), Some((800, 2)));
}

#[test]
fn a_boss_cast_amount_does_not_depend_on_the_window() {
    let mut b = FightBuilder::new(30_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(CAUSTIC, "Caustic Waves");
    b.push(9_500, boss, 0, CAUSTIC, EventKind::CastStart);
    b.push(10_000, boss, 0, CAUSTIC, EventKind::CastSuccess);
    b.push(11_500, boss, mage, CAUSTIC, spell_hit(400));
    b.push(11_800, boss, 0, CAUSTIC, EventKind::CastStart);
    b.push(12_000, boss, 0, CAUSTIC, EventKind::CastSuccess);
    b.push(13_000, boss, mage, CAUSTIC, spell_hit(900));
    let fight = b.build();
    let amount = |end_ms| {
        let view = timeline(
            &fight,
            &Curated::bundled(),
            &ReportFilter::whole(Attribution::Augmented),
            &Scope::default(),
            ScopeMetric::Casts,
            Dimension::Source,
            &ViewOptions::default(),
            Window {
                start_ms: 0,
                end_ms,
            },
        );
        mark_amount(&view, CAUSTIC, 9_500)
    };
    assert_eq!(amount(11_000), Some((400, 1)));
    assert_eq!(amount(30_000), Some((400, 1)));
}

#[test]
fn the_boss_kill_at_the_pull_end_is_drawn() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.fight.outcome = openlogs_index::Outcome::Kill;
    b.hit(5_000, mage, boss, PYROBLAST, 1_000, (9_000, 10_000));
    let fight = b.build();
    let enemies = Scope {
        perspective: Side::Enemy,
        ..Scope::default()
    };
    let at_end = |metric| {
        let view = plain(
            &fight,
            &enemies,
            metric,
            Dimension::Target,
            ViewOptions::default(),
            (0, 60_000),
        );
        let deaths: Vec<_> = view.lanes[0]
            .items
            .iter()
            .filter(|i| i.kind == ItemKind::Death)
            .map(|i| i.start_ms)
            .collect();
        deaths
    };
    assert_eq!(at_end(ScopeMetric::Deaths), [60_000]);
    assert_eq!(at_end(ScopeMetric::DamageTaken), [60_000]);
}

#[test]
fn resources_ignore_a_target_selection_carried_over_from_another_tab() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let priest = b.player("Player-4", "Tyreeze-Eredar-EU", 257);
    b.spell(29166, "Innervate");
    b.power(1_000, priest, 0, 500, 1_000);
    b.push(
        2_000,
        mage,
        priest,
        29166,
        EventKind::Energize(openlogs_analysis::Energize {
            power_type: 0,
            amount: 100.0,
            over_energize: 0.0,
        }),
    );
    let fight = b.build();
    let scope = Scope {
        ability: vec![AbilityRef::Name("Innervate".into())],
        target: vec![UnitRef::Player(mage)],
        ..Scope::default()
    };
    let power = plain(
        &fight,
        &scope,
        ScopeMetric::Resources,
        Dimension::Source,
        ViewOptions::default(),
        (0, 60_000),
    );
    assert_eq!(
        lane_keys(&power),
        [Some(RowKey::Unit(UnitRef::Player(priest)))]
    );
}

#[test]
fn enemy_damage_taken_names_the_aug_support_inside_a_hit() {
    let p = pull();
    let enemies = Scope {
        perspective: Side::Enemy,
        ..Scope::default()
    };
    for attribution in [Attribution::Augmented, Attribution::Reattributed] {
        let view = timeline(
            &p.fight,
            &Curated::bundled(),
            &ReportFilter::whole(attribution),
            &enemies,
            ScopeMetric::DamageTaken,
            Dimension::Target,
            &ViewOptions {
                hits: true,
                ..ViewOptions::default()
            },
            Window {
                start_ms: 0,
                end_ms: 60_000,
            },
        );
        let hit = view
            .lanes
            .iter()
            .flat_map(|l| &l.items)
            .find(|i| i.kind == ItemKind::Hit && i.start_ms == 5_000)
            .and_then(|i| i.amount)
            .unwrap();
        assert_eq!((hit.amount, hit.support), (1_000, 100), "{attribution:?}");
    }
}

#[test]
fn a_boss_cast_starting_at_a_phase_end_is_not_drawn_in_that_phase() {
    let p = pull();
    let phase = ReportFilter {
        end_ms: 10_000,
        ..ReportFilter::whole(Attribution::Augmented)
    };
    let view = timeline(
        &p.fight,
        &Curated::bundled(),
        &phase,
        &Scope::default(),
        ScopeMetric::Casts,
        Dimension::Source,
        &ViewOptions::default(),
        Window {
            start_ms: 0,
            end_ms: 10_000,
        },
    );
    assert!(view.context.is_empty());
}

#[test]
fn a_lane_counts_the_time_an_aura_was_up_once_however_many_appliers() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let priest = b.player("Player-4", "Tyreeze-Eredar-EU", 257);
    let paladin = b.player("Player-5", "Purepala-Blackhand-EU", 65);
    let fortitude = 21562;
    b.spell(fortitude, "Power Word: Fortitude");
    let buff = |action| aura(action, AuraType::Buff, None);
    b.push(0, priest, mage, fortitude, buff(AuraAction::Applied));
    b.push(10_000, priest, mage, fortitude, buff(AuraAction::Removed));
    b.push(5_000, paladin, mage, fortitude, buff(AuraAction::Applied));
    b.push(15_000, paladin, mage, fortitude, buff(AuraAction::Removed));
    let fight = b.build();
    let buffs = plain(
        &fight,
        &Scope::default(),
        ScopeMetric::Buffs,
        Dimension::Target,
        ViewOptions::default(),
        (0, 60_000),
    );
    assert_eq!(buffs.lanes[0].total, 15_000);
}

#[test]
fn an_interrupt_does_not_borrow_the_begin_of_a_finished_cast() {
    let mut b = FightBuilder::new(60_000);
    let warrior = b.player("Player-2", "Washed-Frostwolf-EU", 71);
    let warden = b.unit(
        "Creature-0-1-1-1-264045-01",
        "Doomscale Warden",
        HOSTILE_FLAGS,
    );
    let (pummel, malice) = (6552, 1290779);
    b.push(1_000, warden, warrior, malice, EventKind::CastStart);
    b.push(2_000, warden, warrior, malice, EventKind::CastSuccess);
    b.push(
        5_000,
        warrior,
        warden,
        pummel,
        EventKind::Interrupt {
            interrupted: malice,
        },
    );
    let fight = b.build();
    let kicks = plain(
        &fight,
        &Scope::default(),
        ScopeMetric::Interrupts,
        Dimension::Source,
        ViewOptions::default(),
        (0, 60_000),
    );
    assert_eq!(kicks.lanes[0].items[0].cast_start_ms, None);
}
