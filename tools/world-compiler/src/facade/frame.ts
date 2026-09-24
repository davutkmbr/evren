/**
 * Façade frame and batched emission for the façade kit.
 *
 * A Frame is the local system of one footprint edge seen from outside: `r` runs to the right along the wall (0 at
 * the left end), `y` is world height and `d` the distance in front of the wall plane (negative = into the wall).
 * Footprint rings are positive-area (outward normal = right-hand side of the edge), so the left end seen from
 * outside is the edge's end point B and "right" is -u.
 *
 * A Batch collects quads and triangles per (material, face direction) and emits each group as ONE planar chart
 * (TileMesh.flatTriangles): a window, a balcony or a shop unit becomes a handful of lightmap charts instead of one
 * per face. Callers flush a batch per element, so a chart never covers parts that overlap in projection.
 */
import type { MaterialName } from '../materials';
import type { RGBA, TileMesh, Vec2, Vec3, Weather } from '../mesh';
import { tilingOf } from '../textures';

export class Frame {
  constructor(
    /** World position of r = 0, d = 0 (x, z). */
    readonly ox: number,
    readonly oz: number,
    /** Unit vector of +r (x, z). */
    readonly rx: number,
    readonly rz: number,
    /** Unit outward normal (x, z). */
    readonly nx: number,
    readonly nz: number,
    readonly len: number,
  ) {}

  /** Frame of the edge a -> b of a positive-area ring. */
  static ofEdge(ax: number, az: number, bx: number, bz: number): Frame {
    const len = Math.hypot(bx - ax, bz - az) || 1e-9;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    return new Frame(bx, bz, -ux, -uz, uz, -ux, len);
  }

  p(r: number, y: number, d: number): Vec3 {
    return [this.ox + this.rx * r + this.nx * d, y, this.oz + this.rz * r + this.nz * d];
  }

  /** World (x, z) of a frame point. */
  xz(r: number, d: number): [number, number] {
    return [this.ox + this.rx * r + this.nx * d, this.oz + this.rz * r + this.nz * d];
  }

  /** World direction of a frame axis. */
  dir(a: Axis): Vec3 {
    switch (a) {
      case 'R':
        return [this.rx, 0, this.rz];
      case '-R':
        return [-this.rx, 0, -this.rz];
      case 'N':
        return [this.nx, 0, this.nz];
      case '-N':
        return [-this.nx, 0, -this.nz];
      case 'Y':
        return [0, 1, 0];
      case '-Y':
        return [0, -1, 0];
    }
  }

  /** A world vector from frame components. */
  vec(r: number, y: number, d: number): Vec3 {
    const x = this.rx * r + this.nx * d;
    const z = this.rz * r + this.nz * d;
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  }
}

export type Axis = 'R' | '-R' | 'N' | '-N' | 'Y' | '-Y';

interface Group {
  m: MaterialName;
  n: Vec3;
  pts: Vec3[];
  tris: number[];
  col: RGBA[];
  uv: Vec2[] | null;
  /** `_WEATHER` per vertex (zeros where a caller gave none); written only when some caller set it. */
  wx: Weather[];
  hasWx: boolean;
}

/** `_WEATHER` of one vertex, one per vertex, or a function of the frame point (r, y, d). */
export type WeatherIn = Weather | readonly Weather[] | ((r: number, y: number, d: number) => Weather);

/** Per-vertex attributes of a welded sheet vertex at frame (r, y). */
export interface SheetAttr {
  color: RGBA;
  weather?: Weather;
  /** Tilt of the shading normal towards +r and +y (radians): low-frequency waviness of a rendered wall. */
  tilt?: [number, number];
}

interface Sheet {
  m: MaterialName;
  a: 'N' | '-N';
  d: number;
  quads: [number, number, number, number][];
  attr: (r: number, y: number) => SheetAttr;
}

const ZERO_WX: Weather = [0, 0, 0, 0];

/** Faces of a box to emit (default: all but the back). */
export interface BoxFaces {
  front?: boolean;
  back?: boolean;
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
}

const ALL_BUT_BACK: BoxFaces = { front: true, left: true, right: true, top: true, bottom: true };

export class Batch {
  private groups = new Map<string, Group>();
  private sheets: Sheet[] = [];
  tris = 0;

