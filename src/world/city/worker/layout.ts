/**
 * Base-cell layout: superblock street systems -> blocks -> lots -> building records, plus street lights.
 * Deterministic from world position alone, so any tile/LOD that covers a cell regenerates identical buildings.
 */
import { BASE_CELL, Style, type StyleId } from '../protocol';
import { BType, Typ, makeBuilding, type BuildingRec, type LotInput, type TypId } from './building';
import { LU, type GeoSampler } from './geo-sampler';
import { Rng, hash01, hashInts, valueNoise } from './rng';
import { SB_SPACING, getSuperblock, ownerAt, seedOf, type Superblock } from './superblocks';
import { distToSegment, type Segment, type WorldData } from './world-data';

const WORLD_HALF = 24000;
const SB_REACH = 460;
/** City cores (local metres): Beyoğlu/Galata, Sultanahmet, Kadıköy, Üsküdar, Şişli, Beşiktaş. */
const CORES: readonly [number, number][] = [
  [-3470, 2410],
  [-3790, 4260],
  [640, 6120],
  [-50, 2250],
  [-2550, -1110],
  [-1200, 60],
];

export interface CellLayout {
  buildings: BuildingRec[];
  /** x, y, z per lamp. */
  lampPos: number[];
  /** Packed 0xRRGGBBTT per lamp. */
  lampCol: number[];
}

export function cellBounds(ci: number, cj: number): [number, number, number, number] {
  const x0 = -WORLD_HALF + ci * BASE_CELL;
  const z0 = -WORLD_HALF + cj * BASE_CELL;
  return [x0, z0, x0 + BASE_CELL, z0 + BASE_CELL];
}

function coreDistance(x: number, z: number): number {
  let d = Infinity;
  for (const [cx, cz] of CORES) {
    d = Math.min(d, Math.hypot(x - cx, z - cz));
  }
  return d;
}

const segScratch: Segment[] = [];

function roadDistance(world: WorldData, x: number, z: number): number {
  const segs = world.roads.query(x - 80, z - 80, x + 80, z + 80, segScratch);
  let best = Infinity;
  for (const s of segs) {
    if (s.kind === 3) {
      continue;
    }
    const d = distToSegment(x, z, s).d - s.width * 0.5;
    if (d < best) {
      best = d;
    }
  }
  return best;
}

interface BlockFrame {
  sb: Superblock;
  /** Block origin (corner at local 0,0) in world and its axes. */
  ox: number;
  oz: number;
  ex: number;
  ez: number;
  W: number;
  D: number;
  kx: number;
  kz: number;
}

/** Street-warp displacement (organic, winding streets in historic quarters). */
function warp(sb: Superblock, x: number, z: number, out: [number, number]): [number, number] {
  const p = sb.profile;
  if (p.warpAmp <= 0) {
    out[0] = x;
    out[1] = z;
    return out;
  }
  const s = 1 / p.warpScale;
  out[0] = x + (valueNoise(x * s, z * s, sb.warpSalt) - 0.5) * 2 * p.warpAmp;
  out[1] = z + (valueNoise(x * s + 17.3, z * s - 9.1, sb.warpSalt + 1) - 0.5) * 2 * p.warpAmp;
  return out;
}

const w0: [number, number] = [0, 0];
const w1: [number, number] = [0, 0];

interface PlacedLot {
  x: number;
  z: number;
  a: number;
  w: number;
  d: number;
  party1: boolean;
  party3: boolean;
  party2: boolean;
  variant: number;
}

/** Block-local point -> world (before warp). */
function blockToWorld(f: BlockFrame, lx: number, lz: number): [number, number] {
  return [f.ox + lx * f.ex - lz * f.ez, f.oz + lx * f.ez + lz * f.ex];
}

/**
 * Places a lot given in block coordinates (centre, facing normal in block frame, width along the row,
 * depth toward the block interior) and applies the street warp.
 */
