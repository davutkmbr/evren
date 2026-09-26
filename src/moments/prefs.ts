/**
 * The player's moment settings (Ayarlar → Oyun → Anlar): a master switch and one switch per category. Stored per viewer
 * in localStorage; every access is guarded, so the defaults apply in private windows or with blocked storage.
 */
import type { MomentCategory } from './types';

const PREFS_KEY = 'evren.moments.prefs.v1';

export interface MomentPrefs {
  /** Master switch: false silences every moment. */
  enabled: boolean;
  categories: Record<MomentCategory, boolean>;
}

export const MOMENT_CATEGORIES: readonly MomentCategory[] = ['legend', 'city-life', 'poem'];

export function defaultMomentPrefs(): MomentPrefs {
  return { enabled: true, categories: { legend: true, 'city-life': true, poem: true } };
}

export function momentAllowed(prefs: MomentPrefs, category: MomentCategory): boolean {
  return prefs.enabled && prefs.categories[category] !== false;
}

export function loadMomentPrefs(): MomentPrefs {
  const prefs = defaultMomentPrefs();
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PREFS_KEY);
  } catch {
    return prefs;
  }
  if (!raw) {
    return prefs;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MomentPrefs> | null;
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.enabled === 'boolean') {
        prefs.enabled = parsed.enabled;
      }
      for (const c of MOMENT_CATEGORIES) {
        const v = parsed.categories?.[c];
        if (typeof v === 'boolean') {
          prefs.categories[c] = v;
        }
      }
    }
  } catch {
    /* corrupt entry: keep the defaults */
  }
  return prefs;
}

const listeners = new Set<(prefs: MomentPrefs) => void>();

/** Called with a copy of the prefs whenever the settings save them (the runtime gates playback on it). */
export function onMomentPrefsChange(fn: (prefs: MomentPrefs) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function saveMomentPrefs(prefs: MomentPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable (private window, blocked site data) */
  }
  // Notified even when storage failed: the switches still apply for this session.
  for (const fn of listeners) {
    fn({ enabled: prefs.enabled, categories: { ...prefs.categories } });
  }
}
