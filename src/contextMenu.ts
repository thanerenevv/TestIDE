import { h } from "./dom";

export interface MenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

let activeMenu: HTMLElement | null = null;

function closeMenu() {
  activeMenu?.remove();
  activeMenu = null;
  document.removeEventListener("mousedown", onDocClick);
}

function onDocClick() {
  closeMenu();
}

export function showContextMenu(x: number, y: number, items: MenuItem[]) {
  closeMenu();
  const menu = h(
    "div",
    { class: "context-menu", style: `left:${x}px; top:${y}px;` },
    items.map((item) =>
      h(
        "div",
        {
          class: item.danger
            ? "context-menu-item danger"
            : "context-menu-item",
          onclick: () => {
            closeMenu();
            item.onClick();
          },
        },
        [item.label],
      ),
    ),
  );
  document.body.append(menu);

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = `${Math.max(4, window.innerWidth - rect.width - 8)}px`;
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${Math.max(4, window.innerHeight - rect.height - 8)}px`;
  }

  activeMenu = menu;
  setTimeout(() => document.addEventListener("mousedown", onDocClick), 0);
}
