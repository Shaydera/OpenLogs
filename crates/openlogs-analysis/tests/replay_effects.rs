mod support;

use openlogs_analysis::{
    ActorId, AffectedSpan, AuraAction, AuraType, DamageVia, EffectAnchorAt, EffectInstance,
    EventKind, Fight, NO_SPELL, NOBODY, SpellId, replay,
};
use openlogs_gamedata::{
    BossEffects, ChannelSpells, Curated, EffectAnchor, EffectCategory, EffectDef, EffectDuration,
    EffectKind, EffectTrigger, Evidence, SpellClasses,
};
use support::{FightBuilder, HOSTILE_FLAGS, PET_FLAGS, damage, heal};

const SPIRIT_LINK_TOTEM: SpellId = 98008;
const SPIRIT_LINK_AURA: SpellId = 325174;
const SPIRIT_LINK: SpellId = 98021;
const ANTI_MAGIC_ZONE: SpellId = 51052;
const ANTI_MAGIC_ZONE_AURA: SpellId = 145629;
const DIVINE_HYMN: SpellId = 64843;
const DIVINE_HYMN_HEAL: SpellId = 64844;
const RESTORAL: SpellId = 388615;
const BARRIER: SpellId = 62618;
const BARRIER_AURA: SpellId = 81782;
const SEETHING_BOLT: SpellId = 900_100;
const SEETHING_BURST: SpellId = 900_101;
const FESTERING_MARK: SpellId = 900_200;
const FESTERING_BURST: SpellId = 900_201;

fn effects_of(fight: &Fight, curated: &Curated) -> Vec<EffectInstance> {
    replay(
        fight,
        curated,
        &ChannelSpells::default(),
        &SpellClasses::default(),
    )
    .effects
}

fn bundled_effects(fight: &Fight) -> Vec<EffectInstance> {
    effects_of(fight, &Curated::bundled())
}

fn aura(action: AuraAction, aura_type: AuraType) -> EventKind {
    EventKind::Aura {
        action,
        aura_type,
        stacks: None,
        broken_by: NO_SPELL,
    }
}

fn span(actor: ActorId, start_ms: i32, end_ms: i32) -> AffectedSpan {
    AffectedSpan {
        actor,
        start_ms,
        end_ms,
    }
}

fn def(
    spell: SpellId,
    name: &str,
    anchor: EffectAnchor,
    ms: u32,
    evidence: Evidence,
    kind: EffectKind,
    category: EffectCategory,
) -> EffectDef {
    EffectDef {
        spell_ids: vec![spell],
        name: name.into(),
        trigger: EffectTrigger::Cast,
        anchor,
        radius_yd: 8.0,
        duration: EffectDuration::Fixed { ms },
        evidence,
        kind,
        category,
    }
}

#[test]
fn spirit_link_uses_the_totems_logged_position() {
    let mut b = FightBuilder::new(60_000);
    let shaman = b.player("Player-1", "Brookwhisper", 264);
    let warrior = b.player("Player-2", "Hargun", 71);
    let mage = b.player("Player-3", "Ilvaren", 62);
    let totem = b.unit(
        "Creature-0-1-1-1-53006-0000000001",
        "Spirit Link Totem",
        PET_FLAGS,
    );
    b.fight.actors.set_owner(totem, shaman);
    b.push(5_000, shaman, totem, SPIRIT_LINK_TOTEM, EventKind::Summon)
        .push(
            5_100,
            totem,
            warrior,
            SPIRIT_LINK_AURA,
            EventKind::CastSuccess,
        )
        .position(5_100, totem, 415.86, -290.71)
        .push(
            5_120,
            totem,
            warrior,
            SPIRIT_LINK_AURA,
            aura(AuraAction::Applied, AuraType::Buff),
        )
        .push(
            6_000,
            totem,
            warrior,
            SPIRIT_LINK,
            EventKind::Heal(heal(500, 0)),
        )
        .push(
            6_000,
            totem,
            mage,
            SPIRIT_LINK,
            EventKind::Heal(heal(300, 0)),
        )
        .push(
            11_600,
            totem,
            warrior,
            SPIRIT_LINK_AURA,
            aura(AuraAction::Removed, AuraType::Buff),
        );

    let effects = bundled_effects(&b.build());

    assert_eq!(effects.len(), 1, "{effects:?}");
    let totem_effect = &effects[0];
    assert_eq!(totem_effect.name, "Spirit Link Totem");
    assert_eq!(totem_effect.caster, shaman);
    assert_eq!(
        totem_effect.anchor,
        Some(EffectAnchorAt::Unit { actor: totem })
    );
    assert!(!totem_effect.estimated);
    // The totem is sampled only by its first casts; its last logged line ends it.
    assert_eq!(
        (totem_effect.start_ms, totem_effect.end_ms),
        (5_000, 11_600)
    );
    assert_eq!(
        totem_effect.affected,
        vec![span(warrior, 5_120, 11_600), span(mage, 6_000, 9_000)]
    );
}

