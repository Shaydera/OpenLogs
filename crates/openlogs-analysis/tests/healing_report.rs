mod support;

use openlogs_analysis::{
    Absorbed, Attribution, EventKind, Heal, NOBODY, ReportFilter, RowKind, healing,
};
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
