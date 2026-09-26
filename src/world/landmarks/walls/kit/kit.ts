/**
 * City-wall model kit (not placed in the game yet): parametric curtain walls (straight, corner, terrain-following
 * ends), crenellations, Byzantine towers (square, pentagonal prow, hexagonal, octagonal), arched gates, ruined and
 * broken variants and sea-side foundations. Every piece is built into a heritage MeshBuilder (vertex format and
 * surfaces of heritage/build) in world coordinates from a polyline or an anchor point, a ground function and plain
 * parameters, so a compiler can instantiate the kit along any wall line later (see .docs/planning/20-city-walls.md).
 *
 * Conventions: polylines run along the wall; the OUTER (field / sea) side is to the right of the drawing direction
 * (right-hand normal (-dz, dx), +Z = south). LOD 0 is the close-up model, LOD 1 drops merlons, openings and small
 * detail, LOD 2 is a plain silhouette. Deterministic: every random choice hashes `seed` and the arc length.
 */
import { ensureCCW, offsetRing, type V2, type V3 } from '../../heritage/build/geom';
import { mat, type Mat, type MeshBuilder } from '../../heritage/build/mesh-builder';
import { Surf, type RGB } from '../../heritage/build/surfaces';
import { flatPoly, lathe, prism } from '../../heritage/build/prims/basic';
import { samplePath, type WallSample } from '../../heritage/build/prims/fort';
import { buttress, chamfer, faceFields, faceTo, hash, ivy, noise2, relievingArch, reliefSurface, shrub, tuft, type FacePoint } from './detail';

export type GroundFn = (x: number, z: number) => number;
export type WallStyle = 'byzantine' | 'rubble' | 'ashlar';

/** Box collider description (Object3D yaw convention, like the heritage and structure colliders). */
export interface KitCollider {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
}

export interface KitOut {
  mb: MeshBuilder;
  lod: number;
  colliders?: KitCollider[];
  /** Separate builder for vegetation cards (drawn without shadows); defaults to `mb`. */
  foliage?: MeshBuilder;
}

/* ------------------------------------------------------------------ materials */

export interface KitMats {
  wall: Mat;
  tower: Mat;
  core: Mat;
  top: Mat;
  grass: Mat;
  brick: Mat;
  block: Mat;
  void: Mat;
  wood: Mat;
  marble: Mat;
}

/** Smooth value noise in [0, 1] along one coordinate. */
export function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(seed, i) * (1 - u) + hash(seed, i + 1) * u;
}

function tint(c: RGB, k: number, warm: number): RGB {
  return [c[0] * k * (1 + warm * 0.05), c[1] * k, c[2] * k * (1 - warm * 0.07)];
}

/**
 * Material set per style. `weather` (0..1) drives dirt, streaks, lost facing and plants in the wall shader; each seed
 * shifts the stone colour a little (walls were built and repaired with stone from many quarries).
 */
export function kitMats(style: WallStyle, seed: number, weather = 0.7): KitMats {
  const k = 0.93 + 0.1 * hash(seed, 1);
  const warm = hash(seed, 2) * 2 - 1;
  const stone: RGB = style === 'byzantine' ? [0.47, 0.43, 0.37] : style === 'ashlar' ? [0.46, 0.43, 0.38] : [0.42, 0.39, 0.34];
  const surf = style === 'byzantine' ? Surf.Byzantine : style === 'ashlar' ? Surf.Ashlar : Surf.Rubble;
  return {
    wall: mat(surf, tint(stone, k, warm), weather, 0),
    tower: mat(surf, tint(stone, k * 0.97, warm + 0.3), Math.min(1, weather + 0.05), 0),
    core: mat(Surf.Rubble, tint([0.4, 0.37, 0.33], k, warm), 0.9, 0),
    top: mat(Surf.Rubble, tint([0.42, 0.4, 0.36], k * 0.95, warm), 0.85, 0),
    grass: mat(Surf.Earth, [0.16, 0.16, 0.1], 0.6, 0),
    brick: mat(Surf.Brick, [0.36, 0.2, 0.14], 0.8, 0),
    block: mat(Surf.Ashlar, tint([0.5, 0.47, 0.41], k, warm), 0.85, 0),
    void: mat(Surf.Void, [0.015, 0.014, 0.013], 0, 0),
    wood: mat(Surf.Wood, [0.12, 0.08, 0.05], 0.6, 0),
    marble: mat(Surf.Marble, tint([0.66, 0.64, 0.59], k, warm), 0.85, 0),
  };
}

/* ------------------------------------------------------------------ low-level helpers */

/** Oriented box from a centre, local axes (along = unit xz vector), sizes; every face outward. */
function obox(mb: MeshBuilder, cx: number, y0: number, cz: number, ax: number, az: number, len: number, h: number, dep: number, m: Mat, top: Mat = m, bottom = false): void {
  const nx = -az;
  const nz = ax;
  const c = (a: number, b: number, y: number): V3 => [cx + ax * a + nx * b, y, cz + az * a + nz * b];
  const hl = len / 2;
  const hd = dep / 2;
  const y1 = y0 + h;
  const sides: [number, number, number, number, V3][] = [
    [-hl, hd, hl, hd, [nx, 0, nz]],
    [hl, -hd, -hl, -hd, [-nx, 0, -nz]],
    [hl, hd, hl, -hd, [ax, 0, az]],
    [-hl, -hd, -hl, hd, [-ax, 0, -az]],
  ];
  for (const [a0, b0, a1, b1, n] of sides) {
    const w = Math.hypot(a1 - a0, b1 - b0);
    faceTo(mb, [c(a0, b0, y0), c(a1, b1, y0), c(a1, b1, y1), c(a0, b0, y1)], [0, y0, w, y0, w, y1, 0, y1], m, n);
  }
  faceTo(mb, [c(-hl, -hd, y1), c(hl, -hd, y1), c(hl, hd, y1), c(-hl, hd, y1)], [0, 0, len, 0, len, dep, 0, dep], top, [0, 1, 0]);
  if (bottom) {
    faceTo(mb, [c(-hl, -hd, y0), c(hl, -hd, y0), c(hl, hd, y0), c(-hl, hd, y0)], [0, 0, len, 0, len, dep, 0, dep], m, [0, -1, 0]);
  }
}

/** Irregular boulder (jittered box) for riprap and fallen masonry. */
function boulder(mb: MeshBuilder, x: number, y: number, z: number, size: number, seed: number, m: Mat): void {
  const r = (n: number): number => hash(seed, n);
  const a = r(1) * Math.PI;
  const ax = Math.cos(a);
  const az = Math.sin(a);
  const sx = size * (0.7 + 0.6 * r(2));
  const sz = size * (0.6 + 0.5 * r(3));
  const sy = size * (0.45 + 0.4 * r(4));
  const nx = -az;
  const nz = ax;
  // Eight jittered corners, bottom slightly wider (resting blocks).
  const k = (i: number): number => 1 + (r(10 + i) - 0.5) * 0.35;
  const P: V3[] = [];
  for (let i = 0; i < 8; i++) {
    const su = (i & 1 ? 1 : -1) * sx * 0.5 * k(i) * (i & 4 ? 0.82 : 1);
    const sv = (i & 2 ? 1 : -1) * sz * 0.5 * k(i + 8) * (i & 4 ? 0.82 : 1);
    const yy = y + (i & 4 ? sy * k(i + 16) : 0);
    P.push([x + ax * su + nx * sv, yy, z + az * su + nz * sv]);
  }
  const quads: [number, number, number, number][] = [
    [0, 1, 3, 2],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 3, 7, 5],
  ];
  for (const q of quads) {
    const pts = q.map((i) => P[i]);
    const c = pts.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4, s[2] + p[2] / 4], [0, 0, 0]);
    const n: V3 = [c[0] - x, c[1] - (y + sy * 0.5), c[2] - z];
    faceTo(mb, pts, [0, 0, size, 0, size, size, 0, size], m, n);
  }
}

function collide(o: KitOut, c: KitCollider): void {
  if (o.lod === 0 && o.colliders) {
    o.colliders.push(c);
  }
}

/* ------------------------------------------------------------------ curtain wall */

export interface MerlonParams {
  /** Merlon width along the wall, crenel (gap) width, height, depth across the wall (m). */
  w: number;
  gap: number;
  h: number;
  depth: number;
  /** Pyramidal cap height (Ottoman repairs); 0 = flat Byzantine merlon. */
  cap?: number;
}