function placeLot(f: BlockFrame, lx: number, lz: number, nx: number, nz: number, w: number, d: number, party1: boolean, party3: boolean, party2: boolean, out: PlacedLot[], variant = 0): void {
  const [cx, cz] = blockToWorld(f, lx, lz);
  // Facing normal to world.
  const wnx = nx * f.ex - nz * f.ez;
  const wnz = nx * f.ez + nz * f.ex;
  // Local +x axis of the building: ex = (-n.z, n.x).
  const axx = -wnz;
  const axz = wnx;
  const sb = f.sb;
  warp(sb, cx - axx * 4, cz - axz * 4, w0);
  warp(sb, cx + axx * 4, cz + axz * 4, w1);
  const mx = (w0[0] + w1[0]) * 0.5;
  const mz = (w0[1] + w1[1]) * 0.5;
  const a = Math.atan2(w1[1] - w0[1], w1[0] - w0[0]);
  out.push({ x: mx, z: mz, a, w, d, party1, party3, party2, variant });
}

function frontages(rng: Rng, length: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  let rest = length;
  while (rest > 0) {
    let f = rng.range(lo, hi);
    if (rest - f < lo * 0.7) {
      f = rest;
    }
    out.push(Math.min(f, rest));
    rest -= f;
  }
  return out;
}

/**
 * A row of attached buildings along a block edge. (sx, sz) = row start in block coords, (tx, tz) = row
 * direction, (nx, nz) = outward street normal, depth measured inward.
 */
function row(
  f: BlockFrame,
  rng: Rng,
  sx: number,
  sz: number,
  tx: number,
  tz: number,
  nx: number,
  nz: number,
  length: number,
  depth: number,
  lo: number,
  hi: number,
  attachedStart: boolean,
  attachedEnd: boolean,
  gapChance: number,
  out: PlacedLot[],
): void {
  if (length < lo * 0.8) {
    return;
  }
  const fs = frontages(rng, length, lo, hi);
  // Building local +x = (-n.z, n.x) in block frame; if the row runs along +x, the row start touches side 1 (-x).
  const startIsSide1 = tx * -nz + tz * nx > 0;
  let s = 0;
  const gaps = fs.map(() => rng.chance(gapChance));
  for (let k = 0; k < fs.length; k++) {
    const fw = fs[k];
    const mid = s + fw * 0.5;
    s += fw;
    if (gaps[k]) {
      continue;
    }
    const lx = sx + tx * mid - nx * depth * 0.5;
    const lz = sz + tz * mid - nz * depth * 0.5;
    const atStart = k > 0 ? !gaps[k - 1] : attachedStart;
    const atEnd = k < fs.length - 1 ? !gaps[k + 1] : attachedEnd;
    const p1 = startIsSide1 ? atStart : atEnd;
    const p3 = startIsSide1 ? atEnd : atStart;
    placeLot(f, lx, lz, nx, nz, fw, depth, p1, p3, false, out);
  }
}

function perimeterBlock(f: BlockFrame, rng: Rng, historic: boolean, out: PlacedLot[]): void {
  const { W, D } = f;
  const depth = historic ? rng.range(9, 14) : rng.range(12, 16.5);
  const lo = historic ? 5.5 : 8;
  const hi = historic ? 10.5 : 15;
  const gap = historic ? 0.07 : 0.05;
  if (D < 2 * depth + 5) {
    const dd = Math.min(D, historic ? 17 : 20);
    row(f, rng, 0, 0, 1, 0, 0, -1, W, dd, lo, hi, false, false, gap, out);
    if (D - dd > 11) {
      row(f, rng, W, D, -1, 0, 0, 1, W, Math.min(D - dd - 2, depth), lo, hi, false, false, gap + 0.1, out);
    }
    return;
  }
  row(f, rng, 0, 0, 1, 0, 0, -1, W, depth, lo, hi, false, false, gap, out);
  row(f, rng, W, D, -1, 0, 0, 1, W, depth, lo, hi, false, false, gap, out);
  const inner = D - 2 * depth;
  if (inner > lo) {
    row(f, rng, 0, D - depth, 0, -1, -1, 0, inner, Math.min(depth, W * 0.5 - 1), lo, hi, true, true, gap, out);
    if (W > 2 * depth + 4) {
      row(f, rng, W, depth, 0, 1, 1, 0, inner, depth, lo, hi, true, true, gap, out);
    }
  }
}

