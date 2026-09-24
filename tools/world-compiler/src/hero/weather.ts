/**
 * Weathering of the hero buildings (format 1.1, see ../../README.md "Format 1.1 — weathering").
 *
 * `HeroWeather.wrap(mesh)` returns a TileMesh that every hero builder can use unchanged: emissions of the materials
 * listed in the profiles are re-routed to their `@weathered` variant with a per-vertex `_WEATHER`
 * [dirt, streak, edge, damp] and a COLOR_0 multiplier computed from where the vertex is:
 * - dirt: a base amount with low-frequency variation (stone and render never weather evenly), splash grime near the
 *   ground, extra grime on ledges (up-facing) and soffits (down-facing) of trims and reveals, and a grime band under
 *   every shelter line (cornices, eaves, string courses);
 * - streak: rain streaks in the band under the shelter lines (the tiled Leaking003 layer); sill streaks are decals;
 * - edge: on trims, reveals and other small parts (runtimes gate it by convexity, Blender by its bevel estimate);
 * - damp: rising damp and splash at the wall base, its height varying along the wall.
 * Weathering needs vertices where it changes, so vertical planar emissions of weathered materials are cut at a few
 * heights (wall base rows, rows under the shelter lines) and roofs on a world X/Z grid; roof surfaces can be displaced
 * a few centimetres (sagging battens, uneven tiles) and re-emitted with smooth normals.
 *
 * Decal and patch helpers put sill streaks (Leaking003), base bands (Leaking008) and mismatched repair patches on a
 * face. Everything is deterministic (hash noise seeded per building).
 */
import type { EmitOptions, MeshInput, RGBA, TileMesh, Vec2, Vec3, Weather } from '../mesh';
import type { Face, Opening } from './kit';

/* ------------------------------------------------------------------------------------------------------------- */
/* Noise                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------- */

function hashInt(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Value noise in [0, 1] (trilinear, smoothstep). */
export function vnoise(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const tx = smooth(x - xi);
  const ty = smooth(y - yi);
  const tz = smooth(z - zi);
  const c = (dx: number, dy: number, dz: number): number => hashInt(xi + dx, yi + dy, zi + dz, seed);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(l(l(c(0, 0, 0), c(1, 0, 0), tx), l(c(0, 1, 0), c(1, 1, 0), tx), ty), l(l(c(0, 0, 1), c(1, 0, 1), tx), l(c(0, 1, 1), c(1, 1, 1), tx), ty), tz);
}

/** Three octaves of value noise, in [0, 1]. */
export function fbm(x: number, y: number, z: number, seed = 0): number {
  return (vnoise(x, y, z, seed) * 0.57 + vnoise(x * 2.03, y * 2.03, z * 2.03, seed + 11) * 0.29 + vnoise(x * 4.1, y * 4.1, z * 4.1, seed + 23) * 0.14);
}

/** Small deterministic generator for placements (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ------------------------------------------------------------------------------------------------------------- */
/* Profiles                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------- */

/** How one material family weathers (all amounts are `_WEATHER` channel values before the layer strengths). */
export interface WxProfile {
  /** Weathered material id (default `<material>@weathered`). */
  to?: string;
  /** Base dirt and its low-frequency variation (± amount). */
  dirt: number;
  vary: number;
  /** Splash grime at the ground, fading out by `splashH` m. */
  splash?: number;
  splashH?: number;
  /** Rising damp at the ground, fading out by `dampH` m (the height varies ±40 % along the wall). */
  damp?: number;
  dampH?: number;
  /** Extra dirt on up-facing / down-facing / other faces of small parts (trims, reveals, boxes). */
  up?: number;
  down?: number;
  side?: number;
  /** Edge wear on small parts. */
  edge?: number;
  /** Streak coverage right under a shelter line (fades over `bandH` m). */
  streak?: number;
  bandH?: number;
  /** COLOR_0 brightness variation (0.06 = up to 6 % darker in patches). */
  tint?: number;
  /** Roofs: X/Z grid (m) for the dirt patches, and a displacement amplitude (m) re-emitted with smooth normals. */
  grid?: number;
  displace?: number;
}

export interface HeroWeatherOptions {
  seed: number;
  /** World ground height under (x, z). */
  ground: (x: number, z: number) => number;
  /** Profiles by base material id. */
  profiles: Record<string, WxProfile>;
  /** World heights of shelter lines (the underside of cornices, eaves, string courses, terrace edges). */
  shelters?: number[];
  /** Extra weathering added to a vertex of material m (e.g. traffic wear along a path), before clamping. */
  extra?: (p: Vec3, n: Vec3, m: string) => Weather | undefined;
}

interface Vx {
  p: Vec3;
  uv?: Vec2;
  uvm?: Vec2;
  c?: RGBA;
}

const lerpV = (a: Vx, b: Vx, t: number): Vx => ({
  p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
  ...(a.uv && b.uv ? { uv: [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t] as Vec2 } : {}),
  ...(a.uvm && b.uvm ? { uvm: [a.uvm[0] + (b.uvm[0] - a.uvm[0]) * t, a.uvm[1] + (b.uvm[1] - a.uvm[1]) * t] as Vec2 } : {}),
  ...(a.c && b.c ? { c: [a.c[0] + (b.c[0] - a.c[0]) * t, a.c[1] + (b.c[1] - a.c[1]) * t, a.c[2] + (b.c[2] - a.c[2]) * t, a.c[3] + (b.c[3] - a.c[3]) * t] as RGBA } : {}),
});

/** Splits a convex polygon by the plane dot(p, axis) = level into the parts below and above. */
function splitPoly(poly: readonly Vx[], axis: Vec3, level: number): [Vx[], Vx[]] {
  const lo: Vx[] = [];
  const hi: Vx[] = [];
  const d = (v: Vx): number => v.p[0] * axis[0] + v.p[1] * axis[1] + v.p[2] * axis[2] - level;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    const da = d(a);
    const db = d(b);
    if (da <= 0) {
      lo.push(a);
    }
    if (da >= 0) {
      hi.push(a);
    }
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const m = lerpV(a, b, da / (da - db));
      lo.push(m);
      hi.push(m);
    }
  }
  return [lo, hi];
}

