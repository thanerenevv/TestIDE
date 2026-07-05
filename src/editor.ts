// Import only the editor core plus the languages this IDE actually needs
// (C/C++, Python, ini, Markdown, YAML) instead of monaco-editor's default
// barrel, which also pulls in the TypeScript/CSS/HTML/JSON language
// services and their multi-megabyte workers — dead weight for a firmware
// IDE that never edits those file types.
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution.js";
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker() {
    return new EditorWorker();
  },
};

monaco.editor.defineTheme("embedforge-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6b7078", fontStyle: "italic" },
    { token: "keyword", foreground: "e8a6d0" },
    { token: "number", foreground: "d19a66" },
    { token: "string", foreground: "9ecf8f" },
    { token: "type", foreground: "5fb9e0" },
    { token: "identifier", foreground: "eceeee" },
  ],
  colors: {
    "editor.background": "#28292c",
    "editor.foreground": "#eceeee",
    "editorLineNumber.foreground": "#565860",
    "editorLineNumber.activeForeground": "#b8bcc0",
    "editor.selectionBackground": "#4a9eff33",
    "editor.inactiveSelectionBackground": "#4a9eff1a",
    "editorCursor.foreground": "#4a9eff",
    "editorIndentGuide.background": "#333438",
    "editorIndentGuide.activeBackground": "#4a4b50",
    "editorGutter.background": "#28292c",
    "editorWidget.background": "#2f3033",
    "editorWidget.border": "#3a3b3f",
    "editorSuggestWidget.background": "#2f3033",
    "editorSuggestWidget.border": "#3a3b3f",
    "minimap.background": "#232427",
    "scrollbarSlider.background": "#ffffff14",
    "scrollbarSlider.hoverBackground": "#ffffff22",
  },
});

interface OpenModel {
  model: monaco.editor.ITextModel;
  savedVersionId: number;
}

const DEFAULT_FONT_SIZE = 12.5;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;

export interface EditorSettings {
  fontSize: number;
  wordWrap: boolean;
  minimap: boolean;
  tabSize: number;
}

export class EditorHost {
  private editor: monaco.editor.IStandaloneCodeEditor;
  private files = new Map<string, OpenModel>();
  private fontSize: number;
  onDirtyChange?: (path: string, dirty: boolean) => void;
  onSave?: (path: string) => void;

  constructor(container: HTMLElement, initial?: Partial<EditorSettings>) {
    this.fontSize = initial?.fontSize ?? DEFAULT_FONT_SIZE;
    this.editor = monaco.editor.create(container, {
      automaticLayout: true,
      theme: "embedforge-dark",
      fontSize: this.fontSize,
      fontFamily: "SF Mono, Menlo, Monaco, Cascadia Code, monospace",
      minimap: { enabled: initial?.minimap ?? true },
      smoothScrolling: true,
      cursorBlinking: "smooth",
      renderWhitespace: "selection",
      scrollBeyondLastLine: false,
      wordWrap: initial?.wordWrap ? "on" : "off",
      tabSize: initial?.tabSize ?? 2,
      padding: { top: 10 },
    });

    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const path = this.activePath();
      if (path) this.onSave?.(path);
    });
  }

  zoomIn() {
    this.fontSize = Math.min(MAX_FONT_SIZE, this.fontSize + 1);
    this.editor.updateOptions({ fontSize: this.fontSize });
  }

  zoomOut() {
    this.fontSize = Math.max(MIN_FONT_SIZE, this.fontSize - 1);
    this.editor.updateOptions({ fontSize: this.fontSize });
  }

  resetZoom() {
    this.fontSize = DEFAULT_FONT_SIZE;
    this.editor.updateOptions({ fontSize: this.fontSize });
  }

  setFontSize(size: number) {
    this.fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
    this.editor.updateOptions({ fontSize: this.fontSize });
  }

  setWordWrap(on: boolean) {
    this.editor.updateOptions({ wordWrap: on ? "on" : "off" });
  }

  setMinimap(on: boolean) {
    this.editor.updateOptions({ minimap: { enabled: on } });
  }

  setTabSize(size: number) {
    this.editor.updateOptions({ tabSize: size });
  }

  private activePath(): string | undefined {
    const model = this.editor.getModel();
    if (!model) return undefined;
    for (const [path, entry] of this.files) {
      if (entry.model === model) return path;
    }
    return undefined;
  }

  isOpen(path: string): boolean {
    return this.files.has(path);
  }

  openFile(path: string, contents: string, language: string) {
    let entry = this.files.get(path);
    if (!entry) {
      const uri = monaco.Uri.file(path);
      const model = monaco.editor.createModel(contents, language, uri);
      model.onDidChangeContent(() => {
        const e = this.files.get(path);
        if (!e) return;
        const dirty = model.getAlternativeVersionId() !== e.savedVersionId;
        this.onDirtyChange?.(path, dirty);
      });
      entry = { model, savedVersionId: model.getAlternativeVersionId() };
      this.files.set(path, entry);
    }
    this.editor.setModel(entry.model);
    this.editor.focus();
  }

  getValue(path: string): string | undefined {
    return this.files.get(path)?.model.getValue();
  }

  markSaved(path: string) {
    const entry = this.files.get(path);
    if (!entry) return;
    entry.savedVersionId = entry.model.getAlternativeVersionId();
    this.onDirtyChange?.(path, false);
  }

  closeFile(path: string) {
    const entry = this.files.get(path);
    if (!entry) return;
    if (this.editor.getModel() === entry.model) {
      this.editor.setModel(null);
    }
    entry.model.dispose();
    this.files.delete(path);
  }

  clear() {
    this.editor.setModel(null);
  }

  layout() {
    this.editor.layout();
  }
}
