use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use openlogs_gamedata::{Curated, DungeonTable, HttpFetch};
use openlogs_index::{CacheStatus, load_or_build};
use tauri::{AppHandle, Manager};

use crate::auras_dto::{AuraScopeDto, AurasReportDto, auras_report_dto};
use crate::casts_dto::{CastsReportDto, casts_report_dto};
use crate::compare_dto::{PullComparisonDto, pull_comparison_dto};
use crate::detail_dto::{AbilityDetailDto, TargetDetailDto, ability_detail_dto, target_detail_dto};
use crate::dto::{GameDataStatusDto, LogView, RecentLog, log_view, recent_log};
use crate::fight_cache::FightCache;
use crate::interrupts_dto::{InterruptsReportDto, interrupts_report_dto};
use crate::overview_dto::{QuickOverviewDto, quick_overview_dto};
use crate::player_dto::{MetricDto, PlayerDetailDto, player_detail_dto};
use crate::recap_dto::{DeathsReportDto, deaths_report_dto};
use crate::recent::{RecentEntry, RecentLogs};
use crate::report_dto::{
    AttributionDto, DamageReportDto, DamageTakenReportDto, FilterDto, HealingReportDto,
    damage_report_dto, healing_report_dto, taken_report_dto,
};
use crate::resources_dto::{ResourcesReportDto, resources_report_dto};
use crate::state::{AppState, index_cache_dir, now_unix_s};

/// Indexes (or loads from cache) the log at `path`. Returns the view and, for real combat
/// logs, the entry to remember in the recent list. `dungeons` decides run results when it
/// knows the key.
pub fn index_log(
    path: &Path,
    data_dir: &Path,
    dungeons: Option<&DungeonTable>,
) -> Result<(LogView, Option<RecentEntry>), String> {
    // One spelling per file: the recent list, `LogView.path` and the fight cache key on it.
    let path = &crate::recent::canonical_path(path);
    if path.is_dir() {
        return Err(format!(
            "{} is a folder. Open a WoWCombatLog*.txt file instead.",
            path.display()
        ));
    }
    let (index, status) =
        load_or_build(path, &index_cache_dir(data_dir)).map_err(|err| describe(path, &err))?;
    let size_bytes = std::fs::metadata(path)
        .map_err(|err| describe(path, &err))?
        .len();
    let path_text = path.display().to_string();
    let file_name = path.file_name().map_or_else(
        || path_text.clone(),
        |name| name.to_string_lossy().into_owned(),
    );
    let view = log_view(
        &path_text,
        &file_name,
        size_bytes,
        status == CacheStatus::Hit,
        &index,
        dungeons,
    );
    let entry = index.log_version.map(|_| RecentEntry {
        path: path_text,
        file_name,
        size_bytes,
        zone: view.zone.clone(),
        start_unix_ms: view.start_unix_ms,
        // A run is no pull; its boss pulls are.
        pull_count: view
            .fights
            .iter()
            .filter(|fight| fight.run.is_none())
            .count() as u32,
        opened_at_unix_ms: now_unix_ms(),
    });
    Ok((view, entry))
}

/// Appends the curated-list warnings, so override problems show up in the app.
pub fn with_curated_warnings(mut view: LogView, curated: &Curated) -> LogView {
    view.warnings.extend(
        curated
            .warnings
            .iter()
            .map(|w| format!("Curated lists: {w}")),
    );
    view
}

/// The overview of pull `fight_index`.
pub fn quick_overview_at(
    cache: &FightCache,
    curated: &Curated,
    path: &Path,
    data_dir: &Path,
    fight_index: u32,
    filter: Option<FilterDto>,
) -> Result<QuickOverviewDto, String> {
    let (_, fight) = cache.get(path, data_dir, fight_index)?;
    let filter = filter.map_or_else(
        || openlogs_analysis::ReportFilter::whole(openlogs_analysis::Attribution::Augmented),
        FilterDto::to_filter,
    );
    let overview = openlogs_analysis::quick_overview_in(&fight, curated, &filter);
    Ok(quick_overview_dto(&fight, curated, &overview))
}

pub fn damage_report_at(
    cache: &FightCache,
    path: &Path,
    data_dir: &Path,
    fight_index: u32,
    filter: FilterDto,
) -> Result<DamageReportDto, String> {
    let (_, fight) = cache.get(path, data_dir, fight_index)?;
    Ok(damage_report_dto(
        &fight,
        &openlogs_analysis::damage_done(&fight, &filter.to_filter()),
    ))
}

