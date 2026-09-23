/**
 * Worker-side rasters over the build rect: scanline polygon fill (building masks, area membership) and signed
 * distance coverage channels (union by max), encoded like the street raster: v = 0.5 + d / (2 range), d > 0 inside.
 */
import type { WorldBounds } from '../../../core/contracts';
import { segDist } from '../shared/geometry';

export class RasterGrid {
  readonly w: number;
  readonly h: number;
  readonly minX: number;
  readonly minZ: number;

  constructor(
    rect: WorldBounds,
    readonly px: number,
  ) {
    this.minX = rect.minX;
    this.minZ = rect.minZ;
    this.w = Math.ceil((rect.maxX - rect.minX) / px);
    this.h = Math.ceil((rect.maxZ - rect.minZ) / px);
  }

  /** Texel index of (x, z), or -1 outside. */
  index(x: number, z: number): number {
    const i = Math.floor((x - this.minX) / this.px);
    const j = Math.floor((z - this.minZ) / this.px);
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i;
  }

  cx(i: number): number {
    return this.minX + (i + 0.5) * this.px;
  }

  cz(j: number): number {
    return this.minZ + (j + 0.5) * this.px;
  }

  /** Calls fn(i, j) for every texel centre inside the rings (even-odd, so holes cut out), clipped to the grid. */
  fill(rings: readonly (readonly number[])[], fn: (i: number, j: number) => void): void {
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const r of rings) {
      for (let k = 1; k < r.length; k += 2) {
        z0 = Math.min(z0, r[k]);
        z1 = Math.max(z1, r[k]);
      }
    }
    const j0 = Math.max(0, Math.floor((z0 - this.minZ) / this.px));
    const j1 = Math.min(this.h - 1, Math.ceil((z1 - this.minZ) / this.px));
    const xs: number[] = [];
    for (let j = j0; j <= j1; j++) {
      const z = this.cz(j);
      xs.length = 0;
      for (const r of rings) {
        const n = r.length / 2;
        for (let a = 0, b = n - 1; a < n; b = a++) {
          const za = r[a * 2 + 1];
          const zb = r[b * 2 + 1];
          if (za > z !== zb > z) {
            xs.push(r[a * 2] + ((z - za) / (zb - za)) * (r[b * 2] - r[a * 2]));
          }
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - this.minX) / this.px - 0.5));
        const i1 = Math.min(this.w - 1, Math.floor((xs[k + 1] - this.minX) / this.px - 0.5));
        for (let i = i0; i <= i1; i++) {
          fn(i, j);
        }
      }
    }
  }
}

/** Distance range (m) of the coverage encoding. */
export const COVER_RANGE = 4;

export function encodeSdf(d: number): number {
  return Math.round(Math.min(1, Math.max(0, 0.5 + d / (2 * COVER_RANGE))) * 255);
}

export function decodeSdf(v: number): number {
  return (v / 255 - 0.5) * 2 * COVER_RANGE;
}

/**
 * Unions the signed distance of a polygon (outer ring + holes) into channel `c` of an RGBA8 raster; `inset` (m)
 * shrinks the polygon (negative grows it).
 */
