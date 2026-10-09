use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use openlogs_gamedata::{Curated, HttpFetch};
use openlogs_index::{CacheStatus, load_or_build};
use tauri::{AppHandle, Manager};

use crate::detail_dto::{AbilityDetailDto, TargetDetailDto, ability_detail_dto, target_detail_dto};
use crate::dto::{GameDataStatusDto, LogView, RecentLog, log_view, recent_log};
use crate::fight_cache::FightCache;
use crate::overview_dto::{QuickOverviewDto, quick_overview_dto};
use crate::player_dto::{MetricDto, PlayerDetailDto, player_detail_dto};
use crate::recent::{RecentEntry, RecentLogs};
use crate::report_dto::{
    DamageReportDto, DamageTakenReportDto, FilterDto, HealingReportDto, damage_report_dto,
    healing_report_dto, taken_report_dto,
};
use crate::state::{AppState, index_cache_dir, now_unix_s};

/// Indexes (or loads from cache) the log at `path`. Returns the view and, for real combat
/// logs, the entry to remember in the recent list.
pub fn index_log(path: &Path, data_dir: &Path) -> Result<(LogView, Option<RecentEntry>), String> {
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
    );
    let entry = index.log_version.map(|_| RecentEntry {
        path: path_text,
        file_name,
        size_bytes,
        zone: view.zone.clone(),
        start_unix_ms: view.start_unix_ms,
        pull_count: view.fights.len() as u32,
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
        let (view, entry) = index_log(Path::new(&path), &state.data_dir)?;
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
    use crate::dto::OutcomeDto;
    use crate::report_dto::AttributionDto;

    const FIXTURE: &str = include_str!("../../crates/openlogs-index/tests/fixtures/mini_raid.txt");
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
        let (view, remember) = index_log(&other_spelling, dir.path()).unwrap();

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

        assert!(index_log(&path, dir.path()).unwrap().0.cache_hit);
        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        write!(
            file,
            "\n10/7/2026 19:30:00.0000  ENCOUNTER_START,3492,\"Ula'tek\",15,23,3004\n\
             10/7/2026 19:31:00.0000  ENCOUNTER_END,3492,\"Ula'tek\",15,23,1,60000\n"
        )
        .unwrap();
        drop(file);
        let (view, _) = index_log(&path, dir.path()).unwrap();
        assert!(!view.cache_hit);
        assert_eq!(view.fights.len(), 4);
        assert_eq!(view.fights[3].outcome, OutcomeDto::Kill);
    }

    #[test]
    fn unusable_input_fails_with_a_message() {
        let dir = tempfile::tempdir().unwrap();
        let err = index_log(dir.path(), dir.path()).unwrap_err();
        assert!(
            err.ends_with("is a folder. Open a WoWCombatLog*.txt file instead."),
            "{err}"
        );

        let notes = dir.path().join("notes.txt");
        fs::write(&notes, "shopping list\nmilk, eggs\n").unwrap();
        let (view, remember) = index_log(&notes, dir.path()).unwrap();
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

        let (_, entry) = index_log(&path, dir.path()).unwrap();
        let mut recent = RecentLogs::default();
        recent.touch(entry.unwrap());
        assert!(recent_view(&recent)[0].exists);
        fs::remove_file(&path).unwrap();
        assert!(!recent_view(&recent)[0].exists);
        let err = index_log(&path, dir.path()).unwrap_err();
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
}
