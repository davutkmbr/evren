/**
 * The draped ground mesh (carriageways, raised sidewalks with real kerb steps, squares and back lots in one
 * material): the shared GroundGrid (plus the quay raise, StreetSurface.baseAt) triangulated at GROUND_STEP, minus
 * parks / forests / cemeteries away from streets and paths, and landmark pads on land (pads.ts). Cells crossed by a carriageway edge
 * are refined to the 1 m street raster and cut along the edge (marching triangles on the same bilinear field the
 * ground shader reads): the carriageway side stays at grid height, the other side is raised by the kerb lift
 * (StreetSurface.liftAt) and a vertical kerb face joins them. Kerb faces are the only vertical triangles, which is
 * how the ground shader recognises them. Every triangle is clipped at the quay edge (coast distance QUAY_EDGE); the
 * cut segments are returned for the quay walls (masonry.ts).
 */
import { LandUse } from '../../../core/contracts';
import { MeshBuf } from '../shared/buffers';
import { GROUND_STEP } from '../shared/ground';
import { Ground, PATH_RANGE, decodeSigned } from '../shared/street-field';
import { QUAY_EDGE, type StreetSurface } from '../shared/street-surface';
import type { PadTest } from './pads';

const NO_GROUND_USE = new Set<number>([LandUse.Park, LandUse.Forest, LandUse.Cemetery]);
const KEEP_GROUND = new Set<number>([Ground.Plaza, Ground.Parking, Ground.Platform, Ground.Quay, Ground.Worship]);
/** Raster byte of distance 0 (signed distance code, street-field.ts encodeSigned). */
const ZERO = 127.5;

export interface GroundMeshStats {
  cells: number;
  refined: number;
  kerbFaces: number;
  quaySegments: number;
  /** Lift / quay grid preparation and triangulation time (ms). */
  prepMs: number;
  meshMs: number;
}

