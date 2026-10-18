//! The replay's map art index from the wago.tools exports `UiMapAssignment`,
//! `UiMapGroupMember`, `AreaTable`, `Map` and `JournalEncounter`: per uiMap the Wowhead zone and
//! floor of its image and its world bounds, per encounter the journal's boss pin. The image
//! itself comes from zamimg (`maps/enus/original/<zone>-<floor>.jpg`).

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// `Map.InstanceType` of a raid.
const RAID_INSTANCE: u32 = 2;

#[derive(Debug, Error)]
pub enum MapArtError {
    #[error("CSV error: {0}")]
    Csv(#[from] csv::Error),
    #[error("CSV is missing the column {0}")]
    MissingColumn(&'static str),
    #[error("stored map art table is invalid: {0}")]
    Stored(#[from] serde_json::Error),
    #[error("the exports hold no map art or no boss pin")]
    Empty,
}

/// One uiMap (floor) of the game's map browser.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapArt {
    /// Wowhead zone ID: the map's single top-level `AreaTable` row.
    pub zone: u32,
    /// Wowhead floor number (the zero-based `FloorIndex`); `None` for a map outside a floor group.
    pub floor: Option<u32>,
    pub raid: bool,
    pub min_x: f32,
    pub max_x: f32,
    pub min_y: f32,
    pub max_y: f32,
}

/// Where the Encounter Journal places a boss: fractions of its uiMap's image.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BossPin {
    pub ui_map_id: u32,
    /// `Map_0`: fraction of the image width.
    pub u: f32,
    /// `Map_1`: fraction of the image height.
    pub v: f32,
}

/// uiMap ID → [`MapArt`] and `DungeonEncounter` ID → [`BossPin`].
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct MapArtTable {
    pub maps: BTreeMap<u32, MapArt>,
    pub pins: BTreeMap<u32, BossPin>,
}

struct Assignment {
    map_id: u32,
    min_x: f32,
    max_x: f32,
    min_y: f32,
    max_y: f32,
}

impl MapArtTable {
    /// Builds the table from the wago.tools CSV exports; columns are found by name.
    ///
    /// A uiMap's bounds and instance come from its `UiMapAssignment` row with the lowest
    /// `OrderIndex`, then `ID`. A uiMap whose instance has not exactly one top-level area is
    /// left out. Pins come from journal encounters with a `DungeonEncounterID` and a `UiMapID`;
    /// the lowest journal ID wins for an encounter.
    pub fn from_csv(
        ui_map_assignment: &[u8],
        ui_map_group_member: &[u8],
        area_table: &[u8],
        map: &[u8],
        journal_encounter: &[u8],
    ) -> Result<Self, MapArtError> {
        let assignments = read_assignments(ui_map_assignment)?;
        let floors = read_floors(ui_map_group_member)?;
        let zones = read_zones(area_table)?;
        let raids = read_raid_maps(map)?;
        let pins = read_pins(journal_encounter)?;

        let maps = assignments
            .into_iter()
            .filter_map(|(ui_map, assignment)| {
                let zone = *zones.get(&assignment.map_id)?;
                let art = MapArt {
                    zone,
                    floor: floors.get(&ui_map).copied(),
                    raid: raids.contains(&assignment.map_id),
                    min_x: assignment.min_x,
                    max_x: assignment.max_x,
                    min_y: assignment.min_y,
                    max_y: assignment.max_y,
                };
                Some((ui_map, art))
            })
            .collect::<BTreeMap<_, _>>();
        if maps.is_empty() || pins.is_empty() {
            return Err(MapArtError::Empty);
        }
        Ok(Self { maps, pins })
    }

    /// The table for the web app.
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("the map art table serializes")
    }

    /// Parses [`Self::to_json`] output.
    pub fn from_json(json: &str) -> Result<Self, MapArtError> {
        Ok(serde_json::from_str(json)?)
    }
}

fn read_assignments(csv: &[u8]) -> Result<BTreeMap<u32, Assignment>, MapArtError> {
    let mut reader = csv::Reader::from_reader(csv);
    let headers = reader.headers()?.clone();
    let ui_map_col = column(&headers, "UiMapID")?;
    let map_col = column(&headers, "MapID")?;
    let order_col = column(&headers, "OrderIndex")?;
    let id_col = column(&headers, "ID")?;
    let min_x_col = column(&headers, "Region_0")?;
    let min_y_col = column(&headers, "Region_1")?;
    let max_x_col = column(&headers, "Region_3")?;
    let max_y_col = column(&headers, "Region_4")?;
    // uiMap → ((OrderIndex, ID), assignment) of its first row.
    let mut first: BTreeMap<u32, ((i64, u32), Assignment)> = BTreeMap::new();
    for record in reader.records() {
        let record = record?;
        let int = |col: usize| record.get(col).and_then(|v| v.parse::<u32>().ok());
        let float = |col: usize| record.get(col).and_then(|v| v.parse::<f32>().ok());
        let order = record.get(order_col).and_then(|v| v.parse::<i64>().ok());
        let (
            Some(ui_map),
            Some(map_id),
            Some(order),
            Some(id),
            Some(min_x),
            Some(min_y),
            Some(max_x),
            Some(max_y),
        ) = (
            int(ui_map_col),
            int(map_col),
            order,
            int(id_col),
            float(min_x_col),
            float(min_y_col),
            float(max_x_col),
            float(max_y_col),
        )
        else {
            continue;
        };
        let rank = (order, id);
        if first.get(&ui_map).is_some_and(|(best, _)| *best <= rank) {
            continue;
        }
        let assignment = Assignment {
            map_id,
            min_x,
            max_x,
            min_y,
            max_y,
        };
        first.insert(ui_map, (rank, assignment));
    }
    Ok(first
        .into_iter()
        .map(|(ui_map, (_, assignment))| (ui_map, assignment))
        .collect())
}

