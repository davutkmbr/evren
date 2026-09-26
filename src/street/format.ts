import type { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ModulesRef, SlotsRef } from './modules/format';

/**
 * The subset of the street formats (tools/world-compiler/README.md) that the sandbox loader reads. The compiler's
 * `tools/world-compiler/src/format.ts` is the source of truth; these types only mirror the fields used here.
 * Frame: world-local metres, +X east, +Y up, +Z south, sea level y = 0.
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
  /** Format 1.2: façade module slots of the tile (modules/format.ts), expanded for LOD0. */
  slots?: SlotsRef;
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
  /** Decimated levels (props of 1500+ triangles): draw `level` from `distance` metres on, LOD0 (`glb`) before. */
  lods?: { level: number; glb: string; triangles: number; distance: number }[];
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
  /** Format 1.2: the façade module library and this area's palette for it. */
  modules?: ModulesRef;
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
export interface StreetBuildingRec {
  id: string;
  /** Flat [x, z, ...]. */
  footprint: number[];
  /** Format 1: compiled as plain massing or (--landmarks none) left out; the runtime may draw its own model. */
  landmark?: string;
}

export interface StreetTileManifest {
  id: string;
  detail?: 'full' | 'greybox';
  buildings?: StreetBuildingRec[];
  /** Flight-scale buildings on the area's edge the tile leaves standing (tools/world-compiler/src/edge-keeps.ts). */
  keep?: StreetBuildingRec[];
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

/** Reads compiled files off the main thread (fetch and gzip inflate), see fetch.worker.ts. */
let fetchWorker: Worker | null | undefined;
let fetchSeq = 0;
const fetchWaits = new Map<number, { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void; url: string }>();

/** Files read through fetchBytes: count, bytes on the wire and inflated, per folder of the area (debug, size checks). */
export const fetchStats: Record<string, { files: number; bytes: number; inflated: number }> = {};

function noteFetch(url: string, wire: number, inflated: number): void {
  const kind = /\/(tiles|props|textures)\/[^/]*$/.exec(url)?.[1] ?? 'other';
  const k = `${kind}${/\.json(\.gz)?$/.test(url) ? ':json' : ''}`;
  const s = (fetchStats[k] ??= { files: 0, bytes: 0, inflated: 0 });
  s.files++;
  s.bytes += wire;
  s.inflated += inflated;
}

function worker(): Worker | null {
  if (fetchWorker === undefined) {
    try {
      fetchWorker = new Worker(new URL('./fetch.worker.ts', import.meta.url), { type: 'module', name: 'street-fetch' });
      fetchWorker.onmessage = (e: MessageEvent<{ id: number; bytes?: ArrayBuffer; wire?: number; error?: string }>) => {
        const w = fetchWaits.get(e.data.id);
        fetchWaits.delete(e.data.id);
        if (e.data.bytes) {
          noteFetch(w?.url ?? '', e.data.wire ?? 0, e.data.bytes.byteLength);
          w?.resolve(e.data.bytes);
        } else {
          w?.reject(new Error(e.data.error ?? 'fetch failed'));
        }
      };
    } catch {
      fetchWorker = null;
    }
  }
  return fetchWorker;
}

/** Whether bytes start with the gzip magic. */
export function isGzip(bytes: ArrayBuffer): boolean {
  const b = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  return b.length === 2 && b[0] === 0x1f && b[1] === 0x8b;
}

/** Inflates gzip bytes (anything else is returned as is). */
export async function inflate(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  return isGzip(bytes) ? new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : bytes;
}

/**
 * Bytes of a compiled file. The web profile gzips glbs and manifests (`.gz`); they are inflated off the main thread
 * (a host that already decoded them is detected by the gzip magic).
 */
export async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const abs = new URL(url, window.location.href).href;
  const w = worker();
  if (!w) {
    const res = await fetch(abs);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${url}`);
    }
    const wire = await res.arrayBuffer();
    const bytes = await inflate(wire);
    noteFetch(abs, wire.byteLength, bytes.byteLength);
    return bytes;
  }
  const id = ++fetchSeq;
  return new Promise<ArrayBuffer>((resolve, reject) => {
    fetchWaits.set(id, { resolve, reject, url: abs });
    w.postMessage({ id, url: abs });
  });
}

export async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await fetchBytes(url))) as T;
}

/** Loads a compiled glb (plain or gzipped) with the given loader; its external textures resolve next to it. */
export async function loadGlb(loader: GLTFLoader, url: string): Promise<GLTF> {
  const abs = new URL(url, window.location.href).href;
  return loader.parseAsync(await fetchBytes(abs), abs.slice(0, abs.lastIndexOf('/') + 1));
}
