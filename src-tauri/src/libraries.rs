use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, State};

use crate::pio::pio_command;
use crate::procstream::spawn_streaming;
use crate::state::AppState;

// ------------------------------------------------------------------ search

#[derive(Debug, Deserialize)]
struct RawFramework {
    name: String,
}

#[derive(Debug, Deserialize)]
struct RawSearchItem {
    id: i64,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    authornames: Vec<String>,
    #[serde(default)]
    versionname: String,
    #[serde(default)]
    ownername: String,
    #[serde(default)]
    frameworks: Vec<RawFramework>,
}

#[derive(Debug, Deserialize)]
struct RawSearchResponse {
    page: u32,
    perpage: u32,
    total: u32,
    items: Vec<RawSearchItem>,
}

#[derive(Debug, Serialize, Clone)]
pub struct LibrarySearchItem {
    pub id: i64,
    pub name: String,
    pub owner: String,
    pub description: String,
    pub version: String,
    pub authors: Vec<String>,
    pub frameworks: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct LibrarySearchResult {
    pub page: u32,
    pub perpage: u32,
    pub total: u32,
    pub items: Vec<LibrarySearchItem>,
}

#[tauri::command]
pub fn search_libraries(
    query: String,
    page: Option<u32>,
) -> Result<LibrarySearchResult, String> {
    let mut cmd = pio_command()?;
    let mut args = vec!["lib".to_string(), "search".to_string()];
    let trimmed = query.trim();
    if !trimmed.is_empty() {
        args.push(trimmed.to_string());
    }
    args.push("--json-output".to_string());
    if let Some(p) = page {
        args.push("--page".to_string());
        args.push(p.to_string());
    }

    let output = cmd
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run `pio lib search`: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("`pio lib search` failed: {stderr}"));
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let parsed: RawSearchResponse = serde_json::from_str(&raw)
        .map_err(|e| format!("Could not parse library search results: {e}"))?;

    Ok(LibrarySearchResult {
        page: parsed.page,
        perpage: parsed.perpage,
        total: parsed.total,
        items: parsed
            .items
            .into_iter()
            .map(|it| LibrarySearchItem {
                id: it.id,
                name: it.name,
                owner: it.ownername,
                description: it.description,
                version: it.versionname,
                authors: it.authornames,
                frameworks: it.frameworks.into_iter().map(|f| f.name).collect(),
            })
            .collect(),
    })
}

// ------------------------------------------------------------------- show

#[derive(Debug, Deserialize, Default)]
struct RawCurrentVersion {
    #[serde(default)]
    name: String,
}

#[derive(Debug, Deserialize)]
struct RawVersion {
    name: String,
    #[serde(default)]
    released: String,
}

#[derive(Debug, Deserialize)]
struct RawAuthor {
    #[serde(default)]
    name: String,
}

#[derive(Debug, Deserialize)]
struct RawShow {
    id: i64,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    ownername: String,
    #[serde(default)]
    homepage: String,
    #[serde(default)]
    repository: String,
    #[serde(default)]
    authors: Vec<RawAuthor>,
    #[serde(default)]
    version: RawCurrentVersion,
    #[serde(default)]
    versions: Vec<RawVersion>,
}

#[derive(Debug, Serialize, Clone)]
pub struct LibraryVersion {
    pub name: String,
    pub released: String,
}

#[derive(Debug, Serialize)]
pub struct LibraryDetail {
    pub id: i64,
    pub name: String,
    pub owner: String,
    pub description: String,
    pub homepage: String,
    pub repository: String,
    pub authors: Vec<String>,
    pub versions: Vec<LibraryVersion>,
}