function detachedBlock(f: BlockFrame, rng: Rng, lotLo: number, lotHi: number, depLo: number, depHi: number, setback: number, out: PlacedLot[]): void {
  const { W, D } = f;
  const dep = rng.range(depLo, depHi);
  const twoRows = D >= 2 * (dep + setback) + 5;
  const rows = twoRows ? 2 : 1;
  for (let r = 0; r < rows; r++) {
    const fs = frontages(rng, W, lotLo, lotHi);
    let s = 0;
    for (const lotW of fs) {
      const gapW = rng.range(3.5, 7);
      const bw = Math.max(8, lotW - gapW);
      const bd = Math.min(dep * rng.range(0.85, 1.1), twoRows ? D * 0.5 - setback - 2 : D - setback * 2);
      const mid = s + lotW * 0.5;
      s += lotW;
      if (bd < 8 || rng.chance(0.06)) {
        continue;
      }
      if (r === 0) {
        placeLot(f, mid, setback + bd * 0.5, 0, -1, bw, bd, false, false, false, out);
      } else {
        placeLot(f, mid, D - setback - bd * 0.5, 0, 1, bw, bd, false, false, false, out);
      }
    }
  }
}

function massBlock(f: BlockFrame, rng: Rng, out: PlacedLot[]): void {
  const { W, D } = f;
  const dep = rng.range(12, 15);
  const rows = D > 75 ? 2 : 1;
  for (let r = 0; r < rows; r++) {
    let s = rng.range(4, 10);
    while (s < W - 20) {
      const len = Math.min(rng.range(26, 52), W - s - 4);
      if (len < 18) {
        break;
      }
      const zc = rows === 1 ? D * 0.5 : r === 0 ? D * 0.27 : D * 0.73;
      placeLot(f, s + len * 0.5, zc, 0, r === 0 ? -1 : 1, len, dep, false, false, false, out);
      s += len + rng.range(16, 28);
    }
  }
}

function towerBlock(f: BlockFrame, rng: Rng, out: PlacedLot[]): void {
  const { W, D } = f;
  const n = W > 110 ? 2 : 1;
  if (rng.chance(0.45)) {
    placeLot(f, W * 0.5, D * 0.5, 0, -1, W - rng.range(8, 16), D - rng.range(8, 16), false, false, false, out, 1);
  }
  for (let k = 0; k < n; k++) {
    const side = Math.min(rng.range(26, 44), D - 16, (W / n) - 16);
    if (side < 18) {
      continue;
    }
    const aspect = rng.range(0.7, 1.35);
    const tw = Math.min(side * aspect, W / n - 12);
    const td = Math.min(side / aspect, D - 12);
    const xc = (W / n) * (k + 0.5) + rng.range(-5, 5);
    placeLot(f, xc, D * 0.5 + rng.range(-4, 4), 0, rng.chance(0.5) ? -1 : 1, tw, td, false, false, false, out);
  }
}

function villaBlock(f: BlockFrame, rng: Rng, cellLo: number, cellHi: number, out: PlacedLot[]): void {
  const { W, D } = f;
  const cw = rng.range(cellLo, cellHi);
  const nx = Math.max(1, Math.floor(W / cw));
  const nz = Math.max(1, Math.floor(D / cw));
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (rng.chance(0.18)) {
        continue;
      }
      const w = rng.range(9, 15);
      const d = rng.range(8.5, 13);
      const x = ((i + 0.5) * W) / nx + rng.range(-3, 3);
      const z = ((j + 0.5) * D) / nz + rng.range(-3, 3);
      if (x - w * 0.5 < 3 || x + w * 0.5 > W - 3 || z - d * 0.5 < 3 || z + d * 0.5 > D - 3) {
        continue;
      }
      const face = j === 0 ? -1 : j === nz - 1 ? 1 : rng.chance(0.5) ? -1 : 1;
      const jit = rng.range(-0.18, 0.18);
      placeLot(f, x, z, Math.sin(jit), face * Math.cos(jit), w, d, false, false, false, out);
    }
  }
}

