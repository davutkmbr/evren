import type { Mat, MeshBuilder } from '../mesh-builder';
import { pointAt, polylineLength, type V2, type V3 } from '../geom';
import { Palette } from '../surfaces';
import type { SiteContext } from '../site';
import { box, face } from '../prims/basic';
import { dim, M, tint } from './common';

/**
 * Roman aqueduct arcade along a line landmark's anchors (Bozdoğan Kemeri / Valens aqueduct, 4th c.): see-through
 * round arches on square piers, a second arcade where the valley is deep, a string course between the tiers and the
 * water channel on top. The channel runs at one level (the valley floor + the landmark height, falling gently in the
 * flow direction), so the arcade is tallest over the valley and ends where the hills rise to the channel.
 *
 * Generic rules:
 * - Every OSM way through the landmark (def.crossings, scripts/data/landmark-crossings.ts) gets an arch centred on it,
 *   so no pier stands on a road; the bays between are spaced evenly at about PITCH.
 * - Piers stand on the visible ground (OSM street ground inside the OSM regions) and sink below it.
 * - Bays too low for an arch are solid wall; bays under the hill's surface are left out.
 */
const PITCH = 8.2;
const PIER = 3.4;
/** Solid stone above an arch's crown (m). */
const CROWN = 0.9;
/** Channel block (m) on top of the arcade. */
const CHANNEL = 1.7;
/** Height of the upper arcade (string course to channel, m); used where the arcade is at least TWO_TIERS tall. */
const UPPER = 9.5;
const TWO_TIERS = 17;
/** Lowest clear arch (springing above ground, m); lower bays are solid. */
const MIN_SPRING = 2.2;
/** Channel fall (m per km) in the flow direction (anchor order). */
const FALL = 1.5;

// Drawn with the city-wall material (registry.ts WALL_MATERIAL_SITES): no floodlight channel.
const stone: Mat = tint(M.ashlar, Palette.stoneBuff, 0);
const stoneDark: Mat = tint(M.ashlarGrey, Palette.stoneGreyPink, 0);
const coping: Mat = dim(M.ashlarLight, 0);

interface Frame {
  x: number;
  z: number;
  /** Unit tangent and right-hand normal. */
  tx: number;
  tz: number;
  nx: number;
  nz: number;
}

function frameAt(line: readonly V2[], s: number): Frame {
  const p = pointAt(line, s);
  return { x: p.x, z: p.z, tx: p.tx, tz: p.tz, nx: -p.tz, nz: p.tx };
}

/** Planar quad with its front toward `n` (vertex order fixed up from the Newell normal). */
function quadToward(mb: MeshBuilder, pts: V3[], uv: number[], m: Mat, n: V3, ao = 1): void {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  if (nx * n[0] + ny * n[1] + nz * n[2] < 0) {
    const p = pts.slice().reverse();
    const u: number[] = [];
    for (let i = p.length - 1; i >= 0; i--) {
      u.push(uv[i * 2], uv[i * 2 + 1]);
    }
    face(mb, p, u, m, ao);
  } else {
    face(mb, pts, uv, m, ao);
  }
}

/** Height of a round (or, when rise < w / 2, segmental) arch above its springing at x in [0, w]. */
function archY(x: number, w: number, rise: number): number {
  const c = w / 2;
  if (rise >= c - 1e-3) {
    return Math.sqrt(Math.max(c * c - (x - c) * (x - c), 0));
  }
  const r = (c * c + rise * rise) / (2 * rise);
  return Math.sqrt(Math.max(r * r - (x - c) * (x - c), 0)) - (r - rise);
}

/**
 * Arch opening between stations sA and sB: spandrel faces on both sides from the arch curve up to yTop and the
 * soffit under the curve. u runs along the line (station), v is the world height (level masonry courses).
 */
