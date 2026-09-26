/**
 * Headless z-fighting audit of the hand-made landmark models (no browser, no GPU): builds every landmark mosque and
 * the Galata / Kız / Beyazıt / Çamlıca towers at LOD0 and LOD1 and looks for faces that lie in the same plane
 * (within PLANE_TOL), face the same way and overlap, the pattern that flickers as the camera moves (Ayasofya's great
 * arch crown in the dome-base platform wall). Faces pointing opposite ways never fight (the back one is culled), and
 * overlaps between faces of the same material and colour cannot show, so they are reported apart as `hidden`.
 *
 *   npx tsx scripts/zfight-audit.ts                  # all models
 *   npx tsx scripts/zfight-audit.ts ayasofya galata-kulesi
 *   npx tsx scripts/zfight-audit.ts --json out.json
 *
 * Exit code 1 when any model has a visible overlap above MIN_AREA (so it can run as a check).
 */
import { writeFileSync } from 'node:fs';
import { buildLandmarkDefs } from '../src/world/geo/prepare';
import { MeshBuilder as MosqueBuilder } from '../src/world/landmarks/mosques/gen/builder';
import { LANDMARK_SPECS } from '../src/world/landmarks/mosques/gen/specs';
import { buildByzantine } from '../src/world/landmarks/mosques/gen/styles/byzantine';
import { buildImperial } from '../src/world/landmarks/mosques/gen/styles/imperial';
import type { LodLevel } from '../src/world/landmarks/mosques/gen/types';
import { StructureBuild } from '../src/world/landmarks/structures/build/context';
import { builderFor } from '../src/world/landmarks/structures/builders/registry';
import type { SiteDef } from '../src/world/landmarks/structures/types';

/** Faces closer than this (m) along their shared normal count as coplanar. */
const PLANE_TOL = 0.015;
/** Normals within ~1.8° count as parallel. */
const COS_TOL = 0.9995;
/**
 * A model/LOD fails above this visible overlap (m²). The residue left under it is scattered pieces of a few dm² (small
 * dome bases against a roof edge, two drum windows touching at a corner) nobody sees from the air.
 */
const MIN_AREA = 2;
/** Overlaps of single triangle pairs below this (m²) are sliver contacts at shared corners, not visible fights. */
const MIN_PAIR = 0.01;
const TOWERS = ['galata-kulesi', 'kiz-kulesi', 'beyazit-kulesi', 'camlica-kulesi'];

type V3 = [number, number, number];

interface Tri {
  a: V3;
  b: V3;
  c: V3;
  n: V3;
  d: number;
  /** Look key: material + colour; overlaps of identical looks cannot flicker visibly. */
  look: string;
}

interface Mesh {
  pos: ArrayLike<number>;
  index: ArrayLike<number>;
  look: (vertex: number) => string;
}

/** Model-local origin of the last tris() call (reports add it back). */
let ORIGIN: V3 = [0, 0, 0];

function tris(meshes: readonly Mesh[]): Tri[] {
  const out: Tri[] = [];
  // model-local coordinates: the towers stand kilometres from the world origin, where float noise in a small
  // triangle's normal would move its plane offset by centimetres
  const first = meshes.find((m) => m.pos.length >= 3);
  const ox = first ? first.pos[0] : 0;
  const oy = first ? first.pos[1] : 0;
  const oz = first ? first.pos[2] : 0;
  ORIGIN = [ox, oy, oz];
  for (const m of meshes) {
    for (let t = 0; t < m.index.length; t += 3) {
      const ia = m.index[t];
      const ib = m.index[t + 1];
      const ic = m.index[t + 2];
      const a: V3 = [m.pos[ia * 3] - ox, m.pos[ia * 3 + 1] - oy, m.pos[ia * 3 + 2] - oz];
      const b: V3 = [m.pos[ib * 3] - ox, m.pos[ib * 3 + 1] - oy, m.pos[ib * 3 + 2] - oz];
      const c: V3 = [m.pos[ic * 3] - ox, m.pos[ic * 3 + 1] - oy, m.pos[ic * 3 + 2] - oz];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const nx = e1[1] * e2[2] - e1[2] * e2[1];
      const ny = e1[2] * e2[0] - e1[0] * e2[2];
      const nz = e1[0] * e2[1] - e1[1] * e2[0];
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-6) {
        continue;
      }
      const n: V3 = [nx / l, ny / l, nz / l];
      out.push({ a, b, c, n, d: n[0] * a[0] + n[1] * a[1] + n[2] * a[2], look: m.look(ia) });
    }
  }
  return out;
}

