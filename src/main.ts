import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  api,
  onBoardsUpdated,
  onMenuAction,
  onMonitorDone,
  onMonitorLine,
  onTaskDone,
  onTaskLine,
} from "./api";
import { showContextMenu, type MenuItem } from "./contextMenu";
import { confirmModal, promptModal } from "./dialogs";
import { clear, h } from "./dom";
import { EditorHost } from "./editor";
import { classifyError } from "./errors";
import { languageForFile } from "./fileIcons";
import { LogView } from "./logView";
import { openInstallToolchainModal, openNewProjectModal } from "./newProjectModal";
import { makeResizerH, makeResizerV } from "./resizer";
import { renderDevices, renderTree } from "./sidebar";
import { loadSettings, saveSettings, type Settings } from "./settings";
import { openSettingsModal } from "./settingsModal";
import { store } from "./store";
import { TerminalPane } from "./terminal";
import type { ProjectInfo, TaskKind } from "./types";

const BAUD_RATES = [9600, 19200, 38400, 57600, 74880, 115200, 230400, 460800, 921600];

class App {
  private root = document.getElementById("app")!;

  private titlebar!: HTMLElement;
  private projectNameEl!: HTMLElement;
  private envSelect!: HTMLSelectElement;
  private buildBtn!: HTMLButtonElement;
  private flashBtn!: HTMLButtonElement;
  private cleanBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;

  private body!: HTMLElement;
  private sidebar!: HTMLElement;
  private treeEl!: HTMLElement;
  private portSelect!: HTMLSelectElement;
  private portDetail!: HTMLElement;
  private editorArea!: HTMLElement;
  private tabBar!: HTMLElement;
  private editorHostEl!: HTMLElement;
  private editorEmptyEl!: HTMLElement;

  private bottomPanel!: HTMLElement;
  private bottomTabBuild!: HTMLElement;
  private bottomTabMonitor!: HTMLElement;
  private bottomTabTerminal!: HTMLElement;
  private clearLogBtn!: HTMLElement;
  private monitorLiveDot!: HTMLElement;
  private monitorToolbar!: HTMLElement;
  private baudSelect!: HTMLSelectElement;
  private terminalToolbar!: HTMLElement;
  private terminalTabsEl!: HTMLElement;
  private terminalHostEl!: HTMLElement;

  private welcomeEl!: HTMLElement;
  private banner: HTMLElement | null = null;

  private statusbar!: HTMLElement;
  private statusDot!: HTMLElement;
  private statusText!: HTMLElement;
  private toolchainInfoEl!: HTMLElement;
  private envPickerLabel!: HTMLElement;

  private sidebarResizer!: HTMLElement;
  private bottomResizer!: HTMLElement;

  private editorHost: EditorHost | null = null;
  private buildLog = new LogView();
  private monitorLog = new LogView();

  private expandedDirs = new Set<string>();
  private currentTaskKind: TaskKind | "set-target" | null = null;
  private pendingTarget: string | null = null;
  private taskLogBuffer = "";
  private pioVersionText = "PlatformIO not found";
  private idfVersionText = "ESP-IDF not found";
  private sidebarHidden = false;
  private panelHidden = false;
  private settings: Settings = loadSettings();

  private terminals = new Map<string, TerminalPane>();
  private activeTerminalId: string | null = null;
  private terminalCounter = 0;