function arch(mb: MeshBuilder, line: readonly V2[], sA: number, sB: number, spring: number, yTop: number, hw: number, steps: number): void {
  const w = sB - sA;
  const rise = Math.min(w / 2, yTop - CROWN - spring);
  const cy = spring + rise - w / 2;
  const pts: { f: Frame; s: number; y: number }[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const s = sA + w * t;
    pts.push({ f: frameAt(line, s), s, y: spring + archY(w * t, w, rise) });
  }
  for (let k = 0; k < steps; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    for (const side of [1, -1]) {
      const ax = a.f.x + a.f.nx * hw * side;
      const az = a.f.z + a.f.nz * hw * side;
      const bx = b.f.x + b.f.nx * hw * side;
      const bz = b.f.z + b.f.nz * hw * side;
      quadToward(
        mb,
        [
          [ax, a.y, az],
          [bx, b.y, bz],
          [bx, yTop, bz],
          [ax, yTop, az],
        ],
        [a.s, a.y, b.s, b.y, b.s, yTop, a.s, yTop],
        stone,
        [a.f.nx * side, 0, a.f.nz * side],
      );
    }
    // Soffit: faces the arch's centre (below it).
    const cs = sA + w / 2;
    const mid = (a.s + b.s) / 2;
    const f = a.f;
    const toward: V3 = [f.tx * (cs - mid), cy - (a.y + b.y) / 2, f.tz * (cs - mid)];
    quadToward(
      mb,
      [
        [a.f.x + a.f.nx * hw, a.y, a.f.z + a.f.nz * hw],
        [b.f.x + b.f.nx * hw, b.y, b.f.z + b.f.nz * hw],
        [b.f.x - b.f.nx * hw, b.y, b.f.z - b.f.nz * hw],
        [a.f.x - a.f.nx * hw, a.y, a.f.z - a.f.nz * hw],
      ],
      [a.s, hw, b.s, hw, b.s, -hw, a.s, -hw],
      stoneDark,
      toward,
      0.55,
    );
  }
}

/** Straight band (string course, channel) between stations sA and sB, y0..y1, half width hw. */
function band(mb: MeshBuilder, line: readonly V2[], sA: number, sB: number, y0: number, y1: number, hw: number, m: Mat, bottom: boolean): void {
  const a = frameAt(line, sA);
  const b = frameAt(line, sB);
  const c = frameAt(line, (sA + sB) / 2);
  const len = sB - sA;
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const yaw = Math.atan2(-c.tz, c.tx);
  box(mb, mx, y0, mz, len, y1 - y0, hw * 2, yaw, m, { bottom, vRef: 0 });
}

interface Bay {
  /** Pier centre stations at both ends. */
  s0: number;
  s1: number;
  /** Pier widths at both ends. */
  p0: number;
  p1: number;
}

/**
 * Pier stations: an opening centred on every crossing (crossings closer than a pier merge), evenly spaced bays of
 * about PITCH between them, and an abutment pier at both ends of the line.
 */
function pierStations(length: number, crossings: readonly number[]): number[] {
  const inner = PIER / 2;
  const centres: number[] = [];
  for (const c of [...crossings].sort((a, b) => a - b)) {
    if (c < inner + 2 || c > length - inner - 2) {
      continue;
    }
    const last = centres[centres.length - 1];
    if (last !== undefined && c - last < 3) {
      centres[centres.length - 1] = (last + c) / 2;
    } else {
      centres.push(c);
    }
  }
  const piers: number[] = [0];
  if (!centres.length) {
    const n = Math.max(1, Math.round(length / PITCH));
    for (let k = 1; k <= n; k++) {
      piers.push((length * k) / n);
    }
    return piers;
  }
  // Start abutment to the first centre: the centre sits mid-opening, n + 0.5 bays.
  const first = centres[0];
  const n0 = Math.max(0, Math.round(first / PITCH - 0.5));
  const q0 = first / (n0 + 0.5);
  for (let k = n0 - 1; k >= 0; k--) {
    piers.push(first - (k + 0.5) * q0);
  }
  for (let i = 0; i + 1 < centres.length; i++) {
    const a = centres[i];
    const d = centres[i + 1] - a;
    const n = Math.max(1, Math.round(d / PITCH));
    for (let k = 0; k < n; k++) {
      piers.push(a + (k + 0.5) * (d / n));
    }
  }
  const lastC = centres[centres.length - 1];
  const tail = length - lastC;
  const n1 = Math.max(0, Math.round(tail / PITCH - 0.5));
  const q1 = tail / (n1 + 0.5);
  for (let k = 0; k < n1; k++) {
    piers.push(lastC + (k + 0.5) * q1);
  }
  piers.push(length);
  return piers;
}

