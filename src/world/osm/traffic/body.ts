/**
 * Parametric vehicle bodies. A body is a loft of cross-sections along the vehicle (vehicle frame: forward -Z, right
 * +X, up +Y, wheels on y = 0; station u runs from the front face, u = 0, to the rear face, u = length), defined by a
 * side profile (roof / bonnet / boot line, belt line, underside with wheel arches) and a plan outline with rounded
 * corners. Body can also answer where its surface is (frontU / rearU / width), so lights, grilles, plates, bumpers
 * and arch liners are laid onto the real surface as conforming patches instead of boxes floating in or above it.
 */
import { face, type Face, type ModelBuilder, VehicleMat as M, type Rgb } from './model-builder';

export type Curve = readonly (readonly [number, number])[];

/** Piecewise linear curve lookup (u ascending). */
export function curveAt(c: Curve, u: number): number {
  if (u <= c[0][0]) {
    return c[0][1];
  }
  for (let i = 1; i < c.length; i++) {
    if (u <= c[i][0]) {
      const t = (u - c[i - 1][0]) / Math.max(1e-6, c[i][0] - c[i - 1][0]);
      return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t;
    }
  }
  return c[c.length - 1][1];
}

export const GLASS: Rgb = [0.012, 0.016, 0.02];
export const TRIM: Rgb = [0.028, 0.03, 0.033];
export const TYRE: Rgb = [0.02, 0.02, 0.022];
export const RIM: Rgb = [0.6, 0.61, 0.63];
export const HEAD: Rgb = [0.78, 0.8, 0.84];
export const TAIL: Rgb = [0.5, 0.02, 0.02];
export const PLATE: Rgb = [0.86, 0.86, 0.84];
export const PLATE_BLUE: Rgb = [0.02, 0.08, 0.4];
export const AMBER: Rgb = [0.95, 0.42, 0.04];

export interface BodySpec {
  length: number;
  width: number;
  /** Roof / bonnet / boot line: (u, y). */
  top: Curve;
  /** Waist line where the side glass starts. */
  belt: Curve;
  /** Upper edge of the side glass (default: just under the roof edge); buses and trams keep a roof band above. */
  glassTop?: Curve;
  /** Underside height at the very front / rear (bumper bottoms) and between the axles. */
  bottomFront: number;
  bottomRear: number;
  clearance: number;
  /** Axle stations (u), wheel radius and tyre width. */
  axles: number[];
  wheelR: number;
  wheelW: number;
  /** Roof half width as a fraction of the body half width (tumblehome). */
  tumble: number;
  /** Plan corner radius (m) at the front / rear and the width fraction left at the very ends. */
  roundFront: number;
  roundRear: number;
  endWidth: number;
  /** u ranges of the windscreen and rear window (on the roof line) and of the side glass. */
  windshield: [number, number];
  rearWindow: [number, number] | null;
  sideGlass: [number, number][];
  /** Dark pillars inside the side glass (u centres). */
  pillars: number[];
  pillarW: number;
  /** Stations with a sharp profile crease. */
  creases: number[];
  /** Side glass material (Glass, or Lit for passenger windows lit at night). */
  sideMat: number;
  /** Fixed-colour roof (liveries) and horizontal bands [y0, y1, face]. */
  roof?: Face;
  bands?: [number, number, Face][];
  /** Black lower cladding (rocker panels). */
  cladding?: boolean;
  /** Paint face override (fixed colour bodies). */
  paint?: Face;
}

/** Ring points of the right half section (bottom centre ... roof centre); see Body.half(). */
const HALF_POINTS = 10;
/** Segment kinds of the half section, bottom to top (segment k joins half points k and k + 1). */
const Seg = { Under: 0, Sill: 1, Lower: 2, Upper: 3, Shoulder: 4, Glass: 5, RoofEdge: 6, RoofInner: 7, Roof: 8 } as const;
/** Smoothing group per segment kind: creases run where the group changes. */
const SEG_GROUP = [0, 1, 2, 2, 2, 3, 4, 4, 4];

export class Body {
  readonly L: number;
  readonly hw: number;
  private readonly R: number;
  private readonly tmp: number[] = new Array(HALF_POINTS * 2).fill(0);

  constructor(
    readonly spec: BodySpec,
    readonly lod: number,
  ) {
    this.L = spec.length;
    this.hw = spec.width / 2;
    this.R = spec.wheelR + 0.05;
  }

