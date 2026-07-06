use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, State};

use crate::procstream::spawn_streaming;
use crate::state::AppState;

// -------------------------------------------------------------- discovery

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn which(bin: &str) -> Option<PathBuf> {
    let output = Command::new("which").arg(bin).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(PathBuf::from(path))
    }
}

fn first_existing(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|p| p.is_file())
}

/// GUI apps launched from Finder/Dock get a minimal PATH, so probe common
/// install locations directly (mirrors the approach in pio.rs/idf.rs) before
/// falling back to `which`.
fn extra_path_dirs() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ]
}

fn simple_tool_path(bin: &str) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = extra_path_dirs().iter().map(|d| d.join(bin)).collect();
    if let Some(p) = which(bin) {
        candidates.push(p);
    }
    first_existing(candidates)
}

/// Directories a full STM32CubeIDE install might live at, across platforms.
/// macOS ships it as an app bundle; the default Linux/Windows installers use
/// a versioned `stm32cubeide_<version>` directory name.
fn cubeide_install_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Ok(entries) = fs::read_dir("/Applications") {
        for e in entries.filter_map(|e| e.ok()) {
            let name = e.file_name().to_string_lossy().to_lowercase();
            if name.contains("stm32cubeide") {
                roots.push(e.path());
            }
        }
    }

    let mut base_dirs = vec![PathBuf::from("/opt/st"), PathBuf::from("/usr/local/st")];
    if let Some(home) = home_dir() {
        base_dirs.push(home.join("st"));
        base_dirs.push(home.join("STM32CubeIDE"));
    }
    for base in base_dirs {
        let Ok(entries) = fs::read_dir(&base) else {
            continue;
        };
        for e in entries.filter_map(|e| e.ok()) {
            let name = e.file_name().to_string_lossy().to_lowercase();
            if name.contains("stm32cubeide") {
                roots.push(e.path());
            }
        }
    }

    // Newest-looking install first (lexical sort on version-ish dir names is
    // a reasonable proxy — exact version comparison isn't worth the code).
    roots.sort();
    roots.reverse();
    roots
}

