/**
 * Street ground of full-detail tiles (format 1): the greybox ground of ../ground.ts (1 m cells cut along the land,
 * carriageway and footway contours) with more contours and real paving:
 * - kerb stones: a granite strip KERB_WIDTH wide on the pavement side of every kerbed carriageway, with a
 *   KERB_BEVEL bevel on its front arris and a granite face; UVs run along the kerb, so the stone joints line up;
 * - gutters: a concrete band GUTTER_WIDTH wide on the carriageway in front of the kerb;
 * - dropped kerbs at marked crossings (the pavement ramps down to DROPPED_KERB above the carriageway);
 * - granite coping COPING_WIDTH wide on the quay edge and stone quay walls;
 * - paving per street: patched asphalt on main roads, slabs in the pedestrian lanes (küp taş where OSM tags sett /
 *   cobblestone), pavers on sidewalks and squares; paving UVs follow the street's axis (world-metre scale);
 * - COLOR_0 wear: low-frequency blotches everywhere, gutter dirt in front of kerbs and contact darkening within
 *   GRIME_WALL of façades (an extra contour of the building distance keeps it 0.4 m wide).
 * Greybox tiles and format 0 keep the core ground (../core-steps.ts groundStep), byte for byte.
 */
import { bounds, pointInRing, segDist } from '../../../../src/world/osm/shared/geometry';
import { Ground, groundOf, PATH_RANGE, Surf, type Street } from '../../../../src/world/osm/shared/street-field';
import { MASK_RANGE } from '../../../../src/world/osm/shared/protocol';
import { groundStep, type GroundTotals } from '../core-steps';
import { buildGround, QUAY_BOTTOM } from '../ground';
import type { MaterialName } from '../materials';
import { LOD0, LOD1, LOD2, type RGBA, type Vec2, type Vec3, type Weather } from '../mesh';
import type { CompileStep, TileContext } from '../registry';
import { COPING_WIDTH, GUTTER_WIDTH, hash, KERB_BEVEL, KERB_WIDTH, streetContext, streetTile, valueNoise, type StreetContext } from './common';
import { groundWeather, wearPlan, type WearPatch } from './wear';

const CELL = 1;
const PAVED_REACH = MASK_RANGE * 0.75;
/** COLOR_0 must stay in [0, 1] (glTF). */
const c01 = (v: number): number => Math.min(1, Math.max(0, v));
const rgba = (r: number, g: number, b: number): RGBA => [c01(r), c01(g), c01(b), 1];
const PATH_REACH = PATH_RANGE * 0.75;
/** Width (m) of the contact darkening at façades. */
const GRIME_WALL = 0.4;
/** Granite edging around mapped greens (m). */
const GREEN_EDGE = 0.12;
/** Depth of the soil in a tree pit below the paving (m). */
const PIT_DEPTH = 0.05;
/** Depth of the skirt under the ground's tile-border edges (m). */
const SKIRT = 0.5;

const TAG_NONE = 0;
const TAG_COAST = 1;
const TAG_KERB = 2;

type Field = 'L' | 'D' | 'P' | 'B' | 'G' | 'W' | 'K' | 'Q' | 'S' | 'A';
interface V {
  x: number;
  z: number;
  L: number;
  D: number;
  P: number;
  B: number;
  /** Signed distance to mapped greens (positive inside). */
  G: number;
  /** Dropped-kerb depth (m). */
  W: number;
  /**
   * Material borders as fields, so pieces are cut along them instead of taking the raster's per-texel flags at their
   * centre (which draws the borders as 1 m saw teeth): K > 0 where a kerbed street is the nearest (winning) one, Q > 0
   * where a pedestrian street is, S = D - sidewalk width of the winning street (< 0 on its sidewalk), A > 0 inside
   * paved OSM areas (squares, platforms, quays, worship grounds).
   */
  K: number;
  Q: number;
  S: number;
  A: number;
}
interface Poly {
  v: V[];
  tag: number[];
}

const lerpV = (a: V, b: V, t: number): V => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
  L: a.L + (b.L - a.L) * t,
  D: a.D + (b.D - a.D) * t,
  P: a.P + (b.P - a.P) * t,
  B: a.B + (b.B - a.B) * t,
  G: a.G + (b.G - a.G) * t,
  W: a.W + (b.W - a.W) * t,
  K: a.K + (b.K - a.K) * t,
  Q: a.Q + (b.Q - a.Q) * t,
  S: a.S + (b.S - a.S) * t,
  A: a.A + (b.A - a.A) * t,
});

function split(p: Poly, f: Field, newTag: number, level = 0): { neg: Poly | null; pos: Poly | null } {
  const neg: Poly = { v: [], tag: [] };
  const pos: Poly = { v: [], tag: [] };
  const n = p.v.length;
  for (let i = 0; i < n; i++) {
    const a = p.v[i];
    const b = p.v[(i + 1) % n];
    const fa = a[f] - level;
    const fb = b[f] - level;
    const sa = fa >= 0;
    const sb = fb >= 0;
    const here = sa ? pos : neg;
    here.v.push(a);
    here.tag.push(p.tag[i]);
    if (sa !== sb) {
      const c = lerpV(a, b, fa / (fa - fb));
      here.v.push(c);
      here.tag.push(newTag);
      const there = sa ? neg : pos;
      there.v.push(c);
      there.tag.push(p.tag[i]);
    }
  }
  const ok = (q: Poly): Poly | null => (q.v.length >= 3 ? q : null);
  return { neg: ok(neg), pos: ok(pos) };
}

