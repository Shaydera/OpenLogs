mod support;

use openlogs_analysis::{
    Absorbed, Attribution, Dimension, EventKind, Heal, NOBODY, ReportFilter, RowKey, RowKind,
    Scope, ScopeMetric, Side, UnitRef, breakdown, healing,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS, heal};

fn whole(mode: Attribution) -> ReportFilter {
    ReportFilter::whole(mode)
}

#[test]
fn effective_healing_overheal_and_absorbs() {
    let mut b = FightBuilder::new(10_000);
    let druid = b.player("Player-1", "Pyrrin-Emberfall-EU", 105);
    let paladin = b.player("Player-2", "Puran-Ironmoor-EU", 65);
    let tank = b.player("Player-3", "Edrin-Emberfall-EU", 581);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(774, "Rejuvenation");
    b.spell(414019, "Greater Judgment");
    b.push(1_000, druid, tank, 774, EventKind::Heal(heal(1_000, 400)));
    b.push(
        2_000,
        boss,
        tank,
        9,
        EventKind::Absorbed(Absorbed {
            absorber: paladin,
            absorber_hostile: false,
            absorb_spell: 414019,
            amount: 700,
            supporter: NOBODY,
        }),
    );
    let report = healing(&b.build(), &whole(Attribution::Augmented));
    assert_eq!((report.total, report.overheal), (1_300, 400));
    let druid_row = report.players.iter().find(|p| p.player == druid).unwrap();
    assert_eq!(
        (druid_row.healing, druid_row.overheal, druid_row.total),
        (600, 400, 600)
    );
    assert_eq!(
        (
            druid_row.abilities[0].amount,
            druid_row.abilities[0].overheal
        ),
        (600, 400)
    );
    let paladin_row = report.players.iter().find(|p| p.player == paladin).unwrap();
    assert_eq!((paladin_row.absorbs, paladin_row.total), (700, 700));
    assert_eq!(
        (
            paladin_row.abilities[0].spell,
            paladin_row.abilities[0].kind
        ),
        (414019, RowKind::Own)
    );
}

#[test]
fn a_heal_taken_by_a_heal_absorb_is_healing() {
    let mut b = FightBuilder::new(10_000);
    let druid = b.player("Player-1", "Pyrrin-Emberfall-EU", 105);
    let tank = b.player("Player-3", "Edrin-Emberfall-EU", 581);
    b.spell(774, "Rejuvenation");
    b.push(
        1_000,
        druid,
        tank,
        774,
        EventKind::Heal(Heal {
            absorbed: 500,
            ..heal(200, 50)
        }),
    );
    let report = healing(&b.build(), &whole(Attribution::Augmented));
    let druid_row = report.players.iter().find(|p| p.player == druid).unwrap();
    assert_eq!((druid_row.healing, druid_row.overheal), (650, 50));
}

#[test]
fn heal_and_absorb_support_move_to_the_evoker() {
    let mut b = FightBuilder::new(10_000);
    let shaman = b.player("Player-1", "Elowyn-Emberfall-EU", 264);
    let evoker = b.player("Player-2", "Speronis-Stonevale-EU", 1473);
    let tank = b.player("Player-3", "Edrin-Emberfall-EU", 581);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(395152, "Ebon Might");
    b.spell(413984, "Shifting Sands");
    b.push(1_000, shaman, tank, 1, EventKind::Heal(heal(2_000, 0)));
    b.push(
        1_000,
        shaman,
        tank,
        395152,
        EventKind::Heal(Heal {
            supporter: evoker,
            ..heal(720, 439)
        }),
    );
    b.push(
        2_000,
        boss,
        tank,
        9,
        EventKind::Absorbed(Absorbed {
            absorber: shaman,
            absorber_hostile: false,
            absorb_spell: 2,
            amount: 1_000,
            supporter: NOBODY,
        }),
    );
    b.push(
        2_000,
        boss,
        tank,
        9,
        EventKind::Absorbed(Absorbed {
            absorber: shaman,
            absorber_hostile: false,
            absorb_spell: 413984,
            amount: 100,
            supporter: evoker,
        }),
    );
    let fight = b.build();
    let aug = healing(&fight, &whole(Attribution::Augmented));
    let re = healing(&fight, &whole(Attribution::Reattributed));
    let total = |r: &openlogs_analysis::HealingReport, p: u32| {
        r.players
            .iter()
            .find(|x| x.player == p)
            .map_or(0, |x| x.total)
    };
    assert_eq!((total(&aug, shaman), total(&aug, evoker)), (3_000, 0));
    assert_eq!(
        (total(&re, shaman), total(&re, evoker)),
        (3_000 - 281 - 100, 381)
    );
    assert_eq!(aug.total, re.total);
    let evoker_row = re.players.iter().find(|x| x.player == evoker).unwrap();
    assert_eq!(evoker_row.support_by_recipient, vec![(shaman, 381)]);
}

