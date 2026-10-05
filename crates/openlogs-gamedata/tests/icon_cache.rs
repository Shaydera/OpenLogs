mod common;

use common::{FakeFetch, jpeg, png};
use openlogs_gamedata::{
    FetchError, IconCache, IconError, RPGLOGS_BOSS_URL, ZAMIMG_ICON_URL, ZAMIMG_JOURNAL_URL,
};

fn icon_url(name: &str) -> String {
    format!("{ZAMIMG_ICON_URL}{name}.jpg")
}

fn journal_url(name: &str) -> String {
    format!("{ZAMIMG_JOURNAL_URL}{name}.png")
}

fn boss_url(encounter_id: u32) -> String {
    format!("{RPGLOGS_BOSS_URL}{encounter_id}-icon.jpg")
}

#[test]
fn each_image_is_downloaded_once_and_served_from_disk_after_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    let fetch = FakeFetch::default()
        .with(&icon_url("classicon_mage"), Ok(jpeg(1)))
        .with(&journal_url("ui-ej-boss-ulatek"), Ok(png(2)))
        .with(&boss_url(3492), Ok(jpeg(3)));
    let cache = IconCache::new(dir.path().to_path_buf(), fetch);
    for _ in 0..2 {
        assert_eq!(cache.get("classicon_mage").unwrap(), jpeg(1));
        assert_eq!(cache.get_journal("ui-ej-boss-ulatek").unwrap(), png(2));
        assert_eq!(cache.get_boss(3492).unwrap(), jpeg(3));
    }
    assert_eq!(cache.fetcher().calls.lock().unwrap().len(), 3);

    let offline = IconCache::new(dir.path().to_path_buf(), FakeFetch::default());
    assert_eq!(offline.get("classicon_mage").unwrap(), jpeg(1));
    assert_eq!(offline.get_journal("ui-ej-boss-ulatek").unwrap(), png(2));
    assert_eq!(offline.get_boss(3492).unwrap(), jpeg(3));
}

#[test]
fn a_failed_download_is_not_repeated_until_the_next_start() {
    let dir = tempfile::tempdir().unwrap();
    let fetch = FakeFetch::default().with(
        &icon_url("spell_x"),
        Err(FetchError::Transport("offline".into())),
    );
    let cache = IconCache::new(dir.path().to_path_buf(), fetch);
    for _ in 0..2 {
        assert!(matches!(
            cache.get("spell_x"),
            Err(IconError::Unavailable(_))
        ));
    }
    assert_eq!(cache.fetcher().call_count(&icon_url("spell_x")), 1);

    let online = FakeFetch::default().with(&icon_url("spell_x"), Ok(jpeg(2)));
    let restarted = IconCache::new(dir.path().to_path_buf(), online);
    assert_eq!(restarted.get("spell_x").unwrap(), jpeg(2));
}

#[test]
fn a_response_of_the_wrong_format_is_no_image() {
    let dir = tempfile::tempdir().unwrap();
    // Warcraft Logs answers unknown encounters with an XML error page.
    let fetch = FakeFetch::default()
        .with(
            &icon_url("spell_html"),
            Ok(b"<html>not found</html>".to_vec()),
        )
        .with(&journal_url("ui-ej-boss-x"), Ok(jpeg(1)))
        .with(
            &boss_url(2847),
            Ok(b"<?xml version=\"1.0\"?><Error/>".to_vec()),
        );
    let cache = IconCache::new(dir.path().to_path_buf(), fetch);
    assert!(matches!(
        cache.get("spell_html"),
        Err(IconError::Unavailable(_))
    ));
    assert!(matches!(
        cache.get_journal("ui-ej-boss-x"),
        Err(IconError::Unavailable(_))
    ));
    assert!(matches!(
        cache.get_boss(2847),
        Err(IconError::Unavailable(_))
    ));
    assert_eq!(
        std::fs::read_dir(dir.path()).unwrap().count(),
        0,
        "nothing is stored"
    );
}

#[test]
fn names_that_could_escape_the_cache_are_rejected_without_a_download() {
    let dir = tempfile::tempdir().unwrap();
    let cache = IconCache::new(dir.path().join("icons"), FakeFetch::default());
    for bad in ["../secret", "..\\secret", "a/b", "ICON", ""] {
        assert!(
            matches!(cache.get(bad), Err(IconError::InvalidName(_))),
            "{bad:?}"
        );
        assert!(
            matches!(cache.get_journal(bad), Err(IconError::InvalidName(_))),
            "{bad:?}"
        );
    }
    assert!(cache.fetcher().calls.lock().unwrap().is_empty());
    assert!(!dir.path().join("icons").exists());
}