/** Splits a polygon by the sign of a function of position that is linear in x and z (exact for half-planes). */
function splitFn(p: Poly, fn: (x: number, z: number) => number): { neg: Poly | null; pos: Poly | null } {
  const neg: Poly = { v: [], tag: [] };
  const pos: Poly = { v: [], tag: [] };
  const n = p.v.length;
  for (let i = 0; i < n; i++) {
    const a = p.v[i];
    const b = p.v[(i + 1) % n];
    const fa = fn(a.x, a.z);
    const fb = fn(b.x, b.z);
    const sa = fa >= 0;
    const sb = fb >= 0;
    const here = sa ? pos : neg;
    here.v.push(a);
    here.tag.push(p.tag[i]);
    if (sa !== sb) {
      const c = lerpV(a, b, fa / (fa - fb));
      here.v.push(c);
      here.tag.push(TAG_NONE);
      const there = sa ? neg : pos;
      there.v.push(c);
      there.tag.push(p.tag[i]);
    }
  }
  const ok = (q: Poly): Poly | null => (q.v.length >= 3 ? q : null);
  return { neg: ok(neg), pos: ok(pos) };
}

/** Cuts polygons along the edges of the wear patches that meet them (convex patches: exact straight cuts). */
function cutPatches(ps: Poly[], patchesIn: (minX: number, minZ: number, maxX: number, maxZ: number) => WearPatch[]): Poly[] {
  const out: Poly[] = [];
  for (const q of ps) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const v of q.v) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minZ = Math.min(minZ, v.z);
      maxZ = Math.max(maxZ, v.z);
    }
    let work = [q];
    for (const pa of patchesIn(minX, minZ, maxX, maxZ)) {
      const next: Poly[] = [];
      for (const w of work) {
        let inside: Poly | null = w;
        for (const [nx, nz, c] of pa.edges) {
          const r = splitFn(inside, (x, z) => nx * x + nz * z - c);
          if (r.pos) {
            next.push(r.pos);
          }
          inside = r.neg;
          if (!inside) {
            break;
          }
        }
        if (inside) {
          next.push(inside);
        }
      }
      work = next;
    }
    out.push(...work);
  }
  return out;
}

const splitAll = (ps: Poly[], f: Field, level: number): Poly[] =>
  ps.flatMap((q) => {
    const r = split(q, f, TAG_NONE, level);
    return [r.neg, r.pos].filter((x): x is Poly => x !== null);
  });

const FIELDS = ['x', 'z', 'L', 'D', 'P', 'B', 'G', 'W', 'K', 'Q', 'S', 'A'] as const;

function centre(p: Poly): V {
  const c: V = { x: 0, z: 0, L: 0, D: 0, P: 0, B: 0, G: 0, W: 0, K: 0, Q: 0, S: 0, A: 0 };
  const n = p.v.length;
  for (const v of p.v) {
    for (const f of FIELDS) {
      c[f] += v[f] / n;
    }
  }
  return c;
}

/** Paving frame: u along the axis angle, v across, both in metres from an origin. */
interface Frame {
  key: string;
  cos: number;
  sin: number;
  ox: number;
  oz: number;
}

const WORLD: Frame = { key: 'world', cos: 1, sin: 0, ox: 0, oz: 0 };

/** Welded mesh of one material and paving frame (emitted with addMesh: one chart per connected patch). */
class Patch {
  pos: number[] = [];
  uvm: number[] = [];
  col: RGBA[] = [];
  wx: Weather[] = [];
  idx: number[] = [];
  private readonly weld = new Map<string, number>();

  constructor(readonly frame: Frame) {}

  vertex(p: Vec3, c: RGBA, w: Weather): number {
    const key = `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)},${Math.round(p[2] * 1000)}`;
    let i = this.weld.get(key);
    if (i === undefined) {
      i = this.pos.length / 3;
      this.pos.push(p[0], p[1], p[2]);
      const dx = p[0] - this.frame.ox;
      const dz = p[2] - this.frame.oz;
      this.uvm.push(dx * this.frame.cos + dz * this.frame.sin, -dx * this.frame.sin + dz * this.frame.cos);
      this.col.push(c);
      this.wx.push(w);
      this.weld.set(key, i);
    }
    return i;
  }

  polygon(pts: Vec3[], cols: RGBA[], wx: Weather[]): void {
    const ids = pts.map((p, k) => this.vertex(p, cols[k], wx[k]));
    for (let k = 1; k + 1 < ids.length; k++) {
      const [a, b, c] = [ids[0], ids[k], ids[k + 1]];
      if (a === b || b === c || a === c) {
        continue;
      }
      // Wind counter-clockwise seen from above (+Y normal).
      const P = this.pos;
      const cross = (P[b * 3 + 2] - P[a * 3 + 2]) * (P[c * 3] - P[a * 3]) - (P[b * 3] - P[a * 3]) * (P[c * 3 + 2] - P[a * 3 + 2]);
      if (Math.abs(cross) < 1e-10) {
        continue;
      }
      if (cross > 0) {
        this.idx.push(a, b, c);
      } else {
        this.idx.push(a, c, b);
      }
    }
  }
}