pub fn healing_report_at(
    cache: &FightCache,
    path: &Path,
    data_dir: &Path,
    fight_index: u32,
    filter: FilterDto,
) -> Result<HealingReportDto, String> {
    let (_, fight) = cache.get(path, data_dir, fight_index)?;
    Ok(healing_report_dto(
        &fight,
        &openlogs_analysis::healing(&fight, &filter.to_filter()),
    ))
}

pub fn taken_report_at(
    cache: &FightCache,
    path: &Path,
    data_dir: &Path,
    fight_index: u32,
    filter: FilterDto,
) -> Result<DamageTakenReportDto, String> {
    let (_, fight) = cache.get(path, data_dir, fight_index)?;
    Ok(taken_report_dto(
        &fight,
        &openlogs_analysis::damage_taken(&fight, &filter.to_filter()),
    ))
}

#[allow(clippy::too_many_arguments)]
pub fn player_detail_at(
    cache: &FightCache,
    curated: &Curated,
    path: &Path,
    data_dir: &Path,
    fight_index: u32,
    player: u32,
    metric: MetricDto,
    filter: FilterDto,
) -> Result<PlayerDetailDto, String> {
    let (_, fight) = cache.get(path, data_dir, fight_index)?;
    let detail = openlogs_analysis::player_detail(
        &fight,
        curated,
        player,
        metric.to_metric(),
        &filter.to_filter(),
    )
    .ok_or_else(|| format!("Actor {player} is not a player of this pull"))?;
    Ok(player_detail_dto(
        &fight,
        curated,
        &detail,
        metric,
        filter.attribution,
    ))
}

