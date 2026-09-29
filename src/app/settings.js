// App preferences. Small, per-browser conveniences live in localStorage
// (spec §9.1); anything that matters lives in IndexedDB.
import { createSignal } from './ui/components.jsx';

const KEY = 'pe-settings-v1';

const DEFAULTS = {
  measure: 'units',
  snap: true,
  stripMetadata: true,
  backupReminders: true,
  reminderSnoozedUntil: 0,
  colorScheme: 'system',
  view: 'grid',
  sort: 'modified',
  dismissed: {},
  pdfPaper: null,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS };
}

export const settings = createSignal(load());

export function updateSettings(patch) {
  settings.set((s) => ({ ...s, ...patch }));
  try {
    localStorage.setItem(KEY, JSON.stringify(settings.get()));
  } catch {
    /* ignore */
  }
  applyColorScheme();
}

export function applyColorScheme() {
  const s = settings.get().colorScheme;
  const root = document.documentElement;
  if (s === 'light' || s === 'dark') root.dataset.theme = s;
  else delete root.dataset.theme;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';
export function shortcut(s) {
  return s.replace(/Mod/g, MOD).replace(/Alt/g, isMac ? '⌥' : 'Alt').replace(/Shift/g, isMac ? '⇧' : 'Shift');
}
