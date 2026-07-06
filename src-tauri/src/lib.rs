mod ai;
mod app_menu;
mod boards_watch;
mod esp_libraries;
mod idf;
mod libraries;
mod monitor;
mod pio;
mod procstream;
mod project;
mod state;
mod stm32;
mod terminal;

use state::{AppState, MONITOR_BUFFER_CAP};
use tauri::{Listener, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .menu(|app| app_menu::build(app))
        .on_menu_event(|app, event| app_menu::handle_event(app, event.id().as_ref()))
        .setup(|app| {
            boards_watch::start_watching(app.handle().clone());

            // Feeds the AI assistant's `read_serial_monitor` tool: mirror
            // every monitor-line event into a capped ring buffer instead of
            // requiring the tool call to tap a live stream.
            let handle = app.handle().clone();
            app.listen("monitor-line", move |event| {
                let Ok(payload) = serde_json::from_str::<serde_json::Value>(event.payload()) else {
                    return;
                };
                let Some(line) = payload.get("line").and_then(|v| v.as_str()) else {
                    return;
                };
                let state = handle.state::<AppState>();
                let Ok(mut buf) = state.monitor_buffer.lock() else {
                    return;
                };
                buf.push_back(line.to_string());
                while buf.len() > MONITOR_BUFFER_CAP {
                    buf.pop_front();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ai::ai_send_message,
            pio::check_environment,
            pio::list_boards,
            pio::search_boards,
            pio::build_project,
            pio::upload_project,
            pio::clean_project,
            pio::stop_task,
            monitor::start_monitor,
            monitor::stop_monitor,
            idf::check_idf_environment,
            idf::idf_build,
            idf::idf_upload,
            idf::idf_clean,
            idf::idf_set_target,
            idf::idf_monitor,
            idf::new_idf_project,
            stm32::check_stm32_environment,
            stm32::new_stm32_project,
            stm32::stm32_build,
            stm32::stm32_flash,
            stm32::stm32_clean,
            libraries::search_libraries,
            libraries::get_library_detail,
            libraries::list_installed_libraries,
            libraries::install_library,
            libraries::uninstall_library,
            esp_libraries::list_esp_components,
            esp_libraries::add_esp_component,
            esp_libraries::remove_esp_component,
            project::open_project,
            project::read_project_tree,
            project::read_file,
            project::write_file,
            project::create_file,
            project::create_folder,
            project::delete_entry,
            project::rename_entry,
            project::new_project,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
