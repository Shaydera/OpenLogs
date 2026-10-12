mod support;

use openlogs_analysis::{
    Attribution, Damage, DamageVia, EventKind, ReportFilter, RowKind, damage_done,
};
use support::{FightBuilder, HOSTILE_FLAGS, PET_FLAGS, damage};

const AUG: Attribution = Attribution::Augmented;
const RE: Attribution = Attribution::Reattributed;

fn supported(amount: u64, evoker: u32) -> EventKind {
    EventKind::Damage(Damage {
        supporter: evoker,
        ..damage(DamageVia::Spell, amount, 0)
    })
}

fn hit(amount: u64) -> EventKind {
    EventKind::Damage(damage(DamageVia::Spell, amount, 0))
}

struct Raid {
    b: FightBuilder,
    warrior: u32,
    evoker: u32,
    boss: u32,
}

fn raid() -> Raid {
    let mut b = FightBuilder::new(10_000);
    let warrior = b.player("Player-1", "Wendel-Emberfall-EU", 71);
    let evoker = b.player("Player-2", "Speronis-Stonevale-EU", 1473);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    b.spell(1, "Mortal Strike");
    b.spell(395152, "Ebon Might");
    Raid {
        b,
        warrior,
        evoker,
        boss,
    }
}

fn total(report: &openlogs_analysis::DamageReport, player: u32) -> u64 {
    report
        .players
        .iter()
        .find(|p| p.player == player)
        .map_or(0, |p| p.total)
}

#[test]
fn augmented_mode_shows_damage_as_logged() {
    let mut r = raid();
    r.b.push(1_000, r.warrior, r.boss, 1, hit(1_000));
    r.b.push(1_000, r.warrior, r.boss, 395152, supported(100, r.evoker));
    r.b.push(2_000, r.evoker, r.boss, 1, hit(300));
    let report = damage_done(&r.b.build(), &ReportFilter::whole(AUG));
    assert_eq!(
        (
            total(&report, r.warrior),
            total(&report, r.evoker),
            report.total
        ),
        (1_000, 300, 1_300)
    );
    let warrior = &report.players[0];
    assert_eq!(
        (warrior.own, warrior.support_received, warrior.support_given),
        (1_000, 100, 0)
    );
    assert_eq!(
        warrior.support_received_from,
        vec![(r.evoker, 100)],
        "known in both modes for the tooltip"
    );
    assert_eq!(
        warrior.abilities.len(),
        1,
        "no support rows in augmented mode"
    );
    assert!((warrior.per_second - 100.0).abs() < 1e-9);
    assert!((warrior.share - 1_000.0 / 1_300.0).abs() < 1e-9);
}

#[test]
fn reattributed_mode_moves_support_to_the_evoker() {
    let mut r = raid();
    r.b.push(1_000, r.warrior, r.boss, 1, hit(1_000));
    r.b.push(1_000, r.warrior, r.boss, 395152, supported(100, r.evoker));
    r.b.push(2_000, r.evoker, r.boss, 1, hit(300));
    let fight = r.b.build();
    let report = damage_done(&fight, &ReportFilter::whole(RE));
    assert_eq!(
        (
            total(&report, r.warrior),
            total(&report, r.evoker),
            report.total
        ),
        (900, 400, 1_300)
    );

    let warrior = report
        .players
        .iter()
        .find(|p| p.player == r.warrior)
        .unwrap();
    let rows: Vec<_> = warrior
        .abilities
        .iter()
        .map(|a| (a.spell, a.kind, a.amount, a.support))
        .collect();
    assert_eq!(
        rows,
        [(1, RowKind::Own, 900, 100)],
        "the buffed ability is net, its Aug part moved"
    );

    let evoker = report
        .players
        .iter()
        .find(|p| p.player == r.evoker)
        .unwrap();
    let given = evoker
        .abilities
        .iter()
        .find(|a| a.kind == RowKind::SupportGiven)
        .unwrap();
    assert_eq!((given.spell, given.amount), (395152, 100));
    assert_eq!(evoker.support_by_recipient, vec![(r.warrior, 100)]);
}

#[test]
fn self_support_cancels_out() {
    let mut r = raid();
    r.b.push(1_000, r.evoker, r.boss, 1, hit(500));
    r.b.push(1_000, r.evoker, r.boss, 395152, supported(50, r.evoker));
    let fight = r.b.build();
    for mode in [AUG, RE] {
        let report = damage_done(&fight, &ReportFilter::whole(mode));
        assert_eq!(total(&report, r.evoker), 500);
        assert_eq!(
            report.players[0].support_received + report.players[0].support_given,
            0
        );
        assert_eq!(report.players[0].support_self, 50);
    }
}

#[test]
fn support_from_unknown_supporter_stays_with_the_player() {
    let mut r = raid();
    let stranger = r.b.unit("Creature-0-1-1-1-9-01", "Mysterious Ally", 0x1111);
    r.b.push(1_000, r.warrior, r.boss, 1, hit(1_000));
    r.b.push(1_000, r.warrior, r.boss, 395152, supported(100, stranger));
    let report = damage_done(&r.b.build(), &ReportFilter::whole(RE));
    assert_eq!(total(&report, r.warrior), 1_000);
    assert_eq!(report.players.len(), 1);
}

