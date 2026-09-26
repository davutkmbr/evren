/**
 * Headless audit of the landmark mosque colliders against their LOD0 geometry (no browser, no GPU).
 *
 *   npx tsx scripts/mosque-collider-audit.ts                 # every landmark spec
 *   npx tsx scripts/mosque-collider-audit.ts suleymaniye     # one mosque, with the worst spots listed
 *   npx tsx scripts/mosque-collider-audit.ts --json out.json
 *
 * Two failure kinds, both in m² of surface:
 * - uncovered: solid geometry (walls, roofs, domes, minarets) more than TOL_OUT outside every collider: the dragon
 *   flies through it.
 * - phantom: collider surface farther than TOL_PHANTOM from any geometry: an invisible wall or roof in the air.
 * Thin fittings (alem, lamps, glazing) are not required to be covered. Surfaces are sampled on a ~0.5 m grid.
 */
import { writeFileSync } from 'node:fs';
import { MeshBuilder } from '../src/world/landmarks/mosques/gen/builder';
import { LANDMARK_SPECS } from '../src/world/landmarks/mosques/gen/specs';
import { buildByzantine } from '../src/world/landmarks/mosques/gen/styles/byzantine';
import { buildImperial } from '../src/world/landmarks/mosques/gen/styles/imperial';
import { Mat, type LocalCollider } from '../src/world/landmarks/mosques/gen/types';

const TOL_OUT = 0.8;
const TOL_PHANTOM = 1.5;
const STEP = 0.5;
/** Materials that need no collider (fittings, glazing set back in the openings). */
const SKIP_MATS = new Set<number>([Mat.Gold, Mat.Lamp, Mat.Glass]);

type P = [number, number, number];

/** Signed horizontal distance to a convex ring (negative inside). */
function ringDistance(ring: readonly number[], x: number, z: number): number {
  let best = Infinity;
  let inside = true;
  const n = ring.length / 2;
  // winding-independent convexity test: all edge cross products share a sign
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const ax = ring[i * 2];
    const az = ring[i * 2 + 1];
    const bx = ring[((i + 1) % n) * 2];
    const bz = ring[((i + 1) % n) * 2 + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const len2 = ex * ex + ez * ez;
    if (len2 < 1e-12) {
      continue;
    }
    const cr = ex * (z - az) - ez * (x - ax);
    if (cr !== 0) {
      if (sign === 0) {
        sign = Math.sign(cr);
      } else if (Math.sign(cr) !== sign) {
        inside = false;
      }
    }
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / len2));
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return inside ? -best : best;
}

function colliderDistance(c: LocalCollider, p: P): number {
  const [x, y, z] = p;
  if (c.kind === 'prism') {
    const dr = ringDistance(c.ring, x, z);
    const dy = Math.max(c.bottom - y, y - c.top);
    return dr > 0 && dy > 0 ? Math.hypot(dr, dy) : Math.max(dr, dy);
  }
  if (c.kind === 'sphere') {
    return Math.hypot(x - c.x, y - c.y, z - c.z) - c.r;
  }
  if (c.kind === 'cylinder') {
    const dr = Math.hypot(x - c.x, z - c.z) - c.r;
    const dy = Math.max(c.y - y, y - (c.y + c.h));
    return dr > 0 && dy > 0 ? Math.hypot(dr, dy) : Math.max(dr, dy);
  }
  const dx0 = x - c.cx;
  const dz0 = z - c.cz;
  const cs = Math.cos(c.yaw);
  const sn = Math.sin(c.yaw);
  const lx = dx0 * cs - dz0 * sn;
  const lz = dx0 * sn + dz0 * cs;
  const qx = Math.abs(lx) - c.hx;
  const qy = Math.abs(y - c.cy) - c.hy;
  const qz = Math.abs(lz) - c.hz;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0);
}

