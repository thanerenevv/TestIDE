import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { clear, h } from "./dom";
import { installEspIdf, installPlatformio } from "./toolchainInstall";
import type { BoardDefinition, ProjectInfo, Stm32Flavor } from "./types";

const IDF_TARGETS = [
  "esp32",
  "esp32s2",
  "esp32s3",
  "esp32c2",
  "esp32c3",
  "esp32c6",
  "esp32h2",
  "esp32p4",
];

type Mode = "platformio" | "esp-idf" | "stm32";
type Stm32TargetMode = "board" | "mcu";

export function openInstallToolchainModal(onRetry: () => void) {
  const overlay = h("div", { class: "modal-overlay" });

  const pioBtn = h("button", { class: "btn btn-primary" }, ["Install PlatformIO"]);
  pioBtn.addEventListener("click", () => installPlatformio());
  const idfBtn = h("button", { class: "btn btn-primary" }, ["Install ESP-IDF"]);
  idfBtn.addEventListener("click", () => installEspIdf());

  const retryBtn = h("button", { class: "btn" }, ["I've installed one, recheck"]);
  retryBtn.addEventListener("click", () => {
    overlay.remove();
    onRetry();
  });
  const cancelBtn = h("button", { class: "btn" }, ["Cancel"]);
  cancelBtn.addEventListener("click", () => overlay.remove());

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const modal = h("div", { class: "modal", style: "width:420px" }, [
    h("div", { class: "modal-header" }, ["No Toolchain Found"]),
    h("div", { class: "modal-body" }, [
      h("div", { class: "install-prompt" }, [
        h("p", { style: "margin:0;color:var(--text-2);font-size:12.5px;line-height:1.5" }, [
          "TestIDE couldn't find PlatformIO or ESP-IDF on this system. Install one of them to create a new project.",
        ]),
        h("div", { class: "install-actions" }, [pioBtn, idfBtn]),
      ]),
    ]),
    h("div", { class: "modal-footer" }, [cancelBtn, retryBtn]),
  ]);
  overlay.append(modal);
  document.body.append(overlay);
}

