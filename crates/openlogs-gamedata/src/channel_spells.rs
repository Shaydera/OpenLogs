use std::collections::HashMap;

use thiserror::Error;

/// `SPELL_ATTR1_IS_CHANNELLED` and `SPELL_ATTR1_IS_SELF_CHANNELLED` of `SpellMisc.Attributes_1`.
const CHANNEL_ATTRIBUTES: u32 = 0x4 | 0x40;

#[derive(Debug, Error)]
pub enum ChannelSpellError {
    #[error("CSV error: {0}")]
    Csv(#[from] csv::Error),
    #[error("CSV is missing the column {0}")]
    MissingColumn(&'static str),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

/// The spells the game channels, whose channel the log may not tell.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChannelSpells {
    /// Ascending.
    ids: Vec<u32>,
}

struct SpellRow {
    default_difficulty: bool,
    channelled: bool,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct WebTable {
    /// Ascending, each as the difference to the previous ID.
    ids: Vec<u32>,
}

impl ChannelSpells {
    /// Reads the channel attributes from a wago.tools `SpellMisc` export; the default
    /// difficulty's row of a spell wins.
    pub fn from_csv(spell_misc: &[u8]) -> Result<Self, ChannelSpellError> {
        let mut reader = csv::Reader::from_reader(spell_misc);
        let headers = reader.headers()?.clone();
        let spell_col = column(&headers, "SpellID")?;
        let attributes_col = column(&headers, "Attributes_1")?;
        let difficulty_col = column(&headers, "DifficultyID")?;
        let mut chosen: HashMap<u32, SpellRow> = HashMap::new();
        for record in reader.records() {
            let record = record?;
            let parse = |col: usize| record.get(col).and_then(|v| v.parse::<u32>().ok());
            // The export writes the 32 attribute bits as a signed number.
            let attributes = record
                .get(attributes_col)
                .and_then(|v| v.parse::<i32>().ok())
                .map(|bits| bits as u32);
            let (Some(spell), Some(attributes)) = (parse(spell_col), attributes) else {
                continue;
            };
            let row = SpellRow {
                default_difficulty: parse(difficulty_col) == Some(0),
                channelled: attributes & CHANNEL_ATTRIBUTES != 0,
            };
            if chosen
                .get(&spell)
                .is_none_or(|kept| row.default_difficulty && !kept.default_difficulty)
            {
                chosen.insert(spell, row);
            }
        }
        let mut ids: Vec<u32> = chosen
            .into_iter()
            .filter_map(|(spell, row)| row.channelled.then_some(spell))
            .collect();
        ids.sort_unstable();
        Ok(Self { ids })
    }

    pub fn contains(&self, spell_id: u32) -> bool {
        self.ids.binary_search(&spell_id).is_ok()
    }

    pub fn len(&self) -> usize {
        self.ids.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    /// The table for the web app: the IDs in ascending order as differences to the previous ID.
    pub fn to_json(&self) -> String {
        let mut previous = 0;
        let ids = self
            .ids
            .iter()
            .map(|&id| {
                let delta = id - previous;
                previous = id;
                delta
            })
            .collect();
        serde_json::to_string(&WebTable { ids }).expect("the channel table serializes")
    }

    /// Parses [`Self::to_json`] output.
    pub fn from_json(text: &str) -> Result<Self, ChannelSpellError> {
        let table: WebTable = serde_json::from_str(text)?;
        let mut id = 0u32;
        let ids = table
            .ids
            .into_iter()
            .map(|delta| {
                id = id.saturating_add(delta);
                id
            })
            .collect();
        Ok(Self { ids })
    }
}

fn column(headers: &csv::StringRecord, name: &'static str) -> Result<usize, ChannelSpellError> {
    headers
        .iter()
        .position(|header| header == name)
        .ok_or(ChannelSpellError::MissingColumn(name))
}
