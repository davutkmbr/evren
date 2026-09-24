/**
 * Geometry helpers of the soul lane (prop and tile geometry through TileMesh.addMesh): tapered tubes (tails, necks,
 * hoses), cones (ears, bills), tori (simit rings, tyres, coiled hoses), discs and rings on any axis (wheels, plates),
 * and small curved patches wrapped round a vertical cylinder (stickers on poles). The street lane's shapes.ts covers
 * boxes, lathes, ellipsoids and plain tubes.
 */
import type { MaterialName } from '../materials';
import type { RGBA, TileMesh, Vec3 } from '../mesh';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Two unit vectors perpendicular to `axis` (and to each other). */
function basis(axis: Vec3): [Vec3, Vec3] {
  const a = norm(axis);
  let s = cross(Math.abs(a[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0], a);
  s = norm(s);
  return [s, norm(cross(a, s))];
}

/** Tube along a polyline whose radius runs linearly from r0 to r1 (closed round end at the tip when r1 is 0). */
export function taperTube(mesh: TileMesh, m: MaterialName, pts: readonly Vec3[], r0: number, r1: number, sides = 6): void {
  if (pts.length < 2) {
    return;
  }
  let total = 0;
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(...sub(pts[i], pts[i - 1]));
    acc.push(total);
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  let prevS: Vec3 | null = null;
  for (let i = 0; i < pts.length; i++) {
    const t = norm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
    // Parallel transport of the section frame keeps the tube from twisting.
    let s: Vec3 = prevS ? norm(sub(prevS, [t[0] * (prevS[0] * t[0] + prevS[1] * t[1] + prevS[2] * t[2]), t[1] * (prevS[0] * t[0] + prevS[1] * t[1] + prevS[2] * t[2]), t[2] * (prevS[0] * t[0] + prevS[1] * t[1] + prevS[2] * t[2])])) : basis(t)[0];
    if (!Number.isFinite(s[0]) || Math.hypot(...s) < 0.5) {
      s = basis(t)[0];
    }
    prevS = s;
    const u = norm(cross(t, s));
    const r = Math.max(1e-4, r0 + (r1 - r0) * (acc[i] / (total || 1)));
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const n: Vec3 = [s[0] * Math.cos(a) + u[0] * Math.sin(a), s[1] * Math.cos(a) + u[1] * Math.sin(a), s[2] * Math.cos(a) + u[2] * Math.sin(a)];
      pos.push(pts[i][0] + n[0] * r, pts[i][1] + n[1] * r, pts[i][2] + n[2] * r);
      nrm.push(...n);
    }
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    for (let k = 0; k < sides; k++) {
      const a = i * sides + k;
      const b = i * sides + ((k + 1) % sides);
      idx.push(a, a + sides, b, b, a + sides, b + sides);
    }
  }
  fixWinding(pos, nrm, idx);
  // End caps (fans), so short stubs do not show holes.
  for (const [i, dir] of [
    [0, -1],
    [pts.length - 1, 1],
  ] as const) {
    const t = norm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
    const c = pos.length / 3;
    pos.push(...pts[i]);
    nrm.push(t[0] * dir, t[1] * dir, t[2] * dir);
    for (let k = 0; k < sides; k++) {
      const a = i * sides + k;
      const b = i * sides + ((k + 1) % sides);
      idx.push(c, a, b);
    }
  }
  fixWinding(pos, nrm, idx, idx.length - sides * 6);
  mesh.addMesh(m, { positions: pos, indices: idx, normals: nrm });
}

/** Cone from a base disc (centre, radius) to a tip, with `sides` faces and a closed base. */
export function cone(mesh: TileMesh, m: MaterialName, base: Vec3, tip: Vec3, r: number, sides = 6, squash = 1): void {
  const ax = sub(tip, base);
  const [s, u] = basis(ax);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * Math.PI * 2;
    pos.push(base[0] + (s[0] * Math.cos(a) + u[0] * Math.sin(a) * squash) * r, base[1] + (s[1] * Math.cos(a) + u[1] * Math.sin(a) * squash) * r, base[2] + (s[2] * Math.cos(a) + u[2] * Math.sin(a) * squash) * r);
  }
  pos.push(...tip, ...base);
  const ti = sides;
  const bi = sides + 1;
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    idx.push(k, k1, ti, k1, k, bi);
  }
  outward(pos, idx, [(base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2, (base[2] + tip[2]) / 2]);
  mesh.addMesh(m, { positions: pos, indices: idx });
}