export interface StreetGroundStats {
  kerbStoneM: number;
  gutterM: number;
  copingM: number;
  droppedKerbs: number;
}

function isMain(st: Street): boolean {
  return /^(trunk|primary|secondary|tertiary)/.test(st.kind);
}

/** Emits the street ground of one full-detail tile. */
export function buildStreetGround(t: TileContext, sc: StreetContext, totals: GroundTotals): StreetGroundStats {
  const a = t.area;
  const s = a.foundation.surface;
  const mesh = t.mesh;
  const tile = t.bounds;
  const nx = Math.round((tile.maxX - tile.minX) / CELL);
  const nz = Math.round((tile.maxZ - tile.minZ) / CELL);
  const W = nx + 1;
  const n = W * (nz + 1);
  const L = new Float32Array(n);
  const D = new Float32Array(n);
  const P = new Float32Array(n);
  const B = new Float32Array(n);
  const G = new Float32Array(n);
  const Wd = new Float32Array(n);
  const inside = new Int32Array(n);
  const K = new Float32Array(n);
  const Q = new Float32Array(n);
  const S = new Float32Array(n);
  const A = new Float32Array(n);
  const pavedAreas = a.data.areas.filter((ar) => {
    const g = groundOf(ar);
    if (g !== Ground.Plaza && g !== Ground.Worship && g !== Ground.Platform && g !== Ground.Quay) {
      return false;
    }
    const b = bounds(ar.ring);
    return b.maxX > tile.minX - 5 && b.minX < tile.maxX + 5 && b.maxZ > tile.minZ - 5 && b.minZ < tile.maxZ + 5;
  });
  /** Signed distance to the paved OSM areas (positive inside), clamped to ±3 m. */
  const pavedDist = (x: number, z: number): number => {
    let best = -3;
    for (const ar of pavedAreas) {
      const r = ar.ring;
      let d = Infinity;
      const m = r.length / 2;
      for (let i = 0, j = m - 1; i < m; j = i++) {
        d = Math.min(d, segDist(x, z, r[j * 2], r[j * 2 + 1], r[i * 2], r[i * 2 + 1]));
      }
      best = Math.max(best, pointInRing(r, x, z) ? Math.min(d, 3) : -Math.min(d, 3));
    }
    return best;
  };
  const greens = a.data.areas.filter((ar) => {
    const g = groundOf(ar);
    if (g !== Ground.Grass && g !== Ground.Pitch) {
      return false;
    }
    const b = bounds(ar.ring);
    return b.maxX > tile.minX - 5 && b.minX < tile.maxX + 5 && b.maxZ > tile.minZ - 5 && b.minZ < tile.maxZ + 5;
  });
  const greenDist = (x: number, z: number): number => {
    let best = -3;
    for (const ar of greens) {
      const r = ar.ring;
      let d = Infinity;
      const m = r.length / 2;
      for (let i = 0, j = m - 1; i < m; j = i++) {
        d = Math.min(d, segDist(x, z, r[j * 2], r[j * 2 + 1], r[i * 2], r[i * 2 + 1]));
      }
      best = Math.max(best, pointInRing(r, x, z) ? Math.min(d, 3) : -Math.min(d, 3));
    }
    return best;
  };
  // Raised solids (building=roof canopies, bridges) stand over paving: the ground under them stays.
  const raised = a.solids.filter((q) => {
    if (q.grounded) {
      return false;
    }
    const b = bounds(q.ring);
    return b.maxX > tile.minX - 1 && b.minX < tile.maxX + 1 && b.maxZ > tile.minZ - 1 && b.minZ < tile.maxZ + 1;
  });
  const grounded = raised.length ? a.solids.filter((q) => q.grounded && raised.some((r) => bounds(r.ring).maxX > bounds(q.ring).minX && bounds(r.ring).minX < bounds(q.ring).maxX && bounds(r.ring).maxZ > bounds(q.ring).minZ && bounds(r.ring).minZ < bounds(q.ring).maxZ)) : [];
  /** Within 0.6 m of a raised solid's outline and not in a grounded one: no contact darkening from its footprint. */
  const nearRaised = (x: number, z: number): boolean => {
    if (grounded.some((q) => pointInRing(q.ring, x, z))) {
      return false;
    }
    for (const q of raised) {
      const r = q.ring;
      const m = r.length / 2;
      if (pointInRing(r, x, z)) {
        return true;
      }
      for (let i = 0, j = m - 1; i < m; j = i++) {
        if (segDist(x, z, r[j * 2], r[j * 2 + 1], r[i * 2], r[i * 2 + 1]) < 0.6) {
          return true;
        }
      }
    }
    return false;
  };
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = tile.minX + i * CELL;
      const z = tile.minZ + j * CELL;
      const k = j * W + i;
      L[k] = a.land(x, z);
      D[k] = s.distance(x, z);
      P[k] = s.pathDistance(x, z);
      B[k] = s.buildingDistance(x, z);
      if (raised.length && B[k] < 1 && nearRaised(x, z)) {
        B[k] = 1;
      }
      G[k] = greens.length ? greenDist(x, z) : -3;
      Wd[k] = sc.drop(x, z);
      // The block standing here (emitted grounded solids only: courtyards, gaps between blocks and buildings the
      // tiles do not emit keep their ground; raised solids stand over it).
      inside[k] = a.cover.id(x, z);
      K[k] = sc.winMargin(x, z, (st) => st.kerbed);
      Q[k] = sc.winMargin(x, z, (st) => st.pedestrian);
      S[k] = D[k] - s.sidewalkWidth(x, z);
      A[k] = pavedAreas.length ? pavedDist(x, z) : -3;
    }
  }
  const stats: StreetGroundStats = { kerbStoneM: 0, gutterM: 0, copingM: 0, droppedKerbs: 0 };
  const patches = new Map<string, Patch>();
  const patch = (m: MaterialName, fr: Frame): Patch => {
    const key = `${m}|${fr.key}`;
    let p = patches.get(key);
    if (!p) {
      p = new Patch(fr);
      patches.set(key, p);
    }
    return p;
  };
  const streetFrame = (si: number): Frame => {
    const ax = sc.axis[si];
    return { key: `s${si}`, cos: Math.cos(ax.angle), sin: Math.sin(ax.angle), ox: ax.ox, oz: ax.oz };
  };
  /** Unit gradient of a field sampled from the surface (outward normal of its contours). */
  const gradient = (fn: (x: number, z: number) => number, x: number, z: number): [number, number] => {
    const h = 0.35;
    const gx = fn(x + h, z) - fn(x - h, z);
    const gz = fn(x, z + h) - fn(x, z - h);
    const l = Math.hypot(gx, gz) || 1;
    return [gx / l, gz / l];
  };
  const wp = wearPlan(a);
  const liftOf = (x: number, z: number): number => s.liftAt(x, z) - sc.drop(x, z);
  const kerbStone = (x: number, z: number): boolean => s.kerbed(x, z) && s.liftAt(x, z) > 0.05;
  /** Bevel depth at a pavement vertex: KERB_BEVEL at the kerb line, 0 from D = KERB_BEVEL on. */
  const bevel = (v: V): number => {
    if (v.D >= KERB_BEVEL || !kerbStone(v.x, v.z)) {
      return 0;
    }
    const step = Math.max(0, liftOf(v.x, v.z));
    return Math.min(KERB_BEVEL, step * 0.3) * (1 - Math.max(0, v.D) / KERB_BEVEL);
  };
  const offY = (v: V): number => a.heights.off(v.x, v.z) - sc.drop(v.x, v.z) - bevel(v) - wp.dip(v.x, v.z);
  const carriageY = (v: V): number => a.heights.carriage(v.x, v.z) - wp.dip(v.x, v.z);
  /** Wear colour (linear multiplier) of a ground vertex. */
  const wear = (v: V, carriage: boolean): RGBA => {
    // Blotches at 2-6 m and a macro variation at about 13-30 m (breaks the paving repeat seen across the square),
    // desire lines walked darker, and the tone of a relaid patch.
    const macro = carriage ? 0.9 + 0.1 * valueNoise(v.x, v.z, 17, 4) : 0.74 + 0.28 * (0.6 * valueNoise(v.x, v.z, 31, 2) + 0.4 * valueNoise(v.x, v.z, 13, 3));
    const trod = carriage ? 0 : wp.trodden(v.x, v.z);
    const blotch = macro * (1 - 0.12 * trod) * (0.86 + 0.14 * (0.6 * valueNoise(v.x, v.z, 6.3) + 0.4 * valueNoise(v.x, v.z, 1.9, 1)));
    let g = 0;
    if (carriage && v.D > -0.9 && kerbStone(v.x, v.z)) {
      g = 0.24 * Math.pow(1 - -v.D / 0.9, 1.6);
    }
    if (!carriage && v.B < GRIME_WALL) {
      g = Math.max(g, Math.min(0.6, 0.34 * (1 - v.B / GRIME_WALL)));
    }
    const k = blotch * (1 - g);
    return rgba(k, k * (1 - g * 0.04), k * (1 - g * 0.1));
  };
  /** `_WEATHER` of a ground vertex: dirt from walls, gutters, desire lines and blotches; damp at puddles and gutters. */
  const weatherOf = (v: V, carriage: boolean): Weather => {
    let dirt = 0.12 * Math.max(0, valueNoise(v.x, v.z, 3.7, 11) - 0.35);
    let damp = wp.damp(v.x, v.z);
    if (carriage && v.D > -0.9 && kerbStone(v.x, v.z)) {
      const t = 1 - -v.D / 0.9;
      dirt = Math.max(dirt, 0.75 * Math.pow(t, 1.3));
      damp = Math.max(damp, 0.35 * Math.pow(t, 2));
    }
    if (!carriage) {
      if (v.B < GRIME_WALL) {
        dirt = Math.max(dirt, 0.85 * (1 - v.B / GRIME_WALL));
        damp = Math.max(damp, 0.3 * (1 - v.B / GRIME_WALL));
      }
      dirt = Math.max(dirt, 0.35 * wp.trodden(v.x, v.z));
    }
    return groundWeather(dirt, damp);
  };
  /** Chipped arris of a kerb stone (edge wear) in patches along the kerb. */
  const kerbWeather = (v: V, face: boolean): Weather => {
    const chip = Math.max(0, valueNoise(v.x, v.z, 0.7, 13) - 0.45) * 2;
    return [face ? 0.35 : 0.15, 0, Math.min(1, chip), face ? 0.25 : 0];
  };
  /** Kerb stones are cut in about 1 m lengths: a tone per stone (hashed along the kerb). */
  const kerbTone = (v: V): number => 0.86 + 0.2 * hash(Math.floor(v.x * 0.9) * 7.1 + Math.floor(v.z * 0.9) * 3.3);
  const PAVING = new Set<MaterialName>(['st_pavers', 'st_sidewalk', 'st_slabs', 'st_kup']);
  const ASPHALT = new Set<MaterialName>(['st_road', 'st_road_main']);
  const turned = (fr: Frame, pa: WearPatch): Frame => {
    const ang = Math.atan2(fr.sin, fr.cos) + pa.turn;
    return { key: `${fr.key}|r${pa.id}`, cos: Math.cos(ang), sin: Math.sin(ang), ox: fr.ox + pa.shift, oz: fr.oz + pa.shift * 0.61 };
  };
  /** Material, frame and tone of a ground piece after the wear patches (apron, relay, trench, road, pit). */
  const dressed = (m0: MaterialName, fr0: Frame, c: V, carriage: boolean): { m: MaterialName; fr: Frame; tone: number; pit: boolean } => {
    let m = m0;
    let fr = fr0;
    let tone = 1;
    let pit = false;
    const apron = !carriage && m === 'st_pavers' && sc.inSquare(c.x, c.z) && wp.apronAt(c.x, c.z);
    if (apron) {
      m = 'st_apron';
      fr = WORLD;
    }
    const pa = wp.patchAt(c.x, c.z);
    if (pa?.kind === 'relay' && PAVING.has(m)) {
      fr = turned(fr, pa);
      tone = pa.tone;
    } else if (pa?.kind === 'trench' && PAVING.has(m)) {
      m = 'st_road_patch';
      fr = WORLD;
      tone = pa.tone;
    } else if (pa?.kind === 'road' && (ASPHALT.has(m) || m === 'st_apron')) {
      m = m === 'st_apron' ? 'st_apron_patch' : 'st_road_patch';
      fr = WORLD;
      tone = pa.tone;
    } else if (pa?.kind === 'pit' && !carriage && m !== 'st_grass') {
      m = 'st_pit_soil';
      fr = WORLD;
      pit = true;
    }
    return { m, fr, tone, pit };
  };

  /**
   * Lawn colour (COLOR_0 over st_grass): mottled at 1-3 m, dry yellow-brown patches, worn paths near the edge and
   * contact darkening (AO) within 0.4 m of the granite edging.
   */
  const grassColour = (v: V): RGBA => {
    const mott = 0.78 + 0.3 * valueNoise(v.x, v.z, 1.3, 7) + 0.1 * valueNoise(v.x, v.z, 3.1, 9);
    const dry = Math.max(0, valueNoise(v.x, v.z, 4.3, 8) - 0.55) * 1.8;
    const edge = v.G < 0.4 ? 0.62 + 0.38 * Math.max(0, v.G / 0.4) : 1;
    const k = mott * edge;
    return rgba(k * (1 + 0.55 * dry), k * (1 + 0.12 * dry), k * (1 - 0.35 * dry));
  };

  /** Worn lawn: bare soil (the dirt layer) in patches, along the edges and where people cut across. */
  const grassWeather = (v: V): Weather => {
    const patchy = Math.max(0, valueNoise(v.x, v.z, 3.1, 17) - 0.58) * 2.4;
    const edge = v.G < 0.6 ? 1 - Math.max(0, v.G) / 0.6 : 0;
    const trod = wp.trodden(v.x, v.z);
    return groundWeather(Math.max(patchy, edge * 0.8, trod * 0.9), 0);
  };

  /** Paving of a pedestrian street (by its OSM surface) in the street's frame. */
  const lanePaving = (c: V): [MaterialName, Frame] | null => {
    const st = sc.near(c.x, c.z, 25, (q) => q.pedestrian || !q.kerbed);
    if (!st) {
      return null;
    }
    return [st.street.surf === Surf.Cobble ? 'st_kup' : st.street.surf === Surf.Asphalt && !st.street.pedestrian ? 'st_road' : 'st_slabs', streetFrame(st.index)];
  };
  const carriageMaterial = (c: V): [MaterialName, Frame] => {
    if (c.Q > 0) {
      return lanePaving(c) ?? ['st_slabs', WORLD];
    }
    const st = sc.near(c.x, c.z, 30, (q) => !q.pedestrian);
    if (st && (st.street.surf === Surf.Cobble || st.street.surf === Surf.Granite)) {
      return ['st_kup', streetFrame(st.index)];
    }
    if (st && st.street.surf === Surf.Pavers) {
      return ['st_slabs', streetFrame(st.index)];
    }
    return [st && isMain(st.street) ? 'st_road_main' : 'st_road', WORLD];
  };
  const offMaterial = (c: V): [MaterialName, Frame] => {
    if (s.geo.isWater(c.x, c.z)) {
      return ['st_pavers', WORLD];
    }
    const d = c.D;
    const kerbed = c.K > 0;
    const kerbFrame = (): Frame => {
      const st = sc.near(c.x, c.z, 30, (q) => q.kerbed);
      return st ? streetFrame(st.index) : WORLD;
    };
    if (kerbed && c.S < 0) {
      return ['st_sidewalk', kerbFrame()];
    }
    if (c.G > 0 && d > 0.5) {
      return ['st_grass', WORLD];
    }
    if (sc.inSquare(c.x, c.z)) {
      // The arrival square is paved throughout (c02: grey interlocking pavers).
      return ['st_pavers', WORLD];
    }
    const g = s.groundAt(c.x, c.z);
    if (c.P < 0 || c.A > 0) {
      if (!kerbed && d < PAVED_REACH) {
        return lanePaving(c) ?? ['st_pavers', WORLD];
      }
      return ['st_pavers', kerbFrame()];
    }
    if (g === Ground.Grass || g === Ground.Pitch) {
      return [kerbed ? 'st_sidewalk' : 'st_pavers', kerbFrame()];
    }
    if (d < PAVED_REACH) {
      return kerbed ? ['st_sidewalk', kerbFrame()] : (lanePaving(c) ?? ['st_pavers', WORLD]);
    }
    if (g === Ground.Parking) {
      return ['st_road', WORLD];
    }
    return s.pathDistance(c.x, c.z) < PATH_REACH ? ['st_pavers', WORLD] : ['lot', WORLD];
  };

  /**
   * Tile-border edges of the emitted ground: each gets a SKIRT-deep face down from the edge, so no gap opens against
   * a neighbour tile built at another level (greybox ground, other kerb rules).
   */
  const skirts: { a: Vec3; b: Vec3; n: Vec3 }[] = [];
  const onLine = (p: Vec3, q: Vec3): Vec3 | null => {
    const e = 1e-4;
    if (Math.abs(p[0] - tile.minX) < e && Math.abs(q[0] - tile.minX) < e) {
      return [-1, 0, 0];
    }
    if (Math.abs(p[0] - tile.maxX) < e && Math.abs(q[0] - tile.maxX) < e) {
      return [1, 0, 0];
    }
    if (Math.abs(p[2] - tile.minZ) < e && Math.abs(q[2] - tile.minZ) < e) {
      return [0, 0, -1];
    }
    if (Math.abs(p[2] - tile.maxZ) < e && Math.abs(q[2] - tile.maxZ) < e) {
      return [0, 0, 1];
    }
    return null;
  };
  const noteBorder = (pts: readonly Vec3[]): void => {
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      const q = pts[(k + 1) % pts.length];
      const n = onLine(p, q);
      if (n && Math.hypot(q[0] - p[0], q[2] - p[2]) > 1e-3) {
        skirts.push({ a: p, b: q, n });
      }
    }
  };

  /** A kerb / gutter / coping piece: flat polygon with UVs along the contour (u) and across it (v, metres). */
  const alongPiece = (m: MaterialName, q: Poly, ys: number[], normal: (g: [number, number]) => Vec3, field: (x: number, z: number) => number, vOf: (v: V) => number, carriage: boolean): void => {
    const c = centre(q);
    const [gx, gz] = gradient(field, c.x, c.z);
    const tx = -gz;
    const tz = gx;
    const pts: Vec3[] = q.v.map((v, k) => [v.x, ys[k], v.z]);
    const uvm: Vec2[] = q.v.map((v) => [v.x * tx + v.z * tz, vOf(v)]);
    const kerb = m === 'st_kerb';
    const color = q.v.map((v): RGBA => {
      const w = wear(v, carriage);
      const k = kerb ? kerbTone(c) : 1;
      return rgba(w[0] * k, w[1] * k, w[2] * k);
    });
    const weather = q.v.map((v) => (kerb ? kerbWeather(v, false) : weatherOf(v, carriage)));
    mesh.flatPolygon(m, pts, normal([gx, gz]), { uvm, color, weather });
    noteBorder(pts);
  };

  const emitWalls = (p: Poly, ys: number[], carriage: boolean): void => {
    const c = centre(p);
    const nv = p.v.length;
    for (let i = 0; i < nv; i++) {
      const tag = p.tag[i];
      if (tag === TAG_NONE || (tag === TAG_KERB && carriage)) {
        continue;
      }
      const va = p.v[i];
      const vb = p.v[(i + 1) % nv];
      const len = Math.hypot(vb.x - va.x, vb.z - va.z);
      if (len < 1e-4) {
        continue;
      }
      let nx0 = vb.z - va.z;
      let nz0 = -(vb.x - va.x);
      const l = Math.hypot(nx0, nz0) || 1;
      nx0 /= l;
      nz0 /= l;
      if (nx0 * (c.x - va.x) + nz0 * (c.z - va.z) > 0) {
        nx0 = -nx0;
        nz0 = -nz0;
      }
      const nrm: Vec3 = [nx0, 0, nz0];
      const ya = ys[i];
      const yb = ys[(i + 1) % nv];
      if (tag === TAG_COAST) {
        mesh.wall('st_quay_wall', va.x, va.z, vb.x, vb.z, QUAY_BOTTOM, ya, QUAY_BOTTOM, yb, nrm);
        totals.quayWallM += len;
      } else {
        const ca = a.heights.carriage(va.x, va.z);
        const cb = a.heights.carriage(vb.x, vb.z);
        const stone = kerbStone((va.x + vb.x) / 2 - nx0 * 0.1, (va.z + vb.z) / 2 - nz0 * 0.1);
        // Face UVs: u along the kerb, v down the face inside one stone course of the texture.
        const tx = -nz0;
        const tz = nx0;
        const ua = va.x * tx + va.z * tz;
        const ub = vb.x * tx + vb.z * tz;
        const uvm: Vec2[] = [
          [ua, 0.3],
          [ub, 0.3],
          [ub, 0.3 - (yb - cb)],
          [ua, 0.3 - (ya - ca)],
        ];
        const tone = kerbTone(va);
        const fc: RGBA = rgba(0.8 * tone, 0.78 * tone, 0.75 * tone);
        const tc: RGBA = rgba(tone, tone, tone);
        mesh.wall(stone ? 'st_kerb' : 'kerb', va.x, va.z, vb.x, vb.z, ca, ya, cb, yb, nrm, stone ? { uvm, color: [fc, fc, tc, tc], weather: [[0.8, 0, 0, 0.6], [0.8, 0, 0, 0.6], kerbWeather(vb, true), kerbWeather(va, true)] } : undefined);
        const step = (ya - ca + yb - cb) / 2;
        if (step > 0.01) {
          totals.kerbWallM += len;
          totals.kerbStepM[step < 0.05 ? 0 : step < 0.12 ? 1 : step <= 0.1505 ? 2 : 3] += len;
        }
      }
    }
  };

  const emitCarriage = (q: Poly): void => {
    const c = centre(q);
    const ys = q.v.map(carriageY);
    const kerbedGutter = c.D > -GUTTER_WIDTH && kerbStone(c.x, c.z) && !(c.Q > 0);
    if (kerbedGutter) {
      alongPiece('st_gutter', q, ys, () => [0, 1, 0], (x, z) => s.distance(x, z), (v) => 0.35 + v.D, true);
      stats.gutterM += polyArea(q) / GUTTER_WIDTH;
    } else {
      const [m0, fr0] = carriageMaterial(c);
      const { m, fr, tone } = dressed(m0, fr0, c, true);
      const pts: Vec3[] = q.v.map((v, k) => [v.x, ys[k], v.z]);
      const cols = q.v.map((v): RGBA => {
        const w = wear(v, true);
        return rgba(w[0] * tone, w[1] * tone, w[2] * tone);
      });
      const wx = q.v.map((v) => weatherOf(v, true));
      if (fr === WORLD) {
        mesh.groundPolygon(m, pts, { color: cols, weather: wx });
      } else {
        patch(m, fr).polygon(pts, cols, wx);
      }
      noteBorder(pts);
    }
    emitWalls(q, ys, true);
  };

  const emitOff = (q: Poly): void => {
    const c = centre(q);
    const ys = q.v.map(offY);
    if (c.L < COPING_WIDTH && !s.geo.isWater(c.x, c.z)) {
      alongPiece('st_coping', q, ys, () => [0, 1, 0], (x, z) => a.land(x, z), (v) => v.L, false);
      stats.copingM += polyArea(q) / COPING_WIDTH;
    } else if (c.G > -GREEN_EDGE && c.G <= 0 && c.D > KERB_WIDTH) {
      alongPiece('st_kerb', q, ys, () => [0, 1, 0], (x, z) => greenDist(x, z), (v) => 0.2 + v.G, false);
    } else if (c.D < KERB_WIDTH && kerbStone(c.x, c.z)) {
      const isBevel = c.D < KERB_BEVEL;
      alongPiece(
        'st_kerb',
        q,
        ys,
        ([gx, gz]) => {
          if (!isBevel) {
            return [0, 1, 0];
          }
          const l = Math.SQRT2;
          return [-gx / l, 1 / l, -gz / l];
        },
        (x, z) => s.distance(x, z),
        (v) => 0.12 + v.D,
        false,
      );
      if (!isBevel) {
        stats.kerbStoneM += polyArea(q) / (KERB_WIDTH - KERB_BEVEL);
      }
    } else {
      const [m0, fr0] = offMaterial(c);
      const { m, fr, tone, pit } = dressed(m0, fr0, c, false);
      const pts: Vec3[] = q.v.map((v, k) => [v.x, ys[k] - (pit ? PIT_DEPTH : 0), v.z]);
      const cols = q.v.map((v): RGBA => {
        const w = m === 'st_grass' ? grassColour(v) : wear(v, false);
        return rgba(w[0] * tone, w[1] * tone, w[2] * tone);
      });
      const wx = q.v.map((v) => (m === 'st_grass' ? grassWeather(v) : pit ? groundWeather(0.6, 0.3) : weatherOf(v, false)));
      if (fr === WORLD) {
        mesh.groundPolygon(m, pts, { color: cols, weather: wx });
      } else {
        patch(m, fr).polygon(pts, cols, wx);
      }
      noteBorder(pts);
    }
    emitWalls(q, ys, false);
  };

  const corner = (i: number, j: number): V => {
    const k = j * W + i;
    return { x: tile.minX + i * CELL, z: tile.minZ + j * CELL, L: L[k], D: D[k], P: P[k], B: B[k], G: G[k], W: Wd[k], K: K[k], Q: Q[k], S: S[k], A: A[k] };
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * W + i;
      if (inside[k] && inside[k + 1] === inside[k] && inside[k + W] === inside[k] && inside[k + W + 1] === inside[k]) {
        continue;
      }
      const c00 = corner(i, j);
      const c10 = corner(i + 1, j);
      const c01 = corner(i, j + 1);
      const c11 = corner(i + 1, j + 1);
      for (const tri of [
        [c00, c01, c10],
        [c10, c01, c11],
      ]) {
        if (tri[0].L < 0 && tri[1].L < 0 && tri[2].L < 0) {
          continue;
        }
        const land = split({ v: tri, tag: [TAG_NONE, TAG_NONE, TAG_NONE] }, 'L', TAG_COAST).pos;
        if (!land) {
          continue;
        }
        const parts = split(land, 'D', TAG_KERB);
        if (parts.neg) {
          for (const q of cutPatches(splitAll(splitAll([parts.neg], 'D', -GUTTER_WIDTH), 'Q', 0), wp.patchesIn)) {
            emitCarriage(q);
          }
        }
        if (parts.pos) {
          let pieces: Poly[] = [parts.pos];
          for (const [field, level] of [
            ['D', KERB_BEVEL],
            ['D', KERB_WIDTH],
            ['L', COPING_WIDTH],
            ['P', 0],
            ['P', PATH_REACH],
            ['D', PAVED_REACH],
            ['B', GRIME_WALL],
            ['G', 0],
            ['G', 0.4],
            ['G', -GREEN_EDGE],
            ['W', 0.015],
            ['W', 0.04],
            ['W', 0.07],
            ['W', 0.1],
            ['K', 0],
            ['S', 0],
            ['A', 0],
          ] as const) {
            pieces = splitAll(pieces, field, level);
          }
          for (const q of cutPatches(pieces, wp.patchesIn)) {
            emitOff(q);
          }
        }
      }
    }
  }
  for (const k of skirts) {
    mesh.wall('st_gutter', k.a[0], k.a[2], k.b[0], k.b[2], k.a[1] - SKIRT, k.a[1], k.b[1] - SKIRT, k.b[1], k.n, { color: [0.55, 0.55, 0.55, 1] });
  }
  for (const [key, p] of patches) {
    if (!p.idx.length) {
      continue;
    }
    const m = key.slice(0, key.indexOf('|'));
    mesh.addMesh(m, { positions: p.pos, indices: p.idx, uvm: p.uvm, color: p.col, weather: p.wx, normals: smoothNormals(p.pos, p.idx) });
  }
  stats.droppedKerbs = sc.dropped.filter((d) => d.x >= tile.minX && d.x < tile.maxX && d.z >= tile.minZ && d.z < tile.maxZ).length;
  return stats;
}

