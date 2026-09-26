/**
 * Detail pieces of the city-wall kit that sit on a wall face: face relief with a lost-facing field, relieving
 * arches, brick buttress repairs, vegetation cards (ivy sheets, fig clumps, grass tufts) and tower corner chipping.
 * All deterministic from a seed; vegetation uses the WALL_FOLIAGE surface (leaf cut-outs in the wall shader).
 */
import { mat, type Mat, type MeshBuilder } from '../../heritage/build/mesh-builder';
import type { V2, V3 } from '../../heritage/build/geom';
import { lathe } from '../../heritage/build/prims/basic';

/** Surface id of foliage cards in the wall shader (leaf / grass cut-outs); weather < 0.3 selects grass blades. */
export const WALL_FOLIAGE = 30;

export function hash(seed: number, n: number): number {
  return ((Math.imul(seed ^ Math.imul(n + 1, 2654435761), 1597334677) >>> 0) % 100003) / 100003;
}

/** 2D value noise in [0, 1]. */
export function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number): number => hash(seed, a * 7919 + b * 104729);
  const a = h(ix, iy) * (1 - ux) + h(ix + 1, iy) * ux;
  const b = h(ix, iy + 1) * (1 - ux) + h(ix + 1, iy + 1) * ux;
  return a * (1 - uy) + b * uy;
}

/** Planar polygon oriented to face n whatever the input winding (fan triangulated: convex only). */
export function faceTo(mb: MeshBuilder, pts: V3[], uv: number[], m: Mat, n: V3, ao: number | number[] = 1): void {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-9) {
    return;
  }
  let P = pts;
  let U = uv;
  let A = ao;
  if (nx * n[0] + ny * n[1] + nz * n[2] < 0) {
    P = pts.slice().reverse();
    U = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      U.push(uv[i * 2], uv[i * 2 + 1]);
    }
    if (Array.isArray(ao)) {
      A = ao.slice().reverse();
    }
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  nx /= l;
  ny /= l;
  nz /= l;
  const base = mb.vertexCount;
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    mb.vertex(p[0], p[1], p[2], nx, ny, nz, U[i * 2], U[i * 2 + 1], m, typeof A === 'number' ? A : A[i]);
  }
  for (let i = 1; i < P.length - 1; i++) {
    mb.tri(base, base + i, base + i + 1);
  }
}

/* ------------------------------------------------------------------ face relief */

/** A point of a wall face grid. */
export interface FacePoint {
  x: number;
  y: number;
  z: number;
  u: number;
  /** Outward unit normal (horizontal). */
  nx: number;
  nz: number;
  /** Tangent along the wall. */
  tx: number;
  tz: number;
}

/**
 * Emits a face grid ([column][row]) as quads with a per-vertex loss value in the floodlight channel (the wall shader
 * reads it as lost facing on masonry surfaces) and a little extra occlusion in the losses.
 */