#[test]
fn pet_damage_and_pet_support_belong_to_the_owner() {
    let mut r = raid();
    let hunter = r.b.player("Player-4", "Corin-Ashgrove-EU", 253);
    let pet = r.b.unit("Pet-0-1-1-1-1-01", "Wolf", PET_FLAGS);
    r.b.fight.actors.set_owner(pet, hunter);
    r.b.push(1_000, pet, r.boss, 2, hit(800));
    r.b.push(1_000, pet, r.boss, 395152, supported(80, r.evoker));
    let fight = r.b.build();
    let aug = damage_done(&fight, &ReportFilter::whole(AUG));
    let hunter_row = aug.players.iter().find(|p| p.player == hunter).unwrap();
    assert_eq!(hunter_row.total, 800);
    assert_eq!(
        (hunter_row.abilities[0].kind, hunter_row.abilities[0].actor),
        (RowKind::Pet, pet)
    );
    let re = damage_done(&fight, &ReportFilter::whole(RE));
    assert_eq!((total(&re, hunter), total(&re, r.evoker)), (720, 80));
}

#[test]
fn pets_with_the_same_name_share_a_row() {
    let mut r = raid();
    let warlock = r.b.player("Player-5", "Arvel-Emberfall-EU", 266);
    let imp1 = r.b.unit("Creature-0-1-1-1-55659-01", "Wild Imp", PET_FLAGS);
    let imp2 = r.b.unit("Creature-0-1-1-1-55659-02", "Wild Imp", PET_FLAGS);
    let felguard = r.b.unit("Creature-0-1-1-1-17252-01", "Felguard", PET_FLAGS);
    for pet in [imp1, imp2, felguard] {
        r.b.fight.actors.set_owner(pet, warlock);
    }
    r.b.push(1_000, imp1, r.boss, 3, hit(100));
    r.b.push(2_000, imp2, r.boss, 3, hit(200));
    r.b.push(3_000, felguard, r.boss, 3, hit(50));
    let report = damage_done(&r.b.build(), &ReportFilter::whole(AUG));
    let rows: Vec<_> = report.players[0]
        .abilities
        .iter()
        .map(|a| (a.actor, a.amount, a.hits))
        .collect();
    assert_eq!(rows, [(imp1, 300, 2), (felguard, 50, 1)]);
}

#[test]
fn two_evokers_buffing_each_other_swap_their_shares() {
    let mut r = raid();
    let second = r.b.player("Player-3", "Evaris-Emberfall-EU", 1473);
    r.b.push(1_000, r.evoker, r.boss, 1, hit(1_000));
    r.b.push(1_000, r.evoker, r.boss, 395152, supported(100, second));
    r.b.push(2_000, second, r.boss, 1, hit(400));
    r.b.push(2_000, second, r.boss, 395152, supported(40, r.evoker));
    let fight = r.b.build();
    let aug = damage_done(&fight, &ReportFilter::whole(AUG));
    let re = damage_done(&fight, &ReportFilter::whole(RE));
    assert_eq!((total(&re, r.evoker), total(&re, second)), (940, 460));
    assert_eq!(aug.total, re.total);
    let first = re.players.iter().find(|p| p.player == r.evoker).unwrap();
    assert_eq!((first.support_given, first.support_received), (40, 100));
    assert_eq!(first.support_by_recipient, vec![(second, 40)]);
}

#[test]
fn own_buff_share_moves_from_the_evokers_ability_to_his_support_row() {
    let mut r = raid();
    r.b.push(1_000, r.warrior, r.boss, 1, hit(1_000));
    r.b.push(1_000, r.warrior, r.boss, 395152, supported(100, r.evoker));
    r.b.push(2_000, r.evoker, r.boss, 1, hit(500));
    r.b.push(2_000, r.evoker, r.boss, 395152, supported(50, r.evoker));
    let fight = r.b.build();

    let re = damage_done(&fight, &ReportFilter::whole(RE));
    let evoker = re.players.iter().find(|p| p.player == r.evoker).unwrap();
    assert_eq!(
        (evoker.total, evoker.support_given, evoker.support_self),
        (600, 100, 50)
    );
    let rows: Vec<_> = evoker
        .abilities
        .iter()
        .map(|a| (a.spell, a.actor, a.kind, a.amount, a.support))
        .collect();
    assert_eq!(
        rows,
        [
            (1, r.evoker, RowKind::Own, 450, 50),
            (395152, r.evoker, RowKind::SupportGiven, 150, 0),
        ]
    );
    assert_eq!(
        evoker.abilities.iter().map(|a| a.amount).sum::<i64>(),
        evoker.total as i64,
        "the rows add up to the total"
    );

    let aug = damage_done(&fight, &ReportFilter::whole(AUG));
    let evoker = aug.players.iter().find(|p| p.player == r.evoker).unwrap();
    assert!(
        evoker.abilities.iter().all(|a| a.kind == RowKind::Own),
        "no support rows in augmented mode"
    );
}