/// Scans a CubeIDE install's `plugins` directory (an Eclipse `.app` bundle on
/// macOS nests it under `Contents/Eclipse`) for a plugin directory whose name
/// starts with `plugin_prefix`, then returns `<that plugin>/<tool_rel>` if it
/// exists. Used to find the arm-none-eabi toolchain, OpenOCD and
/// STM32CubeProgrammer that CubeIDE bundles internally.
fn find_bundled_tool(cubeide_root: &Path, plugin_prefix: &str, tool_rel: &str) -> Option<PathBuf> {
    for plugins_dir in [
        cubeide_root.join("Contents/Eclipse/plugins"),
        cubeide_root.join("plugins"),
    ] {
        let Ok(entries) = fs::read_dir(&plugins_dir) else {
            continue;
        };
        let mut matches: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .map(|n| n.to_string_lossy().starts_with(plugin_prefix))
                    .unwrap_or(false)
            })
            .collect();
        matches.sort();
        if let Some(newest) = matches.pop() {
            let candidate = newest.join(tool_rel);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn cubeide_executable(root: &Path) -> Option<PathBuf> {
    for rel in [
        "Contents/MacOs/stm32cubeide",
        "Contents/MacOS/stm32cubeide",
        "stm32cubeidec",
        "stm32cubeidec.exe",
        "stm32cubeide",
    ] {
        let candidate = root.join(rel);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

pub fn cubeide_path() -> Option<PathBuf> {
    cubeide_install_roots().iter().find_map(|r| cubeide_executable(r))
}

/// Directories a standalone STM32CubeMX install might live at — it's a
/// separate download from STM32CubeIDE (both ship the same code-generation
/// engine, but only the standalone tool's `-q` headless script mode is
/// documented, so project creation always shells out to it specifically).
fn cubemx_install_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    for base in ["/Applications", "/Applications/STMicroelectronics"] {
        let Ok(entries) = fs::read_dir(base) else {
            continue;
        };
        for e in entries.filter_map(|e| e.ok()) {
            let name = e.file_name().to_string_lossy().to_lowercase();
            if name.contains("stm32cubemx") {
                roots.push(e.path());
            }
        }
    }

    let mut base_dirs = vec![PathBuf::from("/opt"), PathBuf::from("/usr/local")];
    if let Some(home) = home_dir() {
        base_dirs.push(home.clone());
    }
    for base in base_dirs {
        let Ok(entries) = fs::read_dir(&base) else {
            continue;
        };
        for e in entries.filter_map(|e| e.ok()) {
            let name = e.file_name().to_string_lossy().to_lowercase();
            if name.contains("stm32cubemx") {
                roots.push(e.path());
            }
        }
    }

    roots.sort();
    roots.reverse();
    roots
}

fn cubemx_executable(root: &Path) -> Option<PathBuf> {
    for rel in [
        "Contents/MacOs/STM32CubeMX",
        "Contents/MacOS/STM32CubeMX",
        "STM32CubeMX",
        "STM32CubeMX.exe",
    ] {
        let candidate = root.join(rel);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if root.is_file() {
        return Some(root.to_path_buf());
    }
    None
}

pub fn cubemx_path() -> Option<PathBuf> {
    if let Some(p) = simple_tool_path("STM32CubeMX") {
        return Some(p);
    }
    cubemx_install_roots().iter().find_map(|r| cubemx_executable(r))
}

pub fn arm_gcc_path() -> Option<PathBuf> {
    if let Some(p) = simple_tool_path("arm-none-eabi-gcc") {
        return Some(p);
    }
    cubeide_install_roots().iter().find_map(|root| {
        find_bundled_tool(
            root,
            "com.st.stm32cube.ide.mcu.externaltools.gnu-tools-for-stm32",
            "tools/bin/arm-none-eabi-gcc",
        )
    })
}

/// The bundled toolchain's `bin` directory, so a build `Command` can put it
/// on `PATH` for `make`/`cmake` to find every `arm-none-eabi-*` tool, not
/// just `gcc`.
fn arm_toolchain_bin_dir() -> Option<PathBuf> {
    arm_gcc_path().and_then(|p| p.parent().map(|d| d.to_path_buf()))
}

pub fn make_path() -> Option<PathBuf> {
    simple_tool_path("make")
}

pub fn cmake_path() -> Option<PathBuf> {
    simple_tool_path("cmake")
}

pub fn ninja_path() -> Option<PathBuf> {
    simple_tool_path("ninja")
}

pub fn openocd_path() -> Option<PathBuf> {
    if let Some(p) = simple_tool_path("openocd") {
        return Some(p);
    }
    cubeide_install_roots().iter().find_map(|root| {
        find_bundled_tool(
            root,
            "com.st.stm32cube.ide.mcu.externaltools.openocd",
            "tools/bin/openocd",
        )
    })
}

pub fn programmer_cli_path() -> Option<PathBuf> {
    let mut candidates = vec![PathBuf::from(
        "/Applications/STMicroelectronics/STM32Cube/STM32CubeProgrammer/STM32CubeProgrammer.app/Contents/MacOs/bin/STM32_Programmer_CLI",
    )];
    if let Some(home) = home_dir() {
        candidates.push(
            home.join("STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin/STM32_Programmer_CLI"),
        );
    }
    if let Some(p) = first_existing(candidates) {
        return Some(p);
    }
    if let Some(p) = simple_tool_path("STM32_Programmer_CLI") {
        return Some(p);
    }
    cubeide_install_roots().iter().find_map(|root| {
        find_bundled_tool(
            root,
            "com.st.stm32cube.ide.mcu.externaltools.cubeprogrammer",
            "tools/bin/STM32_Programmer_CLI",
        )
    })
}

fn with_extra_path(cmd: &mut Command) {
    let mut dirs: Vec<String> = extra_path_dirs()
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    if let Some(bin) = arm_toolchain_bin_dir() {
        dirs.insert(0, bin.to_string_lossy().to_string());
    }
    let extra = dirs.join(":");
    if let Ok(existing) = std::env::var("PATH") {
        cmd.env("PATH", format!("{extra}:{existing}"));
    } else {
        cmd.env("PATH", extra);
    }
}

#[derive(Serialize)]
pub struct Stm32EnvironmentStatus {
    pub arm_gcc_found: bool,
    pub arm_gcc_path: Option<String>,
    pub make_found: bool,
    pub cmake_found: bool,
    pub ninja_found: bool,
    pub cubeide_found: bool,
    pub cubeide_path: Option<String>,
    pub cubemx_found: bool,
    pub cubemx_path: Option<String>,
    pub programmer_cli_found: bool,
    pub openocd_found: bool,
}

#[tauri::command]
pub fn check_stm32_environment() -> Stm32EnvironmentStatus {
    let arm_gcc = arm_gcc_path();
    let cubeide = cubeide_path();
    let cubemx = cubemx_path();
    Stm32EnvironmentStatus {
        arm_gcc_found: arm_gcc.is_some(),
        arm_gcc_path: arm_gcc.map(|p| p.to_string_lossy().to_string()),
        make_found: make_path().is_some(),
        cmake_found: cmake_path().is_some(),
        ninja_found: ninja_path().is_some(),
        cubeide_found: cubeide.is_some(),
        cubeide_path: cubeide.map(|p| p.to_string_lossy().to_string()),
        cubemx_found: cubemx.is_some(),
        cubemx_path: cubemx.map(|p| p.to_string_lossy().to_string()),
        programmer_cli_found: programmer_cli_path().is_some(),
        openocd_found: openocd_path().is_some(),
    }
}

// ---------------------------------------------------------- project detect

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Stm32Flavor {
    /// Eclipse CDT managed-build project (`.project` + `.cproject`), the
    /// default when STM32CubeMX/STM32CubeIDE generates a project for the
    /// "STM32CubeIDE" toolchain.
    CubeIde,
    /// STM32CubeMX generated a plain `Makefile` (its "Makefile" toolchain
    /// option) alongside the `.ioc` file — no Eclipse project files at all.
    Makefile,
    /// STM32CubeIDE 1.9+ can generate a CMake-driven project instead of an
    /// Eclipse managed-build one.
    Cmake,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
pub struct Stm32FlashTools {
    pub programmer_cli: bool,
    pub openocd: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct Stm32ProjectInfo {
    pub root: String,
    pub name: String,
    pub flavor: Stm32Flavor,
    /// Build configuration names parsed out of `.cproject` (e.g. `Debug`,
    /// `Release`) — empty for the Makefile/CMake flavors, which don't have
    /// the concept.
    pub build_configs: Vec<String>,
    pub mcu: Option<String>,
    pub flash_tools: Stm32FlashTools,
}

fn ioc_file(dir: &Path) -> Option<PathBuf> {
    fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| p.extension().map(|e| e == "ioc").unwrap_or(false))
}

fn is_cubeide_project(dir: &Path) -> bool {
    dir.join(".cproject").is_file() && dir.join(".project").is_file()
}

fn is_stm32_makefile_project(dir: &Path) -> bool {
    dir.join("Makefile").is_file() && ioc_file(dir).is_some()
}

fn is_stm32_cmake_project(dir: &Path) -> bool {
    dir.join("CMakeLists.txt").is_file()
        && (dir.join("cmake").join("stm32cubemx").is_dir() || ioc_file(dir).is_some())
}

fn default_build_configs() -> Vec<String> {
    vec!["Debug".to_string(), "Release".to_string()]
}

/// Best-effort parse of `.cproject`'s Eclipse CDT XML for the build
/// configuration names (`Debug`/`Release`/custom names) under each
/// `<cconfiguration>`. Falls back to the conventional Debug/Release pair if
/// the structure doesn't match what's expected — CubeIDE versions have
/// varied this layout slightly over time.
fn parse_cproject_configs(path: &Path) -> Vec<String> {
    let Ok(text) = fs::read_to_string(path) else {
        return default_build_configs();
    };
    let Ok(doc) = roxmltree::Document::parse(&text) else {
        return default_build_configs();
    };

    let mut names = Vec::new();
    for node in doc.descendants() {
        if node.tag_name().name() != "cconfiguration" {
            continue;
        }
        let name = node
            .descendants()
            .find(|n| n.tag_name().name() == "configuration" && n.attribute("name").is_some())
            .and_then(|n| n.attribute("name"))
            .or_else(|| {
                node.descendants()
                    .find(|n| n.tag_name().name() == "storageModule" && n.attribute("name").is_some())
                    .and_then(|n| n.attribute("name"))
            });
        if let Some(name) = name {
            let name = name.to_string();
            if !names.contains(&name) {
                names.push(name);
            }
        }
    }

    if names.is_empty() {
        default_build_configs()
    } else {
        names
    }
}

fn parse_ioc(path: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Ok(text) = fs::read_to_string(path) {
        for line in text.lines() {
            if let Some((k, v)) = line.split_once('=') {
                map.insert(k.trim().to_string(), v.trim().to_string());
            }
        }
    }
    map
}

fn mcu_from_ioc(dir: &Path) -> Option<String> {
    let ioc = ioc_file(dir)?;
    let map = parse_ioc(&ioc);
    map.get("Mcu.UserName")
        .or_else(|| map.get("Mcu.Name"))
        .cloned()
}

pub fn detect_stm32_project(dir: &Path) -> Option<Stm32ProjectInfo> {
    let flavor = if is_cubeide_project(dir) {
        Stm32Flavor::CubeIde
    } else if is_stm32_cmake_project(dir) {
        Stm32Flavor::Cmake
    } else if is_stm32_makefile_project(dir) {
        Stm32Flavor::Makefile
    } else {
        return None;
    };

    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| dir.to_string_lossy().to_string());

    let build_configs = if flavor == Stm32Flavor::CubeIde {
        parse_cproject_configs(&dir.join(".cproject"))
    } else {
        Vec::new()
    };

    Some(Stm32ProjectInfo {
        root: dir.to_string_lossy().to_string(),
        name,
        flavor,
        build_configs,
        mcu: mcu_from_ioc(dir),
        flash_tools: Stm32FlashTools {
            programmer_cli: programmer_cli_path().is_some(),
            openocd: openocd_path().is_some(),
        },
    })
}

// --------------------------------------------------------- project creation

/// The literal toolchain names STM32CubeMX's `-q` script mode expects after
/// `project toolchain` — these are the same strings shown in its own
/// "Toolchain / IDE" dropdown (confirmed against ST's UM1718 user manual and
/// a working `project toolchain STM32CubeIDE` script from ST's community
/// forum).
fn cubemx_toolchain_name(flavor: Stm32Flavor) -> &'static str {
    match flavor {
        Stm32Flavor::CubeIde => "STM32CubeIDE",
        Stm32Flavor::Makefile => "Makefile",
        Stm32Flavor::Cmake => "CMake",
    }
}

#[derive(Debug, Deserialize)]
pub struct NewStm32ProjectRequest {
    pub parent_dir: String,
    pub project_name: String,
    /// Exactly one of `board`/`mcu` should be set: `board` loads one of
    /// STM32CubeMX's known evaluation/Nucleo/Discovery boards (pinout and
    /// clocks pre-configured by ST), `mcu` targets a bare part number with
    /// CubeMX's own defaults and no board-specific setup.
    pub board: Option<String>,
    pub mcu: Option<String>,
    pub toolchain: Stm32Flavor,
}

/// Drives STM32CubeMX's documented headless scripting mode (`-q <script>`,
/// UM1718 ch. 3.3.2) to generate a real project — full HAL/CMSIS sources,
/// startup code and linker script for the chosen toolchain — rather than
/// hand-authoring those files, which would need to be correct per MCU
/// family/package to even compile.
#[tauri::command]
pub fn new_stm32_project(req: NewStm32ProjectRequest) -> Result<crate::project::ProjectInfo, String> {
    let cubemx = cubemx_path().ok_or_else(|| {
        "STM32CubeMX was not found. Install it from st.com/stm32cubemx, then restart TestIDE."
            .to_string()
    })?;

    let board = req.board.as_deref().unwrap_or("").trim();
    let mcu = req.mcu.as_deref().unwrap_or("").trim();
    let load_line = if !board.is_empty() {
        format!("loadboard {board} allmodes")
    } else if !mcu.is_empty() {
        format!("load {mcu}")
    } else {
        return Err("Provide either a board part number or an MCU part number.".to_string());
    };

    let project_dir = PathBuf::from(&req.parent_dir).join(&req.project_name);
    if project_dir.exists() {
        return Err(format!("{} already exists", project_dir.display()));
    }
    fs::create_dir_all(&project_dir)
        .map_err(|e| format!("Failed to create project directory: {e}"))?;

    let script = format!(
        "{load_line}\nproject name {name}\nproject toolchain {toolchain}\nproject path {path}\nproject generate\nexit\n",
        name = req.project_name,
        toolchain = cubemx_toolchain_name(req.toolchain),
        path = project_dir.display(),
    );
    let script_path = project_dir.join(".cubemx-script.txt");
    fs::write(&script_path, &script)
        .map_err(|e| format!("Failed to write CubeMX script: {e}"))?;

    let mut cmd = if cubemx.extension().map(|e| e == "jar").unwrap_or(false) {
        let mut c = Command::new("java");
        c.arg("-jar").arg(&cubemx);
        c
    } else {
        Command::new(&cubemx)
    };
    cmd.arg("-q").arg(&script_path);
    with_extra_path(&mut cmd);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run STM32CubeMX: {e}"))?;
    let _ = fs::remove_file(&script_path);

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "STM32CubeMX project generation failed:\n{stdout}\n{stderr}"
        ));
    }

    detect_stm32_project(&project_dir).map(Into::into).ok_or_else(|| {
        "STM32CubeMX ran but produced no recognizable project — check the board/MCU part \
         number and toolchain choice."
            .to_string()
    })
}

