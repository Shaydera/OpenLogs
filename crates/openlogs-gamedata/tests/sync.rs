mod common;

use std::fs;

use common::FakeFetch;
use openlogs_gamedata::{
    FetchError, REFRESH_AFTER_SECS, SyncError, SyncOutcome, WAGO_MANIFEST_URL, WAGO_SPELL_MISC_URL,
    fetched_unix_s, load_cached, load_or_sync, refresh_spell_icons,
};

const MANIFEST: &str =
    "ID,FilePath,FileName\n236205,Interface\\ICONS\\,Ability_Mage_ArcaneBarrage.blp\n";
const SPELL_MISC: &str = "ID,DifficultyID,SpellIconFileDataID,SpellID\n1,0,236205,44425\n";
const NOW: u64 = 1_791_590_400;
const ARCANE_BARRAGE: u32 = 44425;

fn online() -> FakeFetch {
    FakeFetch::default()
        .with(WAGO_SPELL_MISC_URL, Ok(SPELL_MISC.as_bytes().to_vec()))
        .with(WAGO_MANIFEST_URL, Ok(MANIFEST.as_bytes().to_vec()))
}

fn offline() -> FakeFetch {
    FakeFetch::default()
}

/// wago.tools answering with a web page instead of the export.
fn maintenance() -> FakeFetch {
    FakeFetch::default()
        .with(WAGO_SPELL_MISC_URL, Ok(b"<!DOCTYPE html>".to_vec()))
        .with(WAGO_MANIFEST_URL, Ok(MANIFEST.as_bytes().to_vec()))
}

#[test]
fn a_table_is_downloaded_once_and_reused_while_fresh() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("game-data").join("spell_icons.tsv");
    let (table, outcome) = load_or_sync(&path, &online(), NOW).unwrap();
    assert_eq!(outcome, SyncOutcome::Downloaded);
    assert_eq!(
        table.icon(ARCANE_BARRAGE),
        Some("ability_mage_arcanebarrage")
    );
    assert_eq!(fetched_unix_s(&path), Some(NOW));
    assert_eq!(load_cached(&path), Some(table.clone()));

    let fetch = online();
    let (again, outcome) = load_or_sync(&path, &fetch, NOW + REFRESH_AFTER_SECS - 1).unwrap();
    assert_eq!((again, outcome), (table, SyncOutcome::Fresh));
    assert!(fetch.calls.lock().unwrap().is_empty());

    fs::write(&path, "# fetched_unix_s=1\ngarbage\n").unwrap();
    assert_eq!(load_cached(&path), None);
    let (_, outcome) = load_or_sync(&path, &online(), NOW).unwrap();
    assert_eq!(
        outcome,
        SyncOutcome::Downloaded,
        "a corrupt file is replaced"
    );
}

#[test]
fn a_failed_refresh_keeps_the_stored_table() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("spell_icons.tsv");
    assert!(matches!(
        load_or_sync(&path, &offline(), NOW),
        Err(SyncError::Fetch(FetchError::Status(404)))
    ));
    assert!(matches!(
        load_or_sync(&path, &maintenance(), NOW),
        Err(SyncError::Parse(_))
    ));

    load_or_sync(&path, &online(), NOW).unwrap();
    let later = NOW + REFRESH_AFTER_SECS + 1;
    for fetch in [offline(), maintenance()] {
        let (table, outcome) = load_or_sync(&path, &fetch, later).unwrap();
        assert_eq!(outcome, SyncOutcome::Stale);
        assert_eq!(
            table.icon(ARCANE_BARRAGE),
            Some("ability_mage_arcanebarrage")
        );
    }
    assert_eq!(fetched_unix_s(&path), Some(NOW));
}

#[test]
fn a_forced_refresh_downloads_even_a_fresh_table() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("spell_icons.tsv");
    load_or_sync(&path, &online(), NOW).unwrap();

    let fetch = online();
    let (_, outcome) = refresh_spell_icons(&path, &fetch, NOW + 60).unwrap();
    assert_eq!(outcome, SyncOutcome::Downloaded);
    assert_eq!(fetch.call_count(WAGO_SPELL_MISC_URL), 1);
    assert_eq!(fetched_unix_s(&path), Some(NOW + 60));

    let (_, outcome) = refresh_spell_icons(&path, &offline(), NOW + 120).unwrap();
    assert_eq!(outcome, SyncOutcome::Stale);
}
