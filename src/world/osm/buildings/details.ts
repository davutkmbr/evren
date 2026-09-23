/**
 * Near-LOD detail instances (worker side): window surrounds with sills and heads, shutters, balcony slabs and
 * railings, shop signs, awnings and air-conditioner units. Every record is DETAIL_STRIDE floats
 * (x, y, z, yaw, sx, sy, sz, r, g, b) in a local frame whose +Z is the wall's outward normal; the main thread
 * (lod.ts) streams the records of tiles near the camera into InstancedMeshes. The shader fallback for far walls
 * paints the same elements, so records follow the facade layout of archetypes.ts exactly.
 */
import type { WorldBounds } from '../../../core/contracts';
import { RecordList } from './mesh';

export const DETAIL_STRIDE = 10;
/** Tile size (m) of the near-LOD streaming grid. */
export const DETAIL_TILE = 64;

/** Instanced detail kinds; each is one InstancedMesh (see props.ts for the geometries, materials.ts for shading). */
export const DETAIL_KINDS = [
  /** Architrave + sill + flat cap (Levantine) / plain frame + sill (others). sx = half width, sy = opening height. */
  'surroundCap',
  /** Architrave + sill + triangular pediment. */
  'surroundPediment',
  /** Arched architrave with keystone + sill (segmental and round; the rise is in sz). */
  'surroundArch',
  /** Projecting sill only (post-war windows). */
  'sill',
  /** Flat painted board architrave with a head board and drip cap (timber houses). */
  'frame',
  /** Pair of open louvred shutters beside a window. sx = half width, sy = height. */
  'shutter',
  /** Balcony slab with brackets. sx = half width, sy = thickness, sz = depth. */
  'balcony',
  /** Balcony railing (front + returns). sx = half width, sy = height, sz = depth; r / g / b colour, pattern from hash. */
  'railing',
  /** Solid balcony parapet (post-war). Same frame as 'railing'. */
  'parapet',
  /** Shop fascia sign (box). sx = half width, sy = half height, sz = depth. */
  'sign',
  /** Canvas awning over a shop. sx = half width, sy = drop, sz = projection. */
  'awning',
  /** Air-conditioner outdoor unit. */
  'ac',
] as const;
export type DetailKind = (typeof DETAIL_KINDS)[number];

/** Default streaming radius (m) per kind; lod.ts scales it with the quality preset. */
export const DETAIL_RADIUS: Record<DetailKind, number> = {
  surroundCap: 210,
  surroundPediment: 210,
  surroundArch: 210,
  sill: 150,
  frame: 170,
  shutter: 170,
  balcony: 330,
  railing: 260,
  parapet: 330,
  sign: 260,
  awning: 280,
  ac: 130,
};

export interface DetailTiles {
  minX: number;
  minZ: number;
  nx: number;
  nz: number;
  size: number;
}

export class DetailSink {
  readonly lists: Record<DetailKind, RecordList>;
  readonly tiles: DetailTiles;

  constructor(rect: WorldBounds) {
    this.lists = Object.fromEntries(DETAIL_KINDS.map((k) => [k, new RecordList(DETAIL_STRIDE)])) as Record<DetailKind, RecordList>;
    this.tiles = {
      minX: rect.minX,
      minZ: rect.minZ,
      nx: Math.max(1, Math.ceil((rect.maxX - rect.minX) / DETAIL_TILE)),
      nz: Math.max(1, Math.ceil((rect.maxZ - rect.minZ) / DETAIL_TILE)),
      size: DETAIL_TILE,
    };
  }

  tileOf(x: number, z: number): number {
    const t = this.tiles;
    const i = Math.min(t.nx - 1, Math.max(0, Math.floor((x - t.minX) / t.size)));
    const j = Math.min(t.nz - 1, Math.max(0, Math.floor((z - t.minZ) / t.size)));
    return j * t.nx + i;
  }

  /** Adds one record; `yaw` turns local +Z onto the outward wall normal (atan2(nx, nz)). */
  add(kind: DetailKind, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, r: number, g: number, b: number): void {
    this.lists[kind].push(this.tileOf(x, z), x, y, z, yaw, sx, sy, sz, r, g, b);
  }

  /**
   * Per kind: instance matrices (16 floats, column-major) and linear colours (3 floats) sorted by tile, plus
   * [start, count] per tile, ready to be copied into InstancedMesh buffers (lod.ts).
   */
  take(): { kinds: Partial<Record<DetailKind, DetailStream>>; tiles: DetailTiles; counts: Record<string, number> } {
    const kinds: Partial<Record<DetailKind, DetailStream>> = {};
    const counts: Record<string, number> = {};
    const n = this.tiles.nx * this.tiles.nz;
    for (const k of DETAIL_KINDS) {
      const list = this.lists[k];
      counts[k] = list.length;
      if (!list.length) {
        continue;
      }
      const { records, ranges } = list.sorted(n);
      const m = records.length / DETAIL_STRIDE;
      const matrices = new Float32Array(m * 16);
      const colours = new Float32Array(m * 3);
      for (let i = 0; i < m; i++) {
        const o = i * DETAIL_STRIDE;
        const c = Math.cos(records[o + 3]);
        const s = Math.sin(records[o + 3]);
        const sx = Math.max(1e-3, records[o + 4]);
        const sy = Math.max(1e-3, records[o + 5]);
        const sz = Math.max(1e-3, records[o + 6]);
        matrices.set([c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, records[o], records[o + 1], records[o + 2], 1], i * 16);
        colours[i * 3] = records[o + 7];
        colours[i * 3 + 1] = records[o + 8];
        colours[i * 3 + 2] = records[o + 9];
      }
      kinds[k] = { matrices, colours, ranges };
    }
    return { kinds, tiles: this.tiles, counts };
  }
}

export interface DetailStream {
  /** Instance matrices (column-major), sorted by tile. */
  matrices: Float32Array;
  /** Linear RGB per instance. */
  colours: Float32Array;
  /** [start, count] per tile. */
  ranges: Int32Array;
}