function industrialBlock(f: BlockFrame, rng: Rng, out: PlacedLot[]): void {
  const { W, D } = f;
  const n = W > 150 ? rng.int(2, 3) : W > 90 ? rng.int(1, 2) : 1;
  const part = W / n;
  for (let k = 0; k < n; k++) {
    const w = part - rng.range(8, 16);
    const d = D - rng.range(10, 22);
    if (w < 18 || d < 14) {
      continue;
    }
    placeLot(f, part * (k + 0.5), D * 0.5, 0, -1, w, d, false, false, false, out);
  }
}

function typologyFor(style: StyleId, lu: number, coreDist: number, rng: Rng): TypId {
  if (lu === LU.Highrise) {
    return rng.chance(0.62) ? Typ.Tower : Typ.Detached;
  }
  if (lu === LU.Industrial) {
    return Typ.Industrial;
  }
  if (lu === LU.Suburban) {
    return style === Style.Villa || style === Style.Yali ? Typ.Villa : Typ.Suburb;
  }
  if (lu === LU.HistoricUrban) {
    return Typ.RowHistoric;
  }
  switch (style) {
    case Style.Historic:
      return Typ.RowHistoric;
    case Style.Dense:
      if (coreDist > 9000 && rng.chance(0.14)) {
        return Typ.Mass;
      }
      return coreDist > 6500 && rng.chance(0.28) ? Typ.Detached : Typ.RowDense;
    case Style.Modern:
      if (coreDist > 5000 && rng.chance(0.3)) {
        return Typ.Mass;
      }
      return rng.chance(0.78) ? Typ.Detached : Typ.RowDense;
    case Style.Highrise:
      return rng.chance(0.3) ? Typ.Tower : rng.chance(0.55) ? Typ.Detached : Typ.RowDense;
    case Style.Villa:
      return Typ.Villa;
    case Style.Yali:
      return rng.chance(0.55) ? Typ.Villa : Typ.Suburb;
    case Style.Industrial:
      return Typ.Industrial;
    default:
      return Typ.Suburb;
  }
}

function lampColor(type: number, variant: number): number {
  if (type === 2) {
    return variant === 0 ? 0xffa04a02 : 0xe8ecff02;
  }
  if (variant === 0) {
    return 0xff9a3e01;
  }
  return variant === 1 ? 0xffcf9a01 : 0xf0ebe401;
}

function pushLamp(out: CellLayout, x: number, y: number, z: number, col: number): void {
  out.lampPos.push(x, y, z);
  out.lampCol.push(col);
}

function blockLamps(f: BlockFrame, geo: GeoSampler, cell: [number, number, number, number], out: CellLayout): void {
  const { W, D, sb } = f;
  let ok = 0;
  for (const [u, v] of [
    [0.5, 0.5],
    [0.25, 0.25],
    [0.75, 0.75],
    [0.25, 0.75],
    [0.75, 0.25],
  ]) {
    const [x, z] = blockToWorld(f, W * u, D * v);
    if (geo.buildable(x, z)) {
      ok++;
    }
  }
  if (ok < 2) {
    return;
  }
  const spacing = sb.style === Style.Historic ? 24 : sb.style === Style.Villa ? 38 : 31;
  const off = sb.style === Style.Historic ? 0.6 : 1.4;
  const col = lampColor(1, sb.lampType);
  const edges: [number, number, number, number, number][] = [
    [0, -off, 1, 0, W],
    [W + off, 0, 0, 1, D],
  ];
  // Two block edges per block (the opposite pair comes from the neighbouring blocks).
  for (const [sx, sz, tx, tz, len] of edges) {
    const n = Math.max(1, Math.floor(len / spacing));
    for (let k = 0; k < n; k++) {
      const s = (k + 0.5) * (len / n);
      const [bx, bz] = blockToWorld(f, sx + tx * s, sz + tz * s);
      warp(sb, bx, bz, w0);
      const x = w0[0];
      const z = w0[1];
      if (x < cell[0] || x >= cell[2] || z < cell[1] || z >= cell[3] || ownerAt(x, z).owner !== sb.id) {
        continue;
      }
      const lu = geo.landUse(x, z);
      if (lu === LU.Water || lu === LU.Forest || lu === LU.Park || lu === LU.Cemetery || lu === LU.Landmark || geo.coast(x, z) < 2) {
        continue;
      }
      pushLamp(out, x, geo.height(x, z) + 7.2, z, col);
    }
  }
}

