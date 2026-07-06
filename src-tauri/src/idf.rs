use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, State};

use crate::procstream::{kill_shared, spawn_streaming};
use crate::state::AppState;

pub const IDF_TARGETS: &[&str] = &[
    "esp32", "esp32s2", "esp32s3", "esp32c2", "esp32c3", "esp32c6", "esp32h2", "esp32p4",
];

static IDF_PATH: OnceCell<Option<PathBuf>> = OnceCell::new();
static IDF_ENV: OnceCell<Option<HashMap<String, String>>> = OnceCell::new();

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn is_idf_root(path: &Path) -> bool {
    path.join("tools").join("idf.py").is_file()
}

/// One IDF checkout as recorded by Espressif's IDF Installation Manager
/// (`eim`) in its `eim_idf.json` manifest.
#[derive(Debug, Deserialize, Clone)]
struct EimIdfInstall {
    id: String,
    #[allow(dead_code)]
    name: String,
    path: String,
    #[serde(rename = "idfToolsPath")]
    idf_tools_path: String,
    python: String,
    #[serde(rename = "activationScript")]
    activation_script: String,
}

#[derive(Debug, Deserialize)]
struct EimConfig {
    #[serde(rename = "idfInstalled")]
    idf_installed: Vec<EimIdfInstall>,
    #[serde(rename = "idfSelectedId")]
    idf_selected_id: Option<String>,
}

/// Locations `eim` records its installed IDF versions at. Defaults to
/// `~/.espressif/tools/eim_idf.json`, but also checks `$IDF_TOOLS_PATH` in
/// case the user pointed eim at a non-default tools directory.
fn eim_config_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(p) = std::env::var("IDF_TOOLS_PATH") {
        if !p.is_empty() {
            paths.push(PathBuf::from(p).join("eim_idf.json"));
        }
    }
    if let Some(home) = home_dir() {
        paths.push(home.join(".espressif/tools/eim_idf.json"));
    }
    paths
}

fn read_eim_config() -> Option<EimConfig> {
    eim_config_paths()
        .into_iter()
        .find_map(|path| serde_json::from_str(&fs::read_to_string(path).ok()?).ok())
}

/// The eim install the user last selected (via `eim select <version>` or the
/// eim GUI), falling back to the first listed install if the recorded
/// selection is missing or stale.
fn eim_selected_install() -> Option<EimIdfInstall> {
    let cfg = read_eim_config()?;
    cfg.idf_selected_id
        .as_ref()
        .and_then(|id| cfg.idf_installed.iter().find(|i| &i.id == id))
        .or_else(|| cfg.idf_installed.first())
        .cloned()
}

/// Compares a manifest-recorded path against a resolved one, canonicalizing
/// both first so symlinks (e.g. `/tmp` on macOS) don't cause a false mismatch.
fn paths_match(recorded: &str, resolved: &Path) -> bool {
    let recorded = PathBuf::from(recorded);
    match (fs::canonicalize(&recorded), fs::canonicalize(resolved)) {
        (Ok(a), Ok(b)) => a == b,
        _ => recorded == resolved,
    }
}

/// Probes the locations a working ESP-IDF checkout is realistically found
/// at: an explicit `IDF_PATH`, the version eim currently has selected
/// (`~/.espressif/<version>/esp-idf`), the manual-clone convention from
/// Espressif's own getting-started docs (`~/esp/esp-idf`), and the layout
/// used by Espressif's older IDE installers
/// (`~/.espressif/frameworks/esp-idf-vX.Y`, newest version first).
fn candidate_idf_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(p) = std::env::var("IDF_PATH") {
        if !p.is_empty() {
            candidates.push(PathBuf::from(p));
        }
    }
    if let Some(install) = eim_selected_install() {
        candidates.push(PathBuf::from(install.path));
    }
    if let Some(home) = home_dir() {
        candidates.push(home.join("esp/esp-idf"));
        candidates.push(home.join("esp-idf"));

        let frameworks_dir = home.join(".espressif/frameworks");
        if let Ok(entries) = fs::read_dir(&frameworks_dir) {
            let mut dirs: Vec<PathBuf> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            dirs.sort();
            dirs.reverse();
            candidates.extend(dirs);
        }
    }
    candidates
}

fn resolve_idf_path() -> Option<PathBuf> {
    candidate_idf_paths().into_iter().find(|p| is_idf_root(p))
}