/** Torus about `axis` through `c`: ring radius R, tube radius r (simit rings, tyres, hose coils). */
export function torus(mesh: TileMesh, m: MaterialName, c: Vec3, axis: Vec3, R: number, r: number, seg = 16, sides = 6, rScaleAxis = 1): void {
  const a = norm(axis);
  const [s, u] = basis(a);
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    const dir: Vec3 = [s[0] * Math.cos(t) + u[0] * Math.sin(t), s[1] * Math.cos(t) + u[1] * Math.sin(t), s[2] * Math.cos(t) + u[2] * Math.sin(t)];
    for (let k = 0; k < sides; k++) {
      const q = (k / sides) * Math.PI * 2;
      const n: Vec3 = [dir[0] * Math.cos(q) + a[0] * Math.sin(q), dir[1] * Math.cos(q) + a[1] * Math.sin(q), dir[2] * Math.cos(q) + a[2] * Math.sin(q)];
      const rr = r;
      pos.push(c[0] + dir[0] * (R + Math.cos(q) * rr) + a[0] * Math.sin(q) * rr * rScaleAxis, c[1] + dir[1] * (R + Math.cos(q) * rr) + a[1] * Math.sin(q) * rr * rScaleAxis, c[2] + dir[2] * (R + Math.cos(q) * rr) + a[2] * Math.sin(q) * rr * rScaleAxis);
      nrm.push(...n);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let k = 0; k < sides; k++) {
      const p0 = i * sides + k;
      const p1 = i * sides + ((k + 1) % sides);
      const q0 = ((i + 1) % seg) * sides + k;
      const q1 = ((i + 1) % seg) * sides + ((k + 1) % sides);
      idx.push(p0, q0, p1, p1, q0, q1);
    }
  }
  fixWinding(pos, nrm, idx);
  mesh.addMesh(m, { positions: pos, indices: idx, normals: nrm });
}

/** Cylinder on any axis from a to b (wheels, rods, jars), closed ends. */
export function cylinderAxis(mesh: TileMesh, m: MaterialName, a: Vec3, b: Vec3, r: number, sides = 10, caps = true): void {
  const ax = sub(b, a);
  const [s, u] = basis(ax);
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  for (const p of [a, b]) {
    for (let k = 0; k < sides; k++) {
      const q = (k / sides) * Math.PI * 2;
      const n: Vec3 = [s[0] * Math.cos(q) + u[0] * Math.sin(q), s[1] * Math.cos(q) + u[1] * Math.sin(q), s[2] * Math.cos(q) + u[2] * Math.sin(q)];
      pos.push(p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r);
      nrm.push(...n);
    }
  }
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    idx.push(k, k1, sides + k, k1, sides + k1, sides + k);
  }
  fixWinding(pos, nrm, idx);
  mesh.addMesh(m, { positions: pos, indices: idx, normals: nrm });
  if (caps) {
    const t = norm(ax);
    for (const [p, dir] of [
      [a, -1],
      [b, 1],
    ] as const) {
      const cp: number[] = [];
      const ci: number[] = [];
      for (let k = 0; k < sides; k++) {
        const q = (k / sides) * Math.PI * 2;
        cp.push(p[0] + (s[0] * Math.cos(q) + u[0] * Math.sin(q)) * r, p[1] + (s[1] * Math.cos(q) + u[1] * Math.sin(q)) * r, p[2] + (s[2] * Math.cos(q) + u[2] * Math.sin(q)) * r);
      }
      for (let k = 1; k + 1 < sides; k++) {
        ci.push(0, k, k + 1);
      }
      const n: Vec3 = [t[0] * dir, t[1] * dir, t[2] * dir];
      const cn = new Array<number>(sides * 3);
      for (let k = 0; k < sides; k++) {
        cn[k * 3] = n[0];
        cn[k * 3 + 1] = n[1];
        cn[k * 3 + 2] = n[2];
      }
      fixWinding(cp, cn, ci);
      mesh.addMesh(m, { positions: cp, indices: ci, normals: cn });
    }
  }
}

