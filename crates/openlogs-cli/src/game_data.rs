use std::error::Error;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use openlogs_gamedata::{
    HttpFetch, download_boss_portraits, download_dungeons, download_spell_icons,
};

/// Downloads the game data from wago.tools into the files the app loads from `game-data/`.
pub fn export(out_dir: &Path) -> Result<(), Box<dyn Error>> {
    let fetch = HttpFetch::for_bulk_data();
    let spells = download_spell_icons(&fetch)?;
    let dungeons = download_dungeons(&fetch)?;
    let portraits = download_boss_portraits(&fetch)?;
    let fetched_unix_ms = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();

    fs::create_dir_all(out_dir)?;
    fs::write(out_dir.join("spell-icons.json"), spells.to_json())?;
    fs::write(out_dir.join("dungeons.json"), dungeons.to_json())?;
    fs::write(out_dir.join("boss-portraits.json"), portraits.to_json())?;
    // Written last: the app reads the tables only once the manifest names them.
    let manifest = serde_json::json!({
        "fetchedUnixMs": fetched_unix_ms,
        "spellIcons": spells.len(),
        "dungeons": dungeons.len(),
        "bossPortraits": portraits.len(),
    });
    fs::write(out_dir.join("manifest.json"), manifest.to_string())?;
    println!(
        "{} spells, {} keys and {} boss portraits written to {}",
        spells.len(),
        dungeons.len(),
        portraits.len(),
        out_dir.display()
    );
    Ok(())
}