function roadLamps(world: WorldData, geo: GeoSampler, cell: [number, number, number, number], out: CellLayout): void {
  const segs = world.roads.query(cell[0] - 30, cell[1] - 30, cell[2] + 30, cell[3] + 30, segScratch);
  const spacing = 38;
  for (const s of segs) {
    if (s.kind === 3) {
      continue;
    }
    const tx = (s.bx - s.ax) / s.len;
    const tz = (s.bz - s.az) / s.len;
    const variant = hash01(s.line, 7) < 0.55 ? 1 : 0;
    const col = lampColor(2, variant);
    const k0 = Math.ceil(s.s0 / spacing);
    const k1 = Math.floor((s.s0 + s.len) / spacing);
    for (let k = k0; k <= k1; k++) {
      const t = k * spacing - s.s0;
      const px = s.ax + tx * t;
      const pz = s.az + tz * t;
      const sides = s.width > 20 ? [-1, 0, 1] : [-1, 1];
      for (const side of sides) {
        if (side === 0 && (k & 1) === 1) {
          continue;
        }
        const o = side === 0 ? 0 : side * (s.width * 0.5 + 1.2);
        const x = px - tz * o;
        const z = pz + tx * o;
        if (x < cell[0] || x >= cell[2] || z < cell[1] || z >= cell[3]) {
          continue;
        }
        const h = geo.height(x, z);
        if (h < 0.5 || geo.coast(x, z) < 1) {
          continue;
        }
        pushLamp(out, x, h + (s.width > 20 ? 11 : 9), z, col);
      }
    }
  }
}

/** Yalıs: a row of waterfront mansions along the shore of 'yali' districts, facing the water. */
function yaliRow(world: WorldData, geo: GeoSampler, cell: [number, number, number, number], out: BuildingRec[]): void {
  const segs = world.coasts.query(cell[0] - 20, cell[1] - 20, cell[2] + 20, cell[3] + 20, segScratch);
  const spacing = 30;
  for (const s of segs) {
    const tx = (s.bx - s.ax) / s.len;
    const tz = (s.bz - s.az) / s.len;
    const k0 = Math.ceil(s.s0 / spacing);
    const k1 = Math.floor((s.s0 + s.len) / spacing);
    for (let k = k0; k <= k1; k++) {
      const t = k * spacing - s.s0;
      const px = s.ax + tx * t;
      const pz = s.az + tz * t;
      if (px < cell[0] || px >= cell[2] || pz < cell[1] || pz >= cell[3]) {
        continue;
      }
      const di = world.districtNear(px, pz);
      if (di < 0 || world.districts[di].style !== Style.Yali) {
        continue;
      }
      const slotSeed = hashInts(s.line, k, 991);
      const rng = new Rng(slotSeed);
      if (rng.chance(0.22)) {
        continue;
      }
      // Land side: the side where the signed coast distance grows.
      let nx = -tz;
      let nz = tx;
      if (geo.coast(px + nx * 14, pz + nz * 14) < geo.coast(px - nx * 14, pz - nz * 14)) {
        nx = -nx;
        nz = -nz;
      }
      const w = rng.range(15, 25);
      const d = rng.range(11, 15);
      let o = 5;
      for (let it = 0; it < 3; it++) {
        const c = geo.coast(px + nx * o, pz + nz * o);
        o = Math.max(2, Math.min(40, o + (5.5 - c)));
      }
      const cx = px + nx * (o + d * 0.5);
      const cz = pz + nz * (o + d * 0.5);
      // Front faces the water: front direction = -n  =>  a = atan2(-n.x, n.z).
      const lot: LotInput = {
        x: cx,
        z: cz,
        a: Math.atan2(-nx, nz),
        w,
        d,
        typ: Typ.Yali,
        style: Style.Yali,
        district: world.districts[di],
        party1: false,
        party3: false,
        party2: false,
        roadDist: 999,
        coreDist: coreDistance(cx, cz),
        seed: slotSeed,
      };
      const b = makeBuilding(lot, geo);
      if (b) {
        out.push(b);
      }
    }
  }
}