export function stampPolygon(grid: RasterGrid, out: Uint8Array, c: number, ring: readonly number[], holes: readonly (readonly number[])[] | undefined, inset = 0): void {
  const R = COVER_RANGE;
  const rings = holes?.length ? [ring, ...holes] : [ring];
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let k = 0; k < ring.length; k += 2) {
    x0 = Math.min(x0, ring[k]);
    x1 = Math.max(x1, ring[k]);
    z0 = Math.min(z0, ring[k + 1]);
    z1 = Math.max(z1, ring[k + 1]);
  }
  const reach = R + Math.abs(inset);
  const i0 = Math.max(0, Math.floor((x0 - reach - grid.minX) / grid.px));
  const i1 = Math.min(grid.w - 1, Math.ceil((x1 + reach - grid.minX) / grid.px));
  const j0 = Math.max(0, Math.floor((z0 - reach - grid.minZ) / grid.px));
  const j1 = Math.min(grid.h - 1, Math.ceil((z1 + reach - grid.minZ) / grid.px));
  if (i1 < i0 || j1 < j0) {
    return;
  }
  const bw = i1 - i0 + 1;
  const bh = j1 - j0 + 1;
  const dist = new Float32Array(bw * bh).fill(reach);
  const inside = new Uint8Array(bw * bh);
  grid.fill(rings, (i, j) => {
    if (i >= i0 && i <= i1 && j >= j0 && j <= j1) {
      inside[(j - j0) * bw + (i - i0)] = 1;
    }
  });
  for (const r of rings) {
    const n = r.length / 2;
    for (let a = 0, b = n - 1; a < n; b = a++) {
      const ax = r[b * 2];
      const az = r[b * 2 + 1];
      const bx = r[a * 2];
      const bz = r[a * 2 + 1];
      const si0 = Math.max(i0, Math.floor((Math.min(ax, bx) - reach - grid.minX) / grid.px));
      const si1 = Math.min(i1, Math.ceil((Math.max(ax, bx) + reach - grid.minX) / grid.px));
      const sj0 = Math.max(j0, Math.floor((Math.min(az, bz) - reach - grid.minZ) / grid.px));
      const sj1 = Math.min(j1, Math.ceil((Math.max(az, bz) + reach - grid.minZ) / grid.px));
      for (let j = sj0; j <= sj1; j++) {
        const z = grid.cz(j);
        for (let i = si0; i <= si1; i++) {
          const k = (j - j0) * bw + (i - i0);
          const d = segDist(grid.cx(i), z, ax, az, bx, bz);
          if (d < dist[k]) {
            dist[k] = d;
          }
        }
      }
    }
  }
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = (j - j0) * bw + (i - i0);
      const d = (inside[k] ? dist[k] : -dist[k]) - inset;
      if (d <= -R) {
        continue;
      }
      const o = (j * grid.w + i) * 4 + c;
      const v = encodeSdf(d);
      if (v > out[o]) {
        out[o] = v;
      }
    }
  }
}

/** Unions a ribbon of half width `hw` along a polyline into channel `c`. */
export function stampLine(grid: RasterGrid, out: Uint8Array, c: number, pts: readonly number[], hw: number): void {
  const reach = hw + COVER_RANGE;
  for (let k = 2; k < pts.length; k += 2) {
    const ax = pts[k - 2];
    const az = pts[k - 1];
    const bx = pts[k];
    const bz = pts[k + 1];
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - grid.minX) / grid.px));
    const i1 = Math.min(grid.w - 1, Math.ceil((Math.max(ax, bx) + reach - grid.minX) / grid.px));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - grid.minZ) / grid.px));
    const j1 = Math.min(grid.h - 1, Math.ceil((Math.max(az, bz) + reach - grid.minZ) / grid.px));
    for (let j = j0; j <= j1; j++) {
      const z = grid.cz(j);
      for (let i = i0; i <= i1; i++) {
        const d = hw - segDist(grid.cx(i), z, ax, az, bx, bz);
        if (d <= -COVER_RANGE) {
          continue;
        }
        const o = (j * grid.w + i) * 4 + c;
        const v = encodeSdf(d);
        if (v > out[o]) {
          out[o] = v;
        }
      }
    }
  }
}

/**
 * Building outlines as rasters (building:part records skipped): `mask` is 1 inside any outline, `ids` the index into
 * `buildings` of the outline covering the texel (-1 outside).
 */
export function buildingRaster(grid: RasterGrid, buildings: readonly { ring: number[]; part?: true }[]): { mask: Uint8Array; ids: Int32Array } {
  const mask = new Uint8Array(grid.w * grid.h);
  const ids = new Int32Array(grid.w * grid.h).fill(-1);
  buildings.forEach((b, id) => {
    if (!b.part) {
      grid.fill([b.ring], (i, j) => {
        const k = j * grid.w + i;
        mask[k] = 1;
        ids[k] = id;
      });
    }
  });
  return { mask, ids };
}