// -------------------------------------------------------------- build/flash

fn run_stm32_task(
    app: AppHandle,
    state: State<AppState>,
    cmd: Command,
    task_id: String,
) -> Result<String, String> {
    let child = spawn_streaming(app, cmd, task_id.clone(), "task-line", "task-done")?;
    state
        .tasks
        .lock()
        .map_err(|_| "task registry lock poisoned")?
        .insert(task_id.clone(), child);
    Ok(task_id)
}

fn cmake_toolchain_file(root: &Path) -> Option<PathBuf> {
    for candidate in [
        root.join("cmake").join("gcc-arm-none-eabi.cmake"),
        root.join("cmake").join("stm32cubemx").join("toolchain.cmake"),
    ] {
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Runs `cmake -B build` if it hasn't been configured yet. This step is
/// synchronous (not streamed) since it's normally a few seconds — only the
/// actual compile is worth showing live progress for.
fn ensure_cmake_configured(root: &Path) -> Result<(), String> {
    let build_dir = root.join("build");
    if build_dir.join("CMakeCache.txt").is_file() {
        return Ok(());
    }
    let cmake = cmake_path().ok_or_else(|| {
        "cmake was not found. Install it (e.g. `brew install cmake`), then retry.".to_string()
    })?;

    let mut cmd = Command::new(cmake);
    cmd.current_dir(root);
    cmd.arg("-S").arg(".").arg("-B").arg("build");
    if ninja_path().is_some() {
        cmd.arg("-G").arg("Ninja");
    } else if make_path().is_none() {
        return Err(
            "Neither ninja nor make was found — install one of them to build CMake-based STM32 projects."
                .to_string(),
        );
    }
    if let Some(tc) = cmake_toolchain_file(root) {
        cmd.arg(format!("-DCMAKE_TOOLCHAIN_FILE={}", tc.display()));
    }
    with_extra_path(&mut cmd);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run cmake configure: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("cmake configure failed: {stderr}"));
    }
    Ok(())
}

