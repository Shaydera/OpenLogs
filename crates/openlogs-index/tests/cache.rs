use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use openlogs_index::{CacheStatus, INDEX_FORMAT_VERSION, load_or_build};

const LOG: &str = include_str!("fixtures/mini_raid.txt");

fn write_log(dir: &Path) -> PathBuf {
    let log = dir.join("WoWCombatLog-test.txt");
    fs::write(&log, LOG).unwrap();
    log
}

#[test]
fn second_load_hits_the_cache() {
    let dir = tempfile::tempdir().unwrap();
    let log = write_log(dir.path());
    let cache = dir.path().join("cache");
    let (first, status) = load_or_build(&log, &cache).unwrap();
    assert_eq!(status, CacheStatus::Miss);
    let (second, status) = load_or_build(&log, &cache).unwrap();
    assert_eq!(status, CacheStatus::Hit);
    assert_eq!(first, second);
}

#[test]
fn appended_log_is_reindexed() {
    let dir = tempfile::tempdir().unwrap();
    let log = write_log(dir.path());
    let cache = dir.path().join("cache");
    let (before, _) = load_or_build(&log, &cache).unwrap();
    let mut file = OpenOptions::new().append(true).open(&log).unwrap();
    // Leading newline: works whether or not the fixture ends with one (blank lines are skipped).
    write!(file, "\n10/7/2026 19:30:00.0000  WORLD_MARKER_REMOVED,0\n").unwrap();
    drop(file);
    let (after, status) = load_or_build(&log, &cache).unwrap();
    assert_eq!(status, CacheStatus::Miss);
    assert_eq!(after.line_count, before.line_count + 1);
}

#[test]
fn corrupt_or_outdated_cache_is_rebuilt() {
    let corrupt = |path: &Path| fs::write(path, "not json").unwrap();
    let outdated = |path: &Path| {
        let mut stored: serde_json::Value =
            serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        let previous = serde_json::json!(INDEX_FORMAT_VERSION - 1);
        stored["key"]["format_version"] = previous.clone();
        stored["index"]["format_version"] = previous;
        stored["index"]["fights"] = serde_json::json!([]);
        fs::write(path, serde_json::to_vec(&stored).unwrap()).unwrap();
    };
    for (case, rewrite) in [
        ("corrupt", &corrupt as &dyn Fn(&Path)),
        ("outdated", &outdated),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let log = write_log(dir.path());
        let cache = dir.path().join("cache");
        load_or_build(&log, &cache).unwrap();
        for entry in fs::read_dir(&cache).unwrap() {
            rewrite(&entry.unwrap().path());
        }
        let (index, status) = load_or_build(&log, &cache).unwrap();
        assert_eq!(
            (status, index.fights.len()),
            (CacheStatus::Miss, 3),
            "{case}"
        );
        assert_eq!(
            load_or_build(&log, &cache).unwrap().1,
            CacheStatus::Hit,
            "{case}"
        );
    }
}

#[test]
fn unwritable_cache_still_returns_the_index() {
    let dir = tempfile::tempdir().unwrap();
    let log = write_log(dir.path());
    let not_a_dir = dir.path().join("cache");
    fs::write(&not_a_dir, "a file where the cache directory should be").unwrap();
    let (index, status) = load_or_build(&log, &not_a_dir).unwrap();
    assert_eq!(status, CacheStatus::Uncached);
    assert_eq!(index.fights.len(), 3);
}