/** Points on a collider's surface (~STEP spacing) with the area each stands for. */
function colliderSurface(c: LocalCollider): Array<{ p: P; a: number }> {
  const out: Array<{ p: P; a: number }> = [];
  const s = STEP * 1.5;
  if (c.kind === 'sphere') {
    const n = Math.max(8, Math.ceil((Math.PI * c.r) / s));
    for (let i = 0; i < n; i++) {
      const phi = ((i + 0.5) / n) * Math.PI;
      const ring = Math.max(4, Math.ceil((2 * Math.PI * c.r * Math.sin(phi)) / s));
      const a = (2 * Math.PI * c.r * c.r * Math.sin(phi) * (Math.PI / n)) / ring;
      for (let k = 0; k < ring; k++) {
        const t = ((k + 0.5) / ring) * Math.PI * 2;
        out.push({ p: [c.x + c.r * Math.sin(phi) * Math.cos(t), c.y + c.r * Math.cos(phi), c.z + c.r * Math.sin(phi) * Math.sin(t)], a });
      }
    }
    return out;
  }
  if (c.kind === 'prism') {
    const n = c.ring.length / 2;
    const rows = Math.max(1, Math.ceil((c.top - c.bottom) / s));
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const ax = c.ring[i * 2];
      const az = c.ring[i * 2 + 1];
      const bx = c.ring[((i + 1) % n) * 2];
      const bz = c.ring[((i + 1) % n) * 2 + 1];
      minX = Math.min(minX, ax);
      maxX = Math.max(maxX, ax);
      minZ = Math.min(minZ, az);
      maxZ = Math.max(maxZ, az);
      const len = Math.hypot(bx - ax, bz - az);
      const cols = Math.max(1, Math.ceil(len / s));
      for (let j = 0; j < rows; j++) {
        for (let k = 0; k < cols; k++) {
          const t = (k + 0.5) / cols;
          out.push({ p: [ax + (bx - ax) * t, c.bottom + ((j + 0.5) / rows) * (c.top - c.bottom), az + (bz - az) * t], a: (len / cols) * ((c.top - c.bottom) / rows) });
        }
      }
    }
    for (let gx = minX + s / 2; gx < maxX; gx += s) {
      for (let gz = minZ + s / 2; gz < maxZ; gz += s) {
        if (ringDistance(c.ring, gx, gz) < 0) {
          out.push({ p: [gx, c.top, gz], a: s * s });
        }
      }
    }
    return out;
  }
  if (c.kind === 'cylinder') {
    const ring = Math.max(8, Math.ceil((2 * Math.PI * c.r) / s));
    const rows = Math.max(1, Math.ceil(c.h / s));
    for (let j = 0; j < rows; j++) {
      for (let k = 0; k < ring; k++) {
        const t = ((k + 0.5) / ring) * Math.PI * 2;
        out.push({ p: [c.x + c.r * Math.cos(t), c.y + ((j + 0.5) / rows) * c.h, c.z + c.r * Math.sin(t)], a: ((2 * Math.PI * c.r) / ring) * (c.h / rows) });
      }
    }
    const n = Math.max(1, Math.ceil(c.r / s));
    for (let i = 0; i < n; i++) {
      const rr = ((i + 0.5) / n) * c.r;
      const cnt = Math.max(4, Math.ceil((2 * Math.PI * rr) / s));
      for (let k = 0; k < cnt; k++) {
        const t = ((k + 0.5) / cnt) * Math.PI * 2;
        out.push({ p: [c.x + rr * Math.cos(t), c.y + c.h, c.z + rr * Math.sin(t)], a: ((2 * Math.PI * rr) / cnt) * (c.r / n) });
      }
    }
    return out;
  }
  const cs = Math.cos(c.yaw);
  const sn = Math.sin(c.yaw);
  const toWorld = (lx: number, ly: number, lz: number): P => [c.cx + lx * cs + lz * sn, c.cy + ly, c.cz - lx * sn + lz * cs];
  const face = (axis: 0 | 1 | 2, sign: number): void => {
    const h = [c.hx, c.hy, c.hz];
    const u = axis === 0 ? 1 : 0;
    const v = axis === 2 ? 1 : 2;
    const nu = Math.max(1, Math.ceil((2 * h[u]) / s));
    const nv = Math.max(1, Math.ceil((2 * h[v]) / s));
    const a = ((2 * h[u]) / nu) * ((2 * h[v]) / nv);
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const l = [0, 0, 0];
        l[axis] = sign * h[axis];
        l[u] = -h[u] + ((i + 0.5) / nu) * 2 * h[u];
        l[v] = -h[v] + ((j + 0.5) / nv) * 2 * h[v];
        out.push({ p: toWorld(l[0], l[1], l[2]), a });
      }
    }
  };
  face(0, 1);
  face(0, -1);
  face(1, 1);
  face(2, 1);
  face(2, -1);
  return out;
}