fn cubeide_headless_workspace_dir(root: &Path) -> PathBuf {
    root.join(".testide-headless-workspace")
}

fn build_command(root: &Path, flavor: Stm32Flavor, config: &Option<String>) -> Result<Command, String> {
    match flavor {
        Stm32Flavor::Makefile => {
            let make = make_path().ok_or_else(|| {
                "make was not found. Install a GNU Make (e.g. `brew install make`), then retry."
                    .to_string()
            })?;
            arm_gcc_path().ok_or_else(|| {
                "arm-none-eabi-gcc was not found. Install the GNU Arm Embedded Toolchain (e.g. \
                 `brew install --cask gcc-arm-embedded`), then retry."
                    .to_string()
            })?;
            let mut cmd = Command::new(make);
            cmd.current_dir(root);
            cmd.arg("-j");
            with_extra_path(&mut cmd);
            Ok(cmd)
        }
        Stm32Flavor::Cmake => {
            arm_gcc_path().ok_or_else(|| {
                "arm-none-eabi-gcc was not found. Install the GNU Arm Embedded Toolchain (e.g. \
                 `brew install --cask gcc-arm-embedded`), then retry."
                    .to_string()
            })?;
            ensure_cmake_configured(root)?;
            let cmake = cmake_path().ok_or("cmake was not found.")?;
            let mut cmd = Command::new(cmake);
            cmd.current_dir(root);
            cmd.args(["--build", "build"]);
            with_extra_path(&mut cmd);
            Ok(cmd)
        }
        Stm32Flavor::CubeIde => {
            let cubeide = cubeide_path().ok_or_else(|| {
                "STM32CubeIDE was not found. Install it from st.com, or use a Makefile/CMake \
                 STM32CubeMX export instead, then retry."
                    .to_string()
            })?;
            let config = config.clone().unwrap_or_else(|| "Debug".to_string());
            let name = root
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let workspace = cubeide_headless_workspace_dir(root);
            let mut cmd = Command::new(cubeide);
            cmd.args(["-nosplash", "-application", "org.eclipse.cdt.managedbuilder.core.headlessbuild"]);
            cmd.arg("-data").arg(&workspace);
            cmd.arg("-importAll").arg(root);
            cmd.arg("-cleanBuild").arg(format!("{name}/{config}"));
            Ok(cmd)
        }
    }
}