export function buildAqueduct(ctx: SiteContext): void {
  const def = ctx.def;
  const line: V2[] = def.anchors.map((a) => [a.x, a.z]);
  if (line.length < 2) {
    return;
  }
  const length = polylineLength(line);
  const width = def.bodyWidth ?? 5.6;
  const hw = width / 2;
  const steps = ctx.lod === 0 ? 10 : 4;

  // Lowest ground across the body at a station range (piers and bays stand on it).
  const groundMin = (s0: number, s1: number): number => {
    let g = Infinity;
    const n = Math.max(1, Math.ceil((s1 - s0) / 2));
    for (let k = 0; k <= n; k++) {
      const f = frameAt(line, s0 + ((s1 - s0) * k) / n);
      for (const side of [-1, 0, 1]) {
        g = Math.min(g, ctx.groundOrSea(f.x + f.nx * hw * side, f.z + f.nz * hw * side));
      }
    }
    return g;
  };

  // Channel level: the valley floor plus the landmark height, falling gently along the flow.
  let valley = Infinity;
  for (let s = 0; s <= length; s += 4) {
    valley = Math.min(valley, groundMin(s, s));
  }
  const top0 = valley + def.height + (FALL * length) / 2000;
  const topAt = (s: number): number => top0 - (FALL * s) / 1000;

  const piers = pierStations(length, def.crossings);
  const bays: Bay[] = [];
  for (let i = 0; i + 1 < piers.length; i++) {
    const s0 = piers[i];
    const s1 = piers[i + 1];
    const pitch = s1 - s0;
    const pw = Math.min(PIER, pitch * 0.42);
    bays.push({ s0, s1, p0: i === 0 ? PIER : pw, p1: i + 2 === piers.length ? PIER : pw });
  }

  const chunkAt = (s: number): void => {
    const k = Math.floor(s / 100);
    const f = frameAt(line, Math.min(k * 100, length));
    ctx.chunk(`k${k}`, f.x, f.z);
  };

  const drawnPier = new Set<number>();
  const pier = (i: number, pw: number): void => {
    if (drawnPier.has(i)) {
      return;
    }
    drawnPier.add(i);
    const s = piers[i];
    const a = Math.max(0, s - pw / 2);
    const b = Math.min(length, s + pw / 2);
    const top = topAt(s) - CHANNEL;
    const g = groundMin(a, b);
    if (g > top - 0.5) {
      return;
    }
    const f = frameAt(line, (a + b) / 2);
    const yaw = Math.atan2(-f.tz, f.tx);
    box(ctx.mb, f.x, g - 1.5, f.z, b - a, top - g + 1.5, width, yaw, stone, { vRef: 0 });
    ctx.boxCollider(f.x, f.z, b - a, width, Math.atan2(f.tz, f.tx), g - 1.5, top);
  };

  for (let i = 0; i < bays.length; i++) {
    const bay = bays[i];
    chunkAt((bay.s0 + bay.s1) / 2);
    const mb = ctx.mb;
    const sA = bay.s0 + bay.p0 / 2;
    const sB = bay.s1 - bay.p1 / 2;
    const sMid = (bay.s0 + bay.s1) / 2;
    const top = topAt(sMid);
    const tierTop = top - CHANNEL;
    const g = groundMin(sA, sB);
    if (g > tierTop - 0.5) {
      continue; // under the hill
    }
    pier(i, bay.p0);
    pier(i + 1, bay.p1);
    const f = frameAt(line, sMid);
    const along = Math.atan2(f.tz, f.tx);
    const w = sB - sA;
    const twoTiers = tierTop - g >= TWO_TIERS;
    const lowerTop = twoTiers ? tierTop - UPPER : tierTop;
    const spring = lowerTop - CROWN - w / 2;
    if (spring - g < MIN_SPRING) {
      // Too low for an arch: solid wall between the piers.
      band(mb, line, sA, sB, g - 1.5, tierTop, hw, stone, false);
      ctx.boxCollider(f.x, f.z, w, width, along, g - 1.5, top);
    } else {
      arch(mb, line, sA, sB, spring, lowerTop, hw, steps);
      ctx.boxCollider(f.x, f.z, w, width, along, spring + w * 0.35, twoTiers ? lowerTop : top);
    }
    if (twoTiers) {
      // String course between the tiers, then the upper arcade.
      band(mb, line, bay.s0, bay.s1, lowerTop - 0.35, lowerTop + 0.25, hw + 0.22, coping, true);
      const upSpring = tierTop - CROWN - w / 2;
      arch(mb, line, sA, sB, upSpring, tierTop, hw, steps);
      ctx.boxCollider(f.x, f.z, w, width, along, upSpring + w * 0.35, top);
    }
    // Water channel with a projecting cornice.
    band(mb, line, bay.s0, bay.s1, tierTop, tierTop + 0.45, hw + 0.25, coping, true);
    band(mb, line, bay.s0, bay.s1, tierTop + 0.45, top, hw, stone, false);
  }
}