class PointGrid {
  private cells = new Map<string, P[]>();
  constructor(private cell: number) {}
  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  add(p: P): void {
    const k = this.key(p[0], p[1], p[2]);
    const list = this.cells.get(k);
    if (list) {
      list.push(p);
    } else {
      this.cells.set(k, [p]);
    }
  }
  /** True when a point lies within r (<= cell) of p. */
  near(p: P, r: number): boolean {
    const cx = Math.floor(p[0] / this.cell);
    const cy = Math.floor(p[1] / this.cell);
    const cz = Math.floor(p[2] / this.cell);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (let k = -1; k <= 1; k++) {
          const list = this.cells.get(`${cx + i},${cy + j},${cz + k}`);
          if (!list) {
            continue;
          }
          for (const q of list) {
            if ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2 <= r * r) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }
}

interface Spot {
  p: P;
  a: number;
}

/** Groups spots into ~4 m clusters and returns the largest ones (area, centre). */
function clusters(spots: Spot[], top = 8): Array<{ area: number; at: P }> {
  const map = new Map<string, { area: number; sx: number; sy: number; sz: number }>();
  for (const s of spots) {
    const k = `${Math.floor(s.p[0] / 4)},${Math.floor(s.p[1] / 4)},${Math.floor(s.p[2] / 4)}`;
    const e = map.get(k) ?? { area: 0, sx: 0, sy: 0, sz: 0 };
    e.area += s.a;
    e.sx += s.p[0] * s.a;
    e.sy += s.p[1] * s.a;
    e.sz += s.p[2] * s.a;
    map.set(k, e);
  }
  return [...map.values()]
    .sort((a, b) => b.area - a.area)
    .slice(0, top)
    .map((e) => ({ area: Math.round(e.area * 10) / 10, at: [e.sx / e.area, e.sy / e.area, e.sz / e.area].map((v) => Math.round(v * 10) / 10) as P }));
}

export interface AuditResult {
  id: string;
  colliders: number;
  surface: number;
  uncovered: number;
  phantom: number;
  worstUncovered: Array<{ area: number; at: P }>;
  worstPhantom: Array<{ area: number; at: P }>;
}

export function audit(id: string): AuditResult {
  const spec = LANDMARK_SPECS[id];
  const b = new MeshBuilder(1 << 17);
  const res = spec.style === 'byzantine' ? buildByzantine(b, spec, 0) : buildImperial(b, spec, 0);
  const g = b.build();
  const pos = g.position;
  const idx = g.index;
  const grid = new PointGrid(TOL_PHANTOM);
  const uncovered: Spot[] = [];
  let surface = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t];
    const ib = idx[t + 1];
    const ic = idx[t + 2];
    const A: P = [pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2]];
    const B: P = [pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2]];
    const C: P = [pos[ic * 3], pos[ic * 3 + 1], pos[ic * 3 + 2]];
    const e1: P = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const e2: P = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const area = 0.5 * Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
    if (area < 1e-6) {
      continue;
    }
    const n = Math.max(1, Math.ceil(area / (STEP * STEP)));
    const side = Math.ceil(Math.sqrt(n * 2));
    const pts: P[] = [];
    for (let i = 0; i < side; i++) {
      for (let j = 0; j < side - i; j++) {
        const u = (i + 1 / 3) / side;
        const v = (j + 1 / 3) / side;
        pts.push([A[0] + e1[0] * u + e2[0] * v, A[1] + e1[1] * u + e2[1] * v, A[2] + e1[2] * u + e2[2] * v]);
      }
    }
    pts.push(A, B, C);
    for (const p of pts) {
      grid.add(p);
    }
    const mat = g.data[ia * 4];
    if (SKIP_MATS.has(mat)) {
      continue;
    }
    const each = area / (pts.length - 3);
    for (const p of pts.slice(0, -3)) {
      if (p[1] < 0.6) {
        continue;
      }
      surface += each;
      let best = Infinity;
      for (const c of res.colliders) {
        best = Math.min(best, colliderDistance(c, p));
        if (best <= TOL_OUT) {
          break;
        }
      }
      if (best > TOL_OUT) {
        uncovered.push({ p, a: each });
      }
    }
  }
  const phantom: Spot[] = [];
  for (const c of res.colliders) {
    for (const s of colliderSurface(c)) {
      if (s.p[1] < 0.6) {
        continue;
      }
      // a collider face inside (or on) another collider is internal: nothing can touch it
      if (res.colliders.some((o) => o !== c && colliderDistance(o, s.p) < 0.02)) {
        continue;
      }
      if (!grid.near(s.p, TOL_PHANTOM)) {
        phantom.push(s);
        if (process.env.AUDIT_TRACE) {
          console.log('phantom', c.kind, s.p.map((v) => v.toFixed(1)).join(','), JSON.stringify(c));
        }
      }
    }
  }
  const sum = (l: Spot[]): number => Math.round(l.reduce((m, s) => m + s.a, 0));
  return {
    id,
    colliders: res.colliders.length,
    surface: Math.round(surface),
    uncovered: sum(uncovered),
    phantom: sum(phantom),
    worstUncovered: clusters(uncovered),
    worstPhantom: clusters(phantom),
  };
}

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : null;
const ids = args.filter((a, i) => !a.startsWith('--') && (jsonAt < 0 || i !== jsonAt + 1));
const list = ids.length ? ids : Object.keys(LANDMARK_SPECS);
const results: AuditResult[] = [];
for (const id of list) {
  const r = audit(id);
  results.push(r);
  console.log(`${id.padEnd(22)} colliders ${String(r.colliders).padStart(3)}  surface ${String(r.surface).padStart(6)} m²  uncovered ${String(r.uncovered).padStart(5)} m²  phantom ${String(r.phantom).padStart(5)} m²`);
  if (ids.length) {
    console.log('  worst uncovered:', JSON.stringify(r.worstUncovered));
    console.log('  worst phantom:  ', JSON.stringify(r.worstPhantom));
  }
}
const tot = (k: 'uncovered' | 'phantom'): number => results.reduce((m, r) => m + r[k], 0);
console.log(`TOTAL uncovered ${tot('uncovered')} m², phantom ${tot('phantom')} m²`);
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(results, null, 1));
}
