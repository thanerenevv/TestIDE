export interface AiSettings {
  enabled: boolean;
  providerId: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  apiVersion: string;
}

export interface Settings {
  fontSize: number;
  wordWrap: boolean;
  minimap: boolean;
  tabSize: number;
  defaultBaud: number;
  ai: AiSettings;
}

const STORAGE_KEY = "testide.settings";

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 12.5,
  wordWrap: false,
  minimap: true,
  tabSize: 2,
  defaultBaud: 115200,
  ai: {
    enabled: false,
    providerId: "anthropic",
    apiKey: "",
    baseUrl: "https://api.anthropic.com",
    model: "",
    apiVersion: "",
  },
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
