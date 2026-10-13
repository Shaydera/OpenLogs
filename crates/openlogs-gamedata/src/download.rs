use thiserror::Error;

use crate::boss_portraits::{BossPortraitError, BossPortraitTable};
use crate::dungeons::{DungeonTable, DungeonTableError};
use crate::fetch::{Fetch, FetchError};
use crate::spell_icons::{SpellIconError, SpellIconTable};

pub const WAGO_SPELL_MISC_URL: &str = "https://wago.tools/db2/SpellMisc/csv";
pub const WAGO_MANIFEST_URL: &str = "https://wago.tools/db2/ManifestInterfaceData/csv";
pub const WAGO_MAP_CHALLENGE_MODE_URL: &str = "https://wago.tools/db2/MapChallengeMode/csv";
pub const WAGO_DUNGEON_ENCOUNTER_URL: &str = "https://wago.tools/db2/DungeonEncounter/csv";
pub const WAGO_JOURNAL_ENCOUNTER_URL: &str = "https://wago.tools/db2/JournalEncounter/csv";
pub const WAGO_JOURNAL_ENCOUNTER_CREATURE_URL: &str =
    "https://wago.tools/db2/JournalEncounterCreature/csv";

#[derive(Debug, Error)]
pub enum DownloadError {
    #[error("download failed: {0}")]
    Fetch(#[from] FetchError),
    #[error("downloaded spell data is invalid: {0}")]
    SpellIcons(#[from] SpellIconError),
    #[error("downloaded dungeon data is invalid: {0}")]
    Dungeons(#[from] DungeonTableError),
    #[error("downloaded boss portrait data is invalid: {0}")]
    BossPortraits(#[from] BossPortraitError),
}

/// Builds the spell icon table from the wago.tools exports.
pub fn download_spell_icons<F: Fetch>(fetch: &F) -> Result<SpellIconTable, DownloadError> {
    let spell_misc = fetch.get(WAGO_SPELL_MISC_URL)?;
    let manifest = fetch.get(WAGO_MANIFEST_URL)?;
    Ok(SpellIconTable::from_csv(&spell_misc, &manifest)?)
}

/// Builds the Mythic+ dungeon table from the wago.tools exports.
pub fn download_dungeons<F: Fetch>(fetch: &F) -> Result<DungeonTable, DownloadError> {
    let keys = fetch.get(WAGO_MAP_CHALLENGE_MODE_URL)?;
    let encounters = fetch.get(WAGO_DUNGEON_ENCOUNTER_URL)?;
    Ok(DungeonTable::from_csv(&keys, &encounters)?)
}

/// Builds the boss portrait table from the wago.tools exports.
pub fn download_boss_portraits<F: Fetch>(fetch: &F) -> Result<BossPortraitTable, DownloadError> {
    let encounters = fetch.get(WAGO_JOURNAL_ENCOUNTER_URL)?;
    let creatures = fetch.get(WAGO_JOURNAL_ENCOUNTER_CREATURE_URL)?;
    let manifest = fetch.get(WAGO_MANIFEST_URL)?;
    Ok(BossPortraitTable::from_csv(
        &encounters,
        &creatures,
        &manifest,
    )?)
}