#[test]
fn anti_magic_zone_stays_at_the_casters_cast_position() {
    let mut b = FightBuilder::new(60_000);
    let knight = b.player("Player-1", "Morvane", 250);
    b.position(3_000, knight, 10.0, 20.0)
        .position(4_000, knight, 30.0, 20.0)
        .push(
            3_500,
            knight,
            NOBODY,
            ANTI_MAGIC_ZONE,
            EventKind::CastSuccess,
        )
        .push(
            3_510,
            NOBODY,
            knight,
            ANTI_MAGIC_ZONE_AURA,
            aura(AuraAction::Applied, AuraType::Buff),
        )
        .position(5_000, knight, 50.0, 40.0)
        .push(
            8_000,
            NOBODY,
            knight,
            ANTI_MAGIC_ZONE_AURA,
            aura(AuraAction::Removed, AuraType::Buff),
        );

    let effects = bundled_effects(&b.build());

    assert_eq!(effects.len(), 1, "{effects:?}");
    assert_eq!(
        effects[0].anchor,
        Some(EffectAnchorAt::Ground { x: 20.0, y: 20.0 })
    );
    assert_eq!((effects[0].start_ms, effects[0].end_ms), (3_500, 9_500));
    assert_eq!(effects[0].category, EffectCategory::RaidCd);
    // The zone logs its aura without a source.
    assert_eq!(effects[0].affected, vec![span(knight, 3_510, 8_000)]);
}

#[test]
fn divine_hymn_follows_the_caster_until_the_channel_ends() {
    let mut b = FightBuilder::new(60_000);
    let priest = b.player("Player-1", "Somra", 257);
    let other_priest = b.player("Player-2", "Velith", 257);
    let warrior = b.player("Player-3", "Hargun", 71);
    let mage = b.player("Player-4", "Ilvaren", 62);
    b.spell(DIVINE_HYMN, "Divine Hymn");
    b.spell(DIVINE_HYMN_HEAL, "Divine Hymn");
    b.position(10_000, priest, 0.0, 0.0)
        .push(10_000, priest, NOBODY, DIVINE_HYMN, EventKind::CastSuccess)
        .push(
            10_000,
            priest,
            priest,
            DIVINE_HYMN,
            aura(AuraAction::Applied, AuraType::Buff),
        )
        .push(
            11_000,
            priest,
            warrior,
            DIVINE_HYMN_HEAL,
            EventKind::Heal(heal(900, 0)),
        )
        .push(
            12_000,
            other_priest,
            mage,
            DIVINE_HYMN_HEAL,
            EventKind::Heal(heal(900, 0)),
        )
        .position(12_000, priest, 5.0, 0.0)
        .push(
            18_000,
            priest,
            priest,
            DIVINE_HYMN,
            aura(AuraAction::Removed, AuraType::Buff),
        );

    let effects = bundled_effects(&b.build());

    assert_eq!(effects.len(), 1, "{effects:?}");
    let hymn = &effects[0];
    assert_eq!(hymn.anchor, Some(EffectAnchorAt::Unit { actor: priest }));
    assert_eq!((hymn.start_ms, hymn.end_ms), (10_000, 18_000));
    assert_eq!(hymn.affected, vec![span(warrior, 11_000, 14_000)]);
}

#[test]
fn barrier_is_estimated_from_the_first_recipients() {
    let mut b = FightBuilder::new(60_000);
    let priest = b.player("Player-1", "Somra", 256);
    let warrior = b.player("Player-2", "Hargun", 71);
    let mage = b.player("Player-3", "Ilvaren", 62);
    let hunter = b.player("Player-4", "Kestrin", 254);
    let applied = || aura(AuraAction::Applied, AuraType::Buff);
    b.push(2_000, priest, NOBODY, BARRIER, EventKind::CastSuccess)
        .push(2_100, priest, warrior, BARRIER_AURA, applied())
        .position(2_100, warrior, 0.0, 0.0)
        .push(2_400, priest, mage, BARRIER_AURA, applied())
        .position(2_400, mage, 4.0, 2.0)
        .push(3_000, priest, hunter, BARRIER_AURA, applied())
        .position(3_000, hunter, 100.0, 100.0);
    let mut curated = Curated::bundled();
    curated.effects.push(def(
        BARRIER,
        "Power Word: Barrier",
        EffectAnchor::EstimatedFromAffected,
        10_000,
        Evidence {
            aura_ids: vec![BARRIER_AURA],
            hit_ids: vec![],
            tick_window_ms: 3_000,
        },
        EffectKind::Beneficial,
        EffectCategory::RaidCd,
    ));

    let effects = effects_of(&b.build(), &curated);

    assert_eq!(effects.len(), 1, "{effects:?}");
    assert_eq!(
        effects[0].anchor,
        Some(EffectAnchorAt::Ground { x: 2.0, y: 1.0 })
    );
    assert!(effects[0].estimated);
    assert_eq!(
        effects[0].affected,
        vec![
            span(warrior, 2_100, 12_000),
            span(mage, 2_400, 12_000),
            span(hunter, 3_000, 12_000)
        ]
    );
}