/** 2D coordinates of a point in the plane with normal n (two fixed axes perpendicular to n). */
function axes(n: V3): [V3, V3] {
  const ref: V3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u: V3 = [ref[1] * n[2] - ref[2] * n[1], ref[2] * n[0] - ref[0] * n[2], ref[0] * n[1] - ref[1] * n[0]];
  const lu = Math.hypot(u[0], u[1], u[2]);
  u[0] /= lu;
  u[1] /= lu;
  u[2] /= lu;
  const v: V3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return [u, v];
}

type P2 = [number, number];

function area2(p: readonly P2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** Sutherland-Hodgman clip of a convex polygon by a convex CCW polygon. */
function clip(subject: P2[], clipper: readonly P2[]): P2[] {
  let out = subject;
  for (let i = 0; i < clipper.length && out.length; i++) {
    const [ax, ay] = clipper[i];
    const [bx, by] = clipper[(i + 1) % clipper.length];
    const inside = (p: P2): boolean => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax) >= 0;
    const cut = (p: P2, q: P2): P2 => {
      const a1 = (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
      const a2 = (bx - ax) * (q[1] - ay) - (by - ay) * (q[0] - ax);
      const t = a1 / (a1 - a2);
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    };
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const p = input[k];
      const q = input[(k + 1) % input.length];
      if (inside(q)) {
        if (!inside(p)) {
          out.push(cut(p, q));
        }
        out.push(q);
      } else if (inside(p)) {
        out.push(cut(p, q));
      }
    }
  }
  return out;
}

export interface Overlap {
  area: number;
  at: V3;
  looks: [string, string];
}

export interface ZResult {
  id: string;
  lod: number;
  triangles: number;
  visible: number;
  hidden: number;
  worst: Overlap[];
}

