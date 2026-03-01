import type { Settings } from './types';

const STORAGE_KEY = 'cc-settings';

const defaults: Settings = {
  apiUrl: window.location.origin,
  authToken: '',
  defaultModel: 'gpt-5.3-codex',
  defaultWorkingDirectory: '',
  defaultBackend: 'codex',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...defaults };
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}
