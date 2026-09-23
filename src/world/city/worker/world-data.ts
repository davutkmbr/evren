/** Static world data held by each city worker: roads, coastlines, districts and coarse grids with spatial indices. */
import type { CityInitMessage, DistrictMsg, GridSpecMsg, RoadMsg } from '../protocol';

const INDEX_CELL = 500;
const WORLD_HALF = 24000;
const INDEX_N = Math.ceil((WORLD_HALF * 2) / INDEX_CELL);

export interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Road kind (see RoadMsg) or -1 for coastline. */
  kind: number;
  width: number;
  /** Arc length at `a` along its polyline (for deterministic sampling). */
  s0: number;
  len: number;
  /** Polyline index. */
  line: number;
}

class SegmentIndex {
  readonly cells: Segment[][] = [];

  constructor() {
    for (let i = 0; i < INDEX_N * INDEX_N; i++) {
      this.cells.push([]);
    }
  }

  add(seg: Segment, pad: number): void {
    const x0 = Math.min(seg.ax, seg.bx) - pad;
    const x1 = Math.max(seg.ax, seg.bx) + pad;
    const z0 = Math.min(seg.az, seg.bz) - pad;
    const z1 = Math.max(seg.az, seg.bz) + pad;
    const c0 = clampCell(Math.floor((x0 + WORLD_HALF) / INDEX_CELL));
    const c1 = clampCell(Math.floor((x1 + WORLD_HALF) / INDEX_CELL));
    const r0 = clampCell(Math.floor((z0 + WORLD_HALF) / INDEX_CELL));
    const r1 = clampCell(Math.floor((z1 + WORLD_HALF) / INDEX_CELL));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        this.cells[r * INDEX_N + c].push(seg);
      }
    }
  }

  /** Unique segments whose padded bounds touch the rectangle. */
  query(x0: number, z0: number, x1: number, z1: number, out: Segment[]): Segment[] {
    out.length = 0;
    const c0 = clampCell(Math.floor((x0 + WORLD_HALF) / INDEX_CELL));
    const c1 = clampCell(Math.floor((x1 + WORLD_HALF) / INDEX_CELL));
    const r0 = clampCell(Math.floor((z0 + WORLD_HALF) / INDEX_CELL));
    const r1 = clampCell(Math.floor((z1 + WORLD_HALF) / INDEX_CELL));
    const seen = new Set<Segment>();
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (const s of this.cells[r * INDEX_N + c]) {
          if (!seen.has(s)) {
            seen.add(s);
            out.push(s);
          }
        }
      }
    }
    return out;
  }
}

function clampCell(i: number): number {
  return i < 0 ? 0 : i >= INDEX_N ? INDEX_N - 1 : i;
}

export class WorldData {
  readonly roads: SegmentIndex = new SegmentIndex();
  readonly coasts: SegmentIndex = new SegmentIndex();
  readonly districts: DistrictMsg[];
  readonly landUseSpec: GridSpecMsg;
  readonly heightSpec: GridSpecMsg;
  private readonly districtGrid: Uint8Array;
  private readonly districtSpec: GridSpecMsg;
  private readonly hc: Float32Array;
  private readonly hcSpec: GridSpecMsg;

  constructor(msg: CityInitMessage) {
    this.districts = msg.districts;
    this.landUseSpec = msg.landUse;
    this.heightSpec = msg.height;
    this.districtGrid = msg.districtGrid.data;
    this.districtSpec = msg.districtGrid.spec;
    this.hc = msg.heightCoarse.data;
    this.hcSpec = msg.heightCoarse.spec;
    msg.roads.forEach((r, i) => this.addPolyline(this.roads, r, i));
    msg.coasts.forEach((pts, i) => this.addPolyline(this.coasts, { kind: -1, width: 0, pts }, i, true));
  }

  private addPolyline(index: SegmentIndex, road: RoadMsg, line: number, closed = false): void {
    const p = road.pts;
    const n = p.length / 2;
    let s = 0;
    const count = closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % n;
      const ax = p[i * 2];
      const az = p[i * 2 + 1];
      const bx = p[j * 2];
      const bz = p[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-3) {
        continue;
      }
      index.add({ ax, az, bx, bz, kind: road.kind, width: road.width, s0: s, len, line }, road.width * 0.5 + 60);
      s += len;
    }
  }

  /** Index into `districts` (or -1) from the coarse grid. */
  districtIndexAt(x: number, z: number): number {
    const g = this.districtSpec;
    const c = Math.floor((x - g.origin) / g.cell + 0.5);
    const r = Math.floor((z - g.origin) / g.cell + 0.5);
    if (c < 0 || r < 0 || c >= g.size || r >= g.size) {
      return -1;
    }
    const v = this.districtGrid[r * g.size + c];
    return v === 255 ? -1 : v;
  }

  /** Nearest valid district (search a small neighbourhood when the cell itself is water/none). */
  districtNear(x: number, z: number): number {
    const d = this.districtIndexAt(x, z);
    if (d >= 0) {
      return d;
    }
    const step = this.districtSpec.cell;
    for (let ring = 1; ring <= 3; ring++) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const i = this.districtIndexAt(x + Math.cos(a) * step * ring, z + Math.sin(a) * step * ring);
        if (i >= 0) {
          return i;
        }
      }
    }
    return -1;
  }

  coarseHeight(x: number, z: number): number {
    const g = this.hcSpec;
    const n = g.size;
    let fx = (x - g.origin) / g.cell;
    let fz = (z - g.origin) / g.cell;
    fx = fx < 0 ? 0 : fx > n - 1.001 ? n - 1.001 : fx;
    fz = fz < 0 ? 0 : fz > n - 1.001 ? n - 1.001 : fz;
    const ix = fx | 0;
    const iz = fz | 0;
    const tx = fx - ix;
    const tz = fz - iz;
    const i = iz * n + ix;
    const h = this.hc;
    return (h[i] + (h[i + 1] - h[i]) * tx) * (1 - tz) + (h[i + n] + (h[i + n + 1] - h[i + n]) * tx) * tz;
  }
}

export function distToSegment(px: number, pz: number, s: Segment): { d: number; t: number } {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - s.ax) * dx + (pz - s.az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = s.ax + dx * t - px;
  const qz = s.az + dz * t - pz;
  return { d: Math.sqrt(qx * qx + qz * qz), t };
}
