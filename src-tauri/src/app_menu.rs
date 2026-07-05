use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_opener::OpenerExt;

/// IDs for the custom (non-predefined) menu items. Sent to the frontend
/// verbatim as the `menu-action` event payload so a single dispatch table
/// in main.ts can route them to the same handlers the toolbar buttons use.
mod ids {
    pub const NEW_PROJECT: &str = "new-project";
    pub const OPEN_PROJECT: &str = "open-project";
    pub const NEW_FILE: &str = "new-file";
    pub const SAVE_FILE: &str = "save-file";
    pub const TOGGLE_SIDEBAR: &str = "toggle-sidebar";
    pub const TOGGLE_PANEL: &str = "toggle-panel";
    pub const ZOOM_IN: &str = "zoom-in";
    pub const ZOOM_OUT: &str = "zoom-out";
    pub const ZOOM_RESET: &str = "zoom-reset";
    pub const BUILD: &str = "build";
    pub const UPLOAD: &str = "upload";
    pub const CLEAN: &str = "clean";
    pub const STOP: &str = "stop";
    pub const SHOW_MONITOR: &str = "show-monitor";
    pub const REFRESH_BOARDS: &str = "refresh-boards";
    pub const PIO_DOCS: &str = "pio-docs";
    pub const IDF_DOCS: &str = "idf-docs";
    pub const SETTINGS: &str = "settings";
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("TestIDE"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .comments(Some("A focused IDE for PlatformIO and ESP-IDF projects"))
        .build();

    let app_menu = SubmenuBuilder::new(app, "TestIDE")
        .about(Some(about_metadata))
        .separator()
        .item(&MenuItem::with_id(
            app,
            ids::SETTINGS,
            "Settings…",
            true,
            Some("CmdOrCtrl+,"),
        )?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&MenuItem::with_id(
            app,
            ids::NEW_PROJECT,
            "New Project…",
            true,
            Some("CmdOrCtrl+Shift+N"),
        )?)
        .item(&MenuItem::with_id(
            app,
            ids::OPEN_PROJECT,
            "Open Project…",
            true,
            Some("CmdOrCtrl+O"),
        )?)
        .separator()
        .item(&MenuItem::with_id(
            app,
            ids::NEW_FILE,
            "New File",
            true,
            Some("CmdOrCtrl+N"),
        )?)
        .item(&MenuItem::with_id(
            app,
            ids::SAVE_FILE,
            "Save",
            true,
            Some("CmdOrCtrl+S"),
        )?)
        .separator()
        .close_window()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&MenuItem::with_id(
            app,
            ids::TOGGLE_SIDEBAR,
            "Toggle Sidebar",
            true,
            Some("CmdOrCtrl+Shift+E"),
        )?)
        .item(&MenuItem::with_id(
            app,
            ids::TOGGLE_PANEL,
            "Toggle Build/Monitor Panel",
            true,
            Some("CmdOrCtrl+J"),
        )?)
        .separator()
        .item(&MenuItem::with_id(
            app,
            ids::ZOOM_IN,
            "Zoom In Editor",
            true,
            Some("CmdOrCtrl+="),
        )?)
        .item(&MenuItem::with_id(
            app,
            ids::ZOOM_OUT,
            "Zoom Out Editor",
            true,
            Some("CmdOrCtrl+-"),
        )?)
        .item(&MenuItem::with_id(
            app,
            ids::ZOOM_RESET,
            "Actual Size",
            true,
            Some("CmdOrCtrl+0"),
        )?)
        .build()?;

    // Xcode-style build/run/clean/stop shortcuts — familiar territory for
    // anyone coming from Apple's own embedded/mobile tooling.
    let project_menu = SubmenuBuilder::new(app, "Project")
        .item(&MenuItem::with_id(
            app,
            ids::BUILD,
            "Build",
            true,
            Some("CmdOrCtrl+B"),
        )?)
        .item(&MenuItem::with_id(
            app,
            ids::UPLOAD,
            "Flash",
            true,
            Some("CmdOrCtrl+R"),
        )?)
        .item(&MenuItem::with_id(
            app,
            ids::CLEAN,
            "Clean",
            true,
            Some("CmdOrCtrl+Shift+K"),
        )?)
        .item(&MenuItem::with_id(
            app,
            ids::STOP,
            "Stop",
            true,
            Some("CmdOrCtrl+."),
        )?)
        .separator()
        .item(&MenuItem::with_id(
            app,
            ids::SHOW_MONITOR,
            "Serial Monitor",
            true,
            Some("CmdOrCtrl+Shift+M"),
        )?)
        .separator()
        .item(&MenuItem::with_id(
            app,
            ids::REFRESH_BOARDS,
            "Refresh Boards",
            true,
            None::<&str>,
        )?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .separator()
        .bring_all_to_front()
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItem::with_id(
            app,
            ids::PIO_DOCS,
            "PlatformIO Documentation",
            true,
            None::<&str>,
        )?)
        .item(&MenuItem::with_id(
            app,
            ids::IDF_DOCS,
            "ESP-IDF Documentation",
            true,
            None::<&str>,
        )?)
        .build()?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &project_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

pub fn handle_event<R: Runtime>(app: &AppHandle<R>, event_id: &str) {
    match event_id {
        ids::PIO_DOCS => {
            let _ = app.opener().open_url("https://docs.platformio.org", None::<&str>);
        }
        ids::IDF_DOCS => {
            let _ = app.opener().open_url(
                "https://docs.espressif.com/projects/esp-idf/en/latest/",
                None::<&str>,
            );
        }
        // Everything else is app state (current project, editor, panels) that
        // only the frontend knows about — forward it as-is and let main.ts's
        // dispatch table route it to the same handlers the toolbar uses.
        other => {
            let _ = app.emit("menu-action", other);
        }
    }
}
