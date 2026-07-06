import type { UnlistenFn } from "@tauri-apps/api/event";
import { api, onLibTaskDone, onLibTaskLine } from "./api";
import { classifyError } from "./errors";
import { clear, h } from "./dom";
import { folderIcon, packageIcon } from "./icons";
import { showToast } from "./toast";
import type { InstalledLibrary, LibrarySearchItem } from "./types";

type FilterMode = "all" | "installed";

interface PendingTask {
  kind: "install" | "uninstall";
  name: string;
  rowEl: HTMLElement;
  statusEl: HTMLElement;
  successMessage: string;
}

let taskCounter = 0;

/** Sidebar view backed by PlatformIO's library registry, styled after the
 * Arduino IDE Library Manager: search the registry, pick a version, install
 * it into the current project/environment; switch to "Installed" to update
 * or remove what's already there. */
export class LibrariesPanel {
  readonly el: HTMLElement;

  private headerEnvEl: HTMLElement;
  private searchInput: HTMLInputElement;
  private allTabBtn: HTMLElement;
  private installedTabBtn: HTMLElement;
  private listEl: HTMLElement;

  private projectPath: string | null = null;
  private env: string | null = null;

  private mode: FilterMode = "all";
  private query = "";
  private searchTimer: number | undefined;
  private searchToken = 0;

  private lastResults: LibrarySearchItem[] = [];
  private installedCache: InstalledLibrary[] = [];
  private detailCache = new Map<string, string[]>(); // key -> version names

  private pending = new Map<string, PendingTask>();
  private lineBuffers = new Map<string, string>();
  private unlistenLine: UnlistenFn | null = null;
  private unlistenDone: UnlistenFn | null = null;

