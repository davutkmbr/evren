/**
 * Market stall displays of the fish / produce end (props fac_stall_fish and fac_stall_produce, facade/props.ts), built
 * from the stall anatomy of the spec (section 3, "Fish stall", "Produce / deli") and the photos c10-day,
 * context/fish-stall-2, context/fish-stall-marmara, context/tursu-display:
 * - fish: a steel table whose top tilts from 1.0 m at the front edge to 1.3 m at the back, covered with a green
 *   artificial-grass mat that hangs over the front; large fish laid on their sides in herringbone rows up the slope
 *   with greens between them; a lower front shelf (0.86 m) of white EPS crates on crushed ice packed with small fish
 *   (hamsi, istavrit); yellow price tags on sticks; a hanging dial scale on a post; blue 220 L barrels and a tub;
 * - produce: wooden crates stepped up to 1.2 m, each heaped with one kind of fruit or vegetable (3D low-poly items),
 *   price tags, and strings of dried peppers, aubergines and garlic 1–1.6 m long hanging from a rail at 2.3 m;
 * - deli: the same crates with olives, cheese wheels and pickles, and a wall of pickle jars behind.
 *
 * Props carry no vertex colours, so each colour is a material (FACE PROP materials in facade/props.ts). Geometry is
 * accumulated per material in one Builder and flushed once per variant (one primitive per material).
 * Frame: metres, x along the stall front, +z towards the lane, foot at y 0 (the shop threshold).
 */
import type { MaterialName } from '../materials';
import type { TileMesh, Vec3 } from '../mesh';
import { Builder } from '../hero/kit';

/** Per-material builders of one variant. */
class Geo {
  private readonly b = new Map<MaterialName, Builder>();
  constructor(readonly mesh: TileMesh) {}
  of(m: MaterialName): Builder {
    let x = this.b.get(m);
    if (!x) {
      x = new Builder();
      this.b.set(m, x);
    }
    return x;
  }
  flush(): void {
    for (const [m, x] of this.b) {
      x.flush(this.mesh, m);
    }
    this.b.clear();
  }
}

/** Deterministic random stream. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Axis-aligned box (all six faces unless `noBottom`). */
function box(g: Geo, m: MaterialName, min: Vec3, max: Vec3, noBottom = true): void {
  const b = g.of(m);
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  b.flatQuad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0]);
  if (!noBottom) {
    b.flatQuad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
  }
  b.flatQuad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
  b.flatQuad([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1]);
  b.flatQuad([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0]);
  b.flatQuad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
}

/** Oriented ellipsoid: centre, three semi-axis vectors (their lengths are the radii). */
function ell(g: Geo, m: MaterialName, c: Vec3, ax: Vec3, ay: Vec3, az: Vec3, seg = 6, rings = 4): void {
  const b = g.of(m);
  const lx = Math.hypot(...ax) || 1;
  const ly = Math.hypot(...ay) || 1;
  const lz = Math.hypot(...az) || 1;
  const ids: number[][] = [];
  for (let r = 0; r <= rings; r++) {
    const phi = -Math.PI / 2 + (r / rings) * Math.PI;
    const row: number[] = [];
    for (let k = 0; k < seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const cx = Math.cos(phi) * Math.cos(th);
      const cy = Math.sin(phi);
      const cz = Math.cos(phi) * Math.sin(th);
      const p: Vec3 = [c[0] + ax[0] * cx + ay[0] * cy + az[0] * cz, c[1] + ax[1] * cx + ay[1] * cy + az[1] * cz, c[2] + ax[2] * cx + ay[2] * cy + az[2] * cz];
      // Normal of an ellipsoid: gradient in the axis frame.
      const nx = cx / lx;
      const ny = cy / ly;
      const nz = cz / lz;
      const n: Vec3 = [(ax[0] / lx) * nx + (ay[0] / ly) * ny + (az[0] / lz) * nz, (ax[1] / lx) * nx + (ay[1] / ly) * ny + (az[1] / lz) * nz, (ax[2] / lx) * nx + (ay[2] / ly) * ny + (az[2] / lz) * nz];
      row.push(b.v(p, n));
      if (r === 0 || r === rings) {
        break;
      }
    }
    ids.push(row);
  }
  for (let r = 0; r < rings; r++) {
    const A = ids[r];
    const B = ids[r + 1];
    for (let k = 0; k < seg; k++) {
      const a0 = A[A.length === 1 ? 0 : k];
      const a1 = A[A.length === 1 ? 0 : (k + 1) % seg];
      const b0 = B[B.length === 1 ? 0 : k];
      const b1 = B[B.length === 1 ? 0 : (k + 1) % seg];
      if (A.length === 1) {
        b.tri(a0, b0, b1);
      } else if (B.length === 1) {
        b.tri(a0, a1, b0);
      } else {
        b.quad(a0, a1, b1, b0);
      }
    }
  }
}