export function reliefSurface(mb: MeshBuilder, g: FacePoint[][], loss: number[][] | null, m: Mat, cellMat?: (i: number, r: number) => Mat | null): void {
  const C = g.length - 1;
  const R = g[0].length - 1;
  const cache = new Map<Mat, Map<number, Mat>>();
  const matFor = (base: Mat, l: number): Mat => {
    let byLoss = cache.get(base);
    if (!byLoss) {
      byLoss = new Map();
      cache.set(base, byLoss);
    }
    const k = Math.round(l * 50);
    let mm = byLoss.get(k);
    if (!mm) {
      mm = { ...base, flood: k / 50 };
      byLoss.set(k, mm);
    }
    return mm;
  };
  for (let i = 0; i < C; i++) {
    for (let r = 0; r < R; r++) {
      const q = [g[i][r], g[i + 1][r], g[i + 1][r + 1], g[i][r + 1]];
      const L = loss ? [loss[i][r], loss[i + 1][r], loss[i + 1][r + 1], loss[i][r + 1]] : [0, 0, 0, 0];
      const base = (cellMat && cellMat(i, r)) || m;
      // Newell normal, oriented outward.
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let k = 0; k < 4; k++) {
        const a = q[k];
        const b = q[(k + 1) % 4];
        nx += (a.y - b.y) * (a.z + b.z);
        ny += (a.z - b.z) * (a.x + b.x);
        nz += (a.x - b.x) * (a.y + b.y);
      }
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) {
        continue;
      }
      let order = [0, 1, 2, 3];
      if (nx * (q[0].nx + q[1].nx) + nz * (q[0].nz + q[1].nz) < 0) {
        order = [3, 2, 1, 0];
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      // Two triangles with their own flat normals: on the steep reveals of a loss the halves of a quad face very
      // different ways, and one averaged normal lit them wrongly.
      for (const tri of [[order[0], order[1], order[2]], [order[0], order[2], order[3]]]) {
        const [A, B, Cq] = tri.map((k) => q[k]);
        const ux = B.x - A.x;
        const uy = B.y - A.y;
        const uz = B.z - A.z;
        const wx = Cq.x - A.x;
        const wy = Cq.y - A.y;
        const wz = Cq.z - A.z;
        let tx = uy * wz - uz * wy;
        let ty = uz * wx - ux * wz;
        let tz = ux * wy - uy * wx;
        const tl = Math.hypot(tx, ty, tz);
        if (tl < 1e-9) {
          continue;
        }
        // Bent toward the face normal: the ceilings and sides of the recesses face down / sideways and got almost no
        // sky light (black strips at low sun); real recesses keep some bounce light from the surrounding face.
        tx = tx / tl + 0.7 * q[0].nx;
        ty = ty / tl;
        tz = tz / tl + 0.7 * q[0].nz;
        const bl = Math.hypot(tx, ty, tz) || 1;
        tx /= bl;
        ty /= bl;
        tz /= bl;
        const v0 = mb.vertexCount;
        for (const k of tri) {
          const v = q[k];
          mb.vertex(v.x, v.y, v.z, tx, ty, tz, v.u, v.y, matFor(base, L[k]), 1 - 0.15 * L[k]);
        }
        mb.tri(v0, v0 + 1, v0 + 2);
      }
    }
  }
}

/**
 * Lost-facing and repair fields of a face grid (in place): noise-shaped losses (more at the foot, occasional big
 * collapses) push the face back into the core by up to ~1.4 m with irregular rubble relief; brick repair patches (toothed,
 * cell-aligned) stand 5-12 cm proud. Returns the per-vertex loss and a per-cell repair flag. Columns / rows flagged by
 * `fixed` keep their position (seams with neighbouring pieces).
 */
export function faceFields(
  g: FacePoint[][],
  seed: number,
  amount: number,
  repairs: number,
  fixed: (i: number, r: number) => boolean,
): { loss: number[][]; repair: boolean[][] } {
  const C = g.length - 1;
  const R = g[0].length - 1;
  // Big collapses: blobs of 3-6 m radius, about one per 60 m.
  const u0 = g[0][0].u;
  const u1 = g[C][0].u;
  const blobs: [number, number, number][] = [];
  const nb = Math.floor(((u1 - u0) / 60) * amount + hash(seed, 1));
  for (let k = 0; k < nb; k++) {
    const bu = u0 + (u1 - u0) * (0.15 + 0.7 * hash(seed, 10 + k));
    const by = g[0][0].y + (g[0][R].y - g[0][0].y) * (0.15 + 0.5 * hash(seed, 20 + k));
    blobs.push([bu, by, 3 + 3 * hash(seed, 30 + k)]);
  }
  const loss: number[][] = [];
  for (let i = 0; i <= C; i++) {
    const lc: number[] = [];
    for (let r = 0; r <= R; r++) {
      const q = g[i][r];
      const hRel = r / R;
      const v = noise2(q.u / 4.5, q.y / 3.5, seed + 93) * 0.6 + noise2(q.u / 1.5, q.y / 1.2, seed + 95) * 0.28 + noise2(q.u / 0.5, q.y / 0.45, seed + 97) * 0.12;
      let blob = 0;
      for (const [bu, by, br] of blobs) {
        const d = Math.hypot((q.u - bu) / br, (q.y - by) / (br * 0.8));
        blob = Math.max(blob, 1 - d);
      }
      const foot = 0.35 * Math.pow(1 - hRel, 3);
      const thr = 0.8 - 0.14 * amount - foot - blob * 0.5;
      let l = Math.max(0, Math.min(1, (v - thr) / 0.07 + 0.5));
      if (fixed(i, r)) {
        l = 0;
      }
      lc.push(l);
      if (l > 0) {
        const dep = l * (0.35 + 0.6 * noise2(q.u / 2.2, q.y / 1.8, seed + 91) + blob * 0.6) + (l > 0.6 ? (hash(seed, 6000 + i * 37 + r) - 0.5) * 0.18 : 0);
        q.x -= q.nx * dep;
        q.z -= q.nz * dep;
      }
    }
    loss.push(lc);
  }
  const repair: boolean[][] = [];
  const out = new Set<string>();
  for (let i = 0; i < C; i++) {
    const rc: boolean[] = [];
    for (let r = 0; r < R; r++) {
      const q = g[i][r];
      // Broad, tall patches (rebuilt breaches run up the whole wall).
      const v = noise2(q.u / 3.2, q.y / 11, seed + 131);
      const on = repairs > 0 && v > 0.8 - 0.06 * repairs && loss[i][r] + loss[i + 1][r + 1] < 0.2;
      rc.push(on);
      if (on) {
        for (const [a, b] of [[i, r], [i + 1, r], [i, r + 1], [i + 1, r + 1]]) {
          out.add(`${a},${b}`);
        }
      }
    }
    repair.push(rc);
  }
  // Repair patches stand proud of the old face.
  for (const key of out) {
    const [a, b] = key.split(',').map(Number);
    if (fixed(a, b)) {
      continue;
    }
    const q = g[a][b];
    // Bulging: proud by 5 cm at the patch edge, up to ~25 cm in its middle.
    const v = noise2(q.u / 3.2, q.y / 11, seed + 131);
    const d = 0.05 + 0.2 * Math.max(0, Math.min(1, (v - 0.78) / 0.12)) + 0.03 * hash(seed, 7000 + a * 41 + b);
    q.x += q.nx * d;
    q.z += q.nz * d;
  }
  return { loss, repair };
}