function audit(id: string, lod: number, meshes: readonly Mesh[]): ZResult {
  const all = tris(meshes);
  // Bucket by quantised plane (normal direction + offset); neighbours of the offset bin are searched too.
  const key = (n: V3, d: number): string => `${Math.round(n[0] * 40)},${Math.round(n[1] * 40)},${Math.round(n[2] * 40)}|${Math.round(d / 0.1)}`;
  const buckets = new Map<string, number[]>();
  all.forEach((t, i) => {
    const k = key(t.n, t.d);
    const list = buckets.get(k);
    if (list) {
      list.push(i);
    } else {
      buckets.set(k, [i]);
    }
  });
  const overlaps: Overlap[] = [];
  let visible = 0;
  let hidden = 0;
  const seen = new Set<string>();
  for (const [k, list] of buckets) {
    const [nk, dk] = k.split('|');
    const others: number[] = [];
    for (const dd of [-1, 0, 1]) {
      others.push(...(buckets.get(`${nk}|${Number(dk) + dd}`) ?? []));
    }
    // 2D grid inside the plane group so large groups stay fast
    const t0 = all[list[0]];
    const [u, v] = axes(t0.n);
    const to2 = (p: V3): P2 => [p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * v[0] + p[1] * v[1] + p[2] * v[2]];
    const cell = 4;
    const grid = new Map<string, number[]>();
    const poly = new Map<number, P2[]>();
    const bbox = new Map<number, [number, number, number, number]>();
    const prep = (i: number): void => {
      if (poly.has(i)) {
        return;
      }
      const t = all[i];
      let p = [to2(t.a), to2(t.b), to2(t.c)];
      if (area2(p) < 0) {
        p = [p[0], p[2], p[1]];
      }
      poly.set(i, p);
      bbox.set(i, [Math.min(p[0][0], p[1][0], p[2][0]), Math.min(p[0][1], p[1][1], p[2][1]), Math.max(p[0][0], p[1][0], p[2][0]), Math.max(p[0][1], p[1][1], p[2][1])]);
    };
    for (const i of others) {
      prep(i);
      const [x0, y0, x1, y1] = bbox.get(i)!;
      for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) {
        for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
          const g = `${gx},${gy}`;
          const l = grid.get(g);
          if (l) {
            l.push(i);
          } else {
            grid.set(g, [i]);
          }
        }
      }
    }
    for (const i of list) {
      const ti = all[i];
      const [x0, y0, x1, y1] = bbox.get(i)!;
      const cand = new Set<number>();
      for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) {
        for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
          for (const j of grid.get(`${gx},${gy}`) ?? []) {
            if (j > i) {
              cand.add(j);
            }
          }
        }
      }
      for (const j of cand) {
        const pk = `${i}:${j}`;
        if (seen.has(pk)) {
          continue;
        }
        seen.add(pk);
        const tj = all[j];
        if (ti.n[0] * tj.n[0] + ti.n[1] * tj.n[1] + ti.n[2] * tj.n[2] < COS_TOL) {
          continue;
        }
        const off = (p: V3): number => ti.n[0] * (p[0] - ti.a[0]) + ti.n[1] * (p[1] - ti.a[1]) + ti.n[2] * (p[2] - ti.a[2]);
        if (Math.max(Math.abs(off(tj.a)), Math.abs(off(tj.b)), Math.abs(off(tj.c))) > PLANE_TOL) {
          continue;
        }
        const [bx0, by0, bx1, by1] = bbox.get(j)!;
        if (bx0 >= x1 || bx1 <= x0 || by0 >= y1 || by1 <= y0) {
          continue;
        }
        const inter = clip(poly.get(i)!, poly.get(j)!);
        const a = inter.length >= 3 ? Math.abs(area2(inter)) : 0;
        if (a < MIN_PAIR) {
          continue;
        }
        const at: V3 = [(ti.a[0] + ti.b[0] + ti.c[0]) / 3 + ORIGIN[0], (ti.a[1] + ti.b[1] + ti.c[1]) / 3 + ORIGIN[1], (ti.a[2] + ti.b[2] + ti.c[2]) / 3 + ORIGIN[2]];
        if (process.env.ZF_TRACE && Math.hypot(at[0] - Number(process.env.ZF_X), at[2] - Number(process.env.ZF_Z)) < 1.5) {
          const w = (p: V3): string => [p[0] + ORIGIN[0], p[1] + ORIGIN[1], p[2] + ORIGIN[2]].map((x) => x.toFixed(2)).join(',');
          console.log('pair', at.map((x) => x.toFixed(2)).join(','), off(tj.a).toFixed(4), `[${w(ti.a)} ${w(ti.b)} ${w(ti.c)}] [${w(tj.a)} ${w(tj.b)} ${w(tj.c)}]`, ti.n.map((x) => x.toFixed(3)).join(','), tj.n.map((x) => x.toFixed(3)).join(','), ti.look, tj.look, a.toFixed(3));
        }
        if (ti.look === tj.look) {
          hidden += a;
        } else {
          visible += a;
          overlaps.push({ area: a, at, looks: [ti.look, tj.look] });
        }
      }
    }
  }
  // cluster the visible overlaps (4 m cells) for the report
  const cl = new Map<string, Overlap>();
  for (const o of overlaps) {
    const k = o.at.map((x) => Math.floor(x / 4)).join(',') + o.looks.slice().sort().join('/');
    const e = cl.get(k);
    if (e) {
      e.area += o.area;
    } else {
      cl.set(k, { ...o, at: o.at.map((x) => Math.round(x * 10) / 10) as V3 });
    }
  }
  const worst = [...cl.values()].sort((p, q) => q.area - p.area).slice(0, 8);
  worst.forEach((w) => (w.area = Math.round(w.area * 100) / 100));
  return { id, lod, triangles: all.length, visible: Math.round(visible * 100) / 100, hidden: Math.round(hidden * 100) / 100, worst };
}

