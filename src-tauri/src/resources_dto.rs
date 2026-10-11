use std::collections::BTreeMap;

use openlogs_analysis::{ActorId, Fight, ResourcesReport, SpellId};
use serde::Serialize;

use crate::overview_dto::{PlayerRef, SpellRef};
use crate::refs::Refs;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GainDto {
    pub spell_id: SpellId,
    pub gained: f64,
    pub wasted: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerTrackDto {
    pub power_type: i32,
    pub series: Vec<Option<f32>>,
    pub avg_pct: Option<f32>,
    pub min_pct: Option<f32>,
    pub capped_ms: u32,
    pub gained: f64,
    pub wasted: f64,
    pub gains: Vec<GainDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerResourcesDto {
    pub player: ActorId,
    pub tracks: Vec<PowerTrackDto>,
    pub dead: Vec<[i32; 2]>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourcesReportDto {
    pub start_ms: i32,
    pub end_ms: i32,
    pub step_ms: u32,
    pub players: Vec<PlayerResourcesDto>,
    pub roster: Vec<PlayerRef>,
    pub spells: BTreeMap<SpellId, SpellRef>,
}

pub fn resources_report_dto(fight: &Fight, report: &ResourcesReport) -> ResourcesReportDto {
    let mut refs = Refs::default();
    let players = report
        .players
        .iter()
        .map(|p| PlayerResourcesDto {
            player: refs.player(p.player),
            tracks: p
                .tracks
                .iter()
                .map(|t| PowerTrackDto {
                    power_type: t.power_type,
                    series: t.series.clone(),
                    avg_pct: t.avg_pct,
                    min_pct: t.min_pct,
                    capped_ms: t.capped_ms,
                    gained: t.gained,
                    wasted: t.wasted,
                    gains: t
                        .gains
                        .iter()
                        .map(|&(spell, gained, wasted)| GainDto {
                            spell_id: refs.spell(fight, spell),
                            gained,
                            wasted,
                        })
                        .collect(),
                })
                .collect(),
            dead: p.dead.iter().map(|&(a, b)| [a, b]).collect(),
        })
        .collect();
    let (roster, spells) = refs.finish(fight);
    ResourcesReportDto {
        start_ms: report.start_ms,
        end_ms: report.end_ms,
        step_ms: report.step_ms,
        players,
        roster,
        spells,
    }
}