/* ------------------------------------------------------------------ face ornaments */

/**
 * Brick relieving arch on a face point: a proud ring of brick voussoirs over a blocked infill of rubble (the arches
 * that carried the wall over its foundation piers, later walled up).
 */
export function relievingArch(mb: MeshBuilder, f: FacePoint, w: number, rise: number, brick: Mat, fill: Mat, lod: number): void {
  const r = w / 2;
  const seg = lod === 0 ? 9 : 5;
  const ring = 0.45 + (w > 3 ? 0.15 : 0);
  const n: V3 = [f.nx, 0, f.nz];
  const P = (u: number, v: number, o: number): V3 => [f.x + f.tx * u + f.nx * o, f.y + v, f.z + f.tz * u + f.nz * o];
  const fillPts: V3[] = [P(-r, -rise * 0.4, 0.02), P(r, -rise * 0.4, 0.02)];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI;
    fillPts.push(P(Math.cos(a) * r, Math.sin(a) * rise, 0.02));
  }
  faceTo(mb, fillPts, fillPts.flatMap((q) => [q[0] * f.tx + q[2] * f.tz, q[1]]), fill, n, 0.85);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI;
    const a1 = ((i + 1) / seg) * Math.PI;
    const q0 = P(Math.cos(a0) * r, Math.sin(a0) * rise, 0.07);
    const q1 = P(Math.cos(a1) * r, Math.sin(a1) * rise, 0.07);
    const q2 = P(Math.cos(a1) * (r + ring), Math.sin(a1) * (rise + ring), 0.07);
    const q3 = P(Math.cos(a0) * (r + ring), Math.sin(a0) * (rise + ring), 0.07);
    faceTo(mb, [q0, q1, q2, q3], [a0 * r, 0, a1 * r, 0, a1 * r, ring, a0 * r, ring], brick, n);
    // Soffit of the proud ring.
    if (lod === 0) {
      const b0 = P(Math.cos(a0) * r, Math.sin(a0) * rise, 0.0);
      const b1 = P(Math.cos(a1) * r, Math.sin(a1) * rise, 0.0);
      const am = (a0 + a1) / 2;
      faceTo(mb, [b0, b1, q1, q0], [0, 0, 1, 0, 1, 0.07, 0, 0.07], brick, [-Math.cos(am) * f.tx, -Math.sin(am), -Math.cos(am) * f.tz], 0.7);
    }
  }
}

