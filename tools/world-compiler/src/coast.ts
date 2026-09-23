/**
 * Signed distance to the OSM coastline (natural=coastline ways: land on the left of the way direction), positive on
 * land. The flight world's geo coast is a 23 m grid that is off by up to ~90 m around the Kadıköy piers (reclaimed
 * quays), so the street layer takes its shoreline from OSM. At a vertex shared by several segments the sign comes from
 * the sum of their land-side normals (pseudo-normal), so convex and concave corners are classified correctly.
 */
import type { OsmData } from '../../../src/world/osm/data';
import { BoxGrid, bounds } from '../../../src/world/osm/shared/geometry';

const CELL = 40;

export class CoastField {
  /** Segments: ax, az, bx, bz. */
  private readonly segs: number[] = [];
  private readonly grid = new BoxGrid(CELL);
  private readonly minX: number;
  private readonly minZ: number;
  private readonly maxX: number;
  private readonly maxZ: number;

  constructor(data: Pick<OsmData, 'lines'>) {
    for (const l of data.lines) {
      if (l.kind !== 'natural=coastline') {
        continue;
      }
      const pts = l.closed ? [...l.pts, l.pts[0], l.pts[1]] : l.pts;
      for (let k = 2; k < pts.length; k += 2) {
        this.segs.push(pts[k - 2], pts[k - 1], pts[k], pts[k + 1]);
      }
    }
    const b = bounds(this.segs);
    this.minX = b.minX;
    this.minZ = b.minZ;
    this.maxX = b.maxX;
    this.maxZ = b.maxZ;
    for (let s = 0; s < this.segs.length; s += 4) {
      const o = this.segs;
      this.grid.add(s / 4, Math.min(o[s], o[s + 2]), Math.min(o[s + 1], o[s + 3]), Math.max(o[s], o[s + 2]), Math.max(o[s + 1], o[s + 3]));
    }
  }

  get segments(): number {
    return this.segs.length / 4;
  }

  /** Segments registered in the grid cells of rings r0..r1 around (x, z). */
  private ring(x: number, z: number, r0: number, r1: number, out: Set<number>): void {
    const ci = Math.floor(x / CELL);
    const cj = Math.floor(z / CELL);
    for (let j = cj - r1; j <= cj + r1; j++) {
      for (let i = ci - r1; i <= ci + r1; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) < r0) {
          continue;
        }
        for (const s of this.grid.at(i * CELL + 1e-3, j * CELL + 1e-3)) {
          out.add(s);
        }
      }
    }
  }

  private segDist(s: number, x: number, z: number): number {
    const o = this.segs;
    const k = s * 4;
    const dx = o[k + 2] - o[k];
    const dz = o[k + 3] - o[k + 1];
    const l2 = dx * dx + dz * dz;
    const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - o[k]) * dx + (z - o[k + 1]) * dz) / l2)) : 0;
    return Math.hypot(o[k] + dx * t - x, o[k + 1] + dz * t - z);
  }

  /** Every segment that can be the nearest to (x, z): the first non-empty grid ring, then all rings within its best distance. */
  private candidates(x: number, z: number): Set<number> {
    const out = new Set<number>();
    const reach = Math.ceil(Math.max(Math.abs(x - this.minX), Math.abs(x - this.maxX), Math.abs(z - this.minZ), Math.abs(z - this.maxZ)) / CELL) + 1;
    let r = 0;
    while (!out.size && r <= reach) {
      this.ring(x, z, r, r, out);
      r++;
    }
    let d0 = Infinity;
    for (const s of out) {
      d0 = Math.min(d0, this.segDist(s, x, z));
    }
    this.ring(x, z, r, Math.min(reach, Math.ceil(d0 / CELL) + 1), out);
    return out;
  }

  /** Signed distance (m), positive on land. NaN without any coastline. */
  at(x: number, z: number): number {
    if (!this.segs.length) {
      return NaN;
    }
    const o = this.segs;
    let best = Infinity;
    const near: { s: number; t: number }[] = [];
    for (const s of this.candidates(x, z)) {
      const k = s * 4;
      const dx = o[k + 2] - o[k];
      const dz = o[k + 3] - o[k + 1];
      const l2 = dx * dx + dz * dz;
      const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - o[k]) * dx + (z - o[k + 1]) * dz) / l2)) : 0;
      const d = Math.hypot(o[k] + dx * t - x, o[k + 1] + dz * t - z);
      if (d < best - 1e-7) {
        best = d;
        near.length = 0;
        near.push({ s, t });
      } else if (Math.abs(d - best) <= 1e-7) {
        near.push({ s, t });
      }
    }
    // Land side of a segment (dx, dz) in +X east / +Z south: the left of the way on a north-up map is (dz, -dx).
    let nx = 0;
    let nz = 0;
    let px = 0;
    let pz = 0;
    for (const { s, t } of near) {
      const k = s * 4;
      const dx = o[k + 2] - o[k];
      const dz = o[k + 3] - o[k + 1];
      const l = Math.hypot(dx, dz) || 1;
      nx += dz / l;
      nz += -dx / l;
      px = o[k] + dx * t;
      pz = o[k + 1] + dz * t;
    }
    const side = (x - px) * nx + (z - pz) * nz;
    return side >= 0 ? best : -best;
  }
}
