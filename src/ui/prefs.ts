/** Per-viewer UI preferences and discovery progress in localStorage. Every access is guarded. */
import type { QualityPreset } from '../core/quality';

const PREFS_KEY = 'ejderha.ui.prefs.v1';
const DISCOVERED_KEY = 'ejderha.ui.discovered.v1';

export interface UiPrefs {
  mouseSensitivity?: number;
  invertMouseY?: boolean;
  invertPitch?: boolean;
  volume?: number;
  quality?: QualityPreset;
  hudHidden?: boolean;
  /** Last opened page of the settings panel. */
  settingsPage?: string;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private window, blocked site data) */
  }
}

export function loadPrefs(): UiPrefs {
  const raw = read(PREFS_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as UiPrefs) : {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs: UiPrefs): void {
  write(PREFS_KEY, JSON.stringify(prefs));
}

export function loadDiscovered(): Set<string> {
  const raw = read(DISCOVERED_KEY);
  if (!raw) {
    return new Set();
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveDiscovered(ids: Set<string>): void {
  write(DISCOVERED_KEY, JSON.stringify([...ids]));
}

const PERCHES_KEY = 'ejderha.ui.perches.v1';

/** Viewpoints the dragon has perched on (phase 03: the first perch on each is its discovery). */
export function loadVisitedPerches(): Set<string> {
  const raw = read(PERCHES_KEY);
  if (!raw) {
    return new Set();
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveVisitedPerches(ids: Set<string>): void {
  write(PERCHES_KEY, JSON.stringify([...ids]));
}

const MAP_LAYERS_KEY = 'ejderha.ui.map-layers.v1';

/** Which marker layers the full map shows (all on by default). */
export interface MapLayers {
  known: boolean;
  unknown: boolean;
  perches: boolean;
  races: boolean;
}

export function loadMapLayers(): MapLayers {
  const layers: MapLayers = { known: true, unknown: true, perches: true, races: true };
  const raw = read(MAP_LAYERS_KEY);
  if (!raw) {
    return layers;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    for (const key of Object.keys(layers) as Array<keyof MapLayers>) {
      const value = parsed?.[key];
      if (typeof value === 'boolean') {
        layers[key] = value;
      }
    }
  } catch {
    /* corrupt value: defaults */
  }
  return layers;
}

export function saveMapLayers(layers: MapLayers): void {
  write(MAP_LAYERS_KEY, JSON.stringify(layers));
}
