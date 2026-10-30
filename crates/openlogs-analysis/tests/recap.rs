mod support;

use openlogs_analysis::{
    Absorbed, Attribution, AuraAction, AuraType, DamageVia, EventKind, MissType, Missed, NO_SPELL,
    NOBODY, Overkill, RecapKind, ReportFilter, death_recaps,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS, damage, heal};

fn died() -> EventKind {
    EventKind::Died { unconscious: false }
}

fn whole() -> ReportFilter {
    ReportFilter::whole(Attribution::Augmented)
}

struct Scene {
    b: FightBuilder,
    mage: u32,
    priest: u32,
    boss: u32,
}

fn scene() -> Scene {
    let mut b = FightBuilder::new(60_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let priest = b.player("Player-2", "Ulvara-Emberfall-EU", 256);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    for (id, name) in [
        (1, "Virulent Spit"),
        (2061, "Flash Heal"),
        (17, "Power Word: Shield"),
        (10060, "Power Infusion"),
    ] {
        b.spell(id, name);
    }
    Scene {
        b,
        mage,
        priest,
        boss,
    }
}

#[test]
fn recap_lists_damage_heals_and_absorbs() {
    let mut s = scene();
    s.b.hit(29_000, s.boss, s.mage, 1, 400_000, (500_000, 1_000_000));
    s.b.hit(33_000, s.boss, s.mage, 1, 300_000, (700_000, 1_000_000));
    s.b.push(
        34_000,
        s.priest,
        s.mage,
        2061,
        EventKind::Heal(heal(200_000, 50_000)),
    );
    s.b.push(
        35_000,
        s.boss,
        s.mage,
        1,
        EventKind::Absorbed(Absorbed {
            absorber: s.priest,
            absorber_logged_hostile: false,
            absorb_spell: 17,
            amount: 100_000,
            supporter: NOBODY,
        }),
    );
    s.b.push(
        36_000,
        s.boss,
        s.mage,
        1,
        EventKind::Missed(Missed {
            via: DamageVia::Spell,
            miss_type: MissType::Absorb,
            amount_missed: 80_000,
            critical: false,
        }),
    );
    s.b.push(
        38_000,
        s.boss,
        s.mage,
        1,
        EventKind::Damage(damage(DamageVia::Spell, 900_000, 50_000)),
    );
    s.b.push(38_000, NOBODY, s.mage, 0, died());
    let fight = s.b.build();
    let recaps = death_recaps(&fight, &Curated::bundled(), &whole());
    assert_eq!(recaps.len(), 1);
    let recap = &recaps[0];
    assert_eq!(recap.number, 1);
    let events: Vec<_> = recap
        .events
        .iter()
        .map(|e| (e.t, e.kind, e.amount, e.absorbed, e.excess))
        .collect();
    assert_eq!(
        events,
        [
            (33_000, RecapKind::Damage, 300_000, 0, 0),
            (34_000, RecapKind::Heal, 150_000, 0, 50_000),
            (35_000, RecapKind::Absorb, 100_000, 0, 0),
            (36_000, RecapKind::Damage, 80_000, 80_000, 0),
            (38_000, RecapKind::Damage, 900_000, 0, 50_000),
        ]
    );
    assert_eq!(
        (recap.events[2].source, recap.events[2].spell),
        (s.priest, 17)
    );
    assert_eq!(recap.events[0].hp_pct, Some(70.0));
    assert_eq!(recap.hp, vec![(33_000, 70.0)]);
}

#[test]
fn recaps_follow_the_range_and_number_deaths_in_the_pull() {
    let mut s = scene();
    s.b.push(10_000, NOBODY, s.priest, 0, died());
    s.b.push(40_000, NOBODY, s.mage, 0, died());
    let filter = ReportFilter {
        start_ms: 20_000,
        end_ms: 60_000,
        attribution: Attribution::Augmented,
        overkill: Overkill::Excluded,
    };
    let recaps = death_recaps(&s.b.build(), &Curated::bundled(), &filter);
    assert_eq!(
        recaps
            .iter()
            .map(|r| (r.death.player, r.number))
            .collect::<Vec<_>>(),
        [(s.mage, 2)]
    );
}

#[test]
fn buffs_dropped_with_the_lethal_hit_still_count() {
    let mut s = scene();
    let aura = |action| EventKind::Aura {
        action,
        aura_type: AuraType::Buff,
        stacks: None,
        broken_by: NO_SPELL,
    };
    // 12.x removes every buff with the lethal hit; UNIT_DIED follows ~10 ms later.
    s.b.push(1_000, s.priest, s.mage, 10060, aura(AuraAction::Applied));
    s.b.push(
        19_990,
        s.boss,
        s.mage,
        1,
        EventKind::Damage(damage(DamageVia::Spell, 500, 100)),
    );
    s.b.push(19_990, s.priest, s.mage, 10060, aura(AuraAction::Removed));
    s.b.push(20_000, NOBODY, s.mage, 0, died());
    // Without a lethal hit in the log, buffs removed in the last 100 ms still count.
    s.b.push(1_000, s.priest, s.priest, 17, aura(AuraAction::Applied));
    s.b.push(39_950, s.priest, s.priest, 17, aura(AuraAction::Removed));
    s.b.push(40_000, NOBODY, s.priest, 0, died());
    let recaps = death_recaps(&s.b.build(), &Curated::bundled(), &whole());
    assert_eq!(recaps[0].buffs, vec![(10060, s.priest)]);
    assert_eq!(recaps[1].buffs, vec![(17, s.priest)]);
}
