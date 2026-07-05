use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, State};

use crate::procstream::{kill_shared, spawn_streaming};
use crate::state::AppState;

static PIO_PATH: OnceCell<Option<PathBuf>> = OnceCell::new();

/// GUI apps launched from Finder/Dock on macOS get a minimal PATH
/// (typically just /usr/bin:/bin:/usr/sbin:/sbin), so a plain "pio"
/// lookup frequently fails even though a terminal shell finds it fine.
/// Probe the common PlatformIO install locations directly before
/// falling back to whatever PATH resolution turns up.
fn candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = dirs_home() {
        candidates.push(home.join(".platformio/penv/bin/pio"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/pio"));
    candidates.push(PathBuf::from("/usr/local/bin/pio"));
    candidates.push(PathBuf::from("/usr/bin/pio"));
    candidates
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn is_executable(path: &Path) -> bool {
    path.is_file()
}

fn resolve_pio_path() -> Option<PathBuf> {
    for candidate in candidate_paths() {
        if is_executable(&candidate) {
            return Some(candidate);
        }
    }
    // Fall back to PATH-based resolution (works when launched from a terminal).
    if let Ok(output) = Command::new("which").arg("pio").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
    }
    None
}

pub fn pio_path() -> Option<PathBuf> {
    PIO_PATH.get_or_init(resolve_pio_path).clone()
}

pub fn pio_command() -> Result<Command, String> {
    let path = pio_path().ok_or_else(|| {
        "PlatformIO CLI (`pio`) was not found. Install it with `pip install -U platformio` \
         or from https://platformio.org/install/cli, then restart EmbedForge."
            .to_string()
    })?;
    let mut cmd = Command::new(path);
    // Ensure pio's own child processes (compilers, upload tools) can find
    // system tools even under the GUI app's minimal inherited PATH.
    let extra_path = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
    if let Ok(existing) = std::env::var("PATH") {
        cmd.env("PATH", format!("{extra_path}:{existing}"));
    } else {
        cmd.env("PATH", extra_path);
    }
    Ok(cmd)
}

#[derive(Serialize)]
pub struct EnvironmentStatus {
    pub pio_found: bool,
    pub pio_path: Option<String>,
    pub pio_version: Option<String>,
}

#[tauri::command]
pub fn check_environment() -> EnvironmentStatus {
    match pio_path() {
        Some(path) => {
            let version = Command::new(&path)
                .arg("--version")
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
            EnvironmentStatus {
                pio_found: true,
                pio_path: Some(path.to_string_lossy().to_string()),
                pio_version: version,
            }
        }
        None => EnvironmentStatus {
            pio_found: false,
            pio_path: None,
            pio_version: None,
        },
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SerialPort {
    pub port: String,
    pub description: String,
    pub hwid: String,
}

#[tauri::command]
pub fn list_boards() -> Result<Vec<SerialPort>, String> {
    let mut cmd = pio_command()?;
    let output = cmd
        .args(["device", "list", "--json-output"])
        .output()
        .map_err(|e| format!("Failed to run `pio device list`: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("`pio device list` failed: {stderr}"));
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<Vec<SerialPort>>(&raw)
        .map_err(|e| format!("Could not parse device list: {e}"))
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BoardDefinition {
    pub id: String,
    pub name: String,
    pub platform: String,
    #[serde(default)]
    pub frameworks: Vec<String>,
    pub mcu: String,
}

#[tauri::command]
pub fn search_boards(query: String) -> Result<Vec<BoardDefinition>, String> {
    let mut cmd = pio_command()?;
    let mut args = vec!["boards".to_string(), "--json-output".to_string()];
    if !query.trim().is_empty() {
        args.push(query);
    }
    let output = cmd
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run `pio boards`: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("`pio boards` failed: {stderr}"));
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<Vec<BoardDefinition>>(&raw)
        .map_err(|e| format!("Could not parse board list: {e}"))
}

fn build_args(env: &Option<String>, extra: &[&str]) -> Vec<String> {
    let mut args = vec!["run".to_string()];
    if let Some(e) = env {
        if !e.is_empty() {
            args.push("-e".to_string());
            args.push(e.clone());
        }
    }
    for a in extra {
        args.push(a.to_string());
    }
    args
}

fn run_pio_task(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    args: Vec<String>,
    task_id: String,
) -> Result<String, String> {
    let mut cmd = pio_command()?;
    cmd.current_dir(&project_path);
    cmd.args(&args);

    let child = spawn_streaming(app, cmd, task_id.clone(), "task-line", "task-done")?;
    state
        .tasks
        .lock()
        .map_err(|_| "task registry lock poisoned")?
        .insert(task_id.clone(), child);
    Ok(task_id)
}

#[tauri::command]
pub fn build_project(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    env: Option<String>,
    task_id: String,
) -> Result<String, String> {
    let args = build_args(&env, &[]);
    run_pio_task(app, state, project_path, args, task_id)
}

#[tauri::command]
pub fn upload_project(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    env: Option<String>,
    port: Option<String>,
    task_id: String,
) -> Result<String, String> {
    let mut args = build_args(&env, &["-t", "upload"]);
    if let Some(p) = port {
        if !p.is_empty() {
            args.push("--upload-port".to_string());
            args.push(p);
        }
    }
    run_pio_task(app, state, project_path, args, task_id)
}

#[tauri::command]
pub fn clean_project(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    env: Option<String>,
    task_id: String,
) -> Result<String, String> {
    let args = build_args(&env, &["-t", "clean"]);
    run_pio_task(app, state, project_path, args, task_id)
}

#[tauri::command]
pub fn stop_task(state: State<AppState>, task_id: String) -> Result<(), String> {
    let mut tasks = state
        .tasks
        .lock()
        .map_err(|_| "task registry lock poisoned")?;
    if let Some(child) = tasks.remove(&task_id) {
        kill_shared(&child)
    } else {
        Err("No running task with that id".to_string())
    }
}
