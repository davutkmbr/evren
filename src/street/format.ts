/**
 * The subset of the street formats (tools/world-compiler/README.md) that the sandbox loader reads. The compiler's
 * `tools/world-compiler/src/format.ts` is the source of truth; these types only mirror the fields used here.
 * Frame: Evren local metres, +X east, +Y up, +Z south, sea level y = 0.
 * Format 0: greybox, one glb per tile. Format 1: LOD glbs with distance bands, shared external textures, prop
 * instances and a light list per tile.
 */
export const SUPPORTED_FORMATS: readonly number[] = [0, 1];

export type XYZ = [number, number, number];

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
  /** Format 1. */
  detail?: 'full' | 'greybox';
  lods?: { level: number; glb: string; hash: string; bytes: number; triangles: number }[];
  instances?: number;
  lights?: number;
}

export interface LodPolicy {
  bands: { level: number; min: number; max: number }[];
  hysteresis: number;
}

export interface PropRef {
  id: string;
  glb: string;
  variants: string[];
  bounds: { min: XYZ; max: XYZ };
  drawDistance: number;
  castShadow: boolean;
  triangles: number;
}

export interface MaterialRef {
  id: string;
  surface?: string;
  castShadow: boolean;
  emissive?: { color: XYZ; nits: number; night: boolean; source: string };
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
  /** Format 1. */
  lod?: LodPolicy;
  strip?: { source: string; rect: Bounds2; tiles: string[] };
  materialDefs?: MaterialRef[];
  props?: Record<string, PropRef>;
  totals?: { tiles: number; lod0Triangles: number; lod1Triangles: number; instances: number; lights: number; textureBytes: number; propBytes: number; glbBytes: number };
}

export interface InstanceRec {
  asset: string;
  variant?: string;
  position: XYZ;
  rotation: [number, number, number, number];
  scale?: number | XYZ;
  ref?: string;
  seed?: number;
}

export interface LightRec {
  id: string;
  type: 'point' | 'spot' | 'area';
  position: XYZ;
  direction?: XYZ;
  kelvin: number;
  /** Linear RGB, max channel 1. */
  color: XYZ;
  /** Candela (point, spot) or nits (area). */
  intensity: number;
  lumens: number;
  range: number;
  cone?: { inner: number; outer: number };
  size?: [number, number];
  night: boolean;
  source: string;
  ref?: string;
}

/** The fields of a tile manifest the sandbox reads (format 1). */
export interface StreetTileManifest {
  id: string;
  detail?: 'full' | 'greybox';
  instances?: InstanceRec[];
  lights?: LightRec[];
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

/** Materials whose shadows matter at eye level in format 0 (building blocks); ground, kerbs and door leaves only receive. */
export const SHADOW_CASTER_MATERIALS: ReadonlySet<string> = new Set(['wall', 'roof']);

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  return (await res.json()) as T;
}