export type EndStyle = 'flush' | 'crumbled' | 'sloped';

export interface CurtainParams {
  /** Wall-walk height above the ground (m). */
  height: number;
  /** Thickness at the wall-walk (m). */
  thickness: number;
  /** Extra thickness of the battered foot on the outer face (m) and the height it tapers over. */
  batter?: number;
  batterHeight?: number;
  /** Parapet height above the wall-walk and its thickness (m); 0 = none. */
  parapet?: number;
  parapetThick?: number;
  merlons?: MerlonParams | null;
  /** Fraction of the merlons still standing (0..1, default 0.8). */
  merlonsKept?: number;
  /** 0 intact .. 1 heavily ruined: broken, lowered top without parapet, grass on the rubble core. */
  ruin?: number;
  /** End treatment at the start / end of the polyline. */
  endA?: EndStyle;
  endB?: EndStyle;
  /** Foundation depth below the lowest ground (m). */
  sink?: number;
  /** Sample spacing along the wall at LOD 0 (m). */
  step?: number;
  /** Lateral wander of the wall line (m, hand-built walls are never straight). */
  wander?: number;
  style?: WallStyle;
  /** Shrubs and fig bushes rooted on the wall top (default: with the weathering). */
  plants?: number;
  /** Ivy sheets per 100 m of face (default from the weathering). */
  ivy?: number;
  /** Face relief scale: bellying, leaning, course irregularity (default 1). */
  relief?: number;
  /** Lost facing (0..1): how much of the face has fallen off, exposing the core (default from weathering / ruin). */
  losses?: number;
  /** Brick repair patches (0 none, 1 default, 2 many). */
  repairs?: number;
  /** Fraction of the parapet still standing (default 0.55). */
  parapetKept?: number;
  /** Walled-up brick relieving arches per 100 m (default 2.5) and brick buttress repairs per 100 m (default 2). */
  arches?: number;
  buttresses?: number;
  seed?: number;
  weather?: number;
}

const DEFAULT_MERLONS: MerlonParams = { w: 1.6, gap: 1.05, h: 1.55, depth: 0.8, cap: 0 };

/** Wall-walk height (above ground) along the wall: damage dips, ruins, crumbled or stepped ends. */
function curtainProfile(p: CurtainParams, seed: number, total: number): (s: number) => number {
  const H = p.height;
  const ruin = p.ruin ?? 0;
  return (s: number): number => {
    let h = H * (0.95 + 0.1 * noise1(s / 37, seed));
    // Earthquake and storm damage: broad dips with a broken edge.
    const dmg = Math.max(0, noise1(s / 16, seed + 13) - (0.8 - 0.35 * ruin)) / (0.2 + 0.35 * ruin);
    h *= 1 - (0.28 + 0.4 * ruin) * Math.min(1, dmg) * (0.75 + 0.25 * noise1(s / 1.9, seed + 17));
    if (ruin > 0) {
      const r = noise1(s / 11, seed + 7) * 0.55 + noise1(s / 3.1, seed + 9) * 0.3 + hash(seed + 9, Math.floor(s / 0.9)) * 0.15;
      h *= 1 - ruin * (0.25 + 0.6 * r);
      // Broken masonry breaks along the courses: the top steps in ~0.3 m.
      h = Math.floor(h / 0.3) * 0.3;
    }
    // Stepped breaks along the top: courses lost in short runs (almost no sea wall keeps a straight top).
    const cell = Math.floor(s / 2.4);
    if (hash(seed + 41, cell) < 0.35 + 0.3 * ruin) {
      h -= 0.3 + 1.4 * hash(seed + 43, cell);
    }
    h = Math.floor(h / 0.3) * 0.3;
    const end = (d: number, style: EndStyle | undefined): number => {
      if (style === 'crumbled') {
        const f = Math.min(1, d / 10);
        return Math.max(0.1, f * f * (3 - 2 * f) + noise1(s / 1.7, seed + 3) * 0.3 * (1 - f));
      }
      if (style === 'sloped') {
        // Terrain end (the wall runs out up a slope or into a hillside): the top slopes down over the last 12 m.
        const f = Math.min(1, d / 12);
        return Math.max(0.15, f);
      }
      return 1;
    };
    h *= end(s, p.endA) * end(total - s, p.endB);
    return Math.max(0.8, h);
  };
}

/**
 * Curtain wall along a polyline (2 points: straight segment, 3+: corners with mitred joints). Outer face on the right.
 * Terrain following: every sample stands on its own ground; the foundation sinks below the lower of the two faces.
 */
