/**
 * Small geometry helpers for procedural street kit (props and tile geometry), all emitted through TileMesh.addMesh
 * in world / prop metres: oriented boxes (flat faces), cylinders and cones (smooth sides, flat caps), ellipsoids,
 * tubes along polylines (cables, rails) and lathed profiles.
 */
import type { MaterialName } from '../materials';
import type { TileMesh, Vec3 } from '../mesh';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Box with centre c, unit axes (u, v, w) and half extents (hu, hv, hw); flat normals. */
export function obox(mesh: TileMesh, m: MaterialName, c: Vec3, u: Vec3, v: Vec3, w: Vec3, hu: number, hv: number, hw: number, lod?: number): void {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const faces: [Vec3, Vec3, Vec3, number, number, number][] = [
    [u, v, w, hu, hv, hw],
    [mul(u, -1), w, v, hu, hw, hv],
    [v, w, u, hv, hw, hu],
    [mul(v, -1), u, w, hv, hu, hw],
    [w, u, v, hw, hu, hv],
    [mul(w, -1), v, u, hw, hv, hu],
  ];
  for (const [n, a, b, hn, ha, hb] of faces) {
    const base = pos.length / 3;
    const fc = add(c, mul(n, hn));
    for (const [sa, sb] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const p = add(add(fc, mul(a, sa * ha)), mul(b, sb * hb));
      pos.push(...p);
      nrm.push(...n);
    }
    // Wind so the front face matches n.
    const e1 = mul(a, 2 * ha);
    const e2 = mul(b, 2 * hb);
    const d = cross(e1, e2);
    if (d[0] * n[0] + d[1] * n[1] + d[2] * n[2] >= 0) {
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  mesh.addMesh(m, { positions: pos, indices: idx, normals: nrm, ...(lod !== undefined ? { lod } : {}) });
}

/** Axis-aligned box from min to max (all six faces). */
export function aabox(mesh: TileMesh, m: MaterialName, min: Vec3, max: Vec3): void {
  const c: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  obox(mesh, m, c, [1, 0, 0], [0, 1, 0], [0, 0, 1], (max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2);
}

/** Box along a segment a -> b with a square / rectangular section (width across `side`, height along `up`). */
export function beam(mesh: TileMesh, m: MaterialName, a: Vec3, b: Vec3, width: number, height: number, up: Vec3 = [0, 1, 0]): void {
  const d = sub(b, a);
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) {
    return;
  }
  const w = mul(d, 1 / len);
  let side = cross(up, w);
  if (Math.hypot(side[0], side[1], side[2]) < 1e-6) {
    side = cross([1, 0, 0], w);
  }
  side = norm(side);
  const v = norm(cross(w, side));
  obox(mesh, m, mul(add(a, b), 0.5), side, v, w, width / 2, height / 2, len / 2);
}

/**
 * Surface of revolution about the vertical axis through (cx, cz): profile [radius, y] from bottom to top, `seg`
 * sides; smooth normals along the profile (hard edges: repeat a profile point). Caps close rings of radius > 0 at the
 * ends when `caps` is set.
 */
export function lathe(mesh: TileMesh, m: MaterialName, cx: number, y0: number, cz: number, profile: [number, number][], seg: number, caps = true, rz = 1): void {
  const pos: number[] = [];
  const idx: number[] = [];
  const nrm: number[] = [];
  const rows = profile.length;
  for (let r = 0; r < rows; r++) {
    const [rad, y] = profile[r];
    // Profile normal from the neighbouring points (2D: dr, dy -> normal (dy, -dr)).
    const p0 = profile[Math.max(0, r - 1)];
    const p1 = profile[Math.min(rows - 1, r + 1)];
    let nr = p1[1] - p0[1];
    let ny = -(p1[0] - p0[0]);
    const l = Math.hypot(nr, ny) || 1;
    nr /= l;
    ny /= l;
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pos.push(cx + ca * rad, y0 + y, cz + sa * rad * rz);
      nrm.push(ca * nr, ny, sa * nr);
    }
  }
  for (let r = 0; r + 1 < rows; r++) {
    for (let k = 0; k < seg; k++) {
      const a = r * seg + k;
      const b = r * seg + ((k + 1) % seg);
      const c = a + seg;
      const d = b + seg;
      idx.push(a, c, b, b, c, d);
    }
  }
  mesh.addMesh(m, { positions: pos, indices: idx, normals: nrm });
  if (caps) {
    for (const [end, up] of [
      [0, -1],
      [rows - 1, 1],
    ] as const) {
      const [rad, y] = profile[end];
      if (rad < 1e-4) {
        continue;
      }
      const pts: Vec3[] = [];
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        pts.push([cx + Math.cos(a) * rad, y0 + y, cz + Math.sin(a) * rad * rz]);
      }
      const tris: number[] = [];
      for (let k = 1; k + 1 < seg; k++) {
        tris.push(0, k, k + 1);
      }
      mesh.flatTriangles(m, pts, tris, [0, up, 0]);
    }
  }
}

