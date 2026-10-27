// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(context())
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
