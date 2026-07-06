use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

use crate::idf::idf_command;
use crate::procstream::spawn_streaming;
use crate::state::AppState;

fn manifest_path(project_path: &str) -> PathBuf {
    Path::new(project_path).join("main").join("idf_component.yml")
}

fn managed_components_dir(project_path: &str) -> PathBuf {
    Path::new(project_path).join("managed_components")
}

/// Reads a top-level (zero-indent) `key: value` scalar out of a manifest.
/// Only used against `managed_components/*/idf_component.yml`, which the
/// component manager always writes flat (no nested nodes at the top level).
fn read_top_level_field(raw: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    for line in raw.lines() {
        let trimmed = line.trim_start();
        if line.len() != trimmed.len() {
            continue; // indented, not a top-level key
        }
        if let Some(rest) = trimmed.strip_prefix(&prefix) {
            let value = rest.trim().trim_matches('"').trim_matches('\'');
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// Extracts the entries under `main/idf_component.yml`'s top-level
/// `dependencies:` mapping as `(name, spec)` pairs. This is a light
/// line-based reader rather than a full YAML parser — the manifest only
/// ever holds a flat set of `name: spec` entries (or, less commonly,
/// `name:` followed by an indented `version:`/etc. mapping), and reading it
/// this way avoids reformatting the file (and losing the user's comments)
/// the way a parse-and-reserialize round trip would.
fn parse_manifest_deps(raw: &str) -> Vec<(String, String)> {
    let lines: Vec<&str> = raw.lines().collect();
    let mut deps = Vec::new();
    let mut in_deps = false;
    let mut entry_indent: Option<usize> = None;
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();
        i += 1;

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if !in_deps {
            if indent == 0 && trimmed.trim_end() == "dependencies:" {
                in_deps = true;
            }
            continue;
        }
        if indent == 0 {
            break; // left the dependencies block
        }

        let this_entry_indent = *entry_indent.get_or_insert(indent);
        if indent != this_entry_indent {
            continue; // a value line nested under some other entry
        }

        let Some((key_part, rest)) = trimmed.split_once(':') else {
            continue;
        };
        let key = key_part.trim().trim_matches('"').trim_matches('\'');
        if key == "idf" {
            continue; // the required-IDF-version pseudo dependency
        }

        let inline_value = rest.trim();
        let spec = if !inline_value.is_empty() {
            inline_value.trim_matches('"').trim_matches('\'').to_string()
        } else {
            // Nested-mapping style (`name:` then an indented `version:` etc.
            // below it) — pull the `version:` line out of that block.
            let mut version = None;
            let mut j = i;
            while j < lines.len() {
                let l = lines[j];
                let t = l.trim_start();
                let ind = l.len() - t.len();
                if t.is_empty() || t.starts_with('#') {
                    j += 1;
                    continue;
                }
                if ind <= this_entry_indent {
                    break;
                }
                if let Some(v) = t.strip_prefix("version:") {
                    version = Some(v.trim().trim_matches('"').trim_matches('\'').to_string());
                }
                j += 1;
            }
            version.unwrap_or_else(|| "*".to_string())
        };
        deps.push((key.to_string(), spec));
    }

    deps
}

/// Removes one top-level entry (and any nested block belonging to it) from
/// `dependencies:` in an `idf_component.yml` manifest, leaving every other
/// line untouched. Returns `None` if `target` wasn't found.
fn remove_manifest_dependency(raw: &str, target: &str) -> Option<String> {
    let lines: Vec<&str> = raw.lines().collect();
    let mut in_deps = false;
    let mut entry_indent: Option<usize> = None;
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();

        if !in_deps {
            if indent == 0 && trimmed.trim_end() == "dependencies:" {
                in_deps = true;
            }
            i += 1;
            continue;
        }
        if !trimmed.is_empty() && !trimmed.starts_with('#') && indent == 0 {
            return None; // left the dependencies block without a match
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            i += 1;
            continue;
        }

        let this_entry_indent = *entry_indent.get_or_insert(indent);
        if indent == this_entry_indent {
            if let Some((key_part, _)) = trimmed.split_once(':') {
                let key = key_part.trim().trim_matches('"').trim_matches('\'');
                if key == target {
                    let start = i;
                    let mut end = i + 1;
                    while end < lines.len() {
                        let l = lines[end];
                        let t = l.trim_start();
                        let ind = l.len() - t.len();
                        if !t.is_empty() && ind <= this_entry_indent {
                            break;
                        }
                        end += 1;
                    }
                    let mut out: Vec<&str> = Vec::with_capacity(lines.len());
                    out.extend_from_slice(&lines[..start]);
                    out.extend_from_slice(&lines[end..]);
                    let mut result = out.join("\n");
                    if raw.ends_with('\n') {
                        result.push('\n');
                    }
                    return Some(result);
                }
            }
        }
        i += 1;
    }
    None
}

#[derive(Debug, Serialize, Clone)]
pub struct EspComponent {
    pub name: String,
    pub spec: String,
    pub version: Option<String>,
    pub description: String,
    pub url: String,
}

/// Lists the dependencies declared in `main/idf_component.yml`, enriched
/// with resolved-version/description/url from `managed_components/` when
/// the component manager has already fetched them (i.e. after a build or
/// `idf.py reconfigure`).
#[tauri::command]
pub fn list_esp_components(project_path: String) -> Result<Vec<EspComponent>, String> {
    let raw = match fs::read_to_string(manifest_path(&project_path)) {
        Ok(s) => s,
        Err(_) => return Ok(Vec::new()),
    };

    let managed_dir = managed_components_dir(&project_path);
    let mut components: Vec<EspComponent> = parse_manifest_deps(&raw)
        .into_iter()
        .map(|(name, spec)| {
            let dir_name = name.replace('/', "__");
            let managed_raw =
                fs::read_to_string(managed_dir.join(&dir_name).join("idf_component.yml")).ok();

            let version = managed_raw
                .as_deref()
                .and_then(|r| read_top_level_field(r, "version"));
            let description = managed_raw
                .as_deref()
                .and_then(|r| read_top_level_field(r, "description"))
                .unwrap_or_default();
            let url = managed_raw
                .as_deref()
                .and_then(|r| read_top_level_field(r, "url"))
                .unwrap_or_default();

            EspComponent {
                name,
                spec,
                version,
                description,
                url,
            }
        })
        .collect();

    components.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(components)
}

/// Adds a dependency (e.g. `espressif/led_strip` or
/// `espressif/led_strip^2.5.5`) via `idf.py add-dependency`, which reaches
/// out to the ESP Component Registry itself — streamed the same way
/// build/flash tasks are, over the shared `lib-task-line`/`lib-task-done`
/// events the PlatformIO libraries panel already uses.
#[tauri::command]
pub fn add_esp_component(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    spec: String,
    task_id: String,
) -> Result<String, String> {
    let mut cmd = idf_command()?;
    cmd.current_dir(&project_path);
    cmd.args(["add-dependency", &spec]);

    let child = spawn_streaming(app, cmd, task_id.clone(), "lib-task-line", "lib-task-done")?;
    state
        .tasks
        .lock()
        .map_err(|_| "task registry lock poisoned")?
        .insert(task_id.clone(), child);
    Ok(task_id)
}

/// Removes a dependency by editing the manifest directly rather than
/// shelling out to `idf.py remove-dependency`: that action is gated on
/// `ESP_IDF_VERSION >= 6.0.1`, but `ESP_IDF_VERSION` is only ever set to the
/// major.minor form (e.g. `6.0`), so the gate — and the command — never
/// actually activates on a real 6.0.x install.
#[tauri::command]
pub fn remove_esp_component(project_path: String, name: String) -> Result<(), String> {
    let path = manifest_path(&project_path);
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Could not read idf_component.yml: {e}"))?;
    let updated = remove_manifest_dependency(&raw, &name)
        .ok_or_else(|| format!("{name} was not found in idf_component.yml"))?;
    fs::write(&path, updated).map_err(|e| format!("Could not write idf_component.yml: {e}"))
}

#[cfg(test)]
mod manifest_smoke_test {
    use super::*;

    const REAL_MANIFEST: &str = "## IDF Component Manager Manifest File\ndependencies:\n  ## Required IDF version\n  idf:\n    version: '>=4.1.0'\n  # # Put list of dependencies here\n  # # For components maintained by Espressif:\n  # component: \"~1.0.0\"\n  # # For 3rd party components:\n  # username/component: \">=1.0.0,<2.0.0\"\n  # username2/component2:\n  #   version: \"~1.0.0\"\n  #   # For transient dependencies `public` flag can be set.\n  #   # `public` flag doesn't have an effect dependencies of the `main` component.\n  #   # All dependencies of `main` are public by default.\n  #   public: true\n  espressif/led_strip: ^2.5.5\n";

    #[test]
    fn parses_real_manifest() {
        let deps = parse_manifest_deps(REAL_MANIFEST);
        assert_eq!(deps, vec![("espressif/led_strip".to_string(), "^2.5.5".to_string())]);
    }

    #[test]
    fn removes_real_dependency_and_preserves_rest() {
        let updated = remove_manifest_dependency(REAL_MANIFEST, "espressif/led_strip").unwrap();
        assert!(!updated.contains("led_strip"));
        assert!(updated.contains("## Required IDF version"));
        assert!(parse_manifest_deps(&updated).is_empty());
    }

    #[test]
    fn missing_dependency_returns_none() {
        assert!(remove_manifest_dependency(REAL_MANIFEST, "nope/nothing").is_none());
    }

    #[test]
    fn handles_nested_mapping_style() {
        let raw = "dependencies:\n  idf:\n    version: '>=4.1.0'\n  example/cmp:\n    version: \"~1.0.0\"\n    public: true\n  other/one: \"*\"\n";
        let deps = parse_manifest_deps(raw);
        assert_eq!(
            deps,
            vec![
                ("example/cmp".to_string(), "~1.0.0".to_string()),
                ("other/one".to_string(), "*".to_string()),
            ]
        );

        let updated = remove_manifest_dependency(raw, "example/cmp").unwrap();
        assert!(!updated.contains("example/cmp"));
        assert!(updated.contains("other/one"));
        assert!(updated.contains("public: true") == false);
    }

    #[test]
    fn reads_managed_component_fields() {
        let raw = "dependencies:\n  idf: '>=4.4'\ndescription: Driver for Addressable LED Strip (WS2812, etc)\nrepository: git://github.com/espressif/idf-extra-components.git\nurl: https://github.com/espressif/idf-extra-components/tree/master/led_strip\nversion: 2.5.5\n";
        assert_eq!(read_top_level_field(raw, "version").as_deref(), Some("2.5.5"));
        assert_eq!(
            read_top_level_field(raw, "description").as_deref(),
            Some("Driver for Addressable LED Strip (WS2812, etc)")
        );
    }
}
