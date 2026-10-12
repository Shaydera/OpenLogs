//! Hits the real services. `cargo test -p openlogs-gamedata --test online -- --ignored`

use openlogs_gamedata::{
    HttpFetch, IconCache, load_or_sync, load_or_sync_boss_portraits, load_or_sync_dungeons,
};

#[test]
#[ignore = "needs network access to wago.tools, zamimg and assets.rpglogs.com"]
fn the_real_services_provide_every_table_and_image() {
    let dir = tempfile::tempdir().unwrap();
    let fetch = HttpFetch::for_bulk_data();
    let now = 1_791_590_400;
    let (spells, _) = load_or_sync(&dir.path().join("spell_icons.tsv"), &fetch, now).unwrap();
    assert!(spells.len() > 100_000, "got {} spells", spells.len());
    let (dungeons, _) =
        load_or_sync_dungeons(&dir.path().join("dungeons.txt"), &fetch, now).unwrap();
    assert!(dungeons.len() > 80, "got {} keys", dungeons.len());
    let (portraits, _) =
        load_or_sync_boss_portraits(&dir.path().join("boss_portraits.tsv"), &fetch, now).unwrap();
    assert!(portraits.len() > 1_000, "got {} portraits", portraits.len());

    let cache = IconCache::new(dir.path().join("icons"), HttpFetch::for_icons());
    let arcane_barrage = spells.icon(44425).unwrap();
    assert!(
        cache
            .get(arcane_barrage)
            .unwrap()
            .starts_with(&[0xFF, 0xD8])
    );
    let ulatek = 3492;
    let portrait = portraits.portrait(ulatek).unwrap();
    assert!(cache.get_journal(portrait).unwrap().starts_with(b"\x89PNG"));
    assert!(cache.get_boss(ulatek).unwrap().starts_with(&[0xFF, 0xD8]));
}