export function layoutCell(ci: number, cj: number, geo: GeoSampler, world: WorldData): CellLayout {
  const cell = cellBounds(ci, cj);
  const out: CellLayout = { buildings: [], lampPos: [], lampCol: [] };
  const [x0, z0, x1, z1] = cell;
  const i0 = Math.floor((x0 - SB_REACH) / SB_SPACING);
  const i1 = Math.floor((x1 + SB_REACH) / SB_SPACING);
  const j0 = Math.floor((z0 - SB_REACH) / SB_SPACING);
  const j1 = Math.floor((z1 + SB_REACH) / SB_SPACING);
  const lots: PlacedLot[] = [];
  const margin = 40;

  const ccx = (x0 + x1) * 0.5;
  const ccz = (z0 + z1) * 0.5;
  const reach2 = (BASE_CELL * 0.72 + SB_SPACING * 1.25) ** 2;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const [seedX, seedZ] = seedOf(i, j);
      if ((seedX - ccx) ** 2 + (seedZ - ccz) ** 2 > reach2) {
        continue;
      }
      const sb = getSuperblock(i, j, world);
      const p = sb.profile;
      // Cell rectangle in the superblock frame.
      let lx0 = Infinity;
      let lx1 = -Infinity;
      let lz0 = Infinity;
      let lz1 = -Infinity;
      for (const [cx, cz] of [
        [x0 - margin - p.warpAmp, z0 - margin - p.warpAmp],
        [x1 + margin + p.warpAmp, z0 - margin - p.warpAmp],
        [x0 - margin - p.warpAmp, z1 + margin + p.warpAmp],
        [x1 + margin + p.warpAmp, z1 + margin + p.warpAmp],
      ]) {
        const dx = cx - sb.sx;
        const dz = cz - sb.sz;
        const lx = dx * sb.cos + dz * sb.sin;
        const lz = -dx * sb.sin + dz * sb.cos;
        lx0 = Math.min(lx0, lx);
        lx1 = Math.max(lx1, lx);
        lz0 = Math.min(lz0, lz);
        lz1 = Math.max(lz1, lz);
      }
      for (let kz = 0; kz < sb.zs.length - 1; kz++) {
        if (sb.zs[kz + 1] < lz0 || sb.zs[kz] > lz1) {
          continue;
        }
        for (let kx = 0; kx < sb.xs.length - 1; kx++) {
          if (sb.xs[kx + 1] < lx0 || sb.xs[kx] > lx1) {
            continue;
          }
          generateBlock(sb, kx, kz, geo, world, cell, lots, out);
        }
      }
    }
  }

  yaliRow(world, geo, cell, out.buildings);
  roadLamps(world, geo, cell, out);
  return out;
}