/// uiMap → Wowhead floor number (the zero-based `FloorIndex`).
fn read_floors(csv: &[u8]) -> Result<HashMap<u32, u32>, MapArtError> {
    let mut reader = csv::Reader::from_reader(csv);
    let headers = reader.headers()?.clone();
    let ui_map_col = column(&headers, "UiMapID")?;
    let floor_col = column(&headers, "FloorIndex")?;
    let mut floors = HashMap::new();
    for record in reader.records() {
        let record = record?;
        let int = |col: usize| record.get(col).and_then(|v| v.parse::<u32>().ok());
        if let (Some(ui_map), Some(floor_index)) = (int(ui_map_col), int(floor_col)) {
            floors.insert(ui_map, floor_index);
        }
    }
    Ok(floors)
}

/// Instance (`Map`) ID → its top-level area, the Wowhead zone.
fn read_zones(csv: &[u8]) -> Result<HashMap<u32, u32>, MapArtError> {
    let mut reader = csv::Reader::from_reader(csv);
    let headers = reader.headers()?.clone();
    let id_col = column(&headers, "ID")?;
    let continent_col = column(&headers, "ContinentID")?;
    let parent_col = column(&headers, "ParentAreaID")?;
    let mut top_level: HashMap<u32, Vec<u32>> = HashMap::new();
    for record in reader.records() {
        let record = record?;
        let int = |col: usize| record.get(col).and_then(|v| v.parse::<u32>().ok());
        if let (Some(id), Some(continent), Some(0)) =
            (int(id_col), int(continent_col), int(parent_col))
        {
            top_level.entry(continent).or_default().push(id);
        }
    }
    // Several top-level areas (Icecrown Citadel, Siege of Orgrimmar, every continent) name no
    // single Wowhead zone; a guess would show the wrong image.
    Ok(top_level
        .into_iter()
        .filter_map(|(continent, areas)| match areas[..] {
            [zone] => Some((continent, zone)),
            _ => None,
        })
        .collect())
}

fn read_raid_maps(csv: &[u8]) -> Result<HashSet<u32>, MapArtError> {
    let mut reader = csv::Reader::from_reader(csv);
    let headers = reader.headers()?.clone();
    let id_col = column(&headers, "ID")?;
    let instance_col = column(&headers, "InstanceType")?;
    let mut raids = HashSet::new();
    for record in reader.records() {
        let record = record?;
        let int = |col: usize| record.get(col).and_then(|v| v.parse::<u32>().ok());
        if let (Some(id), Some(RAID_INSTANCE)) = (int(id_col), int(instance_col)) {
            raids.insert(id);
        }
    }
    Ok(raids)
}

fn read_pins(csv: &[u8]) -> Result<BTreeMap<u32, BossPin>, MapArtError> {
    let mut reader = csv::Reader::from_reader(csv);
    let headers = reader.headers()?.clone();
    let id_col = column(&headers, "ID")?;
    let encounter_col = column(&headers, "DungeonEncounterID")?;
    let ui_map_col = column(&headers, "UiMapID")?;
    let u_col = column(&headers, "Map_0")?;
    let v_col = column(&headers, "Map_1")?;
    // Journal encounter ID → (DungeonEncounter ID, pin), sorted by journal ID.
    let mut journal = BTreeMap::new();
    for record in reader.records() {
        let record = record?;
        let int = |col: usize| record.get(col).and_then(|v| v.parse::<u32>().ok());
        let float = |col: usize| record.get(col).and_then(|v| v.parse::<f32>().ok());
        if let (Some(id), Some(encounter), Some(ui_map_id), Some(u), Some(v)) = (
            int(id_col),
            int(encounter_col),
            int(ui_map_col),
            float(u_col),
            float(v_col),
        ) && encounter != 0
            && ui_map_id != 0
        {
            journal.insert(id, (encounter, BossPin { ui_map_id, u, v }));
        }
    }
    let mut pins = BTreeMap::new();
    for (encounter, pin) in journal.into_values() {
        pins.entry(encounter).or_insert(pin);
    }
    Ok(pins)
}

fn column(headers: &csv::StringRecord, name: &'static str) -> Result<usize, MapArtError> {
    headers
        .iter()
        .position(|header| header == name)
        .ok_or(MapArtError::MissingColumn(name))
}
