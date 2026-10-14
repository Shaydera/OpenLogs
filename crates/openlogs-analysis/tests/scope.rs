mod support;

use openlogs_analysis::{AbilityRef, Scope, UnitRef, unit_of};
use support::{FightBuilder, HOSTILE_FLAGS, PET_FLAGS};

#[test]
fn units_fold_pets_into_owners_and_instances_into_names() {
    let mut b = FightBuilder::new(10_000);
    let warlock = b.player("Player-1", "Areus-Stonevale-EU", 266);
    let imp = b.unit("Creature-0-1-1-1-55659-0001", "Wild Imp", PET_FLAGS);
    b.fight.actors.set_owner(imp, warlock);
    let felguard = b.unit("Creature-0-1-1-1-17252-0001", "Felguard", PET_FLAGS);
    b.fight.actors.set_owner(felguard, warlock);
    let add_a = b.unit(
        "Creature-0-1-1-1-261874-0001",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    let add_b = b.unit(
        "Creature-0-1-1-1-261874-0002",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    let fight = b.build();

    let imp_ref = unit_of(&fight, imp);
    assert_eq!(
        imp_ref,
        UnitRef::Pet {
            owner: warlock,
            name: "Wild Imp".into()
        }
    );
    assert_eq!(imp_ref.grouped(&fight), UnitRef::Player(warlock));
    assert!(imp_ref.is_in(&fight, &UnitRef::Player(warlock)));
    assert!(!UnitRef::Player(warlock).is_in(&fight, &imp_ref));
    assert!(imp_ref.is_in(&fight, &imp_ref));
    assert!(!unit_of(&fight, felguard).is_in(&fight, &imp_ref));

    let a = unit_of(&fight, add_a);
    assert_eq!(a, UnitRef::Instance(add_a));
    assert_eq!(
        a.grouped(&fight),
        UnitRef::Unit("Blightscale Rawling".into())
    );
    assert!(a.is_in(&fight, &UnitRef::Unit("Blightscale Rawling".into())));
    assert!(!a.is_in(&fight, &UnitRef::Instance(add_b)));
    assert_eq!(unit_of(&fight, 0), UnitRef::Environment);
}

#[test]
fn abilities_match_by_name_across_ids_or_by_one_id() {
    let mut b = FightBuilder::new(10_000);
    b.spell(5143, "Arcane Missiles");
    b.spell(7268, "Arcane Missiles");
    let fight = b.build();
    let by_name = AbilityRef::of(&fight, 7268);
    assert_eq!(by_name, AbilityRef::Name("Arcane Missiles".into()));
    assert!(by_name.matches(&fight, 5143));
    assert!(AbilityRef::Id(7268).matches(&fight, 7268));
    assert!(!AbilityRef::Id(7268).matches(&fight, 5143));
    assert_eq!(AbilityRef::of(&fight, 999), AbilityRef::Id(999));
}

#[test]
fn an_empty_scope_wants_everything_and_selections_narrow() {
    let mut b = FightBuilder::new(10_000);
    let warrior = b.player("Player-1", "Wendel-Emberfall-EU", 71);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let add_a = b.unit(
        "Creature-0-1-1-1-261874-0001",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    let add_b = b.unit(
        "Creature-0-1-1-1-261874-0002",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    b.spell(1, "Mortal Strike");
    let fight = b.build();
    let (src, tgt) = (UnitRef::Player(warrior), unit_of(&fight, boss));
    assert!(Scope::default().wants(&fight, &src, 1, &tgt));
    let narrowed = Scope {
        source: vec![UnitRef::Player(warrior)],
        ability: vec![AbilityRef::Id(2)],
        ..Scope::default()
    };
    assert!(!narrowed.wants(&fight, &src, 1, &tgt));
    let narrowed = Scope {
        target: vec![UnitRef::Unit("Ula'tek".into())],
        ..Scope::default()
    };
    assert!(narrowed.wants(&fight, &src, 1, &tgt));
    let one_add = Scope {
        target: vec![UnitRef::Instance(add_a)],
        ..Scope::default()
    };
    assert!(one_add.wants(&fight, &src, 1, &unit_of(&fight, add_a)));
    assert!(!one_add.wants(&fight, &src, 1, &unit_of(&fight, add_b)));
}