#[test]
fn harmful_mechanic_marks_hit_players() {
    let mut b = FightBuilder::new(60_000);
    let boss = b.unit("Creature-0-1-1-1-100-0000000001", "Vexmora", HOSTILE_FLAGS);
    let warrior = b.player("Player-1", "Hargun", 71);
    let mage = b.player("Player-2", "Ilvaren", 62);
    let hunter = b.player("Player-3", "Kestrin", 254);
    let hit = || EventKind::Damage(damage(DamageVia::Spell, 1_000, 0));
    b.push(20_000, boss, warrior, SEETHING_BOLT, EventKind::CastSuccess)
        .position(20_000, warrior, 7.0, 7.0)
        .push(21_000, boss, warrior, SEETHING_BURST, hit())
        .push(21_000, boss, mage, SEETHING_BURST, hit())
        .position(21_000, mage, 500.0, 500.0)
        .push(21_000, boss, hunter, 900_102, hit());
    let curated = boss_curated(
        b.fight.encounter_id,
        def(
            SEETHING_BOLT,
            "Seething Bolt",
            EffectAnchor::TargetAtCast,
            3_000,
            Evidence {
                aura_ids: vec![],
                hit_ids: vec![SEETHING_BURST],
                tick_window_ms: 3_000,
            },
            EffectKind::Harmful,
            EffectCategory::BossMechanic,
        ),
    );

    let effects = effects_of(&b.build(), &curated);

    assert_eq!(effects.len(), 1, "{effects:?}");
    assert_eq!(effects[0].caster, boss);
    assert_eq!(effects[0].kind, EffectKind::Harmful);
    assert_eq!(
        effects[0].anchor,
        Some(EffectAnchorAt::Ground { x: 7.0, y: 7.0 })
    );
    assert_eq!(
        effects[0].affected,
        vec![span(warrior, 21_000, 23_000), span(mage, 21_000, 23_000)]
    );
}

#[test]
fn affected_spans_merge_heal_ticks_within_the_window() {
    let mut b = FightBuilder::new(60_000);
    let monk = b.player("Player-1", "Tashi", 270);
    let warrior = b.player("Player-2", "Hargun", 71);
    let restoral = |amount| EventKind::Heal(heal(amount, 0));
    b.position(1_000, monk, 0.0, 0.0)
        .push(1_000, monk, NOBODY, RESTORAL, EventKind::CastSuccess)
        .push(1_000, monk, warrior, RESTORAL, restoral(100))
        .push(2_500, monk, warrior, RESTORAL, restoral(100))
        .push(5_000, monk, warrior, RESTORAL, restoral(100))
        .push(7_000, monk, warrior, RESTORAL, restoral(100));

    let effects = bundled_effects(&b.build());

    assert_eq!(effects.len(), 1, "{effects:?}");
    assert_eq!((effects[0].start_ms, effects[0].end_ms), (1_000, 6_000));
    assert_eq!(effects[0].affected, vec![span(warrior, 1_000, 6_000)]);
}

#[test]
fn an_effect_without_position_or_recipients_is_list_only() {
    let mut b = FightBuilder::new(60_000);
    let knight = b.player("Player-1", "Morvane", 250);
    b.push(
        3_000,
        knight,
        NOBODY,
        ANTI_MAGIC_ZONE,
        EventKind::CastSuccess,
    );

    let effects = bundled_effects(&b.build());

    assert_eq!(effects.len(), 1, "{effects:?}");
    assert_eq!(effects[0].anchor, None);
    assert!(!effects[0].estimated);
}

fn boss_curated(encounter_id: u32, def: EffectDef) -> Curated {
    let mut curated = Curated::bundled();
    curated.boss_effects.push(BossEffects {
        version: 1,
        encounter_id,
        effects: vec![def],
    });
    curated
}

fn festering_mark(after_ms: u32) -> EffectDef {
    EffectDef {
        trigger: EffectTrigger::AuraApplied,
        duration: EffectDuration::UntilAuraEnd { after_ms },
        ..def(
            FESTERING_MARK,
            "Festering Mark",
            EffectAnchor::FollowsTarget,
            0,
            Evidence {
                aura_ids: vec![],
                hit_ids: vec![FESTERING_BURST],
                tick_window_ms: 3_000,
            },
            EffectKind::Harmful,
            EffectCategory::BossMechanic,
        )
    }
}