#[test]
fn heals_count_when_healer_and_target_stand_on_the_same_side() {
    let mut b = FightBuilder::new(10_000);
    let druid = b.player("Player-1", "Pyrrin-Emberfall-EU", 105);
    let warrior = b.player("Player-2", "Wendel-Emberfall-EU", 71);
    b.spell(774, "Rejuvenation");
    b.push(2_000, druid, warrior, 774, EventKind::Heal(heal(100, 0)));
    b.push(7_000, druid, warrior, 774, EventKind::Heal(heal(200, 0)));
    b.push(7_500, warrior, warrior, 774, EventKind::Heal(heal(400, 0)));
    let mut fight = b.build();
    fight.logger_turned = vec![(1_000, 3_000)];
    let raid_logged_hostile_while_turned = (true, true);
    let raid_on_mind_controlled = (false, true);
    let mind_controlled_on_self = (true, true);
    for (event, (source, target)) in fight.events.iter_mut().zip([
        raid_logged_hostile_while_turned,
        raid_on_mind_controlled,
        mind_controlled_on_self,
    ]) {
        event.source_hostile = source;
        event.target_hostile = target;
    }
    let report = healing(&fight, &whole(Attribution::Augmented));
    let totals: Vec<_> = report.players.iter().map(|p| (p.player, p.total)).collect();
    assert_eq!(totals, [(warrior, 400), (druid, 100)]);
}

#[test]
fn an_enemy_shield_on_a_mind_controlled_player_is_healing_of_that_enemy() {
    let mut b = FightBuilder::new(10_000);
    let druid = b.player("Player-1", "Pyrrin-Emberfall-EU", 105);
    let warrior = b.player("Player-2", "Wendel-Emberfall-EU", 71);
    let boss = b.unit(
        "Creature-0-1-1-1-259854-01",
        "Hex Lord Malacrass",
        HOSTILE_FLAGS,
    );
    b.spell(1297445, "Dreadmarch");
    b.push(
        1_000,
        druid,
        warrior,
        8921,
        EventKind::Absorbed(Absorbed {
            absorber: boss,
            absorber_hostile: true,
            absorb_spell: 1297445,
            amount: 300,
            supporter: NOBODY,
        }),
    );
    let mut fight = b.build();
    fight.events[0].target_hostile = true;
    let filter = whole(Attribution::Augmented);
    assert!(healing(&fight, &filter).players.is_empty());
    let rows: Vec<_> = breakdown(
        &fight,
        &Curated::bundled(),
        &filter,
        &Scope::default(),
        ScopeMetric::Healing,
        Dimension::Source,
    )
    .rows
    .into_iter()
    .map(|r| (r.row.key, r.row.amount))
    .collect();
    assert!(
        matches!(
            rows.as_slice(),
            [(RowKey::Unit(UnitRef::Unit(_) | UnitRef::Instance(_)), 300)]
        ),
        "{rows:?}"
    );
}

#[test]
fn an_enemy_heal_on_a_mind_controlled_player_is_not_enemy_healing() {
    let mut b = FightBuilder::new(10_000);
    let warrior = b.player("Player-2", "Wendel-Emberfall-EU", 71);
    let boss = b.unit(
        "Creature-0-1-1-1-259854-01",
        "Hex Lord Malacrass",
        HOSTILE_FLAGS,
    );
    b.spell(8936, "Regrowth");
    b.push(1_000, boss, warrior, 8936, EventKind::Heal(heal(500, 0)));
    b.push(2_000, boss, boss, 8936, EventKind::Heal(heal(200, 0)));
    let mut fight = b.build();
    fight.events[0].target_hostile = true;
    let enemies = Scope {
        perspective: Side::Enemy,
        ..Scope::default()
    };
    let enemy_healing: i64 = breakdown(
        &fight,
        &Curated::bundled(),
        &whole(Attribution::Augmented),
        &enemies,
        ScopeMetric::Healing,
        Dimension::Source,
    )
    .rows
    .iter()
    .map(|r| r.row.amount)
    .sum();
    assert_eq!(enemy_healing, 200);
}
