import { h } from "./dom";

export type ToastKind = "success" | "error" | "info";

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (!container) {
    container = h("div", { class: "toast-container" }, []);
    document.body.append(container);
  }
  return container;
}

/** App-wide notification bubble: a small rounded pill that slides down from
 * the top of the screen and slides back up on its own after a timeout. Use
 * this instead of ad-hoc banners/alerts for anything transient. */
export function showToast(message: string, kind: ToastKind = "info", duration = 2800) {
  const host = ensureContainer();
  const toast = h("div", { class: `toast toast-${kind}` }, [message]);
  host.append(toast);

  // Two rAFs so the initial (offscreen) state actually paints before we
  // transition to "show" — a single rAF can still coalesce with the
  // append's own layout pass and skip the animation.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add("show"));
  });

  window.setTimeout(() => {
    toast.classList.remove("show");
    toast.classList.add("hide");
    toast.addEventListener(
      "transitionend",
      () => toast.remove(),
      { once: true },
    );
    // Fallback in case transitionend never fires (e.g. reduced-motion).
    window.setTimeout(() => toast.remove(), 500);
  }, duration);
}
