import { api } from "./api";
import { AI_PROVIDER_PRESETS, findPreset } from "./aiProviders";
import { clear, h } from "./dom";
import type { AiSettings, Settings } from "./settings";
import { installEspIdf, installPlatformio } from "./toolchainInstall";

const BAUD_RATES = [9600, 19200, 38400, 57600, 74880, 115200, 230400, 460800, 921600];
const TAB_SIZES = [2, 4, 8];

export function openSettingsModal(current: Settings, onChange: (s: Settings) => void) {
  const settings: Settings = { ...current };
  const overlay = h("div", { class: "modal-overlay" });

  function emit() {
    onChange({ ...settings });
  }

  // --- editor ---
  const fontSizeInput = h("input", {
    type: "number",
    min: "8",
    max: "32",
    step: "0.5",
    value: String(settings.fontSize),
  }) as HTMLInputElement;
  fontSizeInput.addEventListener("input", () => {
    const v = parseFloat(fontSizeInput.value);
    if (!Number.isNaN(v) && v > 0) {
      settings.fontSize = v;
      emit();
    }
  });

  const wordWrapInput = h("input", { type: "checkbox" }) as HTMLInputElement;
  wordWrapInput.checked = settings.wordWrap;
  wordWrapInput.addEventListener("change", () => {
    settings.wordWrap = wordWrapInput.checked;
    emit();
  });

  const minimapInput = h("input", { type: "checkbox" }) as HTMLInputElement;
  minimapInput.checked = settings.minimap;
  minimapInput.addEventListener("change", () => {
    settings.minimap = minimapInput.checked;
    emit();
  });

  const tabSizeSelect = h(
    "select",
    {},
    TAB_SIZES.map((n) => h("option", { value: String(n) }, [String(n)])),
  ) as HTMLSelectElement;
  tabSizeSelect.value = String(settings.tabSize);
  tabSizeSelect.addEventListener("change", () => {
    settings.tabSize = Number(tabSizeSelect.value);
    emit();
  });

  // --- serial ---
  const baudSelect = h(
    "select",
    {},
    BAUD_RATES.map((b) => h("option", { value: String(b) }, [`${b} baud`])),
  ) as HTMLSelectElement;
  baudSelect.value = String(settings.defaultBaud);
  baudSelect.addEventListener("change", () => {
    settings.defaultBaud = Number(baudSelect.value);
    emit();
  });

  // --- AI features ---
  const aiEnabledInput = h("input", { type: "checkbox" }) as HTMLInputElement;
  aiEnabledInput.checked = settings.ai.enabled;
  const aiConfigureBtn = h("button", { class: "btn" }, ["Configure…"]) as HTMLButtonElement;
  aiConfigureBtn.disabled = !settings.ai.enabled;
  aiEnabledInput.addEventListener("change", () => {
    settings.ai = { ...settings.ai, enabled: aiEnabledInput.checked };
    aiConfigureBtn.disabled = !settings.ai.enabled;
    emit();
  });
  aiConfigureBtn.addEventListener("click", () => {
    openAiConfigureModal(settings.ai, (updated) => {
      settings.ai = updated;
      emit();
    });
  });

  // --- toolchains ---
  const toolchainBody = h("div", { class: "field", style: "gap:8px" });

  async function refreshToolchains() {
    clear(toolchainBody);
    toolchainBody.append(h("div", { class: "empty-hint" }, ["Checking toolchains…"]));
    let pio, idf;
    try {
      [pio, idf] = await Promise.all([api.checkEnvironment(), api.checkIdfEnvironment()]);
    } catch (e) {
      clear(toolchainBody);
      toolchainBody.append(h("div", { class: "empty-hint" }, [`Failed to check toolchains: ${e}`]));
      return;
    }
    clear(toolchainBody);

    const pioInstallBtn = h("button", { class: "btn" }, ["Install PlatformIO"]);
    pioInstallBtn.addEventListener("click", () => installPlatformio());
    const idfInstallBtn = h("button", { class: "btn" }, ["Install ESP-IDF"]);
    idfInstallBtn.addEventListener("click", () => installEspIdf());

    toolchainBody.append(
      h("div", { class: "toolchain-row" }, [
        h("div", {}, [
          h("div", { class: "toolchain-name" }, ["PlatformIO"]),
          h("div", { class: "toolchain-detail" }, [
            pio.pio_found
              ? (pio.pio_version ?? "Detected").trim()
              : "Not detected on this system",
          ]),
        ]),
        pio.pio_found ? null : pioInstallBtn,
      ]),
      h("div", { class: "toolchain-row" }, [
        h("div", {}, [
          h("div", { class: "toolchain-name" }, ["ESP-IDF"]),
          h("div", { class: "toolchain-detail" }, [
            idf.idf_found
              ? idf.env_ready
                ? (idf.idf_version ?? "Detected").trim() + (idf.via_eim ? " (via eim)" : "")
                : "Found but not initialized (run install.sh)"
              : "Not detected on this system",
          ]),
        ]),
        idf.idf_found ? null : idfInstallBtn,
      ]),
    );
  }

  const recheckBtn = h("button", { class: "btn" }, ["Recheck"]);
  recheckBtn.addEventListener("click", () => refreshToolchains());
  refreshToolchains();

  const closeBtn = h("button", { class: "btn btn-primary" }, ["Done"]);
  closeBtn.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const modal = h("div", { class: "modal", style: "width:460px" }, [
    h("div", { class: "modal-header" }, ["Settings"]),
    h("div", { class: "modal-body" }, [
      h("div", { class: "settings-section-title" }, ["Editor"]),
      h("div", { class: "field" }, [
        h("label", {}, ["Font Size"]),
        fontSizeInput,
      ]),
      h("div", { class: "field-check" }, [wordWrapInput, h("span", {}, ["Word Wrap"])]),
      h("div", { class: "field-check" }, [minimapInput, h("span", {}, ["Minimap"])]),
      h("div", { class: "field" }, [h("label", {}, ["Tab Size"]), tabSizeSelect]),

      h("div", { class: "settings-section-title" }, ["Serial Monitor"]),
      h("div", { class: "field" }, [
        h("label", {}, ["Default Baud Rate"]),
        baudSelect,
      ]),

      h("div", { class: "settings-section-title" }, ["AI Features"]),
      h("div", { class: "field-check" }, [aiEnabledInput, h("span", {}, ["Enable AI Features"])]),
      h("div", { style: "display:flex" }, [aiConfigureBtn]),
      h("div", { class: "empty-hint", style: "padding: 0" }, [
        "Off by default. When enabled, an AI tab appears next to Explorer and Libraries — it can chat, read/edit project files, and read recent serial monitor output. Your API key is stored locally on this machine.",
      ]),

      h("div", { class: "settings-section-title" }, ["Toolchains"]),
      toolchainBody,
      h("div", {}, [recheckBtn]),
    ]),
    h("div", { class: "modal-footer" }, [closeBtn]),
  ]);
  overlay.append(modal);
  document.body.append(overlay);
}