  /** Plan width factor (0..1) at station u. */
  plan(u: number): number {
    const s = this.spec;
    const e = s.endWidth;
    if (u < s.roundFront) {
      const t = 1 - Math.max(0, u) / s.roundFront;
      return e + (1 - e) * Math.sqrt(Math.max(0, 1 - t * t));
    }
    if (u > this.L - s.roundRear) {
      const t = 1 - Math.max(0, this.L - u) / s.roundRear;
      return e + (1 - e) * Math.sqrt(Math.max(0, 1 - t * t));
    }
    return 1;
  }

  top(u: number): number {
    return curveAt(this.spec.top, u);
  }

  belt(u: number): number {
    return Math.min(curveAt(this.spec.belt, u), this.top(u) - 0.03);
  }

  /** Underside height at u, raised over the wheels (the wheel arches). */
  bottom(u: number): number {
    const s = this.spec;
    let b = s.clearance;
    if (u < 0.45) {
      b = s.bottomFront + (s.clearance - s.bottomFront) * (Math.max(0, u) / 0.45);
    } else if (u > this.L - 0.45) {
      b = s.bottomRear + (s.clearance - s.bottomRear) * (Math.max(0, this.L - u) / 0.45);
    }
    if (this.lod < 2) {
      const R = this.R;
      for (const a of s.axles) {
        const d = u - a;
        if (Math.abs(d) < R) {
          b = Math.max(b, s.wheelR + Math.sqrt(R * R - d * d) * (this.lod === 0 ? 1 : 0.92));
        }
      }
    }
    return Math.min(b, this.top(u) - 0.1);
  }

  /**
   * Right half of the section at u as x, y pairs from the bottom centre to the roof centre, y non-decreasing:
   * underside, sill, widest point (door bulge), shoulder, belt line, top of the side glass, two roof edge points
   * (rounded edge), roof centre (see Seg).
   */
  half(u: number, out: number[] = this.tmp): number[] {
    const hw = this.hw * this.plan(u);
    const top = this.top(u);
    const bottom = this.bottom(u);
    const belt = this.belt(u);
    const cabin = Math.min(1, Math.max(0, (top - belt) / 0.35));
    const hwTop = hw * (0.93 + (this.spec.tumble - 0.93) * cabin);
    const crown = 0.012 + 0.025 * cabin;
    const lower = bottom + (belt - bottom) * 0.42;
    const upper = belt - (belt - bottom) * 0.14;
    let gTop = top - 0.045 * cabin - 0.006;
    let wTop = hwTop;
    if (this.spec.glassTop) {
      gTop = Math.min(gTop, curveAt(this.spec.glassTop, u));
      // straight sides up to the roof band, then the roof edge rounds in
      wTop = hw * 0.985 + (hwTop - hw * 0.985) * 0.35;
    }
    gTop = Math.max(gTop, belt + 0.01);
    const edge = top - gTop;
    const p = [
      0,
      bottom,
      hw * 0.86,
      bottom,
      hw * 0.975,
      Math.min(bottom + 0.07, lower - 0.01),
      hw,
      lower,
      hw * 0.994,
      Math.max(upper, lower + 0.005),
      hw * 0.972,
      Math.max(belt, upper + 0.01),
      wTop,
      gTop,
      wTop * 0.985 - hwTop * 0.035,
      gTop + edge * 0.55,
      hwTop * 0.86,
      top,
      0,
      top + crown,
    ];
    for (let k = 0; k < p.length; k++) {
      out[k] = p[k];
    }
    return out;
  }

  /** Half width of the body at station u and height y, or -1 when y is outside the section. */
  width(u: number, y: number): number {
    const h = this.half(u);
    if (y < h[1] || y > h[HALF_POINTS * 2 - 1]) {
      return -1;
    }
    for (let k = 1; k < HALF_POINTS; k++) {
      const y0 = h[k * 2 - 1];
      const y1 = h[k * 2 + 1];
      if (y <= y1 && y >= y0) {
        if (y1 - y0 < 1e-6) {
          return Math.max(h[k * 2 - 2], h[k * 2]);
        }
        const t = (y - y0) / (y1 - y0);
        return h[k * 2 - 2] + (h[k * 2] - h[k * 2 - 2]) * t;
      }
    }
    return -1;
  }

  private inside(u: number, x: number, y: number): boolean {
    const w = this.width(u, y);
    return w >= 0 && Math.abs(x) <= w;
  }

