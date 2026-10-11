mod support;

use openlogs_analysis::{Attribution, Energize, EventKind, NOBODY, ReportFilter, resources_report};
use support::FightBuilder;

fn energize(power_type: i32, amount: f64, over: f64) -> EventKind {
    EventKind::Energize(Energize {
        power_type,
        amount,
        over_energize: over,
    })
}

#[test]
fn resources_track_power_and_energize() {
    let mut b = FightBuilder::new(15_000);
    let mage = b.player("Player-1", "Faelan-Emberfall-EU", 62);
    let warrior = b.player("Player-2", "Wendel-Emberfall-EU", 71);
    b.power(0, mage, 0, 250_000, 250_000);
    b.power(4_000, mage, 0, 125_000, 250_000);
    b.power(6_000, mage, 0, 250_000, 250_000);
    b.power(12_000, mage, 0, 200_000, 250_000);
    b.spell(12051, "Evocation");
    b.push(5_000, mage, mage, 12051, energize(0, 50_000.0, 10_000.0));
    b.push(5_000, NOBODY, warrior, 0, energize(1, 20.0, 0.0));
    let report = resources_report(&b.build(), &ReportFilter::whole(Attribution::Augmented));
    assert_eq!(
        (report.start_ms, report.end_ms, report.step_ms),
        (0, 15_000, 5_000)
    );
    assert_eq!(
        report.players.len(),
        1,
        "players without samples have no tracks"
    );
    let track = &report.players[0].tracks[0];
    assert_eq!(track.power_type, 0);
    assert_eq!(track.series, vec![Some(50.0), Some(100.0), Some(80.0)]);
    assert_eq!(
        (track.avg_pct, track.min_pct, track.capped_ms),
        (Some(82.5), Some(50.0), 10_000)
    );
    assert_eq!((track.gained, track.wasted), (50_000.0, 10_000.0));
    assert_eq!(track.gains, vec![(12051, 50_000.0, 10_000.0)]);
}

#[test]
fn sparse_tracks_carry_forward_and_skip_unknown_gaps() {
    let mut b = FightBuilder::new(30_000);
    let druid = b.player("Player-1", "Serrik-Silverbrook-EU", 102);
    b.power(1_000, druid, 0, 100, 100);
    b.power(21_000, druid, 0, 50, 100);
    let report = resources_report(&b.build(), &ReportFilter::whole(Attribution::Augmented));
    let track = &report.players[0].tracks[0];
    assert_eq!(
        track.series,
        vec![
            Some(100.0),
            Some(100.0),
            Some(100.0),
            Some(100.0),
            Some(50.0),
            None
        ]
    );
    assert_eq!(track.capped_ms, 0, "a 20 s gap is unknown, not capped");
}
