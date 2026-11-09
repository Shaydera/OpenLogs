mod support;

use openlogs_analysis::{ActorId, EventKind, NOBODY, infer_classes};
use openlogs_gamedata::SpellClasses;
use support::{FightBuilder, PET_FLAGS, PLAYER_FLAGS};

const ROGUE: u32 = 4;

const SINISTER_STRIKE: u32 = 1752;
const EVISCERATE: u32 = 196819;
const FIREBALL: u32 = 133;
const ARCANE_SHOT: u32 = 185358;

fn spell_classes() -> SpellClasses {
    let options = format!(
        "ID,SpellID,SpellClassSet\n1,{SINISTER_STRIKE},8\n2,{EVISCERATE},8\n3,{FIREBALL},3\n4,{ARCANE_SHOT},9\n"
    );
    SpellClasses::from_csv(options.as_bytes(), b"ID,EffectAura,SpellID\n").unwrap()
}

fn cast(b: &mut FightBuilder, t: i32, source: ActorId, spell: u32) {
    b.push(t, source, NOBODY, spell, EventKind::CastSuccess);
}

#[test]
fn class_follows_most_casts() {
    let mut b = FightBuilder::new(30_000);
    let player = b.unit("Player-1", "Ravel-Ashwood-EU", PLAYER_FLAGS);
    cast(&mut b, 1_000, player, SINISTER_STRIKE);
    cast(&mut b, 2_000, player, FIREBALL);
    cast(&mut b, 3_000, player, EVISCERATE);
    cast(&mut b, 4_000, player, SINISTER_STRIKE);
    let mut fight = b.build();

    infer_classes(&mut fight, &spell_classes());

    assert_eq!(fight.actors.get(player).class_id, Some(ROGUE));
}

#[test]
fn class_tie_or_pet_casts_leave_it_unset() {
    let mut b = FightBuilder::new(30_000);
    let undecided = b.unit("Player-1", "Ravel-Ashwood-EU", PLAYER_FLAGS);
    cast(&mut b, 1_000, undecided, SINISTER_STRIKE);
    cast(&mut b, 2_000, undecided, FIREBALL);
    let owner = b.unit("Player-2", "Tamsin-Ashwood-EU", PLAYER_FLAGS);
    let pet = b.unit("Pet-0-1-1-1-1-0001", "Wolf", PET_FLAGS);
    b.fight.actors.set_owner(pet, owner);
    cast(&mut b, 1_000, pet, ARCANE_SHOT);
    let mut fight = b.build();

    infer_classes(&mut fight, &spell_classes());

    assert_eq!(fight.actors.get(undecided).class_id, None);
    assert_eq!(fight.actors.get(owner).class_id, None);
}

#[test]
fn a_spec_of_zero_still_takes_the_class_from_casts() {
    let mut b = FightBuilder::new(30_000);
    let player = b.unit("Player-1", "Ravel-Ashwood-EU", PLAYER_FLAGS);
    b.fight.actors.set_spec(player, 0);
    cast(&mut b, 1_000, player, SINISTER_STRIKE);
    let mut fight = b.build();

    infer_classes(&mut fight, &spell_classes());

    assert_eq!(fight.actors.get(player).class(), Some(ROGUE));
}
