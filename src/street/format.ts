/**
 * The subset of street format 0 (tools/world-compiler/README.md) that the sandbox loader reads. The compiler's
 * `tools/world-compiler/src/format.ts` is the source of truth; these types only mirror the fields used here.
 * Frame: Evren local metres, +X east, +Y up, +Z south, sea level y = 0.
 */
export const SUPPORTED_FORMAT = 0;

export interface Bounds2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface StreetTileRef {
  id: string;
  i: number;
  j: number;
  bounds: Bounds2;
  glb: string;
  manifest: string;
  hash: string;
  bytes: number;
  triangles: number;
}

export interface StreetIndex {
  format: number;
  area: string;
  osm: { licence: string; fetched: string };
  tileSize: number;
  areaBounds: Bounds2;
  rect: Bounds2;
  materials: { name: string; color: string }[];
  tiles: StreetTileRef[];
  walkGraph: { file: string; hash: string; vertices: number; edges: number };
  hash: string;
}

export interface WalkGraphData {
  format: number;
  area: string;
  /** Flat [x, y, z, ...]. */
  vertices: number[];
  halfWidth: number[];
  /** Undirected pairs [a, b, ...]. */
  edges: number[];
  density: number[];
  tile: string[];
}

/** Ground materials of format 0 (everything a walker stands on; kerb faces are vertical and never hit). */
export const GROUND_MATERIALS: ReadonlySet<string> = new Set(['road', 'sidewalk', 'pedestrian', 'quay', 'lot', 'grass']);

/** Materials whose shadows matter at eye level (building blocks); ground, kerbs and door leaves only receive. */
export const SHADOW_CASTER_MATERIALS: ReadonlySet<string> = new Set(['wall', 'roof']);

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  return (await res.json()) as T;
}
