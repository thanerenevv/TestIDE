import { clear, h } from "./dom";
import { fileGlyph } from "./fileIcons";
import type { FileNode, SerialPort } from "./types";

export interface TreeCallbacks {
  onOpenFile: (path: string) => void;
  onContextMenu: (
    path: string | null,
    isDir: boolean,
    x: number,
    y: number,
  ) => void;
  isSelected: (path: string) => boolean;
  isExpanded: (path: string) => boolean;
  onToggleExpand: (path: string) => void;
}

export function renderTree(
  container: HTMLElement,
  nodes: FileNode[],
  cb: TreeCallbacks,
) {
  clear(container);
  container.addEventListener("contextmenu", (e) => {
    if (e.target === container) {
      e.preventDefault();
      cb.onContextMenu(null, true, e.clientX, e.clientY);
    }
  });
  if (nodes.length === 0) {
    container.append(
      h("div", { class: "empty-hint" }, ["This folder is empty."]),
    );
    return;
  }
  container.append(...nodes.map((n) => renderNode(n, 0, cb)));
}

function renderNode(node: FileNode, depth: number, cb: TreeCallbacks): HTMLElement {
  const wrapper = h("div");
  const expanded = node.is_dir && cb.isExpanded(node.path);
  const glyph = fileGlyph(node.name);

  const row = h(
    "div",
    {
      class: `tree-row${cb.isSelected(node.path) ? " selected" : ""}`,
      style: `padding-left: ${10 + depth * 14}px`,
      onclick: () => {
        if (node.is_dir) cb.onToggleExpand(node.path);
        else cb.onOpenFile(node.path);
      },
      oncontextmenu: (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        cb.onContextMenu(node.path, node.is_dir, e.clientX, e.clientY);
      },
    },
    [
      h("span", { class: `chevron${expanded ? " open" : ""}` }, [
        node.is_dir ? "▶" : "",
      ]),
      node.is_dir
        ? h("span", { class: "file-icon", style: "color: var(--text-2)" }, ["▪"])
        : h(
            "span",
            { class: "file-icon", style: `color: ${glyph.color}` },
            [glyph.glyph],
          ),
      h("span", {}, [node.name]),
    ],
  );
  wrapper.append(row);

  if (expanded && node.children) {
    const childrenWrap = h("div", { class: "tree-children" });
    childrenWrap.append(
      ...node.children.map((c) => renderNode(c, depth + 1, cb)),
    );
    wrapper.append(childrenWrap);
  }
  return wrapper;
}

export interface DeviceCallbacks {
  onSelect: (port: string) => void;
}

export function renderDevices(
  select: HTMLSelectElement,
  detail: HTMLElement,
  ports: SerialPort[],
  selectedPort: string | null,
  cb: DeviceCallbacks,
) {
  clear(select);
  clear(detail);

  if (ports.length === 0) {
    select.append(h("option", { value: "" }, ["No boards detected"]));
    select.disabled = true;
    detail.append(
      h("div", { class: "empty-hint" }, [
        "Plug in a board via USB. Detected devices appear here automatically.",
      ]),
    );
    return;
  }

  select.disabled = false;
  for (const p of ports) {
    select.append(
      h("option", { value: p.port }, [`${p.port}`]),
    );
  }
  const active = ports.find((p) => p.port === selectedPort) ?? ports[0];
  select.value = active.port;

  detail.append(
    h("div", { class: "port-desc" }, [
      active.description || active.hwid || "Unknown device",
    ]),
  );

  select.onchange = () => cb.onSelect(select.value);
}