export function curtain(o: KitOut, pts: readonly V2[], ground: GroundFn, p: CurtainParams): void {
  const mb = o.mb;
  const lod = o.lod;
  const seed = p.seed ?? 1;
  const M = kitMats(p.style ?? 'byzantine', seed, p.weather);
  const T = p.thickness;
  const half = T / 2;
  const ruin = p.ruin ?? 0;
  const bat = p.batter ?? 0.6;
  const batH = p.batterHeight ?? 3;
  const para = ruin > 0.35 ? 0 : p.parapet ?? 1.15;
  const pT = Math.min(p.parapetThick ?? 0.75, T * 0.4);
  const sink = p.sink ?? 2.5;
  const step = lod === 0 ? p.step ?? 1 : lod === 1 ? 4 : 12;
  const smp = samplePath(pts, step, ground);
  const n = smp.length;
  if (n < 2) {
    return;
  }
  const total = smp[n - 1].s;
  const wander = lod < 2 ? p.wander ?? 0.18 : 0;
  for (let i = 1; i < n - 1; i++) {
    const d = (noise1(smp[i].s / 5.5, seed + 21) - 0.5) * 2 * wander;
    smp[i].x += smp[i].mx * d;
    smp[i].z += smp[i].mz * d;
  }
  const prof = curtainProfile(p, seed, total);
  // Per-sample frame: outer / inner offsets (mitred) and heights.
  const at = (q: WallSample, v: number): [number, number] => [q.x + q.mx * v * q.miter, q.z + q.mz * v * q.miter];
  const gI: number[] = [];
  const gO: number[] = [];
  const yTop: number[] = [];
  for (const q of smp) {
    const [ix, iz] = at(q, -half);
    const [ox, oz] = at(q, half + bat);
    gI.push(ground(ix, iz));
    gO.push(ground(ox, oz));
    yTop.push(Math.max(gI[gI.length - 1], ground(q.x, q.z)) + prof(q.s));
  }
  const yBot = (i: number): number => Math.min(gI[i], gO[i]) - sink;
  const yBat = (i: number): number => Math.min(yTop[i] - 1, Math.max(gO[i], gI[i]) + batH);
  const broken = ruin > 0.35;
  const topMat = broken ? M.grass : M.top;
  const H = p.height;
  // Parapet: broken away along much of the wall.
  const kept = p.parapetKept ?? 0.55;
  const paraI = smp.map((q) => (para > 0 && noise1(q.s / 7, seed + 81) * 0.75 + hash(seed, 2100 + Math.floor(q.s / 1.8)) * 0.25 < kept ? para : 0));
  // Face relief: bellying between foot and top, leaning stretches, uneven courses; tapered to 0 at the ends.
  const relief = lod < 2 ? p.relief ?? 1 : 0;
  const taper = (s: number): number => Math.min(1, s / 3, (total - s) / 3);
  const disp = (s: number, hRel: number): number =>
    relief * taper(s) * ((noise1(s / 13, seed + 71) - 0.4) * 0.5 * Math.sin(Math.PI * hRel) + (noise1(s / 41, seed + 73) - 0.5) * 0.7 * hRel);
  const y0f = (i: number): number => (bat > 0.01 && lod < 2 ? yBat(i) : yBot(i));
  const R = lod === 0 ? Math.max(4, Math.round((H + para) / 0.7)) : lod === 1 ? 3 : 1;
  const grid: FacePoint[][] = [];
  for (let i = 0; i < n; i++) {
    const q = smp[i];
    const col: FacePoint[] = [];
    const yLo = y0f(i);
    const yHi = yTop[i] + paraI[i];
    const inner = lod === 0 && i > 0 && i < n - 1;
    for (let r = 0; r <= R; r++) {
      const hRel = r / R;
      const mid = inner && r > 0 && r < R;
      const du = mid ? (hash(seed, 3000 + i * 131 + r) - 0.5) * 0.35 * step : 0;
      const dy = mid ? (hash(seed, 4000 + i * 131 + r) - 0.5) * 0.3 * ((yHi - yLo) / R) : 0;
      const d = disp(q.s + du, hRel) + (mid ? (hash(seed, 5000 + i * 97 + r) - 0.5) * 0.03 : 0);
      const [x, z] = at(q, half + d);
      col.push({ x: x + q.tx * du, y: yLo + (yHi - yLo) * hRel + dy, z: z + q.tz * du, u: q.s + du, nx: q.mx, nz: q.mz, tx: q.tx, tz: q.tz });
    }
    grid.push(col);
  }
  // Lost facing and brick repairs (LOD 0): see faceFields.
  const lossAmt = p.losses ?? Math.min(1, 0.35 + 0.4 * (p.weather ?? 0.7) + 0.5 * ruin);
  let loss: number[][] | null = null;
  let repair: boolean[][] | null = null;
  if (lod === 0 && lossAmt > 0) {
    const f = faceFields(grid, seed, lossAmt, p.repairs ?? 1, (i, r) => i === 0 || i === n - 1 || r === R || taper(grid[i][r].u) < 0.9);
    loss = f.loss;
    repair = f.repair;
  }
  const faceAt = (s: number, y: number): FacePoint => {
    const i = Math.max(0, Math.min(n - 1, Math.round((s / total) * (n - 1))));
    const q = smp[i];
    const yLo = y0f(i);
    const yHi = yTop[i] + paraI[i];
    const hRel = Math.max(0, Math.min(1, (y - yLo) / Math.max(0.1, yHi - yLo)));
    const [x, z] = at(q, half + disp(s, hRel));
    return { x: x + q.tx * (s - q.s), y, z: z + q.tz * (s - q.s), u: s, nx: q.mx, nz: q.mz, tx: q.tx, tz: q.tz };
  };
  for (let i = 0; i < n - 1; i++) {
    const j = i + 1;
    const a = smp[i];
    const b = smp[j];
    const u0 = a.s;
    const u1 = b.s;
    const oA0 = at(a, half + bat);
    const oB0 = at(b, half + bat);
    const oA1 = at(a, half);
    const oB1 = at(b, half);
    const nO: V3 = [a.mx + b.mx, 0, a.mz + b.mz];
    if (bat > 0.01 && lod < 2) {
      // Battered foot of large blocks, then the sloping batter up to the face grid.
      faceTo(mb, [[oA0[0], yBot(i), oA0[1]], [oB0[0], yBot(j), oB0[1]], [oB0[0], gO[j] + 0.3, oB0[1]], [oA0[0], gO[i] + 0.3, oA0[1]]], [u0, yBot(i), u1, yBot(j), u1, gO[j] + 0.3, u0, gO[i] + 0.3], M.block, nO);
      faceTo(mb, [[oA0[0], gO[i] + 0.3, oA0[1]], [oB0[0], gO[j] + 0.3, oB0[1]], [oB1[0], yBat(j), oB1[1]], [oA1[0], yBat(i), oA1[1]]], [u0, gO[i] + 0.3, u1, gO[j] + 0.3, u1, yBat(j), u0, yBat(i)], M.wall, [nO[0], 0.25, nO[2]], [0.85, 0.85, 1, 1]);
    }
    // Inner face.
    const iA = at(a, -half);
    const iB = at(b, -half);
    faceTo(mb, [[iA[0], yBot(i), iA[1]], [iB[0], yBot(j), iB[1]], [iB[0], yTop[j], iB[1]], [iA[0], yTop[i], iA[1]]], [u0, yBot(i), u1, yBot(j), u1, yTop[j], u0, yTop[i]], M.wall, [-nO[0], 0, -nO[2]]);
    // Wall-walk, parapet (per-sample height: broken parapet), meeting the displaced top of the face grid.
    const OA = grid[i][R];
    const OB = grid[j][R];
    if (para > 0) {
      const pA = at(a, half - pT);
      const pB = at(b, half - pT);
      faceTo(mb, [[iA[0], yTop[i], iA[1]], [iB[0], yTop[j], iB[1]], [pB[0], yTop[j], pB[1]], [pA[0], yTop[i], pA[1]]], [u0, 0, u1, 0, u1, T, u0, T], topMat, [0, 1, 0], 0.85);
      faceTo(mb, [[pA[0], yTop[i], pA[1]], [pB[0], yTop[j], pB[1]], [pB[0], yTop[j] + paraI[j], pB[1]], [pA[0], yTop[i] + paraI[i], pA[1]]], [u0, yTop[i], u1, yTop[j], u1, yTop[j] + paraI[j], u0, yTop[i] + paraI[i]], M.wall, [-nO[0], 0, -nO[2]], [0.7, 0.7, 1, 1]);
      faceTo(mb, [[pA[0], OA.y, pA[1]], [pB[0], OB.y, pB[1]], [OB.x, OB.y, OB.z], [OA.x, OA.y, OA.z]], [u0, 0, u1, 0, u1, pT, u0, pT], M.top, [0, 1, 0]);
    } else {
      faceTo(mb, [[iA[0], yTop[i], iA[1]], [iB[0], yTop[j], iB[1]], [OB.x, OB.y, OB.z], [OA.x, OA.y, OA.z]], [u0, 0, u1, 0, u1, T, u0, T], topMat, [0, 1, 0]);
    }
  }
  if (bat > 0.01 && lod < 2) {
    reliefSurface(mb, grid, loss, M.wall, repair ? (i, r) => (repair![i][r] ? M.brick : null) : undefined);
  } else {
    // Silhouette LOD: whole-height outer face.
    for (let i = 0; i < n - 1; i++) {
      const a = grid[i][R];
      const b = grid[i + 1][R];
      const nO: V3 = [a.nx + b.nx, 0, a.nz + b.nz];
      const [ax0, az0] = at(smp[i], half);
      const [bx0, bz0] = at(smp[i + 1], half);
      faceTo(mb, [[ax0, yBot(i), az0], [bx0, yBot(i + 1), bz0], [b.x, b.y, b.z], [a.x, a.y, a.z]], [a.u, yBot(i), b.u, yBot(i + 1), b.u, b.y, a.u, a.y], M.wall, nO);
    }
  }
  // Walled-up brick relieving arches and brick buttress repairs on the outer face.
  const lostAt = (s: number, y: number): boolean => {
    if (!loss) {
      return false;
    }
    const i = Math.max(0, Math.min(n - 1, Math.round((s / total) * (n - 1))));
    const yLo = y0f(i);
    const r = Math.round(((y - yLo) / Math.max(0.1, yTop[i] + paraI[i] - yLo)) * R);
    return r >= 0 && r <= R && loss[i][Math.max(0, Math.min(R, r))] > 0.05;
  };
  if (lod < 2) {
    const na = Math.round(((p.arches ?? 2.5) * total) / 100 + hash(seed, 7000) - 0.5);
    for (let k = 0; k < na; k++) {
      const s = total * ((k + 0.2 + 0.6 * hash(seed, 7100 + k)) / Math.max(1, na));
      const g = Math.max(gO[Math.round((s / total) * (n - 1))], 0);
      const y = g + 2.2 + 2.5 * hash(seed, 7200 + k);
      const w = 2.2 + 2.2 * hash(seed, 7300 + k);
      if (y + w * 0.6 > yTop[Math.round((s / total) * (n - 1))] - 1 || lostAt(s, y) || lostAt(s, y + w * 0.4)) {
        continue;
      }
      relievingArch(mb, faceAt(s, y), w, w * 0.5, M.brick, M.core, lod);
    }
    const nb = Math.round(((p.buttresses ?? 2) * total) / 100 + hash(seed, 7400) - 0.5);
    for (let k = 0; k < nb; k++) {
      const s = total * ((k + 0.3 + 0.4 * hash(seed, 7500 + k)) / Math.max(1, nb));
      const i = Math.round((s / total) * (n - 1));
      const f = faceAt(s, gO[i]);
      buttress(mb, { ...f, x: f.x + f.nx * bat * 0.5, z: f.z + f.nz * bat * 0.5 }, 3.2 + 2.5 * hash(seed, 7600 + k), 1.0 + 0.9 * hash(seed, 7700 + k), Math.min(yTop[i] - gO[i] - 1.5, 3 + 3.5 * hash(seed, 7800 + k)), M.brick);
    }
  }
  // Vegetation: ivy sheets over the top, fig clumps in lost patches and on the top, grass tufts in the joints.
  const fol = o.foliage ?? mb;
  const green = p.ivy ?? Math.max(0, (p.weather ?? 0.7) - 0.3) * 10 + ruin * 5;
  if (lod < 2 && green > 0) {
    const nIvy = Math.round((green * total) / 100 + hash(seed, 7900) - 0.5);
    for (let k = 0; k < nIvy; k++) {
      const s = total * ((k + 0.15 + 0.7 * hash(seed, 8000 + k)) / Math.max(1, nIvy));
      const i = Math.round((s / total) * (n - 1));
      const yT = yTop[i] + paraI[i] + 0.1;
      const drop = Math.min(yT - gO[i] - 0.5, 3 + 6 * hash(seed, 8100 + k));
      ivy(fol, (du, y) => faceAt(Math.max(0, Math.min(total, s + du)), y), 2 + 3.5 * hash(seed, 8200 + k), drop, yT, seed + k * 13, lod);
    }
  }
  if (lod === 0 && green > 0) {
    // Fig clumps out of lost patches.
    let figs = 0;
    for (let i = 0; loss && i < n - 1 && figs < Math.ceil(total / 25); i += 4) {
      for (let r = 1; r < R - 1; r++) {
        if (loss[i][r] > 0.8 && hash(seed, 8300 + i * 17 + r) < 0.06 * green) {
          const f = grid[i][r];
          shrub(fol, f.x + f.nx * 0.5, f.y - 0.3, f.z + f.nz * 0.5, f.nx, f.nz, 1.6 + hash(seed, 8400 + i) * 1.8, seed + i * 7 + r, lod);
          figs++;
          break;
        }
      }
    }
    // Rubble, fallen blocks and grass along the foot on both faces.
    for (let k = 0; k < Math.floor(total / 1.3); k++) {
      if (hash(seed, 9100 + k) > 0.55) {
        continue;
      }
      const s = (k + hash(seed, 9200 + k)) * 1.3;
      const i = Math.min(n - 1, Math.round((s / total) * (n - 1)));
      const q = smp[i];
      const side = hash(seed, 9300 + k) < 0.7 ? 1 : -1;
      const v = side > 0 ? half + bat + 0.1 + hash(seed, 9400 + k) * 1.4 : -half - 0.1 - hash(seed, 9400 + k) * 1.0;
      const x = q.x + q.mx * v;
      const z = q.z + q.mz * v;
      const size = 0.25 + Math.pow(hash(seed, 9500 + k), 2) * 0.9;
      boulder(mb, x, ground(x, z) - size * 0.3, z, size, seed + 9600 + k, hash(seed, 9700 + k) < 0.25 ? M.brick : M.block);
      if (hash(seed, 9800 + k) < 0.8) {
        tuft(fol, x + 0.4, ground(x, z), z + 0.3, seed + 9900 + k);
      }
    }
    // Grass tufts along the top and at the foot.
    for (let k = 0; k < Math.floor(total / 1.6); k++) {
      if (hash(seed, 8500 + k) > 0.55 + 0.4 * ruin) {
        continue;
      }
      const s = (k + hash(seed, 8600 + k)) * 1.6;
      const i = Math.min(n - 1, Math.round((s / total) * (n - 1)));
      const q = smp[i];
      const onTop = hash(seed, 8700 + k) < 0.6;
      const v = onTop ? (hash(seed, 8800 + k) - 0.5) * T * 0.8 : half + bat + 0.2;
      const x = q.x + q.mx * v;
      const z = q.z + q.mz * v;
      tuft(fol, x, onTop ? yTop[i] : ground(x, z), z, seed + k * 3);
    }
  }
  // End caps (the exposed core of a broken end reads as rubble).
  const cap = (i: number, sign: number, style: EndStyle | undefined): void => {
    const q = smp[i];
    const iA = at(q, -half);
    const oA = at(q, half + (bat > 0.01 && lod < 2 ? bat : 0));
    const oT = at(q, half);
    const n: V3 = [-q.tx * sign, 0, -q.tz * sign];
    const m = style === 'crumbled' ? M.core : M.wall;
    faceTo(mb, [[iA[0], yBot(i), iA[1]], [oA[0], yBot(i), oA[1]], [oA[0], gO[i] + 0.3, oA[1]], [oT[0], yBat(i), oT[1]], [oT[0], yTop[i] + paraI[i], oT[1]], [iA[0], yTop[i], iA[1]]], [0, yBot(i), T + bat, yBot(i), T + bat, gO[i] + 0.3, T, yBat(i), T, yTop[i] + paraI[i], 0, yTop[i]], m, n);
  };
  cap(0, 1, p.endA);
  cap(n - 1, -1, p.endB);
  // Merlons on the parapet (LOD 0), with missing ones; pyramidal caps when requested.
  const ml = p.merlons === undefined ? DEFAULT_MERLONS : p.merlons;
  if (lod === 0 && ml && para > 0) {
    const pitch = ml.w + ml.gap;
    const count = Math.floor(total / pitch);
    const start = (total - count * pitch) / 2 + ml.gap / 2;
    const keptM = p.merlonsKept ?? 0.3;
    let k0 = 0;
    for (let k = 0; k < count; k++) {
      const sMid = start + k * pitch + ml.w / 2;
      if (noise1(sMid / 9, seed + 31) * 0.6 + hash(seed, 400 + k) * 0.4 > keptM) {
        continue;
      }
      while (k0 < n - 2 && smp[k0 + 1].s < sMid) {
        k0++;
      }
      const a = smp[k0];
      const b = smp[k0 + 1];
      if (paraI[k0] <= 0 || paraI[k0 + 1] <= 0) {
        continue;
      }
      const t = b.s > a.s ? (sMid - a.s) / (b.s - a.s) : 0;
      const dTop = disp(sMid, 1);
      const x = a.x + (b.x - a.x) * t + a.mx * (half + dTop - ml.depth / 2);
      const z = a.z + (b.z - a.z) * t + a.mz * (half + dTop - ml.depth / 2);
      const y = Math.min(grid[k0][R].y, grid[k0 + 1][R].y);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dl = Math.hypot(dx, dz) || 1;
      // Damaged merlons are lower and uneven.
      const hh = ml.h * (0.75 + 0.25 * hash(seed, 500 + k));
      obox(mb, x, y - 0.05, z, dx / dl, dz / dl, ml.w, hh + 0.05, ml.depth, M.wall, M.top);
      if (ml.cap && ml.cap > 0) {
        const ax = dx / dl;
        const az = dz / dl;
        const nx = -az;
        const nz = ax;
        const yb = y + hh;
        const apex: V3 = [x, yb + ml.cap, z];
        const c = (u: number, v: number): V3 => [x + ax * u + nx * v, yb, z + az * u + nz * v];
        const hw = ml.w / 2;
        const hd = ml.depth / 2;
        const corners = [c(-hw, -hd), c(hw, -hd), c(hw, hd), c(-hw, hd)];
        for (let e = 0; e < 4; e++) {
          const p0 = corners[e];
          const p1 = corners[(e + 1) % 4];
          const mid: V3 = [(p0[0] + p1[0]) / 2 - x, 0.3, (p0[2] + p1[2]) / 2 - z];
          faceTo(mb, [p0, p1, apex], [0, 0, ml.w, 0, ml.w / 2, ml.cap], M.top, mid);
        }
      }
    }
  }
  // Fallen masonry at the foot of broken stretches.
  if (lod === 0 && (ruin > 0 || p.endA === 'crumbled' || p.endB === 'crumbled')) {
    for (let k = 0; k < Math.floor(total / 2.2); k++) {
      const s = (k + hash(seed, 700 + k)) * 2.2;
      const nearEnd = (p.endA === 'crumbled' && s < 10) || (p.endB === 'crumbled' && total - s < 10);
      if (!nearEnd && hash(seed, 800 + k) > ruin * 0.8) {
        continue;
      }
      const q = smp[Math.min(n - 1, Math.round((s / total) * (n - 1)))];
      const side = hash(seed, 900 + k) < 0.6 ? 1 : -1;
      const v = side * (half + 0.6 + hash(seed, 1000 + k) * 2.5);
      const bx = q.x + q.mx * v;
      const bz = q.z + q.mz * v;
      boulder(mb, bx, ground(bx, bz) - 0.15, bz, 0.5 + hash(seed, 1100 + k) * 0.8, seed + k * 7, hash(seed, 1200 + k) < 0.3 ? M.brick : M.block);
    }
  }
  // Shrubs rooted on the wall top (fig, caper, ailanthus seedlings).
  const plants = p.plants ?? Math.max(0, (p.weather ?? 0.7) - 0.4) + ruin * 0.6;
  if (lod === 0 && plants > 0) {
    for (let k = 0; k < Math.floor(total / 6); k++) {
      if (hash(seed, 1300 + k) > plants * 0.6) {
        continue;
      }
      const s = (k + hash(seed, 1400 + k)) * 6;
      const i = Math.min(n - 1, Math.round((s / total) * (n - 1)));
      const q = smp[i];
      const v = (hash(seed, 1500 + k) - 0.2) * half;
      shrub(o.foliage ?? mb, q.x + q.mx * v, yTop[i] + paraI[i] * 0.5, q.z + q.mz * v, q.mx, q.mz, 0.9 + hash(seed, 1600 + k) * 1.4, seed + k * 17, lod);
    }
  }
  // Colliders: one box per ~10 m.
  if (o.colliders && lod === 0) {
    let a0 = 0;
    for (let b0 = 1; b0 < n; b0++) {
      if (smp[b0].s - smp[a0].s < 9.5 && b0 < n - 1) {
        continue;
      }
      const A = smp[a0];
      const B = smp[b0];
      const len = Math.hypot(B.x - A.x, B.z - A.z);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = a0; i <= b0; i++) {
        lo = Math.min(lo, yBot(i) + sink - 1.5);
        hi = Math.max(hi, yTop[i] + para);
      }
      if (len > 0.3) {
        collide(o, { cx: (A.x + B.x) / 2, cy: (lo + hi) / 2, cz: (A.z + B.z) / 2, hx: len / 2 + 0.3, hy: (hi - lo) / 2, hz: half + bat * 0.5, yaw: -Math.atan2(B.z - A.z, B.x - A.x) });
      }
      a0 = b0;
    }
  }
}

