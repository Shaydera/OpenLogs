mod support;

use openlogs_analysis::{
    AuraAction, AuraType, EventKind, Fight, NO_SPELL, ShownSpec, assign_talent_specs,
};
use openlogs_gamedata::{Role, TalentTrees};
use support::FightBuilder;

const COMBAT_NODE: u32 = 1;
const ASSASSINATION_NODE: u32 = 2;
const FERAL_NODE: u32 = 3;
const BEAR_FORM: u32 = 5487;
const DIRE_BEAR_FORM: u32 = 9634;

fn trees() -> TalentTrees {
    TalentTrees::from_json(
        r#"{"trees":[
            {"id":181,"classId":4,"name":"Combat","icon":"ability_backstab"},
            {"id":182,"classId":4,"name":"Assassination","icon":"ability_rogue_eviscerate"},
            {"id":281,"classId":11,"name":"Feral Combat","icon":"ability_racial_bearform"}],
          "nodes":[[1,181],[2,182],[3,281]],
          "specClasses":[[1488,4],[1484,11]]}"#,
    )
    .unwrap()
}

fn aura(action: AuraAction) -> EventKind {
    EventKind::Aura {
        action,
        aura_type: AuraType::Buff,
        stacks: None,
        broken_by: NO_SPELL,
    }
}

fn shown(fight: &Fight, player: u32) -> Option<(String, String, Role)> {
    fight
        .actors
        .get(player)
        .shown_spec()
        .map(|ShownSpec { name, icon, role }| (name.to_string(), icon.to_string(), role))
}

#[test]
fn a_player_takes_the_tree_with_most_points() {
    let mut b = FightBuilder::new(60_000);
    let rogue = b.player("Player-1", "Ravel-Ashwood-Normal-EU", 1488);
    b.fight
        .talents
        .insert(rogue, vec![(COMBAT_NODE, 35), (ASSASSINATION_NODE, 16)]);
    let mut fight = b.build();

    assign_talent_specs(&mut fight, &trees());

    assert_eq!(
        shown(&fight, rogue),
        Some(("Combat".into(), "ability_backstab".into(), Role::Damage))
    );
    assert_eq!(fight.actors.get(rogue).class(), Some(4));
}

#[test]
fn a_tie_gives_no_talent_spec_but_the_class() {
    let mut b = FightBuilder::new(60_000);
    let rogue = b.player("Player-1", "Ravel-Ashwood-Normal-EU", 1488);
    b.fight
        .talents
        .insert(rogue, vec![(COMBAT_NODE, 25), (ASSASSINATION_NODE, 25)]);
    let mut fight = b.build();

    assign_talent_specs(&mut fight, &trees());

    assert_eq!(shown(&fight, rogue), None);
    assert_eq!(fight.actors.get(rogue).class(), Some(4));
}

#[test]
fn a_feral_druid_tanks_a_pull_spent_in_bear_form() {
    let role_with = |form: u32, applied_ms: i32, removed_ms: i32| {
        let mut b = FightBuilder::new(100_000);
        let druid = b.player("Player-1", "Brakk-Thornfield-Normal-EU", 1484);
        b.fight.talents.insert(druid, vec![(FERAL_NODE, 31)]);
        let form = b.spell(form, "Bear Form");
        if applied_ms >= 0 {
            b.push(applied_ms, druid, druid, form, aura(AuraAction::Applied));
        }
        b.push(removed_ms, druid, druid, form, aura(AuraAction::Removed));
        let mut fight = b.build();
        assign_talent_specs(&mut fight, &trees());
        shown(&fight, druid).map(|(_, _, role)| role)
    };

    assert_eq!(role_with(BEAR_FORM, 10_000, 35_000), Some(Role::Tank));
    assert_eq!(
        role_with(DIRE_BEAR_FORM, 10_000, 20_000),
        Some(Role::Damage)
    );
    assert_eq!(
        role_with(BEAR_FORM, -1, 22_000),
        Some(Role::Tank),
        "in Bear Form when the pull began"
    );
}

#[test]
fn a_feral_druid_who_began_the_pull_in_bear_form_tanks_it() {
    let mut b = FightBuilder::new(60_000);
    let druid = b.player("Player-1", "Brakk-Thornfield-Normal-EU", 1484);
    b.fight.talents.insert(druid, vec![(FERAL_NODE, 31)]);
    b.fight.in_bear_form_at_start.insert(druid);
    let mut fight = b.build();

    assign_talent_specs(&mut fight, &trees());

    assert_eq!(
        shown(&fight, druid).map(|(_, _, role)| role),
        Some(Role::Tank)
    );
}

#[test]
fn shown_spec_prefers_the_retail_spec() {
    let mut b = FightBuilder::new(60_000);
    let warrior = b.player("Player-1", "Faelan-Emberfall-EU", 73);
    b.fight.talents.insert(warrior, vec![(COMBAT_NODE, 35)]);
    let mut fight = b.build();

    assign_talent_specs(&mut fight, &trees());

    let retail = openlogs_gamedata::spec(73).unwrap();
    assert_eq!(
        shown(&fight, warrior),
        Some((retail.name.clone(), retail.icon.clone(), retail.role))
    );
}