/** Vertical cylinder with flat caps. */
export function cylinder(mesh: TileMesh, m: MaterialName, cx: number, cz: number, y0: number, y1: number, r: number, seg = 12, caps = true): void {
  lathe(mesh, m, cx, y0, cz, [
    [r, 0],
    [r, y1 - y0],
  ], seg, caps);
}

/** Ellipsoid (UV sphere) centred at c with radii rx, ry, rz. */
export function ellipsoid(mesh: TileMesh, m: MaterialName, c: Vec3, rx: number, ry: number, rz: number, seg = 10, rings = 6): void {
  const profile: [number, number][] = [];
  for (let r = 0; r <= rings; r++) {
    const a = -Math.PI / 2 + (r / rings) * Math.PI;
    profile.push([Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  lathe(mesh, m, c[0], c[1], c[2], profile, seg, false, rz / rx);
}

/** Tube with an n-gon section along a polyline of 3D points (cables, rails, rods). */
export function tube(mesh: TileMesh, m: MaterialName, pts: readonly Vec3[], r: number, sides = 4, lod?: number): void {
  if (pts.length < 2) {
    return;
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const t = norm(sub(next, prev));
    let s = cross([0, 1, 0], t);
    if (Math.hypot(s[0], s[1], s[2]) < 1e-6) {
      s = cross([1, 0, 0], t);
    }
    s = norm(s);
    const u = norm(cross(t, s));
    for (let k = 0; k < sides; k++) {
      const a = ((k + 0.5) / sides) * Math.PI * 2;
      const n = add(mul(s, Math.cos(a)), mul(u, Math.sin(a)));
      pos.push(...add(pts[i], mul(n, r)));
      nrm.push(...n);
    }
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    for (let k = 0; k < sides; k++) {
      const a = i * sides + k;
      const b = i * sides + ((k + 1) % sides);
      const c = a + sides;
      const d = b + sides;
      idx.push(a, b, c, b, d, c);
    }
  }
  // Fix the winding per triangle so the faces point outwards (along the vertex normals).
  for (let q = 0; q < idx.length; q += 3) {
    const [i, j, k] = [idx[q], idx[q + 1], idx[q + 2]];
    const e1: Vec3 = [pos[j * 3] - pos[i * 3], pos[j * 3 + 1] - pos[i * 3 + 1], pos[j * 3 + 2] - pos[i * 3 + 2]];
    const e2: Vec3 = [pos[k * 3] - pos[i * 3], pos[k * 3 + 1] - pos[i * 3 + 1], pos[k * 3 + 2] - pos[i * 3 + 2]];
    const f = cross(e1, e2);
    if (f[0] * nrm[i * 3] + f[1] * nrm[i * 3 + 1] + f[2] * nrm[i * 3 + 2] < 0) {
      idx[q + 1] = k;
      idx[q + 2] = j;
    }
  }
  mesh.addMesh(m, { positions: pos, indices: idx, normals: nrm, ...(lod !== undefined ? { lod } : {}) });
}

/** Points of a hanging cable (parabolic sag) between a and b. */
export function sagLine(a: Vec3, b: Vec3, sag: number, n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f - 4 * sag * f * (1 - f), a[2] + (b[2] - a[2]) * f]);
  }
  return out;
}

export { add, cross, mul, norm, sub };
