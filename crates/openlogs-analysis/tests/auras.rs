mod support;

use openlogs_analysis::{AuraAction, AuraType, EventKind, NO_SPELL, aura_intervals};
use support::FightBuilder;

fn aura(action: AuraAction) -> EventKind {
    EventKind::Aura {
        action,
        aura_type: AuraType::Buff,
        stacks: None,
        broken_by: NO_SPELL,
    }
}

#[test]
fn applied_and_removed_make_an_interval_per_source() {
    let mut b = FightBuilder::new(60_000);
    let evoker = b.player("Player-1", "Speronis-Stonevale-EU", 1473);
    let second = b.player("Player-2", "Evaris-Emberfall-EU", 1473);
    let mage = b.player("Player-3", "Faelan-Emberfall-EU", 62);
    let em = b.spell(395152, "Ebon Might");
    b.push(1_000, evoker, mage, em, aura(AuraAction::Applied));
    b.push(2_000, second, mage, em, aura(AuraAction::Applied));
    b.push(5_000, evoker, mage, em, aura(AuraAction::Removed));
    b.push(9_000, second, mage, em, aura(AuraAction::Removed));
    let got: Vec<_> = aura_intervals(&b.build())
        .iter()
        .map(|i| (i.source, i.start_ms, i.end_ms))
        .collect();
    assert_eq!(got, [(evoker, 1_000, 5_000), (second, 2_000, 9_000)]);
}

#[test]
fn a_sibling_guardian_removing_the_aura_closes_the_open_interval() {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 64);
    let boss = b.unit(
        "Vehicle-0-1-1-1-257758-01",
        "Ula'tek",
        support::HOSTILE_FLAGS,
    );
    let image_a = b.unit(
        "Creature-0-1-1-1-31216-0001467BBC",
        "Mirror Image",
        support::PET_FLAGS,
    );
    let image_b = b.unit(
        "Creature-0-1-1-1-31216-0000C67BBC",
        "Mirror Image",
        support::PET_FLAGS,
    );
    b.fight.actors.set_owner(image_a, mage);
    b.fight.actors.set_owner(image_b, mage);
    // Mirror Image Frostbolt: one image applies, a sibling image removes.
    b.push(10_000, image_a, boss, 59638, aura(AuraAction::Applied));
    b.push(14_000, image_b, boss, 59638, aura(AuraAction::Removed));
    let got: Vec<_> = aura_intervals(&b.build())
        .iter()
        .map(|i| (i.source, i.start_ms, i.end_ms))
        .collect();
    assert_eq!(got, [(image_a, 10_000, 14_000)]);
}
