use ini::Ini;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const IGNORED_DIRS: &[&str] = &[
    ".pio",
    ".git",
    "node_modules",
    ".vscode",
    ".idea",
    "__pycache__",
    "build",
    "managed_components",
];

#[derive(Debug, Serialize, Clone)]
pub struct PioEnv {
    pub name: String,
    pub board: Option<String>,
    pub platform: Option<String>,
    pub framework: Option<String>,
    pub upload_port: Option<String>,
    pub monitor_speed: Option<u32>,
}

/// A project directory is one of: a PlatformIO project (has
/// `platformio.ini`), a native ESP-IDF project driven directly by `idf.py`
/// (has a CMakeLists.txt that includes IDF's build system, no
/// platformio.ini), or unrecognized. Tagged so the frontend can branch on
/// `kind` without needing a second round-trip to figure out which toolchain
/// to use.
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ProjectInfo {
    Platformio {
        root: String,
        name: String,
        envs: Vec<PioEnv>,
    },
    EspIdf {
        root: String,
        name: String,
        target: Option<String>,
        available_targets: Vec<String>,
        has_sdkconfig: bool,
    },
    Stm32 {
        root: String,
        name: String,
        flavor: crate::stm32::Stm32Flavor,
        build_configs: Vec<String>,
        mcu: Option<String>,
        flash_tools: crate::stm32::Stm32FlashTools,
    },
    Unknown {
        root: String,
        name: String,
    },
}

impl From<crate::idf::IdfProjectInfo> for ProjectInfo {
    fn from(info: crate::idf::IdfProjectInfo) -> Self {
        ProjectInfo::EspIdf {
            root: info.root,
            name: info.name,
            target: info.target,
            available_targets: info.available_targets,
            has_sdkconfig: info.has_sdkconfig,
        }
    }
}

impl From<crate::stm32::Stm32ProjectInfo> for ProjectInfo {
    fn from(info: crate::stm32::Stm32ProjectInfo) -> Self {
        ProjectInfo::Stm32 {
            root: info.root,
            name: info.name,
            flavor: info.flavor,
            build_configs: info.build_configs,
            mcu: info.mcu,
            flash_tools: info.flash_tools,
        }
    }
}

#[tauri::command]
pub fn open_project(path: String) -> Result<ProjectInfo, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("{path} is not a directory"));
    }
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    let ini_path = root.join("platformio.ini");
    if ini_path.is_file() {
        let envs = parse_ini(&ini_path)?;
        return Ok(ProjectInfo::Platformio {
            root: path,
            name,
            envs,
        });
    }

    if crate::idf::is_esp_idf_project(&root) {
        return Ok(crate::idf::open_idf_project(&root).into());
    }

    if let Some(info) = crate::stm32::detect_stm32_project(&root) {
        return Ok(info.into());
    }

    Ok(ProjectInfo::Unknown { root: path, name })
}

fn parse_ini(ini_path: &Path) -> Result<Vec<PioEnv>, String> {
    let conf = Ini::load_from_file(ini_path)
        .map_err(|e| format!("Failed to parse platformio.ini: {e}"))?;

    let mut envs = Vec::new();
    for (section, props) in conf.iter() {
        let Some(section) = section else { continue };
        let Some(env_name) = section.strip_prefix("env:") else {
            continue;
        };
        envs.push(PioEnv {
            name: env_name.to_string(),
            board: props.get("board").map(|s| s.to_string()),
            platform: props.get("platform").map(|s| s.to_string()),
            framework: props.get("framework").map(|s| s.to_string()),
            upload_port: props.get("upload_port").map(|s| s.to_string()),
            monitor_speed: props.get("monitor_speed").and_then(|s| s.parse().ok()),
        });
    }
    Ok(envs)
}

#[derive(Debug, Serialize, Clone)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}

#[tauri::command]
pub fn read_project_tree(path: String) -> Result<Vec<FileNode>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("{path} is not a directory"));
    }
    read_dir_recursive(&root, 6)
}

fn read_dir_recursive(dir: &Path, depth: u8) -> Result<Vec<FileNode>, String> {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read {}: {e}", dir.display()))?
        .filter_map(|e| e.ok())
        .collect();

    entries.sort_by(|a, b| {
        let a_dir = a.path().is_dir();
        let b_dir = b.path().is_dir();
        b_dir.cmp(&a_dir).then_with(|| a.file_name().cmp(&b.file_name()))
    });

    let mut nodes = Vec::new();
    for entry in entries {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if IGNORED_DIRS.contains(&file_name.as_str()) {
            continue;
        }
        if file_name.starts_with('.') {
            continue;
        }
        let entry_path = entry.path();
        let is_dir = entry_path.is_dir();
        let children = if is_dir && depth > 0 {
            Some(read_dir_recursive(&entry_path, depth - 1)?)
        } else {
            None
        };
        nodes.push(FileNode {
            name: file_name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            children,
        });
    }
    Ok(nodes)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read {path}: {e}"))
}

