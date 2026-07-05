import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { clear, h } from "./dom";
import { installEspIdf, installPlatformio } from "./toolchainInstall";
import type { BoardDefinition, ProjectInfo } from "./types";

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

type Mode = "platformio" | "esp-idf";

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
  toolchains: { pioAvailable: boolean; idfAvailable: boolean } = {
    pioAvailable: true,
    idfAvailable: true,
  },
) {
  let mode: Mode = toolchains.pioAvailable ? "platformio" : "esp-idf";
  let parentDir = "";
  let selectedBoard: BoardDefinition | null = null;
  let selectedFramework = "";
  let selectedTarget = IDF_TARGETS[0];
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
  pioModeBtn.disabled = !toolchains.pioAvailable;
  idfModeBtn.disabled = !toolchains.idfAvailable;
  if (!toolchains.pioAvailable) pioModeBtn.title = "PlatformIO was not detected on this system";
  if (!toolchains.idfAvailable) idfModeBtn.title = "ESP-IDF was not detected on this system";
  const modeToggle = h("div", { class: "toolbar-group" }, [pioModeBtn, idfModeBtn]);

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

  function updateCreateEnabled() {
    const base = !!(nameInput.value.trim() && parentDir);
    createBtn.disabled = mode === "platformio" ? !(base && selectedBoard && selectedFramework) : !base;
  }

  function setMode(next: Mode) {
    mode = next;
    pioModeBtn.className = mode === "platformio" ? "btn btn-primary" : "btn";
    idfModeBtn.className = mode === "esp-idf" ? "btn btn-primary" : "btn";
    boardField.style.display = mode === "platformio" ? "flex" : "none";
    frameworkField.style.display = mode === "platformio" ? "flex" : "none";
    targetField.style.display = mode === "esp-idf" ? "flex" : "none";
    updateCreateEnabled();
  }

  pioModeBtn.addEventListener("click", () => setMode("platformio"));
  idfModeBtn.addEventListener("click", () => setMode("esp-idf"));

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
      errorEl,
    ]),
    h("div", { class: "modal-footer" }, [cancelBtn, createBtn]),
  ]);
  overlay.append(modal);
  document.body.append(overlay);
  setMode(mode);
  doSearch("");
}
