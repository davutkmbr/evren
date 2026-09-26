/** Terrain sampling over the transferred geo grid windows (same bilinear lookups as GeoQuery; workers and main). */
import type { GridWin, OsmWorkerBase } from './protocol';

function bilinear(g: GridWin<Float32Array>, x: number, z: number): number {
  let fx = (x - g.x0) / g.cell;
  let fz = (z - g.z0) / g.cell;
  fx = fx < 0 ? 0 : fx > g.w - 1.0001 ? g.w - 1.0001 : fx;
  fz = fz < 0 ? 0 : fz > g.h - 1.0001 ? g.h - 1.0001 : fz;
  const ix = fx | 0;
  const iz = fz | 0;
  const tx = fx - ix;
  const tz = fz - iz;
  const i = iz * g.w + ix;
  const d = g.data;
  const top = d[i] + (d[i + 1] - d[i]) * tx;
  const bottom = d[i + g.w] + (d[i + g.w + 1] - d[i + g.w]) * tx;
  return top + (bottom - top) * tz;
}

/** GeoQuery.heightAt / coastDistance / landUseAt equivalents over OsmWorkerBase windows. */
export class GeoSampler {
  constructor(private readonly base: Pick<OsmWorkerBase, 'height' | 'coast' | 'groundCoast' | 'landUse' | 'reserved'>) {}

  /** Terrain height (m). */
  height(x: number, z: number): number {
    return bilinear(this.base.height, x, z);
  }

  /** Signed coast distance (m, positive on land). */
  coast(x: number, z: number): number {
    return bilinear(this.base.coast, x, z);
  }

  /** Signed coast distance (m) the ground heights follow (OsmWorkerBase.groundCoast, else coast()). */
  groundCoast(x: number, z: number): number {
    return bilinear(this.base.groundCoast ?? this.base.coast, x, z);
  }

  isWater(x: number, z: number): boolean {
    return this.coast(x, z) < 0;
  }

  /** LandUse id (nearest cell). */
  landUse(x: number, z: number): number {
    const g = this.base.landUse;
    const c = Math.min(g.w - 1, Math.max(0, Math.round((x - g.x0) / g.cell)));
    const r = Math.min(g.h - 1, Math.max(0, Math.round((z - g.z0) / g.cell)));
    return g.data[r * g.w + c];
  }

  /** True inside a landmark / mosque pad (optionally grown by `margin` m). */
  reserved(x: number, z: number, margin = 0): boolean {
    const p = this.base.reserved;
    for (let k = 0; k < p.length; k += 3) {
      const r = p[k + 2] + margin;
      if ((x - p[k]) ** 2 + (z - p[k + 1]) ** 2 < r * r) {
        return true;
      }
    }
    return false;
  }
}
