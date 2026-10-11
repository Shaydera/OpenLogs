mod support;

use openlogs_analysis::{
    Attribution, AuraType, EventKind, NOBODY, ReportFilter, interrupts_report,
};
use support::{FightBuilder, HOSTILE_FLAGS};

struct Scene {
    b: FightBuilder,
    mage: u32,
    priest: u32,
    warrior: u32,
    boss: u32,
}

fn scene() -> Scene {
    let mut b = FightBuilder::new(30_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let priest = b.player("Player-2", "Ulvara-Emberfall-EU", 256);
    let warrior = b.player("Player-3", "Wendel-Emberfall-EU", 71);
    let boss = b.unit("Vehicle-0-1-1-1-257758-01", "Ula'tek", HOSTILE_FLAGS);
    Scene {
        b,
        mage,
        priest,
        warrior,
        boss,
    }
}

fn whole() -> ReportFilter {
    ReportFilter::whole(Attribution::Augmented)
}

#[test]
fn interrupts_and_dispels_list_players() {
    let mut s = scene();
    s.b.push(
        1_500,
        s.mage,
        s.boss,
        2139,
        EventKind::Interrupt { interrupted: 5 },
    );
    s.b.push(
        2_000,
        s.priest,
        s.warrior,
        527,
        EventKind::Dispel {
            removed: 9,
            aura_type: AuraType::Debuff,
        },
    );
    s.b.push(
        3_000,
        s.mage,
        s.boss,
        30449,
        EventKind::Stolen {
            removed: 11,
            aura_type: AuraType::Buff,
        },
    );
    s.b.push(
        4_000,
        s.boss,
        s.mage,
        77,
        EventKind::Interrupt { interrupted: 116 },
    );
    let report = interrupts_report(&s.b.build(), &whole());
    let kicks: Vec<_> = report
        .interrupts
        .iter()
        .map(|i| (i.t, i.player, i.spell, i.target, i.interrupted))
        .collect();
    assert_eq!(kicks, [(1_500, s.mage, 2139, s.boss, 5)]);
    let dispels: Vec<_> = report
        .dispels
        .iter()
        .map(|d| (d.player, d.spell, d.target, d.removed, d.stolen))
        .collect();
    assert_eq!(
        dispels,
        [
            (s.priest, 527, s.warrior, 9, false),
            (s.mage, 30449, s.boss, 11, true)
        ]
    );
}

#[test]
fn missed_casts_need_a_start_without_interrupt() {
    let mut s = scene();
    // Spell 5 is interruptible: once interrupted, once completed after a start, once completed without a start.
    s.b.push(1_000, s.boss, NOBODY, 5, EventKind::CastStart);
    s.b.push(
        1_500,
        s.mage,
        s.boss,
        2139,
        EventKind::Interrupt { interrupted: 5 },
    );
    s.b.push(5_000, s.boss, NOBODY, 5, EventKind::CastStart);
    s.b.push(7_000, s.boss, NOBODY, 5, EventKind::CastSuccess);
    s.b.push(9_000, s.boss, NOBODY, 5, EventKind::CastSuccess);
    // Spell 6 was never interrupted: not judged.
    s.b.push(10_000, s.boss, NOBODY, 6, EventKind::CastStart);
    s.b.push(11_000, s.boss, NOBODY, 6, EventKind::CastSuccess);
    // A player's own cast is never a missed boss cast.
    s.b.push(12_000, s.mage, NOBODY, 5, EventKind::CastStart);
    s.b.push(13_000, s.mage, NOBODY, 5, EventKind::CastSuccess);
    let fight = s.b.build();
    let missed: Vec<_> = interrupts_report(&fight, &whole())
        .missed
        .iter()
        .map(|m| (m.t, m.source, m.spell))
        .collect();
    assert_eq!(missed, [(7_000, s.boss, 5)]);
    let late = ReportFilter {
        start_ms: 8_000,
        end_ms: 30_000,
        attribution: Attribution::Augmented,
    };
    let report = interrupts_report(&fight, &late);
    assert!(report.missed.is_empty() && report.interrupts.is_empty());
}
