// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auras_dto;
mod casts_dto;
mod commands;
mod compare_dto;
mod detail_dto;
mod dto;
mod fight_cache;
mod icons;
mod interrupts_dto;
mod overview_dto;
mod player_dto;
mod recap_dto;
mod recent;
mod refs;
mod report_dto;
mod resources_dto;
mod state;
#[cfg(test)]
mod test_fight;

use openlogs_gamedata::HttpFetch;
use tauri::Manager;

fn main() {
    let context = context();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let state = state::AppState::new(data_dir);
            if let Ok(resources) = app.path().resource_dir() {
                state
                    .icons
                    .set_bundled_boss_icons(resources.join("boss_icons"));
            }
            app.manage(state);
            // Game data loads and refreshes without blocking startup; "Refresh now" in Settings
            // runs the same sync.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let state = handle.state::<state::AppState>();
                state.sync_game_data(&HttpFetch::for_bulk_data(), state::now_unix_s(), false);
            });
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("wowicon", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            tauri::async_runtime::spawn_blocking(move || {
                let image = app.state::<state::AppState>().icons.image(&path);
                responder.respond(icons::icon_response(image));
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_log,
            commands::recent_logs,
            commands::remove_recent,
            commands::game_data_status,
            commands::refresh_game_data,
            commands::quick_overview,
            commands::damage_done_report,
            commands::healing_report,
            commands::damage_taken_report,
            commands::player_detail,
            commands::ability_detail,
            commands::target_detail,
            commands::deaths_report,
            commands::casts_report,
            commands::auras_report,
            commands::interrupts_report,
            commands::resources_report,
            commands::compare_pulls
        ])
        .run(context)
        .expect("error while running OpenLogs");
}

fn context() -> tauri::Context {
    let mut context = tauri::generate_context!();
    if std::env::var_os("OPENLOGS_OFFSCREEN").is_some() {
        keep_off_screen(context.config_mut());
    }
    context
}

/// For automated visual checks over the WebView2 DevTools port: the window stays hidden,
/// without focus and without a taskbar button, so it does not disturb the user.
fn keep_off_screen(config: &mut tauri::Config) {
    for window in &mut config.app.windows {
        window.visible = false;
        window.focus = false;
        window.skip_taskbar = true;
    }
}
