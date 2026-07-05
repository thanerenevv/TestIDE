import type { UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { api, onTerminalExit, onTerminalOutput } from "./api";

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** One pty-backed shell session, rendered with xterm.js. */
export class TerminalPane {
  readonly id: string;
  readonly label: string;
  readonly el: HTMLElement;
  private term: Terminal;
  private fit: FitAddon;
  private unlistenOutput?: UnlistenFn;
  private unlistenExit?: UnlistenFn;
  private started = false;
  private disposed = false;
  onExit?: () => void;

  constructor(id: string, label: string) {
    this.id = id;
    this.label = label;
    this.el = document.createElement("div");
    this.el.className = "terminal-pane";

    this.term = new Terminal({
      fontFamily: "SF Mono, Menlo, Monaco, Cascadia Code, monospace",
      fontSize: 12.5,
      theme: {
        background: "#28292c",
        foreground: "#eceeee",
        cursor: "#4a9eff",
        selectionBackground: "#4a9eff33",
      },
      cursorBlink: true,
      scrollback: 5000,
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(this.el);

    this.term.onData((data) => {
      void api.terminalWrite(this.id, data).catch(() => {});
    });
  }

  async start(cwd: string | null) {
    if (this.started || this.disposed) return;
    this.started = true;
    this.fit.fit();

    // Register the output/exit listeners BEFORE spawning the shell. The
    // backend's reader thread starts emitting bytes the instant the pty is
    // created, so a listener attached only after `terminalSpawn` resolves
    // would miss the shell's initial prompt/banner.
    const unlistenOutput = await onTerminalOutput((e) => {
      if (e.id !== this.id) return;
      this.term.write(decodeBase64(e.data));
    });
    const unlistenExit = await onTerminalExit((e) => {
      if (e.id !== this.id) return;
      this.term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
      this.onExit?.();
    });

    // If the pane was closed while we were awaiting listener registration,
    // tear the listeners down and skip spawning an orphaned shell.
    if (this.disposed) {
      unlistenOutput();
      unlistenExit();
      return;
    }
    this.unlistenOutput = unlistenOutput;
    this.unlistenExit = unlistenExit;

    try {
      await api.terminalSpawn(this.id, cwd, this.term.cols, this.term.rows);
    } catch (e) {
      this.term.write(`\r\n\x1b[31mFailed to start terminal: ${String(e)}\x1b[0m\r\n`);
    }
  }

  resize() {
    if (this.el.clientWidth === 0 || this.el.clientHeight === 0) return;
    this.fit.fit();
    void api.terminalResize(this.id, this.term.cols, this.term.rows).catch(() => {});
  }

  focus() {
    this.term.focus();
  }

  dispose() {
    this.disposed = true;
    this.unlistenOutput?.();
    this.unlistenExit?.();
    void api.terminalKill(this.id).catch(() => {});
    this.term.dispose();
    this.el.remove();
  }
}
