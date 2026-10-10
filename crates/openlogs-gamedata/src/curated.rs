use std::fs;
use std::io;
use std::path::Path;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::specs::spec;

pub const CONSUMABLES_FILE: &str = "consumables.json";
pub const MAJOR_CDS_FILE: &str = "major_cds.json";
pub const DEFENSIVES_FILE: &str = "personal_defensives.json";
pub const PROCS_FILE: &str = "procs.json";
pub const PHASE_NAMES_FILE: &str = "phase_names.json";
pub const PLAYER_COOLDOWNS_FILE: &str = "player_cooldowns.json";
/// Folder in the override directory holding one phase config per encounter.
pub const PHASES_DIR: &str = "phases";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ProcSpell {
    pub spell_id: u32,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ProcList {
    pub version: u32,
    pub procs: Vec<ProcSpell>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConsumableKind {
    CombatPotion,
    HealthPotion,
    Healthstone,
    /// Shares the potion cooldown: it blocks the health potion but is no defensive itself.
    ManaPotion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CooldownCategory {
    Offensive,
    RaidDefensive,
    Bloodlust,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Consumable {
    pub spell_id: u32,
    pub name: String,
    pub kind: ConsumableKind,
}

/// Fallback for consumables of a newer tier whose spell IDs are not in the list yet.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct NamePattern {
    pub contains: String,
    pub kind: ConsumableKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ConsumableList {
    pub version: u32,
    /// Cooldown of each potion kind; health and combat potions do not block each other (12.x logs).
    pub potion_cooldown_s: u32,
    pub healthstone_cooldown_s: u32,
    pub consumables: Vec<Consumable>,
    pub name_patterns: Vec<NamePattern>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct CooldownSpell {
    pub spell_id: u32,
    pub name: String,
    pub class_id: u32,
    /// Spec IDs this entry applies to; empty means every spec of the class.
    #[serde(default)]
    pub specs: Vec<u32>,
    pub category: CooldownCategory,
    /// Length of the effect shown as a bar; 0 for instant effects.
    pub duration_s: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct CooldownList {
    pub version: u32,
    pub cooldowns: Vec<CooldownSpell>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PersonalDefensive {
    pub spell_id: u32,
    pub name: String,
    pub class_id: u32,
    #[serde(default)]
    pub specs: Vec<u32>,
    /// Untalented cooldown; talents usually shorten it.
    pub cooldown_s: u32,
    /// Every player of the class/spec has it; otherwise it counts once used in the pull.
    pub baseline: bool,
    /// An absorb shield cast on cooldown (Prismatic Barrier): while its cooldown runs after a
    /// cast it was spent, not held back. The death recap lists it; the Overview leaves it out.
    #[serde(default)]
    pub shield: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct DefensiveList {
    pub version: u32,
    pub defensives: Vec<PersonalDefensive>,
}

/// What an entry of the player-page catalogue adds to the player page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlayerCooldownKind {
    /// A rotational cooldown: a cast row after the major cooldowns.
    Rotation,
    /// A short absorb shield: a cast row among the defensives and a buff row with its uptime.
    Shield,
    /// A key proc: a buff row (the entry's ID is the buff's).
    Proc,
    /// A movement or utility spell (Hover, Charge, …) that never stands for the rotation of a spec
    /// without rotation entries; no row of its own.
    Utility,
    /// A tank's active mitigation or defensive buff (Bone Shield, Ironfur): a buff row with its
    /// uptime (the entry's ID is the buff's); a cast row only as a personal defensive.
    Defensive,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PlayerCooldown {
    pub spell_id: u32,
    pub name: String,
    pub class_id: u32,
    /// Spec IDs this entry applies to; empty means every spec of the class.
    #[serde(default)]
    pub specs: Vec<u32>,
    pub kind: PlayerCooldownKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PlayerCooldownList {
    pub version: u32,
    pub spells: Vec<PlayerCooldown>,
}

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
    pub consumables: ConsumableList,
    pub cooldowns: CooldownList,
    pub defensives: DefensiveList,
    pub procs: ProcList,
    /// Rotational cooldowns, shields and key procs of the player page (bundled, overridable).
    pub player_cooldowns: PlayerCooldownList,
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
        let consumables = load_list(
            override_dir,
            CONSUMABLES_FILE,
            include_str!("../data/consumables.json"),
            &mut warnings,
        );
        let cooldowns = load_list(
            override_dir,
            MAJOR_CDS_FILE,
            include_str!("../data/major_cds.json"),
            &mut warnings,
        );
        let defensives = load_list(
            override_dir,
            DEFENSIVES_FILE,
            include_str!("../data/personal_defensives.json"),
            &mut warnings,
        );
        let procs = load_list(
            override_dir,
            PROCS_FILE,
            include_str!("../data/procs.json"),
            &mut warnings,
        );
        let player_cooldowns = load_list(
            override_dir,
            PLAYER_COOLDOWNS_FILE,
            include_str!("../data/player_cooldowns.json"),
            &mut warnings,
        );
        let phase_names = load_list(
            override_dir,
            PHASE_NAMES_FILE,
            include_str!("../data/phase_names.json"),
            &mut warnings,
        );
        let phases = load_phase_configs(override_dir, &mut warnings);
        Self {
            consumables,
            cooldowns,
            defensives,
            procs,
            player_cooldowns,
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

    pub fn consumable_kind(&self, spell_id: u32, spell_name: &str) -> Option<ConsumableKind> {
        let list = &self.consumables;
        list.consumables
            .iter()
            .find(|item| item.spell_id == spell_id)
            .map(|item| item.kind)
            .or_else(|| {
                list.name_patterns
                    .iter()
                    .find(|pattern| spell_name.contains(&pattern.contains))
                    .map(|pattern| pattern.kind)
            })
    }

    /// The cooldown entry for `spell_id` cast by a player of `spec_id`. An entry for the
    /// caster's spec wins over a class-wide one; entries of other classes never match.
    pub fn cooldown(&self, spell_id: u32, spec_id: Option<u32>) -> Option<&CooldownSpell> {
        let class_id = spec_id.and_then(spec).map(|spec| spec.class_id);
        let mut class_wide = None;
        for entry in self
            .cooldowns
            .cooldowns
            .iter()
            .filter(|entry| entry.spell_id == spell_id)
        {
            if spec_id.is_some_and(|id| entry.specs.contains(&id)) {
                return Some(entry);
            }
            if entry.specs.is_empty() && class_id.is_none_or(|id| id == entry.class_id) {
                class_wide = class_wide.or(Some(entry));
            }
        }
        class_wide
    }

    /// The cooldown entry named `name` for a player of `spec_id`: a cooldown's buff often has
    /// another ID than its cast (Arcane Surge casts as 365350 and buffs as 365362).
    pub fn cooldown_named(&self, name: &str, spec_id: Option<u32>) -> Option<&CooldownSpell> {
        self.cooldowns
            .cooldowns
            .iter()
            .filter(|entry| entry.name == name)
            .find_map(|entry| self.cooldown(entry.spell_id, spec_id))
    }

    /// Whether the player-page catalogue has rotation entries for `spec_id`; specs without any
    /// (also those with only a shield, proc or utility entry) get the fallback rows (most-cast
    /// spells as rotation).
    pub fn has_rotation_entries(&self, spec_id: u32) -> bool {
        spec(spec_id).is_some_and(|spec| {
            self.player_cooldowns.spells.iter().any(|entry| {
                entry.kind == PlayerCooldownKind::Rotation
                    && entry.class_id == spec.class_id
                    && (entry.specs.is_empty() || entry.specs.contains(&spec_id))
            })
        })
    }

    /// The player-page catalogue entry for `spell_id` cast or worn by a player of `spec_id`.
    pub fn player_cooldown(&self, spell_id: u32, spec_id: u32) -> Option<&PlayerCooldown> {
        let class_id = spec(spec_id)?.class_id;
        self.player_cooldowns.spells.iter().find(|entry| {
            entry.spell_id == spell_id
                && entry.class_id == class_id
                && (entry.specs.is_empty() || entry.specs.contains(&spec_id))
        })
    }

    pub fn defensives_for(&self, spec_id: u32) -> Vec<&PersonalDefensive> {
        let Some(class_id) = spec(spec_id).map(|spec| spec.class_id) else {
            return Vec::new();
        };
        self.defensives
            .defensives
            .iter()
            .filter(|def| {
                def.class_id == class_id && (def.specs.is_empty() || def.specs.contains(&spec_id))
            })
            .collect()
    }

    /// A cast that is a proc or passive trigger, not a player action.
    pub fn is_proc(&self, spell_id: u32) -> bool {
        self.procs.procs.iter().any(|p| p.spell_id == spell_id)
    }

    pub fn defensive(&self, spell_id: u32, spec_id: u32) -> Option<&PersonalDefensive> {
        self.defensives_for(spec_id)
            .into_iter()
            .find(|def| def.spell_id == spell_id)
    }

    /// Whether a personal defensive of any class or spec is an absorb shield.
    pub fn is_shield(&self, spell_id: u32) -> bool {
        self.defensives
            .defensives
            .iter()
            .any(|def| def.spell_id == spell_id && def.shield)
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
