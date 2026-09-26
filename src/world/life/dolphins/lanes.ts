/**
 * Distance to the water traffic: the strait's separation lanes and the ferry routes as a coarse spatial hash of points
 * (resampled every ~40 m), and the strait's centreline for the course along the strait. Built once per fleet; queries
 * are allocation-free.
 */

export interface LinePoints {
  readonly xs: ArrayLike<number>;
  readonly zs: ArrayLike<number>;
}

const CELL = 200;
const STEP = 40;

export class LaneField {
  private readonly cells = new Map<number, number[]>();
  /** The strait's centreline (north → south), resampled. */
  private readonly cx: Float64Array;
  private readonly cz: Float64Array;

  constructor(lanes: readonly LinePoints[], centre: LinePoints) {
    for (const line of lanes) {
      const n = line.xs.length;
      for (let i = 0; i < n; i++) {
        const x0 = line.xs[i];
        const z0 = line.zs[i];
        this.add(x0, z0);
        if (i + 1 < n) {
          const x1 = line.xs[i + 1];
          const z1 = line.zs[i + 1];
          const steps = Math.floor(Math.hypot(x1 - x0, z1 - z0) / STEP);
          for (let k = 1; k <= steps; k++) {
            const t = k / (steps + 1);
            this.add(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
          }
        }
      }
    }
    this.cx = Float64Array.from(centre.xs as ArrayLike<number>);
    this.cz = Float64Array.from(centre.zs as ArrayLike<number>);
  }

  private key(ix: number, iz: number): number {
    return (ix + 32768) * 65536 + (iz + 32768);
  }

  private add(x: number, z: number): void {
    const k = this.key(Math.floor(x / CELL), Math.floor(z / CELL));
    let c = this.cells.get(k);
    if (!c) {
      c = [];
      this.cells.set(k, c);
    }
    c.push(x, z);
  }

  /** Distance (m) to the nearest lane or ferry route point, up to `max` (returns `max` when none is closer). */
  distance(x: number, z: number, max = 600): number {
    const r = Math.ceil(max / CELL);
    const ix = Math.floor(x / CELL);
    const iz = Math.floor(z / CELL);
    let best = max * max;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const c = this.cells.get(this.key(ix + dx, iz + dz));
        if (!c) continue;
        for (let i = 0; i < c.length; i += 2) {
          const ex = c[i] - x;
          const ez = c[i + 1] - z;
          const d2 = ex * ex + ez * ez;
          if (d2 < best) best = d2;
        }
      }
    }
    return Math.sqrt(best);
  }

  /**
   * Nearest point of the strait's centreline: writes its unit tangent (north → south) into `out` and returns the
   * distance (m) from (x, z) to the line.
   */
  course(x: number, z: number, out: { x: number; z: number }): number {
    const n = this.cx.length;
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i + 1 < n; i++) {
      const ax = this.cx[i];
      const az = this.cz[i];
      const ex = this.cx[i + 1] - ax;
      const ez = this.cz[i + 1] - az;
      const l2 = ex * ex + ez * ez;
      const t = l2 > 1e-9 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
      const px = ax + ex * t - x;
      const pz = az + ez * t - z;
      const d2 = px * px + pz * pz;
      if (d2 < best) {
        best = d2;
        bi = i;
      }
    }
    if (n < 2) {
      out.x = 0;
      out.z = 1;
      return Infinity;
    }
    const ex = this.cx[bi + 1] - this.cx[bi];
    const ez = this.cz[bi + 1] - this.cz[bi];
    const l = Math.hypot(ex, ez) || 1;
    out.x = ex / l;
    out.z = ez / l;
    return Math.sqrt(best);
  }
}
