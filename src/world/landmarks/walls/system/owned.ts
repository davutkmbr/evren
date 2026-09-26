/**
 * OSM buildings the city walls draw themselves (towers, gate pylons, wall rings; baked index `owned`, see
 * data/baked.ts). The OSM building layer leaves them out: wallsReady() resolves once the list is known (empty when
 * the walls are not baked), after which isWallOwned() answers synchronously.
 */
import type { WallsIndex } from '../data/baked';

export const WALLS_BASE = `${import.meta.env?.BASE_URL ?? '/'}world/walls/`;

let owned: ReadonlySet<number> = new Set();
let indexJob: Promise<WallsIndex | null> | null = null;

/** The baked walls index (fetched once), or null when there is none. */
export function wallsIndex(): Promise<WallsIndex | null> {
  return (indexJob ??= fetch(`${WALLS_BASE}index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<WallsIndex>) : null))
    .then((index) => {
      owned = new Set(index?.owned ?? []);
      return index;
    })
    .catch((e: unknown) => {
      console.warn('[walls] no baked walls index (npm run compile:walls)', e);
      return null;
    }));
}

/** Resolves when isWallOwned() is final. */
export function wallsReady(): Promise<void> {
  return wallsIndex().then(() => undefined);
}

export function isWallOwned(osmId: number): boolean {
  return owned.has(osmId);
}
