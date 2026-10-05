use std::fs;
use std::io;
use std::path::Path;

use serde::Deserialize;
use serde::de::DeserializeOwned;

pub const PHASE_NAMES_FILE: &str = "phase_names.json";
/// Folder in the override directory holding one phase config per encounter.
pub const PHASES_DIR: &str = "phases";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PhaseTrigger {
    /// The pull itself (t = 0).
    Pull,
    /// An enemy starts or finishes casting this spell.
    Cast { spell_id: u32 },
    /// The boss HP (aggregated) drops below this percentage.
    BossHpBelow { percent: u32 },
    /// A unit with this name shows up in an event.
    UnitAppears { name: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PhaseRule {
    pub name: String,
    pub start: PhaseTrigger,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PhaseConfig {
    pub version: u32,
    pub encounter_id: u32,
    pub phases: Vec<PhaseRule>,
}

/// Names for the auto-detected phases of one encounter (no phase config).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PhaseNames {
    pub encounter_id: u32,
    /// The name of every detected intermission; `None` keeps "Intermission n".
    #[serde(default)]
    pub intermission: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PhaseNameList {
    pub version: u32,
    pub encounters: Vec<PhaseNames>,
}

/// Phase configs from `<override>/phases/*.json` in file-name order. Unusable files and
/// further files for an encounter that already has a config add a warning.
fn load_phase_configs(override_dir: Option<&Path>, warnings: &mut Vec<String>) -> Vec<PhaseConfig> {
    let Some(dir) = override_dir.map(|d| d.join(PHASES_DIR)) else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut files: Vec<_> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
        })
        .collect();
    files.sort();
    let mut configs: Vec<PhaseConfig> = Vec::new();
    for path in files {
        let parsed = fs::read_to_string(&path)
            .map_err(|err| err.to_string())
            .and_then(|text| {
                serde_json::from_str::<PhaseConfig>(&text).map_err(|err| err.to_string())
            });
        match parsed {
            Ok(config)
                if configs
                    .iter()
                    .any(|c| c.encounter_id == config.encounter_id) =>
            {
                warnings.push(format!(
                    "{} repeats encounter {} and was ignored",
                    path.display(),
                    config.encounter_id
                ))
            }
            Ok(config) => configs.push(config),
            Err(err) => warnings.push(format!(
                "{} is invalid and was ignored: {err}",
                path.display()
            )),
        }
    }
    configs
}

/// The curated lists: bundled with the app, each replaceable by a file of the same name
/// in an override folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Curated {
    /// Names for auto-detected phases (bundled, overridable).
    pub phase_names: PhaseNameList,
    /// The user's phase configs; none are bundled.
    pub phases: Vec<PhaseConfig>,
    /// Override files that were present but unusable; the bundled list was used instead.
    pub warnings: Vec<String>,
}

impl Curated {
    pub fn bundled() -> Self {
        Self::load(None)
    }

    pub fn load(override_dir: Option<&Path>) -> Self {
        let mut warnings = Vec::new();
        let phase_names = load_list(
            override_dir,
            PHASE_NAMES_FILE,
            include_str!("../data/phase_names.json"),
            &mut warnings,
        );
        let phases = load_phase_configs(override_dir, &mut warnings);
        Self {
            phase_names,
            phases,
            warnings,
        }
    }

    /// The user's phase config for an encounter, if any.
    pub fn phase_config(&self, encounter_id: u32) -> Option<&PhaseConfig> {
        self.phases.iter().find(|c| c.encounter_id == encounter_id)
    }

    /// The curated name of the encounter's auto-detected intermissions, if any.
    pub fn intermission_name(&self, encounter_id: u32) -> Option<&str> {
        self.phase_names
            .encounters
            .iter()
            .find(|names| names.encounter_id == encounter_id)
            .and_then(|names| names.intermission.as_deref())
    }
}

fn load_list<T: DeserializeOwned>(
    override_dir: Option<&Path>,
    file: &str,
    bundled: &str,
    warnings: &mut Vec<String>,
) -> T {
    if let Some(dir) = override_dir {
        let path = dir.join(file);
        match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str(&text) {
                Ok(list) => return list,
                Err(err) => warnings.push(format!(
                    "{} is invalid and was ignored: {err}",
                    path.display()
                )),
            },
            Err(err) if err.kind() == io::ErrorKind::NotFound => {}
            Err(err) => warnings.push(format!(
                "{} could not be read and was ignored: {err}",
                path.display()
            )),
        }
    }
    serde_json::from_str(bundled).expect("bundled curated list is valid")
}
