use openlogs_analysis::{ActorId, CastsReport, CellKind, Fight, SpellId};
use serde::Serialize;

use crate::player_dto::AbilityLinkDto;
use crate::scope_dto::{AbilityRefDto, BreakdownDto, breakdown_dto};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CastExtraDto {
    pub player: ActorId,
    pub ability: AbilityRefDto,
    pub proc_trigger: bool,
    pub spell_id: SpellId,
    pub casts: u32,
    /// The first cast in the range (ms from the pull); equal counts are ordered by it.
    pub first_cast_ms: i32,
    pub uptime: Option<f64>,
    /// The ability page with this spell's hits; `None` when it has none.
    pub link: Option<AbilityLinkDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CastsReportDto {
    pub breakdown: BreakdownDto,
    pub extras: Vec<CastExtraDto>,
}

pub fn casts_report_dto(fight: &Fight, report: &CastsReport) -> CastsReportDto {
    CastsReportDto {
        breakdown: breakdown_dto(fight, &report.breakdown),
        extras: report
            .extras
            .iter()
            .map(|e| CastExtraDto {
                player: e.player,
                ability: AbilityRefDto::of(&e.ability),
                proc_trigger: e.kind == CellKind::Proc,
                spell_id: e.spell,
                casts: e.casts,
                first_cast_ms: e.first_cast_ms,
                uptime: e.uptime,
                link: e.link.map(Into::into),
            })
            .collect(),
    }
}