function generateBlock(
  sb: Superblock,
  kx: number,
  kz: number,
  geo: GeoSampler,
  world: WorldData,
  cell: [number, number, number, number],
  scratch: PlacedLot[],
  out: CellLayout,
): void {
  const half = sb.streetHalf;
  const bx0 = sb.xs[kx] + half;
  const bx1 = sb.xs[kx + 1] - half;
  const bz0 = sb.zs[kz] + half;
  const bz1 = sb.zs[kz + 1] - half;
  const W = bx1 - bx0;
  const D = bz1 - bz0;
  if (W < 10 || D < 10) {
    return;
  }
  const rng = new Rng(hashInts(sb.i, sb.j, kx, kz * 131 + 7));
  // Block jitter: small rotation/offset so neighbouring streets are not perfectly parallel.
  const jit = (rng.next() - 0.5) * 2 * sb.profile.blockJitter;
  const ang = sb.angle + jit;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  // Block centre in world.
  const lcx = (bx0 + bx1) * 0.5;
  const lcz = (bz0 + bz1) * 0.5;
  const wcx = sb.sx + lcx * sb.cos - lcz * sb.sin + rng.range(-1.5, 1.5);
  const wcz = sb.sz + lcx * sb.sin + lcz * sb.cos + rng.range(-1.5, 1.5);
  // Skip blocks lying entirely inside another superblock.
  const own = ownerAt(wcx, wcz);
  const halfDiag = Math.hypot(W, D) * 0.5;
  if (own.owner !== sb.id && own.edge > halfDiag + 10) {
    return;
  }
  const f: BlockFrame = {
    sb,
    ox: wcx - (W * 0.5) * ca + (D * 0.5) * sa,
    oz: wcz - (W * 0.5) * sa - (D * 0.5) * ca,
    ex: ca,
    ez: sa,
    W,
    D,
    kx,
    kz,
  };
  const lu = geo.landUse(wcx, wcz);
  const coreDist = coreDistance(wcx, wcz);
  const typ = typologyFor(sb.style, lu === LU.Road || lu === LU.Water ? LU.Urban : lu, coreDist, rng);

  scratch.length = 0;
  switch (typ) {
    case Typ.RowHistoric:
      perimeterBlock(f, rng, true, scratch);
      break;
    case Typ.RowDense:
      perimeterBlock(f, rng, false, scratch);
      break;
    case Typ.Detached:
      detachedBlock(f, rng, 19, 28, 12, 18, 4, scratch);
      break;
    case Typ.Mass:
      massBlock(f, rng, scratch);
      break;
    case Typ.Tower:
      towerBlock(f, rng, scratch);
      break;
    case Typ.Villa:
      villaBlock(f, rng, 24, 34, scratch);
      break;
    case Typ.Suburb:
      detachedBlock(f, rng, 15, 21, 9, 13, 3, scratch);
      break;
    case Typ.Industrial:
      industrialBlock(f, rng, scratch);
      break;
    default:
      break;
  }

  const [x0, z0, x1, z1] = cell;
  const mainHalf = sb.profile.mainHalf;
  const districtIdx = sb.district;
  // Block-wide zoning: one height bias per block (smoothly varying across the neighbourhood) and one road bonus.
  const blockBias = (valueNoise(wcx / 420, wcz / 420, 313) - 0.5) * 2.2 + (rng.next() - 0.5) * 1.4;
  const roadBonus = rng.chance(0.6) ? 1 : 2;
  for (let n = 0; n < scratch.length; n++) {
    const lot = scratch[n];
    if (lot.x < x0 || lot.x >= x1 || lot.z < z0 || lot.z >= z1) {
      continue;
    }
    // Voronoi ownership with a clear collector street along the superblock edge.
    const ca2 = Math.cos(lot.a);
    const sa2 = Math.sin(lot.a);
    let owned = true;
    for (let c = 0; c < 4 && owned; c++) {
      const lx = (c === 0 || c === 3 ? -0.5 : 0.5) * lot.w;
      const lz = (c < 2 ? -0.5 : 0.5) * lot.d;
      const px = lot.x + lx * ca2 - lz * sa2;
      const pz = lot.z + lx * sa2 + lz * ca2;
      const o = ownerAt(px, pz);
      if (o.owner !== sb.id || o.edge < mainHalf) {
        owned = false;
      }
    }
    if (!owned) {
      continue;
    }
    const di = world.districtIndexAt(lot.x, lot.z);
    const district = di >= 0 ? world.districts[di] : districtIdx >= 0 ? world.districts[districtIdx] : null;
    if (sb.style === Style.Yali && geo.coast(lot.x, lot.z) < 42) {
      continue;
    }
    const input: LotInput = {
      x: lot.x,
      z: lot.z,
      a: lot.a,
      w: lot.w,
      d: lot.d,
      typ: lot.variant === 1 ? Typ.Tower : typ,
      style: sb.style,
      district,
      party1: lot.party1,
      party3: lot.party3,
      party2: lot.party2,
      roadDist: roadDistance(world, lot.x, lot.z),
      coreDist,
      seed: hashInts(sb.i * 977 + kx, sb.j * 991 + kz, n, 0x51ed),
      blockBias,
      roadBonus,
    };
    const b = makeBuilding(input, geo);
    if (!b) {
      continue;
    }
    if (lot.variant === 1) {
      b.type = BType.Podium;
      b.floors = 2 + (b.seed % 3);
      b.floorH = 4.4;
      b.gfH = 5.2;
      b.height = b.gfH + (b.floors - 1) * b.floorH;
      b.roof = 0;
    }
    out.buildings.push(b);
  }
  blockLamps(f, geo, cell, out);
}
