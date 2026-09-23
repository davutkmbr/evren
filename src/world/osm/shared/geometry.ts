/** 2D geometry helpers on flat x, z arrays (workers and main thread). */

export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Signed shoelace area of a flat x, z ring (positive for OSM outer rings, see data.ts). */
export function ringArea(r: ArrayLike<number>): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
  }
  return a / 2;
}

export function pointInRing(r: ArrayLike<number>, x: number, z: number): boolean {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2];
    const zi = r[i * 2 + 1];
    const xj = r[j * 2];
    const zj = r[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from (px, pz) to the segment (ax, az)-(bx, bz). */
export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

/** Axis-aligned bounds of a flat x, z point list. */
export function bounds(pts: ArrayLike<number>): { minX: number; minZ: number; maxX: number; maxZ: number } {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let k = 0; k < pts.length; k += 2) {
    minX = Math.min(minX, pts[k]);
    maxX = Math.max(maxX, pts[k]);
    minZ = Math.min(minZ, pts[k + 1]);
    maxZ = Math.max(maxZ, pts[k + 1]);
  }
  return { minX, minZ, maxX, maxZ };
}

/** Uniform grid of item bounding boxes for point queries. */
export class BoxGrid {
  private readonly cells = new Map<number, number[]>();

  constructor(private readonly cell: number) {}

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }

  add(id: number, x0: number, z0: number, x1: number, z1: number): void {
    for (let j = Math.floor(z0 / this.cell); j <= Math.floor(z1 / this.cell); j++) {
      for (let i = Math.floor(x0 / this.cell); i <= Math.floor(x1 / this.cell); i++) {
        const k = this.key(i, j);
        let list = this.cells.get(k);
        if (!list) {
          list = [];
          this.cells.set(k, list);
        }
        list.push(id);
      }
    }
  }

  at(x: number, z: number): readonly number[] {
    return this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? [];
  }
}