interface CutSet {
  axis: Vec3;
  levels: number[];
}

/* ------------------------------------------------------------------------------------------------------------- */
/* The weathering mesh wrapper                                                                                     */
/* ------------------------------------------------------------------------------------------------------------- */

export class HeroWeather {
  readonly seed: number;
  private readonly shelters: number[];
  /** Triangles added by the cuts (bookkeeping for the hero record). */
  added = 0;

  constructor(readonly o: HeroWeatherOptions) {
    this.seed = o.seed;
    this.shelters = [...(o.shelters ?? [])].sort((a, b) => a - b);
  }

  profile(m: string): WxProfile | undefined {
    return this.o.profiles[m];
  }

  target(m: string): string {
    const p = this.o.profiles[m];
    return p?.to ?? `${m}@weathered`;
  }

  /** `_WEATHER` of a vertex. `small`: a vertex of a small part (trims, reveals, boxes) rather than a wall plane. */
  weather(p: Vec3, n: Vec3, prof: WxProfile, small: boolean, m = ''): Weather {
    const g = this.o.ground(p[0], p[2]);
    const h = p[1] - g;
    const s = this.seed;
    const N = fbm(p[0] * 0.28, p[1] * 0.28, p[2] * 0.28, s);
    const N2 = vnoise(p[0] * 0.9 + 17.3, p[1] * 0.9, p[2] * 0.9, s + 5);
    const vertical = Math.abs(n[1]) < 0.5;
    let dirt = prof.dirt + prof.vary * (N - 0.5) * 2;
    let streak = 0;
    let damp = 0;
    const sh = prof.splashH ?? 0;
    if (sh > 0 && h < sh) {
      dirt += (prof.splash ?? 0) * Math.pow(1 - Math.max(0, h) / sh, 1.4);
    }
    if (small) {
      dirt += n[1] > 0.6 ? prof.up ?? 0 : n[1] < -0.6 ? prof.down ?? 0 : prof.side ?? 0;
    }
    if (vertical) {
      const band = prof.bandH ?? 1.6;
      for (const y of this.shelters) {
        const dy = y - p[1];
        if (dy >= -0.02 && dy < band) {
          const t = Math.max(0, dy) / band;
          dirt += 0.22 * (1 - t) * (1 - t);
          streak = Math.max(streak, (prof.streak ?? 0) * Math.pow(1 - t, 1.2) * (0.55 + 0.9 * N2));
        }
      }
      const dh = (prof.dampH ?? 0) * (0.6 + 0.8 * N);
      if (dh > 0 && h < dh) {
        damp = (prof.damp ?? 0) * Math.pow(1 - Math.max(0, h) / dh, 1.3);
      }
    }
    let edge = small ? (prof.edge ?? 0) * (0.65 + 0.7 * N2) : 0;
    const x = this.o.extra?.(p, n, m);
    if (x) {
      dirt += x[0];
      streak += x[1];
      edge += x[2];
      damp += x[3];
    }
    return [clamp01(dirt), clamp01(streak), clamp01(edge), clamp01(damp)];
  }