#[tauri::command]
pub async fn player_detail(
    path: String,
    fight_index: u32,
    player: u32,
    metric: MetricDto,
    filter: FilterDto,
    app: AppHandle,
) -> Result<PlayerDetailDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        player_detail_at(
            &state.fight_cache,
            &state.curated,
            &PathBuf::from(&path),
            &state.data_dir,
            fight_index,
            player,
            metric,
            filter,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[allow(clippy::too_many_arguments)]
pub fn ability_detail_at(
    cache: &FightCache,
    curated: &Curated,
    path: &Path,
    data_dir: &Path,
    fight_index: u32,
    player: u32,
    spell: u32,
    pet: Option<String>,
    metric: MetricDto,
    filter: FilterDto,
) -> Result<AbilityDetailDto, String> {
    let (_, fight) = cache.get(path, data_dir, fight_index)?;
    let detail = openlogs_analysis::ability_detail(
        &fight,
        curated,
        player,
        spell,
        pet.as_deref(),
        metric.to_metric(),
        &filter.to_filter(),
    )
    .ok_or_else(|| format!("Actor {player} is not a player of this pull"))?;
    Ok(ability_detail_dto(&fight, &detail, metric))
}

pub fn target_detail_at(
    cache: &FightCache,
    path: &Path,
    data_dir: &Path,
    fight_index: u32,
    name: String,
    filter: FilterDto,
) -> Result<TargetDetailDto, String> {
    let (_, fight) = cache.get(path, data_dir, fight_index)?;
    let filter = filter.to_filter();
    let enemies = openlogs_analysis::enemy_groups(&fight, &filter);
    // An empty name opens the enemy that took the most damage.
    let name = if name.is_empty() {
        enemies
            .first()
            .map(|g| g.name.clone())
            .ok_or("This pull has no enemies that took damage")?
    } else {
        name
    };
    let detail = openlogs_analysis::target_detail(&fight, &name, &filter)
        .ok_or_else(|| format!("No enemy named {name} in this pull"))?;
    Ok(target_detail_dto(&fight, &detail, &enemies))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ability_detail(
    path: String,
    fight_index: u32,
    player: u32,
    spell: u32,
    pet: Option<String>,
    metric: MetricDto,
    filter: FilterDto,
    app: AppHandle,
) -> Result<AbilityDetailDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        ability_detail_at(
            &state.fight_cache,
            &state.curated,
            &PathBuf::from(&path),
            &state.data_dir,
            fight_index,
            player,
            spell,
            pet,
            metric,
            filter,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn target_detail(
    path: String,
    fight_index: u32,
    name: String,
    filter: FilterDto,
    app: AppHandle,
) -> Result<TargetDetailDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        target_detail_at(
            &state.fight_cache,
            &PathBuf::from(&path),
            &state.data_dir,
            fight_index,
            name,
            filter,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

pub fn deaths_report_at(
    cache: &FightCache,
    curated: &Curated,
    path: &Path,
    data_dir: &Path,
    fight_index: u32,
    filter: FilterDto,
) -> Result<DeathsReportDto, String> {
    let (_, fight) = cache.get(path, data_dir, fight_index)?;
    let recaps = openlogs_analysis::death_recaps(&fight, curated, &filter.to_filter());
    Ok(deaths_report_dto(&fight, curated, &recaps))
}

pub fn casts_report_at(
    cache: &FightCache,
    curated: &Curated,
    path: &Path,
    data_dir: &Path,
    fight_index: u32,
    filter: FilterDto,
) -> Result<CastsReportDto, String> {
    let (_, fight) = cache.get(path, data_dir, fight_index)?;
    Ok(casts_report_dto(
        &fight,
        &openlogs_analysis::casts_report(&fight, curated, &filter.to_filter()),
    ))
}

#[tauri::command]
pub async fn deaths_report(
    path: String,
    fight_index: u32,
    filter: FilterDto,
    app: AppHandle,
) -> Result<DeathsReportDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        deaths_report_at(
            &state.fight_cache,
            &state.curated,
            &PathBuf::from(&path),
            &state.data_dir,
            fight_index,
            filter,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn casts_report(
    path: String,
    fight_index: u32,
    filter: FilterDto,
    app: AppHandle,
) -> Result<CastsReportDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        casts_report_at(
            &state.fight_cache,
            &state.curated,
            &PathBuf::from(&path),
            &state.data_dir,
            fight_index,
            filter,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

pub fn auras_report_at(
    cache: &FightCache,
    path: &Path,
    data_dir: &Path,
    fight_index: u32,
    scope: AuraScopeDto,
    filter: FilterDto,
) -> Result<AurasReportDto, String> {
    let (_, fight) = cache.get(path, data_dir, fight_index)?;
    let filter = filter.to_filter();
    Ok(auras_report_dto(
        &fight,
        &filter,
        &openlogs_analysis::auras_report(&fight, &filter, scope.to_scope()),
    ))
}

pub fn interrupts_report_at(
    cache: &FightCache,
    path: &Path,
    data_dir: &Path,
    fight_index: u32,
    filter: FilterDto,
) -> Result<InterruptsReportDto, String> {
    let (_, fight) = cache.get(path, data_dir, fight_index)?;
    Ok(interrupts_report_dto(
        &fight,
        &openlogs_analysis::interrupts_report(&fight, &filter.to_filter()),
    ))
}

pub fn resources_report_at(
    cache: &FightCache,
    path: &Path,
    data_dir: &Path,
    fight_index: u32,
    filter: FilterDto,
) -> Result<ResourcesReportDto, String> {
    let (_, fight) = cache.get(path, data_dir, fight_index)?;
    Ok(resources_report_dto(
        &fight,
        &openlogs_analysis::resources_report(&fight, &filter.to_filter()),
    ))
}

#[tauri::command]
pub async fn auras_report(
    path: String,
    fight_index: u32,
    scope: AuraScopeDto,
    filter: FilterDto,
    app: AppHandle,
) -> Result<AurasReportDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        auras_report_at(
            &state.fight_cache,
            &PathBuf::from(&path),
            &state.data_dir,
            fight_index,
            scope,
            filter,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn interrupts_report(
    path: String,
    fight_index: u32,
    filter: FilterDto,
    app: AppHandle,
) -> Result<InterruptsReportDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        interrupts_report_at(
            &state.fight_cache,
            &PathBuf::from(&path),
            &state.data_dir,
            fight_index,
            filter,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn resources_report(
    path: String,
    fight_index: u32,
    filter: FilterDto,
    app: AppHandle,
) -> Result<ResourcesReportDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        resources_report_at(
            &state.fight_cache,
            &PathBuf::from(&path),
            &state.data_dir,
            fight_index,
            filter,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn damage_done_report(
    path: String,
    fight_index: u32,
    filter: FilterDto,
    app: AppHandle,
) -> Result<DamageReportDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        damage_report_at(
            &state.fight_cache,
            &PathBuf::from(&path),
            &state.data_dir,
            fight_index,
            filter,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn healing_report(
    path: String,
    fight_index: u32,
    filter: FilterDto,
    app: AppHandle,
) -> Result<HealingReportDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        healing_report_at(
            &state.fight_cache,
            &PathBuf::from(&path),
            &state.data_dir,
            fight_index,
            filter,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn damage_taken_report(
    path: String,
    fight_index: u32,
    filter: FilterDto,
    app: AppHandle,
) -> Result<DamageTakenReportDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        taken_report_at(
            &state.fight_cache,
            &PathBuf::from(&path),
            &state.data_dir,
            fight_index,
            filter,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

pub fn recent_view(recent: &RecentLogs) -> Vec<RecentLog> {
    recent
        .entries()
        .iter()
        .map(|entry| recent_log(entry, Path::new(&entry.path).is_file()))
        .collect()
}

#[tauri::command]
pub async fn open_log(path: String, app: AppHandle) -> Result<LogView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let dungeons = state.dungeon_table();
        let (view, entry) = index_log(Path::new(&path), &state.data_dir, dungeons.as_ref())?;
        if let Some(entry) = entry {
            let mut recent = state
                .recent
                .lock()
                .map_err(|_| "The recent list is unavailable.".to_string())?;
            recent.touch(entry);
            // Failing to persist the list must not fail opening the log.
            let _ = recent.save(&state.recent_path());
        }
        Ok(with_curated_warnings(view, &state.curated))
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn recent_logs(app: AppHandle) -> Vec<RecentLog> {
    let state = app.state::<AppState>();
    let recent = state
        .recent
        .lock()
        .map(|recent| recent.clone())
        .unwrap_or_default();
    recent_view(&recent)
}

#[tauri::command]
pub fn remove_recent(path: String, app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut recent = state
        .recent
        .lock()
        .map_err(|_| "The recent list is unavailable.".to_string())?;
    recent.remove(&path);
    recent
        .save(&state.recent_path())
        .map_err(|err| err.to_string())
}

/// The game-data tables for the Settings dialog.
#[tauri::command]
pub fn game_data_status(app: AppHandle) -> GameDataStatusDto {
    app.state::<AppState>().data_status()
}

/// "Refresh now": downloads every table again. While another sync runs (startup or an earlier
/// click), returns the current status at once; it says `refreshing`.
#[tauri::command]
pub async fn refresh_game_data(app: AppHandle) -> Result<GameDataStatusDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.sync_game_data(&HttpFetch::for_bulk_data(), now_unix_s(), true);
        state.data_status()
    })
    .await
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn quick_overview(
    path: String,
    fight_index: u32,
    filter: Option<FilterDto>,
    app: AppHandle,
) -> Result<QuickOverviewDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        quick_overview_at(
            &state.fight_cache,
            &state.curated,
            &PathBuf::from(&path),
            &state.data_dir,
            fight_index,
            filter,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Pulls `fight_a` and `fight_b` compared as a whole (the time range never applies).
pub fn compare_pulls_at(
    cache: &FightCache,
    curated: &Curated,
    path: &Path,
    data_dir: &Path,
    fight_a: u32,
    fight_b: u32,
    attribution: AttributionDto,
) -> Result<PullComparisonDto, String> {
    let (_, a) = cache.get(path, data_dir, fight_a)?;
    let (_, b) = cache.get(path, data_dir, fight_b)?;
    let comparison =
        openlogs_analysis::compare_pulls(&a, &b, curated, attribution.to_attribution());
    Ok(pull_comparison_dto(
        curated,
        (fight_a, &a),
        (fight_b, &b),
        &comparison,
    ))
}

#[tauri::command]
pub async fn compare_pulls(
    path: String,
    fight_a: u32,
    fight_b: u32,
    attribution: AttributionDto,
    app: AppHandle,
) -> Result<PullComparisonDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        compare_pulls_at(
            &state.fight_cache,
            &state.curated,
            &PathBuf::from(&path),
            &state.data_dir,
            fight_a,
            fight_b,
            attribution,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

pub fn describe(path: &Path, err: &io::Error) -> String {
    match err.kind() {
        io::ErrorKind::NotFound => format!("File not found: {}", path.display()),
        io::ErrorKind::PermissionDenied => format!("No permission to read {}", path.display()),
        _ => format!("Could not read {}: {err}", path.display()),
    }
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use std::fs::{self, OpenOptions};
    use std::io::Write;

    use openlogs_parser::Timestamp;

    use super::*;
    use crate::dto::{BossProgressDto, OutcomeDto, RunDto};

    const FIXTURE: &str = include_str!("../../crates/openlogs-index/tests/fixtures/mini_raid.txt");
    /// A synthetic +12 in the real line format.
    const MYTHIC_PLUS: &str =
        include_str!("../../crates/openlogs-index/tests/fixtures/mythic_plus.txt");
    const WHOLE_PULL: &str = r#"{ "startMs": null, "endMs": null, "attribution": "augmented" }"#;
    const FAELAN: &str = "Faelan-Emberfall-EU";

    fn log_file(dir: &Path, text: &str) -> PathBuf {
        let path = dir.join("WoWCombatLog-100726_185823.txt");
        fs::write(&path, text).unwrap();
        path
    }

    fn filter(json: &str) -> FilterDto {
        serde_json::from_str(json).unwrap()
    }

    fn assert_camel_case_keys(value: &serde_json::Value, at: &str) {
        match value {
            serde_json::Value::Object(map) => {
                for (key, child) in map {
                    assert!(!key.contains('_'), "{at}.{key}");
                    assert_camel_case_keys(child, &format!("{at}.{key}"));
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    assert_camel_case_keys(item, at);
                }
            }
            _ => {}
        }
    }

    #[test]
    fn opening_a_log_lists_its_pulls_and_reindexes_after_an_append() {
        let dir = tempfile::tempdir().unwrap();
        let path = log_file(dir.path(), FIXTURE);
        let other_spelling = dir.path().join(".").join("WoWCombatLog-100726_185823.txt");
        let (view, remember) = index_log(&other_spelling, dir.path(), None).unwrap();

        let canonical = crate::recent::canonical_path(&path)
            .to_string_lossy()
            .into_owned();
        assert_eq!(view.path, canonical);
        assert!(!view.cache_hit);
        assert_eq!(view.zone.as_deref(), Some("The Venomous Abyss"));
        assert_eq!(view.fights.len(), 3);
        let first = &view.fights[0];
        assert_eq!(
            (
                first.index,
                first.name.as_str(),
                first.outcome,
                first.difficulty_label.as_deref(),
                first.player_count,
                first.duration_ms
            ),
            (1, "Ula'tek", OutcomeDto::Wipe, Some("Heroic"), 2, 60_000)
        );
        let start = Timestamp::parse("10/7/2026 19:03:02.0762").unwrap();
        assert_eq!(first.start_unix_ms, start.0 / 1000);
        assert_eq!(view.fights[2].outcome, OutcomeDto::Incomplete);
        let entry = remember.expect("a combat log is remembered");
        assert_eq!(
            (entry.path.as_str(), entry.pull_count),
            (canonical.as_str(), 3)
        );

        assert!(index_log(&path, dir.path(), None).unwrap().0.cache_hit);
        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        write!(
            file,
            "\n10/7/2026 19:30:00.0000  ENCOUNTER_START,3492,\"Ula'tek\",15,23,3004\n\
             10/7/2026 19:31:00.0000  ENCOUNTER_END,3492,\"Ula'tek\",15,23,1,60000\n"
        )
        .unwrap();
        drop(file);
        let (view, _) = index_log(&path, dir.path(), None).unwrap();
        assert!(!view.cache_hit);
        assert_eq!(view.fights.len(), 4);
        assert_eq!(view.fights[3].outcome, OutcomeDto::Kill);
    }

    #[test]
    fn unusable_input_fails_with_a_message() {
        let dir = tempfile::tempdir().unwrap();
        let err = index_log(dir.path(), dir.path(), None).unwrap_err();
        assert!(
            err.ends_with("is a folder. Open a WoWCombatLog*.txt file instead."),
            "{err}"
        );

        let notes = dir.path().join("notes.txt");
        fs::write(&notes, "shopping list\nmilk, eggs\n").unwrap();
        let (view, remember) = index_log(&notes, dir.path(), None).unwrap();
        assert!(view.fights.is_empty() && remember.is_none());
        assert!(
            view.warnings
                .iter()
                .any(|w| w.contains("does not look like a WoW combat log"))
        );

        let path = log_file(dir.path(), FIXTURE);
        let cache = FightCache::default();
        let curated = Curated::bundled();
        let whole = filter(WHOLE_PULL);
        let missing_pull = quick_overview_at(&cache, &curated, &path, dir.path(), 9, None);
        assert_eq!(
            missing_pull.unwrap_err(),
            "Pull 9 does not exist in this log."
        );
        let compared = compare_pulls_at(
            &cache,
            &curated,
            &path,
            dir.path(),
            1,
            9,
            AttributionDto::Augmented,
        );
        assert_eq!(compared.unwrap_err(), "Pull 9 does not exist in this log.");
        let not_a_player = player_detail_at(
            &cache,
            &curated,
            &path,
            dir.path(),
            1,
            0,
            MetricDto::Damage,
            whole,
        );
        assert_eq!(
            not_a_player.unwrap_err(),
            "Actor 0 is not a player of this pull"
        );
        let nobody = target_detail_at(&cache, &path, dir.path(), 1, "Nobody".into(), whole);
        assert_eq!(nobody.unwrap_err(), "No enemy named Nobody in this pull");

        let (_, entry) = index_log(&path, dir.path(), None).unwrap();
        let mut recent = RecentLogs::default();
        recent.touch(entry.unwrap());
        assert!(recent_view(&recent)[0].exists);
        fs::remove_file(&path).unwrap();
        assert!(!recent_view(&recent)[0].exists);
        let err = index_log(&path, dir.path(), None).unwrap_err();
        assert!(err.starts_with("File not found"), "{err}");
    }

    #[test]
    fn every_report_reaches_the_ui_with_camel_case_keys() {
        let dir = tempfile::tempdir().unwrap();
        let log = log_file(dir.path(), FIXTURE);
        let (cache, curated, path, data_dir) = (
            &FightCache::default(),
            &Curated::bundled(),
            log.as_path(),
            dir.path(),
        );
        let whole = filter(WHOLE_PULL);

        let damage = damage_report_at(cache, path, data_dir, 1, whole).unwrap();
        assert_eq!(damage.total, 377_019_940, "Faelan's two Arcane Barrages");
        let faelan = damage.players[0].player;
        let reattributed = filter(&WHOLE_PULL.replace("augmented", "reattributed"));
        let player = player_detail_at(
            cache,
            curated,
            path,
            data_dir,
            1,
            faelan,
            MetricDto::Damage,
            reattributed,
        )
        .unwrap();
        assert_eq!(player.attribution, AttributionDto::Reattributed);
        let top_target = target_detail_at(cache, path, data_dir, 1, String::new(), whole).unwrap();
        assert_eq!(
            top_target.name, top_target.enemies[0].name,
            "an empty name opens the most damaged enemy"
        );
        let ability = ability_detail_at(
            cache,
            curated,
            path,
            data_dir,
            1,
            faelan,
            44425,
            None,
            MetricDto::Damage,
            whole,
        )
        .unwrap();
        let scope: AuraScopeDto = serde_json::from_str(r#""debuffs_on_enemies""#).unwrap();

        let reports = [
            (
                "overview",
                serde_json::to_value(
                    quick_overview_at(cache, curated, path, data_dir, 1, None).unwrap(),
                ),
            ),
            ("damage", serde_json::to_value(&damage)),
            (
                "healing",
                serde_json::to_value(healing_report_at(cache, path, data_dir, 1, whole).unwrap()),
            ),
            (
                "taken",
                serde_json::to_value(taken_report_at(cache, path, data_dir, 1, whole).unwrap()),
            ),
            ("player", serde_json::to_value(&player)),
            ("ability", serde_json::to_value(&ability)),
            ("target", serde_json::to_value(&top_target)),
            (
                "deaths",
                serde_json::to_value(
                    deaths_report_at(cache, curated, path, data_dir, 1, whole).unwrap(),
                ),
            ),
            (
                "casts",
                serde_json::to_value(
                    casts_report_at(cache, curated, path, data_dir, 1, whole).unwrap(),
                ),
            ),
            (
                "auras",
                serde_json::to_value(
                    auras_report_at(cache, path, data_dir, 1, scope, whole).unwrap(),
                ),
            ),
            (
                "interrupts",
                serde_json::to_value(
                    interrupts_report_at(cache, path, data_dir, 1, whole).unwrap(),
                ),
            ),
            (
                "resources",
                serde_json::to_value(resources_report_at(cache, path, data_dir, 1, whole).unwrap()),
            ),
            (
                "comparison",
                serde_json::to_value(
                    compare_pulls_at(
                        cache,
                        curated,
                        path,
                        data_dir,
                        1,
                        3,
                        AttributionDto::Augmented,
                    )
                    .unwrap(),
                ),
            ),
        ];
        for (name, json) in reports {
            assert_camel_case_keys(&json.unwrap(), name);
        }
    }

    #[test]
    fn a_range_overview_keeps_the_whole_pull_markers_and_names_their_players() {
        let dir = tempfile::tempdir().unwrap();
        // Without COMBATANT_INFO Faelan has no spec, so only his death marker can add him.
        let text: String = FIXTURE
            .lines()
            .filter(|line| !line.contains("COMBATANT_INFO,Player-4101-8E8C0182"))
            .map(|line| format!("{line}\n"))
            .collect();
        let path = log_file(dir.path(), &text);
        let first_second = filter(r#"{ "startMs": 0, "endMs": 1000, "attribution": "augmented" }"#);
        let overview = quick_overview_at(
            &FightCache::default(),
            &Curated::bundled(),
            &path,
            dir.path(),
            1,
            Some(first_second),
        )
        .unwrap();
        assert_eq!(overview.kpis.duration_ms, 1_000);
        assert_eq!(
            overview.timeline.duration_ms, 60_000,
            "the axis keeps the pull length"
        );
        assert!(overview.deaths.is_empty(), "Faelan dies after the range");
        let markers = &overview.timeline.markers.deaths;
        assert_eq!(markers.len(), 1);
        assert!(
            overview
                .players
                .iter()
                .any(|p| p.actor_id == markers[0].player && p.name == FAELAN)
        );
    }

    #[test]
    fn comparing_pulls_lists_every_player_of_either_pull() {
        let dir = tempfile::tempdir().unwrap();
        let path = log_file(dir.path(), FIXTURE);
        let comparison = compare_pulls_at(
            &FightCache::default(),
            &Curated::bundled(),
            &path,
            dir.path(),
            1,
            3,
            AttributionDto::Augmented,
        )
        .unwrap();
        assert_eq!((comparison.a.fight_index, comparison.b.fight_index), (1, 3));
        assert_eq!(
            comparison.a.overview.deaths.len(),
            1,
            "Faelan dies in the first pull"
        );

        let row = |name: &str| {
            comparison
                .players
                .iter()
                .find(|p| p.player.name == name)
                .unwrap()
        };
        let faelan = row(FAELAN);
        let in_a = faelan.a.unwrap();
        assert!((in_a.dps - 377_019_940.0 / 60.0).abs() < 1e-6);
        assert_eq!(in_a.deaths, 1);
        assert!(
            faelan.b.is_some_and(|b| b.dps > 0.0),
            "Faelan hits Ula'tek in pull 3"
        );
        let pyrrin = row("Pyrrin-Emberfall-EU");
        assert!(pyrrin.a.is_some() && pyrrin.b.is_none() && pyrrin.dps_delta.is_none());
    }

    #[test]
    fn opening_a_mythic_plus_log_lists_the_run_and_its_boss_pulls() {
        let dir = tempfile::tempdir().unwrap();
        let path = log_file(dir.path(), MYTHIC_PLUS);
        let (view, remember) = index_log(&path, dir.path(), None).unwrap();
        let rows: Vec<_> = view
            .fights
            .iter()
            .map(|f| (f.index, f.name.as_str(), f.outcome, f.run_index))
            .collect();
        assert_eq!(
            rows,
            [
                (1, "Priory of the Sacred Flame", OutcomeDto::Kill, None),
                (2, "Captain Dailcry", OutcomeDto::Kill, Some(1)),
                (3, "Baron Braunpyke", OutcomeDto::Wipe, Some(1)),
                (4, "Baron Braunpyke", OutcomeDto::Kill, Some(1)),
            ]
        );
        let run = &view.fights[0];
        assert_eq!(
            run.run,
            Some(RunDto {
                challenge_mode_id: 499,
                keystone_level: 12,
                affix_ids: vec![10, 147, 9],
                total_time_ms: Some(600_000),
                bosses: None,
                timer: None,
            })
        );
        assert_eq!(
            (run.duration_ms, run.player_count, run.boss_hp_percent),
            (600_000, 2, None)
        );
        assert_eq!(view.fights[1].run, None);
        assert_eq!(view.fights[1].difficulty_label.as_deref(), Some("Mythic+"));
        assert_eq!(view.zone.as_deref(), Some("Priory of the Sacred Flame"));
        assert_eq!(
            remember.unwrap().pull_count,
            3,
            "the run itself is not a pull"
        );
    }

    /// Priory: three bosses, 1950/1560/1170 s.
    fn dungeons() -> DungeonTable {
        DungeonTable::from_csv(
            include_bytes!("../../crates/openlogs-gamedata/tests/fixtures/MapChallengeMode.csv"),
            include_bytes!("../../crates/openlogs-gamedata/tests/fixtures/DungeonEncounter.csv"),
        )
        .unwrap()
    }

    /// `MYTHIC_PLUS` with Prioress Murrpray killed before the run's end, which logs `total_ms`.
    fn every_boss_killed(total_ms: u64) -> String {
        MYTHIC_PLUS
            .lines()
            .flat_map(|line| {
                if line.contains("CHALLENGE_MODE_END") {
                    vec![
                        "10/8/2026 20:09:00.0000  ENCOUNTER_START,2848,\"Prioress Murrpray\",8,5,2649".to_string(),
                        "10/8/2026 20:09:50.0000  ENCOUNTER_END,2848,\"Prioress Murrpray\",8,5,1,50000".to_string(),
                        format!("10/8/2026 20:10:00.0000  CHALLENGE_MODE_END,2649,1,12,{total_ms}"),
                    ]
                } else {
                    vec![line.to_string()]
                }
            })
            .map(|line| line + "\n")
            .collect()
    }

    #[test]
    fn dungeon_data_decides_the_result_of_a_run() {
        let dir = tempfile::tempdir().unwrap();
        let table = dungeons();
        let path = log_file(dir.path(), MYTHIC_PLUS);
        let (view, _) = index_log(&path, dir.path(), Some(&table)).unwrap();
        let run = &view.fights[0];
        assert_eq!(run.outcome, OutcomeDto::Wipe, "Prioress Murrpray lives");
        let details = run.run.as_ref().unwrap();
        assert_eq!(
            (details.bosses, details.timer),
            (
                Some(BossProgressDto {
                    killed: 2,
                    total: 3
                }),
                None
            )
        );
        assert_eq!(
            view.fights[1..]
                .iter()
                .map(|pull| pull.outcome)
                .collect::<Vec<_>>(),
            [OutcomeDto::Kill, OutcomeDto::Wipe, OutcomeDto::Kill],
            "boss pulls keep their outcome"
        );

        for (total_ms, timer) in [
            (
                600_000,
                serde_json::json!({ "kind": "inTime", "upgrades": 3 }),
            ),
            (2_000_000, serde_json::json!({ "kind": "overTime" })),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let path = log_file(dir.path(), &every_boss_killed(total_ms));
            let (view, _) = index_log(&path, dir.path(), Some(&table)).unwrap();
            assert_eq!(view.fights[0].outcome, OutcomeDto::Kill);
            let json = serde_json::to_value(&view.fights[0]).unwrap();
            assert_eq!(
                json["run"]["bosses"],
                serde_json::json!({ "killed": 3, "total": 3 })
            );
            assert_eq!(json["run"]["timer"], timer, "{total_ms} ms");
        }

        let raid = log_file(dir.path(), FIXTURE);
        let (without, _) = index_log(&raid, dir.path(), None).unwrap();
        let (with, _) = index_log(&raid, dir.path(), Some(&table)).unwrap();
        assert_eq!(
            with.fights, without.fights,
            "a raid log ignores dungeon data"
        );
    }

    #[test]
    fn a_run_opens_like_a_pull_with_boss_phases_and_no_boss_hp() {
        let dir = tempfile::tempdir().unwrap();
        let path = log_file(dir.path(), MYTHIC_PLUS);
        let cache = FightCache::default();
        let curated = Curated::bundled();

        let run = quick_overview_at(&cache, &curated, &path, dir.path(), 1, None).unwrap();
        assert_eq!(
            (run.kpis.players, run.kpis.duration_ms, run.kpis.deaths),
            (2, 600_000, 1)
        );
        assert!(run.timeline.boss_hp.iter().all(Option::is_none));
        assert!(run.timeline.markers.boss_casts.is_empty());
        let phases = serde_json::to_value(&run.timeline.phases).unwrap();
        assert_eq!(phases.as_array().unwrap().len(), 7);
        assert_eq!(
            phases[0],
            serde_json::json!({ "kind": "trash", "number": 1, "startMs": 0, "endMs": 60_000, "name": null })
        );
        assert_eq!(phases[1]["kind"], "boss");
        assert_eq!(phases[1]["name"], "Captain Dailcry");

        let damage = damage_report_at(&cache, &path, dir.path(), 1, filter(WHOLE_PULL)).unwrap();
        assert_eq!(
            damage.total, 610_000_000,
            "trash and boss damage of the whole run"
        );
        let second_baron =
            filter(r#"{ "startMs": 360000, "endMs": 420000, "attribution": "augmented" }"#);
        assert_eq!(
            damage_report_at(&cache, &path, dir.path(), 1, second_baron)
                .unwrap()
                .total,
            400_000_000
        );

        let pull = quick_overview_at(&cache, &curated, &path, dir.path(), 2, None).unwrap();
        assert!(
            pull.timeline.boss_hp.iter().any(Option::is_some),
            "a boss pull of the run keeps its boss HP"
        );
    }
}