pub fn idf_path() -> Option<PathBuf> {
    IDF_PATH.get_or_init(resolve_idf_path).clone()
}

fn candidate_python_paths() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/opt/homebrew/bin/python3"),
        PathBuf::from("/usr/local/bin/python3"),
        PathBuf::from("/usr/bin/python3"),
    ]
}

fn locate_python3() -> Option<PathBuf> {
    for candidate in candidate_python_paths() {
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    let output = Command::new("which").arg("python3").output().ok()?;
    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            return Some(PathBuf::from(path));
        }
    }
    None
}

fn idf_tools_path() -> PathBuf {
    std::env::var_os("IDF_TOOLS_PATH")
        .map(PathBuf::from)
        .or_else(|| home_dir().map(|h| h.join(".espressif")))
        .unwrap_or_else(|| PathBuf::from(".espressif"))
}

/// Substitutes `$VAR` / `${VAR}` references in `value`, checking variables
/// already resolved earlier in this export pass first, then the current
/// process environment. This mirrors what a shell would do when sourcing
/// `export.sh`, which is what `idf_tools.py export` output is meant to
/// approximate without actually running a shell.
fn substitute_vars(value: &str, resolved: &HashMap<String, String>) -> String {
    let chars: Vec<char> = value.chars().collect();
    let mut out = String::with_capacity(value.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '$' && i + 1 < chars.len() {
            let (name, consumed) = if chars[i + 1] == '{' {
                match chars[i + 2..].iter().position(|&c| c == '}') {
                    Some(end_offset) => {
                        let name: String = chars[i + 2..i + 2 + end_offset].iter().collect();
                        (Some(name), 2 + end_offset + 1)
                    }
                    None => (None, 1),
                }
            } else {
                let mut end = i + 1;
                while end < chars.len() && (chars[end].is_alphanumeric() || chars[end] == '_') {
                    end += 1;
                }
                if end > i + 1 {
                    (Some(chars[i + 1..end].iter().collect()), end - i)
                } else {
                    (None, 1)
                }
            };
            match name {
                Some(var_name) => {
                    let value = resolved
                        .get(&var_name)
                        .cloned()
                        .or_else(|| std::env::var(&var_name).ok())
                        .unwrap_or_default();
                    out.push_str(&value);
                    i += consumed;
                }
                None => {
                    out.push(chars[i]);
                    i += 1;
                }
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

fn parse_export_output(raw: &str) -> HashMap<String, String> {
    let mut resolved: HashMap<String, String> = HashMap::new();
    for line in raw.lines() {
        let line = line.trim();
        let line = line.strip_prefix("export ").unwrap_or(line);
        if line.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let mut value = value.trim();
        if value.len() >= 2
            && ((value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\'')))
        {
            value = &value[1..value.len() - 1];
        }
        let substituted = substitute_vars(value, &resolved);
        resolved.insert(key.to_string(), substituted);
    }
    resolved
}

/// Runs the eim-generated activation script's `-e` mode, which prints the
/// exact env vars (including a fully expanded `PATH`) eim precomputed for
/// this install at install time. Sourcing it this way sidesteps needing a
/// system python3 or `IDF_TOOLS_PATH` guesswork — eim already knows both.
fn resolve_idf_env_via_eim(install: &EimIdfInstall) -> Option<HashMap<String, String>> {
    let script = PathBuf::from(&install.activation_script);
    if !script.is_file() {
        return None;
    }
    let output = Command::new("sh").arg(&script).arg("-e").output().ok()?;
    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let mut env = parse_export_output(&raw);

    // `-e` reports the toolchain dirs as `PATH` and the pre-existing shell
    // PATH (where system tools like `cmake` and `git` live) separately as
    // `SYSTEM_PATH` — sourcing the script normally would prepend the former
    // onto the latter, so replicate that here rather than dropping SYSTEM_PATH.
    if let Some(system_path) = env.remove("SYSTEM_PATH") {
        let toolchain_path = env.get("PATH").cloned().unwrap_or_default();
        let combined = if toolchain_path.is_empty() {
            system_path
        } else {
            format!("{toolchain_path}:{system_path}")
        };
        env.insert("PATH".to_string(), combined);
    }

    env.entry("IDF_PATH".to_string())
        .or_insert_with(|| install.path.clone());
    env.entry("IDF_TOOLS_PATH".to_string())
        .or_insert_with(|| install.idf_tools_path.clone());
    Some(env)
}

/// Runs `idf_tools.py export`, which is the programmatic equivalent of
/// sourcing `export.sh` — it prints the PATH additions and env vars needed
/// to run `idf.py` (toolchain bin dirs, the IDF python venv, etc.) without
/// requiring a real shell to source anything into.
fn resolve_idf_env() -> Option<HashMap<String, String>> {
    let idf = idf_path()?;

    if let Some(install) = eim_selected_install() {
        if paths_match(&install.path, &idf) {
            if let Some(env) = resolve_idf_env_via_eim(&install) {
                return Some(env);
            }
        }
    }

    let python = locate_python3()?;
    let tools_path = idf_tools_path();

    let output = Command::new(&python)
        .arg(idf.join("tools").join("idf_tools.py"))
        .args(["export", "--format", "key-value"])
        .env("IDF_PATH", &idf)
        .env("IDF_TOOLS_PATH", &tools_path)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let mut env = parse_export_output(&raw);
    env.entry("IDF_PATH".to_string())
        .or_insert_with(|| idf.to_string_lossy().to_string());
    env.entry("IDF_TOOLS_PATH".to_string())
        .or_insert_with(|| tools_path.to_string_lossy().to_string());
    Some(env)
}

fn idf_env() -> Option<HashMap<String, String>> {
    IDF_ENV.get_or_init(resolve_idf_env).clone()
}

pub fn idf_command() -> Result<Command, String> {
    let idf = idf_path().ok_or_else(|| {
        "ESP-IDF was not found. Install it via the Espressif IDF Installation Manager (eim), \
         set the IDF_PATH environment variable, or clone it to ~/esp/esp-idf, then restart \
         TestIDE."
            .to_string()
    })?;

    let eim_install = eim_selected_install().filter(|i| paths_match(&i.path, &idf));
    let eim_python = eim_install
        .as_ref()
        .map(|i| PathBuf::from(&i.python))
        .filter(|p| p.is_file());

    let python = eim_python.or_else(locate_python3).ok_or_else(|| {
        "python3 was not found. ESP-IDF requires a working Python 3 installation.".to_string()
    })?;
    let env = idf_env().ok_or_else(|| {
        "Could not initialize the ESP-IDF environment. Run `install.sh` inside your ESP-IDF \
         checkout at least once (this installs the toolchain and Python env), then restart \
         TestIDE."
            .to_string()
    })?;

    let mut cmd = Command::new(python);
    cmd.arg(idf.join("tools").join("idf.py"));
    for (k, v) in &env {
        cmd.env(k, v);
    }
    Ok(cmd)
}

#[derive(Serialize)]
pub struct IdfEnvironmentStatus {
    pub idf_found: bool,
    pub idf_path: Option<String>,
    pub idf_version: Option<String>,
    pub env_ready: bool,
    pub via_eim: bool,
}

#[tauri::command]
pub fn check_idf_environment() -> IdfEnvironmentStatus {
    let Some(path) = idf_path() else {
        return IdfEnvironmentStatus {
            idf_found: false,
            idf_path: None,
            idf_version: None,
            env_ready: false,
            via_eim: false,
        };
    };

    let via_eim = eim_selected_install()
        .map(|i| paths_match(&i.path, &path))
        .unwrap_or(false);

    let env_ready = idf_env().is_some();
    let version = if env_ready {
        idf_command()
            .ok()
            .and_then(|mut cmd| cmd.arg("--version").output().ok())
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    } else {
        None
    };

    IdfEnvironmentStatus {
        idf_found: true,
        idf_path: Some(path.to_string_lossy().to_string()),
        idf_version: version,
        env_ready,
        via_eim,
    }
}

/// Every ESP-IDF project's root CMakeLists.txt includes the IDF build
/// system, almost always via the canonical
/// `include($ENV{IDF_PATH}/tools/cmake/project.cmake)` line — that's a much
/// more reliable signal than looking for a `main/` folder or `sdkconfig`
/// (which doesn't exist until the project has been configured once).
pub fn is_esp_idf_project(dir: &Path) -> bool {
    let cmake = dir.join("CMakeLists.txt");
    let Ok(contents) = fs::read_to_string(cmake) else {
        return false;
    };
    let lower = contents.to_lowercase();
    lower.contains("project.cmake") || lower.contains("idf_path")
}

fn parse_sdkconfig_target(dir: &Path) -> Option<String> {
    let contents = fs::read_to_string(dir.join("sdkconfig")).ok()?;
    for line in contents.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("CONFIG_IDF_TARGET=") {
            let target = rest.trim().trim_matches('"');
            if !target.is_empty() {
                return Some(target.to_string());
            }
        }
    }
    None
}

#[derive(Debug, Serialize, Clone)]
pub struct IdfProjectInfo {
    pub root: String,
    pub name: String,
    pub target: Option<String>,
    pub available_targets: Vec<String>,
    pub has_sdkconfig: bool,
}

pub fn open_idf_project(root: &Path) -> IdfProjectInfo {
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| root.to_string_lossy().to_string());
    IdfProjectInfo {
        root: root.to_string_lossy().to_string(),
        name,
        target: parse_sdkconfig_target(root),
        available_targets: IDF_TARGETS.iter().map(|s| s.to_string()).collect(),
        has_sdkconfig: root.join("sdkconfig").is_file(),
    }
}

fn run_idf_task(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    args: Vec<String>,
    task_id: String,
) -> Result<String, String> {
    let mut cmd = idf_command()?;
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
pub fn idf_build(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    task_id: String,
) -> Result<String, String> {
    run_idf_task(app, state, project_path, vec!["build".to_string()], task_id)
}

#[tauri::command]
pub fn idf_upload(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    port: Option<String>,
    task_id: String,
) -> Result<String, String> {
    let mut args = Vec::new();
    if let Some(p) = &port {
        if !p.is_empty() {
            args.push("-p".to_string());
            args.push(p.clone());
        }
    }
    args.push("flash".to_string());
    run_idf_task(app, state, project_path, args, task_id)
}

#[tauri::command]
pub fn idf_clean(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    task_id: String,
) -> Result<String, String> {
    run_idf_task(
        app,
        state,
        project_path,
        vec!["fullclean".to_string()],
        task_id,
    )
}

#[tauri::command]
pub fn idf_set_target(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    target: String,
    task_id: String,
) -> Result<String, String> {
    run_idf_task(
        app,
        state,
        project_path,
        vec!["set-target".to_string(), target],
        task_id,
    )
}

#[tauri::command]
pub fn idf_monitor(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    port: String,
    baud: Option<u32>,
) -> Result<(), String> {
    {
        let mut guard = state.monitor.lock().map_err(|_| "monitor lock poisoned")?;
        if let Some(child) = guard.take() {
            kill_shared(&child)?;
        }
    }

    let mut cmd = idf_command()?;
    cmd.current_dir(&project_path);
    cmd.arg("-p").arg(&port);
    if let Some(b) = baud {
        cmd.arg("-b").arg(b.to_string());
    }
    cmd.arg("monitor");

    let child = spawn_streaming(
        app,
        cmd,
        "serial-monitor".to_string(),
        "monitor-line",
        "monitor-done",
    )?;

    let mut guard = state.monitor.lock().map_err(|_| "monitor lock poisoned")?;
    *guard = Some(child);
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct NewIdfProjectRequest {
    pub parent_dir: String,
    pub project_name: String,
    pub target: String,
}

#[tauri::command]
pub fn new_idf_project(req: NewIdfProjectRequest) -> Result<crate::project::ProjectInfo, String> {
    // `idf.py create-project --path X` creates the project directly inside X
    // (and fails if X is non-empty) rather than inside a NAME subdirectory of
    // X, so X must already be the full target directory.
    let project_dir = PathBuf::from(&req.parent_dir).join(&req.project_name);

    let mut create_cmd = idf_command()?;
    let output = create_cmd
        .arg("create-project")
        .arg("--path")
        .arg(&project_dir)
        .arg(&req.project_name)
        .output()
        .map_err(|e| format!("Failed to run `idf.py create-project`: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Project creation failed: {stderr}"));
    }

    let mut target_cmd = idf_command()?;
    let target_output = target_cmd
        .current_dir(&project_dir)
        .args(["set-target", &req.target])
        .output()
        .map_err(|e| format!("Failed to run `idf.py set-target`: {e}"))?;

    if !target_output.status.success() {
        let stderr = String::from_utf8_lossy(&target_output.stderr);
        return Err(format!(
            "Project was created, but `set-target {}` failed: {stderr}",
            req.target
        ));
    }

    Ok(open_idf_project(&project_dir).into())
}
