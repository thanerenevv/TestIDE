import type { UnlistenFn } from "@tauri-apps/api/event";
import { api, onLibTaskDone, onLibTaskLine } from "./api";
import { classifyError } from "./errors";
import { clear, h } from "./dom";
import { folderIcon, packageIcon } from "./icons";
import { showToast } from "./toast";
import type { EspComponent } from "./types";

let taskCounter = 0;

/** Sidebar view backed by the ESP-IDF Component Manager (`idf.py
 * add-dependency` / the `main/idf_component.yml` manifest), shown instead of
 * the PlatformIO libraries panel when the open project is a native ESP-IDF
 * project. There's no supported registry search API (unlike PlatformIO's
 * `pio lib search`), so this only manages already-known "namespace/name"
 * components rather than offering full-text discovery. */
export class EspLibrariesPanel {
  readonly el: HTMLElement;

  private addInput: HTMLInputElement;
  private addBtn: HTMLButtonElement;
  private listEl: HTMLElement;

  private projectPath: string | null = null;
  private components: EspComponent[] = [];

  private pending = new Map<string, { rowEl: HTMLElement; statusEl: HTMLElement }>();
  private lineBuffers = new Map<string, string>();
  private unlistenLine: UnlistenFn | null = null;
  private unlistenDone: UnlistenFn | null = null;

  constructor() {
    const refreshBtn = h("button", { class: "icon-btn", title: "Refresh" }, ["↻"]);
    refreshBtn.addEventListener("click", () => this.refresh());

    this.addInput = h("input", {
      type: "text",
      placeholder: "namespace/component (e.g. espressif/led_strip^2.5.5)",
    }) as HTMLInputElement;
    this.addInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.startAdd();
    });
    this.addBtn = h("button", { class: "btn btn-primary btn-sm" }, ["Add"]) as HTMLButtonElement;
    this.addBtn.addEventListener("click", () => this.startAdd());

    this.listEl = h("div", { class: "lib-list" }, []);

    this.el = h("div", { class: "libraries-view" }, [
      h("div", { class: "sidebar-header" }, [
        "ESP-IDF Components",
        h("div", { class: "actions" }, [refreshBtn]),
      ]),
      h("div", { class: "lib-search-row" }, [this.addInput, this.addBtn]),
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
        showToast("Dependency added to idf_component.yml", "success");
        this.addInput.value = "";
        await this.refresh();
      } else {
        const hint = classifyError(log);
        task.statusEl.textContent = hint.title;
        task.statusEl.className = "lib-error";
        task.statusEl.title = log.trim() || hint.detail;
        this.addBtn.disabled = false;
      }
    });
  }

  dispose() {
    this.unlistenLine?.();
    this.unlistenDone?.();
  }

  /** Called by the app shell whenever the open project changes. */
  setProject(projectPath: string | null) {
    if (projectPath === this.projectPath) return;
    this.projectPath = projectPath;
    void this.refresh();
  }

  private async refresh() {
    if (!this.projectPath) {
      this.components = [];
      this.render();
      return;
    }
    try {
      this.components = await api.listEspComponents(this.projectPath);
    } catch {
      this.components = [];
    }
    this.render();
  }

  private startAdd() {
    if (!this.projectPath) return;
    const spec = this.addInput.value.trim();
    if (!spec) return;

    const taskId = `esp-lib-add-${++taskCounter}`;
    const statusEl = h("span", { class: "lib-status busy" }, [`Adding ${spec}…`]);
    const row = h("div", { class: "lib-item busy" }, [statusEl]);
    this.listEl.prepend(row);

    this.addBtn.disabled = true;
    this.pending.set(taskId, { rowEl: row, statusEl });
    api.addEspComponent(this.projectPath, spec, taskId).catch((e) => {
      this.pending.delete(taskId);
      statusEl.textContent = String(e);
      statusEl.className = "lib-error";
      this.addBtn.disabled = false;
    });
  }

  private startRemove(component: EspComponent, row: HTMLElement, statusEl: HTMLElement, btn: HTMLButtonElement) {
    if (!this.projectPath) return;
    statusEl.textContent = `Removing ${component.name}…`;
    statusEl.className = "lib-status busy";
    btn.disabled = true;
    row.classList.add("busy");

    api
      .removeEspComponent(this.projectPath, component.name)
      .then(async () => {
        showToast(`${component.name} has been removed from idf_component.yml`, "success");
        await this.refresh();
      })
      .catch((e) => {
        statusEl.textContent = String(e);
        statusEl.className = "lib-error";
        btn.disabled = false;
        row.classList.remove("busy");
      });
  }

  private render() {
    clear(this.listEl);

    if (!this.projectPath) {
      this.listEl.append(
        h("div", { class: "empty-hint" }, [
          folderIcon(28),
          "Open an ESP-IDF project to manage its components.",
        ]),
      );
      return;
    }

    if (this.components.length === 0) {
      this.listEl.append(
        h("div", { class: "empty-hint" }, [
          packageIcon(28),
          "No components added yet. Add one above, e.g. espressif/led_strip.",
        ]),
      );
      return;
    }

    this.listEl.append(...this.components.map((c) => this.renderRow(c)));
  }

  private renderRow(component: EspComponent): HTMLElement {
    const statusEl = h("span", { class: "lib-status" }, []);
    const removeBtn = h("button", { class: "btn btn-danger btn-sm" }, ["Remove"]) as HTMLButtonElement;

    const row = h("div", { class: "lib-item" }, [
      h("div", { class: "lib-item-top" }, [
        h("div", { class: "lib-item-info" }, [
          h("div", { class: "lib-name" }, [component.name]),
          h("div", { class: "lib-owner" }, [
            component.version ? `v${component.version}` : `constraint ${component.spec}`,
          ]),
        ]),
        h("div", { class: "lib-actions" }, [removeBtn]),
      ]),
      component.description ? h("div", { class: "lib-desc" }, [component.description]) : null,
      statusEl,
    ]);

    removeBtn.addEventListener("click", () => this.startRemove(component, row, statusEl, removeBtn));

    return row;
  }
}
