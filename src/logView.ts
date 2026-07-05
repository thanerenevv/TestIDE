import { clear, h } from "./dom";

export class LogView {
  el: HTMLElement;
  private autoScroll = true;
  private lineCount = 0;
  private readonly maxLines = 6000;

  constructor() {
    this.el = h("div", { class: "log-view" });
    this.el.addEventListener("scroll", () => {
      const atBottom =
        this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight < 32;
      this.autoScroll = atBottom;
    });
  }

  append(text: string, cls = "") {
    const line = h("div", { class: cls ? `log-line ${cls}` : "log-line" }, [
      text.length ? text : " ",
    ]);
    this.el.append(line);
    this.lineCount++;
    if (this.lineCount > this.maxLines) {
      this.el.firstElementChild?.remove();
    }
    if (this.autoScroll) {
      this.el.scrollTop = this.el.scrollHeight;
    }
  }

  clearLog() {
    clear(this.el);
    this.lineCount = 0;
    this.autoScroll = true;
  }
}