/** Upright cylinder / lathe profile [radius, height] about (cx, cz) from y0. */
function lathe(g: Geo, m: MaterialName, cx: number, y0: number, cz: number, prof: [number, number][], seg = 10): void {
  const b = g.of(m);
  for (let j = 0; j + 1 < prof.length; j++) {
    const [r0, h0] = prof[j];
    const [r1, h1] = prof[j + 1];
    const dr = r1 - r0;
    const dh = h1 - h0;
    const l = Math.hypot(dr, dh) || 1;
    for (let k = 0; k < seg; k++) {
      const t0 = (k / seg) * Math.PI * 2;
      const t1 = ((k + 1) / seg) * Math.PI * 2;
      const n0: Vec3 = [Math.cos(t0) * (dh / l), -dr / l, Math.sin(t0) * (dh / l)];
      const n1: Vec3 = [Math.cos(t1) * (dh / l), -dr / l, Math.sin(t1) * (dh / l)];
      const i0 = b.v([cx + Math.cos(t0) * r0, y0 + h0, cz + Math.sin(t0) * r0], n0);
      const i1 = b.v([cx + Math.cos(t1) * r0, y0 + h0, cz + Math.sin(t1) * r0], n1);
      const i2 = b.v([cx + Math.cos(t1) * r1, y0 + h1, cz + Math.sin(t1) * r1], n1);
      const i3 = b.v([cx + Math.cos(t0) * r1, y0 + h1, cz + Math.sin(t0) * r1], n0);
      if (r0 < 1e-5) {
        b.tri(i0, i2, i3);
      } else if (r1 < 1e-5) {
        b.tri(i0, i1, i2);
      } else {
        b.quad(i0, i1, i2, i3);
      }
    }
  }
}

