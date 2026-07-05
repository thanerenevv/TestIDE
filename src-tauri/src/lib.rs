mod app_menu;
mod boards_watch;
mod idf;
mod monitor;
mod pio;
mod procstream;
mod project;
mod state;
mod terminal;

use state::AppState;

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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
