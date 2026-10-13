//! Hits the real services. `cargo test -p openlogs-gamedata --test online -- --ignored`

use openlogs_gamedata::{
    HttpFetch, download_boss_portraits, download_dungeons, download_spell_icons,
};

#[test]
#[ignore = "needs network access to wago.tools"]
fn wago_tools_provides_every_table() {
    let fetch = HttpFetch::for_bulk_data();
    let spells = download_spell_icons(&fetch).unwrap();
    assert!(spells.len() > 100_000, "got {} spells", spells.len());
    assert!(spells.icon(44425).is_some(), "Arcane Barrage has an icon");
    let dungeons = download_dungeons(&fetch).unwrap();
    assert!(dungeons.len() > 80, "got {} keys", dungeons.len());
    let portraits = download_boss_portraits(&fetch).unwrap();
    assert!(portraits.len() > 1_000, "got {} portraits", portraits.len());
    assert!(portraits.portrait(3492).is_some(), "Ula'tek has a portrait");
}
