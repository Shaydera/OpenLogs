use openlogs_analysis::{Attribution, Fight, ReportFilter};
use openlogs_gamedata::Curated;

use crate::auras_dto::{AuraKindDto, AurasReportDto, auras_report_dto};
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
use crate::scope_dto::{
    BreakdownDto, DimensionDto, FilterOptionDto, ScopeDto, ScopeMetricDto, breakdown_dto,
    option_dto,
};
use crate::views_dto::{
    EventsPageDto, PageDto, TimelineDto, ViewOptionsDto, WindowDto, events_page_dto, timeline_dto,
};

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
    scope: ScopeDto,
) -> Result<PlayerDetailDto, String> {
    let detail = openlogs_analysis::player_detail(
        fight,
        curated,
        player,
        metric.to_metric(),
        &filter.to_filter(),
        &scope.to_scope(),
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

#[allow(clippy::too_many_arguments)]
pub fn ability_detail(
    fight: &Fight,
    curated: &Curated,
    player: u32,
    spell: u32,
    pet: Option<&str>,
    metric: MetricDto,
    filter: FilterDto,
    scope: ScopeDto,
) -> Result<AbilityDetailDto, String> {
    let detail = openlogs_analysis::ability_detail(
        fight,
        curated,
        player,
        spell,
        pet,
        metric.to_metric(),
        &filter.to_filter(),
        &scope.to_scope(),
    )
    .ok_or_else(|| format!("Actor {player} is not a player of this pull"))?;
    Ok(ability_detail_dto(fight, &detail, metric))
}

/// An empty `name` opens the enemy that took the most damage.
pub fn target_detail(
    fight: &Fight,
    name: String,
    filter: FilterDto,
    scope: ScopeDto,
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
    let detail = openlogs_analysis::target_detail(fight, &name, &filter, &scope.to_scope())
        .ok_or_else(|| format!("No enemy named {name} in this pull"))?;
    Ok(target_detail_dto(fight, &detail, &enemies))
}

pub fn deaths(
    fight: &Fight,
    curated: &Curated,
    filter: FilterDto,
    scope: ScopeDto,
) -> DeathsReportDto {
    let report =
        openlogs_analysis::deaths_report(fight, curated, &filter.to_filter(), &scope.to_scope());
    deaths_report_dto(fight, curated, &report)
}

pub fn casts(
    fight: &Fight,
    curated: &Curated,
    filter: FilterDto,
    scope: ScopeDto,
    group: DimensionDto,
    hide_procs: bool,
) -> CastsReportDto {
    casts_report_dto(
        fight,
        &openlogs_analysis::casts_report(
            fight,
            curated,
            &filter.to_filter(),
            &scope.to_scope(),
            group.to_dimension(),
            hide_procs,
        ),
    )
}

pub fn auras(
    fight: &Fight,
    filter: FilterDto,
    scope: ScopeDto,
    kind: AuraKindDto,
    group: DimensionDto,
) -> AurasReportDto {
    let filter = filter.to_filter();
    auras_report_dto(
        fight,
        &filter,
        &openlogs_analysis::auras_report(
            fight,
            &filter,
            &scope.to_scope(),
            kind.to_aura_type(),
            group.to_dimension(),
        ),
    )
}

pub fn interrupts(
    fight: &Fight,
    filter: FilterDto,
    scope: ScopeDto,
    group: DimensionDto,
) -> InterruptsReportDto {
    interrupts_report_dto(
        fight,
        &openlogs_analysis::interrupts_report(
            fight,
            &filter.to_filter(),
            &scope.to_scope(),
            group.to_dimension(),
        ),
    )
}

pub fn resources(fight: &Fight, filter: FilterDto, scope: ScopeDto) -> ResourcesReportDto {
    resources_report_dto(
        fight,
        &openlogs_analysis::resources_report(fight, &filter.to_filter(), &scope.to_scope()),
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

pub fn breakdown_report(
    fight: &Fight,
    curated: &Curated,
    filter: FilterDto,
    scope: ScopeDto,
    metric: ScopeMetricDto,
    group: DimensionDto,
) -> BreakdownDto {
    let breakdown = openlogs_analysis::breakdown(
        fight,
        curated,
        &filter.to_filter(),
        &scope.to_scope(),
        metric.to_metric(),
        group.to_dimension(),
    );
    breakdown_dto(fight, &breakdown)
}

pub fn filter_options(
    fight: &Fight,
    curated: &Curated,
    filter: FilterDto,
    scope: ScopeDto,
    metric: ScopeMetricDto,
    dimension: DimensionDto,
) -> Vec<FilterOptionDto> {
    openlogs_analysis::filter_options(
        fight,
        curated,
        &filter.to_filter(),
        &scope.to_scope(),
        metric.to_metric(),
        dimension.to_dimension(),
    )
    .iter()
    .map(|option| option_dto(fight, option))
    .collect()
}

/// One page of the tab's events in the range.
pub fn events(
    fight: &Fight,
    curated: &Curated,
    filter: FilterDto,
    scope: ScopeDto,
    metric: ScopeMetricDto,
    options: ViewOptionsDto,
    page: PageDto,
) -> EventsPageDto {
    let page = openlogs_analysis::events(
        fight,
        curated,
        &filter.to_filter(),
        &scope.to_scope(),
        metric.to_metric(),
        &options.to_options(),
        page.to_page(),
    );
    events_page_dto(fight, &page)
}

/// The tab's timeline marks in `window`, in lanes by `lanes` (or its fallback).
#[allow(clippy::too_many_arguments)]
pub fn timeline(
    fight: &Fight,
    curated: &Curated,
    filter: FilterDto,
    scope: ScopeDto,
    metric: ScopeMetricDto,
    lanes: DimensionDto,
    options: ViewOptionsDto,
    window: WindowDto,
) -> TimelineDto {
    let timeline = openlogs_analysis::timeline(
        fight,
        curated,
        &filter.to_filter(),
        &scope.to_scope(),
        metric.to_metric(),
        lanes.to_dimension(),
        &options.to_options(),
        window.to_window(),
    );
    timeline_dto(fight, &timeline)
}
