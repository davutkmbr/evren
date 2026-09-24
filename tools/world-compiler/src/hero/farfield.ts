/**
 * Far field (prop hero_skyline): the city beyond the compiled Kadıköy area, as seen from the pier square across the
 * water (S1 critique: "the horizon is empty": c01–c03 show the European shore, Üsküdar / Harem, Haydarpaşa and Moda
 * in the photos). Coarse massing only, 0.6–5.5 km out, in one prop placed at ANCHOR (world metres minus ANCHOR = prop
 * space): shore bands of building blocks (heights by district, climbing the hills, window bands that light at night)
 * and the landmark silhouettes that make the skyline readable — Hagia Sophia, the Blue Mosque, Süleymaniye, Yeni
 * Cami, Topkapı's tower, Galata Tower, Kız Kulesi, the Selimiye barracks and Haydarpaşa station with its breakwater.
 *
 * Positions are latitude / longitude of the landmarks and shore points converted with the Evren frame
 * (src/core/geo-coords.ts); accuracy is tens of metres, enough at these distances. This is a stopgap until
 * neighbouring areas are compiled (then their LOD2 tiles replace it).
 */
import { latLonToLocal } from '../../../../src/core/geo-coords';
import type { PropDef } from '../props';
import type { TileMesh, Vec3 } from '../mesh';
import { Builder } from './kit';

/** Placement of the prop (world metres): the 1926 pier. */
export const SKYLINE_ANCHOR: Vec3 = [141, 0, 5930];