#[test]
fn concurrent_circles_keep_the_hits_that_landed_in_them() {
    let mut b = FightBuilder::new(60_000);
    let boss = b.unit("Creature-0-1-1-1-100-0000000001", "Vexmora", HOSTILE_FLAGS);
    let west = b.player("Player-1", "Hargun", 71);
    let east = b.player("Player-2", "Ilvaren", 62);
    let near_west = b.player("Player-3", "Kestrin", 254);
    let near_east = b.player("Player-4", "Tashi", 270);
    let unplaced = b.player("Player-5", "Morvane", 250);
    let hit = || EventKind::Damage(damage(DamageVia::Spell, 1_000, 0));
    for (actor, x) in [
        (west, 0.0),
        (east, 100.0),
        (near_west, 3.0),
        (near_east, 103.0),
    ] {
        b.position(10_000, actor, x, 0.0)
            .position(11_000, actor, x, 0.0);
    }
    for target in [west, east] {
        b.push(
            10_000,
            boss,
            target,
            FESTERING_MARK,
            aura(AuraAction::Applied, AuraType::Debuff),
        )
        .push(
            14_000,
            boss,
            target,
            FESTERING_MARK,
            aura(AuraAction::Removed, AuraType::Debuff),
        );
    }
    for target in [near_west, near_east, unplaced] {
        b.push(11_000, boss, target, FESTERING_BURST, hit());
    }
    let curated = boss_curated(b.fight.encounter_id, festering_mark(0));

    let effects = effects_of(&b.build(), &curated);

    let hit_players = |effect: &EffectInstance| -> Vec<ActorId> {
        effect.affected.iter().map(|span| span.actor).collect()
    };
    assert_eq!(effects.len(), 2, "{effects:?}");
    assert_eq!(
        effects[0].anchor,
        Some(EffectAnchorAt::Unit { actor: west })
    );
    assert_eq!(hit_players(&effects[0]), vec![near_west, unplaced]);
    assert_eq!(hit_players(&effects[1]), vec![near_east, unplaced]);
}

#[test]
fn an_aura_effect_lasts_until_the_aura_ends_plus_its_after_time() {
    let mut b = FightBuilder::new(60_000);
    let boss = b.unit("Creature-0-1-1-1-100-0000000001", "Vexmora", HOSTILE_FLAGS);
    let warrior = b.player("Player-1", "Hargun", 71);
    b.position(5_000, warrior, 0.0, 0.0)
        .push(
            5_000,
            boss,
            warrior,
            FESTERING_MARK,
            aura(AuraAction::Applied, AuraType::Debuff),
        )
        .push(
            9_000,
            boss,
            warrior,
            FESTERING_MARK,
            aura(AuraAction::Removed, AuraType::Debuff),
        );
    let fight = b.build();
    let window = |after_ms| {
        let effects = effects_of(
            &fight,
            &boss_curated(fight.encounter_id, festering_mark(after_ms)),
        );
        (effects[0].start_ms, effects[0].end_ms)
    };

    assert_eq!(window(0), (5_000, 9_000));
    assert_eq!(window(2_500), (5_000, 11_500));
}

#[test]
fn a_hit_outside_every_concurrent_circle_goes_to_the_nearest() {
    let mut b = FightBuilder::new(60_000);
    let boss = b.unit("Creature-0-1-1-1-100-0000000001", "Vexmora", HOSTILE_FLAGS);
    let west = b.player("Player-1", "Hargun", 71);
    let east = b.player("Player-2", "Ilvaren", 62);
    let stray = b.player("Player-3", "Kestrin", 254);
    for (actor, x) in [(west, 0.0), (east, 100.0), (stray, 30.0)] {
        b.position(10_000, actor, x, 0.0)
            .position(11_000, actor, x, 0.0);
    }
    for target in [west, east] {
        b.push(
            10_000,
            boss,
            target,
            FESTERING_MARK,
            aura(AuraAction::Applied, AuraType::Debuff),
        )
        .push(
            14_000,
            boss,
            target,
            FESTERING_MARK,
            aura(AuraAction::Removed, AuraType::Debuff),
        );
    }
    b.push(
        11_000,
        boss,
        stray,
        FESTERING_BURST,
        EventKind::Damage(damage(DamageVia::Spell, 1_000, 0)),
    );
    let curated = boss_curated(b.fight.encounter_id, festering_mark(0));

    let effects = effects_of(&b.build(), &curated);

    assert_eq!(effects.len(), 2, "{effects:?}");
    assert_eq!(effects[0].affected, vec![span(stray, 11_000, 14_000)]);
    assert!(effects[1].affected.is_empty(), "{:?}", effects[1]);
}
