mod support;

use openlogs_analysis::{
    AbilityRef, ActorId, AmountRule, Attribution, AuraAction, AuraType, Channel, Damage, DamageVia,
    Dimension, EventKind, Fight, Heal, ItemKind, MissType, Missed, ReportFilter, RowKey, Scope,
    ScopeMetric, Side, Timeline, TimelineItem, UnitRef, ViewOptions, Window, breakdown, timeline,
};
use openlogs_gamedata::{ChannelSpells, Curated};
use support::{FightBuilder, HOSTILE_FLAGS, damage, heal};

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
        &ChannelSpells::default(),
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
        &ChannelSpells::default(),
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
            &ChannelSpells::default(),
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
            &ChannelSpells::default(),
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
            &ChannelSpells::default(),
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
        &ChannelSpells::default(),
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

#[test]
fn damage_taken_legend_keeps_its_order_whatever_the_window() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-4", "Faelan-Blackhand-EU", 62);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let later = 25771;
    b.spell(CAUSTIC, "Caustic Waves");
    b.spell(later, "Forbearance");
    for (spell, from, to) in [(CAUSTIC, 1_000, 4_000), (later, 10_000, 20_000)] {
        b.push(
            from,
            boss,
            mage,
            spell,
            aura(AuraAction::Applied, AuraType::Debuff, None),
        );
        b.push(
            to,
            boss,
            mage,
            spell,
            aura(AuraAction::Removed, AuraType::Debuff, None),
        );
    }
    let fight = b.build();
    let legend = |window| {
        plain(
            &fight,
            &Scope::default(),
            ScopeMetric::DamageTaken,
            Dimension::Target,
            ViewOptions::default(),
            window,
        )
        .legend
    };
    assert_eq!(legend((0, 60_000)), [CAUSTIC, later]);
    assert_eq!(legend((8_000, 25_000)), [CAUSTIC, later]);
}

fn cast_mark(view: &Timeline, spell: u32, start_ms: i32) -> Option<&TimelineItem> {
    view.lanes
        .iter()
        .flat_map(|l| l.items.iter())
        .chain(view.context.iter())
        .find(|i| i.spell == spell && i.start_ms == start_ms)
}

fn casts_in(fight: &Fight, window: (i32, i32)) -> Timeline {
    plain(
        fight,
        &Scope::default(),
        ScopeMetric::Casts,
        Dimension::Source,
        ViewOptions::default(),
        window,
    )
}

fn periodic_hit(amount: u64) -> EventKind {
    EventKind::Damage(damage(DamageVia::Periodic, amount, 0))
}

#[test]
fn a_channel_runs_to_its_aura_removal_with_its_ticks() {
    let mut b = FightBuilder::new(60_000);
    let priest = b.player("Player-6", "Umbrasp-Frostwolf-EU", 258);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let flay = b.spell(15407, "Mind Flay");
    let buff = |action| aura(action, AuraType::Buff, None);
    b.push(3_775, priest, priest, flay, buff(AuraAction::Applied));
    b.push(3_775, priest, boss, flay, EventKind::CastSuccess);
    b.push(4_389, priest, boss, flay, periodic_hit(300));
    let apparition = b.spell(341263, "Shadowy Apparition");
    b.push(4_700, priest, boss, apparition, EventKind::CastSuccess);
    b.push(4_975, priest, boss, flay, periodic_hit(300));
    b.push(5_099, priest, priest, flay, buff(AuraAction::Removed));
    let blast = b.spell(8092, "Mind Blast");
    b.push(5_099, priest, boss, blast, EventKind::CastSuccess);
    let fight = b.build();
    let view = casts_in(&fight, (0, 60_000));
    let cast = cast_mark(&view, flay, 3_775).unwrap();
    assert_eq!(
        cast.kind,
        ItemKind::Channel,
        "a proc's cast is no press, and a cast in the removal's millisecond clipped it"
    );
    assert_eq!(
        cast.channel,
        Some(Channel {
            end_ms: Some(5_099),
            last_tick_ms: Some(4_975),
            ticks: vec![4_389, 4_975],
        })
    );
    assert_eq!(
        cast.log.iter().map(|l| (l.t, l.event)).collect::<Vec<_>>(),
        [
            (3_775, "SPELL_AURA_APPLIED"),
            (3_775, "SPELL_CAST_SUCCESS"),
            (5_099, "SPELL_AURA_REMOVED"),
        ],
        "the card names the lines the channel was read from"
    );
}