  constructor() {
    const refreshBtn = h("button", { class: "icon-btn", title: "Refresh" }, ["↻"]);
    refreshBtn.addEventListener("click", () => this.refreshInstalled());

    this.headerEnvEl = h("span", { class: "libraries-env" }, []);

    this.searchInput = h("input", {
      type: "text",
      placeholder: "Search PlatformIO libraries…",
    }) as HTMLInputElement;
    this.searchInput.addEventListener("input", () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => this.doSearch(this.searchInput.value), 350);
    });

    this.allTabBtn = h("div", { class: "lib-filter-tab active" }, ["All"]);
    this.allTabBtn.addEventListener("click", () => this.setMode("all"));
    this.installedTabBtn = h("div", { class: "lib-filter-tab" }, ["Installed"]);
    this.installedTabBtn.addEventListener("click", () => this.setMode("installed"));

    this.listEl = h("div", { class: "lib-list" }, []);

    this.el = h("div", { class: "libraries-view" }, [
      h("div", { class: "sidebar-header" }, [
        "Libraries",
        h("div", { class: "actions" }, [refreshBtn]),
      ]),
      this.headerEnvEl,
      h("div", { class: "lib-search-row" }, [this.searchInput]),
      h("div", { class: "lib-filter-tabs" }, [this.allTabBtn, this.installedTabBtn]),
      this.listEl,
    ]);

    void this.subscribeEvents();
    this.render();
  }

  private async subscribeEvents() {
    this.unlistenLine = await onLibTaskLine((line) => {
      if (!this.pending.has(line.id)) return;
      const buf = this.lineBuffers.get(line.id) ?? "";
      this.lineBuffers.set(line.id, buf + line.line + "\n");
    });
    this.unlistenDone = await onLibTaskDone(async (done) => {
      const task = this.pending.get(done.id);
      if (!task) return;
      this.pending.delete(done.id);
      const log = this.lineBuffers.get(done.id) ?? "";
      this.lineBuffers.delete(done.id);

      if (done.success) {
        showToast(task.successMessage, "success");
        await this.refreshInstalled();
      } else {
        const hint = classifyError(log);
        task.statusEl.textContent = hint.title;
        task.statusEl.className = "lib-error";
        task.statusEl.title = log.trim() || hint.detail;
      }
    });
  }

  dispose() {
    this.unlistenLine?.();
    this.unlistenDone?.();
  }

  /** Called by the app shell whenever the open project or selected
   * environment changes. Libraries are always scoped to one env, matching
   * how `platformio.ini`'s `lib_deps` is per-`[env:...]`. */
  setProject(projectPath: string | null, env: string | null) {
    if (projectPath === this.projectPath && env === this.env) return;
    this.projectPath = projectPath;
    this.env = env;
    this.headerEnvEl.textContent = env ? `Environment: ${env}` : "";
    this.headerEnvEl.style.display = env ? "block" : "none";
    void this.refreshInstalled();
  }

  private async refreshInstalled() {
    if (!this.projectPath || !this.env) {
      this.installedCache = [];
      this.render();
      return;
    }
    try {
      this.installedCache = await api.listInstalledLibraries(this.projectPath, this.env);
    } catch {
      this.installedCache = [];
    }
    this.render();
  }

  private setMode(mode: FilterMode) {
    this.mode = mode;
    this.allTabBtn.classList.toggle("active", mode === "all");
    this.installedTabBtn.classList.toggle("active", mode === "installed");
    this.render();
  }

  private async doSearch(query: string) {
    this.query = query;
    const token = ++this.searchToken;
    if (!query.trim()) {
      this.lastResults = [];
      this.render();
      return;
    }
    clear(this.listEl);
    this.listEl.append(h("div", { class: "empty-hint" }, ["Searching…"]));
    try {
      const result = await api.searchLibraries(query, 1);
      if (token !== this.searchToken) return;
      this.lastResults = result.items;
      this.render();
    } catch (e) {
      if (token !== this.searchToken) return;
      clear(this.listEl);
      this.listEl.append(h("div", { class: "empty-hint" }, [String(e)]));
    }
  }

  private findInstalled(name: string): InstalledLibrary | undefined {
    const lower = name.toLowerCase();
    return this.installedCache.find((l) => l.name.toLowerCase() === lower);
  }

  private render() {
    clear(this.listEl);

    if (!this.projectPath || !this.env) {
      this.listEl.append(
        h("div", { class: "empty-hint" }, [
          folderIcon(28),
          "Open a PlatformIO project to search and install libraries.",
        ]),
      );
      return;
    }

    if (this.mode === "installed") {
      if (this.installedCache.length === 0) {
        this.listEl.append(
          h("div", { class: "empty-hint" }, [
            packageIcon(28),
            "No libraries installed in this environment yet.",
          ]),
        );
        return;
      }
      this.listEl.append(...this.installedCache.map((lib) => this.renderInstalledRow(lib)));
      return;
    }

    if (!this.query.trim()) {
      this.listEl.append(
        h("div", { class: "empty-hint" }, [
          packageIcon(28),
          "Type to search PlatformIO's library registry.",
        ]),
      );
      return;
    }
    if (this.lastResults.length === 0) {
      this.listEl.append(h("div", { class: "empty-hint" }, ["No matching libraries."]));
      return;
    }
    this.listEl.append(...this.lastResults.map((item) => this.renderSearchRow(item)));
  }

  private populateVersions(select: HTMLSelectElement, key: string, fallback: string) {
    let loaded = false;
    const load = async () => {
      if (loaded) return;
      loaded = true;
      let versions = this.detailCache.get(key);
      if (!versions) {
        try {
          const detail = await api.getLibraryDetail(key);
          versions = detail.versions.map((v) => v.name);
          if (versions.length === 0) versions = [fallback];
          this.detailCache.set(key, versions);
        } catch {
          return; // keep the single fallback option already shown
        }
      }
      const current = select.value;
      clear(select);
      select.append(...versions.map((v) => h("option", { value: v }, [v])));
      if (versions.includes(current)) select.value = current;
    };
    select.addEventListener("focus", load, { once: true });
    select.addEventListener("mousedown", load, { once: true });
  }

  private renderSearchRow(item: LibrarySearchItem): HTMLElement {
    const installed = this.findInstalled(item.name);

    const versionSelect = h(
      "select",
      { class: "lib-version-select" },
      [h("option", { value: item.version }, [item.version])],
    ) as HTMLSelectElement;
    this.populateVersions(versionSelect, String(item.id), item.version);

    const statusEl = h("span", { class: "lib-status" }, []);

    const actionBtn = h("button", { class: "btn btn-primary btn-sm" }, [
      installed ? "Update" : "Install",
    ]) as HTMLButtonElement;

    const syncActionBtn = () => {
      if (installed && versionSelect.value === installed.version) {
        actionBtn.textContent = "Installed";
        actionBtn.disabled = true;
      } else if (installed) {
        actionBtn.textContent = "Update";
        actionBtn.disabled = false;
      } else {
        actionBtn.textContent = "Install";
        actionBtn.disabled = false;
      }
    };
    syncActionBtn();
    versionSelect.addEventListener("change", syncActionBtn);

    const row = h("div", { class: "lib-item" }, [
      h("div", { class: "lib-item-top" }, [
        h("div", { class: "lib-item-info" }, [
          h("div", { class: "lib-name" }, [item.name]),
          h("div", { class: "lib-owner" }, [
            item.authors[0] ? `by ${item.authors[0]}` : item.owner ? `by ${item.owner}` : "",
          ]),
        ]),
        h("div", { class: "lib-actions" }, [versionSelect, actionBtn]),
      ]),
      item.description
        ? h("div", { class: "lib-desc" }, [item.description])
        : null,
      statusEl,
    ]);

    actionBtn.addEventListener("click", () => {
      const message = installed
        ? `${item.name} has been updated to ${versionSelect.value} in platformio.ini`
        : `${item.name} has been added to platformio.ini`;
      this.startInstall(
        item.owner,
        item.name,
        versionSelect.value,
        message,
        row,
        statusEl,
        actionBtn,
      );
    });

    return row;
  }

  private renderInstalledRow(lib: InstalledLibrary): HTMLElement {
    const versionSelect = h(
      "select",
      { class: "lib-version-select" },
      [h("option", { value: lib.version }, [lib.version])],
    ) as HTMLSelectElement;
    this.populateVersions(versionSelect, lib.name, lib.version);

    const statusEl = h("span", { class: "lib-status" }, []);

    const updateBtn = h("button", { class: "btn btn-sm" }, ["Update"]) as HTMLButtonElement;
    updateBtn.disabled = true;
    versionSelect.addEventListener("change", () => {
      updateBtn.disabled = versionSelect.value === lib.version;
    });

    const removeBtn = h("button", { class: "btn btn-danger btn-sm" }, ["Remove"]) as HTMLButtonElement;

    const row = h("div", { class: "lib-item" }, [
      h("div", { class: "lib-item-top" }, [
        h("div", { class: "lib-item-info" }, [
          h("div", { class: "lib-name" }, [lib.name]),
          h("div", { class: "lib-owner" }, [
            `v${lib.version}${lib.author ? ` · by ${lib.author}` : ""}`,
          ]),
        ]),
        h("div", { class: "lib-actions" }, [versionSelect, updateBtn, removeBtn]),
      ]),
      lib.description ? h("div", { class: "lib-desc" }, [lib.description]) : null,
      statusEl,
    ]);

    updateBtn.addEventListener("click", () => {
      const message = `${lib.name} has been updated to ${versionSelect.value} in platformio.ini`;
      this.startInstall("", lib.name, versionSelect.value, message, row, statusEl, updateBtn, removeBtn);
    });
    removeBtn.addEventListener("click", () => {
      const message = `${lib.name} has been removed from platformio.ini`;
      this.startUninstall(lib.name, message, row, statusEl, updateBtn, removeBtn);
    });

    return row;
  }

  private setRowBusy(row: HTMLElement, statusEl: HTMLElement, label: string, ...buttons: HTMLButtonElement[]) {
    statusEl.textContent = label;
    statusEl.className = "lib-status busy";
    for (const b of buttons) b.disabled = true;
    row.classList.add("busy");
  }

  private startInstall(
    owner: string,
    name: string,
    version: string,
    successMessage: string,
    row: HTMLElement,
    statusEl: HTMLElement,
    ...buttons: HTMLButtonElement[]
  ) {
    if (!this.projectPath || !this.env) return;
    const taskId = `lib-install-${++taskCounter}`;
    this.setRowBusy(row, statusEl, `Installing ${name}@${version}…`, ...buttons);
    this.pending.set(taskId, { kind: "install", name, rowEl: row, statusEl, successMessage });
    api
      .installLibrary(this.projectPath, this.env, owner, name, version, taskId)
      .catch((e) => {
        this.pending.delete(taskId);
        statusEl.textContent = String(e);
        statusEl.className = "lib-error";
        for (const b of buttons) b.disabled = false;
      });
  }

  private startUninstall(
    name: string,
    successMessage: string,
    row: HTMLElement,
    statusEl: HTMLElement,
    ...buttons: HTMLButtonElement[]
  ) {
    if (!this.projectPath || !this.env) return;
    const taskId = `lib-uninstall-${++taskCounter}`;
    this.setRowBusy(row, statusEl, `Removing ${name}…`, ...buttons);
    this.pending.set(taskId, { kind: "uninstall", name, rowEl: row, statusEl, successMessage });
    api.uninstallLibrary(this.projectPath, this.env, name, taskId).catch((e) => {
      this.pending.delete(taskId);
      statusEl.textContent = String(e);
      statusEl.className = "lib-error";
      for (const b of buttons) b.disabled = false;
    });
  }
}