#[tauri::command]
pub fn write_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("Failed to write {path}: {e}"))
}

#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.exists() {
        return Err("A file or folder with that name already exists".to_string());
    }
    fs::write(&p, "").map_err(|e| format!("Failed to create {path}: {e}"))
}

#[tauri::command]
pub fn create_folder(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create folder {path}: {e}"))
}

#[tauri::command]
pub fn delete_entry(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| format!("Failed to delete {path}: {e}"))
    } else {
        fs::remove_file(&p).map_err(|e| format!("Failed to delete {path}: {e}"))
    }
}

#[tauri::command]
pub fn rename_entry(from: String, to: String) -> Result<(), String> {
    fs::rename(&from, &to).map_err(|e| format!("Failed to rename {from} to {to}: {e}"))
}

#[derive(Debug, Deserialize)]
pub struct NewProjectRequest {
    pub parent_dir: String,
    pub project_name: String,
    pub board_id: String,
    pub framework: String,
}

#[tauri::command]
pub fn new_project(req: NewProjectRequest) -> Result<ProjectInfo, String> {
    let project_dir = PathBuf::from(&req.parent_dir).join(&req.project_name);
    fs::create_dir_all(&project_dir)
        .map_err(|e| format!("Failed to create project directory: {e}"))?;

    let mut cmd = crate::pio::pio_command()?;
    let output = cmd
        .args([
            "project",
            "init",
            "--board",
            &req.board_id,
            "-d",
            &project_dir.to_string_lossy(),
            "-O",
            &format!("framework={}", req.framework),
        ])
        .output()
        .map_err(|e| format!("Failed to run `pio project init`: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Project init failed: {stderr}"));
    }

    scaffold_starter_source(&project_dir, &req.framework)?;

    open_project(project_dir.to_string_lossy().to_string())
}

