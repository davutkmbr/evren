/**
 * Race records: best time, best splits, best medal and the best run's path (ghost replay) per course, in localStorage.
 * Every storage access is guarded; without storage (private window, headless) the records live in memory only.
 *
 * Ghost path encoding (compact): samples at GHOST_HZ; the first sample as three Int16 (whole meters), then three Int8
 * deltas per sample in GHOST_STEP meter units, quantized against the reconstructed position so errors do not
 * accumulate. Bytes → base64. About 4 characters per sample (a 5 minute run ≈ 6 KB).
 */
import { betterMedal, type Medal } from './courses';

export const GHOST_HZ = 5;
const GHOST_STEP = 0.5;
const STORAGE_KEY = 'evren.races.v1';

export interface RaceRecord {
  /** Best finish time (s). */
  best: number;
  /** Cumulative split times (s) of the best run, one per gate. */
  splits: number[];
  /** Encoded ghost path of the best run (see encodeGhost). */
  ghost?: string;
  /** ISO date of the record. */
  date?: string;
  /** Best medal earned on this course (any run). */
  medal?: Medal;
  /** Finished runs on this course (records from before this field count their best run once). */
  runs?: number;
}

export interface SubmitResult {
  /** Best time before this run (undefined for a first finish). */
  previousBest?: number;
  /** This run became the record. */
  newRecord: boolean;
  /** Best medal on the course after this run (null = none yet). */
  medal: Medal | null;
  /** This run improved the course's best medal. */
  newMedal: boolean;
}

export type RecordTable = Record<string, RaceRecord>;

let memory: RecordTable | null = null;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is RaceRecord {
  const r = v as RaceRecord;
  return !!r && typeof r.best === 'number' && Number.isFinite(r.best) && Array.isArray(r.splits);
}

const MEDALS: ReadonlySet<string> = new Set(['gold', 'silver', 'bronze']);

export function loadRecords(): RecordTable {
  if (memory) {
    return memory;
  }
  const table: RecordTable = {};
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [id, rec] of Object.entries(parsed)) {
        if (isRecord(rec)) {
          if (rec.medal !== undefined && !MEDALS.has(rec.medal)) {
            delete rec.medal;
          }
          if (rec.runs !== undefined && !(typeof rec.runs === 'number' && Number.isFinite(rec.runs) && rec.runs >= 1)) {
            delete rec.runs;
          }
          table[id] = rec;
        }
      }
    }
  } catch {
    // Corrupt or blocked storage: start empty.
  }
  memory = table;
  return table;
}

function saveRecords(table: RecordTable): void {
  memory = table;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(table));
  } catch {
    // Quota or blocked storage: keep the in-memory copy.
  }
}

/** Finished runs behind a record (0 without one; an older record without a count stands for one run). */
export function recordRuns(rec: RaceRecord | undefined): number {
  return rec ? Math.max(1, Math.floor(rec.runs ?? 1)) : 0;
}

export function getRecord(courseId: string): RaceRecord | undefined {
  return loadRecords()[courseId];
}

/**
 * Stores a finished run if it beats the record (the course's best medal is kept separately: it only ever improves).
 * `medal` is the medal this run earned (null/undefined = none).
 */
export function submitRun(courseId: string, time: number, splits: readonly number[], ghost?: string, medal?: Medal | null): SubmitResult {
  const table = { ...loadRecords() };
  const prev = table[courseId];
  const bestMedal = betterMedal(prev?.medal, medal);
  const newMedal = !!medal && bestMedal === medal && prev?.medal !== medal;
  const runs = recordRuns(prev) + 1;
  if (prev && prev.best <= time) {
    table[courseId] = { ...prev, medal: bestMedal ?? undefined, runs };
    saveRecords(table);
    return { previousBest: prev.best, newRecord: false, medal: bestMedal, newMedal };
  }
  table[courseId] = { best: time, splits: splits.slice(), ghost, date: new Date().toISOString(), medal: bestMedal ?? undefined, runs };
  saveRecords(table);
  return { previousBest: prev?.best, newRecord: true, medal: bestMedal, newMedal };
}

export function clearRecords(courseId?: string): void {
  const table = { ...loadRecords() };
  if (courseId) {
    delete table[courseId];
  } else {
    for (const k of Object.keys(table)) {
      delete table[k];
    }
  }
  saveRecords(table);
}

/* ------------------------------------------------------------------ */
/* Ghost path                                                          */
/* ------------------------------------------------------------------ */

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i);
  }
  return out;
}

/** Encodes positions [x0, y0, z0, x1, …] sampled at GHOST_HZ. */
export function encodeGhost(samples: ArrayLike<number>): string {
  const n = Math.floor(samples.length / 3);
  if (n === 0) {
    return '';
  }
  const bytes = new Uint8Array(6 + (n - 1) * 3);
  const view = new DataView(bytes.buffer);
  const clamp16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));
  const rec = [clamp16(samples[0]), clamp16(samples[1]), clamp16(samples[2])];
  view.setInt16(0, rec[0], true);
  view.setInt16(2, rec[1], true);
  view.setInt16(4, rec[2], true);
  for (let i = 1; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const d = Math.max(-127, Math.min(127, Math.round((samples[i * 3 + k] - rec[k]) / GHOST_STEP)));
      rec[k] += d * GHOST_STEP;
      view.setInt8(6 + (i - 1) * 3 + k, d);
    }
  }
  return toBase64(bytes);
}

/** Decodes an encoded ghost path back to positions [x0, y0, z0, …] at GHOST_HZ. */
export function decodeGhost(text: string): Float32Array {
  if (!text) {
    return new Float32Array(0);
  }
  const bytes = fromBase64(text);
  if (bytes.length < 6) {
    return new Float32Array(0);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = 1 + Math.floor((bytes.length - 6) / 3);
  const out = new Float32Array(n * 3);
  let x = view.getInt16(0, true);
  let y = view.getInt16(2, true);
  let z = view.getInt16(4, true);
  out[0] = x;
  out[1] = y;
  out[2] = z;
  for (let i = 1; i < n; i++) {
    const o = 6 + (i - 1) * 3;
    x += view.getInt8(o) * GHOST_STEP;
    y += view.getInt8(o + 1) * GHOST_STEP;
    z += view.getInt8(o + 2) * GHOST_STEP;
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}

/** Records the dragon's path at GHOST_HZ during a run. */
export class GhostRecorder {
  private readonly samples: number[] = [];
  private acc = 0;

  reset(): void {
    this.samples.length = 0;
    this.acc = 0;
  }

  /** Call every running frame; the first call records a sample immediately. */
  push(dt: number, x: number, y: number, z: number): void {
    if (this.samples.length === 0) {
      this.samples.push(x, y, z);
      this.acc = 0;
      return;
    }
    this.acc += dt;
    const period = 1 / GHOST_HZ;
    while (this.acc >= period) {
      this.acc -= period;
      this.samples.push(x, y, z);
    }
  }

  get count(): number {
    return this.samples.length / 3;
  }

  encode(): string {
    return encodeGhost(this.samples);
  }
}
