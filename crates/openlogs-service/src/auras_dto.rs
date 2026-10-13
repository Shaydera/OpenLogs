use std::collections::BTreeMap;

use openlogs_analysis::{ActorId, AuraRow, AuraScope, Fight, ReportFilter, SpellId};
use serde::{Deserialize, Serialize};

use crate::overview_dto::{PlayerRef, SpellRef};
use crate::refs::Refs;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuraScopeDto {
    BuffsOnPlayers,
    DebuffsOnPlayers,
    DebuffsOnEnemies,
}

impl AuraScopeDto {
    pub fn to_scope(self) -> AuraScope {
        match self {
            AuraScopeDto::BuffsOnPlayers => AuraScope::BuffsOnPlayers,
            AuraScopeDto::DebuffsOnPlayers => AuraScope::DebuffsOnPlayers,
            AuraScopeDto::DebuffsOnEnemies => AuraScope::DebuffsOnEnemies,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuraTargetDto {
    pub name: String,
    pub player: Option<ActorId>,
    pub uptime: f64,
    pub intervals: Vec<[i32; 2]>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuraRowDto {
    pub spell_id: SpellId,
    /// Every spell ID of the row's name, `spell_id` first.
    pub spell_ids: Vec<SpellId>,
    /// The players who applied it (in `roster`), most applications first: one source colours
    /// the uptime bar in its class colour.
    pub sources: Vec<ActorId>,
    pub applications: u32,
    pub uptime: f64,
    pub targets: Vec<AuraTargetDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AurasReportDto {
    pub start_ms: i32,
    pub end_ms: i32,
    pub rows: Vec<AuraRowDto>,
    pub roster: Vec<PlayerRef>,
    pub spells: BTreeMap<SpellId, SpellRef>,
}

pub fn auras_report_dto(fight: &Fight, filter: &ReportFilter, rows: &[AuraRow]) -> AurasReportDto {
    let (start_ms, end_ms) = filter.clipped(fight);
    let mut refs = Refs::default();
    let rows = rows
        .iter()
        .map(|row| AuraRowDto {
            spell_id: refs.spell(fight, row.spell),
            spell_ids: row.spells.iter().map(|&s| refs.spell(fight, s)).collect(),
            sources: row.sources.iter().map(|&p| refs.player(p)).collect(),
            applications: row.applications,
            uptime: row.uptime,
            targets: row
                .targets
                .iter()
                .map(|t| AuraTargetDto {
                    name: t.name.clone(),
                    player: t.player.map(|p| refs.player(p)),
                    uptime: t.uptime,
                    intervals: t.intervals.iter().map(|&(a, b)| [a, b]).collect(),
                })
                .collect(),
        })
        .collect();
    let (roster, spells) = refs.finish(fight);
    AurasReportDto {
        start_ms,
        end_ms,
        rows,
        roster,
        spells,
    }
}
