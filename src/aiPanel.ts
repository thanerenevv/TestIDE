import type { UnlistenFn } from "@tauri-apps/api/event";
import { api, onAiToolCall, onAiToolResult } from "./api";
import { findPreset } from "./aiProviders";
import { clear, h } from "./dom";
import { chatIcon } from "./icons";
import type { AiSettings } from "./settings";
import type { AiChatMessage, AiProviderConfig } from "./types";

interface ActiveFile {
  path: string;
  content: string;
}

/** The AI tab's chat interface. Only ever mounted when AI features are
 * enabled in Settings — main.ts adds/removes its activity-bar entry and
 * this panel entirely based on that toggle, so none of this exists (and no
 * network call is ever made) while the feature is off. */
export class AiPanel {
  readonly el: HTMLElement;

  private messagesEl: HTMLElement;
  private input: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private toolStatusEl: HTMLElement;

  private ai: AiSettings | null = null;
  private projectPath: string | null = null;
  private activeFile: ActiveFile | null = null;
  private messages: AiChatMessage[] = [];
  private busy = false;

  private unlistenToolCall: UnlistenFn | null = null;
  private unlistenToolResult: UnlistenFn | null = null;

  constructor() {
    const clearBtn = h("button", { class: "icon-btn", title: "Clear conversation" }, ["⊘"]);
    clearBtn.addEventListener("click", () => {
      this.messages = [];
      this.render();
    });

    this.messagesEl = h("div", { class: "ai-messages" }, []);
    this.toolStatusEl = h("div", { class: "ai-tool-status" }, []);

    this.input = h("textarea", {
      class: "ai-input",
      placeholder: "Ask the AI assistant… (Enter to send, Shift+Enter for a new line)",
      rows: "2",
    }) as HTMLTextAreaElement;
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });

    this.sendBtn = h("button", { class: "btn btn-primary btn-sm" }, ["Send"]) as HTMLButtonElement;
    this.sendBtn.addEventListener("click", () => this.send());

    this.el = h("div", { class: "ai-view" }, [
      h("div", { class: "sidebar-header" }, ["AI Assistant", h("div", { class: "actions" }, [clearBtn])]),
      this.messagesEl,
      this.toolStatusEl,
      h("div", { class: "ai-input-row" }, [this.input, this.sendBtn]),
    ]);

    void this.subscribeEvents();
    this.render();
  }

  private async subscribeEvents() {
    this.unlistenToolCall = await onAiToolCall((e) => {
      if (!this.busy) return;
      this.toolStatusEl.textContent = `Running ${e.name}…`;
      this.toolStatusEl.style.display = "block";
    });
    this.unlistenToolResult = await onAiToolResult((e) => {
      if (!this.busy) return;
      this.toolStatusEl.textContent = e.ok ? `${e.name} done` : `${e.name} failed: ${e.summary}`;
    });
  }

  dispose() {
    this.unlistenToolCall?.();
    this.unlistenToolResult?.();
  }

  setAiSettings(ai: AiSettings) {
    this.ai = ai;
    this.render();
  }

  setProject(projectPath: string | null) {
    this.projectPath = projectPath;
  }

  setActiveFile(path: string | null, content: string | null) {
    this.activeFile = path && content !== null ? { path, content } : null;
  }

  private isConfigured(): boolean {
    if (!this.ai) return false;
    const preset = findPreset(this.ai.providerId);
    if (!this.ai.model.trim()) return false;
    if (preset.needsApiKey && !this.ai.apiKey.trim()) return false;
    if (preset.editableBaseUrl && !this.ai.baseUrl.trim()) return false;
    return true;
  }

  private buildProviderConfig(): AiProviderConfig {
    const ai = this.ai!;
    const preset = findPreset(ai.providerId);
    return {
      kind: preset.kind,
      baseUrl: ai.baseUrl || preset.baseUrl,
      apiKey: ai.apiKey,
      model: ai.model,
      apiVersion: ai.apiVersion || undefined,
      authStyle: preset.authStyle,
    };
  }

  private async send() {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    if (!this.isConfigured()) {
      this.render();
      return;
    }

    this.messages.push({ role: "user", content: text });
    this.input.value = "";
    this.busy = true;
    this.toolStatusEl.textContent = "";
    this.toolStatusEl.style.display = "none";
    this.render();

    try {
      const updated = await api.aiSendMessage({
        provider: this.buildProviderConfig(),
        messages: this.messages,
        projectPath: this.projectPath,
        activeFilePath: this.activeFile?.path ?? null,
        activeFileContent: this.activeFile?.content ?? null,
      });
      this.messages = updated;
    } catch (e) {
      this.messages.push({ role: "assistant", content: `Error: ${String(e)}` });
    } finally {
      this.busy = false;
      this.toolStatusEl.style.display = "none";
      this.render();
    }
  }

  private render() {
    clear(this.messagesEl);

    if (!this.ai?.enabled) {
      this.messagesEl.append(
        h("div", { class: "empty-hint" }, [chatIcon(28), "AI features are turned off. Enable them in Settings to chat here."]),
      );
      this.updateInputState(false);
      return;
    }

    if (!this.isConfigured()) {
      this.messagesEl.append(
        h("div", { class: "empty-hint" }, [
          chatIcon(28),
          "Configure a provider, API key, and model in Settings → AI Features to start chatting.",
        ]),
      );
      this.updateInputState(false);
      return;
    }

    if (this.messages.length === 0) {
      this.messagesEl.append(
        h("div", { class: "empty-hint" }, [
          chatIcon(28),
          "Ask me to explain, fix, or write code. I can read and edit files in this project and check the serial monitor.",
        ]),
      );
    } else {
      for (const m of this.messages) {
        if (m.role === "tool") {
          this.messagesEl.append(
            h("div", { class: "ai-tool-row" }, [`Tool: ${m.name ?? "unknown"}`]),
          );
          continue;
        }
        if (!m.content) continue;
        this.messagesEl.append(
          h("div", { class: `ai-bubble ai-bubble-${m.role}` }, [m.content]),
        );
      }
    }

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    this.updateInputState(true);
  }

  private updateInputState(ready: boolean) {
    this.input.disabled = !ready || this.busy;
    this.sendBtn.disabled = !ready || this.busy;
    this.sendBtn.textContent = this.busy ? "Sending…" : "Send";
  }
}
