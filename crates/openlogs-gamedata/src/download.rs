use thiserror::Error;

use crate::boss_portraits::{BossPortraitError, BossPortraitTable};
use crate::channel_spells::{ChannelSpellError, ChannelSpells};
use crate::dungeons::{DungeonTable, DungeonTableError};
use crate::fetch::{Fetch, FetchError};
use crate::map_art::{MapArtError, MapArtTable};
use crate::spell_icons::{SpellIconError, SpellIconTable};

pub const WAGO_SPELL_MISC_URL: &str = "https://wago.tools/db2/SpellMisc/csv";
pub const WAGO_MANIFEST_URL: &str = "https://wago.tools/db2/ManifestInterfaceData/csv";
pub const WAGO_MAP_CHALLENGE_MODE_URL: &str = "https://wago.tools/db2/MapChallengeMode/csv";
pub const WAGO_DUNGEON_ENCOUNTER_URL: &str = "https://wago.tools/db2/DungeonEncounter/csv";
pub const WAGO_JOURNAL_ENCOUNTER_URL: &str = "https://wago.tools/db2/JournalEncounter/csv";
pub const WAGO_JOURNAL_ENCOUNTER_CREATURE_URL: &str =
    "https://wago.tools/db2/JournalEncounterCreature/csv";
pub const WAGO_UI_MAP_ASSIGNMENT_URL: &str = "https://wago.tools/db2/UiMapAssignment/csv";
pub const WAGO_UI_MAP_GROUP_MEMBER_URL: &str = "https://wago.tools/db2/UiMapGroupMember/csv";
pub const WAGO_AREA_TABLE_URL: &str = "https://wago.tools/db2/AreaTable/csv";
pub const WAGO_MAP_URL: &str = "https://wago.tools/db2/Map/csv";

#[derive(Debug, Error)]
pub enum DownloadError {
    #[error("download failed: {0}")]
    Fetch(#[from] FetchError),
    #[error("downloaded spell icon data is invalid: {0}")]
    SpellIcons(#[from] SpellIconError),
    #[error("downloaded channel spell data is invalid: {0}")]
    ChannelSpells(#[from] ChannelSpellError),
    #[error("downloaded dungeon data is invalid: {0}")]
    Dungeons(#[from] DungeonTableError),
    #[error("downloaded boss portrait data is invalid: {0}")]
    BossPortraits(#[from] BossPortraitError),
    #[error("downloaded map art data is invalid: {0}")]
    MapArt(#[from] MapArtError),
}

/// The tables read from the spells' `SpellMisc` rows.
pub struct SpellTables {
    pub icons: SpellIconTable,
    pub channels: ChannelSpells,
}

/// Builds the spell icon and channel tables from the wago.tools exports.
pub fn download_spell_tables<F: Fetch>(fetch: &F) -> Result<SpellTables, DownloadError> {
    let spell_misc = fetch.get(WAGO_SPELL_MISC_URL)?;
    let manifest = fetch.get(WAGO_MANIFEST_URL)?;
    Ok(SpellTables {
        icons: SpellIconTable::from_csv(&spell_misc, &manifest)?,
        channels: ChannelSpells::from_csv(&spell_misc)?,
    })
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

/// Builds the replay's map art index from the wago.tools exports.
pub fn download_map_art<F: Fetch>(fetch: &F) -> Result<MapArtTable, DownloadError> {
    let assignments = fetch.get(WAGO_UI_MAP_ASSIGNMENT_URL)?;
    let group_members = fetch.get(WAGO_UI_MAP_GROUP_MEMBER_URL)?;
    let areas = fetch.get(WAGO_AREA_TABLE_URL)?;
    let maps = fetch.get(WAGO_MAP_URL)?;
    let encounters = fetch.get(WAGO_JOURNAL_ENCOUNTER_URL)?;
    Ok(MapArtTable::from_csv(
        &assignments,
        &group_members,
        &areas,
        &maps,
        &encounters,
    )?)
}