export function buildGroundMesh(surface: StreetSurface, padded: PadTest): { mesh: MeshBuf; stats: GroundMeshStats; quay: number[] } {
  const tStart = performance.now();
  const { ground, geo, raster } = surface;
  const lift = surface.liftGridValues();
  const mesh = new MeshBuf({ position: 3, normal: 3 });
  const nx = ground.nx;
  const nz = ground.nz;
  const step = Math.round(GROUND_STEP / raster.px);
  const px = raster.px;
  const rw = raster.w;
  const rgba = raster.rgba;
  // Ground vertex (i, j) sits on texel (oi + i step, oj + j step).
  const oi = Math.round((ground.x0 - raster.minX) / px - 0.5);
  const oj = Math.round((ground.z0 - raster.minZ) / px - 0.5);
  const stats: GroundMeshStats = { cells: 0, refined: 0, kerbFaces: 0, quaySegments: 0, prepMs: 0, meshMs: 0 };

  // Base heights (terrain grid + quay raise) and their smooth normals.
  const quayLift = surface.quayGridValues();
  stats.prepMs = Math.round(performance.now() - tStart);
  const yb = new Float32Array(nx * nz);
  for (let k = 0; k < yb.length; k++) {
    yb[k] = ground.y[k] + quayLift[k];
  }
  const coarseIds = new Int32Array(nx * nz * 2).fill(-1);
  const normals = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(nx - 1, i + 1);
      const j0 = Math.max(0, j - 1);
      const j1 = Math.min(nz - 1, j + 1);
      const gx = (yb[j * nx + i1] - yb[j * nx + i0]) / ((i1 - i0) * GROUND_STEP);
      const gz = (yb[j1 * nx + i] - yb[j0 * nx + i]) / ((j1 - j0) * GROUND_STEP);
      const l = Math.hypot(gx, 1, gz);
      normals.set([-gx / l, 1 / l, -gz / l], (j * nx + i) * 3);
    }
  }
  const coarse = (i: number, j: number, up: boolean): number => {
    const k = j * nx + i;
    const slot = k * 2 + (up ? 1 : 0);
    if (coarseIds[slot] < 0) {
      const n = k * 3;
      coarseIds[slot] = mesh.vertex(ground.x0 + i * GROUND_STEP, yb[k] + (up ? lift[k] : 0), ground.z0 + j * GROUND_STEP, normals[n], normals[n + 1], normals[n + 2]);
    }
    return coarseIds[slot];
  };

  // Quay clipping: coast distance per vertex (lazy), shared cut vertices per edge, cut segments for the walls.
  let vCoast = new Float32Array(1 << 20).fill(NaN);
  const coastOf = (v: number): number => {
    if (v >= vCoast.length) {
      const next = new Float32Array(Math.max(vCoast.length * 2, v + 1)).fill(NaN);
      next.set(vCoast);
      vCoast = next;
    }
    let c = vCoast[v];
    if (c !== c) {
      const p = mesh.attrs.position.buf.array;
      c = geo.coast(p[v * 3], p[v * 3 + 2]);
      vCoast[v] = c;
    }
    return c;
  };
  const edgeCuts = new Map<number, number>();
  const cutEdge = (p: number, q: number): number => {
    const lo = Math.min(p, q);
    const hi = Math.max(p, q);
    const key = lo * 4194304 + hi;
    let id = edgeCuts.get(key);
    if (id === undefined) {
      const cl = coastOf(lo);
      const t = (QUAY_EDGE - cl) / (coastOf(hi) - cl);
      const a = mesh.attrs.position.buf.array;
      const n = mesh.attrs.normal.buf.array;
      const lerp = (arr: Float32Array, c: number): number => arr[lo * 3 + c] + (arr[hi * 3 + c] - arr[lo * 3 + c]) * t;
      const nx0 = lerp(n, 0);
      const ny0 = lerp(n, 1);
      const nz0 = lerp(n, 2);
      const nl = Math.hypot(nx0, ny0, nz0) || 1;
      id = mesh.vertex(lerp(a, 0), lerp(a, 1), lerp(a, 2), nx0 / nl, ny0 / nl, nz0 / nl);
      coastOf(id);
      vCoast[id] = QUAY_EDGE;
      edgeCuts.set(key, id);
    }
    return id;
  };
  const quay: number[] = [];
  /** Emits triangle a, b, c (already wound up-facing) clipped to the land side of the quay edge. */
  const landTri = (a: number, b: number, c: number): void => {
    const ca = coastOf(a) >= QUAY_EDGE;
    const cb = coastOf(b) >= QUAY_EDGE;
    const cc = coastOf(c) >= QUAY_EDGE;
    if (ca && cb && cc) {
      mesh.tri(a, b, c);
      return;
    }
    if (!ca && !cb && !cc) {
      return;
    }
    // Rotate so that `a` is the odd vertex out.
    let [p, q, r, lp] = [a, b, c, ca];
    if (cb !== ca && cb !== cc) {
      [p, q, r, lp] = [b, c, a, cb];
    } else if (cc !== ca && cc !== cb) {
      [p, q, r, lp] = [c, a, b, cc];
    }
    const pq = cutEdge(p, q);
    const pr = cutEdge(p, r);
    if (lp) {
      mesh.tri(p, pq, pr);
    } else {
      mesh.tri(pq, q, r);
      mesh.tri(pq, r, pr);
    }
    const pos = mesh.attrs.position.buf.array;
    quay.push(pos[pq * 3], pos[pq * 3 + 1], pos[pq * 3 + 2], pos[pr * 3], pos[pr * 3 + 1], pos[pr * 3 + 2]);
    stats.quaySegments++;
  };
  const byteAt = (ti: number, tj: number): number => rgba[(tj * rw + ti) * 4];

  /** Smooth normal at a point of coarse cell (ci, cj) with local fractions (u, v). */
  const cellNormal = (ci: number, cj: number, u: number, v: number, out: [number, number, number]): void => {
    const a = (cj * nx + ci) * 3;
    const b = a + 3;
    const c = a + nx * 3;
    const d = c + 3;
    for (let q = 0; q < 3; q++) {
      out[q] = (normals[a + q] * (1 - u) + normals[b + q] * u) * (1 - v) + (normals[c + q] * (1 - u) + normals[d + q] * u) * v;
    }
    const l = Math.hypot(out[0], out[1], out[2]) || 1;
    out[0] /= l;
    out[1] /= l;
    out[2] /= l;
  };

  // Refined-cell vertex caches (cleared per cell; cell borders are shared through consistent heights, not ids).
  // Per-cell caches with generation stamps (no clearing): lattice vertices (L^2 x low/high) and edge cuts.
  const L0 = step + 1;
  const fineStamp = new Int32Array(L0 * L0 * 2);
  const fineVal = new Int32Array(L0 * L0 * 2);
  const cutStamp = new Int32Array(L0 * L0 * L0 * L0 * 2);
  const cutVal = new Int32Array(L0 * L0 * L0 * L0 * 2);
  let gen = 0;
  const latBytes = new Float32Array(L0 * L0);
  const tmpN: [number, number, number] = [0, 1, 0];

  const emitTri = (a: number, b: number, c: number): void => {
    const pa = a * 3;
    const pb = b * 3;
    const pc = c * 3;
    const p = mesh.attrs.position.buf.array;
    const cross = (p[pb + 2] - p[pa + 2]) * (p[pc] - p[pa]) - (p[pb] - p[pa]) * (p[pc + 2] - p[pa + 2]);
    if (cross >= 0) {
      landTri(a, b, c);
    } else {
      landTri(a, c, b);
    }
  };

  const refine = (ci: number, cj: number): void => {
    gen++;
    const x0 = ground.x0 + ci * GROUND_STEP;
    const z0 = ground.z0 + cj * GROUND_STEP;
    const ti0 = oi + ci * step;
    const tj0 = oj + cj * step;
    // Local lattice (step + 1)^2 of bytes.
    const L = L0;
    const bytes = latBytes;
    for (let b = 0; b < L; b++) {
      for (let a = 0; a < L; a++) {
        bytes[b * L + a] = byteAt(ti0 + a, tj0 + b);
      }
    }
    const latVertex = (a: number, b: number): number => {
      const up = bytes[b * L + a] > ZERO;
      const key = (b * L + a) * 2 + (up ? 1 : 0);
      if (fineStamp[key] !== gen) {
        const x = x0 + a * px;
        const z = z0 + b * px;
        cellNormal(ci, cj, a / step, b / step, tmpN);
        fineVal[key] = mesh.vertex(x, surface.baseAt(x, z) + (up ? surface.liftAt(x, z) : 0), z, tmpN[0], tmpN[1], tmpN[2]);
        fineStamp[key] = gen;
      }
      return fineVal[key];
    };
    /** Low / high vertex where the edge between lattice points p and q crosses the carriageway edge. */
    const cutVertex = (p: number, q: number, up: boolean): number => {
      const lo = Math.min(p, q);
      const hi = Math.max(p, q);
      const key = (lo * L * L + hi) * 2 + (up ? 1 : 0);
      if (cutStamp[key] !== gen) {
        const bp = bytes[lo];
        const bq = bytes[hi];
        const t = (ZERO - bp) / (bq - bp);
        const xa = x0 + (lo % L) * px;
        const za = z0 + Math.floor(lo / L) * px;
        const xb = x0 + (hi % L) * px;
        const zb = z0 + Math.floor(hi / L) * px;
        const x = xa + (xb - xa) * t;
        const z = za + (zb - za) * t;
        cellNormal(ci, cj, (x - x0) / GROUND_STEP, (z - z0) / GROUND_STEP, tmpN);
        cutVal[key] = mesh.vertex(x, surface.baseAt(x, z) + (up ? surface.liftAt(x, z) : 0), z, tmpN[0], tmpN[1], tmpN[2]);
        cutStamp[key] = gen;
      }
      return cutVal[key];
    };
    const pos = mesh.attrs.position.buf;
    const face = (pl: number, ql: number, qh: number, ph: number, inside: number): void => {
      // Vertical kerb face between the low (carriageway) and high (raised) contour vertices, facing the carriageway.
      const p = pos.array;
      const ax = p[pl * 3];
      const az = p[pl * 3 + 2];
      const bx = p[ql * 3];
      const bz = p[ql * 3 + 2];
      let fx = bz - az;
      let fz = -(bx - ax);
      const l = Math.hypot(fx, fz);
      if (l < 1e-4 || Math.abs(p[ph * 3 + 1] - p[pl * 3 + 1]) + Math.abs(p[qh * 3 + 1] - p[ql * 3 + 1]) < 0.004) {
        return;
      }
      fx /= l;
      fz /= l;
      // Orient towards the lattice point on the carriageway side.
      const ix = x0 + (inside % L) * px;
      const iz = z0 + Math.floor(inside / L) * px;
      if ((ix - ax) * fx + (iz - az) * fz < 0) {
        fx = -fx;
        fz = -fz;
      }
      if (geo.coast(ax, az) < QUAY_EDGE || geo.coast(bx, bz) < QUAY_EDGE) {
        return;
      }
      const v0 = mesh.vertex(ax, p[pl * 3 + 1], az, fx, 0, fz);
      const v1 = mesh.vertex(bx, p[ql * 3 + 1], bz, fx, 0, fz);
      const v2 = mesh.vertex(bx, p[qh * 3 + 1], bz, fx, 0, fz);
      const v3 = mesh.vertex(ax, p[ph * 3 + 1], az, fx, 0, fz);
      // (v0, v1, v2) winds around (-(bz - az), 0, bx - ax): keep it when that is the face normal.
      if ((az - bz) * fx + (bx - ax) * fz > 0) {
        mesh.tri(v0, v1, v2);
        mesh.tri(v0, v2, v3);
      } else {
        mesh.tri(v0, v2, v1);
        mesh.tri(v0, v3, v2);
      }
      stats.kerbFaces++;
    };
    const tri = (p: number, q: number, r: number, pa: number, pb: number, qa: number, qb: number, ra: number, rb: number): void => {
      const sp = bytes[p] > ZERO;
      const sq = bytes[q] > ZERO;
      const sr = bytes[r] > ZERO;
      const vp = latVertex(pa, pb);
      const vq = latVertex(qa, qb);
      const vr = latVertex(ra, rb);
      if (sp === sq && sq === sr) {
        emitTri(vp, vq, vr);
        return;
      }
      // Rotate so that `a` is the odd vertex out.
      let a = p;
      let b = q;
      let c = r;
      let va = vp;
      let vb = vq;
      let vc = vr;
      if (sq !== sp && sq !== sr) {
        [a, b, c, va, vb, vc] = [q, r, p, vq, vr, vp];
      } else if (sr !== sp && sr !== sq) {
        [a, b, c, va, vb, vc] = [r, p, q, vr, vp, vq];
      }
      const upA = bytes[a] > ZERO;
      const abA = cutVertex(a, b, upA);
      const acA = cutVertex(a, c, upA);
      const abB = cutVertex(a, b, !upA);
      const acB = cutVertex(a, c, !upA);
      emitTri(va, abA, acA);
      emitTri(vb, vc, acB);
      emitTri(vb, acB, abB);
      const inside = upA ? b : a;
      const lowAB = upA ? abB : abA;
      const lowAC = upA ? acB : acA;
      const highAB = upA ? abA : abB;
      const highAC = upA ? acA : acB;
      face(lowAB, lowAC, highAC, highAB, inside);
    };
    for (let b = 0; b < step; b++) {
      for (let a = 0; a < step; a++) {
        const i00 = b * L + a;
        const i10 = i00 + 1;
        const i01 = i00 + L;
        const i11 = i01 + 1;
        // Same diagonal as GroundGrid.yAt(): (i+1, j)-(i, j+1).
        tri(i00, i01, i10, a, b, a, b + 1, a + 1, b);
        tri(i10, i01, i11, a + 1, b, a, b + 1, a + 1, b + 1);
      }
    }
  };

  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const cx = ground.x0 + (i + 0.5) * GROUND_STEP;
      const cz = ground.z0 + (j + 0.5) * GROUND_STEP;
      const x0 = ground.x0 + i * GROUND_STEP;
      const z0 = ground.z0 + j * GROUND_STEP;
      const x1 = x0 + GROUND_STEP;
      const z1 = z0 + GROUND_STEP;
      if (Math.max(geo.coast(x0, z0), geo.coast(x1, z0), geo.coast(x0, z1), geo.coast(x1, z1)) < QUAY_EDGE) {
        continue;
      }
      const street = surface.distance(cx, cz) < 4 || decodeSigned(rgba[((oj + j * step + 2) * rw + oi + i * step + 2) * 4 + 3], PATH_RANGE) < 1.5;
      if (!street && !KEEP_GROUND.has(surface.groundAt(cx, cz)) && (NO_GROUND_USE.has(geo.landUse(cx, cz)) || padded(cx, cz))) {
        continue;
      }
      stats.cells++;
      // Refine when the carriageway edge crosses the cell and the ground next to it is raised.
      const ti0 = oi + i * step;
      const tj0 = oj + j * step;
      let anyIn = false;
      let anyOut = false;
      for (let b = 0; b <= step && !(anyIn && anyOut); b++) {
        for (let a = 0; a <= step; a++) {
          if (byteAt(ti0 + a, tj0 + b) > ZERO) {
            anyOut = true;
          } else {
            anyIn = true;
          }
        }
      }
      const k = j * nx + i;
      const maxLift = Math.max(lift[k], lift[k + 1], lift[k + nx], lift[k + nx + 1]);
      if (anyIn && anyOut && maxLift > 0.004) {
        stats.refined++;
        refine(i, j);
        continue;
      }
      const a = coarse(i, j, byteAt(ti0, tj0) > ZERO);
      const b = coarse(i + 1, j, byteAt(ti0 + step, tj0) > ZERO);
      const c = coarse(i, j + 1, byteAt(ti0, tj0 + step) > ZERO);
      const d = coarse(i + 1, j + 1, byteAt(ti0 + step, tj0 + step) > ZERO);
      landTri(a, c, b);
      landTri(b, c, d);
    }
  }
  stats.meshMs = Math.round(performance.now() - tStart) - stats.prepMs;
  return { mesh, stats, quay };
}