/** Thin bar between two points (square section). */
function bar(g: Geo, m: MaterialName, a: Vec3, c: Vec3, w: number): void {
  const d = norm([c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
  const ref: Vec3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const s1 = norm(cross(d, ref));
  const s2 = cross(d, s1);
  const b = g.of(m);
  const h = w / 2;
  const corners = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  for (let k = 0; k < 4; k++) {
    const [p0, q0] = corners[k];
    const [p1, q1] = corners[(k + 1) % 4];
    const o0 = add(add([0, 0, 0], s1, p0 * h), s2, q0 * h);
    const o1 = add(add([0, 0, 0], s1, p1 * h), s2, q1 * h);
    const n = norm(add(o0, o1));
    b.flatQuad([add(a, o0), add(a, o1), add(c, o1), add(c, o0)], n);
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Fish                                                                                                            */
/* ------------------------------------------------------------------------------------------------------------- */

const FISH = {
  levrek: { side: 'fp_fish', back: 'fp_fish_dark', L: [0.34, 0.42] },
  cupra: { side: 'fp_fish_gold', back: 'fp_fish_dark', L: [0.26, 0.32] },
  palamut: { side: 'fp_fish', back: 'fp_fish_blue', L: [0.4, 0.5] },
  barbun: { side: 'fp_fish_red', back: 'fp_fish_red', L: [0.16, 0.22] },
  istavrit: { side: 'fp_fish', back: 'fp_fish_blue', L: [0.16, 0.2] },
  hamsi: { side: 'fp_fish', back: 'fp_fish_dark', L: [0.1, 0.13] },
  lufer: { side: 'fp_fish', back: 'fp_fish_blue', L: [0.26, 0.32] },
} as const;
type Species = keyof typeof FISH;

/**
 * A fish lying on its side: head at `head`, body along `dir` (unit), `up` the normal of the surface it lies on.
 * `sides` 6 for large fish, 4 for small ones; the dorsal third takes the back material.
 */
function fish(g: Geo, sp: Species, head: Vec3, dir: Vec3, up: Vec3, L: number, sides: 4 | 6): void {
  const { side, back } = FISH[sp];
  const a = norm(dir);
  const n = norm(up);
  const bv = norm(cross(a, n));
  const deep = sp === 'cupra' ? 0.19 : sp === 'barbun' ? 0.15 : sp === 'palamut' || sp === 'hamsi' || sp === 'istavrit' ? 0.1 : 0.13;
  const stations = sides === 6 ? [0.02, 0.1, 0.25, 0.45, 0.65, 0.8, 0.9] : [0.03, 0.25, 0.6, 0.88];
  const profile = sides === 6 ? [0.35, 0.78, 0.97, 1.0, 0.8, 0.45, 0.2] : [0.5, 1.0, 0.8, 0.25];
  const rings: { p: Vec3; nrm: Vec3; dorsal: number }[][] = [];
  stations.forEach((t, j) => {
    const r = deep * L * profile[j];
    const th = 0.42 * r;
    const c = add(add(head, a, t * L), n, th + 0.004);
    const ring: { p: Vec3; nrm: Vec3; dorsal: number }[] = [];
    for (let k = 0; k < sides; k++) {
      const ang = (k / sides) * Math.PI * 2 + (sides === 4 ? Math.PI / 4 : 0);
      const cb = Math.cos(ang);
      const cn = Math.sin(ang);
      const p = add(add(c, bv, cb * r), n, cn * th);
      const nrm = norm(add(add([0, 0, 0], bv, cb / r), n, cn / th));
      ring.push({ p, nrm, dorsal: cb });
    }
    rings.push(ring);
  });
  const B = (m: MaterialName): Builder => g.of(m);
  // Snout.
  const tip = add(add(head, n, 0.3 * deep * L * profile[0] + 0.004), a, -0.01 * L);
  for (let k = 0; k < sides; k++) {
    const p = rings[0][k];
    const q = rings[0][(k + 1) % sides];
    const m = (p.dorsal + q.dorsal) / 2 > 0.45 ? back : side;
    const b = B(m);
    b.tri(b.v(tip, norm(add(a, [0, 0, 0], -1))), b.v(p.p, p.nrm), b.v(q.p, q.nrm));
  }
  for (let j = 0; j + 1 < rings.length; j++) {
    for (let k = 0; k < sides; k++) {
      const p0 = rings[j][k];
      const p1 = rings[j][(k + 1) % sides];
      const q0 = rings[j + 1][k];
      const q1 = rings[j + 1][(k + 1) % sides];
      const m = (p0.dorsal + p1.dorsal) / 2 > 0.45 ? back : side;
      const b = B(m);
      b.quad(b.v(p0.p, p0.nrm), b.v(p1.p, p1.nrm), b.v(q1.p, q1.nrm), b.v(q0.p, q0.nrm));
    }
  }
  // Tail: close the last ring to a point, then a forked fin in the surface plane.
  const last = rings[rings.length - 1];
  const tailBase = add(add(head, a, stations[stations.length - 1] * L + 0.02 * L), n, 0.01);
  for (let k = 0; k < sides; k++) {
    const p = last[k];
    const q = last[(k + 1) % sides];
    const b = B(side);
    b.tri(b.v(p.p, p.nrm), b.v(q.p, q.nrm), b.v(tailBase, a));
  }
  const fin = B(side);
  const f0 = tailBase;
  const f1 = add(add(tailBase, a, 0.13 * L), bv, 0.075 * L);
  const f2 = add(tailBase, a, 0.08 * L);
  const f3 = add(add(tailBase, a, 0.13 * L), bv, -0.075 * L);
  fin.flatQuad([f0, f1, f2, f3], n);
}

/** Crushed ice surface over [x0, x1] × [z0, z1] at height y (a jittered grid). */
function ice(g: Geo, x0: number, x1: number, z0: number, z1: number, y: number, r: () => number): void {
  const b = g.of('fp_ice');
  const nx = Math.max(2, Math.round((x1 - x0) / 0.07));
  const nz = Math.max(2, Math.round((z1 - z0) / 0.07));
  const ids: number[][] = [];
  for (let j = 0; j <= nz; j++) {
    const row: number[] = [];
    for (let i = 0; i <= nx; i++) {
      const edge = i === 0 || j === 0 || i === nx || j === nz;
      const h = edge ? 0 : 0.012 * r();
      row.push(b.v([x0 + ((x1 - x0) * i) / nx, y + h, z0 + ((z1 - z0) * j) / nz], norm([r() - 0.5, 3, r() - 0.5])));
    }
    ids.push(row);
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      b.quad(ids[j][i], ids[j][i + 1], ids[j + 1][i + 1], ids[j + 1][i]);
    }
  }
}

/** White polystyrene crate (open top) with ice and small fish packed in it. */
function epsCrate(g: Geo, cx: number, y: number, cz: number, w: number, d: number, sp: Species | null, r: () => number): void {
  const h = 0.15;
  const t = 0.025;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const z0 = cz - d / 2;
  const z1 = cz + d / 2;
  const b = g.of('fp_poly');
  // Outer walls, rim, inner walls.
  b.flatQuad([[x0, y, z1], [x1, y, z1], [x1, y + h, z1], [x0, y + h, z1]], [0, 0, 1]);
  b.flatQuad([[x0, y, z0], [x1, y, z0], [x1, y + h, z0], [x0, y + h, z0]], [0, 0, -1]);
  b.flatQuad([[x1, y, z0], [x1, y, z1], [x1, y + h, z1], [x1, y + h, z0]], [1, 0, 0]);
  b.flatQuad([[x0, y, z0], [x0, y, z1], [x0, y + h, z1], [x0, y + h, z0]], [-1, 0, 0]);
  const yt = y + h;
  b.flatQuad([[x0, yt, z0], [x1, yt, z0], [x1 - t, yt, z0 + t], [x0 + t, yt, z0 + t]], [0, 1, 0]);
  b.flatQuad([[x0, yt, z1], [x1, yt, z1], [x1 - t, yt, z1 - t], [x0 + t, yt, z1 - t]], [0, 1, 0]);
  b.flatQuad([[x0, yt, z0], [x0 + t, yt, z0 + t], [x0 + t, yt, z1 - t], [x0, yt, z1]], [0, 1, 0]);
  b.flatQuad([[x1, yt, z0], [x1 - t, yt, z0 + t], [x1 - t, yt, z1 - t], [x1, yt, z1]], [0, 1, 0]);
  const yi = yt - 0.04;
  b.flatQuad([[x0 + t, yi, z1 - t], [x1 - t, yi, z1 - t], [x1 - t, yt, z1 - t], [x0 + t, yt, z1 - t]], [0, 0, -1]);
  b.flatQuad([[x0 + t, yi, z0 + t], [x1 - t, yi, z0 + t], [x1 - t, yt, z0 + t], [x0 + t, yt, z0 + t]], [0, 0, 1]);
  b.flatQuad([[x1 - t, yi, z0 + t], [x1 - t, yi, z1 - t], [x1 - t, yt, z1 - t], [x1 - t, yt, z0 + t]], [-1, 0, 0]);
  b.flatQuad([[x0 + t, yi, z0 + t], [x0 + t, yi, z1 - t], [x0 + t, yt, z1 - t], [x0 + t, yt, z0 + t]], [1, 0, 0]);
  ice(g, x0 + t, x1 - t, z0 + t, z1 - t, yi, r);
  if (!sp) {
    return;
  }
  const [la, lb] = FISH[sp].L;
  // Packed in rows across the crate (heads to the front), two layers.
  for (let layer = 0; layer < 2; layer++) {
    const L0 = la + (lb - la) * 0.5;
    const rows = Math.max(1, Math.floor((d - 2 * t) / (L0 * 1.05)));
    const across = Math.max(2, Math.floor((w - 2 * t) / (L0 * 0.22)));
    for (let q = 0; q < rows; q++) {
      for (let k = 0; k < across; k++) {
        if (layer === 1 && r() < 0.45) {
          continue;
        }
        const L = la + (lb - la) * r();
        const x = x0 + t + 0.02 + ((w - 2 * t - 0.04) * (k + 0.5 + (r() - 0.5) * 0.5)) / across;
        const zHead = z1 - t - 0.01 - q * L0 * 1.05 - r() * 0.02;
        const yaw = (r() - 0.5) * 0.5 + (layer ? 0.35 : 0);
        const dir: Vec3 = [Math.sin(yaw), 0, -Math.cos(yaw)];
        const up: Vec3 = norm([(r() - 0.5) * 0.4, 1, (r() - 0.5) * 0.2]);
        fish(g, sp, [x, yi + 0.004 + layer * 0.018, zHead], dir, up, L, 4);
      }
    }
  }
}

/** Yellow price tag on a stick at (x, y, z), leaning slightly. */
function tag(g: Geo, x: number, y: number, z: number, r: () => number): void {
  const lean = (r() - 0.5) * 0.2;
  bar(g, 'fp_stick', [x, y, z], [x + lean * 0.2, y + 0.2, z], 0.006);
  const cx = x + lean * 0.2;
  const cy = y + 0.2;
  const b = g.of('fp_tag');
  const w = 0.07;
  const h = 0.05;
  const n: Vec3 = norm([0, 0.2, 1]);
  b.flatQuad([[cx - w, cy - h, z + 0.004], [cx + w, cy - h, z + 0.004], [cx + w, cy + h, z + 0.004 - 0.02], [cx - w, cy + h, z + 0.004 - 0.02]], n);
  b.flatQuad([[cx - w, cy - h, z], [cx + w, cy - h, z], [cx + w, cy + h, z - 0.02], [cx - w, cy + h, z - 0.02]], [-n[0], -n[1], -n[2]]);
  // Price digits as a dark stroke band.
  const d = g.of('fp_ink');
  d.flatQuad([[cx - w * 0.7, cy - h * 0.35, z + 0.006], [cx + w * 0.7, cy - h * 0.35, z + 0.006], [cx + w * 0.7, cy + h * 0.25, z + 0.006 - 0.012], [cx - w * 0.7, cy + h * 0.25, z + 0.006 - 0.012]], n);
}

/** Blue 220 L plastic barrel with two ribs and a bung. */
function barrel(g: Geo, x: number, z: number): void {
  lathe(g, 'fp_barrel', x, 0, z, [
    [0.001, 0],
    [0.27, 0],
    [0.29, 0.03],
    [0.29, 0.3],
    [0.305, 0.31],
    [0.305, 0.34],
    [0.29, 0.35],
    [0.29, 0.6],
    [0.305, 0.61],
    [0.305, 0.64],
    [0.29, 0.65],
    [0.29, 0.9],
    [0.26, 0.93],
    [0.001, 0.93],
  ], 14);
  lathe(g, 'fp_barrel', x + 0.14, 0.93, z, [
    [0.035, 0],
    [0.035, 0.025],
    [0.001, 0.025],
  ], 8);
}

/** Round plastic tub (bowl) standing on the ground or a table. */
function tub(g: Geo, m: MaterialName, x: number, y: number, z: number, r0: number): void {
  lathe(g, m, x, y, z, [
    [0.001, 0],
    [r0 * 0.75, 0],
    [r0, r0 * 0.55],
    [r0 * 1.04, r0 * 0.58],
    [r0 * 0.98, r0 * 0.58],
    [r0 * 0.72, 0.02],
    [0.001, 0.02],
  ], 14);
}

/** Hanging dial scale on a post at x (post from the back of the table to 2.15 m, arm towards the lane). */
function hangingScale(g: Geo, x: number, zPost: number, yFoot: number): void {
  bar(g, 'fp_table', [x, yFoot, zPost], [x, 2.15, zPost], 0.04);
  bar(g, 'fp_table', [x, 2.12, zPost], [x, 2.12, zPost + 0.55], 0.03);
  const hx = x;
  const hz = zPost + 0.5;
  bar(g, 'fp_table', [hx, 2.1, hz], [hx, 1.98, hz], 0.01);
  // Dial: white face, dark rim, red needle.
  const b = g.of('fp_scale');
  const face: Vec3[] = [];
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    face.push([hx + Math.cos(a) * 0.12, 1.85 + Math.sin(a) * 0.12, hz + 0.035]);
  }
  const c = b.v([hx, 1.85, hz + 0.035], [0, 0, 1]);
  const ids = face.map((p) => b.v(p, [0, 0, 1]));
  for (let k = 0; k < 14; k++) {
    b.tri(c, ids[k], ids[(k + 1) % 14]);
  }
  box(g, 'fp_scale_body', [hx - 0.13, 1.72, hz - 0.03], [hx + 0.13, 1.98, hz + 0.03], false);
  bar(g, 'fp_red', [hx, 1.85, hz + 0.04], [hx + 0.07, 1.91, hz + 0.04], 0.008);
  // Pan on three chains.
  for (const a of [0, 2.1, 4.2]) {
    bar(g, 'fp_table', [hx, 1.72, hz], [hx + Math.cos(a) * 0.2, 1.42, hz + Math.sin(a) * 0.2], 0.005);
  }
  tub(g, 'fp_bowl_steel', hx, 1.36, hz, 0.22);
}

/** Artificial-grass mat: a quad strip over a sequence of points (the mat's centre line across x0..x1). */
function mat(g: Geo, x0: number, x1: number, line: Vec3[]): void {
  const b = g.of('fp_grass');
  for (let k = 0; k + 1 < line.length; k++) {
    const p = line[k];
    const q = line[k + 1];
    const dz = q[2] - p[2];
    const dy = q[1] - p[1];
    const n = norm([0, Math.abs(dz) > 1e-6 ? dz * Math.sign(dz) : 0, -dy * Math.sign(dz || 1)]);
    const nn: Vec3 = n[1] < 0 ? [0, -n[1], -n[2]] : n;
    b.flatQuad([[x0, p[1], p[2]], [x1, p[1], p[2]], [x1, q[1], q[2]], [x0, q[1], q[2]]], Math.abs(dz) < 1e-4 ? [0, 0, 1] : nn);
  }
}

/** Fish stall: `boxes` shows crates on the tilted top as well (more small fish, fewer large ones). */
export function fishStall(mesh: TileMesh, boxes: boolean): void {
  const g = new Geo(mesh);
  const r = rng(boxes ? 97 : 41);
  const W = 1.15;
  const zb = 0.12;
  const zf = 1.0;
  const yb = 1.3;
  const yf = 1.0;
  const shelfY = 0.86;
  const zs = 1.52;
  const slope = (z: number): number => yb + ((yf - yb) * (z - zb)) / (zf - zb);
  const upTop: Vec3 = norm([0, zf - zb, yb - yf]);
  const grad = (yf - yb) / (zf - zb);
  // Steel frame: legs, rails, the tilted top's board and the front shelf.
  for (const x of [-W + 0.04, W - 0.04]) {
    for (const [z, y] of [
      [zb + 0.04, slope(zb + 0.04)],
      [zf - 0.04, shelfY],
      [zs - 0.05, shelfY],
    ] as const) {
      bar(g, 'fp_table', [x, 0, z], [x, y - 0.02, z], 0.04);
    }
    bar(g, 'fp_table', [x, 0.25, zb + 0.04], [x, 0.25, zs - 0.05], 0.03);
  }
  box(g, 'fp_table', [-W, shelfY - 0.04, zf - 0.02], [W, shelfY, zs], false);
  const tb = g.of('fp_table');
  tb.flatQuad([[-W, slope(zb) - 0.04, zb], [W, slope(zb) - 0.04, zb], [W, yf - 0.04, zf], [-W, yf - 0.04, zf]], [0, -upTop[1], -upTop[2]]);
  // Grass mat over the top, down the front of the tilted board, and hanging over the shelf front.
  mat(g, -W, W, [
    [0, yb + 0.005, zb - 0.02],
    [0, yf + 0.005, zf],
    [0, shelfY + 0.01, zf + 0.01],
  ]);
  mat(g, -W - 0.01, W + 0.01, [
    [0, shelfY + 0.005, zs + 0.005],
    [0, shelfY - 0.3, zs + 0.03],
  ]);
  // Large fish on the tilted top: herringbone rows up the slope, species per row, greens between.
  const rowsZ = boxes ? [0.72] : [0.3, 0.55, 0.8];
  const species: Species[] = boxes ? ['levrek'] : ['palamut', 'levrek', 'cupra'];
  rowsZ.forEach((zr, q) => {
    const sp = species[q % species.length];
    const [la, lb] = FISH[sp].L;
    let x = -W + 0.12;
    let k = 0;
    while (x < W - 0.12) {
      const L = la + (lb - la) * r();
      const ang = (k % 2 ? 1 : -1) * (0.35 + 0.15 * r());
      // Head up the slope (towards the back), body down it, tilted into the herringbone.
      const dir = norm([Math.sin(ang), grad * Math.cos(ang), Math.cos(ang)]);
      const zH = Math.max(zb + 0.03, zr - (L * Math.cos(ang)) / 2);
      fish(g, sp, [x, slope(zH), zH], dir, upTop, L, 6);
      const zH2 = zH;
      if (r() < 0.6) {
        // Greens (dill / rocket) tucked between the fish.
        const gx = x + 0.07;
        const gz = zH2 + L * 0.5;
        ell(g, 'fp_greens', [gx, slope(gz) + 0.012, gz], [0.03, 0, 0], [0, 0.012, 0], [0, 0, 0.06], 5, 3);
      }
      x += L * 0.3 + 0.03 + 0.02 * r();
      k++;
    }
  });
  // Crates on the tilted top (boxes variant): stepped, three across.
  if (boxes) {
    for (const [zc, sp] of [
      [0.32, 'istavrit'],
      [0.52, 'hamsi'],
    ] as const) {
      for (let k = 0; k < 3; k++) {
        const cx = -W + 0.4 + k * 0.75;
        epsCrate(g, cx, slope(zc + 0.2) + 0.01, zc, 0.62, 0.38, k === 1 && zc > 0.4 ? 'barbun' : sp, r);
      }
    }
  }
  // Front shelf: EPS crates of small fish.
  const kinds: Species[] = ['hamsi', 'istavrit', 'barbun', 'hamsi'];
  for (let k = 0; k < 3; k++) {
    const cx = -W + 0.39 + k * 0.76;
    epsCrate(g, cx, shelfY, zs - 0.24, 0.66, 0.42, kinds[(k + (boxes ? 1 : 0)) % kinds.length], r);
    tag(g, cx - 0.2, shelfY + 0.1, zs - 0.08, r);
  }
  for (let k = 0; k < 4; k++) {
    const x = -W + 0.3 + k * 0.6;
    const z = 0.45 + 0.25 * (k % 2);
    tag(g, x, slope(z), z, r);
  }
  // Barrel beside the stall, a tub under the shelf, the hanging scale.
  barrel(g, W + 0.38, 0.55);
  tub(g, 'fp_bowl_grey', -0.2, 0, 1.2, 0.3);
  tub(g, 'fp_bowl_blue', 0.5, 0, 1.25, 0.24);
  hangingScale(g, W - 0.15, 0.08, slope(0.08));
  g.flush();
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Produce and deli                                                                                                */
/* ------------------------------------------------------------------------------------------------------------- */

interface Produce {
  m: MaterialName;
  /** Radii (x, y, z) of one item. */
  r: Vec3;
  /** Elongated items lie along a random yaw. */
  long?: boolean;
  cap?: MaterialName;
}

const PRODUCE: Record<string, Produce> = {
  tomato: { m: 'fp_tomato', r: [0.038, 0.032, 0.038], cap: 'fp_greens' },
  orange: { m: 'fp_orange', r: [0.042, 0.04, 0.042] },
  lemon: { m: 'fp_lemon', r: [0.045, 0.032, 0.032], long: true },
  apple: { m: 'fp_apple', r: [0.04, 0.036, 0.04] },
  appleRed: { m: 'fp_red', r: [0.04, 0.036, 0.04] },
  potato: { m: 'fp_potato', r: [0.05, 0.03, 0.035], long: true },
  onion: { m: 'fp_onion', r: [0.038, 0.035, 0.038] },
  aubergine: { m: 'fp_aubergine', r: [0.1, 0.035, 0.035], long: true, cap: 'fp_greens' },
  pepper: { m: 'fp_pepper_green', r: [0.075, 0.018, 0.018], long: true },
  cucumber: { m: 'fp_cucumber', r: [0.09, 0.022, 0.022], long: true },
  quince: { m: 'fp_lemon', r: [0.045, 0.045, 0.045] },
  pomegranate: { m: 'fp_red', r: [0.045, 0.042, 0.045], cap: 'fp_pepper' },
  olivesBlack: { m: 'fp_olive_black', r: [0.012, 0.01, 0.012] },
  olivesGreen: { m: 'fp_olive_green', r: [0.012, 0.01, 0.012] },
  walnut: { m: 'fp_potato', r: [0.018, 0.016, 0.018] },
  apricot: { m: 'fp_apricot', r: [0.02, 0.016, 0.02] },
};

/** Wooden crate (open top) with a heap of one produce kind. */
function produceCrate(g: Geo, cx: number, y: number, cz: number, w: number, d: number, kind: Produce, r: () => number): void {
  const h = 0.24;
  const b = g.of('fp_crate');
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const z0 = cz - d / 2;
  const z1 = cz + d / 2;
  // Slatted sides: three slats per side with gaps (fronts show the slats).
  for (const [s0, s1] of [
    [0, 0.07],
    [0.09, 0.16],
    [0.18, 0.24],
  ]) {
    b.flatQuad([[x0, y + s0, z1], [x1, y + s0, z1], [x1, y + s1, z1], [x0, y + s1, z1]], [0, 0, 1]);
    b.flatQuad([[x1, y + s0, z0], [x1, y + s0, z1], [x1, y + s1, z1], [x1, y + s1, z0]], [1, 0, 0]);
    b.flatQuad([[x0, y + s0, z0], [x0, y + s0, z1], [x0, y + s1, z1], [x0, y + s1, z0]], [-1, 0, 0]);
  }
  box(g, 'fp_crate_dark', [x0 + 0.01, y, z0 + 0.01], [x1 - 0.01, y + 0.16, z1 - 0.01], true);
  // Heap: two or three layers, the top one mounded.
  const [rx, ry, rz] = kind.r;
  const pitch = Math.max(rx, rz) * 2.05;
  const nx = Math.max(1, Math.floor((w - 0.04) / (kind.long ? rz * 2.4 : pitch)));
  const nz = Math.max(1, Math.floor((d - 0.04) / (kind.long ? rx * 2.1 : pitch)));
  const layers = rx < 0.02 ? 1 : 3;
  for (let l = 0; l < layers; l++) {
    const shrink = l * 0.18;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const u = (i + 0.5) / nx - 0.5;
        const v = (j + 0.5) / nz - 0.5;
        if (Math.abs(u) > 0.5 - shrink || Math.abs(v) > 0.5 - shrink) {
          continue;
        }
        const x = cx + u * (w - 0.06) + (r() - 0.5) * pitch * 0.3;
        const z = cz + v * (d - 0.06) + (r() - 0.5) * pitch * 0.3;
        const yy = y + 0.16 + ry + l * ry * 1.6 + (r() - 0.5) * ry * 0.3;
        const s = 0.85 + 0.3 * r();
        if (kind.long) {
          const a = r() * Math.PI;
          ell(g, kind.m, [x, yy, z], [Math.cos(a) * rx * s, 0, Math.sin(a) * rx * s], [0, ry * s, 0], [-Math.sin(a) * rz * s, 0, Math.cos(a) * rz * s], 6, 3);
          if (kind.cap) {
            ell(g, kind.cap, [x + Math.cos(a) * rx * s, yy, z + Math.sin(a) * rx * s], [0.015, 0, 0], [0, 0.015, 0], [0, 0, 0.015], 4, 2);
          }
        } else {
          ell(g, kind.m, [x, yy, z], [rx * s, 0, 0], [0, ry * s, 0], [0, 0, rz * s], rx < 0.02 ? 4 : 6, rx < 0.02 ? 2 : 4);
          if (kind.cap && r() < 0.7) {
            ell(g, kind.cap, [x, yy + ry * s, z], [0.012, 0, 0], [0, 0.006, 0], [0, 0, 0.012], 4, 2);
          }
        }
      }
    }
  }
}

/** A string of dried peppers / aubergines / garlic hanging from (x, yTop, z), `len` long. */
function driedString(g: Geo, x: number, yTop: number, z: number, len: number, kind: 'pepper' | 'aubergine' | 'garlic', r: () => number): void {
  bar(g, 'fp_twine', [x, yTop, z], [x, yTop - len, z], 0.004);
  const step = kind === 'garlic' ? 0.055 : kind === 'aubergine' ? 0.06 : 0.035;
  const n = Math.floor(len / step);
  for (let k = 0; k < n; k++) {
    const y = yTop - 0.05 - k * step;
    const a = k * 2.4 + r();
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    if (kind === 'pepper') {
      // Pods hang down and out round the string.
      const c: Vec3 = [x + ca * 0.025, y - 0.03, z + sa * 0.025];
      ell(g, 'fp_dried_pepper', c, [ca * 0.012, 0.012, sa * 0.012], [ca * 0.02, -0.045, sa * 0.02], [-sa * 0.012, 0, ca * 0.012], 4, 3);
    } else if (kind === 'aubergine') {
      const c: Vec3 = [x + ca * 0.03, y - 0.03, z + sa * 0.03];
      ell(g, 'fp_dried_aub', c, [ca * 0.02, 0.01, sa * 0.02], [ca * 0.01, -0.05, sa * 0.01], [-sa * 0.022, 0, ca * 0.022], 5, 3);
    } else {
      const c: Vec3 = [x + ca * 0.028, y, z + sa * 0.028];
      ell(g, 'fp_garlic', c, [0.026, 0, 0], [0, 0.024, 0], [0, 0, 0.026], 5, 3);
    }
  }
}

/** Produce stall (or deli with `deli`). */
export function produceStall(mesh: TileMesh, deli: boolean): void {
  const g = new Geo(mesh);
  const r = rng(deli ? 313 : 211);
  const W = 1.15;
  const tiers = [
    { z: 1.28, y: 0.4 },
    { z: 0.9, y: 0.7 },
    { z: 0.52, y: 1.0 },
  ];
  const kinds: Produce[] = deli
    ? [PRODUCE.olivesBlack, PRODUCE.olivesGreen, PRODUCE.walnut, PRODUCE.apricot, PRODUCE.olivesGreen, PRODUCE.olivesBlack]
    : [PRODUCE.tomato, PRODUCE.orange, PRODUCE.lemon, PRODUCE.aubergine, PRODUCE.pepper, PRODUCE.apple, PRODUCE.potato, PRODUCE.onion, PRODUCE.cucumber, PRODUCE.pomegranate, PRODUCE.appleRed, PRODUCE.quince];
  let k = 0;
  for (const t of tiers) {
    // Crate stand under each tier.
    box(g, 'fp_crate_dark', [-W, 0, t.z - 0.19], [W, t.y, t.z + 0.19], true);
    for (let i = 0; i < 4; i++) {
      const cx = -W + 0.29 + i * 0.574;
      if (deli && t === tiers[2] && i % 2 === 1) {
        // Cheese wheels instead of a crate.
        lathe(g, 'fp_cheese', cx, t.y, t.z, [
          [0.001, 0],
          [0.2, 0],
          [0.21, 0.06],
          [0.2, 0.12],
          [0.001, 0.12],
        ], 14);
        continue;
      }
      produceCrate(g, cx, t.y, t.z, 0.54, 0.36, kinds[k++ % kinds.length], r);
      if (r() < 0.8) {
        tag(g, cx + 0.15, t.y + 0.2, t.z + 0.16, r);
      }
    }
  }
  // Rail at 2.3 m on two posts, strings of dried vegetables (produce) or a wall of pickle jars (deli).
  bar(g, 'fp_table', [-W, 0, 0.15], [-W, 2.35, 0.15], 0.035);
  bar(g, 'fp_table', [W, 0, 0.15], [W, 2.35, 0.15], 0.035);
  bar(g, 'fp_table', [-W, 2.3, 0.15], [W, 2.3, 0.15], 0.03);
  if (deli) {
    const colours: MaterialName[] = ['fp_pickle_green', 'fp_pickle_red', 'fp_pickle_yellow', 'fp_pickle_green', 'fp_pickle_mixed'];
    for (let row = 0; row < 3; row++) {
      const y = 1.3 + row * 0.32;
      box(g, 'fp_crate_dark', [-W, y - 0.03, 0.05], [W, y, 0.32], false);
      for (let i = 0; i < 9; i++) {
        const x = -W + 0.13 + i * 0.255;
        const m = colours[(i + row * 2) % colours.length];
        lathe(g, m, x, y, 0.18, [
          [0.001, 0],
          [0.085, 0],
          [0.09, 0.02],
          [0.09, 0.2],
        ], 8);
        lathe(g, 'fp_jar_glass', x, y + 0.2, 0.18, [
          [0.09, 0],
          [0.06, 0.03],
          [0.06, 0.05],
        ], 8);
        lathe(g, 'fp_lid', x, y + 0.25, 0.18, [
          [0.065, 0],
          [0.065, 0.025],
          [0.001, 0.025],
        ], 8);
      }
    }
    for (let i = 0; i < 4; i++) {
      driedString(g, -W + 0.2 + i * 0.6, 2.28, 0.2, 0.7 + 0.3 * r(), 'pepper', r);
    }
  } else {
    const kindsS: ('pepper' | 'aubergine' | 'garlic')[] = ['pepper', 'pepper', 'aubergine', 'pepper', 'garlic', 'aubergine', 'pepper', 'pepper', 'aubergine'];
    for (let i = 0; i < kindsS.length; i++) {
      const x = -W + 0.12 + (i * (2 * W - 0.24)) / (kindsS.length - 1);
      driedString(g, x, 2.28, 0.15 + 0.05 * (i % 2), 1.0 + 0.6 * r(), kindsS[i], r);
    }
  }
  g.flush();
}