  async start() {
    this.mount();
    this.editorHost = new EditorHost(this.editorHostEl, this.settings);
    this.editorHost.onDirtyChange = (path, dirty) => this.setTabDirty(path, dirty);
    this.editorHost.onSave = (path) => this.saveFile(path);

    window.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const active = store.get().activeTab;
        if (active) this.saveFile(active);
      }
    });
    window.addEventListener("resize", () => this.resizeActiveTerminal());

    this.subscribeEvents();
    await this.checkEnvironments();
    this.refreshUI();

    const ports = await api.listBoards().catch(() => []);
    store.set({ ports, selectedPort: ports[0]?.port ?? null });
    this.refreshUI();
  }

  // ---------------------------------------------------------------- mount

  private mount() {
    this.buildTitlebar();
    this.buildBody();
    this.buildBottomPanel();
    this.buildStatusbar();
    this.welcomeEl = this.buildWelcome();

    this.root.append(
      this.titlebar,
      this.welcomeEl,
      this.body,
      this.bottomPanel,
      this.statusbar,
    );

    makeResizerV(this.sidebar, this.sidebarResizer, 160, 480, () =>
      this.editorHost?.layout(),
    );
    makeResizerH(this.bottomPanel, this.bottomResizer, 100, 560, () => {
      this.editorHost?.layout();
      this.resizeActiveTerminal();
    });
  }

  private buildTitlebar() {
    this.projectNameEl = h("span", { class: "project-name" }, ["No Project"]);

    const openBtn = h("button", { class: "btn" }, ["Open…"]);
    openBtn.addEventListener("click", () => this.openProjectFlow());
    const newBtn = h("button", { class: "btn" }, ["New…"]);
    newBtn.addEventListener("click", () => this.newProjectFlow());

    this.envSelect = h("select", {}, []) as HTMLSelectElement;
    this.envSelect.addEventListener("change", () => this.onEnvPickerChange());
    this.envPickerLabel = h("span", { style: "color: var(--text-2); font-size: 11px" }, ["Env"]);
    const envPicker = h("div", { class: "picker" }, [this.envPickerLabel, this.envSelect]);

    this.buildBtn = h("button", { class: "btn" }, ["Build"]) as HTMLButtonElement;
    this.buildBtn.addEventListener("click", () => this.runTask("build"));

    this.flashBtn = h("button", { class: "btn btn-primary flash-btn" }, [
      h("span", { class: "icon" }, ["▶"]),
      "Flash",
    ]) as HTMLButtonElement;
    this.flashBtn.addEventListener("click", () => this.runTask("upload"));

    this.cleanBtn = h("button", { class: "btn" }, ["Clean"]) as HTMLButtonElement;
    this.cleanBtn.addEventListener("click", () => this.runTask("clean"));

    this.stopBtn = h("button", { class: "btn btn-danger" }, ["Stop"]) as HTMLButtonElement;
    this.stopBtn.addEventListener("click", () => this.stopActive());

    const settingsBtn = h("button", { class: "icon-btn", title: "Settings" }, ["⚙"]);
    settingsBtn.addEventListener("click", () => this.openSettings());

    this.titlebar = h("div", { class: "titlebar", "data-tauri-drag-region": true }, [
      this.projectNameEl,
      h("div", { class: "toolbar-group" }, [openBtn, newBtn]),
      h("div", { class: "toolbar-spacer" }, []),
      envPicker,
      h("div", { class: "toolbar-group" }, [
        this.buildBtn,
        this.flashBtn,
        this.cleanBtn,
        this.stopBtn,
      ]),
      settingsBtn,
    ]);
  }

  private buildBody() {
    // --- sidebar ---
    this.treeEl = h("div", { class: "tree" }, []);
    const newFileBtn = h("button", { class: "icon-btn", title: "New File" }, ["＋"]);
    newFileBtn.addEventListener("click", () => this.createEntryFlow(null, false));
    const newFolderBtn = h("button", { class: "icon-btn", title: "New Folder" }, ["⌂"]);
    newFolderBtn.addEventListener("click", () => this.createEntryFlow(null, true));
    const refreshBtn = h("button", { class: "icon-btn", title: "Refresh" }, ["↻"]);
    refreshBtn.addEventListener("click", () => this.refreshTree());

    const filesSection = h("div", { class: "sidebar-section files" }, [
      h("div", { class: "sidebar-header" }, [
        "Explorer",
        h("div", { class: "actions" }, [newFileBtn, newFolderBtn, refreshBtn]),
      ]),
      this.treeEl,
    ]);

    this.portSelect = h("select", {}, []) as HTMLSelectElement;
    this.portDetail = h("div", {}, []);
    const devicesRefreshBtn = h("button", { class: "icon-btn", title: "Refresh" }, ["↻"]);
    devicesRefreshBtn.addEventListener("click", () => this.refreshBoards());

    const devicesSection = h("div", { class: "sidebar-section devices" }, [
      h("div", { class: "sidebar-header" }, [
        "Devices",
        h("div", { class: "actions" }, [devicesRefreshBtn]),
      ]),
      h("div", { style: "padding: 0 12px 8px" }, [this.portSelect]),
      h("div", { style: "padding: 0 12px 10px" }, [this.portDetail]),
    ]);

    this.sidebar = h("div", { class: "sidebar" }, [filesSection, devicesSection]);
    this.sidebarResizer = h("div", { class: "resizer-v" });

    // --- editor area ---
    this.tabBar = h("div", { class: "tab-bar" }, []);
    this.editorHostEl = h("div", { class: "editor-host" }, []);
    this.editorEmptyEl = h("div", { class: "editor-empty" }, [
      h("div", {}, ["No file open"]),
      h("div", { style: "font-size: 11px" }, [
        "Select a file from the Explorer to start editing",
      ]),
    ]);
    this.editorArea = h("div", { class: "editor-area" }, [
      this.tabBar,
      this.editorHostEl,
      this.editorEmptyEl,
    ]);

    this.body = h("div", { class: "body" }, [
      this.sidebar,
      this.sidebarResizer,
      this.editorArea,
    ]);
  }

  private buildBottomPanel() {
    this.bottomResizer = h("div", { class: "resizer-h" });

    this.monitorLiveDot = h("span", { class: "live-dot" }, []);
    this.bottomTabBuild = h("div", { class: "bottom-tab active" }, ["Build Output"]);
    this.bottomTabBuild.addEventListener("click", () => this.switchBottomTab("build"));
    this.bottomTabMonitor = h("div", { class: "bottom-tab" }, ["Serial Monitor"]);
    this.bottomTabMonitor.addEventListener("click", () => this.switchBottomTab("monitor"));
    this.bottomTabTerminal = h("div", { class: "bottom-tab" }, ["Terminal"]);
    this.bottomTabTerminal.addEventListener("click", () => this.switchBottomTab("terminal"));

    this.clearLogBtn = h("button", { class: "icon-btn", title: "Clear" }, ["⊘"]);
    this.clearLogBtn.addEventListener("click", () => {
      if (store.get().bottomTab === "build") this.buildLog.clearLog();
      else this.monitorLog.clearLog();
    });

    const tabsRow = h("div", { class: "bottom-tabs" }, [
      this.bottomTabBuild,
      this.bottomTabMonitor,
      this.bottomTabTerminal,
      h("div", { class: "bottom-tab-spacer" }, []),
      this.clearLogBtn,
    ]);

    this.baudSelect = h(
      "select",
      {},
      BAUD_RATES.map((b) => h("option", { value: String(b) }, [`${b} baud`])),
    ) as HTMLSelectElement;
    this.baudSelect.value = String(this.settings.defaultBaud);
    const restartBtn = h("button", { class: "btn" }, ["Restart Monitor"]);
    restartBtn.addEventListener("click", () => this.startMonitor());

    this.monitorToolbar = h(
      "div",
      { class: "monitor-toolbar", style: "display:none" },
      [
        h("span", { style: "font-size:11px; color:var(--text-2)" }, ["Baud"]),
        this.baudSelect,
        restartBtn,
      ],
    );

    this.monitorLog.el.style.display = "none";

    const newTerminalBtn = h("button", { class: "icon-btn", title: "New Terminal" }, ["＋"]);
    newTerminalBtn.addEventListener("click", () => this.addTerminal());
    this.terminalTabsEl = h("div", { class: "terminal-tabs" }, []);
    this.terminalToolbar = h(
      "div",
      { class: "terminal-toolbar", style: "display:none" },
      [this.terminalTabsEl, newTerminalBtn],
    );
    this.terminalHostEl = h("div", { class: "terminal-host", style: "display:none" }, []);

    this.bottomPanel = h(
      "div",
      { class: "bottom-panel", style: "height: 220px; display:none" },
      [
        this.bottomResizer,
        tabsRow,
        this.monitorToolbar,
        this.terminalToolbar,
        this.buildLog.el,
        this.monitorLog.el,
        this.terminalHostEl,
      ],
    );
  }

  private buildStatusbar() {
    this.statusDot = h("span", { class: "status-dot idle" }, []);
    this.statusText = h("span", {}, ["Ready"]);
    this.toolchainInfoEl = h("span", {}, [""]);

    this.statusbar = h("div", { class: "statusbar" }, [
      h("div", { class: "status-indicator" }, [this.statusDot, this.statusText]),
      h("div", { class: "statusbar-spacer" }, []),
      this.toolchainInfoEl,
    ]);
  }

  private buildWelcome(): HTMLElement {
    const openBtn = h("button", { class: "btn btn-primary" }, ["Open Project…"]);
    openBtn.addEventListener("click", () => this.openProjectFlow());
    const newBtn = h("button", { class: "btn" }, ["New Project…"]);
    newBtn.addEventListener("click", () => this.newProjectFlow());

    const card = h("div", { class: "welcome-card" }, [
      h("h1", {}, ["TestIDE"]),
      h("p", {}, [
        "A focused IDE for PlatformIO and ESP-IDF projects. Open an existing project or create a new one to get started.",
      ]),
      h("div", { class: "welcome-actions" }, [openBtn, newBtn]),
    ]);
    return h("div", { class: "welcome" }, [card]);
  }

  // -------------------------------------------------------------- events

  private subscribeEvents() {
    onBoardsUpdated((ports) => {
      const cur = store.get();
      let selectedPort = cur.selectedPort;
      if (!selectedPort || !ports.find((p) => p.port === selectedPort)) {
        selectedPort = ports[0]?.port ?? null;
      }
      store.set({ ports, selectedPort });
      this.refreshUI();
    });

    onTaskLine((line) => {
      if (line.id !== store.get().activeTaskId) return;
      this.taskLogBuffer += line.line + "\n";
      this.buildLog.append(line.line, line.stream === "stderr" ? "stderr" : "");
    });

    onTaskDone((done) => {
      if (done.id !== store.get().activeTaskId) return;
      this.handleTaskDone(done.success);
    });

    onMonitorLine((line) => {
      this.monitorLog.append(line.line, line.stream === "stderr" ? "stderr" : "");
    });

    onMonitorDone(() => {
      if (store.get().monitorRunning) {
        this.monitorLog.append("[monitor stopped]", "system");
        store.set({ monitorRunning: false });
        if (store.get().status === "monitoring") {
          store.set({ status: "idle", statusMessage: "Ready" });
        }
        this.refreshUI();
      }
    });

    onMenuAction((action) => this.handleMenuAction(action));
  }

  private handleMenuAction(action: string) {
    switch (action) {
      case "new-project":
        this.newProjectFlow();
        break;
      case "open-project":
        this.openProjectFlow();
        break;
      case "new-file":
        this.createEntryFlow(null, false);
        break;
      case "save-file": {
        const active = store.get().activeTab;
        if (active) this.saveFile(active);
        break;
      }
      case "toggle-sidebar":
        this.toggleSidebar();
        break;
      case "toggle-panel":
        this.togglePanel();
        break;
      case "zoom-in":
        this.editorHost?.zoomIn();
        break;
      case "zoom-out":
        this.editorHost?.zoomOut();
        break;
      case "zoom-reset":
        this.editorHost?.resetZoom();
        break;
      case "build":
        this.runTask("build");
        break;
      case "upload":
        this.runTask("upload");
        break;
      case "clean":
        this.runTask("clean");
        break;
      case "stop":
        this.stopActive();
        break;
      case "show-monitor":
        this.showMonitorPanel();
        break;
      case "refresh-boards":
        this.refreshBoards();
        break;
      case "settings":
        this.openSettings();
        break;
    }
  }

  private async refreshBoards() {
    const ports = await api.listBoards().catch(() => []);
    const cur = store.get();
    let selectedPort = cur.selectedPort;
    if (!selectedPort || !ports.find((p) => p.port === selectedPort)) {
      selectedPort = ports[0]?.port ?? null;
    }
    store.set({ ports, selectedPort });
    this.refreshUI();
  }

  private toggleSidebar() {
    this.sidebarHidden = !this.sidebarHidden;
    this.sidebar.style.display = this.sidebarHidden ? "none" : "flex";
    this.sidebarResizer.style.display = this.sidebarHidden ? "none" : "block";
    this.editorHost?.layout();
  }

  private togglePanel() {
    this.panelHidden = !this.panelHidden;
    this.refreshUI();
  }

  private showMonitorPanel() {
    this.panelHidden = false;
    this.switchBottomTab("monitor");
  }

  private async checkEnvironments() {
    const [pio, idf] = await Promise.all([
      api.checkEnvironment(),
      api.checkIdfEnvironment(),
    ]);

    this.pioVersionText = pio.pio_found
      ? `PlatformIO ${(pio.pio_version ?? "").replace(/^PlatformIO Core,?\s*/i, "") || "ready"}`
      : "PlatformIO not found";
    this.idfVersionText = idf.idf_found
      ? idf.env_ready
        ? `ESP-IDF ${(idf.idf_version ?? "").replace(/^ESP-IDF\s*/i, "") || "ready"}`
        : "ESP-IDF found but not initialized (run install.sh)"
      : "ESP-IDF not found";

    store.set({ pioFound: pio.pio_found, idfFound: idf.idf_found && idf.env_ready });
    this.toolchainInfoEl.textContent = `${this.pioVersionText} · ${this.idfVersionText}`;
  }

  private showBanner(msg: string) {
    this.hideBanner();
    this.banner = h("div", { class: "banner" }, [msg]);
    this.titlebar.insertAdjacentElement("afterend", this.banner);
  }

  private hideBanner() {
    this.banner?.remove();
    this.banner = null;
  }

  // ------------------------------------------------------------ project

  private async openProjectFlow() {
    const dir = await openDialog({
      directory: true,
      multiple: false,
      title: "Open Project",
    });
    if (typeof dir !== "string") return;
    await this.loadProject(dir);
  }

  private async newProjectFlow() {
    const s = store.get();
    if (!s.pioFound && !s.idfFound) {
      openInstallToolchainModal(async () => {
        await this.checkEnvironments();
        this.newProjectFlow();
      });
      return;
    }
    openNewProjectModal(
      async (info) => {
        await this.applyProject(info);
      },
      { pioAvailable: !!s.pioFound, idfAvailable: !!s.idfFound },
    );
  }

  private openSettings() {
    openSettingsModal(this.settings, (updated) => {
      this.settings = updated;
      saveSettings(updated);
      this.applySettings();
    });
  }

  private applySettings() {
    this.editorHost?.setFontSize(this.settings.fontSize);
    this.editorHost?.setWordWrap(this.settings.wordWrap);
    this.editorHost?.setMinimap(this.settings.minimap);
    this.editorHost?.setTabSize(this.settings.tabSize);
    if (!store.get().monitorRunning) {
      this.baudSelect.value = String(this.settings.defaultBaud);
    }
  }

  private async loadProject(path: string) {
    try {
      const info = await api.openProject(path);
      await this.applyProject(info);
    } catch (e) {
      this.showBanner(`Failed to open project: ${e}`);
    }
  }

  private async applyProject(info: ProjectInfo) {
    this.expandedDirs.clear();
    const selectedEnv =
      info.kind === "platformio"
        ? (info.envs[0]?.name ?? null)
        : info.kind === "esp-idf"
          ? info.target
          : null;
    store.set({ project: info, selectedEnv, tabs: [], activeTab: null });
    this.editorHost?.clear();
    this.buildLog.clearLog();
    await this.refreshTree();
    this.refreshUI();

    if (info.kind === "unknown") {
      this.showBanner(
        `${info.name} doesn't look like a PlatformIO or ESP-IDF project — you can still browse and edit files, but build/flash actions are unavailable.`,
      );
    } else if (info.kind === "platformio" && !store.get().pioFound) {
      this.showBanner(
        "PlatformIO CLI not found. Install it with `pip install -U platformio`, then restart TestIDE.",
      );
    } else if (info.kind === "esp-idf") {
      if (!store.get().idfFound) {
        this.showBanner(
          "ESP-IDF was not found or its Python environment isn't initialized. Set IDF_PATH or install ESP-IDF (run install.sh), then restart TestIDE.",
        );
      } else if (!info.target) {
        this.showBanner(
          `${info.name} has no target configured yet — pick a chip from the Target dropdown to run \`idf.py set-target\` before building.`,
        );
      } else {
        this.hideBanner();
      }
    } else {
      this.hideBanner();
    }
  }

  private async refreshTree() {
    const project = store.get().project;
    if (!project) return;
    try {
      const tree = await api.readProjectTree(project.root);
      store.set({ fileTree: tree });
      this.renderFileTree();
    } catch (e) {
      this.showBanner(`Failed to read project files: ${e}`);
    }
  }

  // --------------------------------------------------------------- tree

  private renderFileTree() {
    const s = store.get();
    renderTree(this.treeEl, s.fileTree, {
      onOpenFile: (path) => this.openFileInEditor(path),
      isSelected: (path) => path === s.activeTab,
      isExpanded: (path) => this.expandedDirs.has(path),
      onToggleExpand: (path) => {
        if (this.expandedDirs.has(path)) this.expandedDirs.delete(path);
        else this.expandedDirs.add(path);
        this.renderFileTree();
      },
      onContextMenu: (path, isDir, x, y) => this.showTreeContextMenu(path, isDir, x, y),
    });
  }

  private showTreeContextMenu(path: string | null, isDir: boolean, x: number, y: number) {
    const project = store.get().project;
    if (!project) return;
    const targetDir = path
      ? isDir
        ? path
        : path.split("/").slice(0, -1).join("/")
      : project.root;

    const items: MenuItem[] = [
      { label: "New File", onClick: () => this.createEntryFlow(targetDir, false) },
      { label: "New Folder", onClick: () => this.createEntryFlow(targetDir, true) },
    ];
    if (path) {
      items.push({ label: "Rename…", onClick: () => this.renameEntryFlow(path) });
      items.push({
        label: "Delete",
        danger: true,
        onClick: () => this.deleteEntryFlow(path, isDir),
      });
    }
    showContextMenu(x, y, items);
  }

  private async createEntryFlow(dir: string | null, isDir: boolean) {
    const project = store.get().project;
    if (!project) return;
    const parent = dir ?? project.root;
    const name = await promptModal(
      isDir ? "New Folder" : "New File",
      isDir ? "folder-name" : "file.cpp",
    );
    if (!name) return;
    const fullPath = `${parent}/${name}`;
    try {
      if (isDir) await api.createFolder(fullPath);
      else await api.createFile(fullPath);
      this.expandedDirs.add(parent);
      await this.refreshTree();
      if (!isDir) await this.openFileInEditor(fullPath);
    } catch (e) {
      this.showBanner(`${e}`);
    }
  }

  private async renameEntryFlow(path: string) {
    const oldName = path.split("/").pop() ?? path;
    const newName = await promptModal("Rename", "", oldName);
    if (!newName || newName === oldName) return;
    const newPath = path.split("/").slice(0, -1).concat(newName).join("/");
    try {
      await api.renameEntry(path, newPath);
      this.closeTab(path, false);
      await this.refreshTree();
    } catch (e) {
      this.showBanner(`${e}`);
    }
  }

  private async deleteEntryFlow(path: string, isDir: boolean) {
    const name = path.split("/").pop() ?? path;
    const ok = await confirmModal(
      `Delete "${name}"?`,
      isDir
        ? "This folder and everything inside it will be permanently deleted."
        : "This file will be permanently deleted.",
    );
    if (!ok) return;
    try {
      await api.deleteEntry(path);
      this.closeTab(path, false);
      await this.refreshTree();
    } catch (e) {
      this.showBanner(`${e}`);
    }
  }

  // -------------------------------------------------------------- tabs

  private async openFileInEditor(path: string) {
    if (!this.editorHost) return;
    const name = path.split("/").pop() ?? path;
    try {
      if (!this.editorHost.isOpen(path)) {
        const contents = await api.readFile(path);
        this.editorHost.openFile(path, contents, languageForFile(name));
      } else {
        this.editorHost.openFile(path, "", languageForFile(name));
      }
    } catch (e) {
      this.showBanner(`Failed to open ${name}: ${e}`);
      return;
    }

    const s = store.get();
    let tabs = s.tabs;
    if (!tabs.find((t) => t.path === path)) {
      tabs = [...tabs, { path, name, dirty: false }];
    }
    store.set({ tabs, activeTab: path });
    this.renderTabs();
    this.renderFileTree();
    this.updateEditorVisibility();
  }

  private renderTabs() {
    const s = store.get();
    clear(this.tabBar);
    this.tabBar.append(
      ...s.tabs.map((tab) => {
        const closeBtn = h("span", { class: "close" }, ["×"]);
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.closeTab(tab.path, true);
        });
        return h(
          "div",
          {
            class: tab.path === s.activeTab ? "tab active" : "tab",
            onclick: () => {
              store.set({ activeTab: tab.path });
              this.editorHost?.openFile(tab.path, "", languageForFile(tab.name));
              this.renderTabs();
              this.renderFileTree();
              this.updateEditorVisibility();
            },
          },
          [
            h("span", { class: `dirty-dot${tab.dirty ? " dirty" : ""}` }, []),
            h("span", {}, [tab.name]),
            closeBtn,
          ],
        );
      }),
    );
  }

  private closeTab(path: string, focusNeighbor: boolean) {
    const s = store.get();
    const tabs = s.tabs.filter((t) => t.path !== path);
    let activeTab = s.activeTab;
    if (activeTab === path) {
      activeTab = tabs.length ? tabs[tabs.length - 1].path : null;
    }
    this.editorHost?.closeFile(path);
    store.set({ tabs, activeTab });
    if (focusNeighbor && activeTab) {
      const name = activeTab.split("/").pop() ?? activeTab;
      this.editorHost?.openFile(activeTab, "", languageForFile(name));
    }
    this.renderTabs();
    this.renderFileTree();
    this.updateEditorVisibility();
  }

  private setTabDirty(path: string, dirty: boolean) {
    const s = store.get();
    const tabs = s.tabs.map((t) => (t.path === path ? { ...t, dirty } : t));
    store.set({ tabs });
    this.renderTabs();
  }

  private async saveFile(path: string) {
    const value = this.editorHost?.getValue(path);
    if (value === undefined) return;
    try {
      await api.writeFile(path, value);
      this.editorHost?.markSaved(path);
    } catch (e) {
      this.showBanner(`Failed to save: ${e}`);
    }
  }

  private updateEditorVisibility() {
    const hasTabs = store.get().tabs.length > 0;
    this.editorHostEl.style.display = hasTabs ? "block" : "none";
    this.editorEmptyEl.style.display = hasTabs ? "none" : "flex";
    this.editorHost?.layout();
  }

  // ------------------------------------------------------------- tasks

  private async runTask(kind: TaskKind) {
    const s = store.get();
    if (!s.project || s.project.kind === "unknown") return;
    if (s.activeTaskId) return;
    if (!this.toolchainReady()) {
      if (s.project.kind === "esp-idf" && !s.project.target) {
        this.showBanner("Select a target from the dropdown before building.");
      } else {
        this.showBanner(
          s.project.kind === "platformio"
            ? "PlatformIO CLI not found — install it before building."
            : "ESP-IDF not found or not initialized — install it before building.",
        );
      }
      return;
    }
    if (kind === "upload" && !s.selectedPort) {
      store.set({ status: "error", statusMessage: "No board detected — plug in a board first" });
      this.updateStatusbar();
      return;
    }

    const taskId = crypto.randomUUID();
    this.currentTaskKind = kind;
    this.taskLogBuffer = "";
    const label = kind === "build" ? "Building" : kind === "upload" ? "Uploading" : "Cleaning";
    store.set({
      activeTaskId: taskId,
      status: kind === "upload" ? "uploading" : "building",
      statusMessage: `${label}…`,
    });
    this.switchBottomTab("build");
    this.buildLog.clearLog();

    const preview =
      s.project.kind === "platformio"
        ? `$ pio run -e ${s.selectedEnv ?? "<default>"}${
            kind === "upload" ? " -t upload" : kind === "clean" ? " -t clean" : ""
          }`
        : `$ idf.py ${kind === "build" ? "build" : kind === "upload" ? "flash" : "fullclean"}`;
    this.buildLog.append(preview, "system");
    this.updateStatusbar();
    this.updateToolbarButtons();

    try {
      if (s.project.kind === "platformio") {
        if (kind === "build") {
          await api.buildProject(s.project.root, s.selectedEnv, taskId);
        } else if (kind === "upload") {
          await api.uploadProject(s.project.root, s.selectedEnv, s.selectedPort, taskId);
        } else {
          await api.cleanProject(s.project.root, s.selectedEnv, taskId);
        }
      } else {
        if (kind === "build") {
          await api.idfBuild(s.project.root, taskId);
        } else if (kind === "upload") {
          await api.idfUpload(s.project.root, s.selectedPort, taskId);
        } else {
          await api.idfClean(s.project.root, taskId);
        }
      }
    } catch (e) {
      this.buildLog.append(String(e), "error-text");
      store.set({ activeTaskId: null, status: "error", statusMessage: String(e) });
      this.currentTaskKind = null;
      this.updateStatusbar();
      this.updateToolbarButtons();
    }
  }

  private async changeIdfTarget(target: string) {
    const s = store.get();
    if (!s.project || s.project.kind !== "esp-idf") return;
    if (s.activeTaskId) return;
    if (!s.idfFound) {
      this.showBanner("ESP-IDF not found or not initialized — install it before setting a target.");
      this.updateEnvPicker();
      return;
    }

    const taskId = crypto.randomUUID();
    this.currentTaskKind = "set-target";
    this.pendingTarget = target;
    this.taskLogBuffer = "";
    store.set({
      activeTaskId: taskId,
      status: "building",
      statusMessage: `Setting target to ${target}…`,
    });
    this.switchBottomTab("build");
    this.buildLog.clearLog();
    this.buildLog.append(`$ idf.py set-target ${target}`, "system");
    this.updateStatusbar();
    this.updateToolbarButtons();

    try {
      await api.idfSetTarget(s.project.root, target, taskId);
    } catch (e) {
      this.buildLog.append(String(e), "error-text");
      store.set({ activeTaskId: null, status: "error", statusMessage: String(e) });
      this.currentTaskKind = null;
      this.pendingTarget = null;
      this.updateStatusbar();
      this.updateToolbarButtons();
    }
  }

  private handleTaskDone(success: boolean) {
    const kind = this.currentTaskKind;
    const target = this.pendingTarget;
    store.set({ activeTaskId: null });
    this.currentTaskKind = null;
    this.pendingTarget = null;

    if (kind === "set-target") {
      const s = store.get();
      if (success && target && s.project && s.project.kind === "esp-idf") {
        store.set({
          project: { ...s.project, target, has_sdkconfig: true },
          selectedEnv: target,
        });
        this.buildLog.append(`✓ Target set to ${target}`, "success-text");
        store.set({ status: "success", statusMessage: `Target set to ${target}` });
        this.hideBanner();
      } else {
        const hint = classifyError(this.taskLogBuffer);
        this.buildLog.append(`✗ ${hint.title}`, "error-text");
        this.buildLog.append(hint.detail, "system");
        store.set({ status: "error", statusMessage: hint.title });
      }
      this.updateStatusbar();
      this.updateToolbarButtons();
      this.updateEnvPicker();
      return;
    }

    if (success) {
      const label =
        kind === "build" ? "Build succeeded" : kind === "upload" ? "Upload succeeded" : "Clean complete";
      this.buildLog.append(`✓ ${label}`, "success-text");
      store.set({ status: "success", statusMessage: label });
      if (kind === "upload") {
        this.startMonitor();
      }
    } else {
      const hint = classifyError(this.taskLogBuffer);
      this.buildLog.append(`✗ ${hint.title}`, "error-text");
      this.buildLog.append(hint.detail, "system");
      store.set({ status: "error", statusMessage: hint.title });
    }
    this.updateStatusbar();
    this.updateToolbarButtons();
  }

  private async stopActive() {
    const s = store.get();
    if (s.activeTaskId) {
      try {
        await api.stopTask(s.activeTaskId);
      } catch {
        /* task may have already finished */
      }
      this.buildLog.append("[stopped by user]", "system");
      store.set({ activeTaskId: null, status: "idle", statusMessage: "Ready" });
      this.currentTaskKind = null;
    } else if (s.monitorRunning) {
      await this.stopMonitor();
    }
    this.updateStatusbar();
    this.updateToolbarButtons();
  }

  // ----------------------------------------------------------- monitor

  private async startMonitor() {
    const s = store.get();
    if (!s.project || s.project.kind === "unknown" || !s.selectedPort) return;
    const baud = Number(this.baudSelect.value) || 115200;
    this.switchBottomTab("monitor");
    this.monitorLog.clearLog();
    store.set({
      status: "monitoring",
      statusMessage: `Monitoring ${s.selectedPort} @ ${baud} baud`,
      monitorRunning: true,
    });
    this.updateStatusbar();
    this.updateToolbarButtons();
    try {
      if (s.project.kind === "platformio") {
        await api.startMonitor(s.project.root, s.selectedEnv, s.selectedPort, baud);
      } else {
        await api.idfMonitor(s.project.root, s.selectedPort, baud);
      }
    } catch (e) {
      this.monitorLog.append(String(e), "error-text");
      store.set({ status: "error", statusMessage: String(e), monitorRunning: false });
      this.updateStatusbar();
      this.updateToolbarButtons();
    }
  }

  private async stopMonitor() {
    try {
      await api.stopMonitor();
    } catch {
      /* ignore */
    }
    store.set({ monitorRunning: false, status: "idle", statusMessage: "Ready" });
  }

  private switchBottomTab(tab: "build" | "monitor" | "terminal") {
    store.set({ bottomTab: tab, bottomPanelOpen: true });
    if (tab === "terminal" && this.terminals.size === 0) {
      this.addTerminal();
      return;
    }
    this.refreshUI();
    if (tab === "terminal") {
      requestAnimationFrame(() => {
        const pane = this.activeTerminalId ? this.terminals.get(this.activeTerminalId) : undefined;
        pane?.resize();
        pane?.focus();
      });
    }
  }

  // ------------------------------------------------------------- terminal

  private addTerminal() {
    this.terminalCounter += 1;
    const id = `term-${this.terminalCounter}`;
    const pane = new TerminalPane(id, `Terminal ${this.terminalCounter}`);
    pane.onExit = () => this.refreshUI();
    this.terminals.set(id, pane);
    this.terminalHostEl.append(pane.el);
    this.activeTerminalId = id;
    const cwd = store.get().project?.root ?? null;
    this.refreshUI();
    requestAnimationFrame(() => {
      void pane.start(cwd).then(() => pane.focus());
    });
  }

  private closeTerminal(id: string) {
    const pane = this.terminals.get(id);
    if (!pane) return;
    pane.dispose();
    this.terminals.delete(id);
    if (this.activeTerminalId === id) {
      const remaining = [...this.terminals.keys()];
      this.activeTerminalId = remaining[remaining.length - 1] ?? null;
    }
    this.refreshUI();
  }

  private switchTerminal(id: string) {
    this.activeTerminalId = id;
    this.refreshUI();
    const pane = this.terminals.get(id);
    requestAnimationFrame(() => {
      pane?.resize();
      pane?.focus();
    });
  }

  private resizeActiveTerminal() {
    if (!this.activeTerminalId) return;
    this.terminals.get(this.activeTerminalId)?.resize();
  }

  private updateTerminalUI() {
    clear(this.terminalTabsEl);
    for (const [id, pane] of this.terminals) {
      const closeBtn = h("span", { class: "close" }, ["×"]);
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeTerminal(id);
      });
      const tab = h(
        "div",
        {
          class:
            id === this.activeTerminalId
              ? "terminal-session-tab active"
              : "terminal-session-tab",
        },
        [h("span", {}, [pane.label]), closeBtn],
      );
      tab.addEventListener("click", () => this.switchTerminal(id));
      this.terminalTabsEl.append(tab);

      pane.el.style.display = id === this.activeTerminalId ? "block" : "none";
    }
  }

  // -------------------------------------------------------------- render

  private updateStatusbar() {
    const s = store.get();
    this.statusDot.className = `status-dot ${s.status}`;
    this.statusText.textContent = s.statusMessage;
  }

  /** Whether the toolchain the currently open project needs is ready to run. */
  private toolchainReady(): boolean {
    const s = store.get();
    if (!s.project) return false;
    if (s.project.kind === "platformio") return !!s.pioFound;
    if (s.project.kind === "esp-idf") return !!s.idfFound && !!s.project.target;
    return false;
  }

  private updateToolbarButtons() {
    const s = store.get();
    const busy = !!s.activeTaskId;
    const hasProject = !!s.project;
    const ready = this.toolchainReady();
    this.buildBtn.disabled = busy || !hasProject || !ready;
    this.flashBtn.disabled = busy || !hasProject || !ready || !s.selectedPort;
    this.cleanBtn.disabled = busy || !hasProject || !ready;
    this.stopBtn.disabled = !busy && !s.monitorRunning;
  }

  private updateEnvPicker() {
    const s = store.get();
    clear(this.envSelect);
    if (!s.project || s.project.kind === "unknown") {
      this.envPickerLabel.textContent = "Env";
      this.envSelect.disabled = true;
      return;
    }
    this.envSelect.disabled = false;
    if (s.project.kind === "platformio") {
      this.envPickerLabel.textContent = "Env";
      for (const env of s.project.envs) {
        this.envSelect.append(h("option", { value: env.name }, [env.name]));
      }
    } else {
      this.envPickerLabel.textContent = "Target";
      if (!s.project.target) {
        this.envSelect.append(h("option", { value: "" }, ["Select a target…"]));
      }
      for (const target of s.project.available_targets) {
        this.envSelect.append(h("option", { value: target }, [target]));
      }
    }
    if (s.selectedEnv) this.envSelect.value = s.selectedEnv;
  }

  private async onEnvPickerChange() {
    const s = store.get();
    const value = this.envSelect.value;
    if (!s.project || s.project.kind !== "esp-idf") {
      store.set({ selectedEnv: value });
      return;
    }
    if (!value || value === s.project.target) {
      store.set({ selectedEnv: value });
      return;
    }
    await this.changeIdfTarget(value);
  }

  private updateDevices() {
    const s = store.get();
    renderDevices(this.portSelect, this.portDetail, s.ports, s.selectedPort, {
      onSelect: (port) => {
        store.set({ selectedPort: port });
        this.refreshUI();
      },
    });
  }

  private updateBottomTabsUI() {
    const s = store.get();
    this.bottomTabBuild.classList.toggle("active", s.bottomTab === "build");
    this.bottomTabMonitor.classList.toggle("active", s.bottomTab === "monitor");
    this.bottomTabTerminal.classList.toggle("active", s.bottomTab === "terminal");
    this.buildLog.el.style.display = s.bottomTab === "build" ? "block" : "none";
    this.monitorLog.el.style.display = s.bottomTab === "monitor" ? "block" : "none";
    this.terminalHostEl.style.display = s.bottomTab === "terminal" ? "block" : "none";
    this.monitorToolbar.style.display = s.bottomTab === "monitor" ? "flex" : "none";
    this.terminalToolbar.style.display = s.bottomTab === "terminal" ? "flex" : "none";
    this.clearLogBtn.style.display = s.bottomTab === "terminal" ? "none" : "inline-flex";

    clear(this.bottomTabMonitor);
    this.bottomTabMonitor.append(
      "Serial Monitor",
      ...(s.monitorRunning ? [this.monitorLiveDot] : []),
    );

    this.updateTerminalUI();
  }

  refreshUI() {
    const s = store.get();
    this.projectNameEl.textContent = s.project ? s.project.name : "No Project";
    this.welcomeEl.style.display = s.project ? "none" : "flex";
    this.body.style.display = s.project ? "flex" : "none";
    this.bottomPanel.style.display = s.project && !this.panelHidden ? "flex" : "none";

    this.updateEnvPicker();
    this.updateDevices();
    this.updateStatusbar();
    this.updateToolbarButtons();
    this.updateBottomTabsUI();
    this.editorHost?.layout();
    if (s.bottomTab === "terminal") {
      requestAnimationFrame(() => this.resizeActiveTerminal());
    }
  }
}

const app = new App();
app.start();
