use std::collections::BTreeMap;

use openlogs_analysis::{ActorId, CastsReport, Fight, SpellId};
use serde::Serialize;

use crate::overview_dto::{PlayerRef, SpellRef, player_ref};
use crate::player_dto::AbilityLinkDto;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellCastsDto {
    pub spell_id: SpellId,
    pub casts: u32,
    /// The first cast in the range (ms from the pull); equal counts are ordered by it.
    pub first_cast_ms: i32,
    pub proc_trigger: bool,
    pub uptime: Option<f64>,
    /// The ability page with this spell's hits; `None` when it has none.
    pub link: Option<AbilityLinkDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerCastsDto {
    pub player: ActorId,
    pub spells: Vec<SpellCastsDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CastsReportDto {
    pub duration_ms: u64,
    pub players: Vec<PlayerCastsDto>,
    pub roster: Vec<PlayerRef>,
    pub spells: BTreeMap<SpellId, SpellRef>,
}

pub fn casts_report_dto(fight: &Fight, report: &CastsReport) -> CastsReportDto {
    let mut spells = BTreeMap::new();
    let players = report
        .players
        .iter()
        .map(|p| PlayerCastsDto {
            player: p.player,
            spells: p
                .spells
                .iter()
                .map(|s| {
                    if let Some(info) = fight.spells.get(&s.spell) {
                        spells.entry(s.spell).or_insert(SpellRef {
                            name: info.name.clone(),
                        });
                    }
                    SpellCastsDto {
                        spell_id: s.spell,
                        casts: s.casts,
                        first_cast_ms: s.first_cast_ms,
                        proc_trigger: s.proc_trigger,
                        uptime: s.uptime,
                        link: s.link.map(Into::into),
                    }
                })
                .collect(),
        })
        .collect();
    CastsReportDto {
        duration_ms: report.duration_ms,
        players,
        roster: report
            .players
            .iter()
            .map(|p| player_ref(fight, p.player))
            .collect(),
        spells,
    }
}
