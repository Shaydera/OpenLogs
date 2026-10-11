mod support;

use openlogs_analysis::{
    Attribution, AuraAction, AuraType, EventKind, NO_SPELL, NOBODY, ReportFilter, casts_report,
};
use openlogs_gamedata::Curated;
use support::{FightBuilder, HOSTILE_FLAGS};

fn cast(b: &mut FightBuilder, t: i32, source: u32, spell: u32) {
    b.push(t, source, NOBODY, spell, EventKind::CastSuccess);
}

fn whole() -> ReportFilter {
    ReportFilter::whole(Attribution::Augmented)
}

#[test]
fn uptime_follows_an_aura_of_the_same_id_or_name() {
    let mut b = FightBuilder::new(20_000);
    let druid = b.player("Player-1", "Pyrrin-Emberfall-EU", 105);
    let tank = b.player("Player-2", "Edrin-Emberfall-EU", 581);
    let mage = b.player("Player-3", "Faelan-Emberfall-EU", 62);
    let aura = |action| EventKind::Aura {
        action,
        aura_type: AuraType::Buff,
        stacks: None,
        broken_by: NO_SPELL,
    };
    cast(&mut b, 0, druid, 774);
    b.push(0, druid, tank, 774, aura(AuraAction::Applied));
    b.push(10_000, druid, tank, 774, aura(AuraAction::Removed));
    cast(&mut b, 5_000, druid, 774);
    b.push(5_000, druid, mage, 774, aura(AuraAction::Applied));
    b.push(15_000, druid, mage, 774, aura(AuraAction::Removed));
    cast(&mut b, 6_000, druid, 48438);
    // Arcane Surge: the buff has another ID than the cast, but the same name.
    b.spell(365350, "Arcane Surge");
    b.spell(365362, "Arcane Surge");
    cast(&mut b, 1_000, mage, 365350);
    b.push(1_000, mage, mage, 365362, aura(AuraAction::Applied));
    b.push(5_000, mage, mage, 365362, aura(AuraAction::Removed));
    // Spells without a known name are matched by ID only.
    cast(&mut b, 2_000, mage, 900_001);
    b.push(2_000, mage, mage, 900_002, aura(AuraAction::Applied));
    let report = casts_report(&b.build(), &Curated::bundled(), &whole());

    let uptimes = |player: u32| -> Vec<(u32, Option<f64>)> {
        report
            .players
            .iter()
            .find(|p| p.player == player)
            .unwrap()
            .spells
            .iter()
            .map(|s| (s.spell, s.uptime))
            .collect()
    };
    assert_eq!(uptimes(druid), [(774, Some(0.75)), (48438, None)]);
    assert_eq!(uptimes(mage), [(365350, Some(0.2)), (900_001, None)]);
}

#[test]
fn casts_count_presses_not_follow_up_casts() {
    let mut b = FightBuilder::new(30_000);
    let p = b.player("Player-1", "Selwyn-Ironmoor-EU", 251);
    for (id, name) in [
        (263642, "Fracture"),
        (225919, "Fracture"),
        (225921, "Fracture"),
        (441424, "Exterminate"),
        (441426, "Exterminate"),
        (279302, "Frostwyrm's Fury"),
        (1265384, "Frostwyrm's Fury"),
        (188389, "Flame Shock"),
        (470411, "Flame Shock"),
    ] {
        b.spell(id, name);
    }
    // Fracture: one press, two curated proc casts in the same ms (the proc row stays as it is).
    for t in [1_000, 4_000] {
        for spell in [263642, 225919, 225921] {
            cast(&mut b, t, p, spell);
        }
    }
    // Exterminate's second swing 513 ms later, Flame Shock's two IDs 1 ms apart.
    for t in [5_000, 6_300] {
        cast(&mut b, t, p, 441424);
        cast(&mut b, t + 513, p, 441426);
    }
    for t in [2_000, 8_420] {
        cast(&mut b, t, p, 188389);
        cast(&mut b, t + 1, p, 470411);
    }
    // Frostwyrm's Fury's second wyrm 2–8 s after every cast.
    for (t, later) in [(10_000, 2_027), (20_000, 7_970)] {
        cast(&mut b, t, p, 279302);
        cast(&mut b, t + later, p, 1265384);
    }
    let report = casts_report(&b.build(), &Curated::bundled(), &whole());
    let mut rows: Vec<_> = report.players[0]
        .spells
        .iter()
        .map(|s| (s.spell, s.casts, s.proc_trigger))
        .collect();
    rows.sort();
    assert_eq!(
        rows,
        [
            (188389, 2, false),
            (225919, 4, true),
            (263642, 2, false),
            (279302, 2, false),
            (441424, 2, false),
        ],
        "one cast per press; curated procs keep their own row"
    );
}

#[test]
fn one_spell_under_two_cast_ids_is_one_row() {
    let mut b = FightBuilder::new(20_000);
    let dk = b.player("Player-1", "Aleth-Emberfall-EU", 250);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    let aura = |action| EventKind::Aura {
        action,
        aura_type: AuraType::Buff,
        stacks: None,
        broken_by: NO_SPELL,
    };
    b.spell(256948, "Spatial Rift");
    b.spell(257040, "Spatial Rift");
    b.spell(204255, "Soul Fragment");
    b.spell(900_010, "Soul Fragment");
    cast(&mut b, 1_000, dk, 257040);
    cast(&mut b, 2_000, dk, 256948);
    b.push(2_000, dk, dk, 256948, aura(AuraAction::Applied));
    b.push(2_100, dk, dk, 256948, aura(AuraAction::Removed));
    b.hit(2_500, dk, boss, 257040, 1_000, (900_000, 1_000_000));
    // A curated proc and a real cast that share a name stay apart (Hide procs hides one).
    cast(&mut b, 3_000, dk, 204255);
    cast(&mut b, 4_000, dk, 900_010);
    let report = casts_report(&b.build(), &Curated::bundled(), &whole());
    let rows: Vec<_> = report.players[0]
        .spells
        .iter()
        .map(|s| {
            (
                s.spell,
                s.casts,
                s.proc_trigger,
                s.uptime,
                s.link.map(|l| l.spell),
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            // The teleport (256948) only ever follows the rift (257040): one press, one row.
            (257040, 1, false, Some(0.005), Some(257040)),
            (204255, 1, true, None, None),
            (900_010, 1, false, None, None),
        ]
    );
}