/// Accepts either a numeric registry id (from search results) or a plain
/// library name (to look up versions for an already-installed library).
#[tauri::command]
pub fn get_library_detail(id_or_name: String) -> Result<LibraryDetail, String> {
    let mut cmd = pio_command()?;
    let output = cmd
        .args(["lib", "show", &id_or_name, "--json-output"])
        .output()
        .map_err(|e| format!("Failed to run `pio lib show`: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("`pio lib show` failed: {stderr}"));
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let parsed: RawShow = serde_json::from_str(&raw)
        .map_err(|e| format!("Could not parse library details: {e}"))?;

    // The registry's `versions` order isn't reliably chronological or
    // semver-sorted, so we can't just reverse/sort it blindly. Instead,
    // surface the known-current release (`version.name`) first and leave
    // the rest in whatever order the registry returned, deduplicated.
    let mut versions: Vec<LibraryVersion> = Vec::with_capacity(parsed.versions.len());
    let mut seen = std::collections::HashSet::new();
    for v in parsed.versions {
        if seen.insert(v.name.clone()) {
            versions.push(LibraryVersion {
                name: v.name,
                released: v.released,
            });
        }
    }
    if let Some(pos) = versions.iter().position(|v| v.name == parsed.version.name) {
        let current = versions.remove(pos);
        versions.insert(0, current);
    } else if !parsed.version.name.is_empty() {
        versions.insert(
            0,
            LibraryVersion {
                name: parsed.version.name.clone(),
                released: String::new(),
            },
        );
    }

    Ok(LibraryDetail {
        id: parsed.id,
        name: parsed.name,
        owner: parsed.ownername,
        description: parsed.description,
        homepage: parsed.homepage,
        repository: parsed.repository,
        authors: parsed
            .authors
            .into_iter()
            .map(|a| a.name)
            .filter(|n| !n.is_empty())
            .collect(),
        versions,
    })
}

// -------------------------------------------------------- installed libs

#[derive(Debug, Serialize, Clone)]
pub struct InstalledLibrary {
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
}

fn extract_author(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Object(map) => map
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        serde_json::Value::Array(list) => list
            .iter()
            .filter_map(|v| v.get("name").and_then(|n| n.as_str()))
            .collect::<Vec<_>>()
            .join(", "),
        serde_json::Value::String(s) => s.clone(),
        _ => String::new(),
    }
}

#[tauri::command]
pub fn list_installed_libraries(
    project_path: String,
    env: String,
) -> Result<Vec<InstalledLibrary>, String> {
    let libdeps_dir = Path::new(&project_path)
        .join(".pio")
        .join("libdeps")
        .join(&env);
    if !libdeps_dir.is_dir() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&libdeps_dir)
        .map_err(|e| format!("Failed to read installed libraries: {e}"))?;

    let mut libs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(path.join("library.json")) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };

        let fallback_name = entry.file_name().to_string_lossy().to_string();
        let name = value
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or(fallback_name);
        let version = value
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let description = value
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let author = value
            .get("authors")
            .map(extract_author)
            .unwrap_or_default();

        libs.push(InstalledLibrary {
            name,
            version,
            description,
            author,
        });
    }

    libs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(libs)
}

// -------------------------------------------------------- install/remove

fn library_spec(owner: &str, name: &str, version: &str) -> String {
    let base = if owner.trim().is_empty() {
        name.to_string()
    } else {
        format!("{owner}/{name}")
    };
    if version.trim().is_empty() {
        base
    } else {
        format!("{base}@{version}")
    }
}

#[tauri::command]
pub fn install_library(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    env: String,
    owner: String,
    name: String,
    version: String,
    task_id: String,
) -> Result<String, String> {
    let mut cmd = pio_command()?;
    let args = vec![
        "pkg".to_string(),
        "install".to_string(),
        "-d".to_string(),
        project_path,
        "-e".to_string(),
        env,
        "-l".to_string(),
        library_spec(&owner, &name, &version),
    ];
    cmd.args(&args);

    let child = spawn_streaming(app, cmd, task_id.clone(), "lib-task-line", "lib-task-done")?;
    state
        .tasks
        .lock()
        .map_err(|_| "task registry lock poisoned")?
        .insert(task_id.clone(), child);
    Ok(task_id)
}

#[tauri::command]
pub fn uninstall_library(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    env: String,
    name: String,
    task_id: String,
) -> Result<String, String> {
    let mut cmd = pio_command()?;
    let args = vec![
        "pkg".to_string(),
        "uninstall".to_string(),
        "-d".to_string(),
        project_path,
        "-e".to_string(),
        env,
        "-l".to_string(),
        name,
    ];
    cmd.args(&args);

    let child = spawn_streaming(app, cmd, task_id.clone(), "lib-task-line", "lib-task-done")?;
    state
        .tasks
        .lock()
        .map_err(|_| "task registry lock poisoned")?
        .insert(task_id.clone(), child);
    Ok(task_id)
}