#[test]
fn a_same_id_self_buff_without_hits_is_no_channel() {
    let mut b = FightBuilder::new(60_000);
    let hunter = b.player("Player-7", "Shotz-Frostwolf-EU", 254);
    let trueshot = b.spell(288613, "Trueshot");
    let buff = |action| aura(action, AuraType::Buff, None);
    b.push(1_000, hunter, hunter, trueshot, buff(AuraAction::Applied));
    b.push(1_000, hunter, 0, trueshot, EventKind::CastSuccess);
    b.push(16_000, hunter, hunter, trueshot, buff(AuraAction::Removed));
    let fight = b.build();
    let view = casts_in(&fight, (0, 60_000));
    let cast = cast_mark(&view, trueshot, 1_000).unwrap();
    assert_eq!((cast.kind, &cast.channel), (ItemKind::Instant, &None));
}

#[test]
fn a_recast_channel_cuts_the_first_where_it_refreshes_the_aura() {
    let mut b = FightBuilder::new(60_000);
    let priest = b.player("Player-6", "Umbrasp-Frostwolf-EU", 258);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let flay = b.spell(15407, "Mind Flay");
    let buff = |action| aura(action, AuraType::Buff, None);
    b.push(49_712, priest, priest, flay, buff(AuraAction::Applied));
    b.push(49_712, priest, boss, flay, EventKind::CastSuccess);
    b.push(50_300, priest, boss, flay, periodic_hit(300));
    b.push(51_322, priest, priest, flay, buff(AuraAction::Refresh));
    b.push(51_322, priest, boss, flay, EventKind::CastSuccess);
    b.push(51_900, priest, boss, flay, periodic_hit(300));
    b.push(52_896, priest, priest, flay, buff(AuraAction::Removed));
    let fight = b.build();
    let view = casts_in(&fight, (0, 60_000));
    let channel = |start| {
        let cast = cast_mark(&view, flay, start).unwrap();
        (
            cast.kind,
            cast.channel.as_ref().map(|c| (c.end_ms, c.ticks.clone())),
        )
    };
    assert_eq!(
        channel(49_712),
        (ItemKind::Channel, Some((Some(51_322), vec![50_300])))
    );
    assert_eq!(
        channel(51_322),
        (ItemKind::Channel, Some((Some(52_896), vec![51_900])))
    );
}

#[test]
fn a_press_logged_just_before_the_removal_clipped_the_channel() {
    let mut b = FightBuilder::new(60_000);
    let monk = b.player("Player-11", "Kicks-Frostwolf-EU", 269);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let punch = b.spell(152175, "Whirling Dragon Punch");
    let kick = b.spell(107428, "Rising Sun Kick");
    let buff = |action| aura(action, AuraType::Buff, None);
    b.push(18_303, monk, monk, punch, buff(AuraAction::Applied));
    b.push(18_303, monk, boss, punch, EventKind::CastSuccess);
    b.push(18_700, monk, boss, punch, spell_hit(100));
    b.push(19_286, monk, boss, kick, EventKind::CastSuccess);
    b.push(19_300, monk, monk, punch, buff(AuraAction::Removed));
    let fight = b.build();
    let view = casts_in(&fight, (0, 60_000));
    assert_eq!(
        cast_mark(&view, punch, 18_303).unwrap().kind,
        ItemKind::Channel
    );
}

