const listeners = new Set();

export const state = {
  docId: null,
  docName: 'Documento sin título',
  dirty: false,
  saving: false,
  zoom: 1,
  theme: 'light',
  spellcheck: true,
  sidebarOpen: true,
  sidebarTab: 'outline',
  browseFolder: null,
  findOpen: false,
  currentPage: 1,
  totalPages: 1
};

export function setState(patch) {
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (state[k] !== v) {
      state[k] = v;
      changed = true;
    }
  }
  if (changed) listeners.forEach((fn) => fn(state, patch));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const SETTINGS_KEY = 'papiro.settings';

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveSettings(patch) {
  const current = loadSettings();
  const next = { ...current, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch { /* almacenamiento lleno o no disponible */ }
  return next;
}
