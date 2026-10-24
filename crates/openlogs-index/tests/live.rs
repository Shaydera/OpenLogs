use openlogs_index::{Indexer, LogIndex, Outcome, index_bytes};
use openlogs_parser::Timestamp;

const FIXTURES: [&str; 5] = [
    include_str!("fixtures/mini_raid.txt"),
    include_str!("fixtures/mythic_plus.txt"),
    include_str!("fixtures/mythic_plus_end_first.txt"),
    include_str!("fixtures/mythic_plus_offline_wipe.txt"),
    include_str!("fixtures/mythic_plus_reconnect.txt"),
];

const SETTLE_MS: i64 = 1_000;

fn timestamp_of(line: &str) -> Timestamp {
    Timestamp::parse(line.split("  ").next().unwrap()).unwrap()
}

/// Byte offsets just past the `ENCOUNTER_END` line `nth` (0-based) and just past the first
/// line more than [`SETTLE_MS`] after it.
fn cuts_after_encounter_end(log: &str, nth: usize) -> (usize, usize) {
    let mut offset = 0;
    let mut end_at = None;
    let mut ends_seen = 0;
    for line in log.split_inclusive('\n') {
        offset += line.len();
        match end_at {
            None if line.contains("ENCOUNTER_END") => {
                if ends_seen == nth {
                    end_at = Some((offset, timestamp_of(line)));
                }
                ends_seen += 1;
            }
            Some((just_after_end, end)) if timestamp_of(line).millis_since(end) > SETTLE_MS => {
                return (just_after_end, offset);
            }
            _ => {}
        }
    }
    panic!("no line more than a second after ENCOUNTER_END #{nth}");
}

fn indexer_after(log: &str, bytes: usize) -> Indexer {
    let mut indexer = Indexer::new();
    indexer.feed(&log.as_bytes()[..bytes]);
    indexer
}

fn indexes(index: &LogIndex) -> Vec<u32> {
    index.fights.iter().map(|fight| fight.index).collect()
}

#[test]
fn a_snapshot_after_every_chunk_equals_indexing_the_bytes_so_far() {
    for log in FIXTURES {
        for chunk_size in [7, 4096] {
            let mut indexer = Indexer::new();
            let mut fed = 0;
            for chunk in log.as_bytes().chunks(chunk_size) {
                indexer.feed(chunk);
                fed += chunk.len();
                assert_eq!(
                    indexer.snapshot(),
                    index_bytes(&log.as_bytes()[..fed]),
                    "chunk size {chunk_size}, {fed} bytes"
                );
            }
        }
    }
}

#[test]
fn settled_entries_never_change_as_the_log_grows() {
    for log in FIXTURES {
        let whole = index_bytes(log.as_bytes());
        let mut indexer = Indexer::new();
        for chunk in log.as_bytes().chunks(97) {
            indexer.feed(chunk);
            for fight in indexer.settled_index(Some(SETTLE_MS)).fights {
                assert_eq!(
                    Some(&fight),
                    whole.fights.iter().find(|f| f.index == fight.index)
                );
            }
        }
    }
}

#[test]
fn a_pull_settles_only_after_a_line_more_than_a_second_past_its_end() {
    let log = FIXTURES[0];
    let (just_after_end, after_settling) = cuts_after_encounter_end(log, 0);
    let with_lines_at = |times: &[&str]| {
        let mut grown = log[..just_after_end].to_string();
        for time in times {
            grown += &format!("10/7/2026 {time}  WORLD_MARKER_PLACED,3004,1,1525.40,11.09\n");
        }
        indexer_after(&grown, grown.len())
    };

    let at_end = with_lines_at(&[]);
    assert!(at_end.settled_index(Some(SETTLE_MS)).fights.is_empty());
    assert_eq!(indexes(&at_end.settled_index(None)), [1]);

    // Pull 1 lasts 60000 ms from 19:03:02.0762; the analysis reads whole ms past its start.
    let at_boundary = with_lines_at(&["19:04:03.0762", "19:04:03.0771"]);
    assert!(at_boundary.settled_index(Some(SETTLE_MS)).fights.is_empty());
    let past_boundary = with_lines_at(&["19:04:03.0762", "19:04:03.0771", "19:04:03.0772"]);
    assert_eq!(indexes(&past_boundary.settled_index(Some(SETTLE_MS))), [1]);

    let later = indexer_after(log, after_settling);
    assert_eq!(indexes(&later.settled_index(None)), [1]);
    let snapshot = later.snapshot();
    assert_eq!(indexes(&snapshot), [1, 2]);
    assert_eq!(snapshot.fights[1].outcome, Outcome::Incomplete);
}

#[test]
fn boss_pulls_of_a_running_key_wait_for_the_key_to_end() {
    let log = FIXTURES[1];
    let (_, after_settling) = cuts_after_encounter_end(log, 0);

    let running = indexer_after(log, after_settling);
    assert!(running.settled_index(None).fights.is_empty());

    let whole = index_bytes(log.as_bytes());
    let mut finished = Indexer::new();
    finished.feed(log.as_bytes());
    let settled = finished.settled_index(None);
    assert!(settled.fights.iter().any(|fight| fight.is_run()));
    assert!(settled.fights.iter().any(|fight| fight.run_index.is_some()));
    assert_eq!(settled.fights, whole.fights);
}