/* ------------------------------------------------------------------ towers */

export type TowerPlan = 'square' | 'pentagon' | 'hexagon' | 'octagon';

export interface TowerParams {
  plan: TowerPlan;
  /** Width along the wall and projection beyond the wall's outer face (m). */
  width: number;
  projection: number;
  /** Height of the tower platform above the ground at its centre (m). */
  height: number;
  /** Thickness of the curtain it stands on (the tower reaches back to the inner face). */
  wallThickness: number;
  /** Storeys: string courses and window rows (default from the height). */
  storeys?: number;
  merlons?: MerlonParams | null;
  merlonsKept?: number;
  ruin?: number;
  /** Marble inscription band (Theophilos-style) at this fraction of the height; null = none (default: by seed). */
  inscription?: number | null;
  /** Corner chipping (m, default 0.35). */
  chip?: number;
  /** Battered plinth offset (m). */
  plinth?: number;
  style?: WallStyle;
  seed?: number;
  weather?: number;
}

/** Plan ring in local (u along the wall, v outward) coordinates. */
function towerPlanLocal(p: TowerParams): [number, number][] {
  const w = p.width / 2;
  const back = -p.wallThickness / 2 - 0.4;
  const front = p.wallThickness / 2 + p.projection;
  switch (p.plan) {
    case 'pentagon': {
      // Prow tower: square body with a point toward the field (Marmara and Golden Horn sea walls, Blachernae).
      const tip = front + w * 0.75;
      return [[-w, back], [w, back], [w, front], [0, tip], [-w, front]];
    }
    case 'hexagon': {
      const f = front + w * 0.55;
      return [[-w, back], [w, back], [w, front - w * 0.1], [w * 0.5, f], [-w * 0.5, f], [-w, front - w * 0.1]];
    }
    case 'octagon': {
      const r = w / Math.cos(Math.PI / 8);
      const cv = (back + front + w * 0.8) / 2;
      const out: [number, number][] = [];
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + (i * Math.PI) / 4;
        out.push([Math.cos(a) * r, cv + Math.sin(a) * r]);
      }
      return out;
    }
    default:
      return [[-w, back], [w, back], [w, front], [-w, front]];
  }
}

