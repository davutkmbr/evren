/**
 * Persistence of the tutorial hints: the "İpuçları" switch and, per hint, how often it was shown and whether the move
 * was tried or learned. One localStorage entry; every access is guarded (private windows, blocked site data) and a
 * missing or corrupt entry falls back to the defaults. Headless checks pass a memory storage.
 */

const STORAGE_KEY = 'ejderha.ui.tutorial.v1';

/** The part of Storage the store uses. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface TutorialProgress {
  enabled: boolean;
  /** Times each hint was on screen. */
  shown: Record<string, number>;
  /** Hints whose move was performed at least once (clean or not). */
  tried: Set<string>;
  /** Hints whose move was performed cleanly: never shown again. */
  learned: Set<string>;
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

const stringSet = (v: unknown): Set<string> => new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export class TutorialStore {
  readonly progress: TutorialProgress;

  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {
    this.progress = this.load();
  }

  private load(): TutorialProgress {
    const progress: TutorialProgress = { enabled: true, shown: {}, tried: new Set(), learned: new Set() };
    let raw: string | null = null;
    try {
      raw = this.storage?.getItem(STORAGE_KEY) ?? null;
    } catch {
      raw = null;
    }
    if (!raw) {
      return progress;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown> | null;
      if (typeof parsed?.enabled === 'boolean') {
        progress.enabled = parsed.enabled;
      }
      const shown = parsed?.shown;
      if (shown && typeof shown === 'object') {
        for (const [id, n] of Object.entries(shown as Record<string, unknown>)) {
          if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
            progress.shown[id] = Math.floor(n);
          }
        }
      }
      progress.tried = stringSet(parsed?.tried);
      progress.learned = stringSet(parsed?.learned);
    } catch {
      /* corrupt entry: defaults */
    }
    return progress;
  }

  save(): void {
    const p = this.progress;
    const data = { v: 1, enabled: p.enabled, shown: p.shown, tried: [...p.tried], learned: [...p.learned] };
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable or full */
    }
  }

  /** "İpuçlarını sıfırla": every hint may show again; the switch keeps its state. */
  reset(): void {
    this.progress.shown = {};
    this.progress.tried.clear();
    this.progress.learned.clear();
    this.save();
  }
}
