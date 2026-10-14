mod support;

use openlogs_analysis::{
    AbilityRef, Attribution, AuraType, Dimension, EventKind, NOBODY, ReportFilter, RowKey, Scope,
    Side, UnitRef, interrupts_report,
};
use support::{FightBuilder, HOSTILE_FLAGS, PET_FLAGS};

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

fn all(fight: &openlogs_analysis::Fight) -> openlogs_analysis::InterruptsReport {
    interrupts_report(fight, &whole(), &Scope::default(), Dimension::Source)
}

fn rows(report: &openlogs_analysis::InterruptsReport) -> Vec<(RowKey, u32, u32)> {
    report
        .rows
        .iter()
        .map(|r| (r.key.clone(), r.interrupts, r.dispels))
        .collect()
}

#[test]
fn interrupts_and_dispels_list_friendly_units() {
    let mut s = scene();
    let hound =
        s.b.unit("Creature-0-1-1-1-417-0001", "Felhunter", PET_FLAGS);
    s.b.fight.actors.set_owner(hound, s.warrior);
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
        3_500,
        hound,
        s.boss,
        19647,
        EventKind::Interrupt { interrupted: 5 },
    );
    s.b.push(
        4_000,
        s.boss,
        s.mage,
        77,
        EventKind::Interrupt { interrupted: 116 },
    );
    let report = all(&s.b.build());
    let kicks: Vec<_> = report
        .interrupts
        .iter()
        .map(|i| (i.t, i.source, i.spell, i.target, i.interrupted))
        .collect();
    assert_eq!(
        kicks,
        [
            (1_500, s.mage, 2139, s.boss, 5),
            (3_500, hound, 19647, s.boss, 5)
        ]
    );
    let dispels: Vec<_> = report
        .dispels
        .iter()
        .map(|d| (d.source, d.spell, d.target, d.removed, d.stolen))
        .collect();
    assert_eq!(
        dispels,
        [
            (s.priest, 527, s.warrior, 9, false),
            (s.mage, 30449, s.boss, 11, true)
        ]
    );
    assert_eq!(
        rows(&report),
        [
            (RowKey::Unit(UnitRef::Player(s.mage)), 1, 1),
            (RowKey::Unit(UnitRef::Player(s.warrior)), 1, 0),
            (RowKey::Unit(UnitRef::Player(s.priest)), 0, 1),
        ]
    );
    assert_eq!(report.most_interrupted, Some((5, 2)));
    assert_eq!((report.kickers, report.dispellers), (2, 2));
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
    let missed: Vec<_> = all(&fight)
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
    let report = interrupts_report(&fight, &late, &Scope::default(), Dimension::Source);
    assert!(report.missed.is_empty() && report.interrupts.is_empty());
}

#[test]
fn the_stopped_spell_is_the_ability_and_missed_casts_follow_it() {
    let mut s = scene();
    s.b.push(1_000, s.boss, NOBODY, 5, EventKind::CastStart);
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
    s.b.push(5_000, s.boss, NOBODY, 5, EventKind::CastStart);
    s.b.push(7_000, s.boss, NOBODY, 5, EventKind::CastSuccess);
    let fight = s.b.build();
    let spell = |id| Scope {
        ability: vec![AbilityRef::Id(id)],
        ..Scope::default()
    };
    let bolt = interrupts_report(&fight, &whole(), &spell(5), Dimension::Ability);
    assert_eq!(bolt.group, Dimension::Source);
    assert_eq!(rows(&bolt), [(RowKey::Unit(UnitRef::Player(s.mage)), 1, 0)]);
    assert_eq!(bolt.missed.len(), 1);
    assert!(
        interrupts_report(&fight, &whole(), &spell(9), Dimension::Source)
            .missed
            .is_empty()
    );

    let one_mage = Scope {
        source: vec![UnitRef::Player(s.mage)],
        ..Scope::default()
    };
    let narrowed = interrupts_report(&fight, &whole(), &one_mage, Dimension::Source);
    assert_eq!(narrowed.group, Dimension::Ability);
    assert!(
        narrowed.missed.is_empty(),
        "nobody's missed cast belongs to one player"
    );
}

#[test]
fn the_enemy_side_lists_what_hostile_units_stopped() {
    let mut s = scene();
    s.b.push(1_000, s.boss, NOBODY, 5, EventKind::CastStart);
    s.b.push(
        1_500,
        s.mage,
        s.boss,
        2139,
        EventKind::Interrupt { interrupted: 5 },
    );
    s.b.push(
        4_000,
        s.boss,
        s.mage,
        77,
        EventKind::Interrupt { interrupted: 116 },
    );
    s.b.push(5_000, s.boss, NOBODY, 5, EventKind::CastStart);
    s.b.push(7_000, s.boss, NOBODY, 5, EventKind::CastSuccess);
    let enemies = Scope {
        perspective: Side::Enemy,
        ..Scope::default()
    };
    let report = interrupts_report(&s.b.build(), &whole(), &enemies, Dimension::Source);
    assert_eq!(
        rows(&report),
        [(RowKey::Unit(UnitRef::Unit("Ula'tek".into())), 1, 0)]
    );
    assert!(report.missed.is_empty());
}

#[test]
fn a_friendly_npc_counts_on_the_friendly_side() {
    let mut s = scene();
    let guard = s.b.unit("Creature-0-1-1-1-3000-0001", "Guard", 0xa18);
    s.b.push(
        1_500,
        guard,
        s.boss,
        2139,
        EventKind::Interrupt { interrupted: 5 },
    );
    let friendly = all(&s.b.build());
    assert_eq!(
        rows(&friendly),
        [(RowKey::Unit(UnitRef::Unit("Guard".into())), 1, 0)]
    );
}