/** Swaps triangle windings so each face agrees with its vertex normals (from index `from`). */
function fixWinding(pos: number[], nrm: number[], idx: number[], from = 0): void {
  for (let q = from; q + 2 < idx.length; q += 3) {
    const [i, j, k] = [idx[q], idx[q + 1], idx[q + 2]];
    const e1: Vec3 = [pos[j * 3] - pos[i * 3], pos[j * 3 + 1] - pos[i * 3 + 1], pos[j * 3 + 2] - pos[i * 3 + 2]];
    const e2: Vec3 = [pos[k * 3] - pos[i * 3], pos[k * 3 + 1] - pos[i * 3 + 1], pos[k * 3 + 2] - pos[i * 3 + 2]];
    const f = cross(e1, e2);
    const n = [nrm[i * 3] + nrm[j * 3] + nrm[k * 3], nrm[i * 3 + 1] + nrm[j * 3 + 1] + nrm[k * 3 + 1], nrm[i * 3 + 2] + nrm[j * 3 + 2] + nrm[k * 3 + 2]];
    if (f[0] * n[0] + f[1] * n[1] + f[2] * n[2] < 0) {
      idx[q + 1] = k;
      idx[q + 2] = j;
    }
  }
}

/** Swaps triangle windings so faces point away from `c`. */
function outward(pos: number[], idx: number[], c: Vec3): void {
  for (let q = 0; q + 2 < idx.length; q += 3) {
    const [i, j, k] = [idx[q], idx[q + 1], idx[q + 2]];
    const e1: Vec3 = [pos[j * 3] - pos[i * 3], pos[j * 3 + 1] - pos[i * 3 + 1], pos[j * 3 + 2] - pos[i * 3 + 2]];
    const e2: Vec3 = [pos[k * 3] - pos[i * 3], pos[k * 3 + 1] - pos[i * 3 + 1], pos[k * 3 + 2] - pos[i * 3 + 2]];
    const f = cross(e1, e2);
    const m: Vec3 = [(pos[i * 3] + pos[j * 3] + pos[k * 3]) / 3 - c[0], (pos[i * 3 + 1] + pos[j * 3 + 1] + pos[k * 3 + 1]) / 3 - c[1], (pos[i * 3 + 2] + pos[j * 3 + 2] + pos[k * 3 + 2]) / 3 - c[2]];
    if (f[0] * m[0] + f[1] * m[1] + f[2] * m[2] < 0) {
      idx[q + 1] = k;
      idx[q + 2] = j;
    }
  }
}

/**
 * A patch wrapped round a vertical cylinder (axis through cx, cz; `r` = pole radius plus the decal offset), facing the
 * direction (cos ang, 0, sin ang), centred at height y: width w along the circumference, height h, turned by `rot`
 * (radians) in the surface. `cols` columns keep it on the curve. `jag` > 0 tears the top edge (moves its points down
 * by up to that fraction of h).
 */
export function wrapPatch(mesh: TileMesh, m: MaterialName, cx: number, cz: number, r: number, ang: number, y: number, w: number, h: number, rot: number, color: RGBA, cols = 3, jag = 0, seed = 0): void {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const rows = jag > 0 ? 2 : 1;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      let lu = (i / cols - 0.5) * w;
      let lv = (j / rows - 0.5) * h;
      if (jag > 0 && j === rows) {
        const s = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
        lv -= (s - Math.floor(s)) * jag * h;
      }
      const su = lu * cr - lv * sr;
      const sv = lu * sr + lv * cr;
      lu = su;
      lv = sv;
      const a = ang + lu / r;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      pos.push(cx + nx * r, y + lv, cz + nz * r);
      nrm.push(nx, 0, nz);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  fixWinding(pos, nrm, idx);
  mesh.addMesh(m, { positions: pos, indices: idx, normals: nrm, color });
}
