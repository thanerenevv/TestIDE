import { h } from "./dom";

export function promptModal(
  title: string,
  placeholder = "",
  defaultValue = "",
): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = h("div", { class: "modal-overlay" });
    const input = h("input", {
      type: "text",
      placeholder,
      value: defaultValue,
    }) as HTMLInputElement;
    let done = false;

    function finish(value: string | null) {
      if (done) return;
      done = true;
      overlay.remove();
      resolve(value);
    }

    const cancelBtn = h("button", { class: "btn" }, ["Cancel"]);
    cancelBtn.addEventListener("click", () => finish(null));
    const okBtn = h("button", { class: "btn btn-primary" }, ["OK"]);
    okBtn.addEventListener("click", () => finish(input.value.trim() || null));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(input.value.trim() || null);
      if (e.key === "Escape") finish(null);
    });
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) finish(null);
    });

    const modal = h("div", { class: "modal", style: "width:360px" }, [
      h("div", { class: "modal-header" }, [title]),
      h("div", { class: "modal-body" }, [input]),
      h("div", { class: "modal-footer" }, [cancelBtn, okBtn]),
    ]);
    overlay.append(modal);
    document.body.append(overlay);
    setTimeout(() => input.focus(), 0);
  });
}

export function confirmModal(title: string, detail: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = h("div", { class: "modal-overlay" });

    function finish(value: boolean) {
      overlay.remove();
      resolve(value);
    }

    const cancelBtn = h("button", { class: "btn" }, ["Cancel"]);
    cancelBtn.addEventListener("click", () => finish(false));
    const okBtn = h("button", { class: "btn btn-danger" }, ["Delete"]);
    okBtn.addEventListener("click", () => finish(true));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) finish(false);
    });

    const modal = h("div", { class: "modal", style: "width:360px" }, [
      h("div", { class: "modal-header" }, [title]),
      h("div", { class: "modal-body" }, [
        h(
          "p",
          {
            style:
              "margin:0;color:var(--text-1);font-size:12.5px;line-height:1.5",
          },
          [detail],
        ),
      ]),
      h("div", { class: "modal-footer" }, [cancelBtn, okBtn]),
    ]);
    overlay.append(modal);
    document.body.append(overlay);
  });
}