  /** Station where a ray along +u (from ahead of the vehicle) at (x, y) meets the body; NaN when it misses. */
  frontU(x: number, y: number): number {
    const lim = this.L * 0.5;
    if (this.inside(0, x, y)) {
      return 0;
    }
    if (!this.inside(lim, x, y)) {
      return NaN;
    }
    let a = 0;
    let b = lim;
    for (let k = 0; k < 22; k++) {
      const m = (a + b) / 2;
      if (this.inside(m, x, y)) {
        b = m;
      } else {
        a = m;
      }
    }
    return b;
  }

  /** Station where a ray along -u (from behind the vehicle) at (x, y) meets the body; NaN when it misses. */
  rearU(x: number, y: number): number {
    const L = this.L;
    const lim = L * 0.5;
    if (this.inside(L, x, y)) {
      return L;
    }
    if (!this.inside(lim, x, y)) {
      return NaN;
    }
    let a = lim;
    let b = L;
    for (let k = 0; k < 22; k++) {
      const m = (a + b) / 2;
      if (this.inside(m, x, y)) {
        a = m;
      } else {
        b = m;
      }
    }
    return a;
  }

  /** Station list of the loft for this LOD (profile corners, glass edges, arches, even spacing). */
  stations(): number[] {
    const s = this.spec;
    const L = this.L;
    const lod = this.lod;
    const set: number[] = [];
    const add = (u: number): void => {
      if (u >= 0 && u <= L) {
        set.push(u);
      }
    };
    const ends = lod === 0 ? [0, 0.02, 0.06, 0.12, 0.2, 0.3, 0.42, 0.56] : lod === 1 ? [0, 0.06, 0.18, 0.4] : [0, 0.15];
    for (const u of ends) {
      add(u);
      add(L - u);
    }
    for (const [u] of s.top) {
      add(u);
    }
    for (const u of s.creases) {
      add(u);
    }
    if (lod < 2) {
      const R = this.R;
      const fr = lod === 0 ? [-1, -0.92, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 0.92, 1] : [-1, -0.6, 0, 0.6, 1];
      for (const a of s.axles) {
        for (const f of fr) {
          add(a + f * R);
        }
      }
      for (const r of s.sideGlass) {
        add(r[0]);
        add(r[1]);
      }
      for (const r of [s.windshield, s.rearWindow]) {
        if (r) {
          add(r[0]);
          add(r[1]);
        }
      }
      if (lod === 0) {
        for (const p of s.pillars) {
          add(p - s.pillarW / 2);
          add(p + s.pillarW / 2);
        }
      }
    }
    const step = lod === 0 ? 0.8 : lod === 1 ? (L > 7 ? 2.4 : 1.6) : L > 7 ? 4 : 99;
    for (let u = step; u < L - 0.3; u += step) {
      add(u);
    }
    set.sort((a, b) => a - b);
    const out: number[] = [];
    for (const u of set) {
      if (!out.length || u - out[out.length - 1] > 0.015) {
        out.push(u);
      }
    }
    return out;
  }