#[tauri::command]
pub fn stm32_build(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    flavor: Stm32Flavor,
    config: Option<String>,
    task_id: String,
) -> Result<String, String> {
    let root = PathBuf::from(&project_path);
    let cmd = build_command(&root, flavor, &config)?;
    run_stm32_task(app, state, cmd, task_id)
}

#[tauri::command]
pub fn stm32_clean(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    flavor: Stm32Flavor,
    config: Option<String>,
    task_id: String,
) -> Result<String, String> {
    let root = PathBuf::from(&project_path);
    match flavor {
        Stm32Flavor::Makefile => {
            let make = make_path().ok_or("make was not found.")?;
            let mut cmd = Command::new(make);
            cmd.current_dir(&root).arg("clean");
            with_extra_path(&mut cmd);
            run_stm32_task(app, state, cmd, task_id)
        }
        Stm32Flavor::Cmake => {
            let cmake = cmake_path().ok_or("cmake was not found.")?;
            let mut cmd = Command::new(cmake);
            cmd.current_dir(&root).args(["--build", "build", "--target", "clean"]);
            with_extra_path(&mut cmd);
            run_stm32_task(app, state, cmd, task_id)
        }
        Stm32Flavor::CubeIde => {
            // The CDT headless builder has no standalone "clean" action —
            // remove the configuration's output directory directly instead.
            let config = config.unwrap_or_else(|| "Debug".to_string());
            let out_dir = root.join(&config);
            if out_dir.is_dir() {
                fs::remove_dir_all(&out_dir)
                    .map_err(|e| format!("Failed to remove {}: {e}", out_dir.display()))?;
            }
            // Still surface something in the task-output log, so the
            // frontend's existing "run + stream + done" flow works unchanged.
            let mut cmd = Command::new("echo");
            cmd.arg(format!("Removed {}", out_dir.display()));
            run_stm32_task(app, state, cmd, task_id)
        }
    }
}

