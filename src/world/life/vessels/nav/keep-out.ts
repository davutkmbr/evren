import type { P2 } from '../../util/path';

const CELL = 200;

/**
 * Spatial hash over sampled polylines (shipping lanes, ferry tracks) with a clearance radius each: small craft keep
 * their waypoints and fishing spots out of them.
 */
export class KeepOut {
  private readonly cells = new Map<number, number[]>();
  private readonly pts: number[] = [];

  add(points: readonly P2[], radius: number, step = 25): void {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < n; k++) this.put(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n, radius);
    }
    const last = points[points.length - 1];
    if (last) this.put(last.x, last.z, radius);
  }

  addTrack(xs: ArrayLike<number>, zs: ArrayLike<number>, radius: number): void {
    const pts: P2[] = [];
    for (let i = 0; i < xs.length; i++) pts.push({ x: xs[i], z: zs[i] });
    this.add(pts, radius);
  }

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  private put(x: number, z: number, r: number): void {
    const i = this.pts.length / 3;
    this.pts.push(x, z, r);
    const k = this.key(Math.floor(x / CELL), Math.floor(z / CELL));
    let list = this.cells.get(k);
    if (!list) this.cells.set(k, (list = []));
    list.push(i);
  }

  /** True when (x, z) lies inside any registered corridor. Radii up to one cell are exact. */
  blocked(x: number, z: number): boolean {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.cells.get(this.key(cx + dx, cz + dz));
        if (!list) continue;
        for (const i of list) {
          const px = this.pts[i * 3];
          const pz = this.pts[i * 3 + 1];
          const r = this.pts[i * 3 + 2];
          if ((px - x) * (px - x) + (pz - z) * (pz - z) < r * r) return true;
        }
      }
    }
    return false;
  }
}