#[test]
fn a_self_cast_hot_is_no_channel() {
    let mut b = FightBuilder::new(60_000);
    let druid = b.player("Player-9", "Leafy-Frostwolf-EU", 105);
    let rejuvenation = b.spell(774, "Rejuvenation");
    let buff = |action| aura(action, AuraType::Buff, None);
    let tick = EventKind::Heal(Heal {
        periodic: true,
        ..heal(400, 0)
    });
    b.push(1_000, druid, druid, rejuvenation, buff(AuraAction::Applied));
    b.push(1_000, druid, druid, rejuvenation, EventKind::CastSuccess);
    b.push(4_000, druid, druid, rejuvenation, tick);
    b.push(7_000, druid, druid, rejuvenation, tick);
    b.push(
        13_000,
        druid,
        druid,
        rejuvenation,
        buff(AuraAction::Removed),
    );
    let fight = b.build();
    let view = casts_in(&fight, (0, 60_000));
    let cast = cast_mark(&view, rejuvenation, 1_000).unwrap();
    assert_eq!((cast.kind, &cast.channel), (ItemKind::Instant, &None));
}

#[test]
fn a_self_buff_its_caster_keeps_casting_through_is_no_channel() {
    let mut b = FightBuilder::new(60_000);
    let demon_hunter = b.player("Player-10", "Horns-Frostwolf-EU", 577);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let immolation = b.spell(258920, "Immolation Aura");
    let chaos = b.spell(162794, "Chaos Strike");
    let buff = |action| aura(action, AuraType::Buff, None);
    b.push(
        1_000,
        demon_hunter,
        demon_hunter,
        immolation,
        buff(AuraAction::Applied),
    );
    b.push(1_000, demon_hunter, 0, immolation, EventKind::CastSuccess);
    b.push(2_000, demon_hunter, boss, immolation, spell_hit(100));
    b.push(2_500, demon_hunter, boss, chaos, EventKind::CastSuccess);
    b.push(3_000, demon_hunter, boss, immolation, spell_hit(100));
    b.push(
        7_000,
        demon_hunter,
        demon_hunter,
        immolation,
        buff(AuraAction::Removed),
    );
    let fight = b.build();
    let view = casts_in(&fight, (0, 60_000));
    let cast = cast_mark(&view, immolation, 1_000).unwrap();
    assert_eq!((cast.kind, &cast.channel), (ItemKind::Instant, &None));
}

#[test]
fn an_instant_with_several_hits_is_drawn_at_its_press() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-8", "Fooneses-Frostwolf-EU", 62);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let cast = b.spell(5143, "Arcane Missiles");
    let missile = b.spell(7268, "Arcane Missiles");
    b.push(640, mage, boss, cast, EventKind::CastSuccess);
    for t in [1_560, 1_784, 2_026, 2_246, 2_466, 2_734, 2_949, 3_184] {
        b.push(t, mage, boss, missile, spell_hit(500));
    }
    let fight = b.build();
    let view = casts_in(&fight, (0, 60_000));
    let press = cast_mark(&view, cast, 640).unwrap();
    assert_eq!(
        (press.kind, &press.channel, press.span_end_ms),
        (ItemKind::Instant, &None, 640)
    );
    assert!(
        cast_mark(&casts_in(&fight, (1_000, 4_000)), cast, 640).is_none(),
        "its hits draw nothing after the press"
    );
}