function polyArea(q: Poly): number {
  let s = 0;
  const n = q.v.length;
  for (let i = 0; i < n; i++) {
    const a = q.v[i];
    const b = q.v[(i + 1) % n];
    s += a.x * b.z - b.x * a.z;
  }
  return Math.abs(s) / 2;
}

/** Area-weighted vertex normals of an indexed mesh (flat arrays). */
function smoothNormals(pos: number[], idx: number[]): number[] {
  const acc = new Array<number>(pos.length).fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const ux = pos[b * 3] - pos[a * 3];
    const uy = pos[b * 3 + 1] - pos[a * 3 + 1];
    const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3];
    const vy = pos[c * 3 + 1] - pos[a * 3 + 1];
    const vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const i of [a, b, c]) {
      acc[i * 3] += nx;
      acc[i * 3 + 1] += ny;
      acc[i * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < acc.length; i += 3) {
    const l = Math.hypot(acc[i], acc[i + 1], acc[i + 2]) || 1;
    acc[i] /= l;
    acc[i + 1] /= l;
    acc[i + 2] /= l;
    if (!Number.isFinite(acc[i + 1]) || acc[i + 1] === 0) {
      acc[i + 1] = 1;
    }
  }
  return acc;
}

/**
 * Ground step (formats 0 and 1): the core ground on greybox tiles and in format 0 (unchanged output), the street
 * ground on full-detail and street-kit tiles. Replaces groundStep in registry.ts.
 */
export const streetGroundStep: CompileStep = {
  id: 'ground',
  formats: [0, 1],
  prepare(a) {
    groundStep.prepare!(a);
  },
  tile(t) {
    if (t.area.format === 0 || !streetTile(t)) {
      return groundStep.tile!(t);
    }
    const sc = streetContext(t.area);
    const totals = t.area.shared.get('ground') as GroundTotals;
    const a = t.area;
    const st = t.mesh.withLod(LOD0, () => buildStreetGround(t, sc, totals));
    t.mesh.withLod(LOD1 | LOD2, () => buildGround(t.bounds, a.foundation, a.heights, a.land, t.mesh));
    t.record('streetGround', { kerbStoneM: Math.round(st.kerbStoneM), gutterM: Math.round(st.gutterM), copingM: Math.round(st.copingM), droppedKerbs: st.droppedKerbs });
  },
};
