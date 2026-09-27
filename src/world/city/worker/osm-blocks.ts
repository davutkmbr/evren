/**
 * Far OSM layer (phase 24) in the city workers: the bake's 2 km block files (city/osm/format.ts), fetched on demand,
 * inflated and decoded once, kept in a small cache (a worker serves a sticky region of the map, worker-pool.ts).
 */
import { inflate } from '../../../street/format';
import { BAKE_BLOCK, BAKE_HALF, type DecodedBuildings, decodeBuildings } from '../osm/format';

/** Decoded blocks kept per worker (~0.5-2 MB each). */
const CACHE_BLOCKS = 24;

export interface OsmSource {
  base: string;
  blocks: ReadonlySet<string>;
}

const cache = new Map<string, Promise<DecodedBuildings | null>>();

/** Key ("bi_bj") of the block holding the point; every city tile lies inside one block (LEVEL_SIZES divide 2 km). */
export function blockKeyOf(x: number, z: number): string {
  return `${Math.floor((x + BAKE_HALF) / BAKE_BLOCK)}_${Math.floor((z + BAKE_HALF) / BAKE_BLOCK)}`;
}

/** The decoded block, null when the bake has no file for it (no buildings) or it fails to load. */
export function loadBlock(src: OsmSource, key: string): Promise<DecodedBuildings | null> {
  if (!src.blocks.has(key)) {
    return Promise.resolve(null);
  }
  let job = cache.get(key);
  if (job) {
    // Most recently used last.
    cache.delete(key);
    cache.set(key, job);
    return job;
  }
  job = fetch(`${src.base}blocks/${key}.bin.gz`)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.arrayBuffer();
    })
    .then((wire) => inflate(wire))
    .then((bytes) => decodeBuildings(new Uint8Array(bytes)))
    .catch((err: unknown) => {
      console.warn(`[city.worker] far OSM block ${key} failed`, err);
      cache.delete(key);
      return null;
    });
  cache.set(key, job);
  while (cache.size > CACHE_BLOCKS) {
    cache.delete(cache.keys().next().value!);
  }
  return job;
}