  /** Lofts the shell into `mb`: paint, glass bands, roof / bands liveries, black underside and cladding. */
  shell(mb: ModelBuilder): void {
    const s = this.spec;
    const us = this.stations();
    const paint = s.paint ?? face(M.Paint);
    const rings: number[][] = [];
    const zs: number[] = [];
    const half: number[] = [];
    // far LOD: fewer section points (sill, shoulder and roof edge merged)
    const pick = this.lod === 2 ? LOD2_POINTS : ALL_POINTS;
    const P = pick.length;
    // kind of each picked half segment: the uppermost original segment it covers
    const kinds = pick.slice(0, P - 1).map((_, k) => pick[k + 1] - 1);
    const segKind = (j: number, m: number): number => kinds[j <= P - 2 ? j : m - 1 - j];
    for (const u of us) {
      this.half(u, half);
      const ring: number[] = [];
      for (let k = 0; k < P; k++) {
        ring.push(half[pick[k] * 2], half[pick[k] * 2 + 1]);
      }
      for (let k = P - 2; k >= 1; k--) {
        ring.push(-half[pick[k] * 2], half[pick[k] * 2 + 1]);
      }
      rings.push(ring);
      zs.push(u - this.L / 2);
    }
    const m = rings[0].length / 2;
    const inRange = (u: number, r: readonly [number, number] | null): boolean => !!r && u > r[0] && u < r[1];
    const glass = face(M.Glass, GLASS);
    const side = s.sideMat === M.Lit ? face(M.Lit, GLASS) : glass;
    const trim = face(M.Trim, TRIM);
    const faceAt = (i: number, j: number): Face => {
      const u = (us[i] + us[i + 1]) / 2;
      // segment kind on the half ring (Seg), mirrored for the left half
      const h = segKind(j, m);
      const ring = rings[i];
      const y = (ring[(j % m) * 2 + 1] + ring[((j + 1) % m) * 2 + 1]) / 2;
      if (h === Seg.Under) {
        return trim;
      }
      if (h === Seg.Glass) {
        for (const r of s.sideGlass) {
          if (inRange(u, r)) {
            if (this.lod === 0 && s.pillars.some((p) => Math.abs(u - p) < s.pillarW / 2)) {
              return trim;
            }
            return side;
          }
        }
      }
      if ((h === Seg.Roof || h === Seg.RoofInner) && (inRange(u, s.windshield) || inRange(u, s.rearWindow))) {
        return glass;
      }
      if (h >= Seg.RoofEdge && s.roof && this.top(u) - this.belt(u) > 0.3) {
        return s.roof;
      }
      if (h === Seg.Sill && s.cladding) {
        return trim;
      }
      if (s.bands) {
        for (const [y0, y1, f] of s.bands) {
          if (y > y0 && y < y1) {
            return f;
          }
        }
      }
      return paint;
    };
    const creaseZ = us.map((u) => s.creases.some((c) => Math.abs(c - u) < 0.02) || s.sideGlass.some((r) => Math.abs(r[0] - u) < 0.02 || Math.abs(r[1] - u) < 0.02));
    const creaseJ: boolean[] = [];
    for (let j = 0; j < m; j++) {
      creaseJ.push(j > 0 && SEG_GROUP[segKind(j, m)] !== SEG_GROUP[segKind(j - 1, m)]);
    }
    mb.loft(zs, rings, faceAt, creaseZ, creaseJ, paint, paint);
  }
}

const ALL_POINTS = Array.from({ length: HALF_POINTS }, (_, k) => k);
const LOD2_POINTS = [0, 1, 3, 5, 6, 8, 9];

/* ------------------------------------------------------------------ */
/* Conforming patches                                                  */
/* ------------------------------------------------------------------ */

type Mapper = (a: number, b: number) => [number, number, number] | null;

/**
 * Grid patch over the parameter rectangle [0,1]² mapped by `map` onto a surface, lifted `lift` m along the surface
 * normal (oriented towards `outward`). Cells with an unmapped corner are dropped.
 */
export function patch(mb: ModelBuilder, map: Mapper, na: number, nb: number, f: Face, outward: readonly [number, number, number], lift = 0.004): void {
  const P: ([number, number, number] | null)[] = [];
  for (let j = 0; j <= nb; j++) {
    for (let i = 0; i <= na; i++) {
      P.push(map(i / na, j / nb));
    }
  }
  const at = (i: number, j: number): [number, number, number] | null => P[Math.min(nb, Math.max(0, j)) * (na + 1) + Math.min(na, Math.max(0, i))];
  const ids = new Int32Array(P.length).fill(-1);
  for (let j = 0; j <= nb; j++) {
    for (let i = 0; i <= na; i++) {
      const p = at(i, j);
      if (!p) {
        continue;
      }
      const a0 = at(i - 1, j) ?? p;
      const a1 = at(i + 1, j) ?? p;
      const b0 = at(i, j - 1) ?? p;
      const b1 = at(i, j + 1) ?? p;
      const da = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]];
      const db = [b1[0] - b0[0], b1[1] - b0[1], b1[2] - b0[2]];
      let nx = da[1] * db[2] - da[2] * db[1];
      let ny = da[2] * db[0] - da[0] * db[2];
      let nz = da[0] * db[1] - da[1] * db[0];
      let l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) {
        [nx, ny, nz] = outward;
        l = 1;
      }
      nx /= l;
      ny /= l;
      nz /= l;
      if (nx * outward[0] + ny * outward[1] + nz * outward[2] < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      ids[j * (na + 1) + i] = mb.vertex(p[0] + nx * lift, p[1] + ny * lift, p[2] + nz * lift, nx, ny, nz, f);
    }
  }
  for (let j = 0; j < nb; j++) {
    for (let i = 0; i < na; i++) {
      const a = ids[j * (na + 1) + i];
      const b = ids[j * (na + 1) + i + 1];
      const c = ids[(j + 1) * (na + 1) + i + 1];
      const d = ids[(j + 1) * (na + 1) + i];
      if (a < 0 || b < 0 || c < 0 || d < 0) {
        continue;
      }
      // winding so the geometric normal agrees with the vertex normals
      const pa = P[j * (na + 1) + i]!;
      const pb = P[j * (na + 1) + i + 1]!;
      const pc = P[(j + 1) * (na + 1) + i + 1]!;
      const ux = pb[0] - pa[0];
      const uy = pb[1] - pa[1];
      const uz = pb[2] - pa[2];
      const vx = pc[0] - pa[0];
      const vy = pc[1] - pa[1];
      const vz = pc[2] - pa[2];
      const gx = uy * vz - uz * vy;
      const gy = uz * vx - ux * vz;
      const gz = ux * vy - uy * vx;
      if (gx * outward[0] + gy * outward[1] + gz * outward[2] >= 0) {
        mb.idx.push(a, b, c, a, c, d);
      } else {
        mb.idx.push(a, c, b, a, d, c);
      }
    }
  }
}