function openAiConfigureModal(current: AiSettings, onSave: (ai: AiSettings) => void) {
  const draft: AiSettings = { ...current };
  const overlay = h("div", { class: "modal-overlay" });

  const providerSelect = h(
    "select",
    {},
    AI_PROVIDER_PRESETS.map((p) => h("option", { value: p.id }, [p.label])),
  ) as HTMLSelectElement;
  providerSelect.value = draft.providerId;

  const apiKeyInput = h("input", { type: "password", placeholder: "sk-…" }) as HTMLInputElement;
  apiKeyInput.value = draft.apiKey;
  const apiKeyField = h("div", { class: "field" }, [h("label", {}, ["API Key"]), apiKeyInput]);

  const baseUrlInput = h("input", { type: "text" }) as HTMLInputElement;
  const baseUrlField = h("div", { class: "field" }, [h("label", {}, ["Base URL"]), baseUrlInput]);

  const apiVersionInput = h("input", { type: "text", placeholder: "2024-08-01-preview" }) as HTMLInputElement;
  const apiVersionField = h("div", { class: "field" }, [h("label", {}, ["API Version"]), apiVersionInput]);

  const modelInput = h("input", { type: "text" }) as HTMLInputElement;
  modelInput.value = draft.model;
  const modelField = h("div", { class: "field" }, [h("label", {}, ["Model"]), modelInput]);

  function applyPreset(keepValues: boolean) {
    const preset = findPreset(providerSelect.value);
    apiKeyField.style.display = preset.needsApiKey ? "flex" : "none";
    apiVersionField.style.display = preset.needsApiVersion ? "flex" : "none";
    baseUrlInput.disabled = !preset.editableBaseUrl;
    modelInput.placeholder = preset.placeholderModel;
    if (!keepValues || (baseUrlInput.value === "" && preset.baseUrl)) {
      baseUrlInput.value = preset.baseUrl;
    }
  }
  baseUrlInput.value = draft.baseUrl;
  apiVersionInput.value = draft.apiVersion;
  applyPreset(true);

  providerSelect.addEventListener("change", () => {
    baseUrlInput.value = "";
    applyPreset(false);
  });

  const cancelBtn = h("button", { class: "btn" }, ["Cancel"]);
  cancelBtn.addEventListener("click", () => overlay.remove());
  const saveBtn = h("button", { class: "btn btn-primary" }, ["Save"]);
  saveBtn.addEventListener("click", () => {
    onSave({
      enabled: draft.enabled,
      providerId: providerSelect.value,
      apiKey: apiKeyInput.value,
      baseUrl: baseUrlInput.value,
      model: modelInput.value.trim(),
      apiVersion: apiVersionInput.value.trim(),
    });
    overlay.remove();
  });
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const modal = h("div", { class: "modal", style: "width:420px" }, [
    h("div", { class: "modal-header" }, ["Configure AI Provider"]),
    h("div", { class: "modal-body" }, [
      h("div", { class: "field" }, [h("label", {}, ["Provider"]), providerSelect]),
      baseUrlField,
      apiKeyField,
      apiVersionField,
      modelField,
    ]),
    h("div", { class: "modal-footer" }, [cancelBtn, saveBtn]),
  ]);
  overlay.append(modal);
  document.body.append(overlay);
}
