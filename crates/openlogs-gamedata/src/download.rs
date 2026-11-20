use thiserror::Error;

use crate::boss_portraits::{BossPortraitError, BossPortraitTable};
use crate::channel_spells::{ChannelSpellError, ChannelSpells};
use crate::dungeons::{DungeonTable, DungeonTableError};
use crate::fetch::{Fetch, FetchError};
use crate::map_art::{MapArtError, MapArtTable};
use crate::spell_classes::{SpellClasses, SpellClassesError};
use crate::spell_icons::{SpellIconError, SpellIconTable};
use crate::talent_trees::{TalentTreeCsvs, TalentTrees, TalentTreesError};

pub const WAGO_SPELL_MISC_URL: &str = "https://wago.tools/db2/SpellMisc/csv";
pub const WAGO_SPELL_CLASS_OPTIONS_URL: &str = "https://wago.tools/db2/SpellClassOptions/csv";
pub const WAGO_SPELL_EFFECT_URL: &str = "https://wago.tools/db2/SpellEffect/csv";
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
/// The newest build of each product, as `{ "<product>": { "version": "…" }, … }`.
pub const WAGO_LATEST_BUILDS_URL: &str = "https://wago.tools/api/builds/latest";
pub const FOREVER_PRODUCT: &str = "wowf";

#[derive(Debug, Error)]
pub enum DownloadError {
    #[error("download failed: {0}")]
    Fetch(#[from] FetchError),
    #[error("downloaded spell icon data is invalid: {0}")]
    SpellIcons(#[from] SpellIconError),
    #[error("downloaded channel spell data is invalid: {0}")]
    ChannelSpells(#[from] ChannelSpellError),
    #[error("downloaded spell class data is invalid: {0}")]
    SpellClasses(#[from] SpellClassesError),
    #[error("downloaded dungeon data is invalid: {0}")]
    Dungeons(#[from] DungeonTableError),
    #[error("downloaded boss portrait data is invalid: {0}")]
    BossPortraits(#[from] BossPortraitError),
    #[error("downloaded map art data is invalid: {0}")]
    MapArt(#[from] MapArtError),
    #[error("downloaded talent tree data is invalid: {0}")]
    TalentTrees(#[from] TalentTreesError),
    #[error("downloaded build list is invalid: {0}")]
    Builds(#[from] serde_json::Error),
    #[error("wago.tools lists no build of {0}")]
    NoBuild(&'static str),
}

/// The tables read from the spells' `SpellMisc` rows.
pub struct SpellTables {
    pub icons: SpellIconTable,
    pub channels: ChannelSpells,
}

/// The spell tables of the Forever build they were exported from.
pub struct ForeverTables {
    pub build: String,
    pub spells: SpellTables,
    pub classes: SpellClasses,
    pub talent_trees: TalentTrees,
}

/// Builds the spell icon and channel tables from the wago.tools exports.
pub fn download_spell_tables<F: Fetch>(fetch: &F) -> Result<SpellTables, DownloadError> {
    let manifest = fetch.get(WAGO_MANIFEST_URL)?;
    spell_tables(fetch, None, &manifest)
}

/// Builds the class and crowd-control spell table from the wago.tools exports.
pub fn download_spell_classes<F: Fetch>(fetch: &F) -> Result<SpellClasses, DownloadError> {
    spell_classes(fetch, None)
}

/// Builds the spell tables of the newest Forever build.
pub fn download_forever_tables<F: Fetch>(fetch: &F) -> Result<ForeverTables, DownloadError> {
    let build = latest_build(fetch, FOREVER_PRODUCT)?;
    let manifest = fetch.get(&table_url(WAGO_MANIFEST_URL, Some(&build)))?;
    Ok(ForeverTables {
        spells: spell_tables(fetch, Some(&build), &manifest)?,
        classes: spell_classes(fetch, Some(&build))?,
        talent_trees: talent_trees(fetch, &build, &manifest)?,
        build,
    })
}

fn talent_trees<F: Fetch>(
    fetch: &F,
    build: &str,
    manifest: &[u8],
) -> Result<TalentTrees, DownloadError> {
    let table = |name: &str| {
        fetch.get(&table_url(
            &format!("https://wago.tools/db2/{name}/csv"),
            Some(build),
        ))
    };
    Ok(TalentTrees::from_csv(&TalentTreeCsvs {
        trait_node: &table("TraitNode")?,
        node_x_entry: &table("TraitNodeXTraitNodeEntry")?,
        node_entry: &table("TraitNodeEntry")?,
        definition: &table("TraitDefinition")?,
        talent: &table("Talent")?,
        talent_tab: &table("TalentTab")?,
        skill_line_x_trait_tree: &table("SkillLineXTraitTree")?,
        chr_specialization: &table("ChrSpecialization")?,
        manifest,
    })?)
}

fn latest_build<F: Fetch>(fetch: &F, product: &'static str) -> Result<String, DownloadError> {
    let builds: serde_json::Value = serde_json::from_slice(&fetch.get(WAGO_LATEST_BUILDS_URL)?)?;
    builds[product]["version"]
        .as_str()
        .map(str::to_string)
        .ok_or(DownloadError::NoBuild(product))
}

/// A table of `build`, or of the newest retail build without one.
fn table_url(base: &str, build: Option<&str>) -> String {
    match build {
        Some(build) => format!("{base}?build={build}"),
        None => base.to_string(),
    }
}

fn spell_tables<F: Fetch>(
    fetch: &F,
    build: Option<&str>,
    manifest: &[u8],
) -> Result<SpellTables, DownloadError> {
    let spell_misc = fetch.get(&table_url(WAGO_SPELL_MISC_URL, build))?;
    Ok(SpellTables {
        icons: SpellIconTable::from_csv(&spell_misc, manifest)?,
        channels: ChannelSpells::from_csv(&spell_misc)?,
    })
}

fn spell_classes<F: Fetch>(fetch: &F, build: Option<&str>) -> Result<SpellClasses, DownloadError> {
    let spell_class_options = fetch.get(&table_url(WAGO_SPELL_CLASS_OPTIONS_URL, build))?;
    let spell_effect = fetch.get(&table_url(WAGO_SPELL_EFFECT_URL, build))?;
    Ok(SpellClasses::from_csv(&spell_class_options, &spell_effect)?)
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
