use std::error::Error;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use openlogs_gamedata::{
    HttpFetch, download_boss_portraits, download_dungeons, download_map_art,
    download_spell_classes, download_spell_tables,
};

/// Downloads the game data from wago.tools into the files the app loads from `game-data/`.
pub fn export(out_dir: &Path) -> Result<(), Box<dyn Error>> {
    let fetch = HttpFetch::for_bulk_data();
    let spells = download_spell_tables(&fetch)?;
    let spell_classes = download_spell_classes(&fetch)?;
    let dungeons = download_dungeons(&fetch)?;
    let portraits = download_boss_portraits(&fetch)?;
    let map_art = download_map_art(&fetch)?;
    let fetched_unix_ms = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();

    fs::create_dir_all(out_dir)?;
    fs::write(out_dir.join("spell-icons.json"), spells.icons.to_json())?;
    fs::write(
        out_dir.join("channel-spells.json"),
        spells.channels.to_json(),
    )?;
    fs::write(out_dir.join("spell-classes.json"), spell_classes.to_json())?;
    fs::write(out_dir.join("dungeons.json"), dungeons.to_json())?;
    fs::write(out_dir.join("boss-portraits.json"), portraits.to_json())?;
    fs::write(out_dir.join("map-art.json"), map_art.to_json())?;
    // Written last: the app reads the tables only once the manifest names them.
    let manifest = serde_json::json!({
        "fetchedUnixMs": fetched_unix_ms,
        "spellIcons": spells.icons.len(),
        "channelSpells": spells.channels.len(),
        "spellClasses": spell_classes.class_spell_count(),
        "dungeons": dungeons.len(),
        "bossPortraits": portraits.len(),
        "mapArt": map_art.maps.len(),
    });
    fs::write(out_dir.join("manifest.json"), manifest.to_string())?;
    println!(
        "{} spells, {} channel spells, {} class spells ({} crowd control), {} keys, {} boss portraits and {} maps written to {}",
        spells.icons.len(),
        spells.channels.len(),
        spell_classes.class_spell_count(),
        spell_classes.crowd_control_count(),
        dungeons.len(),
        portraits.len(),
        map_art.maps.len(),
        out_dir.display()
    );
    Ok(())
}
