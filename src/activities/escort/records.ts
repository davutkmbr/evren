/**
 * Ferry escort records: the legs ("hatlar") the player has escorted a ferry along, in localStorage. Every storage
 * access is guarded; without storage (private window, headless) the records live in memory for the session.
 *
 * The routes that count are the directed legs of the scheduled vapur and city ferry lines (fleet-data SERVICE_LINES,
 * the kinds of the moments' 'ferry' anchor): a line A → B → C runs A→B, B→C, C→B, B→A.
 */
import { ANCHOR_KINDS } from '../../moments/anchors';
import { SERVICE_LINES } from '../../world/life/vessels/fleet-data';
import { routeKey } from './escort';

const STORAGE_KEY = 'evren.escort.v1';

export interface EscortRouteRecord {
  /** Times escorted to the pier. */
  count: number;
  /** Shortest escort of the leg (s). */
  best: number;
  /** ISO date of the last escort. */
  last?: string;
}

export type EscortRecordTable = Record<string, EscortRouteRecord>;

/** Every directed leg of the escortable lines, in line order, without duplicates. */
export const ESCORT_ROUTES: readonly string[] = (() => {
  const kinds = ANCHOR_KINDS.ferry;
  const out: string[] = [];
  for (const line of SERVICE_LINES) {
    if (!kinds.includes(line.model)) {
      continue;
    }
    const ids = line.stops.map(([id]) => id);
    const order = [...ids, ...ids.slice(1, -1).reverse()];
    for (let k = 0; k < order.length; k++) {
      const key = routeKey(order[k], order[(k + 1) % order.length]);
      if (!out.includes(key)) {
        out.push(key);
      }
    }
  }
  return out;
})();

let memory: EscortRecordTable | null = null;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is EscortRouteRecord {
  const r = v as EscortRouteRecord;
  return !!r && typeof r.count === 'number' && r.count >= 1 && typeof r.best === 'number' && Number.isFinite(r.best);
}

export function loadEscortRecords(): EscortRecordTable {
  if (memory) {
    return memory;
  }
  const table: EscortRecordTable = {};
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (raw) {
      for (const [key, rec] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) {
        if (isRecord(rec)) {
          table[key] = rec;
        }
      }
    }
  } catch {
    // Corrupt or unreadable: start over (in memory).
  }
  memory = table;
  return table;
}

function save(table: EscortRecordTable): void {
  memory = table;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(table));
  } catch {
    // Storage full or unavailable: keep the in-memory table.
  }
}

/** Escorted routes of ESCORT_ROUTES so far. */
export function escortedRouteCount(table: EscortRecordTable = loadEscortRecords()): number {
  let n = 0;
  for (const key of ESCORT_ROUTES) {
    if (table[key]) {
      n++;
    }
  }
  return n;
}

export interface EscortRecordResult {
  /** First escort of this leg. */
  first: boolean;
  /** Escorted routes after this one, of `total`. */
  done: number;
  total: number;
  record: EscortRouteRecord;
}

/** Records a completed leg (`seconds` escorted). */
export function recordEscort(key: string, seconds: number, date = new Date()): EscortRecordResult {
  const table = { ...loadEscortRecords() };
  const prev = table[key];
  const dur = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const record: EscortRouteRecord = prev
    ? { count: prev.count + 1, best: Math.min(prev.best, dur), last: date.toISOString() }
    : { count: 1, best: dur, last: date.toISOString() };
  table[key] = record;
  save(table);
  return { first: !prev, done: escortedRouteCount(table), total: ESCORT_ROUTES.length, record };
}

/** Clears the records (debug hook, checks). */
export function clearEscortRecords(): void {
  memory = {};
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
}
