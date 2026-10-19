//! A Mythic+ log end to end: index (with its cache), load, overview and reports. The run is
//! synthetic, written in the real line format.

use std::fs;
use std::path::{Path, PathBuf};

use openlogs_analysis::{
    Attribution, Fight, FightKind, Overkill, Phase, PhaseKind, ReportFilter, damage_done, healing,
    load_fight_file, quick_overview, quick_overview_in,
};
use openlogs_gamedata::Curated;
use openlogs_index::{LogIndex, load_or_build};

const FIXTURE: &str = include_str!("../../openlogs-index/tests/fixtures/mythic_plus.txt");

/// The fixture written to a log file and indexed through the cache, as the app does.
fn indexed() -> (tempfile::TempDir, PathBuf, LogIndex) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("WoWCombatLog-100826_195800.txt");
    fs::write(&path, FIXTURE).unwrap();
    let (index, _) = load_or_build(&path, &dir.path().join("cache")).unwrap();
    (dir, path, index)
}

fn load(path: &Path, index: &LogIndex, fight_index: u32) -> Fight {
    let summary = index
        .fights
        .iter()
        .find(|f| f.index == fight_index)
        .unwrap();
    load_fight_file(path, summary).unwrap()
}

fn range(phase: &Phase, attribution: Attribution) -> ReportFilter {
    ReportFilter {
        start_ms: phase.start_ms as i32,
        end_ms: phase.end_ms as i32,
        attribution,
        overkill: Overkill::Excluded,
    }
}

/// (player name, damage) of a report, sorted by name.
fn per_player(fight: &Fight, filter: &ReportFilter) -> Vec<(String, u64)> {
    let mut rows: Vec<(String, u64)> = damage_done(fight, filter)
        .players
        .iter()
        .map(|p| {
            let name = fight.actors.get(p.player).name.clone().unwrap_or_default();
            (name, p.total)
        })
        .collect();
    rows.sort();
    rows
}

#[test]
fn a_run_goes_from_the_index_through_the_overview_to_the_reports() {
    let (_dir, path, index) = indexed();
    let run = load(&path, &index, 1);
    assert_eq!(run.kind, FightKind::Run);
    let curated = Curated::bundled();
    let overview = quick_overview(&run, &curated);
    let k = &overview.kpis;
    assert_eq!(
        (k.duration_ms, k.players, k.deaths, k.raid_damage),
        (600_000, 2, 1, 610_000_000)
    );
    assert!(overview.timeline.boss_hp.iter().all(Option::is_none));
    let names: Vec<_> = overview
        .timeline
        .phases
        .iter()
        .map(|p| p.name.as_deref())
        .collect();
    assert_eq!(
        names,
        [
            None,
            Some("Captain Dailcry"),
            None,
            Some("Baron Braunpyke"),
            None,
            Some("Baron Braunpyke"),
            None
        ]
    );

    let whole = ReportFilter::whole(Attribution::Augmented);
    assert_eq!(damage_done(&run, &whole).total, 610_000_000);
    assert_eq!(healing(&run, &whole).total, 500_000);
    // The Baron wipe as a range of the run: Faelan's death is in it.
    let wipe = &overview.timeline.phases[3];
    let in_wipe = quick_overview_in(&run, &curated, &range(wipe, Attribution::Augmented));
    assert_eq!(
        (in_wipe.kpis.deaths, in_wipe.kpis.raid_damage),
        (1, 50_000_000)
    );
}

#[test]
fn a_boss_phase_of_the_run_matches_the_boss_pull() {
    let (_dir, path, index) = indexed();
    let run = load(&path, &index, 1);
    let phases = quick_overview(&run, &Curated::bundled()).timeline.phases;
    let bosses: Vec<&Phase> = phases
        .iter()
        .filter(|p| p.kind == PhaseKind::Boss)
        .collect();
    let pulls: Vec<_> = index
        .fights
        .iter()
        .filter(|f| f.run_index == Some(1))
        .collect();
    assert_eq!(bosses.len(), pulls.len());
    for (phase, summary) in bosses.into_iter().zip(pulls) {
        assert_eq!(phase.name.as_deref(), Some(summary.name.as_str()));
        let pull = load_fight_file(&path, summary).unwrap();
        assert_eq!(u64::from(phase.end_ms - phase.start_ms), pull.duration_ms);
        assert_eq!(
            per_player(&run, &range(phase, Attribution::Reattributed)),
            per_player(&pull, &ReportFilter::whole(Attribution::Reattributed)),
            "{} at {} ms",
            summary.name,
            phase.start_ms
        );
    }
}

#[test]
fn a_released_player_is_not_dead_to_the_end_of_the_run() {
    // Faelan dies at 4:20 in the Braunpyke wipe and acts again at 6:10 and 8:00 without a
    // resurrect: his dead band ends at the trash after the wipe (4:30), not at the run's end.
    let (_dir, path, index) = indexed();
    let run = load(&path, &index, 1);
    let curated = Curated::bundled();
    let whole = ReportFilter::whole(Attribution::Augmented);
    let faelan = (0..run.actors.len() as u32)
        .find(|&id| run.actors.get(id).name.as_deref() == Some("Faelan-Emberfall-EU"))
        .unwrap();
    let detail = openlogs_analysis::player_detail(
        &run,
        &curated,
        faelan,
        openlogs_analysis::Metric::Damage,
        &whole,
        &openlogs_analysis::Scope::default(),
    )
    .unwrap();
    assert_eq!(detail.dead, vec![(260_000, 270_000)]);
    let after = ReportFilter {
        start_ms: 300_000,
        end_ms: 600_000,
        attribution: Attribution::Augmented,
        overkill: Overkill::Excluded,
    };
    let later = openlogs_analysis::player_detail(
        &run,
        &curated,
        faelan,
        openlogs_analysis::Metric::Damage,
        &after,
        &openlogs_analysis::Scope::default(),
    )
    .unwrap();
    assert!(
        later.dead.is_empty() && later.dead_since.is_none(),
        "alive after 5:00"
    );
}
