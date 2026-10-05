use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Tank,
    Healer,
    Damage,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ClassInfo {
    pub id: u32,
    pub name: String,
    /// Upper-case class token, e.g. `DEATHKNIGHT`.
    pub token: String,
}

impl ClassInfo {
    /// zamimg icon name, e.g. `classicon_deathknight`.
    pub fn icon(&self) -> String {
        format!("classicon_{}", self.token.to_ascii_lowercase())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SpecInfo {
    pub id: u32,
    pub class_id: u32,
    pub name: String,
    pub role: Role,
    /// zamimg icon name.
    pub icon: String,
}

#[derive(Deserialize)]
struct Table {
    classes: Vec<ClassInfo>,
    specs: Vec<SpecInfo>,
}

fn table() -> &'static Table {
    static TABLE: OnceLock<Table> = OnceLock::new();
    TABLE.get_or_init(|| {
        serde_json::from_str(include_str!("../data/classes_specs.json"))
            .expect("bundled classes_specs.json is valid")
    })
}

pub fn classes() -> &'static [ClassInfo] {
    &table().classes
}

pub fn specs() -> &'static [SpecInfo] {
    &table().specs
}

pub fn class(id: u32) -> Option<&'static ClassInfo> {
    classes().iter().find(|class| class.id == id)
}

pub fn spec(id: u32) -> Option<&'static SpecInfo> {
    specs().iter().find(|spec| spec.id == id)
}