fn find_elf_in_dir(dir: &Path) -> Option<PathBuf> {
    fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .find(|p| p.extension().map(|e| e == "elf").unwrap_or(false))
}

fn locate_build_artifact(root: &Path, flavor: Stm32Flavor, config: &Option<String>) -> Result<PathBuf, String> {
    let dir = match flavor {
        Stm32Flavor::Makefile | Stm32Flavor::Cmake => root.join("build"),
        Stm32Flavor::CubeIde => root.join(config.clone().unwrap_or_else(|| "Debug".to_string())),
    };
    find_elf_in_dir(&dir)
        .or_else(|| find_elf_in_dir(root))
        .ok_or_else(|| {
            format!(
                "No .elf build artifact found in {} — build the project first.",
                dir.display()
            )
        })
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FlashTool {
    ProgrammerCli,
    Openocd,
}

/// Maps the STM32 part number recorded in `.ioc` (e.g. `STM32F407VGTx`) to
/// the OpenOCD target config file for that family. Falls back to the F4
/// family (the most common Nucleo/Discovery boards) when the family can't be
/// determined — flashing still works via ST-Link SWD auto-detection in most
/// cases, but a wrong target file can make OpenOCD's setup less reliable.
fn openocd_target_cfg(mcu: &str) -> &'static str {
    let u = mcu.to_uppercase();
    let family = |prefix: &str| u.starts_with(prefix);
    if family("STM32F0") {
        "target/stm32f0x.cfg"
    } else if family("STM32F1") {
        "target/stm32f1x.cfg"
    } else if family("STM32F2") {
        "target/stm32f2x.cfg"
    } else if family("STM32F3") {
        "target/stm32f3x.cfg"
    } else if family("STM32F4") {
        "target/stm32f4x.cfg"
    } else if family("STM32F7") {
        "target/stm32f7x.cfg"
    } else if family("STM32G0") {
        "target/stm32g0x.cfg"
    } else if family("STM32G4") {
        "target/stm32g4x.cfg"
    } else if family("STM32H7") {
        "target/stm32h7x.cfg"
    } else if family("STM32L0") {
        "target/stm32l0.cfg"
    } else if family("STM32L1") {
        "target/stm32l1.cfg"
    } else if family("STM32L4") {
        "target/stm32l4x.cfg"
    } else if family("STM32L5") {
        "target/stm32l5x.cfg"
    } else if family("STM32U5") {
        "target/stm32u5x.cfg"
    } else if family("STM32WB") {
        "target/stm32wbx.cfg"
    } else if family("STM32WL") {
        "target/stm32wlx.cfg"
    } else if family("STM32C0") {
        "target/stm32c0x.cfg"
    } else {
        "target/stm32f4x.cfg"
    }
}

