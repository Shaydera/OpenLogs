use std::collections::HashMap;
use std::fmt::Write;

use thiserror::Error;

use crate::icon_name::{icon_name_from_file, is_valid_icon_name};

#[derive(Debug, Error)]
pub enum SpellIconError {
    #[error("CSV error: {0}")]
    Csv(#[from] csv::Error),
    #[error("CSV is missing the column {0}")]
    MissingColumn(&'static str),
    #[error("line {0} of the spell icon table is malformed")]
    Malformed(usize),
}

/// Spell ID → zamimg icon name.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SpellIconTable {
    icons: HashMap<u32, String>,
}

impl SpellIconTable {
    /// Builds the table from wago.tools `SpellMisc` and `ManifestInterfaceData` CSV exports.
    pub fn from_csv(spell_misc: &[u8], manifest: &[u8]) -> Result<Self, SpellIconError> {
        let icon_files = read_icon_files(manifest)?;

        let mut reader = csv::Reader::from_reader(spell_misc);
        let headers = reader.headers()?.clone();
        let spell_col = column(&headers, "SpellID")?;
        let icon_col = column(&headers, "SpellIconFileDataID")?;
        let difficulty_col = column(&headers, "DifficultyID")?;

        // Spell → (is default difficulty, file data ID); the default-difficulty row wins.
        let mut chosen: HashMap<u32, (bool, u32)> = HashMap::new();
        for record in reader.records() {
            let record = record?;
            let parse = |col: usize| record.get(col).and_then(|v| v.parse::<u32>().ok());
            let (Some(spell), Some(file_id)) = (parse(spell_col), parse(icon_col)) else {
                continue;
            };
            if file_id == 0 {
                continue;
            }
            let is_default = parse(difficulty_col) == Some(0);
            match chosen.get(&spell) {
                Some(&(true, _)) => {}
                Some(&(false, _)) if !is_default => {}
                _ => {
                    chosen.insert(spell, (is_default, file_id));
                }
            }
        }

        let icons = chosen
            .into_iter()
            .map(|(spell, (_, file_id))| {
                let name = icon_files
                    .get(&file_id)
                    .cloned()
                    .unwrap_or_else(|| file_id.to_string());
                (spell, name)
            })
            .collect();
        Ok(Self { icons })
    }

    pub fn icon(&self, spell_id: u32) -> Option<&str> {
        self.icons.get(&spell_id).map(String::as_str)
    }

    pub fn len(&self) -> usize {
        self.icons.len()
    }

    pub fn is_empty(&self) -> bool {
        self.icons.is_empty()
    }

    /// `spell_id<TAB>icon` lines, sorted by spell ID.
    pub fn to_tsv(&self) -> String {
        let mut entries: Vec<_> = self.icons.iter().collect();
        entries.sort_unstable_by_key(|(id, _)| **id);
        let mut out = String::with_capacity(entries.len() * 32);
        for (id, name) in entries {
            let _ = writeln!(out, "{id}\t{name}");
        }
        out
    }

    /// Parses [`Self::to_tsv`] output; lines starting with `#` are comments.
    pub fn from_tsv(text: &str) -> Result<Self, SpellIconError> {
        let mut icons = HashMap::new();
        for (index, line) in text.lines().enumerate() {
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let entry = line
                .split_once('\t')
                .and_then(|(id, name)| Some((id.parse::<u32>().ok()?, name)))
                .filter(|(_, name)| is_valid_icon_name(name));
            let Some((id, name)) = entry else {
                return Err(SpellIconError::Malformed(index + 1));
            };
            icons.insert(id, name.to_string());
        }
        Ok(Self { icons })
    }
}

/// File data ID → icon name for every file under `Interface\ICONS\` with a usable name.
fn read_icon_files(manifest: &[u8]) -> Result<HashMap<u32, String>, SpellIconError> {
    let mut reader = csv::Reader::from_reader(manifest);
    let headers = reader.headers()?.clone();
    let id_col = column(&headers, "ID")?;
    let path_col = column(&headers, "FilePath")?;
    let name_col = column(&headers, "FileName")?;
    let mut files = HashMap::new();
    for record in reader.records() {
        let record = record?;
        let is_icon = record
            .get(path_col)
            .is_some_and(|path| path.eq_ignore_ascii_case("Interface\\ICONS\\"));
        let id = record.get(id_col).and_then(|v| v.parse::<u32>().ok());
        if let (true, Some(id), Some(file)) = (is_icon, id, record.get(name_col)) {
            let name = icon_name_from_file(file);
            if is_valid_icon_name(&name) {
                files.insert(id, name);
            }
        }
    }
    Ok(files)
}

fn column(headers: &csv::StringRecord, name: &'static str) -> Result<usize, SpellIconError> {
    headers
        .iter()
        .position(|header| header == name)
        .ok_or(SpellIconError::MissingColumn(name))
}
