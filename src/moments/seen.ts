/**
 * Moments the player has already seen (pause menu → Anlar lists them with their sources). Stored per viewer in
 * localStorage like the discoveries; every access is guarded, so a private window or blocked storage still keeps the
 * list for the session (in memory).
 */

const SEEN_KEY = 'evren.moments.seen.v1';

let cache: string[] | null = null;
const listeners = new Set<(ids: readonly string[]) => void>();

function load(): string[] {
  if (cache) {
    return cache;
  }
  cache = [];
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(parsed)) {
      cache = parsed.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    /* storage unavailable or corrupt: start empty */
  }
  return cache;
}

/** Ids of the moments seen so far, oldest first. */
export function seenMomentIds(): readonly string[] {
  return load();
}

/** Records that a moment played (first time only); returns true when it was new. */
export function markMomentSeen(id: string): boolean {
  const ids = load();
  if (ids.includes(id)) {
    return false;
  }
  ids.push(id);
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable: kept for this session */
  }
  for (const fn of listeners) {
    fn(ids);
  }
  return true;
}

/** Called whenever a moment is seen for the first time. */
export function onMomentSeen(fn: (ids: readonly string[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