  constructor(
    readonly mesh: TileMesh,
    readonly f: Frame,
  ) {}

  private group(m: MaterialName, n: Vec3, uv: boolean): Group {
    const key = `${m}|${n[0].toFixed(3)},${n[1].toFixed(3)},${n[2].toFixed(3)}|${uv ? 1 : 0}`;
    let g = this.groups.get(key);
    if (!g) {
      g = { m, n, pts: [], tris: [], col: [], uv: uv ? [] : null, wx: [], hasWx: false };
      this.groups.set(key, g);
    }
    return g;
  }

  /** Planar polygon (convex, world points) with normal `n`; `weather` is one `_WEATHER` for all points or one per point. */
  poly(m: MaterialName, n: Vec3, pts: readonly Vec3[], color: RGBA | readonly RGBA[], uv?: readonly Vec2[], weather?: Weather | readonly Weather[]): void {
    if (pts.length < 3) {
      return;
    }
    const g = this.group(m, n, !!uv);
    const base = g.pts.length;
    if (weather) {
      g.hasWx = true;
    }
    pts.forEach((p, k) => {
      g.pts.push(p);
      g.col.push(typeof color[0] === 'number' ? (color as RGBA) : (color as readonly RGBA[])[k]);
      g.wx.push(!weather ? ZERO_WX : typeof weather[0] === 'number' ? (weather as Weather) : (weather as readonly Weather[])[k]);
      if (uv && g.uv) {
        g.uv.push(uv[k]);
      }
    });
    for (let k = 1; k + 1 < pts.length; k++) {
      g.tris.push(base, base + k, base + k + 1);
    }
    this.tris += pts.length - 2;
  }

  /** Quad in frame coordinates facing axis `a`: four (r, y, d) corners in order around the quad. */
  quadF(m: MaterialName, a: Axis, c: readonly [number, number, number][], color: RGBA | readonly RGBA[], uv?: readonly Vec2[], weather?: WeatherIn): void {
    this.poly(
      m,
      this.f.dir(a),
      c.map(([r, y, d]) => this.f.p(r, y, d)),
      color,
      uv,
      typeof weather === 'function' ? c.map(([r, y, d]) => weather(r, y, d)) : weather,
    );
  }

  /** Axis-aligned box in frame coordinates. */
  box(m: MaterialName, r0: number, r1: number, y0: number, y1: number, d0: number, d1: number, color: RGBA, faces: BoxFaces = ALL_BUT_BACK, weather?: WeatherIn): void {
    if (r1 - r0 < 1e-4 || y1 - y0 < 1e-4 || d1 - d0 < 1e-4) {
      return;
    }
    if (faces.front) {
      this.quadF(m, 'N', [[r0, y0, d1], [r1, y0, d1], [r1, y1, d1], [r0, y1, d1]], color, undefined, weather);
    }
    if (faces.back) {
      this.quadF(m, '-N', [[r0, y0, d0], [r1, y0, d0], [r1, y1, d0], [r0, y1, d0]], color, undefined, weather);
    }
    if (faces.left) {
      this.quadF(m, '-R', [[r0, y0, d0], [r0, y0, d1], [r0, y1, d1], [r0, y1, d0]], color, undefined, weather);
    }
    if (faces.right) {
      this.quadF(m, 'R', [[r1, y0, d0], [r1, y0, d1], [r1, y1, d1], [r1, y1, d0]], color, undefined, weather);
    }
    if (faces.top) {
      this.quadF(m, 'Y', [[r0, y1, d0], [r1, y1, d0], [r1, y1, d1], [r0, y1, d1]], color, undefined, weather);
    }
    if (faces.bottom) {
      this.quadF(m, '-Y', [[r0, y0, d0], [r1, y0, d0], [r1, y0, d1], [r0, y0, d1]], color, undefined, weather);
    }
  }

