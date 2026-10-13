use openlogs_analysis::{Attribution, Fight, ReportFilter};
use openlogs_gamedata::Curated;

use crate::auras_dto::{AuraScopeDto, AurasReportDto, auras_report_dto};
use crate::casts_dto::{CastsReportDto, casts_report_dto};
use crate::compare_dto::{PullComparisonDto, pull_comparison_dto};
use crate::detail_dto::{AbilityDetailDto, TargetDetailDto, ability_detail_dto, target_detail_dto};
use crate::interrupts_dto::{InterruptsReportDto, interrupts_report_dto};
use crate::overview_dto::{QuickOverviewDto, quick_overview_dto};
use crate::player_dto::{MetricDto, PlayerDetailDto, player_detail_dto};
use crate::recap_dto::{DeathsReportDto, deaths_report_dto};
use crate::report_dto::{
    AttributionDto, DamageReportDto, DamageTakenReportDto, FilterDto, HealingReportDto,
    damage_report_dto, healing_report_dto, taken_report_dto,
};
use crate::resources_dto::{ResourcesReportDto, resources_report_dto};

/// The overview of a pull; without a filter, of the whole pull.
pub fn quick_overview(
    fight: &Fight,
    curated: &Curated,
    filter: Option<FilterDto>,
) -> QuickOverviewDto {
    let filter = filter.map_or_else(
        || ReportFilter::whole(Attribution::Augmented),
        FilterDto::to_filter,
    );
    let overview = openlogs_analysis::quick_overview_in(fight, curated, &filter);
    quick_overview_dto(fight, curated, &overview)
}

pub fn damage_done(fight: &Fight, filter: FilterDto) -> DamageReportDto {
    damage_report_dto(
        fight,
        &openlogs_analysis::damage_done(fight, &filter.to_filter()),
    )
}

pub fn healing(fight: &Fight, filter: FilterDto) -> HealingReportDto {
    healing_report_dto(
        fight,
        &openlogs_analysis::healing(fight, &filter.to_filter()),
    )
}

pub fn damage_taken(fight: &Fight, filter: FilterDto) -> DamageTakenReportDto {
    taken_report_dto(
        fight,
        &openlogs_analysis::damage_taken(fight, &filter.to_filter()),
    )
}

pub fn player_detail(
    fight: &Fight,
    curated: &Curated,
    player: u32,
    metric: MetricDto,
    filter: FilterDto,
) -> Result<PlayerDetailDto, String> {
    let detail = openlogs_analysis::player_detail(
        fight,
        curated,
        player,
        metric.to_metric(),
        &filter.to_filter(),
    )
    .ok_or_else(|| format!("Actor {player} is not a player of this pull"))?;
    Ok(player_detail_dto(
        fight,
        curated,
        &detail,
        metric,
        filter.attribution,
    ))
}

pub fn ability_detail(
    fight: &Fight,
    curated: &Curated,
    player: u32,
    spell: u32,
    pet: Option<&str>,
    metric: MetricDto,
    filter: FilterDto,
) -> Result<AbilityDetailDto, String> {
    let detail = openlogs_analysis::ability_detail(
        fight,
        curated,
        player,
        spell,
        pet,
        metric.to_metric(),
        &filter.to_filter(),
    )
    .ok_or_else(|| format!("Actor {player} is not a player of this pull"))?;
    Ok(ability_detail_dto(fight, &detail, metric))
}

/// An empty `name` opens the enemy that took the most damage.
pub fn target_detail(
    fight: &Fight,
    name: String,
    filter: FilterDto,
) -> Result<TargetDetailDto, String> {
    let filter = filter.to_filter();
    let enemies = openlogs_analysis::enemy_groups(fight, &filter);
    let name = if name.is_empty() {
        enemies
            .first()
            .map(|g| g.name.clone())
            .ok_or("This pull has no enemies that took damage")?
    } else {
        name
    };
    let detail = openlogs_analysis::target_detail(fight, &name, &filter)
        .ok_or_else(|| format!("No enemy named {name} in this pull"))?;
    Ok(target_detail_dto(fight, &detail, &enemies))
}

pub fn deaths(fight: &Fight, curated: &Curated, filter: FilterDto) -> DeathsReportDto {
    let recaps = openlogs_analysis::death_recaps(fight, curated, &filter.to_filter());
    deaths_report_dto(fight, curated, &recaps)
}

pub fn casts(fight: &Fight, curated: &Curated, filter: FilterDto) -> CastsReportDto {
    casts_report_dto(
        fight,
        &openlogs_analysis::casts_report(fight, curated, &filter.to_filter()),
    )
}

pub fn auras(fight: &Fight, scope: AuraScopeDto, filter: FilterDto) -> AurasReportDto {
    let filter = filter.to_filter();
    auras_report_dto(
        fight,
        &filter,
        &openlogs_analysis::auras_report(fight, &filter, scope.to_scope()),
    )
}

pub fn interrupts(fight: &Fight, filter: FilterDto) -> InterruptsReportDto {
    interrupts_report_dto(
        fight,
        &openlogs_analysis::interrupts_report(fight, &filter.to_filter()),
    )
}

pub fn resources(fight: &Fight, filter: FilterDto) -> ResourcesReportDto {
    resources_report_dto(
        fight,
        &openlogs_analysis::resources_report(fight, &filter.to_filter()),
    )
}

/// Two pulls compared as a whole (the time range never applies).
pub fn compare_pulls(
    curated: &Curated,
    a: (u32, &Fight),
    b: (u32, &Fight),
    attribution: AttributionDto,
) -> PullComparisonDto {
    let comparison =
        openlogs_analysis::compare_pulls(a.1, b.1, curated, attribution.to_attribution());
    pull_comparison_dto(curated, a, b, &comparison)
}