/// `pio project init` only scaffolds `platformio.ini` and the empty
/// include/lib/src directories — it deliberately does not write any source
/// code, so a freshly created project won't build until the user adds
/// something to `src/`. Drop in a minimal, known-buildable starter so the
/// project is immediately runnable instead of erroring on an empty source
/// tree.
fn scaffold_starter_source(project_dir: &Path, framework: &str) -> Result<(), String> {
    let src_dir = project_dir.join("src");
    fs::create_dir_all(&src_dir).map_err(|e| format!("Failed to create src directory: {e}"))?;

    let already_has_source = fs::read_dir(&src_dir)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false);
    if already_has_source {
        return Ok(());
    }

    let arduino_main = [
        "#include <Arduino.h>",
        "",
        "#ifndef LED_BUILTIN",
        "#define LED_BUILTIN 2",
        "#endif",
        "",
        "void setup() {",
        "  Serial.begin(115200);",
        "  pinMode(LED_BUILTIN, OUTPUT);",
        "}",
        "",
        "void loop() {",
        "  digitalWrite(LED_BUILTIN, HIGH);",
        "  delay(500);",
        "  digitalWrite(LED_BUILTIN, LOW);",
        "  delay(500);",
        "  Serial.println(\"tick\");",
        "}",
        "",
    ]
    .join("\n");

    let espidf_main = [
        "#include <stdio.h>",
        "#include \"freertos/FreeRTOS.h\"",
        "#include \"freertos/task.h\"",
        "",
        "void app_main(void) {",
        "    while (1) {",
        "        printf(\"Hello from ESP-IDF\\n\");",
        "        vTaskDelay(pdMS_TO_TICKS(1000));",
        "    }",
        "}",
        "",
    ]
    .join("\n");

    let (filename, contents): (&str, &str) = match framework {
        "arduino" => ("main.cpp", &arduino_main),
        "espidf" => ("main.c", &espidf_main),
        _ => return Ok(()),
    };

    fs::write(src_dir.join(filename), contents)
        .map_err(|e| format!("Failed to write starter source file: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "embedforge-test-{name}-{:?}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn detects_platformio_project() {
        let dir = unique_temp_dir("pio");
        fs::write(
            dir.join("platformio.ini"),
            "[env:esp32dev]\nplatform = espressif32\nboard = esp32dev\nframework = arduino\n",
        )
        .unwrap();

        let info = open_project(dir.to_string_lossy().to_string()).unwrap();
        match info {
            ProjectInfo::Platformio { envs, .. } => {
                assert_eq!(envs.len(), 1);
                assert_eq!(envs[0].name, "esp32dev");
                assert_eq!(envs[0].board.as_deref(), Some("esp32dev"));
                assert_eq!(envs[0].framework.as_deref(), Some("arduino"));
            }
            other => panic!("expected Platformio, got {other:?}"),
        }

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn detects_esp_idf_project() {
        let dir = unique_temp_dir("idf");
        fs::write(
            dir.join("CMakeLists.txt"),
            "cmake_minimum_required(VERSION 3.16)\ninclude($ENV{IDF_PATH}/tools/cmake/project.cmake)\nproject(demo)\n",
        )
        .unwrap();

        let info = open_project(dir.to_string_lossy().to_string()).unwrap();
        match info {
            ProjectInfo::EspIdf {
                target,
                has_sdkconfig,
                available_targets,
                ..
            } => {
                assert_eq!(target, None, "no sdkconfig yet, so no target should be parsed");
                assert!(!has_sdkconfig);
                assert!(available_targets.contains(&"esp32".to_string()));
            }
            other => panic!("expected EspIdf, got {other:?}"),
        }

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn detects_esp_idf_target_from_sdkconfig() {
        let dir = unique_temp_dir("idf-target");
        fs::write(
            dir.join("CMakeLists.txt"),
            "include($ENV{IDF_PATH}/tools/cmake/project.cmake)\n",
        )
        .unwrap();
        fs::write(
            dir.join("sdkconfig"),
            "#\n# some comment\n#\nCONFIG_IDF_TARGET=\"esp32s3\"\nCONFIG_FOO=y\n",
        )
        .unwrap();

        let info = open_project(dir.to_string_lossy().to_string()).unwrap();
        match info {
            ProjectInfo::EspIdf {
                target,
                has_sdkconfig,
                ..
            } => {
                assert_eq!(target.as_deref(), Some("esp32s3"));
                assert!(has_sdkconfig);
            }
            other => panic!("expected EspIdf, got {other:?}"),
        }

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn detects_stm32_makefile_project() {
        let dir = unique_temp_dir("stm32-makefile");
        fs::write(dir.join("Makefile"), "all:\n\techo build\n").unwrap();
        fs::write(dir.join("demo.ioc"), "Mcu.UserName=STM32F407VGTx\n").unwrap();

        let info = open_project(dir.to_string_lossy().to_string()).unwrap();
        match info {
            ProjectInfo::Stm32 { flavor, mcu, .. } => {
                assert_eq!(flavor, crate::stm32::Stm32Flavor::Makefile);
                assert_eq!(mcu.as_deref(), Some("STM32F407VGTx"));
            }
            other => panic!("expected Stm32, got {other:?}"),
        }

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn detects_unknown_project() {
        let dir = unique_temp_dir("unknown");
        fs::write(dir.join("readme.txt"), "just some files, no build system\n").unwrap();

        let info = open_project(dir.to_string_lossy().to_string()).unwrap();
        assert!(matches!(info, ProjectInfo::Unknown { .. }), "expected Unknown, got {info:?}");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn platformio_ini_takes_precedence_over_cmake() {
        // A PlatformIO project using framework=espidf still has both
        // platformio.ini AND a CMakeLists.txt-driven build underneath —
        // it must be treated as a PlatformIO project, not native ESP-IDF.
        let dir = unique_temp_dir("pio-espidf");
        fs::write(
            dir.join("platformio.ini"),
            "[env:esp32dev]\nplatform = espressif32\nboard = esp32dev\nframework = espidf\n",
        )
        .unwrap();
        fs::write(
            dir.join("CMakeLists.txt"),
            "include($ENV{IDF_PATH}/tools/cmake/project.cmake)\n",
        )
        .unwrap();

        let info = open_project(dir.to_string_lossy().to_string()).unwrap();
        assert!(matches!(info, ProjectInfo::Platformio { .. }), "expected Platformio, got {info:?}");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn scaffolds_arduino_starter_source() {
        let dir = unique_temp_dir("scaffold-arduino");
        scaffold_starter_source(&dir, "arduino").unwrap();
        let contents = fs::read_to_string(dir.join("src").join("main.cpp")).unwrap();
        assert!(contents.contains("#include <Arduino.h>"));
        assert!(contents.contains("void setup()"));
        assert!(contents.contains("void loop()"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn scaffolds_espidf_starter_source() {
        let dir = unique_temp_dir("scaffold-espidf");
        scaffold_starter_source(&dir, "espidf").unwrap();
        let contents = fs::read_to_string(dir.join("src").join("main.c")).unwrap();
        assert!(contents.contains("void app_main(void)"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn scaffold_does_not_overwrite_existing_source() {
        let dir = unique_temp_dir("scaffold-existing");
        let src_dir = dir.join("src");
        fs::create_dir_all(&src_dir).unwrap();
        fs::write(src_dir.join("main.cpp"), "// user already wrote this\n").unwrap();

        scaffold_starter_source(&dir, "arduino").unwrap();

        let contents = fs::read_to_string(src_dir.join("main.cpp")).unwrap();
        assert_eq!(contents, "// user already wrote this\n");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn scaffold_skips_unknown_framework() {
        let dir = unique_temp_dir("scaffold-unknown-fw");
        scaffold_starter_source(&dir, "zephyr").unwrap();
        let entries: Vec<_> = fs::read_dir(dir.join("src")).unwrap().collect();
        assert!(entries.is_empty(), "unknown framework should not scaffold a file");
        fs::remove_dir_all(&dir).unwrap();
    }
}