  /** COLOR_0 multiplier of a vertex (patchy brightness variation). */
  tint(p: Vec3, prof: WxProfile): number {
    const a = prof.tint ?? 0;
    if (a <= 0) {
      return 1;
    }
    const N = fbm(p[0] * 0.17 + 3.1, p[1] * 0.17, p[2] * 0.17, this.seed + 91);
    return 1 - a * clamp01((N - 0.3) / 0.5);
  }

  /** Cut planes of a planar emission of a weathered material. */
  private cuts(pts: readonly Vec3[], n: Vec3, prof: WxProfile): CutSet[] {
    const out: CutSet[] = [];
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of pts) {
      yMin = Math.min(yMin, p[1]);
      yMax = Math.max(yMax, p[1]);
    }
    if (prof.grid) {
      const G = prof.grid;
      for (const axis of [
        [1, 0, 0],
        [0, 0, 1],
      ] as Vec3[]) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const p of pts) {
          const d = p[0] * axis[0] + p[2] * axis[2];
          lo = Math.min(lo, d);
          hi = Math.max(hi, d);
        }
        const levels: number[] = [];
        for (let v = Math.ceil(lo / G) * G; v < hi; v += G) {
          if (v - lo > 0.05 && hi - v > 0.05) {
            levels.push(v);
          }
        }
        if (levels.length) {
          out.push({ axis, levels });
        }
      }
      return out;
    }
    if (Math.abs(n[1]) >= 0.5) {
      return out;
    }
    const levels: number[] = [];
    const add = (y: number): void => {
      if (y > yMin + 0.08 && y < yMax - 0.08 && !levels.some((q) => Math.abs(q - y) < 0.12)) {
        levels.push(y);
      }
    };
    let gMin = Infinity;
    let gMax = -Infinity;
    for (const p of pts) {
      const g = this.o.ground(p[0], p[2]);
      gMin = Math.min(gMin, g);
      gMax = Math.max(gMax, g);
    }
    if ((prof.dampH ?? 0) > 0 || (prof.splashH ?? 0) > 0) {
      for (const g of gMax - gMin > 0.3 ? [gMin, gMax] : [gMin]) {
        for (const d of [0.35, 1.0]) {
          add(g + d);
        }
      }
    }
    if ((prof.streak ?? 0) > 0) {
      const band = prof.bandH ?? 1.6;
      for (const y of this.shelters) {
        if (y > yMin && y - band < yMax) {
          add(y - 0.02);
          add(y - band);
        }
      }
    }
    levels.sort((a, b) => a - b);
    return levels.length ? [{ axis: [0, 1, 0], levels }] : [];
  }

  /** Planar triangles of a weathered material: cut, weathered, tinted, optionally displaced. */
  private planar(mesh: TileMesh, m: string, prof: WxProfile, pts: readonly Vec3[], tris: readonly number[], n: Vec3, opts: EmitOptions | undefined): void {
    const to = this.target(m);
    const colorAt = (k: number): RGBA | undefined => {
      const c = opts?.color;
      if (!c) {
        return undefined;
      }
      return typeof c[0] === 'number' ? (c as RGBA) : (c as readonly RGBA[])[k];
    };
    const vx = (k: number): Vx => ({ p: pts[k], ...(opts?.uv ? { uv: opts.uv[k] } : {}), ...(opts?.uvm ? { uvm: opts.uvm[k] } : {}), ...(colorAt(k) ? { c: colorAt(k) } : {}) });
    const cutSets = this.cuts(pts, n, prof);
    let pieces: Vx[][] = [];
    for (let k = 0; k < tris.length; k += 3) {
      pieces.push([vx(tris[k]), vx(tris[k + 1]), vx(tris[k + 2])]);
    }
    for (const cs of cutSets) {
      for (const level of cs.levels) {
        const next: Vx[][] = [];
        for (const poly of pieces) {
          let lo = Infinity;
          let hi = -Infinity;
          for (const v of poly) {
            const d = v.p[0] * cs.axis[0] + v.p[1] * cs.axis[1] + v.p[2] * cs.axis[2];
            lo = Math.min(lo, d);
            hi = Math.max(hi, d);
          }
          if (level <= lo + 1e-6 || level >= hi - 1e-6) {
            next.push(poly);
            continue;
          }
          const [a, b] = splitPoly(poly, cs.axis, level);
          if (a.length >= 3) {
            next.push(a);
          }
          if (b.length >= 3) {
            next.push(b);
          }
        }
        pieces = next;
      }
    }
    // Weld and triangulate the pieces (fans: every piece is convex).
    const keyOf = (p: Vec3): string => `${Math.round(p[0] * 2e4)},${Math.round(p[1] * 2e4)},${Math.round(p[2] * 2e4)}`;
    const ids = new Map<string, number>();
    const verts: Vx[] = [];
    const out: number[] = [];
    for (const poly of pieces) {
      const idx = poly.map((v) => {
        const key = keyOf(v.p);
        let i = ids.get(key);
        if (i === undefined) {
          i = verts.length;
          ids.set(key, i);
          verts.push(v);
        }
        return i;
      });
      for (let k = 1; k + 1 < idx.length; k++) {
        if (idx[0] !== idx[k] && idx[k] !== idx[k + 1] && idx[0] !== idx[k + 1]) {
          out.push(idx[0], idx[k], idx[k + 1]);
        }
      }
    }
    this.added += out.length / 3 - tris.length / 3;
    const weather = verts.map((v) => this.weather(v.p, n, prof, false, m));
    const color = verts.map((v) => {
      const t = this.tint(v.p, prof);
      const c = v.c ?? [1, 1, 1, 1];
      return [c[0] * t, c[1] * t, c[2] * t, c[3]] as RGBA;
    });
    const uvIn = verts.every((v) => v.uv) ? verts.map((v) => v.uv!) : undefined;
    const uvmIn = verts.every((v) => v.uvm) ? verts.map((v) => v.uvm!) : undefined;
    if (prof.displace) {
      // Uneven roof: displace along the normal by low-frequency noise and re-emit with smooth normals.
      const A = prof.displace;
      const positions: number[] = [];
      for (const v of verts) {
        const d = A * ((fbm(v.p[0] * 0.45, v.p[1] * 0.45, v.p[2] * 0.45, this.seed + 7) - 0.5) * 2 + 0.35 * (vnoise(v.p[0] * 2.2, v.p[1] * 2.2, v.p[2] * 2.2, this.seed + 3) - 0.5));
        positions.push(v.p[0] + n[0] * d, v.p[1] + n[1] * d, v.p[2] + n[2] * d);
      }
      // Winding from the given normal (addMesh computes smooth normals from it).
      const idx: number[] = [];
      for (let k = 0; k < out.length; k += 3) {
        const a = verts[out[k]].p;
        const b = verts[out[k + 1]].p;
        const c = verts[out[k + 2]].p;
        const cx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
        const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (cx * n[0] + cy * n[1] + cz * n[2] < 0) {
          idx.push(out[k], out[k + 2], out[k + 1]);
        } else {
          idx.push(out[k], out[k + 1], out[k + 2]);
        }
      }
      const input: MeshInput = {
        positions,
        indices: idx,
        ...(uvIn ? { uv: uvIn.flat() } : {}),
        ...(uvmIn ? { uvm: uvmIn.flat() } : {}),
        ...(uvIn || uvmIn ? {} : { uvm: this.planeUv(verts.map((v) => v.p), n) }),
        color,
        weather,
        ...(opts?.lod !== undefined ? { lod: opts.lod } : {}),
      };
      mesh.addMesh(to, input);
      return;
    }
    mesh.flatTriangles(
      to,
      verts.map((v) => v.p),
      out,
      n,
      {
        ...(uvIn ? { uv: uvIn } : {}),
        ...(uvmIn ? { uvm: uvmIn } : {}),
        color,
        weather,
        ...(opts?.lod !== undefined ? { lod: opts.lod } : {}),
      },
    );
  }

  /** Metre UVs in the plane of `n` (right / up), as the tile mesh projects flat faces. */
  private planeUv(pts: readonly Vec3[], n: Vec3): number[] {
    const up: Vec3 = Math.abs(n[1]) > 0.7 ? [0, 0, 1] : [0, 1, 0];
    // r = up × n (right when facing the face), v = down the image.
    let rx = up[1] * n[2] - up[2] * n[1];
    let ry = up[2] * n[0] - up[0] * n[2];
    let rz = up[0] * n[1] - up[1] * n[0];
    const l = Math.hypot(rx, ry, rz) || 1;
    rx /= l;
    ry /= l;
    rz /= l;
    const vx = n[1] * rz - n[2] * ry;
    const vy = n[2] * rx - n[0] * rz;
    const vz = n[0] * ry - n[1] * rx;
    const out: number[] = [];
    for (const p of pts) {
      out.push(p[0] * rx + p[1] * ry + p[2] * rz, -(p[0] * vx + p[1] * vy + p[2] * vz));
    }
    return out;
  }

  /** Small parts (Builder meshes: trims, reveals, boxes): per-vertex weather and tint, no cuts. */
  private small(mesh: TileMesh, m: string, prof: WxProfile, input: MeshInput): void {
    const P = input.positions;
    const N = input.normals;
    const nv = P.length / 3;
    const weather: Weather[] = [];
    const color: RGBA[] = [];
    const inCol = input.color;
    for (let i = 0; i < nv; i++) {
      const p: Vec3 = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
      const n: Vec3 = N ? [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]] : [0, 1, 0];
      weather.push(this.weather(p, n, prof, true, m));
      const t = this.tint(p, prof);
      const c = inCol ? (typeof inCol[0] === 'number' ? (inCol as RGBA) : (inCol as readonly RGBA[])[i]) : [1, 1, 1, 1];
      color.push([c[0] * t, c[1] * t, c[2] * t, c[3]]);
    }
    mesh.addMesh(this.target(m), { ...input, weather, color });
  }

  /** The tile mesh seen through the weathering: emissions of profiled materials become weathered variants. */
  wrap(mesh: TileMesh): TileMesh {
    const self = this;
    return new Proxy(mesh, {
      get(target, prop) {
        if (prop === 'flatTriangles') {
          return (m: string, pts: readonly Vec3[], tris: readonly number[], n: Vec3, opts?: EmitOptions): void => {
            const prof = self.o.profiles[m];
            if (!prof) {
              target.flatTriangles(m, pts, tris, n, opts);
              return;
            }
            self.planar(target, m, prof, pts, tris, n, opts);
          };
        }
        if (prop === 'flatPolygon') {
          return (m: string, pts: readonly Vec3[], n: Vec3, opts?: EmitOptions): void => {
            const prof = self.o.profiles[m];
            if (!prof) {
              target.flatPolygon(m, pts, n, opts);
              return;
            }
            const tris: number[] = [];
            for (let k = 1; k + 1 < pts.length; k++) {
              tris.push(0, k, k + 1);
            }
            self.planar(target, m, prof, pts, tris, n, opts);
          };
        }
        if (prop === 'addMesh') {
          return (m: string, input: MeshInput): void => {
            const prof = self.o.profiles[m];
            if (!prof) {
              target.addMesh(m, input);
              return;
            }
            self.small(target, m, prof, input);
          };
        }
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
      set(target, prop, value) {
        return Reflect.set(target, prop, value, target);
      },
    });
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Decals and patches on a kit face                                                                                */
/* ------------------------------------------------------------------------------------------------------------- */

/** Decal materials of the heroes (hero/materials.ts). */
export const LEAK = 'hero_leak';
export const LEAK_BAND = 'hero_leak_band';

export interface StreakStyle {
  /** Linear RGB tint and alpha of the decal. */
  color: RGBA;
  /** Streak length range under the sill (m). */
  len: [number, number];
  /** Probability that an opening gets a streak. */
  p?: number;
}

/**
 * Leaking003 streaks under the sills of the non-door openings of a face (the stain starts at the sill's underside
 * and fades down), each a random crop of the image so no two match.
 */
export function sillStreaks(mesh: TileMesh, face: Face, ops: readonly Opening[], sillH: number, st: StreakStyle, seed: number): number {
  const r = rng(seed);
  let n = 0;
  for (const o of ops) {
    if (o.door || r() > (st.p ?? 1)) {
      continue;
    }
    const len = st.len[0] + (st.len[1] - st.len[0]) * r();
    const w = o.w * (0.85 + 0.45 * r());
    const top = o.y0 - sillH - 0.01;
    const u0 = r() * 0.5;
    const a = st.color[3] * (0.7 + 0.5 * r());
    mesh.decal(LEAK, face.p(o.s + (r() - 0.5) * 0.12, top - len / 2, 0), face.n, { size: [w, len], offset: 0.012, rect: [u0, 0, u0 + 0.5, 0.92], color: [st.color[0], st.color[1], st.color[2], Math.min(1, a)] });
    n++;
  }
  return n;
}

/** A Leaking003 streak of width w and length len hanging from height `top` at s. */
export function streakAt(mesh: TileMesh, face: Face, s: number, top: number, w: number, len: number, color: RGBA, seed: number, offset = 0.012): void {
  const r = rng(seed);
  const u0 = r() * 0.5;
  mesh.decal(LEAK, face.p(s, top - len / 2, 0), face.n, { size: [w, len], offset, rect: [u0, 0, u0 + 0.5, 0.95], color });
}

/**
 * Leaking008 grime bands rising from the ground along a face between s0 and s1 (skipping the spans in `skip`), in
 * pieces of 1.2–2.6 m with varying heights. `groundY(s)` is the ground height (face y) under s.
 */
export function baseBands(mesh: TileMesh, face: Face, s0: number, s1: number, groundY: (s: number) => number, skip: readonly [number, number][], color: RGBA, h: [number, number], seed: number): number {
  const r = rng(seed);
  let s = s0;
  let n = 0;
  while (s < s1 - 0.3) {
    const w = Math.min(s1 - s, 1.2 + 1.4 * r());
    const a = s;
    const b = s + w;
    s = b - 0.15;
    if (skip.some(([p, q]) => b > p && a < q)) {
      // Trim the piece to the free part left of the first blocking span.
      const blk = skip.filter(([p, q]) => b > p && a < q).sort((x, y) => x[0] - y[0])[0];
      if (blk[0] - a < 0.4) {
        s = Math.max(s, blk[1] + 0.02);
        continue;
      }
      emitBand(mesh, face, a, blk[0], groundY, color, h, r);
      s = blk[1] + 0.02;
      n++;
      continue;
    }
    emitBand(mesh, face, a, b, groundY, color, h, r);
    n++;
  }
  return n;
}

function emitBand(mesh: TileMesh, face: Face, a: number, b: number, groundY: (s: number) => number, color: RGBA, h: [number, number], r: () => number): void {
  const hh = h[0] + (h[1] - h[0]) * r();
  const g = Math.min(groundY(a), groundY(b), groundY((a + b) / 2));
  const u0 = r() * 0.55;
  const uw = Math.min(0.45, ((b - a) / 2.6) * 0.45 + 0.1);
  mesh.decal(LEAK_BAND, face.p((a + b) / 2, g - 0.05 + hh / 2, 0), face.n, { size: [b - a, hh], offset: 0.011, rect: [u0, 0.02, u0 + uw, 1], color: [color[0], color[1], color[2], color[3] * (0.75 + 0.4 * r())] });
}

/**
 * Mismatched repair patches: `count` rectangles of the patch material (a variant of the wall's, slightly off in
 * colour) 4 mm in front of the face, placed on free wall (clear of the openings grown by 0.25 m) between s0..s1 and
 * y0..y1.
 */
export function repairPatches(mesh: TileMesh, m: string, face: Face, s0: number, s1: number, y0: number, y1: number, ops: readonly Opening[], count: number, tints: readonly RGBA[], seed: number, size: [number, number] = [0.5, 1.6]): number {
  const r = rng(seed);
  let placed = 0;
  for (let tries = 0; tries < count * 12 && placed < count; tries++) {
    const w = size[0] + (size[1] - size[0]) * r();
    const h = size[0] + (size[1] - size[0]) * r() * 0.8;
    const s = s0 + w / 2 + (s1 - s0 - w) * r();
    const y = y0 + h / 2 + (y1 - y0 - h) * r();
    if (s1 - s0 < w || y1 - y0 < h) {
      break;
    }
    const hit = ops.some((o) => s + w / 2 > o.s - o.w / 2 - 0.25 && s - w / 2 < o.s + o.w / 2 + 0.25 && y + h / 2 > o.y0 - 0.35 && y - h / 2 < o.ys + (o.kind === 'flat' ? 0 : o.w * 0.75) + 0.35);
    if (hit) {
      continue;
    }
    const c = tints[Math.floor(r() * tints.length)];
    const pts = [face.p(s - w / 2, y - h / 2, 0.004), face.p(s + w / 2, y - h / 2, 0.004), face.p(s + w / 2, y + h / 2, 0.004), face.p(s - w / 2, y + h / 2, 0.004)];
    mesh.flatPolygon(m, pts, face.n, { color: c, weather: [0.05, 0, 0, 0] });
    placed++;
  }
  return placed;
}
