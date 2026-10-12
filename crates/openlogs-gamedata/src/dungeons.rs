//! Mythic+ dungeons from the wago.tools exports of `MapChallengeMode` and
//! `DungeonEncounter`: per keystone its map, name, time limits and bosses.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// `DungeonEncounter.DifficultyID` of a row that holds on every difficulty.
const ANY_DIFFICULTY: u32 = 0;
/// `DungeonEncounter.DifficultyID` of Mythic Keystone, the difficulty of M+ boss pulls.
const MYTHIC_KEYSTONE: u32 = 8;
/// Maps whose encounter rows are not the bosses a key must kill. Siege of Boralus (1822)
/// lists both faction-specific first bosses (Sergeant Bainbridge, Chopper Redhook) without
/// a faction, so a completed key kills four of its five rows.
const UNRELIABLE_BOSS_LISTS: [u32; 1] = [1822];
/// Encounters the export lists on a key map that no key has had: "Betarix Hotfixxle" (3463)
/// appeared on THE MOTHERLODE!! (map 1594), whose keys had four bosses (11.10.2026).
const IGNORED_ENCOUNTERS: [u32; 1] = [3463];

#[derive(Debug, Error)]
pub enum DungeonTableError {
    #[error("CSV error: {0}")]
    Csv(#[from] csv::Error),
    #[error("CSV is missing the column {0}")]
    MissingColumn(&'static str),
    #[error("stored dungeon table is invalid: {0}")]
    Stored(#[from] serde_json::Error),
    #[error("the export holds no dungeon with a boss list")]
    Empty,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DungeonBoss {
    pub encounter_id: u32,
    pub name: String,
}

/// One keystone dungeon (`MapChallengeMode` row).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Dungeon {
    pub challenge_mode_id: u32,
    /// Instance ID of the dungeon, as in `CHALLENGE_MODE_START`.
    pub map_id: u32,
    pub name: String,
    /// Seconds for +1, +2 and +3 (`CriteriaCount_0..2`). Only positive, strictly falling
    /// limits count; a zero or repeated limit ends the list.
    pub time_limits_s: Vec<u32>,
    /// Bosses in dungeon order (`OrderIndex`); `None` when the export cannot tell which
    /// bosses a key must kill (no rows, a map split into halves, Siege of Boralus).
    pub bosses: Option<Vec<DungeonBoss>>,
}

/// A completed key measured against its time limits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyTimer {
    /// Within the limit of +`upgrades` (1–3).
    InTime {
        upgrades: u32,
    },
    OverTime,
}

impl Dungeon {
    /// The timer result of a key completed in `total_time_ms` (from `CHALLENGE_MODE_END`,
    /// death penalties included); a time equal to a limit is within it. `None` without limits.
    pub fn timer(&self, total_time_ms: u64) -> Option<KeyTimer> {
        if self.time_limits_s.is_empty() {
            return None;
        }
        let upgrades = self
            .time_limits_s
            .iter()
            .filter(|&&limit| total_time_ms <= u64::from(limit) * 1000)
            .count() as u32;
        Some(if upgrades == 0 {
            KeyTimer::OverTime
        } else {
            KeyTimer::InTime { upgrades }
        })
    }
}

/// Challenge mode ID → [`Dungeon`].
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DungeonTable {
    dungeons: BTreeMap<u32, Dungeon>,
}

impl DungeonTable {
    /// Builds the table from the wago.tools CSV exports. Columns are found by name.
    ///
    /// A key's bosses are the `DungeonEncounter` rows of its map with `DifficultyID` 0 (every
    /// difficulty) or 8 (Mythic Keystone), ordered by `OrderIndex`; `Flags` are ignored. A map
    /// that keys of different names share (Dawn of the Infinite, Tazavesh, Mechagon,
    /// Karazhan) is split into halves the export does not tell apart: no boss list.
    pub fn from_csv(
        map_challenge_mode: &[u8],
        dungeon_encounter: &[u8],
    ) -> Result<Self, DungeonTableError> {
        let keys = read_keys(map_challenge_mode)?;
        let bosses = read_bosses(dungeon_encounter)?;
        let mut names_by_map: HashMap<u32, HashSet<&str>> = HashMap::new();
        for key in &keys {
            names_by_map
                .entry(key.map_id)
                .or_default()
                .insert(key.name.as_str());
        }
        let dungeons = keys
            .iter()
            .map(|key| {
                let split = names_by_map
                    .get(&key.map_id)
                    .is_some_and(|names| names.len() > 1);
                let reliable = !split && !UNRELIABLE_BOSS_LISTS.contains(&key.map_id);
                let bosses = bosses
                    .get(&key.map_id)
                    .filter(|list| reliable && !list.is_empty())
                    .cloned();
                let dungeon = Dungeon {
                    challenge_mode_id: key.id,
                    map_id: key.map_id,
                    name: key.name.clone(),
                    time_limits_s: time_limits(key.criteria),
                    bosses,
                };
                (key.id, dungeon)
            })
            .collect::<BTreeMap<_, _>>();
        // A headers-only or empty export would silently drop every result; keep the old one.
        if !dungeons
            .values()
            .any(|dungeon: &Dungeon| dungeon.bosses.is_some())
        {
            return Err(DungeonTableError::Empty);
        }
        Ok(Self { dungeons })
    }

    pub fn dungeon(&self, challenge_mode_id: u32) -> Option<&Dungeon> {
        self.dungeons.get(&challenge_mode_id)
    }

    pub fn len(&self) -> usize {
        self.dungeons.len()
    }

    pub fn is_empty(&self) -> bool {
        self.dungeons.is_empty()
    }

    /// The table as JSON, for the cache file.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).expect("the dungeon table serializes")
    }

    /// Parses [`Self::to_json`] output.
    pub fn from_json(text: &str) -> Result<Self, DungeonTableError> {
        Ok(serde_json::from_str(text)?)
    }
}

struct KeyRow {
    id: u32,
    map_id: u32,
    name: String,
    criteria: [u32; 3],
}

fn read_keys(csv_bytes: &[u8]) -> Result<Vec<KeyRow>, DungeonTableError> {
    let mut reader = csv::Reader::from_reader(csv_bytes);
    let headers = reader.headers()?.clone();
    let id_col = column(&headers, "ID")?;
    let map_col = column(&headers, "MapID")?;
    let name_col = column(&headers, "Name_lang")?;
    let limit_cols = [
        column(&headers, "CriteriaCount_0")?,
        column(&headers, "CriteriaCount_1")?,
        column(&headers, "CriteriaCount_2")?,
    ];
    let mut keys = Vec::new();
    for record in reader.records() {
        let record = record?;
        let number = |col: usize| record.get(col).and_then(|v| v.parse::<u32>().ok());
        let (Some(id), Some(map_id)) = (number(id_col), number(map_col)) else {
            continue;
        };
        keys.push(KeyRow {
            id,
            map_id,
            name: record.get(name_col).unwrap_or_default().to_string(),
            criteria: limit_cols.map(|col| number(col).unwrap_or(0)),
        });
    }
    Ok(keys)
}

/// Map ID → bosses in dungeon order.
fn read_bosses(csv_bytes: &[u8]) -> Result<HashMap<u32, Vec<DungeonBoss>>, DungeonTableError> {
    let mut reader = csv::Reader::from_reader(csv_bytes);
    let headers = reader.headers()?.clone();
    let id_col = column(&headers, "ID")?;
    let map_col = column(&headers, "MapID")?;
    let name_col = column(&headers, "Name_lang")?;
    let difficulty_col = column(&headers, "DifficultyID")?;
    let order_col = column(&headers, "OrderIndex")?;
    let mut rows: HashMap<u32, Vec<(i64, DungeonBoss)>> = HashMap::new();
    for record in reader.records() {
        let record = record?;
        let number = |col: usize| record.get(col).and_then(|v| v.parse::<u32>().ok());
        let (Some(encounter_id), Some(map_id), Some(difficulty)) =
            (number(id_col), number(map_col), number(difficulty_col))
        else {
            continue;
        };
        if difficulty != ANY_DIFFICULTY && difficulty != MYTHIC_KEYSTONE
            || IGNORED_ENCOUNTERS.contains(&encounter_id)
        {
            continue;
        }
        let order = record
            .get(order_col)
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0);
        let boss = DungeonBoss {
            encounter_id,
            name: record.get(name_col).unwrap_or_default().to_string(),
        };
        rows.entry(map_id).or_default().push((order, boss));
    }
    Ok(rows
        .into_iter()
        .map(|(map_id, mut list)| {
            list.sort_by_key(|(order, boss)| (*order, boss.encounter_id));
            (map_id, list.into_iter().map(|(_, boss)| boss).collect())
        })
        .collect())
}

/// `CriteriaCount_0..2` → the limits that count: positive and each below the one before; a
/// zero ends the tiers. Limits that repeat or rise are no tier ladder (Seat of the Triumvirate
/// 583 lists 1200/1200/1200 while the same dungeon's key 239 has 2040/1632/1224), so such a
/// key claims no time at all.
fn time_limits(criteria: [u32; 3]) -> Vec<u32> {
    let mut limits: Vec<u32> = Vec::new();
    for limit in criteria {
        if limit == 0 {
            break;
        }
        if limits.last().is_some_and(|&last| limit >= last) {
            return Vec::new();
        }
        limits.push(limit);
    }
    limits
}

fn column(headers: &csv::StringRecord, name: &'static str) -> Result<usize, DungeonTableError> {
    headers
        .iter()
        .position(|header| header == name)
        .ok_or(DungeonTableError::MissingColumn(name))
}
