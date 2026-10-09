mod support;

use openlogs_analysis::{
    Attribution, AuraAction, AuraType, Damage, DamageVia, EventKind, Metric, NO_SPELL, NOBODY,
    ReportFilter, ability_detail,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS, PET_FLAGS, damage};

const AUG: Attribution = Attribution::Augmented;

fn hit(amount: u64) -> EventKind {
    EventKind::Damage(damage(DamageVia::Spell, amount, 0))
}

fn crit(amount: u64) -> EventKind {
    EventKind::Damage(Damage {
        critical: true,
        ..damage(DamageVia::Spell, amount, 0)
    })
}

fn whole() -> ReportFilter {
    ReportFilter::whole(AUG)
}

struct Scene {
    b: FightBuilder,
    mage: u32,
    boss: u32,
    add1: u32,
    add2: u32,
}

fn scene() -> Scene {
    let mut b = FightBuilder::new(20_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let add1 = b.unit(
        "Creature-0-1-1-1-261874-01",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    let add2 = b.unit(
        "Creature-0-1-1-1-261874-02",
        "Blightscale Rawling",
        HOSTILE_FLAGS,
    );
    b.spell(44425, "Arcane Barrage");
    b.spell(5143, "Arcane Missiles");
    Scene {
        b,
        mage,
        boss,
        add1,
        add2,
    }
}

#[test]
fn ability_hits_casts_and_targets() {
    let mut s = scene();
    s.b.push(1_000, s.mage, NOBODY, 44425, EventKind::CastSuccess);
    s.b.push(1_100, s.mage, s.boss, 44425, hit(300));
    s.b.push(1_100, s.mage, s.add1, 44425, crit(500));
    s.b.push(1_100, s.mage, s.add2, 44425, hit(100));
    s.b.push(5_000, s.mage, NOBODY, 44425, EventKind::CastSuccess);
    s.b.push(5_100, s.mage, s.boss, 44425, hit(200));
    s.b.push(6_000, s.mage, s.boss, 5143, hit(1_000));
    let detail = ability_detail(
        &s.b.build(),
        &Curated::bundled(),
        s.mage,
        44425,
        None,
        Metric::Damage,
        &whole(),
    )
    .unwrap();
    assert_eq!((detail.total, detail.player_total), (1_100, 2_100));
    assert_eq!(detail.casts, vec![1_000, 5_000]);
    assert_eq!(detail.hits.len(), 4);
    let targets: Vec<_> = detail
        .by_target
        .iter()
        .map(|t| (t.name.as_str(), t.hits, t.crits, t.amount))
        .collect();
    assert_eq!(
        targets,
        [("Blightscale Rawling", 2, 1, 600), ("Ula'tek", 2, 0, 500)]
    );
    assert_eq!(detail.median, 250);
    assert_eq!(detail.uptime, None);
}

#[test]
fn pet_abilities_are_matched_by_pet_name() {
    let mut s = scene();
    let imp1 = s.b.unit("Creature-0-1-1-1-55659-01", "Wild Imp", PET_FLAGS);
    let imp2 = s.b.unit("Creature-0-1-1-1-55659-02", "Wild Imp", PET_FLAGS);
    s.b.fight.actors.set_owner(imp1, s.mage);
    s.b.fight.actors.set_owner(imp2, s.mage);
    s.b.spell(104318, "Fel Firebolt");
    s.b.push(1_000, imp1, s.boss, 104318, hit(50));
    s.b.push(2_000, imp2, s.boss, 104318, hit(70));
    s.b.push(3_000, s.mage, s.boss, 104318, hit(1_000));
    let fight = s.b.build();
    let pets = ability_detail(
        &fight,
        &Curated::bundled(),
        s.mage,
        104318,
        Some("Wild Imp"),
        Metric::Damage,
        &whole(),
    )
    .unwrap();
    assert_eq!((pets.total, pets.hits.len()), (120, 2));
    let own = ability_detail(
        &fight,
        &Curated::bundled(),
        s.mage,
        104318,
        None,
        Metric::Damage,
        &whole(),
    )
    .unwrap();
    assert_eq!(own.total, 1_000);
}

#[test]
fn dot_uptime_unions_debuffs_on_all_targets() {
    let mut s = scene();
    s.b.spell(172, "Corruption");
    let aura = |action| EventKind::Aura {
        action,
        aura_type: AuraType::Debuff,
        stacks: None,
        broken_by: NO_SPELL,
    };
    s.b.push(0, s.mage, s.boss, 172, aura(AuraAction::Applied));
    s.b.push(8_000, s.mage, s.boss, 172, aura(AuraAction::Removed));
    s.b.push(4_000, s.mage, s.add1, 172, aura(AuraAction::Applied));
    s.b.push(12_000, s.mage, s.add1, 172, aura(AuraAction::Removed));
    for t in [2_000, 4_000, 6_000] {
        s.b.push(
            t,
            s.mage,
            s.boss,
            172,
            EventKind::Damage(damage(DamageVia::Periodic, 100, 0)),
        );
    }
    let detail = ability_detail(
        &s.b.build(),
        &Curated::bundled(),
        s.mage,
        172,
        None,
        Metric::Damage,
        &whole(),
    )
    .unwrap();
    assert_eq!(detail.uptime, Some(0.6));
}