/**
 * Brick buttress (later repair) against a face at its foot point `f` (y = ground): stepped offsets every ~0.7 m
 * (brick courses set back), each step a sloped weathering course, narrowing upward.
 */
export function buttress(mb: MeshBuilder, f: FacePoint, w: number, d0: number, h: number, m: Mat): void {
  const steps = Math.max(3, Math.round(h / 0.7));
  const P = (u: number, v: number, y: number): V3 => [f.x + f.tx * u + f.nx * v, f.y + y, f.z + f.tz * u + f.nz * v];
  for (let k = 0; k < steps; k++) {
    const t0 = k / steps;
    const t1 = (k + 1) / steps;
    const y0 = k === 0 ? -0.6 : h * t0;
    const y1 = h * t1 - 0.12;
    const d = d0 * (1 - t0 * 0.85) + 0.1 * Math.sin(k * 2.3);
    const dn = d0 * (1 - t1 * 0.85);
    const hw = (w / 2) * (1 - t0 * 0.2);
    // Front, sides, sloped weathering at the top of the step (down to the next step's face).
    faceTo(mb, [P(-hw, d, y0), P(hw, d, y0), P(hw, d, y1), P(-hw, d, y1)], [-hw, y0, hw, y0, hw, y1, -hw, y1], m, [f.nx, 0, f.nz]);
    faceTo(mb, [P(-hw, -0.1, y0), P(-hw, d, y0), P(-hw, d, y1), P(-hw, -0.1, y1)], [0, y0, d, y0, d, y1, 0, y1], m, [-f.tx, 0, -f.tz]);
    faceTo(mb, [P(hw, d, y0), P(hw, -0.1, y0), P(hw, -0.1, y1), P(hw, d, y1)], [0, y0, d, y0, d, y1, 0, y1], m, [f.tx, 0, f.tz]);
    faceTo(mb, [P(-hw, d, y1), P(hw, d, y1), P(hw, dn, y1 + 0.12), P(-hw, dn, y1 + 0.12)], [-hw, 0, hw, 0, hw, 0.3, -hw, 0.3], m, [f.nx, 1, f.nz]);
    if (k === steps - 1) {
      faceTo(mb, [P(-hw, dn, y1 + 0.12), P(hw, dn, y1 + 0.12), P(hw, -0.1, y1 + 0.12), P(-hw, -0.1, y1 + 0.12)], [0, 0, 1, 0, 1, 1, 0, 1], m, [0, 1, 0]);
    }
  }
}

/* ------------------------------------------------------------------ vegetation */

export function foliageMat(seed: number, grass = false): Mat {
  const k = hash(seed, 3);
  const c: [number, number, number] = grass ? [0.1 + 0.05 * k, 0.12 + 0.04 * k, 0.045] : [0.022 + 0.015 * k, 0.045 + 0.02 * k, 0.016];
  return mat(WALL_FOLIAGE, c, grass ? 0.1 : 0.7, 0);
}

/**
 * Ivy sheet hanging from `top` (a face point at the top of the wall) down the face: vertical strips with a ragged
 * lower edge, 0.1 m proud of the face (`faceAt(u, y)` gives the face point along the wall, for bulging faces).
 */
export function ivy(mb: MeshBuilder, faceAt: (du: number, y: number) => FacePoint, width: number, drop: number, yTop: number, seed: number, lod: number): void {
  // Two layers: a dense sheet against the wall and a looser outer layer.
  ivyLayer(mb, faceAt, width, drop, yTop, seed, lod, 0);
  if (lod === 0) {
    ivyLayer(mb, faceAt, width * 0.8, drop * 0.75, yTop + 0.15, seed + 7, lod, 1);
  }
}

