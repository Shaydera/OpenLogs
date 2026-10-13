//! Encounter Journal portraits by `DungeonEncounter` ID, from the wago.tools exports
//! `JournalEncounter`, `JournalEncounterCreature` and `ManifestInterfaceData`. The image itself
//! comes from zamimg (`journal/<name>.png`, see `ui/src/icons.ts`).

use std::collections::{BTreeMap, HashMap};

use thiserror::Error;

use crate::icon_name::{icon_name_from_file, is_valid_icon_name};

/// The journal's generic silhouette: a boss without its own portrait gets the monogram instead.
const DEFAULT_PORTRAIT: &str = "ui-ej-boss-default";
/// File name prefix of a boss portrait (zamimg name, lower case).
const PORTRAIT_PREFIX: &str = "ui-ej-boss-";

#[derive(Debug, Error)]
pub enum BossPortraitError {
    #[error("CSV error: {0}")]
    Csv(#[from] csv::Error),
    #[error("CSV is missing the column {0}")]
    MissingColumn(&'static str),
    #[error("the exports hold no boss portrait")]
    Empty,
}

/// `DungeonEncounter` ID (the `ENCOUNTER_START` ID) → Encounter Journal portrait name.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BossPortraitTable {
    portraits: BTreeMap<u32, String>,
}

impl BossPortraitTable {
    /// Builds the table from the wago.tools CSV exports; columns are found by name.
    ///
    /// Per journal encounter with a `DungeonEncounterID`: its creatures sorted by `OrderIndex`,
    /// then `ID`; the first with a portrait file under `Interface\EncounterJournal\` named
    /// `UI-EJ-BOSS-*` (not the default silhouette). The lowest journal ID wins for an encounter.
    pub fn from_csv(
        journal_encounter: &[u8],
        journal_encounter_creature: &[u8],
        manifest: &[u8],
    ) -> Result<Self, BossPortraitError> {
        let files = read_portrait_files(manifest)?;

        let mut reader = csv::Reader::from_reader(journal_encounter);
        let headers = reader.headers()?.clone();
        let id_col = column(&headers, "ID")?;
        let encounter_col = column(&headers, "DungeonEncounterID")?;
        // Journal encounter ID → DungeonEncounter ID, sorted by journal ID.
        let mut encounters = BTreeMap::new();
        for record in reader.records() {
            let record = record?;
            let parse = |col: usize| record.get(col).and_then(|v| v.parse::<u32>().ok());
            if let (Some(journal), Some(encounter)) = (parse(id_col), parse(encounter_col))
                && encounter != 0
            {
                encounters.insert(journal, encounter);
            }
        }

        let mut reader = csv::Reader::from_reader(journal_encounter_creature);
        let headers = reader.headers()?.clone();
        let creature_col = column(&headers, "ID")?;
        let journal_col = column(&headers, "JournalEncounterID")?;
        let file_col = column(&headers, "FileDataID")?;
        let order_col = column(&headers, "OrderIndex")?;
        // Journal encounter ID → (OrderIndex, creature ID, FileDataID).
        let mut creatures: HashMap<u32, Vec<(i64, u32, u32)>> = HashMap::new();
        for record in reader.records() {
            let record = record?;
            let parse = |col: usize| record.get(col).and_then(|v| v.parse::<u32>().ok());
            let order = record.get(order_col).and_then(|v| v.parse::<i64>().ok());
            if let (Some(creature), Some(journal), Some(file), Some(order)) = (
                parse(creature_col),
                parse(journal_col),
                parse(file_col),
                order,
            ) {
                creatures
                    .entry(journal)
                    .or_default()
                    .push((order, creature, file));
            }
        }

        let mut portraits = BTreeMap::new();
        for (journal, encounter) in encounters {
            let Some(list) = creatures.get_mut(&journal) else {
                continue;
            };
            list.sort_unstable();
            let portrait = list
                .iter()
                .filter(|(_, _, file)| *file != 0)
                .find_map(|(_, _, file)| files.get(file));
            if let Some(name) = portrait {
                portraits.entry(encounter).or_insert_with(|| name.clone());
            }
        }
        if portraits.is_empty() {
            return Err(BossPortraitError::Empty);
        }
        Ok(Self { portraits })
    }

    pub fn portrait(&self, encounter_id: u32) -> Option<&str> {
        self.portraits.get(&encounter_id).map(String::as_str)
    }

    pub fn len(&self) -> usize {
        self.portraits.len()
    }

    pub fn is_empty(&self) -> bool {
        self.portraits.is_empty()
    }

    /// The table for the web app: encounter ID → portrait name.
    pub fn to_json(&self) -> String {
        serde_json::to_string(&self.portraits).expect("the portrait table serializes")
    }
}

/// File data ID → portrait name for every boss portrait of the Encounter Journal.
fn read_portrait_files(manifest: &[u8]) -> Result<HashMap<u32, String>, BossPortraitError> {
    let mut reader = csv::Reader::from_reader(manifest);
    let headers = reader.headers()?.clone();
    let id_col = column(&headers, "ID")?;
    let path_col = column(&headers, "FilePath")?;
    let name_col = column(&headers, "FileName")?;
    let mut files = HashMap::new();
    for record in reader.records() {
        let record = record?;
        let in_journal = record
            .get(path_col)
            .is_some_and(|path| path.eq_ignore_ascii_case("Interface\\EncounterJournal\\"));
        let id = record.get(id_col).and_then(|v| v.parse::<u32>().ok());
        if let (true, Some(id), Some(file)) = (in_journal, id, record.get(name_col)) {
            let name = icon_name_from_file(file);
            if name.starts_with(PORTRAIT_PREFIX)
                && name != DEFAULT_PORTRAIT
                && is_valid_icon_name(&name)
            {
                files.insert(id, name);
            }
        }
    }
    Ok(files)
}

fn column(headers: &csv::StringRecord, name: &'static str) -> Result<usize, BossPortraitError> {
    headers
        .iter()
        .position(|header| header == name)
        .ok_or(BossPortraitError::MissingColumn(name))
}