#[tauri::command]
pub fn stm32_flash(
    app: AppHandle,
    state: State<AppState>,
    project_path: String,
    flavor: Stm32Flavor,
    config: Option<String>,
    tool: FlashTool,
    task_id: String,
) -> Result<String, String> {
    let root = PathBuf::from(&project_path);
    let artifact = locate_build_artifact(&root, flavor, &config)?;

    let cmd = match tool {
        FlashTool::ProgrammerCli => {
            let cli = programmer_cli_path().ok_or_else(|| {
                "STM32_Programmer_CLI was not found. Install STM32CubeProgrammer from st.com, \
                 then retry."
                    .to_string()
            })?;
            let mut cmd = Command::new(cli);
            cmd.arg("-c").arg("port=SWD");
            cmd.arg("-w").arg(&artifact);
            cmd.arg("-v");
            cmd.arg("-rst");
            cmd
        }
        FlashTool::Openocd => {
            let openocd = openocd_path().ok_or_else(|| {
                "OpenOCD was not found. Install it (e.g. `brew install openocd`), then retry."
                    .to_string()
            })?;
            let mcu = mcu_from_ioc(&root).unwrap_or_default();
            let target_cfg = openocd_target_cfg(&mcu);
            let mut cmd = Command::new(openocd);
            cmd.args(["-f", "interface/stlink.cfg", "-f", target_cfg]);
            cmd.arg("-c");
            cmd.arg(format!("program {} verify reset exit", artifact.display()));
            cmd
        }
    };

    run_stm32_task(app, state, cmd, task_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "testide-stm32-test-{name}-{:?}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const SAMPLE_CPROJECT: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?fileVersion 4.0.0?>
<cproject storage_type_id="org.eclipse.cdt.core.XmlProjectDescriptionStorage">
  <storageModule moduleId="org.eclipse.cdt.core.settings">
    <cconfiguration id="com.st.stm32cube.ide.mcu.gnu.managedbuild.config.exe.debug.123">
      <storageModule buildSystemId="org.eclipse.cdt.managedbuilder.core.configurationDataProvider" id="a" moduleId="org.eclipse.cdt.core.settings" name="Debug">
      </storageModule>
      <storageModule moduleId="cdtBuildSystem" version="4.0.0">
        <configuration artifactName="demo" id="a" name="Debug">
        </configuration>
      </storageModule>
    </cconfiguration>
    <cconfiguration id="com.st.stm32cube.ide.mcu.gnu.managedbuild.config.exe.release.456">
      <storageModule buildSystemId="org.eclipse.cdt.managedbuilder.core.configurationDataProvider" id="b" moduleId="org.eclipse.cdt.core.settings" name="Release">
      </storageModule>
      <storageModule moduleId="cdtBuildSystem" version="4.0.0">
        <configuration artifactName="demo" id="b" name="Release">
        </configuration>
      </storageModule>
    </cconfiguration>
  </storageModule>
</cproject>
"#;

    const SAMPLE_IOC: &str = "#MicroXplorer Configuration settings - do not modify\n\
Mcu.Family=STM32F4\n\
Mcu.IPNb=6\n\
Mcu.Name=STM32F407V(E-G)Tx\n\
Mcu.Package=LQFP100\n\
Mcu.UserName=STM32F407VGTx\n";

    #[test]
    fn detects_cubeide_project() {
        let dir = unique_temp_dir("cubeide");
        fs::write(dir.join(".project"), "<projectDescription/>").unwrap();
        fs::write(dir.join(".cproject"), SAMPLE_CPROJECT).unwrap();
        fs::write(dir.join("demo.ioc"), SAMPLE_IOC).unwrap();

        let info = detect_stm32_project(&dir).expect("should detect a CubeIDE project");
        assert_eq!(info.flavor, Stm32Flavor::CubeIde);
        assert_eq!(info.build_configs, vec!["Debug".to_string(), "Release".to_string()]);
        assert_eq!(info.mcu.as_deref(), Some("STM32F407VGTx"));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn detects_makefile_project() {
        let dir = unique_temp_dir("makefile");
        fs::write(dir.join("Makefile"), "all:\n\techo build\n").unwrap();
        fs::write(dir.join("demo.ioc"), SAMPLE_IOC).unwrap();

        let info = detect_stm32_project(&dir).expect("should detect a Makefile project");
        assert_eq!(info.flavor, Stm32Flavor::Makefile);
        assert!(info.build_configs.is_empty());
        assert_eq!(info.mcu.as_deref(), Some("STM32F407VGTx"));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn detects_cmake_project() {
        let dir = unique_temp_dir("cmake");
        fs::write(dir.join("CMakeLists.txt"), "cmake_minimum_required(VERSION 3.22)\n").unwrap();
        fs::create_dir_all(dir.join("cmake").join("stm32cubemx")).unwrap();
        fs::write(dir.join("demo.ioc"), SAMPLE_IOC).unwrap();

        let info = detect_stm32_project(&dir).expect("should detect a CMake project");
        assert_eq!(info.flavor, Stm32Flavor::Cmake);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn does_not_detect_plain_directory() {
        let dir = unique_temp_dir("plain");
        fs::write(dir.join("readme.txt"), "nothing here\n").unwrap();
        assert!(detect_stm32_project(&dir).is_none());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn parses_mcu_family_target_cfg() {
        assert_eq!(openocd_target_cfg("STM32F407VGTx"), "target/stm32f4x.cfg");
        assert_eq!(openocd_target_cfg("STM32H743ZIT6"), "target/stm32h7x.cfg");
        assert_eq!(openocd_target_cfg("STM32L476RGT6"), "target/stm32l4x.cfg");
        assert_eq!(openocd_target_cfg("unknown-part"), "target/stm32f4x.cfg");
    }
}