const MAT_NAMES = ['stone', 'smooth', 'carved', 'lead', 'glass', 'gold', 'plaster', 'brick', 'marble', 'paving', 'lamp', 'dark', 'tile', 'banded'];

function mosqueMeshes(id: string, lod: LodLevel): Mesh[] {
  const spec = LANDMARK_SPECS[id];
  const b = new MosqueBuilder(1 << 16);
  if (spec.style === 'byzantine') {
    buildByzantine(b, spec, lod);
  } else {
    buildImperial(b, spec, lod);
  }
  const g = b.build();
  return [
    {
      pos: g.position,
      index: g.index,
      look: (v) => `${MAT_NAMES[g.data[v * 4]] ?? g.data[v * 4]}#${g.tint[v * 4]},${g.tint[v * 4 + 1]},${g.tint[v * 4 + 2]}`,
    },
  ];
}

const DEFS = buildLandmarkDefs();

function towerMeshes(id: string, lod: number): Mesh[] {
  const def = DEFS.find((d) => d.id === id) as SiteDef | undefined;
  if (!def) {
    throw new Error(`no landmark ${id}`);
  }
  const flat = { ox: def.x, oz: def.z, ux: 1, uz: 0, u0: -500, lenU: 1000, v0: -500, lenV: 1000, cell: 500, nu: 2, nv: 2, data: new Float32Array(4) };
  const b = new StructureBuild({ def, patches: [flat] });
  builderFor(def)(b);
  const res = b.result(0);
  return res.parts
    .map((p) => p.lods[Math.min(lod, p.lods.length - 1)])
    .map((g, k) => ({
      pos: g.position,
      index: g.index,
      look: (v: number) => `part${res.parts[k].batch}:s${g.surf[v * 4]}#${g.color[v * 3]},${g.color[v * 3 + 1]},${g.color[v * 3 + 2]}`,
    }));
}

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : null;
const ids = args.filter((a, i) => !a.startsWith('--') && (jsonAt < 0 || i !== jsonAt + 1));
const list = ids.length ? ids : [...Object.keys(LANDMARK_SPECS), ...TOWERS];
const results: ZResult[] = [];
const t0 = performance.now();
for (const id of list) {
  for (const lod of [0, 1]) {
    const meshes = TOWERS.includes(id) ? towerMeshes(id, lod) : mosqueMeshes(id, lod as LodLevel);
    const r = audit(id, lod, meshes);
    results.push(r);
    console.log(`${id.padEnd(22)} LOD${lod}  tris ${String(r.triangles).padStart(7)}  visible ${String(r.visible).padStart(8)} m²  hidden ${String(r.hidden).padStart(8)} m²`);
    if (r.visible >= MIN_AREA && (ids.length || r.visible >= 1)) {
      for (const w of r.worst.slice(0, ids.length ? 8 : 3)) {
        console.log(`    ${String(w.area).padStart(7)} m² at ${w.at.join(', ')}  ${w.looks.join(' vs ')}`);
      }
    }
  }
}
const bad = results.filter((r) => r.visible >= MIN_AREA);
console.log(`\n${results.length} model/LOD pairs in ${((performance.now() - t0) / 1000).toFixed(1)} s; ${bad.length} with visible overlaps`);
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(results, null, 1));
}
process.exitCode = bad.length ? 1 : 0;
