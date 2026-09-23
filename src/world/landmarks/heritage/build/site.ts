import { latLonToLocal } from '../../../../core/geo-coords';
import type { ChunkResult, ColliderDesc, GridWindow, SiteDef } from '../protocol';
import { ensureCCW, hashString, rng, type V2 } from './geom';
import { MeshBuilder } from './mesh-builder';

/** Bilinear sample of a cell-centred grid window (clamped to its edges). */
export function sampleWindow(g: GridWindow, x: number, z: number): number {
  let fx = (x - g.originX) / g.cell;
  let fz = (z - g.originZ) / g.cell;
  fx = fx < 0 ? 0 : fx > g.w - 1.0001 ? g.w - 1.0001 : fx;
  fz = fz < 0 ? 0 : fz > g.h - 1.0001 ? g.h - 1.0001 : fz;
  const ix = fx | 0;
  const iz = fz | 0;
  const tx = fx - ix;
  const tz = fz - iz;
  const i = iz * g.w + ix;
  const d = g.data;
  const a = d[i];
  const b = d[i + 1];
  const c = d[i + g.w];
  const e = d[i + g.w + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (e - c) * tx) * tz;
}

interface ChunkState {
  key: string;
  originX: number;
  originZ: number;
  builders: MeshBuilder[];
}

/**
 * Build context handed to the site builders. Builders are run once per LOD (lod 0 = detailed); they must be
 * deterministic (use ctx.random()) so chunk keys and layouts match across LODs.
 */
export class SiteContext {
  lod = 0;
  readonly def: SiteDef;
  readonly coastlines: V2[][];
  private chunks = new Map<string, ChunkState>();
  private current: ChunkState | null = null;
  private colliderList: ColliderDesc[] = [];
  private rand: () => number;

  constructor(
    def: SiteDef,
    private heights: GridWindow,
    private coastWin: GridWindow,
    coastlines: Float64Array[],
    readonly lodCount: number,
  ) {
    this.def = def;
    this.coastlines = coastlines.map((f) => {
      const out: V2[] = [];
      for (let i = 0; i < f.length; i += 2) {
        out.push([f[i], f[i + 1]]);
      }
      return out;
    });
    this.rand = rng(hashString(def.id));
  }

  /** Resets per-LOD state (random stream) before a builder pass. */
  beginLod(lod: number): void {
    this.lod = lod;
    this.rand = rng(hashString(this.def.id));
    this.current = null;
  }

  /** Terrain height (m, negative under water). */
  ground(x: number, z: number): number {
    return sampleWindow(this.heights, x, z);
  }

  /** Terrain height clamped to the water surface. */
  groundOrSea(x: number, z: number): number {
    return Math.max(0, sampleWindow(this.heights, x, z));
  }

  /** Signed distance to the coastline (positive on land). */
  coast(x: number, z: number): number {
    return sampleWindow(this.coastWin, x, z);
  }

  /** Lowest / highest ground under a ring (sampled on its vertices, edge midpoints and centroid). */
  groundRange(ring: readonly V2[]): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    let cx = 0;
    let cz = 0;
    const probe = (x: number, z: number): void => {
      const g = this.groundOrSea(x, z);
      min = Math.min(min, g);
      max = Math.max(max, g);
    };
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      probe(a[0], a[1]);
      probe((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      cx += a[0];
      cz += a[1];
    }
    probe(cx / ring.length, cz / ring.length);
    return { min, max };
  }

  random(): number {
    return this.rand();
  }

  /** Selects (creating if needed) the chunk that receives geometry. Chunk origins keep float precision local. */
  chunk(key: string, originX: number, originZ: number): MeshBuilder {
    let c = this.chunks.get(key);
    if (!c) {
      c = { key, originX, originZ, builders: [] };
      for (let i = 0; i < this.lodCount; i++) {
        c.builders.push(new MeshBuilder(originX, originZ));
      }
      this.chunks.set(key, c);
    }
    this.current = c;
    return c.builders[this.lod];
  }

  /** Current chunk builder (defaults to a chunk at the site origin). */
  get mb(): MeshBuilder {
    if (!this.current) {
      return this.chunk('main', this.def.x, this.def.z);
    }
    return this.current.builders[this.lod];
  }

  collider(c: ColliderDesc): void {
    if (this.lod === 0) {
      this.colliderList.push(c);
    }
  }

  /** Box collider from a footprint ring (oriented bounding box). */
  boxCollider(cx: number, cz: number, len: number, wid: number, angle: number, y0: number, y1: number): void {
    this.collider({ kind: 'box', cx, cy: (y0 + y1) / 2, cz, hx: len / 2, hy: (y1 - y0) / 2, hz: wid / 2, yaw: -angle });
  }

  /** Projects flat lat, lon pairs into a CCW local ring. */
  ring(ll: readonly number[]): V2[] {
    const out: V2[] = [];
    for (let i = 0; i + 1 < ll.length; i += 2) {
      const p = latLonToLocal(ll[i], ll[i + 1]);
      out.push([p.x, p.z]);
    }
    return ensureCCW(out);
  }

  point(lat: number, lon: number): V2 {
    const p = latLonToLocal(lat, lon);
    return [p.x, p.z];
  }

  results(groundAt: (x: number, z: number) => number): { chunks: ChunkResult[]; colliders: ColliderDesc[] } {
    const chunks: ChunkResult[] = [];
    for (const c of this.chunks.values()) {
      if (c.builders.every((b) => b.isEmpty())) {
        continue;
      }
      chunks.push({ key: c.key, originX: c.originX, originZ: c.originZ, lods: c.builders.map((b) => b.finalize(groundAt)) });
    }
    return { chunks, colliders: this.colliderList };
  }
}

export type SiteBuilder = (ctx: SiteContext) => void;
