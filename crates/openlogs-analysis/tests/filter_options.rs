mod support;

use openlogs_analysis::{
    AbilityRef, Attribution, DamageVia, Dimension, EventKind, OptionValue, ReportFilter, Scope,
    ScopeMetric, UnitRef, filter_options,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS, damage};

#[test]
fn ability_options_carry_the_primary_id_and_their_variants() {
    let mut b = FightBuilder::new(10_000);
    let mage = b.player("Player-1", "Evocadera-Frostwolf-EU", 62);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(5143, "Arcane Missiles");
    b.spell(7268, "Arcane Missiles");
    b.push(1_000, mage, boss, 5143, EventKind::CastSuccess);
    for t in [1_100, 1_200, 1_300] {
        b.push(
            t,
            mage,
            boss,
            7268,
            EventKind::Damage(damage(DamageVia::Spell, 100, 0)),
        );
    }
    let fight = b.build();
    let options = filter_options(
        &fight,
        &Curated::bundled(),
        &ReportFilter::whole(Attribution::Reattributed),
        &Scope::default(),
        ScopeMetric::DamageDone,
        Dimension::Ability,
    );
    assert_eq!(options.len(), 1);
    let missiles = &options[0];
    assert_eq!(
        missiles.value,
        OptionValue::Ability(AbilityRef::Name("Arcane Missiles".into()))
    );
    assert_eq!(missiles.primary_spell, Some(5143));
    let usage: Vec<(u32, u32, u32)> = missiles
        .variants
        .iter()
        .map(|v| (v.spell, v.casts, v.hits))
        .collect();
    assert_eq!(usage, vec![(5143, 1, 0), (7268, 0, 3)]);
}

#[test]
fn unit_options_ignore_their_own_selection_and_list_instances() {
    let mut b = FightBuilder::new(10_000);
    let warrior = b.player("Player-1", "Wendel-Emberfall-EU", 71);
    let first = b.unit(
        "Creature-0-1-1-1-261874-0001",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    let second = b.unit(
        "Creature-0-1-1-1-261874-0002",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(1, "Mortal Strike");
    for (t, target, amount) in [
        (1_000, first, 100),
        (2_000, second, 100),
        (3_000, boss, 900),
    ] {
        b.push(
            t,
            warrior,
            target,
            1,
            EventKind::Damage(damage(DamageVia::Spell, amount, 0)),
        );
    }
    let fight = b.build();
    let scope = Scope {
        target: vec![UnitRef::Unit("Ula'tek".into())],
        ..Scope::default()
    };
    let options = filter_options(
        &fight,
        &Curated::bundled(),
        &ReportFilter::whole(Attribution::Reattributed),
        &scope,
        ScopeMetric::DamageDone,
        Dimension::Target,
    );
    let values: Vec<&OptionValue> = options.iter().map(|o| &o.value).collect();
    assert_eq!(
        values,
        vec![
            &OptionValue::Unit(UnitRef::Unit("Ula'tek".into())),
            &OptionValue::Unit(UnitRef::Unit("Blightscale Rawling".into())),
        ]
    );
    assert_eq!(options[0].npc_id, Some(257758));
    assert_eq!(options[1].instances, vec![first, second]);
}