/** Arched opening (recessed dark void with a brick voussoir ring) on a wall face. */
function archOpening(mb: MeshBuilder, M: KitMats, cx: number, cz: number, fx: number, fz: number, y0: number, w: number, h: number, lod: number, slit = false, seed = 0): void {
  // (fx, fz): unit outward normal of the face; u runs along t = (-fz, fx).
  const tx = -fz;
  const tz = fx;
  const r = w / 2;
  const seg = lod === 0 ? 10 : 4;
  const off = 0.1;
  // Most openings of the real towers are broken-out holes: jagged outline, no dressed surround.
  const rough = lod === 0 && hash(seed, 1) < (slit ? 0.35 : 0.65);
  const jit = (i: number): number => (rough ? 1 + (hash(seed, 10 + i) - 0.5) * (slit ? 0.8 : 0.45) : 1);
  const head: [number, number][] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI;
    const k = i === 0 || i === seg ? 1 : jit(i);
    head.push([Math.cos(a) * r * k, h - r + Math.sin(a) * r * k]);
  }
  const P = (u: number, v: number, o: number): V3 => [cx + tx * u + fx * o, y0 + v, cz + tz * u + fz * o];
  const bottomDrop = rough ? 0.25 * hash(seed, 3) : 0;
  const outline: [number, number][] = [[-r * jit(40), -bottomDrop], [r * jit(41), -bottomDrop * 0.4], ...head];
  // Dark void, as a fan from the bottom centre (star-shaped).
  const pts: V3[] = [P(0, -bottomDrop * 0.7, off), ...outline.map(([u, v]) => P(u, v, off))];
  faceTo(mb, pts, pts.flatMap((q, i) => [i, q[1]]), M.void, [fx, 0, fz]);
  if (lod > 0) {
    return;
  }
  if (rough) {
    // Broken reveal: a ragged rim of exposed core around the hole.
    const n = outline.length;
    for (let i = 0; i < n; i++) {
      const [u0, v0] = outline[i];
      const [u1, v1] = outline[(i + 1) % n];
      const cxl = 0;
      const cyl = h * 0.45;
      const e0 = 1.12 + 0.2 * hash(seed, 60 + i);
      const e1 = 1.12 + 0.2 * hash(seed, 60 + ((i + 1) % n));
      const q0 = P(u0, v0, off + 0.01);
      const q1 = P(u1, v1, off + 0.01);
      const q2 = P(cxl + (u1 - cxl) * e1, cyl + (v1 - cyl) * e1, off + 0.01);
      const q3 = P(cxl + (u0 - cxl) * e0, cyl + (v0 - cyl) * e0, off + 0.01);
      faceTo(mb, [q0, q1, q2, q3], [u0, v0, u1, v1, u1, v1 + 0.2, u0, v0 + 0.2], M.core, [fx, 0, fz], 0.7);
    }
    return;
  }
  if (slit) {
    return;
  }
  // Brick voussoirs around the arch head: a ring of quads standing 4 cm proud.
  const rb = r + 0.45;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI;
    const a1 = ((i + 1) / seg) * Math.PI;
    const q0 = P(Math.cos(a0) * r, h - r + Math.sin(a0) * r, off + 0.02);
    const q1 = P(Math.cos(a1) * r, h - r + Math.sin(a1) * r, off + 0.02);
    const q2 = P(Math.cos(a1) * rb, h - r + Math.sin(a1) * rb, off + 0.02);
    const q3 = P(Math.cos(a0) * rb, h - r + Math.sin(a0) * rb, off + 0.02);
    faceTo(mb, [q0, q1, q2, q3], [a0 * rb, 0, a1 * rb, 0, a1 * rb, 0.45, a0 * rb, 0.45], M.brick, [fx, 0, fz]);
  }
  // Stone sill.
  const s0 = P(-r - 0.15, -0.18, off + 0.05);
  const s1 = P(r + 0.15, -0.18, off + 0.05);
  const s2 = P(r + 0.15, 0, off + 0.05);
  const s3 = P(-r - 0.15, 0, off + 0.05);
  faceTo(mb, [s0, s1, s2, s3], [0, 0, w + 0.3, 0, w + 0.3, 0.18, 0, 0.18], M.block, [fx, 0, fz]);
}

