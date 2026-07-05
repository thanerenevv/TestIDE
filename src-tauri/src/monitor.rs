use tauri::{AppHandle, State};

use crate::pio::pio_command;
use crate::procstream::{kill_shared, spawn_streaming};
use crate::state::AppState;

const MONITOR_TASK_ID: &str = "serial-monitor";

#[tauri::command]
pub fn start_monitor(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    env: Option<String>,
    port: String,
    baud: Option<u32>,
) -> Result<(), String> {
    // Stop any prior monitor first so the previous process releases the port
    // before we try to open it again.
    {
        let mut guard = state.monitor.lock().map_err(|_| "monitor lock poisoned")?;
        if let Some(child) = guard.take() {
            kill_shared(&child)?;
        }
    }

    let mut cmd = pio_command()?;
    cmd.current_dir(&project_path);
    cmd.arg("device").arg("monitor").arg("--port").arg(&port);
    if let Some(b) = baud {
        cmd.arg("--baud").arg(b.to_string());
    }
    if let Some(e) = &env {
        if !e.is_empty() {
            cmd.arg("-e").arg(e);
        }
    }

    let child = spawn_streaming(
        app,
        cmd,
        MONITOR_TASK_ID.to_string(),
        "monitor-line",
        "monitor-done",
    )?;

    let mut guard = state
        .monitor
        .lock()
        .map_err(|_| "monitor lock poisoned")?;
    *guard = Some(child);
    Ok(())
}

#[tauri::command]
pub fn stop_monitor(state: State<AppState>) -> Result<(), String> {
    let mut guard = state
        .monitor
        .lock()
        .map_err(|_| "monitor lock poisoned")?;
    if let Some(child) = guard.take() {
        kill_shared(&child)?;
    }
    Ok(())
}