#[test]
fn a_game_data_channel_without_its_aura_runs_to_its_last_hit_before_the_next_press() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-8", "Fooneses-Frostwolf-EU", 62);
    let priest = b.player("Player-6", "Umbrasp-Frostwolf-EU", 258);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let cast = b.spell(5143, "Arcane Missiles");
    let missile = b.spell(7268, "Arcane Missiles");
    let volley = b.spell(1242173, "Void Volley");
    b.push(640, mage, boss, cast, EventKind::CastSuccess);
    let hits = [1_560, 1_784, 2_026, 2_246, 2_466, 2_734, 2_949, 3_184];
    for t in hits {
        b.push(t, mage, boss, missile, spell_hit(500));
    }
    b.push(3_498, mage, boss, cast, EventKind::CastSuccess);
    b.push(4_464, mage, boss, missile, spell_hit(500));
    b.push(30_000, mage, boss, cast, EventKind::CastSuccess);
    b.push(1_000, priest, boss, volley, EventKind::CastSuccess);
    for t in [1_200, 1_600, 2_000] {
        b.push(t, priest, boss, volley, spell_hit(100));
    }
    let fight = b.build();
    let channels = ChannelSpells::from_json(r#"{"ids":[5143]}"#).unwrap();
    let view = plain_with(&fight, &channels, (0, 60_000));
    let first = cast_mark(&view, cast, 640).unwrap();
    assert_eq!(first.kind, ItemKind::Channel);
    assert_eq!(
        first.channel,
        Some(Channel {
            end_ms: None,
            last_tick_ms: Some(3_184),
            ticks: hits.to_vec(),
        }),
        "the hit after the next press is that press's"
    );
    assert_eq!(first.span_end_ms, 3_184);
    assert_eq!(cast_mark(&view, cast, 3_498).unwrap().span_end_ms, 4_464);
    let lone = cast_mark(&view, cast, 30_000).unwrap();
    assert_eq!(
        (lone.kind, lone.span_end_ms),
        (ItemKind::Instant, 30_000),
        "no hit: a point"
    );
    let instant = cast_mark(&view, volley, 1_000).unwrap();
    assert_eq!(
        (instant.kind, &instant.channel, instant.span_end_ms),
        (ItemKind::Instant, &None, 1_000)
    );
}