/**
 * Tower astride the wall at `at`, facing the outer side of the wall direction `dir` (unit x, z). Returns the platform
 * height (absolute).
 */
export function tower(o: KitOut, at: V2, dir: V2, ground: GroundFn, p: TowerParams): number {
  const mb = o.mb;
  const lod = o.lod;
  const seed = p.seed ?? 7;
  const M = kitMats(p.style ?? 'byzantine', seed, p.weather);
  const [ax, az] = dir;
  const nx = -az;
  const nz = ax;
  const W = (u: number, v: number): V2 => [at[0] + ax * u + nx * v, at[1] + az * u + nz * v];
  const local = towerPlanLocal(p);
  const ring = ensureCCW(local.map(([u, v]) => W(u, v)));
  let gMin = Infinity;
  let gMax = -Infinity;
  for (const q of ring) {
    const g = ground(q[0], q[1]);
    gMin = Math.min(gMin, g);
    gMax = Math.max(gMax, g);
  }
  const g0 = ground(at[0], at[1]);
  const ruin = p.ruin ?? 0;
  const top = g0 + p.height;
  const plinth = p.plinth ?? 0.3;
  const storeys = p.storeys ?? Math.max(2, Math.round(p.height / 6));
  if (lod === 2) {
    prism(mb, ring, gMin - 2, top, M.tower, { cap: true, capMat: M.top, vRef: 0 });
    return top;
  }
  // Battered plinth.
  const plRing = offsetRing(ring, plinth);
  const plTop = gMax + 1.3;
  prism(mb, plRing, gMin - 2.5, plTop - 0.3, M.block, { cap: false, vRef: 0 });
  // Sloped chamfer from the plinth back to the shaft.
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const a0 = plRing[i];
    const a1 = plRing[j];
    const b0 = ring[i];
    const b1 = ring[j];
    const n: V3 = [(a0[0] + a1[0] - b0[0] - b1[0]) / 2, 0.6, (a0[1] + a1[1] - b0[1] - b1[1]) / 2];
    faceTo(mb, [[a0[0], plTop - 0.3, a0[1]], [a1[0], plTop - 0.3, a1[1]], [b1[0], plTop, b1[1]], [b0[0], plTop, b0[1]]], [0, 0, 1, 0, 1, 0.4, 0, 0.4], M.block, n);
  }
  // Shaft: per-vertex tops for ruins (broken, slanting top).
  // Ruined towers: the outline is densified so the broken top can be jagged, stepping in courses.
  let shaft = ring;
  if (ruin > 0 && lod === 0) {
    shaft = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.2));
      for (let j = 0; j < k; j++) {
        shaft.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
      }
    }
  }
  const tops = shaft.map((_, i) => {
    if (ruin <= 0) {
      return top;
    }
    const t = i / shaft.length;
    const drop = p.height * ruin * (0.15 + 0.55 * (noise1(t * 7, seed + 50) * 0.7 + hash(seed, 60 + i) * 0.3));
    return Math.floor((top - drop) / 0.3) * 0.3;
  });
  if (lod === 0) {
    // Shaft faces as relief grids (as weathered as the curtain: bulges, lost facing, brick repairs) on a ring with
    // chipped corners; the broken top of a ruined tower steps in courses.
    const chip = p.chip ?? 0.35;
    const cut = chamfer(ring, (c) => chip * (0.3 + 1.4 * hash(seed, 9000 + c)));
    const per: { x: number; z: number; s: number; e: number }[] = [];
    let perim = 0;
    for (let e = 0; e < cut.length; e++) {
      const a = cut[e];
      const b = cut[(e + 1) % cut.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const k = Math.max(1, Math.ceil(len / 0.8));
      for (let j = 0; j < k; j++) {
        per.push({ x: a[0] + ((b[0] - a[0]) * j) / k, z: a[1] + ((b[1] - a[1]) * j) / k, s: perim + (len * j) / k, e });
      }
      perim += len;
    }
    const topAt = (sv: number, k: number): number => {
      if (ruin <= 0) {
        return top;
      }
      const drop = p.height * ruin * (0.15 + 0.55 * (noise1((sv / perim) * 7, seed + 50) * 0.7 + hash(seed, 60 + k) * 0.3));
      return Math.floor((top - drop) / 0.3) * 0.3;
    };
    const tops2 = per.map((q, k) => topAt(q.s, k));
    const lossAmt = Math.min(1, 0.35 + 0.4 * (p.weather ?? 0.8) + 0.5 * ruin);
    const R = Math.max(4, Math.round((Math.max(...tops2) - plTop) / 0.7));
    for (let e = 0; e < cut.length; e++) {
      const idx: number[] = [];
      per.forEach((q, k) => {
        if (q.e === e) {
          idx.push(k);
        }
      });
      idx.push((idx[idx.length - 1] + 1) % per.length);
      const a = cut[e];
      const b = cut[(e + 1) % cut.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const tx = (b[0] - a[0]) / len;
      const tz = (b[1] - a[1]) / len;
      const fnx = -tz;
      const fnz = tx;
      const g: FacePoint[][] = idx.map((k, ci) => {
        const q = per[k];
        const sv = ci === idx.length - 1 ? per[idx[0]].s + len : q.s;
        const edgeCol = ci === 0 || ci === idx.length - 1;
        const col: FacePoint[] = [];
        for (let r = 0; r <= R; r++) {
          const hRel = r / R;
          const d = edgeCol ? 0 : (noise1(sv / 5, seed + 77) - 0.5) * 0.16 * Math.sin(Math.PI * hRel);
          col.push({ x: q.x + fnx * d, y: plTop + (tops2[k] - plTop) * hRel, z: q.z + fnz * d, u: sv, nx: fnx, nz: fnz, tx, tz });
        }
        return col;
      });
      if (g.length < 2) {
        continue;
      }
      const f = len > 2 ? faceFields(g, seed + e * 31, lossAmt, 1, (i, r) => i === 0 || i === g.length - 1 || r === 0 || r === R) : null;
      reliefSurface(mb, g, f ? f.loss : null, M.tower, f ? (i, r) => (f.repair[i][r] ? M.brick : null) : undefined);
    }
    flatPoly(mb, per.map((q) => [q.x, q.z] as V2), tops2, ruin > 0.3 ? M.grass : M.top);
  } else {
    prism(mb, shaft, plTop, tops, M.tower, { cap: false, vRef: 0 });
    flatPoly(mb, shaft, tops, ruin > 0.3 ? M.grass : M.top);
  }
  // Grass and a shrub on a broken top.
  if (lod === 0 && ruin > 0.2) {
    const fol = o.foliage ?? mb;
    const c = W(0, p.wallThickness / 2 + p.projection / 2);
    const yT = Math.min(...tops);
    shrub(fol, c[0], yT, c[1], nx, nz, 1.2 + hash(seed, 9800) * 1.2, seed + 9801, lod);
    for (let k = 0; k < 6; k++) {
      const q = W((hash(seed, 9810 + k) - 0.5) * p.width * 0.8, p.wallThickness / 2 + hash(seed, 9820 + k) * p.projection);
      tuft(fol, q[0], yT, q[1], seed + 9830 + k);
    }
  }
  // Marble inscription band on the outward faces.
  const insc = p.inscription === undefined ? (hash(seed, 9500) < 0.35 ? 0.55 + 0.2 * hash(seed, 9501) : null) : p.inscription;
  if (lod === 0 && insc !== null && g0 + p.height * insc < Math.min(...tops) - 0.6) {
    const y = g0 + p.height * insc;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const fx = -(b[1] - a[1]) / len;
      const fz = (b[0] - a[0]) / len;
      if (fx * nx + fz * nz < 0.2 || len < 2) {
        continue;
      }
      // Slabs of unequal length with joints, 0.45 m tall, 6 cm proud.
      let t = 0.08;
      let k = 0;
      while (t < 0.92) {
        const t1 = Math.min(0.92, t + (1.2 + 1.3 * hash(seed, 9600 + i * 29 + k)) / len);
        const P = (tt: number, yy: number): V3 => [a[0] + (b[0] - a[0]) * tt + fx * 0.06, yy, a[1] + (b[1] - a[1]) * tt + fz * 0.06];
        faceTo(mb, [P(t, y), P(t1 - 0.02 / len, y), P(t1 - 0.02 / len, y + 0.45), P(t, y + 0.45)], [t * len, 0, t1 * len, 0, t1 * len, 0.45, t * len, 0.45], M.marble, [fx, 0, fz]);
        faceTo(mb, [P(t, y + 0.45), P(t1 - 0.02 / len, y + 0.45), [a[0] + (b[0] - a[0]) * t1, y + 0.45, a[1] + (b[1] - a[1]) * t1], [a[0] + (b[0] - a[0]) * t, y + 0.45, a[1] + (b[1] - a[1]) * t]], [0, 0, 1, 0, 1, 0.06, 0, 0.06], M.marble, [0, 1, 0]);
        t = t1;
        k++;
      }
    }
  }
  // String courses (projecting brick bands at the storey floors).
  if (lod === 0) {
    for (let s = 1; s < storeys; s++) {
      const y = g0 + (p.height * s) / storeys;
      if ((ruin > 0 && y > Math.min(...tops) - 0.5) || hash(seed, 9700 + s) < 0.35) {
        continue;
      }
      prism(mb, chamfer(offsetRing(ring, 0.06), () => (p.chip ?? 0.35) * 0.8), y - 0.27, y, M.brick, { cap: true, capMat: M.brick, vRef: 0 });
    }
  }
  // Openings: arrow slits in the lower storeys, arched windows in the top storey, on faces that look outward.
  if (lod === 0) {
    const minTop = Math.min(...tops);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 2.2) {
        continue;
      }
      const fx = -(b[1] - a[1]) / len;
      const fz = (b[0] - a[0]) / len;
      // Faces on the inner side stay blind below the wall-walk.
      const outward = fx * nx + fz * nz;
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      const gl = ground(mx, mz);
      for (let s = 1; s <= storeys; s++) {
        const yF = g0 + (p.height * (s - 1)) / storeys;
        const hS = p.height / storeys;
        const top = s === storeys;
        if (outward < -0.3 && !top) {
          continue;
        }
        const w = top ? Math.min(1.5, len * 0.28) : 0.32;
        const h = top ? Math.min(hS * 0.62, 2.6) : Math.min(hS * 0.55, 2);
        const y0 = Math.max(yF + hS * 0.25, gl + 3);
        if (y0 + h > minTop - 0.6) {
          continue;
        }
        const count = top && len > 6 ? 2 : 1;
        for (let c = 0; c < count; c++) {
          const t = count === 1 ? 0.5 : (c + 1) / (count + 1);
          archOpening(mb, M, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, fx, fz, y0, w, h, lod, !top, seed + i * 31 + s * 7 + c);
        }
      }
    }
  }
  // Merlons around the platform.
  const ml = p.merlons === undefined ? { ...DEFAULT_MERLONS, w: 1.35, gap: 0.95 } : p.merlons;
  if (lod === 0 && ml && ruin <= 0) {
    const kept = p.merlonsKept ?? 0.45;
    // Low parapet ring under the merlons.
    const inner = offsetRing(ring, -ml.depth);
    prism(mb, ring, top, top + 0.9, M.tower, { cap: false, vRef: 0 });
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const c = inner[(i + 1) % ring.length];
      const d = inner[i];
      faceTo(mb, [[a[0], top + 0.9, a[1]], [b[0], top + 0.9, b[1]], [c[0], top + 0.9, c[1]], [d[0], top + 0.9, d[1]]], [0, 0, 1, 0, 1, 1, 0, 1], M.top, [0, 1, 0]);
      faceTo(mb, [[d[0], top, d[1]], [c[0], top, c[1]], [c[0], top + 0.9, c[1]], [d[0], top + 0.9, d[1]]], [0, top, 1, top, 1, top + 0.9, 0, top + 0.9], M.tower, [-(-(b[1] - a[1])), 0, -(b[0] - a[0])]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const count = Math.max(1, Math.floor(len / (ml.w + ml.gap)));
      const ex = (b[0] - a[0]) / len;
      const ez = (b[1] - a[1]) / len;
      for (let k = 0; k < count; k++) {
        if (hash(seed, 3000 + i * 31 + k) > kept) {
          continue;
        }
        const t = (k + 0.5) / count;
        const fx = -ez;
        const fz = ex;
        const x = a[0] + (b[0] - a[0]) * t - fx * (ml.depth / 2);
        const z = a[1] + (b[1] - a[1]) * t - fz * (ml.depth / 2);
        obox(mb, x, top + 0.85, z, ex, ez, Math.min(ml.w, len / count - 0.3), ml.h * (0.8 + 0.2 * hash(seed, 3500 + k)), ml.depth, M.tower, M.top);
      }
    }
  }
  if (o.colliders) {
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [u, v] of local) {
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const c = W((minU + maxU) / 2, (minV + maxV) / 2);
    const hi = Math.max(...tops) + (ruin <= 0 && ml ? 0.9 + ml.h : 0);
    collide(o, { cx: c[0], cy: (gMin - 2 + hi) / 2, cz: c[1], hx: (maxU - minU) / 2 + plinth, hy: (hi - gMin + 2) / 2, hz: (maxV - minV) / 2 + plinth, yaw: -Math.atan2(az, ax) });
  }
  return top;
}