class Geo {
  private readonly b = new Map<string, Builder>();
  constructor(readonly mesh: TileMesh) {}
  of(m: string): Builder {
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

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Prop-space (x, z) of a latitude / longitude. */
function ll(lat: number, lon: number): [number, number] {
  const p = latLonToLocal(lat, lon);
  return [p.x - SKYLINE_ANCHOR[0], p.z - SKYLINE_ANCHOR[2]];
}

/** An oriented box (footprint centre, half sizes along its axis a (angle) and across), from y0 to y1. */
function block(g: Geo, m: string, cx: number, cz: number, ang: number, hu: number, hv: number, y0: number, y1: number, windows = 0, lit = 0, wy0 = y0): void {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const P = (u: number, v: number, y: number): Vec3 => [cx + u * ca - v * sa, y, cz + u * sa + v * ca];
  const b = g.of(m);
  b.flatQuad([P(-hu, -hv, y1), P(hu, -hv, y1), P(hu, hv, y1), P(-hu, hv, y1)], [0, 1, 0]);
  const faces: [number, number, number, number, Vec3][] = [
    [-hu, -hv, hu, -hv, [sa, 0, -ca]],
    [hu, -hv, hu, hv, [ca, 0, sa]],
    [hu, hv, -hu, hv, [-sa, 0, ca]],
    [-hu, hv, -hu, -hv, [-ca, 0, -sa]],
  ];
  for (const [u0, v0, u1, v1, n] of faces) {
    b.flatQuad([P(u0, v0, y0), P(u1, v1, y0), P(u1, v1, y1), P(u0, v0, y1)], n);
    // Window bands (one per storey, at most six) on the faces turned towards the pier square, lit ones at night.
    if (n[0] * -cx + n[2] * -cz < 0.2 * Math.hypot(cx, cz)) {
      continue;
    }
    for (let k = 0; k < Math.min(windows, 6); k++) {
      const y = wy0 + 1.0 + k * 3.0;
      if (y + 1.3 > y1 - 0.8) {
        break;
      }
      const m2 = ((k * 7 + Math.round(cx + cz)) % 10) / 10 < lit ? 'hero_far_window_lit' : 'hero_far_window';
      const w = g.of(m2);
      const o = 0.15;
      const ex = n[0] * o;
      const ez = n[2] * o;
      const A = P(u0, v0, y);
      const B = P(u1, v1, y);
      const sx = (B[0] - A[0]) * 0.08;
      const sz = (B[2] - A[2]) * 0.08;
      w.flatQuad([[A[0] + sx + ex, y, A[2] + sz + ez], [B[0] - sx + ex, y, B[2] - sz + ez], [B[0] - sx + ex, y + 1.3, B[2] - sz + ez], [A[0] + sx + ex, y + 1.3, A[2] + sz + ez]], n);
    }
  }
}

/** Turned solid about (cx, cz): profile [radius, y] from the bottom up, `sides` segments. */
function turned(g: Geo, m: string, cx: number, cz: number, prof: [number, number][], sides = 12): void {
  const b = g.of(m);
  for (let j = 0; j + 1 < prof.length; j++) {
    const [r0, y0] = prof[j];
    const [r1, y1] = prof[j + 1];
    const dr = r1 - r0;
    const dy = y1 - y0;
    const l = Math.hypot(dr, dy) || 1;
    for (let k = 0; k < sides; k++) {
      const a0 = (k / sides) * Math.PI * 2;
      const a1 = ((k + 1) / sides) * Math.PI * 2;
      const n0: Vec3 = [Math.cos(a0) * (dy / l), -dr / l, Math.sin(a0) * (dy / l)];
      const n1: Vec3 = [Math.cos(a1) * (dy / l), -dr / l, Math.sin(a1) * (dy / l)];
      const i0 = b.v([cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0], n0);
      const i1 = b.v([cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0], n1);
      const i2 = b.v([cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1], n1);
      const i3 = b.v([cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1], n0);
      if (r1 < 1e-4) {
        b.tri(i0, i1, i2);
      } else {
        b.quad(i0, i1, i2, i3);
      }
    }
  }
}

/** Dome profile [radius, y] from the springing (radius r at y) to the crown (radius 0). */
const dome = (r: number, y: number, steps = 5): [number, number][] =>
  Array.from({ length: steps + 1 }, (_, k): [number, number] => {
    const a = (k / steps) * (Math.PI / 2);
    return [k === steps ? 0 : r * Math.cos(a), y + r * 0.95 * Math.sin(a)];
  });

function minaret(g: Geo, cx: number, cz: number, base: number, h: number, stone = 'hero_far_stone'): void {
  turned(g, stone, cx, cz, [
    [2.2, base],
    [1.9, base + h * 0.55],
    [2.6, base + h * 0.56],
    [2.6, base + h * 0.58],
    [1.7, base + h * 0.6],
    [1.6, base + h * 0.82],
  ], 8);
  turned(g, 'hero_far_lead', cx, cz, [
    [1.8, base + h * 0.82],
    [0, base + h],
  ], 8);
}

/** An imperial mosque: base block, drum and main dome, half domes, minarets at the corners of the court. */
function mosque(g: Geo, cx: number, cz: number, ground: number, s: { half: number; domeR: number; domeY: number; minarets: [number, number][]; minH: number; halfDomes?: boolean; stone?: string }): void {
  const stone = s.stone ?? 'hero_far_stone';
  block(g, stone, cx, cz, 0, s.half, s.half, 0, ground + s.domeY - s.domeR * 0.5);
  turned(g, stone, cx, cz, [
    [s.domeR * 1.05, ground + s.domeY - s.domeR * 0.5],
    [s.domeR * 1.05, ground + s.domeY],
  ], 16);
  turned(g, 'hero_far_lead', cx, cz, dome(s.domeR, ground + s.domeY, 6), 16);
  if (s.halfDomes) {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      turned(g, 'hero_far_lead', cx + dx * s.domeR * 1.1, cz + dz * s.domeR * 1.1, dome(s.domeR * 0.6, ground + s.domeY - s.domeR * 0.55, 4), 12);
    }
  }
  for (const [mx, mz] of s.minarets) {
    minaret(g, cx + mx, cz + mz, 0, ground + s.minH, stone);
  }
}

/** Fills a shore band: blocks inland from the polyline `coast` (prop space) on its left (inland) side. */
function band(g: Geo, r: () => number, coast: [number, number][], depth: number, hMin: number, hMax: number, hill: (d: number) => number, lit: number): void {
  const mats = ['hero_far_wall', 'hero_far_wall2', 'hero_far_wall3', 'hero_far_wall'];
  for (let k = 0; k + 1 < coast.length; k++) {
    const [ax, az] = coast[k];
    const [bx, bz] = coast[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / len;
    const tz = (bz - az) / len;
    // Inland = left of the direction of travel.
    const nx = tz;
    const nz = -tx;
    const ang = Math.atan2(tz, tx);
    for (let d = 25; d < depth; d += 38 + 12 * r()) {
      for (let s = 0; s < len; s += 34 + 16 * r()) {
        if (r() < 0.1) {
          continue;
        }
        const cx = ax + tx * s + nx * d + (r() - 0.5) * 8;
        const cz = az + tz * s + nz * d + (r() - 0.5) * 8;
        if (Math.hypot(cx, cz) > 5600) {
          continue;
        }
        const h = hMin + (hMax - hMin) * r() * r();
        const ground = hill(d);
        block(g, mats[Math.floor(r() * mats.length)], cx, cz, ang + (r() - 0.5) * 0.2, 11 + 7 * r(), 10 + 6 * r(), 0, ground + h, Math.floor(h / 3), lit, ground);
        if (r() < 0.35) {
          // Pitched or tiled roofs on some.
          block(g, 'hero_far_roof', cx, cz, ang, 5.5, 5.5, ground + h, ground + h + 1.2);
        }
      }
    }
  }
}

/** Builds the far field into a prop mesh (prop space = world - SKYLINE_ANCHOR). */
export function buildSkyline(mesh: TileMesh): void {
  const g = new Geo(mesh);
  const r = rng(1453);
  const hillHist = (d: number): number => Math.min(45, d * 0.12);
  // Historic peninsula: the Marmara shore from Sarayburnu west, and the Golden Horn shore to Unkapanı.
  band(g, r, [ll(41.0167, 28.9853), ll(41.0105, 28.9838), ll(41.0034, 28.9811), ll(41.0009, 28.969), ll(41.004, 28.951)].reverse(), 700, 10, 22, hillHist, 0.35);
  band(g, r, [ll(41.0167, 28.9853), ll(41.0172, 28.9725), ll(41.0224, 28.9612)], 500, 10, 22, hillHist, 0.35);
  // Galata and Beyoğlu, up the hill from Karaköy / Tophane / Kabataş.
  band(g, r, [ll(41.0222, 28.9772), ll(41.0255, 28.968), ll(41.029, 28.958)].reverse(), 600, 14, 26, (d) => Math.min(60, d * 0.1), 0.4);
  band(g, r, [ll(41.0405, 29.0005), ll(41.034, 28.992), ll(41.0272, 28.9831), ll(41.0222, 28.9772)].reverse(), 700, 14, 30, (d) => Math.min(70, d * 0.1), 0.4);
  // Asian shore north: Üsküdar, Salacak, Harem (the coast faces west).
  band(g, r, [ll(41.0275, 29.0137), ll(41.0212, 29.0098), ll(41.0136, 29.0098), ll(41.0085, 29.0125)], 700, 10, 24, (d) => Math.min(55, d * 0.08), 0.35);
  // Moda to the south of the compiled area.
  band(g, r, [ll(40.9795, 29.0235), ll(40.9836, 29.0255), ll(40.9862, 29.0268)].reverse(), 500, 12, 24, (d) => Math.min(18, d * 0.05), 0.4);
  // Landmarks.
  const [hsx, hsz] = ll(41.0086, 28.9802);
  mosque(g, hsx, hsz, 32, { half: 38, domeR: 16, domeY: 40, minarets: [[-40, -40], [40, -40], [40, 40], [-40, 40]], minH: 60, halfDomes: true, stone: 'hero_far_pink' });
  const [bmx, bmz] = ll(41.0054, 28.9768);
  mosque(g, bmx, bmz, 30, { half: 32, domeR: 12, domeY: 31, minarets: [[-36, -36], [36, -36], [36, 36], [-36, 36], [-36, -90], [36, -90]], minH: 64, halfDomes: true });
  const [smx, smz] = ll(41.0162, 28.9639);
  mosque(g, smx, smz, 48, { half: 34, domeR: 13.5, domeY: 38, minarets: [[-40, -60], [40, -60], [-36, 36], [36, 36]], minH: 72, halfDomes: true });
  const [ycx, ycz] = ll(41.0171, 28.9713);
  mosque(g, ycx, ycz, 3, { half: 20, domeR: 9, domeY: 26, minarets: [[-22, -22], [22, -22]], minH: 60, halfDomes: true });
  const [tpx, tpz] = ll(41.0115, 28.9834);
  block(g, 'hero_far_stone', tpx, tpz, 0.3, 60, 30, 0, 40);
  block(g, 'hero_far_stone', tpx + 20, tpz, 0, 4, 4, 0, 62);
  turned(g, 'hero_far_lead', tpx + 20, tpz, [
    [4.5, 62],
    [0, 70],
  ], 8);
  const [gtx, gtz] = ll(41.0256, 28.9741);
  turned(g, 'hero_far_stone', gtx, gtz, [
    [9, 0],
    [8.9, 35 + 51],
    [10, 35 + 52],
    [9, 35 + 53],
  ], 16);
  turned(g, 'hero_far_lead', gtx, gtz, [
    [9, 35 + 53],
    [0, 35 + 67],
  ], 16);
  const [kkx, kkz] = ll(41.0211, 29.0041);
  block(g, 'hero_far_stone', kkx, kkz, 0, 18, 10, 0, 3);
  block(g, 'hero_far_wall', kkx, kkz, 0, 7, 6, 3, 12);
  turned(g, 'hero_far_wall', kkx + 4, kkz, [
    [2.6, 3],
    [2.6, 21],
  ], 8);
  turned(g, 'hero_far_lead', kkx + 4, kkz, [
    [2.9, 21],
    [0, 27],
  ], 8);
  // Selimiye barracks: a square court with corner towers.
  const [sbx, sbz] = ll(41.0065, 29.0165);
  const sh = 110;
  for (const [dx, dz, hu, hv] of [
    [0, -sh, sh, 12],
    [0, sh, sh, 12],
    [-sh, 0, 12, sh],
    [sh, 0, 12, sh],
  ]) {
    block(g, 'hero_far_stone', sbx + dx, sbz + dz, 0, hu, hv, 0, 42, 5, 0.3);
  }
  for (const [dx, dz] of [
    [-sh, -sh],
    [sh, -sh],
    [sh, sh],
    [-sh, sh],
  ]) {
    block(g, 'hero_far_stone', sbx + dx, sbz + dz, 0, 14, 14, 0, 52);
    turned(g, 'hero_far_lead', sbx + dx, sbz + dz, [
      [13, 52],
      [0, 62],
    ], 4);
  }
  // Haydarpaşa station: a long block with a steep slate roof and two round corner towers on the sea front.
  const [hpx, hpz] = ll(40.9966, 29.0193);
  const ang = (-25 * Math.PI) / 180;
  block(g, 'hero_far_stone', hpx, hpz, ang, 48, 17, 0, 24, 6, 0.4);
  block(g, 'hero_far_slate', hpx, hpz, ang, 46, 15, 24, 30);
  for (const side of [-1, 1]) {
    const tx = hpx + Math.cos(ang) * -44 - Math.sin(ang) * side * 13;
    const tz = hpz + Math.sin(ang) * -44 + Math.cos(ang) * side * 13;
    turned(g, 'hero_far_stone', tx, tz, [
      [6, 0],
      [6, 32],
    ], 12);
    turned(g, 'hero_far_slate', tx, tz, [
      [6.5, 32],
      [0, 44],
    ], 12);
  }
  // Its breakwater and the port quay towards Kadıköy (low, grey).
  block(g, 'hero_far_quay', hpx - 60, hpz + 10, ang + 0.2, 180, 6, 0, 3);
  g.flush();
}

export const SKYLINE_PROP: PropDef = { id: 'hero_skyline', drawDistance: 12000, castShadow: false, build: (b) => b.variant('istanbul', (m) => buildSkyline(m)) };