export function openNewProjectModal(
  onCreated: (info: ProjectInfo) => void,
  toolchains: { pioAvailable: boolean; idfAvailable: boolean; stm32Available: boolean } = {
    pioAvailable: true,
    idfAvailable: true,
    stm32Available: true,
  },
) {
  let mode: Mode = toolchains.pioAvailable
    ? "platformio"
    : toolchains.idfAvailable
      ? "esp-idf"
      : "stm32";
  let parentDir = "";
  let selectedBoard: BoardDefinition | null = null;
  let selectedFramework = "";
  let selectedTarget = IDF_TARGETS[0];
  let stm32TargetMode: Stm32TargetMode = "board";
  let searchTimer: number | undefined;

  const overlay = h("div", { class: "modal-overlay" });
  const nameInput = h("input", {
    type: "text",
    placeholder: "my-esp32-project",
  }) as HTMLInputElement;
  const dirLabel = h("span", { class: "port-desc" }, ["No folder chosen"]);
  const chooseDirBtn = h("button", { class: "btn" }, ["Choose Folder…"]);
  const searchInput = h("input", {
    type: "text",
    placeholder: "Search boards (e.g. esp32, esp32-s3, uno)…",
  }) as HTMLInputElement;
  const resultsEl = h("div", { class: "board-results" });
  const frameworkSelect = h("select") as HTMLSelectElement;
  const targetSelect = h(
    "select",
    {},
    IDF_TARGETS.map((t) => h("option", { value: t }, [t])),
  ) as HTMLSelectElement;
  const createBtn = h("button", { class: "btn btn-primary" }, [
    "Create Project",
  ]) as HTMLButtonElement;
  const errorEl = h("div", {
    class: "welcome-warning",
    style: "display:none",
  });

  createBtn.disabled = true;

  const pioModeBtn = h("button", { class: "btn btn-primary" }, ["PlatformIO"]) as HTMLButtonElement;
  const idfModeBtn = h("button", { class: "btn" }, ["ESP-IDF"]) as HTMLButtonElement;
  const stm32ModeBtn = h("button", { class: "btn" }, ["STM32"]) as HTMLButtonElement;
  pioModeBtn.disabled = !toolchains.pioAvailable;
  idfModeBtn.disabled = !toolchains.idfAvailable;
  stm32ModeBtn.disabled = !toolchains.stm32Available;
  if (!toolchains.pioAvailable) pioModeBtn.title = "PlatformIO was not detected on this system";
  if (!toolchains.idfAvailable) idfModeBtn.title = "ESP-IDF was not detected on this system";
  if (!toolchains.stm32Available) stm32ModeBtn.title = "STM32CubeMX was not detected on this system";
  const modeToggle = h("div", { class: "toolbar-group" }, [pioModeBtn, idfModeBtn, stm32ModeBtn]);

  const boardField = h("div", { class: "field" }, [
    h("label", {}, ["Board"]),
    searchInput,
    resultsEl,
  ]);
  const frameworkField = h("div", { class: "field" }, [
    h("label", {}, ["Framework"]),
    frameworkSelect,
  ]);
  const targetField = h("div", { class: "field", style: "display:none" }, [
    h("label", {}, ["Target Chip"]),
    targetSelect,
  ]);

  // ---- STM32: board (STM32CubeMX's own board DB, pinout/clocks preset) or
  // bare MCU part number (unconfigured, for custom hardware) ----
  const stm32BoardModeBtn = h("button", { class: "btn btn-primary" }, ["Board"]) as HTMLButtonElement;
  const stm32McuModeBtn = h("button", { class: "btn" }, ["Bare MCU"]) as HTMLButtonElement;
  const stm32TargetModeToggle = h("div", { class: "toolbar-group" }, [
    stm32BoardModeBtn,
    stm32McuModeBtn,
  ]);
  const stm32BoardInput = h("input", {
    type: "text",
    placeholder: "e.g. NUCLEO-F401RE",
  }) as HTMLInputElement;
  const stm32McuInput = h("input", {
    type: "text",
    placeholder: "e.g. STM32F407VGTx",
  }) as HTMLInputElement;
  const stm32ToolchainSelect = h(
    "select",
    {},
    [
      h("option", { value: "cube-ide" }, ["STM32CubeIDE"]),
      h("option", { value: "makefile" }, ["Makefile"]),
      h("option", { value: "cmake" }, ["CMake"]),
    ],
  ) as HTMLSelectElement;

  const stm32TargetModeField = h("div", { class: "field", style: "display:none" }, [
    h("label", {}, ["Target"]),
    stm32TargetModeToggle,
  ]);
  const stm32BoardField = h("div", { class: "field", style: "display:none" }, [
    h("label", {}, ["Board"]),
    stm32BoardInput,
  ]);
  const stm32McuField = h("div", { class: "field", style: "display:none" }, [
    h("label", {}, ["MCU"]),
    stm32McuInput,
  ]);
  const stm32ToolchainField = h("div", { class: "field", style: "display:none" }, [
    h("label", {}, ["Project Type"]),
    stm32ToolchainSelect,
  ]);

  function setStm32TargetMode(next: Stm32TargetMode) {
    stm32TargetMode = next;
    stm32BoardModeBtn.className = stm32TargetMode === "board" ? "btn btn-primary" : "btn";
    stm32McuModeBtn.className = stm32TargetMode === "mcu" ? "btn btn-primary" : "btn";
    stm32BoardField.style.display = mode === "stm32" && stm32TargetMode === "board" ? "flex" : "none";
    stm32McuField.style.display = mode === "stm32" && stm32TargetMode === "mcu" ? "flex" : "none";
    updateCreateEnabled();
  }
  stm32BoardModeBtn.addEventListener("click", () => setStm32TargetMode("board"));
  stm32McuModeBtn.addEventListener("click", () => setStm32TargetMode("mcu"));
  stm32BoardInput.addEventListener("input", updateCreateEnabled);
  stm32McuInput.addEventListener("input", updateCreateEnabled);

  function updateCreateEnabled() {
    const base = !!(nameInput.value.trim() && parentDir);
    if (mode === "platformio") {
      createBtn.disabled = !(base && selectedBoard && selectedFramework);
    } else if (mode === "stm32") {
      const targetOk =
        stm32TargetMode === "board" ? !!stm32BoardInput.value.trim() : !!stm32McuInput.value.trim();
      createBtn.disabled = !(base && targetOk);
    } else {
      createBtn.disabled = !base;
    }
  }

  function setMode(next: Mode) {
    mode = next;
    pioModeBtn.className = mode === "platformio" ? "btn btn-primary" : "btn";
    idfModeBtn.className = mode === "esp-idf" ? "btn btn-primary" : "btn";
    stm32ModeBtn.className = mode === "stm32" ? "btn btn-primary" : "btn";
    boardField.style.display = mode === "platformio" ? "flex" : "none";
    frameworkField.style.display = mode === "platformio" ? "flex" : "none";
    targetField.style.display = mode === "esp-idf" ? "flex" : "none";
    stm32TargetModeField.style.display = mode === "stm32" ? "flex" : "none";
    stm32BoardField.style.display = mode === "stm32" && stm32TargetMode === "board" ? "flex" : "none";
    stm32McuField.style.display = mode === "stm32" && stm32TargetMode === "mcu" ? "flex" : "none";
    stm32ToolchainField.style.display = mode === "stm32" ? "flex" : "none";
    updateCreateEnabled();
  }

  pioModeBtn.addEventListener("click", () => setMode("platformio"));
  idfModeBtn.addEventListener("click", () => setMode("esp-idf"));
  stm32ModeBtn.addEventListener("click", () => setMode("stm32"));

  chooseDirBtn.addEventListener("click", async () => {
    const dir = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose a location for the new project",
    });
    if (typeof dir === "string") {
      parentDir = dir;
      dirLabel.textContent = dir;
      updateCreateEnabled();
    }
  });

  nameInput.addEventListener("input", updateCreateEnabled);

  function renderResults(boards: BoardDefinition[]) {
    clear(resultsEl);
    if (boards.length === 0) {
      resultsEl.append(
        h("div", { class: "empty-hint" }, ["No matching boards."]),
      );
      return;
    }
    resultsEl.append(
      ...boards.slice(0, 80).map((b) =>
        h(
          "div",
          {
            class:
              selectedBoard?.id === b.id
                ? "board-result selected"
                : "board-result",
            onclick: () => {
              selectedBoard = b;
              clear(frameworkSelect);
              frameworkSelect.append(
                ...b.frameworks.map((f) => h("option", { value: f }, [f])),
              );
              selectedFramework = b.frameworks[0] ?? "";
              renderResults(boards);
              updateCreateEnabled();
            },
          },
          [
            h("div", { class: "board-name" }, [b.name]),
            h("div", { class: "board-meta" }, [
              `${b.id} · ${b.platform} · ${b.mcu}`,
            ]),
          ],
        ),
      ),
    );
  }

  async function doSearch(query: string) {
    clear(resultsEl);
    resultsEl.append(h("div", { class: "empty-hint" }, ["Searching…"]));
    try {
      const boards = await api.searchBoards(query);
      renderResults(boards);
    } catch (e) {
      clear(resultsEl);
      resultsEl.append(h("div", { class: "empty-hint" }, [String(e)]));
    }
  }

  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => doSearch(searchInput.value), 350);
  });

  frameworkSelect.addEventListener("change", () => {
    selectedFramework = frameworkSelect.value;
    updateCreateEnabled();
  });

  targetSelect.addEventListener("change", () => {
    selectedTarget = targetSelect.value;
  });

  createBtn.addEventListener("click", async () => {
    if (mode === "platformio" && !selectedBoard) return;
    createBtn.disabled = true;
    createBtn.textContent = "Creating…";
    errorEl.style.display = "none";
    try {
      const info =
        mode === "platformio"
          ? await api.newProject({
              parent_dir: parentDir,
              project_name: nameInput.value.trim(),
              board_id: selectedBoard!.id,
              framework: selectedFramework,
            })
          : mode === "stm32"
            ? await api.newStm32Project({
                parent_dir: parentDir,
                project_name: nameInput.value.trim(),
                board: stm32TargetMode === "board" ? stm32BoardInput.value.trim() : null,
                mcu: stm32TargetMode === "mcu" ? stm32McuInput.value.trim() : null,
                toolchain: stm32ToolchainSelect.value as Stm32Flavor,
              })
            : await api.newIdfProject({
                parent_dir: parentDir,
                project_name: nameInput.value.trim(),
                target: selectedTarget,
              });
      overlay.remove();
      onCreated(info);
    } catch (e) {
      errorEl.style.display = "block";
      errorEl.textContent = String(e);
      createBtn.disabled = false;
      createBtn.textContent = "Create Project";
    }
  });

  const cancelBtn = h("button", { class: "btn" }, ["Cancel"]);
  cancelBtn.addEventListener("click", () => overlay.remove());

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const modal = h("div", { class: "modal", style: "width:520px" }, [
    h("div", { class: "modal-header" }, ["New Project"]),
    h("div", { class: "modal-body" }, [
      h("div", { class: "field" }, [h("label", {}, ["Toolchain"]), modeToggle]),
      h("div", { class: "field" }, [
        h("label", {}, ["Project Name"]),
        nameInput,
      ]),
      h("div", { class: "field" }, [
        h("label", {}, ["Location"]),
        h("div", { class: "toolbar-group" }, [chooseDirBtn, dirLabel]),
      ]),
      boardField,
      frameworkField,
      targetField,
      stm32TargetModeField,
      stm32BoardField,
      stm32McuField,
      stm32ToolchainField,
      errorEl,
    ]),
    h("div", { class: "modal-footer" }, [cancelBtn, createBtn]),
  ]);
  overlay.append(modal);
  document.body.append(overlay);
  setMode(mode);
  doSearch("");
}