/* ------------------------------------------------------------------ gate */

export interface GateParams {
  /** Clear opening width and springing height of the arch (m). */
  width: number;
  spring: number;
  /** Curtain parameters for the wall around the gate; the gate is built at the middle of the a→b span. */
  wall: CurtainParams;
  /** Flanking towers (null: a plain passage through the curtain). */
  towers?: Omit<TowerParams, 'wallThickness'> | null;
  /** Leave the wooden leaves closed. */
  doors?: boolean;
}

/**
 * Gateway on the straight span a→b: curtain on both sides, an arched passage through the wall with a brick arch ring
 * and marble jambs, optional flanking towers.
 */
export function gate(o: KitOut, a: V2, b: V2, ground: GroundFn, p: GateParams): void {
  const mb = o.mb;
  const lod = o.lod;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ax = (b[0] - a[0]) / L;
  const az = (b[1] - a[1]) / L;
  const nx = -az;
  const nz = ax;
  const w = p.width;
  const pierW = 1.6;
  const mid = L / 2;
  const u0 = mid - w / 2 - pierW;
  const u1 = mid + w / 2 + pierW;
  const P2 = (u: number, v: number): V2 => [a[0] + ax * u + nx * v, a[1] + az * u + nz * v];
  const wallP: CurtainParams = { ...p.wall, ruin: 0 };
  curtain(o, [a, P2(u0, 0)], ground, { ...wallP, endB: 'flush' });
  curtain(o, [P2(u1, 0), b], ground, { ...wallP, endA: 'flush', seed: (wallP.seed ?? 1) + 5 });
  const seed = p.wall.seed ?? 1;
  const M = kitMats(p.wall.style ?? 'byzantine', seed, p.wall.weather);
  const T = p.wall.thickness;
  const half = T / 2;
  const g = ground(P2(mid, 0)[0], P2(mid, 0)[1]);
  const Htop = g + p.wall.height;
  const para = p.wall.parapet ?? 1.15;
  const r = w / 2;
  const spring = g + p.spring;
  const crown = spring + r;
  const seg = lod === 0 ? 12 : 6;
  const W3 = (u: number, v: number, y: number): V3 => {
    const q = P2(u, v);
    return [q[0], y, q[1]];
  };
  // Piers (full-height blocks each side of the opening) and the mass above the arch.
  const sink = 2.5;
  for (const [s0, s1] of [
    [u0, mid - r],
    [mid + r, u1],
  ]) {
    const len = s1 - s0;
    const c = P2((s0 + s1) / 2, 0);
    obox(mb, c[0], g - sink, c[1], ax, az, len, Htop - g + sink, T, M.wall, M.top);
  }
  // Spandrel faces (outer and inner) between the arch and the wall-walk, strip by strip.
  for (const side of [1, -1]) {
    const v = side * half;
    for (let i = 0; i < seg; i++) {
      const t0 = Math.PI - (i / seg) * Math.PI;
      const t1 = Math.PI - ((i + 1) / seg) * Math.PI;
      const uA = mid + Math.cos(t0) * r;
      const uB = mid + Math.cos(t1) * r;
      const yA = spring + Math.sin(t0) * r;
      const yB = spring + Math.sin(t1) * r;
      const yT = Htop + (side > 0 ? para : 0);
      faceTo(mb, [W3(uA, v, yA), W3(uB, v, yB), W3(uB, v, yT), W3(uA, v, yT)], [uA, yA, uB, yB, uB, yT, uA, yT], M.wall, [nx * side, 0, nz * side]);
    }
  }
  // Vault (intrados) through the wall thickness.
  for (let i = 0; i < seg; i++) {
    const t0 = Math.PI - (i / seg) * Math.PI;
    const t1 = Math.PI - ((i + 1) / seg) * Math.PI;
    const uA = mid + Math.cos(t0) * r;
    const uB = mid + Math.cos(t1) * r;
    const yA = spring + Math.sin(t0) * r;
    const yB = spring + Math.sin(t1) * r;
    const nm = (t0 + t1) / 2;
    const n: V3 = [-Math.cos(nm) * ax, -Math.sin(nm), -Math.cos(nm) * az];
    faceTo(mb, [W3(uA, -half, yA), W3(uB, -half, yB), W3(uB, half, yB), W3(uA, half, yA)], [i * 0.5, 0, (i + 1) * 0.5, 0, (i + 1) * 0.5, T, i * 0.5, T], M.brick, n, 0.55);
  }
  // Threshold paving.
  faceTo(mb, [W3(mid - r, -half, g + 0.05), W3(mid + r, -half, g + 0.05), W3(mid + r, half, g + 0.05), W3(mid - r, half, g + 0.05)], [0, 0, w, 0, w, T, 0, T], M.block, [0, 1, 0]);
  // Brick voussoir ring and a marble lintel band on the outer face.
  if (lod === 0) {
    const rb = r + 0.7;
    for (let i = 0; i < seg; i++) {
      const t0 = Math.PI - (i / seg) * Math.PI;
      const t1 = Math.PI - ((i + 1) / seg) * Math.PI;
      const q = (t: number, rr: number): V3 => W3(mid + Math.cos(t) * rr, half + 0.04, spring + Math.sin(t) * rr);
      faceTo(mb, [q(t0, r), q(t1, r), q(t1, rb), q(t0, rb)], [t0 * rb, 0, t1 * rb, 0, t1 * rb, 0.7, t0 * rb, 0.7], M.brick, [nx, 0, nz]);
    }
    const lb = crown + 1.2;
    const c = P2(mid, half + 0.12);
    obox(mb, c[0], lb, c[1], ax, az, w + 2.4, 0.45, 0.25, M.block, M.block);
    if (p.doors) {
      // Iron-studded wooden leaves at a third of the depth.
      const v = half * 0.3;
      const leaf: V3[] = [W3(mid - r, v, g), W3(mid + r, v, g), W3(mid + r, v, spring), W3(mid - r, v, spring)];
      for (let i = 0; i <= seg; i++) {
        const t = (i / seg) * Math.PI;
        leaf.splice(3 + i, 0, W3(mid + Math.cos(t) * r, v, spring + Math.sin(t) * r));
      }
      faceTo(mb, leaf.slice(0, 3).concat(leaf.slice(3, 3 + seg + 1)), leaf.slice(0, 3 + seg + 1).flatMap((q, i) => [i * 0.3, q[1]]), M.wood, [nx, 0, nz]);
      faceTo(mb, leaf.slice(0, 3).concat(leaf.slice(3, 3 + seg + 1)), leaf.slice(0, 3 + seg + 1).flatMap((q, i) => [i * 0.3, q[1]]), M.wood, [-nx, 0, -nz]);
    }
  }
  // Wall-walk over the gate.
  faceTo(mb, [W3(mid - r, -half, Htop), W3(mid + r, -half, Htop), W3(mid + r, half, Htop), W3(mid - r, half, Htop)], [0, 0, w, 0, w, T, 0, T], M.top, [0, 1, 0]);
  if (para > 0) {
    const pc = P2(mid, half - 0.4);
    obox(mb, pc[0], Htop, pc[1], ax, az, w + 0.02, para, 0.75, M.wall, M.top);
  }
  if (p.towers) {
    const tw = p.towers.width;
    tower(o, P2(u0 - tw / 2 + 0.5, 0), [ax, az], ground, { ...p.towers, wallThickness: T, seed: seed + 101 });
    tower(o, P2(u1 + tw / 2 - 0.5, 0), [ax, az], ground, { ...p.towers, wallThickness: T, seed: seed + 202 });
  }
  if (o.colliders) {
    for (const [s0, s1] of [
      [u0, mid - r],
      [mid + r, u1],
    ]) {
      const c = P2((s0 + s1) / 2, 0);
      collide(o, { cx: c[0], cy: (g - 1 + Htop + para) / 2, cz: c[1], hx: (s1 - s0) / 2, hy: (Htop + para - g + 1) / 2, hz: half, yaw: -Math.atan2(az, ax) });
    }
    const c = P2(mid, 0);
    collide(o, { cx: c[0], cy: (crown + Htop + para) / 2, cz: c[1], hx: r, hy: (Htop + para - crown) / 2, hz: half, yaw: -Math.atan2(az, ax) });
  }
}

