export interface Settings {
  fontSize: number;
  wordWrap: boolean;
  minimap: boolean;
  tabSize: number;
  defaultBaud: number;
}

const STORAGE_KEY = "testide.settings";

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 12.5,
  wordWrap: false,
  minimap: true,
  tabSize: 2,
  defaultBaud: 115200,
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
