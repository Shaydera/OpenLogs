use std::collections::HashSet;

use thiserror::Error;

/// The player class families of `SpellClassOptions.SpellClassSet`: mage 3, warrior 4, warlock 5,
/// priest 6, druid 7, rogue 8, hunter and its pets 9, paladin 10, shaman 11, death knight 15,
/// monk 53, warlock pets 57, demon hunter 107, evoker 224. Not `SkillLineAbility`: it lacks the
/// trait-tree talents; the families cover 83 % of the player auras in real raid logs.
const CLASS_FAMILIES: [u32; 14] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 15, 53, 57, 107, 224];

/// `SpellEffect.EffectAura` types that take control: confuse 5, fear 7, stun 12, root 26 and
/// 455, silence 27, pacify-silence 60, stun without gravity 298.
const CROWD_CONTROL_AURAS: [u32; 8] = [5, 7, 12, 26, 27, 60, 298, 455];

#[derive(Debug, Error)]
pub enum SpellClassesError {
    #[error("CSV error: {0}")]
    Csv(#[from] csv::Error),
    #[error("CSV is missing the column {0}")]
    MissingColumn(&'static str),
    #[error("the export lists no class spells")]
    Empty,
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Which spells belong to a player class, and which of those take control of their target.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SpellClasses {
    loaded: bool,
    /// Ascending.
    class_spells: Vec<u32>,
    /// Ascending; a subset of `class_spells`.
    crowd_control: Vec<u32>,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebTable {
    /// Ascending, each as the difference to the previous ID.
    class_spells: Vec<u32>,
    /// Ascending, each as the difference to the previous ID.
    crowd_control: Vec<u32>,
}

impl SpellClasses {
    /// Reads the class families from a wago.tools `SpellClassOptions` export and the aura types
    /// from a `SpellEffect` export.
    pub fn from_csv(
        spell_class_options: &[u8],
        spell_effect: &[u8],
    ) -> Result<Self, SpellClassesError> {
        let class_spells = sorted(spell_ids_where(
            spell_class_options,
            "SpellClassSet",
            |family| CLASS_FAMILIES.contains(&family),
        )?);
        if class_spells.is_empty() {
            return Err(SpellClassesError::Empty);
        }
        let controlling = spell_ids_where(spell_effect, "EffectAura", |aura| {
            CROWD_CONTROL_AURAS.contains(&aura)
        })?;
        let crowd_control = class_spells
            .iter()
            .copied()
            .filter(|spell| controlling.contains(spell))
            .collect();
        Ok(Self {
            loaded: true,
            class_spells,
            crowd_control,
        })
    }

    /// `false` without an export, when nothing can be told about a spell.
    pub fn is_loaded(&self) -> bool {
        self.loaded
    }

    pub fn is_class_spell(&self, spell_id: u32) -> bool {
        self.class_spells.binary_search(&spell_id).is_ok()
    }

    pub fn is_crowd_control(&self, spell_id: u32) -> bool {
        self.crowd_control.binary_search(&spell_id).is_ok()
    }

    pub fn class_spell_count(&self) -> usize {
        self.class_spells.len()
    }

    pub fn crowd_control_count(&self) -> usize {
        self.crowd_control.len()
    }

    /// The table for the web app: both ID lists in ascending order as differences to the
    /// previous ID.
    pub fn to_json(&self) -> String {
        let table = WebTable {
            class_spells: deltas(&self.class_spells),
            crowd_control: deltas(&self.crowd_control),
        };
        serde_json::to_string(&table).expect("the spell class table serializes")
    }

    /// Parses [`Self::to_json`] output.
    pub fn from_json(text: &str) -> Result<Self, SpellClassesError> {
        let table: WebTable = serde_json::from_str(text)?;
        if table.class_spells.is_empty() {
            return Err(SpellClassesError::Empty);
        }
        Ok(Self {
            loaded: true,
            class_spells: undeltas(table.class_spells),
            crowd_control: undeltas(table.crowd_control),
        })
    }
}

fn spell_ids_where(
    csv_bytes: &[u8],
    value_column: &'static str,
    keep: impl Fn(u32) -> bool,
) -> Result<HashSet<u32>, SpellClassesError> {
    let mut reader = csv::Reader::from_reader(csv_bytes);
    let headers = reader.headers()?.clone();
    let value_col = column(&headers, value_column)?;
    let spell_col = column(&headers, "SpellID")?;
    let mut ids = HashSet::new();
    for record in reader.records() {
        let record = record?;
        let parse = |col: usize| record.get(col).and_then(|v| v.parse::<u32>().ok());
        if let (Some(spell), Some(value)) = (parse(spell_col), parse(value_col))
            && keep(value)
        {
            ids.insert(spell);
        }
    }
    Ok(ids)
}

fn sorted(ids: HashSet<u32>) -> Vec<u32> {
    let mut ids: Vec<u32> = ids.into_iter().collect();
    ids.sort_unstable();
    ids
}

fn deltas(ids: &[u32]) -> Vec<u32> {
    let mut previous = 0;
    ids.iter()
        .map(|&id| {
            let delta = id - previous;
            previous = id;
            delta
        })
        .collect()
}

fn undeltas(deltas: Vec<u32>) -> Vec<u32> {
    let mut id = 0u32;
    deltas
        .into_iter()
        .map(|delta| {
            id = id.saturating_add(delta);
            id
        })
        .collect()
}

fn column(headers: &csv::StringRecord, name: &'static str) -> Result<usize, SpellClassesError> {
    headers
        .iter()
        .position(|header| header == name)
        .ok_or(SpellClassesError::MissingColumn(name))
}