/* ------------------------------------------------------------------ sea foundation */

export interface SeaFoundationParams {
  /** Offset of the foundation's inner edge from the wall axis (usually thickness / 2 + batter). */
  offset: number;
  /** Number of steps, tread width and riser height (m). */
  steps?: number;
  tread?: number;
  riser?: number;
  /** Sea floor depth at the foot (m, positive = below sea level). */
  depth?: number;
  /** Riprap boulders in front of the steps (per metre of wall). */
  riprap?: number;
  seed?: number;
  weather?: number;
}

/**
 * Stepped plinth of large blocks along the outer foot of a sea wall, descending into the water, with a band of riprap
 * boulders in front (breakwater stones). Follows the polyline; the top step meets the wall foot at sea level + risers.
 */
export function seaFoundation(o: KitOut, pts: readonly V2[], p: SeaFoundationParams): void {
  const mb = o.mb;
  const lod = o.lod;
  const seed = p.seed ?? 3;
  const M = kitMats('ashlar', seed, p.weather ?? 0.9);
  const steps = p.steps ?? 3;
  const tread = p.tread ?? 0.9;
  const riser = p.riser ?? 0.55;
  const depth = p.depth ?? 2.5;
  const smp = samplePath(pts, lod === 0 ? 2 : 6, () => 0);
  const n = smp.length;
  for (let k = 0; k < steps; k++) {
    const v0 = p.offset + k * tread;
    const v1 = v0 + tread;
    const y = riser * (steps - k) - 0.1;
    for (let i = 0; i < n - 1; i++) {
      const a = smp[i];
      const b = smp[i + 1];
      const at = (q: WallSample, v: number): V3 => [q.x + q.mx * v * q.miter, y, q.z + q.mz * v * q.miter];
      const A0 = at(a, v0);
      const B0 = at(b, v0);
      const A1 = at(a, v1);
      const B1 = at(b, v1);
      faceTo(mb, [A0, B0, B1, A1], [a.s, v0, b.s, v0, b.s, v1, a.s, v1], M.block, [0, 1, 0]);
      const nO: V3 = [a.mx, 0, a.mz];
      faceTo(mb, [[A1[0], -depth, A1[2]], [B1[0], -depth, B1[2]], B1, A1], [a.s, -depth, b.s, -depth, b.s, y, a.s, y], M.block, nO);
    }
  }
  if (lod === 0) {
    const total = smp[n - 1].s;
    const count = Math.floor(total * (p.riprap ?? 0.8));
    for (let k = 0; k < count; k++) {
      const s = hash(seed, 2000 + k) * total;
      let i = 0;
      while (i < n - 2 && smp[i + 1].s < s) {
        i++;
      }
      const q = smp[i];
      const v = p.offset + steps * tread + 0.4 + hash(seed, 2100 + k) * 3.2;
      const size = 0.7 + hash(seed, 2200 + k) * 1.1;
      boulder(mb, q.x + q.mx * v, -0.9 - hash(seed, 2300 + k) * 1.2, q.z + q.mz * v, size, seed + k * 13, M.block);
    }
  }
}