/** Outline of a patch in the front / rear view: x0..x1 at the bottom edge, x0t..x1t at the top edge, y0..y1. */
export interface Outline {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Top edge x range (default: same as the bottom). */
  x0t?: number;
  x1t?: number;
}

function outlineMap(o: Outline): (a: number, b: number) => [number, number] {
  const x0t = o.x0t ?? o.x0;
  const x1t = o.x1t ?? o.x1;
  return (a, b) => {
    const xa = o.x0 + (o.x1 - o.x0) * a;
    const xb = x0t + (x1t - x0t) * a;
    return [xa + (xb - xa) * b, o.y0 + (o.y1 - o.y0) * b];
  };
}

/** Patch on the front of the body (seen from ahead), optionally mirrored to the other side. */
export function frontPatch(mb: ModelBuilder, body: Body, o: Outline, f: Face, mirror: boolean, na = 4, nb = 3, lift = 0.004, dz = 0): void {
  const m = outlineMap(o);
  for (const s of mirror ? [1, -1] : [1]) {
    patch(
      mb,
      (a, b) => {
        const [x, y] = m(a, b);
        const u = body.frontU(x * s, y);
        return Number.isNaN(u) ? null : [x * s, y, u - body.L / 2 - dz];
      },
      na,
      nb,
      f,
      [0, 0, -1],
      lift,
    );
  }
}

/** Patch on the rear of the body (seen from behind). */
export function rearPatch(mb: ModelBuilder, body: Body, o: Outline, f: Face, mirror: boolean, na = 4, nb = 3, lift = 0.004, dz = 0): void {
  const m = outlineMap(o);
  for (const s of mirror ? [1, -1] : [1]) {
    patch(
      mb,
      (a, b) => {
        const [x, y] = m(a, b);
        const u = body.rearU(x * s, y);
        return Number.isNaN(u) ? null : [x * s, y, u - body.L / 2 + dz];
      },
      na,
      nb,
      f,
      [0, 0, 1],
      lift,
    );
  }
}

/**
 * Patch on the side of the body over stations u0..u1 and heights y0..y1: both sides (`true`), the right / kerb
 * side (`false` or 1) or the left / driver's side (-1).
 */
export function sidePatch(mb: ModelBuilder, body: Body, u0: number, u1: number, y0: number, y1: number, f: Face, mirror: boolean | 1 | -1, na = 2, nb = 1, lift = 0.004): void {
  for (const s of mirror === true ? [1, -1] : mirror === -1 ? [-1] : [1]) {
    patch(
      mb,
      (a, b) => {
        const u = u0 + (u1 - u0) * a;
        const y = y0 + (y1 - y0) * b;
        const w = body.width(u, y);
        return w < 0 ? null : [w * s, y, u - body.L / 2];
      },
      na,
      nb,
      f,
      [s, 0, 0],
      lift,
    );
  }
}

/** Band around a wheel arch on the body side (arch liner / trim), angles 0..π over the axle at station `axle`. */
export function archPatch(mb: ModelBuilder, body: Body, axle: number, r0: number, r1: number, f: Face, seg: number): void {
  const cy = body.spec.wheelR;
  for (const s of [1, -1]) {
    patch(
      mb,
      (a, b) => {
        const ang = Math.PI * (0.02 + 0.96 * a);
        const r = r0 + (r1 - r0) * b;
        const u = axle - Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        const w = body.width(u, y);
        return w < 0 ? null : [w * s, y, u - body.L / 2];
      },
      seg,
      1,
      f,
      [s, 0, 0],
      0.004,
    );
  }
}
