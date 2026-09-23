/** Samples the fine geography window shipped with a request (same semantics as GeoQuery on the main thread). */
import type { GeoWindowMsg, GridSpecMsg } from '../protocol';

/** LandUse values (mirrors core/contracts LandUse; workers avoid importing three-dependent modules). */
export const LU = {
  Water: 0,
  Beach: 1,
  Urban: 2,
  HistoricUrban: 3,
  Highrise: 4,
  Industrial: 5,
  Park: 6,
  Forest: 7,
  Farmland: 8,
  Airport: 9,
  Cemetery: 10,
  Landmark: 11,
  Road: 12,
  Suburban: 13,
} as const;

const BUILDABLE = new Uint8Array(16);
for (const u of [LU.Urban, LU.HistoricUrban, LU.Highrise, LU.Industrial, LU.Suburban]) {
  BUILDABLE[u] = 1;
}

export const SHORE_SETBACK = 6;

export class GeoSampler {
  constructor(
    private readonly win: GeoWindowMsg,
    private readonly luSpec: GridSpecMsg,
    private readonly hSpec: GridSpecMsg,
  ) {}

  landUse(x: number, z: number): number {
    const g = this.luSpec;
    const w = this.win;
    const c = Math.floor((x - g.origin) / g.cell + 0.5) - w.luC0;
    const r = Math.floor((z - g.origin) / g.cell + 0.5) - w.luR0;
    if (c < 0 || r < 0 || c >= w.luW || r >= w.luH) {
      return LU.Water;
    }
    return w.lu[r * w.luW + c];
  }

  private bilinear(data: Float32Array, x: number, z: number): number {
    const g = this.hSpec;
    const w = this.win;
    let fx = (x - g.origin) / g.cell - w.hC0;
    let fz = (z - g.origin) / g.cell - w.hR0;
    fx = fx < 0 ? 0 : fx > w.hW - 1.0001 ? w.hW - 1.0001 : fx;
    fz = fz < 0 ? 0 : fz > w.hH - 1.0001 ? w.hH - 1.0001 : fz;
    const ix = fx | 0;
    const iz = fz | 0;
    const tx = fx - ix;
    const tz = fz - iz;
    const n = w.hW;
    const i = iz * n + ix;
    const a = data[i];
    const b = data[i + 1];
    const c = data[i + n];
    const d = data[i + n + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  height(x: number, z: number): number {
    return this.bilinear(this.win.h, x, z);
  }

  coast(x: number, z: number): number {
    return this.bilinear(this.win.coast, x, z);
  }

  density(x: number, z: number): number {
    return this.bilinear(this.win.dens, x, z);
  }

  buildableUse(x: number, z: number): boolean {
    return BUILDABLE[this.landUse(x, z)] === 1;
  }

  buildable(x: number, z: number, setback = SHORE_SETBACK): boolean {
    return BUILDABLE[this.landUse(x, z)] === 1 && this.coast(x, z) > setback;
  }

  /** Terrain gradient (dh/dx, dh/dz) by central differences over `e` metres. */
  gradient(x: number, z: number, e = 20): [number, number] {
    return [(this.height(x + e, z) - this.height(x - e, z)) / (2 * e), (this.height(x, z + e) - this.height(x, z - e)) / (2 * e)];
  }
}