  /**
   * A projecting slab, sill or coping: a box in frame coordinates whose front-top and front-bottom arrises are
   * chamfered by `c` (1-3 cm; real concrete and render edges are never razor sharp). The end faces become hexagons.
   * `weather` defaults to edge wear on the chamfers and the front.
   */
  slab(m: MaterialName, r0: number, r1: number, y0: number, y1: number, d0: number, d1: number, color: RGBA, c: number, faces: BoxFaces = ALL_BUT_BACK, weather?: WeatherIn): void {
    const cc = Math.min(c, (y1 - y0) / 2.5, (d1 - d0) / 2.5);
    if (cc < 0.004 || r1 - r0 < 1e-4) {
      this.box(m, r0, r1, y0, y1, d0, d1, color, faces, weather);
      return;
    }
    const wx = weather ?? (((_r: number, y: number, d: number): Weather => [0, 0, d > d1 - cc - 1e-4 ? 0.85 : 0.2, 0]) as WeatherIn);
    const lo = scale(color, 0.9);
    if (faces.front) {
      this.quadF(m, 'N', [[r0, y0 + cc, d1], [r1, y0 + cc, d1], [r1, y1 - cc, d1], [r0, y1 - cc, d1]], color, undefined, wx);
    }
    const top: Vec3 = this.f.vec(0, 1, 1);
    const bot: Vec3 = this.f.vec(0, -1, 1);
    this.poly(m, top, [this.f.p(r0, y1 - cc, d1), this.f.p(r1, y1 - cc, d1), this.f.p(r1, y1, d1 - cc), this.f.p(r0, y1, d1 - cc)], color, undefined, wxAt(wx, [[r0, y1 - cc, d1], [r1, y1 - cc, d1], [r1, y1, d1 - cc], [r0, y1, d1 - cc]]));
    if (faces.bottom !== false) {
      this.poly(m, bot, [this.f.p(r0, y0 + cc, d1), this.f.p(r1, y0 + cc, d1), this.f.p(r1, y0, d1 - cc), this.f.p(r0, y0, d1 - cc)], lo, undefined, wxAt(wx, [[r0, y0 + cc, d1], [r1, y0 + cc, d1], [r1, y0, d1 - cc], [r0, y0, d1 - cc]]));
    }
    if (faces.top) {
      this.quadF(m, 'Y', [[r0, y1, d0], [r1, y1, d0], [r1, y1, d1 - cc], [r0, y1, d1 - cc]], color, undefined, wx);
    }
    if (faces.bottom) {
      this.quadF(m, '-Y', [[r0, y0, d0], [r1, y0, d0], [r1, y0, d1 - cc], [r0, y0, d1 - cc]], lo, undefined, wx);
    }
    if (faces.back) {
      this.quadF(m, '-N', [[r0, y0, d0], [r1, y0, d0], [r1, y1, d0], [r0, y1, d0]], color, undefined, wx);
    }
    const end = (r: number): [number, number, number][] => [
      [r, y0, d0],
      [r, y0, d1 - cc],
      [r, y0 + cc, d1],
      [r, y1 - cc, d1],
      [r, y1, d1 - cc],
      [r, y1, d0],
    ];
    if (faces.left) {
      this.quadF(m, '-R', end(r0), color, undefined, wx);
    }
    if (faces.right) {
      this.quadF(m, 'R', end(r1), color, undefined, wx);
    }
  }

  /**
   * A welded sheet in the frame plane `d` facing `a`: grid quads [r0, r1, y0, y1] that share their corner vertices,
   * with per-vertex colour, `_WEATHER` and a tilted shading normal from `attr` (wavy render, macro variation and
   * weathering gradients need shared, smoothly varying vertices). Emitted on flush through TileMesh.addMesh as one
   * chart per sheet, with UV0 continuous with the flat faces of the same plane. Positions stay planar.
   */
  sheet(m: MaterialName, a: 'N' | '-N', d: number, quads: [number, number, number, number][], attr: (r: number, y: number) => SheetAttr): void {
    if (quads.length) {
      this.sheets.push({ m, a, d, quads, attr });
      this.tris += quads.length * 2;
    }
  }