#[test]
fn an_empowered_spell_never_runs_to_its_hits_as_a_game_data_channel() {
    let mut b = FightBuilder::new(60_000);
    let evoker = b.player("Player-3", "Sparkyevo-Rexxar-EU", 1467);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let breath = b.spell(357208, "Fire Breath");
    b.push(1_000, evoker, 0, breath, EventKind::EmpowerStart);
    b.push(1_000, evoker, 0, breath, EventKind::CastSuccess);
    b.push(2_000, evoker, 0, breath, EventKind::EmpowerEnd { stage: 2 });
    b.push(10_000, evoker, boss, breath, EventKind::CastSuccess);
    for t in [10_400, 11_000] {
        b.push(t, evoker, boss, breath, spell_hit(300));
    }
    let fight = b.build();
    let channels = ChannelSpells::from_json(r#"{"ids":[357208]}"#).unwrap();
    let view = plain_with(&fight, &channels, (0, 60_000));
    let press = cast_mark(&view, breath, 10_000).unwrap();
    assert_eq!(
        (press.kind, &press.channel, press.span_end_ms),
        (ItemKind::Instant, &None, 10_000),
        "a press without its empower start stays a point"
    );
}

#[test]
fn the_dot_a_game_data_channel_left_does_not_extend_it() {
    let mut b = FightBuilder::new(60_000);
    let hunter = b.player("Player-7", "Shotz-Frostwolf-EU", 254);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let fire = b.spell(257044, "Rapid Fire");
    let missed = EventKind::Missed(Missed {
        via: DamageVia::Spell,
        miss_type: MissType::Absorb,
        amount_missed: 200,
    });
    b.push(1_000, hunter, boss, fire, EventKind::CastSuccess);
    b.push(1_300, hunter, boss, fire, spell_hit(200));
    b.push(1_700, hunter, boss, fire, missed);
    for t in [3_000, 5_000] {
        b.push(t, hunter, boss, fire, periodic_hit(50));
    }
    let fight = b.build();
    let channels = ChannelSpells::from_json(r#"{"ids":[257044]}"#).unwrap();
    let view = plain_with(&fight, &channels, (0, 60_000));
    let press = cast_mark(&view, fire, 1_000).unwrap();
    assert_eq!(
        press
            .channel
            .as_ref()
            .map(|c| (c.last_tick_ms, c.ticks.clone())),
        Some((Some(1_700), vec![1_300, 1_700])),
        "a missed hit is a tick, the periodic ones are not"
    );
}

fn plain_with(fight: &Fight, channels: &ChannelSpells, window: (i32, i32)) -> Timeline {
    timeline(
        fight,
        &Curated::bundled(),
        channels,
        &ReportFilter::whole(Attribution::Augmented),
        &Scope::default(),
        ScopeMetric::Casts,
        Dimension::Source,
        &ViewOptions::default(),
        Window {
            start_ms: window.0,
            end_ms: window.1,
        },
    )
}

#[test]
fn only_a_line_after_the_next_press_takes_a_channel_over() {
    let mut b = FightBuilder::new(60_000);
    let priest = b.player("Player-6", "Umbrasp-Frostwolf-EU", 258);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let flay = b.spell(15407, "Mind Flay");
    let buff = |action| aura(action, AuraType::Buff, None);
    for at in [1_000, 5_000] {
        b.push(at, priest, priest, flay, buff(AuraAction::Applied));
        b.push(at, priest, priest, flay, buff(AuraAction::Refresh));
        b.push(at, priest, boss, flay, EventKind::CastSuccess);
        b.push(at + 400, priest, boss, flay, periodic_hit(300));
        b.push(at + 1_000, priest, priest, flay, buff(AuraAction::Removed));
    }
    let fight = b.build();
    let view = casts_in(&fight, (0, 60_000));
    let end = |start| {
        cast_mark(&view, flay, start)
            .unwrap()
            .channel
            .as_ref()?
            .end_ms
    };
    assert_eq!(
        end(1_000),
        Some(2_000),
        "its own same-millisecond refresh keeps it; only its removal ends it"
    );
    assert_eq!(end(5_000), Some(6_000));
}

#[test]
fn a_self_aura_logged_a_few_milliseconds_off_the_press_still_opens_its_channel() {
    let mut b = FightBuilder::new(60_000);
    let monk = b.player("Player-11", "Kicks-Frostwolf-EU", 269);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let fists = b.spell(113656, "Fists of Fury");
    let buff = |action| aura(action, AuraType::Buff, None);
    b.push(10_000, monk, boss, fists, EventKind::CastSuccess);
    b.push(10_004, monk, monk, fists, buff(AuraAction::Applied));
    b.push(10_800, monk, boss, fists, spell_hit(500));
    b.push(13_900, monk, monk, fists, buff(AuraAction::Removed));
    b.push(20_000, monk, boss, fists, EventKind::CastSuccess);
    b.push(20_006, monk, monk, fists, buff(AuraAction::Applied));
    b.push(20_800, monk, boss, fists, spell_hit(500));
    b.push(23_900, monk, monk, fists, buff(AuraAction::Removed));
    let fight = b.build();
    let view = casts_in(&fight, (0, 60_000));
    let kind = |start| {
        let cast = cast_mark(&view, fists, start).unwrap();
        (
            cast.kind,
            cast.start_ms,
            cast.channel.as_ref().and_then(|c| c.end_ms),
        )
    };
    assert_eq!(kind(10_000), (ItemKind::Channel, 10_000, Some(13_900)));
    assert_eq!(
        kind(20_000).0,
        ItemKind::Instant,
        "6 ms off is another aura's line"
    );
}

/// Three presses of a spell with its same-ID self aura, `passing` of them a clean channel with a
/// tick on the boss; the others have no tick and a press of another spell inside.
fn three_presses(name: &str, passing: usize) -> (Fight, u32) {
    let mut b = FightBuilder::new(60_000);
    let priest = b.player("Player-6", "Umbrasp-Frostwolf-EU", 258);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let spell = b.spell(15407, name);
    let blast = b.spell(8092, "Mind Blast");
    let buff = |action| aura(action, AuraType::Buff, None);
    for press in 0..3 {
        let at = 1_000 + press as i32 * 10_000;
        b.push(at, priest, priest, spell, buff(AuraAction::Applied));
        b.push(at, priest, boss, spell, EventKind::CastSuccess);
        if press < passing {
            b.push(at + 600, priest, boss, spell, periodic_hit(300));
        } else {
            b.push(at + 600, priest, boss, blast, EventKind::CastSuccess);
        }
        b.push(at + 2_000, priest, priest, spell, buff(AuraAction::Removed));
    }
    (b.build(), spell)
}

#[test]
fn a_channel_spell_draws_its_unclean_presses_as_channels_too() {
    let (fight, flay) = three_presses("Mind Flay", 2);
    let view = casts_in(&fight, (0, 60_000));
    let cast = cast_mark(&view, flay, 21_000).unwrap();
    assert_eq!(cast.kind, ItemKind::Channel);
    assert_eq!(
        cast.channel,
        Some(Channel {
            end_ms: Some(23_000),
            last_tick_ms: None,
            ticks: Vec::new(),
        }),
        "no hit, so no ticks: solid from the press to the aura's removal"
    );
}

#[test]
fn a_spell_few_of_whose_presses_are_clean_channels_draws_none() {
    let (fight, spell) = three_presses("Soothing Mist", 1);
    let view = casts_in(&fight, (0, 60_000));
    for start in [1_000, 11_000, 21_000] {
        let cast = cast_mark(&view, spell, start).unwrap();
        assert_eq!((cast.kind, &cast.channel), (ItemKind::Instant, &None));
    }
}

#[test]
fn a_channel_without_a_logged_end_says_so() {
    let mut b = FightBuilder::new(60_000);
    let priest = b.player("Player-6", "Umbrasp-Frostwolf-EU", 258);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let flay = b.spell(15407, "Mind Flay");
    b.push(
        58_000,
        priest,
        priest,
        flay,
        aura(AuraAction::Applied, AuraType::Buff, None),
    );
    b.push(58_000, priest, boss, flay, EventKind::CastSuccess);
    b.push(58_600, priest, boss, flay, periodic_hit(300));
    let fight = b.build();
    let view = casts_in(&fight, (0, 60_000));
    let cast = cast_mark(&view, flay, 58_000).unwrap();
    assert_eq!(cast.channel.as_ref().unwrap().end_ms, None);
    assert_eq!(
        cast.span_end_ms, 58_600,
        "drawn to its last tick, the last line it has"
    );
}

#[test]
fn every_mark_carries_where_its_drawing_ends() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let warrior = b.player("Player-2", "Washed-Frostwolf-EU", 71);
    let warden = b.unit(
        "Creature-0-1-1-1-264045-01",
        "Doomscale Warden",
        HOSTILE_FLAGS,
    );
    let (intellect, pummel, malice) = (1459, 6552, 1290779);
    b.spell(intellect, "Arcane Intellect");
    let buff = |action| aura(action, AuraType::Buff, None);
    b.push(1_000, mage, mage, intellect, buff(AuraAction::Applied));
    b.push(9_000, mage, mage, intellect, buff(AuraAction::Removed));
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
    let span = |metric| {
        let view = plain(
            &fight,
            &Scope::default(),
            metric,
            Dimension::Source,
            ViewOptions::default(),
            (0, 60_000),
        );
        view.lanes[0].items[0].span_end_ms
    };
    assert_eq!(span(ScopeMetric::Buffs), 9_000, "a bar ends with it");
    assert_eq!(span(ScopeMetric::Interrupts), 1_950, "a point at its start");
}
