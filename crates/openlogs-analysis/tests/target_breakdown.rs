mod support;

use openlogs_analysis::{
    ActorId, Attribution, Damage, DamageVia, EventKind, GroupAbilities, ReportFilter, RowKind,
    TargetKey, TargetShare, damage_done,
};
use support::{FightBuilder, HOSTILE_FLAGS, damage};

const EBON_MIGHT: u32 = 395152;
const PYROBLAST: u32 = 11366;
const FIRE_BLAST: u32 = 108853;

struct Raid {
    b: FightBuilder,
    mage: ActorId,
    evoker: ActorId,
    boss: ActorId,
    adds: [ActorId; 2],
}

fn raid() -> Raid {
    let mut b = FightBuilder::new(20_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 63);
    let evoker = b.player("Player-2", "Speronis-Stonevale-EU", 1473);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let adds = [
        b.unit(
            "Creature-0-1-1-1-2-01",
            "Blightscale Rawling",
            HOSTILE_FLAGS,
        ),
        b.unit(
            "Creature-0-1-1-1-2-02",
            "Blightscale Rawling",
            HOSTILE_FLAGS,
        ),
    ];
    for (id, name) in [
        (EBON_MIGHT, "Ebon Might"),
        (PYROBLAST, "Pyroblast"),
        (FIRE_BLAST, "Fire Blast"),
    ] {
        b.spell(id, name);
    }
    Raid {
        b,
        mage,
        evoker,
        boss,
        adds,
    }
}

fn hit(amount: u64) -> EventKind {
    EventKind::Damage(damage(DamageVia::Spell, amount, 0))
}

fn crit(amount: u64) -> EventKind {
    EventKind::Damage(Damage {
        critical: true,
        ..damage(DamageVia::Spell, amount, 0)
    })
}

fn supported(amount: u64, evoker: ActorId) -> EventKind {
    EventKind::Damage(Damage {
        supporter: evoker,
        ..damage(DamageVia::Spell, amount, 0)
    })
}

fn unit(name: &str) -> TargetKey {
    TargetKey::Unit(name.into())
}

fn split(list: &[TargetShare]) -> Vec<(TargetKey, i64, u32, u32)> {
    list.iter()
        .map(|t| (t.target.clone(), t.amount, t.hits, t.crits))
        .collect()
}

fn whole(attribution: Attribution) -> ReportFilter {
    ReportFilter::whole(attribution)
}

#[test]
fn units_of_one_name_are_one_target_and_are_counted() {
    let mut r = raid();
    r.b.push(1_000, r.mage, r.boss, PYROBLAST, crit(1_000));
    r.b.push(2_000, r.mage, r.adds[0], PYROBLAST, hit(200));
    r.b.push(3_000, r.mage, r.adds[1], FIRE_BLAST, hit(300));
    let report = damage_done(&r.b.build(), &whole(Attribution::Augmented));
    let mage = &report.players[0];
    assert_eq!(
        split(&mage.targets),
        [
            (unit("Ula'tek"), 1_000, 1, 1),
            (unit("Blightscale Rawling"), 500, 2, 0)
        ]
    );
    assert_eq!(
        mage.group_abilities,
        [
            GroupAbilities {
                group: Some("Blightscale Rawling".to_string()),
                abilities: vec![(FIRE_BLAST, 300), (PYROBLAST, 200)]
            },
            GroupAbilities {
                group: Some("Ula'tek".to_string()),
                abilities: vec![(PYROBLAST, 1_000)]
            }
        ]
    );
    assert_eq!(
        report.units,
        [
            ("Blightscale Rawling".to_string(), 2),
            ("Ula'tek".to_string(), 1)
        ]
    );
    let pyro = mage
        .ability_targets
        .iter()
        .find(|a| a.spell == PYROBLAST)
        .unwrap();
    assert_eq!(
        split(&pyro.targets),
        [
            (unit("Ula'tek"), 1_000, 1, 1),
            (unit("Blightscale Rawling"), 200, 1, 0)
        ]
    );
}

#[test]
fn every_players_targets_add_up_to_the_total() {
    let mut r = raid();
    r.b.push(1_000, r.mage, r.boss, PYROBLAST, hit(1_000));
    r.b.push(1_000, r.mage, r.boss, EBON_MIGHT, supported(100, r.evoker));
    // A support without its hit: unmatched, still deducted on its target.
    r.b.push(
        5_000,
        r.mage,
        r.adds[1],
        EBON_MIGHT,
        supported(30, r.evoker),
    );
    r.b.push(6_000, r.evoker, r.adds[0], FIRE_BLAST, hit(250));
    let fight = r.b.build();
    for mode in [Attribution::Augmented, Attribution::Reattributed] {
        let report = damage_done(&fight, &whole(mode));
        for p in &report.players {
            assert_eq!(
                p.targets.iter().map(|t| t.amount).sum::<i64>(),
                p.total as i64,
                "{mode:?}"
            );
        }
    }
    let re = damage_done(&fight, &whole(Attribution::Reattributed));
    let unmatched = re.players[0]
        .ability_targets
        .iter()
        .find(|a| a.kind == RowKind::Unmatched)
        .unwrap();
    assert_eq!(
        split(&unmatched.targets),
        [(unit("Blightscale Rawling"), -30, 0, 0)]
    );
}