  private emitSheet(s: Sheet): void {
    const n = this.f.dir(s.a);
    const key = new Map<string, number>();
    const pos: number[] = [];
    const nrm: number[] = [];
    const uvm: number[] = [];
    const col: RGBA[] = [];
    const wx: Weather[] = [];
    const idx: number[] = [];
    let anyWx = false;
    // UV0 in metres as flat faces of this plane get it (mesh.ts faceFrame: u runs right when facing the face, v down).
    const h = Math.hypot(n[0], n[2]) || 1;
    const ux = n[2] / h;
    const uz = -n[0] / h;
    const [tw] = tilingOf(s.m);
    const ou = (this.mesh.ox * ux + this.mesh.oz * uz) % tw;
    const vert = (r: number, y: number): number => {
      const k = `${Math.round(r * 1000)},${Math.round(y * 1000)}`;
      let i = key.get(k);
      if (i === undefined) {
        i = pos.length / 3;
        const p = this.f.p(r, y, s.d);
        pos.push(p[0], p[1], p[2]);
        const at = s.attr(r, y);
        const [tr, ty] = at.tilt ?? [0, 0];
        const sgn = s.a === 'N' ? 1 : -1;
        const t = this.f.vec(sgn * Math.sin(tr), Math.sin(ty), sgn * Math.cos(tr) * Math.cos(ty));
        nrm.push(t[0], t[1], t[2]);
        uvm.push((p[0] - this.mesh.ox) * ux + (p[2] - this.mesh.oz) * uz + ou, -p[1]);
        col.push(at.color);
        wx.push(at.weather ?? ZERO_WX);
        anyWx ||= !!at.weather;
        key.set(k, i);
      }
      return i;
    };
    for (const [r0, r1, y0, y1] of s.quads) {
      const a = vert(r0, y0);
      const b = vert(r1, y0);
      const c = vert(r1, y1);
      const d = vert(r0, y1);
      // Wind so the front face matches the sheet's normal.
      const front = s.a === 'N';
      if (front) {
        idx.push(a, c, b, a, d, c);
      } else {
        idx.push(a, b, c, a, c, d);
      }
    }
    fixWinding(pos, idx, n);
    this.mesh.addMesh(s.m, { positions: pos, indices: idx, normals: nrm, uvm, color: col, ...(anyWx ? { weather: wx } : {}) });
  }

  /** Emits every group as one planar chart each (sheets through addMesh) and clears the batch. */
  flush(): void {
    for (const g of this.groups.values()) {
      if (g.tris.length) {
        this.mesh.flatTriangles(g.m, g.pts, g.tris, g.n, { color: g.col, ...(g.uv ? { uv: g.uv } : {}), ...(g.hasWx ? { weather: g.wx } : {}) });
      }
    }
    for (const s of this.sheets) {
      this.emitSheet(s);
    }
    this.groups = new Map();
    this.sheets = [];
  }
}

/** Per-point `_WEATHER` of a WeatherIn for frame points. */
function wxAt(w: WeatherIn | undefined, pts: readonly [number, number, number][]): Weather | readonly Weather[] | undefined {
  if (!w) {
    return undefined;
  }
  return typeof w === 'function' ? pts.map(([r, y, d]) => w(r, y, d)) : w;
}

/** Flips triangles whose geometric normal points away from `n` (the sheet's facing). */
function fixWinding(pos: readonly number[], idx: number[], n: Vec3): void {
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const ux = pos[b * 3] - pos[a * 3];
    const uy = pos[b * 3 + 1] - pos[a * 3 + 1];
    const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3];
    const vy = pos[c * 3 + 1] - pos[a * 3 + 1];
    const vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) {
      idx[t + 1] = c;
      idx[t + 2] = b;
    }
  }
}

/* Colours. */

export function srgbLin(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear RGBA of an sRGB hex colour, times `k`, with alpha `a`. */
export function lin(hex: number, k = 1, a = 1): RGBA {
  const ch = (s: number): number => Math.min(1, srgbLin(((hex >> s) & 255) / 255) * k);
  return [ch(16), ch(8), ch(0), a];
}

export function scale(c: RGBA, k: number, a = c[3]): RGBA {
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k), a];
}

export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

/** Deterministic hash in [0, 1) of a seed and a salt. */
export function h01(seed: number, salt: number): number {
  const s = Math.sin(seed * 12.9898 + salt * 78.233 + 0.5) * 43758.5453;
  return s - Math.floor(s);
}

export function pick<T>(list: readonly T[], u: number): T {
  return list[Math.min(list.length - 1, Math.floor(u * list.length))];
}

export function pickWeighted<T>(list: readonly (readonly [T, number])[], u: number): T {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [v, w] of list) {
    acc += w / total;
    if (u < acc) {
      return v;
    }
  }
  return list[list.length - 1][0];
}