function ivyLayer(mb: MeshBuilder, faceAt: (du: number, y: number) => FacePoint, width: number, drop: number, yTop: number, seed: number, lod: number, layer: number): void {
  const m = foliageMat(seed);
  const cols = Math.max(2, Math.round(width / (lod === 0 ? 0.6 : 1.5)));
  const bottom: number[] = [];
  for (let c = 0; c <= cols; c++) {
    const t = c / cols;
    const edge = Math.sin(Math.PI * t);
    bottom.push(yTop - drop * (0.25 + 0.75 * edge) * (0.6 + 0.4 * hash(seed, c)));
  }
  for (let c = 0; c < cols; c++) {
    const u0 = -width / 2 + (width * c) / cols;
    const u1 = -width / 2 + (width * (c + 1)) / cols;
    const rows = lod === 0 ? 3 : 1;
    for (let r = 0; r < rows; r++) {
      const ya0 = bottom[c] + ((yTop - bottom[c]) * r) / rows;
      const ya1 = bottom[c] + ((yTop - bottom[c]) * (r + 1)) / rows;
      const yb0 = bottom[c + 1] + ((yTop - bottom[c + 1]) * r) / rows;
      const yb1 = bottom[c + 1] + ((yTop - bottom[c + 1]) * (r + 1)) / rows;
      const p = (u: number, y: number): [V3, FacePoint] => {
        const f = faceAt(u, y);
        const o = 0.08 + 0.1 * hash(seed, Math.round(u * 10) + Math.round(y * 3) * 131) + layer * 0.22;
        return [[f.x + f.nx * o, y, f.z + f.nz * o], f];
      };
      const [A, fa] = p(u0, ya0);
      const [B] = p(u1, yb0);
      const [C] = p(u1, yb1);
      const [D] = p(u0, ya1);
      faceTo(mb, [A, B, C, D], [fa.u + u0, ya0, fa.u + u1, yb0, fa.u + u1, yb1, fa.u + u0, ya1], m, [fa.nx, 0, fa.nz]);
    }
  }
}

/** Fig / caper clump: leafy domes (cut-out leaves) around (x, y, z), leaning out of the wall toward (nx, nz). */
export function shrub(mb: MeshBuilder, x: number, y: number, z: number, nx: number, nz: number, size: number, seed: number, lod: number): void {
  const m = foliageMat(seed);
  const n = lod === 0 ? 9 : 2;
  for (let b = 0; b < n; b++) {
    const r = size * (0.3 + 0.3 * hash(seed, 10 + b));
    const ox = (hash(seed, 20 + b) - 0.5) * size + nx * size * 0.4 * hash(seed, 30 + b);
    const oz = (hash(seed, 40 + b) - 0.5) * size + nz * size * 0.4 * hash(seed, 30 + b);
    const yy = y + b * size * 0.15;
    lathe(mb, x + ox, z + oz, [[r * 0.6, yy - r * 0.2], [r, yy + r * 0.4], [r * 0.8, yy + r * 0.9], [0, yy + r * 1.15]], m, { seg: lod === 0 ? 8 : 5, phase: hash(seed, 50 + b) * 6 });
  }
}

/** Grass tuft: two crossed cards 0.35-0.55 m tall. */
export function tuft(mb: MeshBuilder, x: number, y: number, z: number, seed: number): void {
  const m = foliageMat(seed, true);
  const h = 0.35 + 0.25 * hash(seed, 1);
  const w = 0.5 + 0.3 * hash(seed, 2);
  const a = hash(seed, 3) * Math.PI;
  for (const t of [a, a + Math.PI / 2]) {
    const cx = Math.cos(t) * w * 0.5;
    const cz = Math.sin(t) * w * 0.5;
    const pts: V3[] = [
      [x - cx, y - 0.05, z - cz],
      [x + cx, y - 0.05, z + cz],
      [x + cx, y + h, z + cz],
      [x - cx, y + h, z - cz],
    ];
    const n: V3 = [-Math.sin(t), 0.2, Math.cos(t)];
    faceTo(mb, pts, [0, 0, w, 0, w, h, 0, h], m, n);
    faceTo(mb, pts, [0, 0, w, 0, w, h, 0, h], m, [-n[0], 0.2, -n[2]]);
  }
}

/* ------------------------------------------------------------------ chipped corners */

/** Cuts every corner of a ring by `cut(i)` metres along both edges (worn, chipped tower arrises). */
export function chamfer(ring: readonly V2[], cut: (i: number) => number): V2[] {
  const out: V2[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const a = ring[(i - 1 + n) % n];
    const b = ring[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const c = Math.min(cut(i), la * 0.3, lb * 0.3);
    if (c < 0.02) {
      out.push(p);
      continue;
    }
    out.push([p[0] + ((a[0] - p[0]) / la) * c, p[1] + ((a[1] - p[1]) / la) * c]);
    out.push([p[0] + ((b[0] - p[0]) / lb) * c, p[1] + ((b[1] - p[1]) / lb) * c]);
  }
  return out;
}
