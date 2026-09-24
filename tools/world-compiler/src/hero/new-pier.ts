/**
 * The new Kadıköy pier (Eminönü–Karaköy iskelesi, OSM way 560203763): built 1982, re-clad 2005–08 with light precast
 * panels and arched openings. Simpler than the 1926 pier: correct massing and openings.
 *
 * Measured on c03-day (cameras.json pose, OSM footprint 82.3 × 18.0 m, long axis 123°/303°): from the sea end, a
 * one-storey part with a roof terrace (20 m, 4.2 m), the two-storey pavilion (27 m) with arched ground-floor openings,
 * a glazed upper floor and a hipped standing-seam roof (eaves 8.0 m, ridge about 11.4 m), then the land block (35 m,
 * parapet 8.6 m) in five pilastered bays of paired pointed-arch windows over rectangular ones. Cream panels, white
 * frames, a light-grey standing-seam roof; pointed arches on the ground floor; on the berth side a dark concrete quay
 * face down to the water with a row of tyre fenders (c03).
 */
import type { LightInput } from '../lights';
import { LOD0, LOD1, type TileMesh, type Vec3 } from '../mesh';
import type { PropDef } from '../props';
import type { TileContext } from '../registry';
import { Batch, box, Builder, dressOpening, Face, faceBox, faceBoxC, Frame, hippedRoof, hpoly, lathe, type Opening, outline, shape, span, type V2, wall, type WindowStyle } from './kit';
import { type HeroBuild, longestEdgeHeading } from './pier1926';
import { HeroWeather, rng, sillStreaks, streakAt, type WxProfile } from './weather';

/**
 * Weathering of the 2005–08 cladding (c03): light grime with patchy variation, splash and damp over the deck, streaks
 * under the sills and in bands under the copings, a stained brown-grey quay face with rust and algae run-off, dusty
 * standing seams.
 */
const NEW_PIER_WX: Record<string, WxProfile> = {
  hero_panel_cream: { dirt: 0.12, vary: 0.12, splash: 0.4, splashH: 1.0, damp: 0.55, dampH: 0.55, side: 0.2, up: 0.35, down: 0.3, edge: 0.3, streak: 0.4, bandH: 1.2, tint: 0.06 },
  hero_panel_trim: { dirt: 0.12, vary: 0.1, up: 0.45, down: 0.35, side: 0.1, edge: 0.45, streak: 0.3, bandH: 0.9, tint: 0.05 },
  hero_quay: { dirt: 0.45, vary: 0.3, up: 0.2, side: 0.1, edge: 0.4, damp: 0.9, dampH: 0.9, tint: 0.1 },
  hero_frame_white: { dirt: 0.15, vary: 0.1, up: 0.25, edge: 0.45 },
  hero_metal_roof: { dirt: 0.25, vary: 0.3, grid: 3.0, tint: 0.07 },
  hero_iron: { dirt: 0.35, vary: 0.3, up: 0.15, edge: 0.6 },
  hero_floor: { dirt: 0.25, vary: 0.25, grid: 3.0 },
};
const STREAK_CREAM: [number, number, number, number] = [0.38, 0.33, 0.29, 0.5];

/**
 * A car-tyre fender hung on two chains (c03: a continuous row along the berth), for the quay faces of the piers:
 * variants `a` (hanging straight), `b` / `c` (twisted on their chains, one a size smaller). Prop frame: the tyre's
 * back against the quay face at z 0, its axis along +Z, the chain eyes at y 0 (the deck edge).
 */
function tyre(mesh: TileMesh, tilt: number, scale: number): void {
  const b = new Builder();
  const R = 0.34 * scale;
  const r = 0.11 * scale;
  const cy = -0.62 * scale;
  const nU = 12;
  const nV = 6;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const at = (u: number, v: number): { p: Vec3; n: Vec3 } => {
    const a = (u / nU) * Math.PI * 2;
    const c = (v / nV) * Math.PI * 2;
    // Torus about +Z, flattened tread (squarer section).
    const sx = Math.cos(c);
    const sz = Math.sin(c) * 0.8;
    const x0 = Math.cos(a) * (R + r * sx);
    const y0 = Math.sin(a) * (R + r * sx);
    const z0 = r * sz + r;
    const nx0 = Math.cos(a) * sx;
    const ny0 = Math.sin(a) * sx;
    const nz0 = Math.sin(c);
    // Twist about the vertical axis by `tilt`.
    return { p: [x0 * ct + z0 * st, y0 + cy, -x0 * st + z0 * ct], n: [nx0 * ct + nz0 * st, ny0, -nx0 * st + nz0 * ct] };
  };
  for (let u = 0; u < nU; u++) {
    for (let v = 0; v < nV; v++) {
      const q = [at(u, v), at(u + 1, v), at(u + 1, v + 1), at(u, v + 1)];
      b.quad(b.v(q[0].p, q[0].n), b.v(q[1].p, q[1].n), b.v(q[2].p, q[2].n), b.v(q[3].p, q[3].n));
    }
  }
  b.flush(mesh, 'hero_tyre');
  const ch = new Builder();
  for (const dx of [-0.2, 0.2]) {
    const x = dx * scale;
    const top: Vec3 = [x * 0.6, 0, 0.05];
    const bot: Vec3 = [x * ct, cy + R * 0.8, r - x * st];
    const w = 0.012;
    ch.flatQuad([[top[0] - w, top[1], top[2]], [top[0] + w, top[1], top[2]], [bot[0] + w, bot[1], bot[2]], [bot[0] - w, bot[1], bot[2]]], [0, 0, 1]);
    ch.flatQuad([[top[0] - w, top[1], top[2] - 0.001], [top[0] + w, top[1], top[2] - 0.001], [bot[0] + w, bot[1], bot[2] - 0.001], [bot[0] - w, bot[1], bot[2] - 0.001]], [0, 0, -1]);
  }
  ch.flush(mesh, 'hero_iron');
}

export const TYRE_PROP: PropDef = {
  id: 'hero_tyre_fender',
  drawDistance: 250,
  castShadow: true,
  build: (b) => {
    b.variant('a', (m) => tyre(m, 0, 1));
    b.variant('b', (m) => tyre(m, 0.28, 1));
    b.variant('c', (m) => tyre(m, -0.2, 0.9));
  },
};

const HALF_L = 41.15;
const HALF_W = 9.0;
const SEA = { u0: -HALF_L, u1: -20.85, h: 4.2 };
const PAV = { u0: -20.85, u1: 6.15, eave: 8.0 };
const LAND = { u0: 6.15, u1: HALF_L, h: 8.6 };
const WALL = 'hero_panel_cream';
const TRIM = 'hero_panel_trim';

const win = (lit: boolean): WindowStyle => ({ wall: WALL, frame: 'hero_frame_white', pane: lit ? 'hero_glass_lit' : 'hero_glass', reveal: 0.22, frameW: 0.06, mullions: 1, transom: true, sill: { mat: TRIM, depth: 0.06, h: 0.07 } });
const doorSt: WindowStyle = { wall: WALL, frame: 'hero_frame_white', pane: 'hero_glass_lit', reveal: 0.25, frameW: 0.07, mullions: 1, transom: true, surround: { mat: TRIM, w: 0.14, d: 0.04 } };

interface Op extends Opening {
  lit?: boolean;
}

export function buildNewPier(t: TileContext, ring: readonly number[], bottomY: number): HeroBuild {
  const n = ring.length / 2;
  let ox = 0;
  let oz = 0;
  for (let k = 0; k < n; k++) {
    ox += ring[k * 2];
    oz += ring[k * 2 + 1];
  }
  ox /= n;
  oz /= n;
  // Long axis pointing to the land end (the ring's ESE end, heading about 123°).
  const heading = longestEdgeHeading(ring);
  const probe = new Frame(ox, oz, 0, heading);
  const g = (u: number, v: number): number => {
    const p = probe.p(u, 0, v);
    return t.area.heights.at(p[0], p[2]);
  };
  const floorY = Math.round(Math.max(g(HALF_L + 1, 0), g(0, HALF_W + 1), g(-30, HALF_W + 1), g(25, HALF_W + 1)) * 100) / 100;
  const f = new Frame(ox, oz, floorY, heading);
  const yb = bottomY - floorY;
  const wx = new HeroWeather({
    seed: 2005,
    // The deck is the ground of the walls; the quay face stands in the water (sea level 0).
    ground: (x, z) => Math.max(0, Math.min(floorY, t.area.heights.at(x, z))),
    profiles: NEW_PIER_WX,
    shelters: [SEA.h - 0.25, 3.95, LAND.h - 0.8, 4.0, PAV.eave].map((y) => floorY + y),
  });
  const mesh = wx.wrap(t.mesh);
  const lights: LightInput[] = [];
  let instances = 0;

  mesh.withLod(LOD0, () => {
    const batch = new Batch(mesh);
    for (const sideV of [HALF_W, -HALF_W]) {
      instances += longSide(t, mesh, batch, f, sideV, yb, lights);
    }
    ends(mesh, batch, f, yb);
    batch.flush();
  });
  mesh.withLod(LOD1, () => {
    const batch = new Batch(mesh);
    const b = batch.of(WALL);
    box(b, f, SEA.u0, SEA.u1, yb, SEA.h, -HALF_W, HALF_W);
    box(b, f, PAV.u0, PAV.u1, yb, PAV.eave, -HALF_W, HALF_W);
    box(b, f, LAND.u0, LAND.u1, yb, LAND.h, -HALF_W, HALF_W);
    for (const v of [HALF_W, -HALF_W]) {
      const side = v > 0 ? span(f, [-HALF_L, v], [HALF_L, v]) : span(f, [HALF_L, v], [-HALF_L, v]);
      for (const o of openings(side.len, v > 0)) {
        shape(mesh, o.lit === false ? 'hero_glass' : 'hero_glass_lit', side.face, outline(o, 6), [], 0.02);
      }
    }
    batch.flush();
  });
  // Roofs (every LOD): pavilion hipped metal roof, sea-part terrace, land-block flat roof behind its parapet.
  const batch = new Batch(mesh);
  const ov = 1.6;
  const rise = (HALF_W + ov) * Math.tan((17 * Math.PI) / 180);
  hippedRoof(mesh, 'hero_metal_roof', TRIM, f, PAV.u0 - ov, PAV.u1 + ov, -HALF_W - ov, HALF_W + ov, PAV.eave + 0.15, rise, ov, 0.2, batch);
  hpoly(mesh, 'hero_floor', f, [
    [SEA.u0, -HALF_W],
    [SEA.u1, -HALF_W],
    [SEA.u1, HALF_W],
    [SEA.u0, HALF_W],
  ], SEA.h);
  hpoly(mesh, 'hero_metal_roof', f, [
    [LAND.u0, -HALF_W],
    [LAND.u1, -HALF_W],
    [LAND.u1, HALF_W],
    [LAND.u0, HALF_W],
  ], LAND.h - 0.45);
  batch.flush();

  for (const u of [-14, -4, 4]) {
    lights.push({ type: 'point', position: f.p(u, 6.0, 0), kelvin: 3000, lumens: 1500, night: true, source: 'window' });
  }
  for (const l of lights) {
    t.lights.add({ ...l, ref: 'hero/newPier' });
  }
  const ridge = PAV.eave + 0.15 + rise;
  return {
    topY: Math.round((floorY + ridge) * 100) / 100,
    floorY,
    lights: lights.length,
    instances,
    notes: { origin: [Math.round(ox * 100) / 100, Math.round(oz * 100) / 100], headingDeg: Math.round(heading * 100) / 100, eaveY: Math.round((floorY + PAV.eave) * 100) / 100, ridgeY: Math.round((floorY + ridge) * 100) / 100, landParapetY: Math.round((floorY + LAND.h) * 100) / 100, tyreFenders: instances, quayEdgeM: quayEdge, weatherCutTriangles: wx.added },
  };
}

/** Openings of a long side in face coordinates (s from the face's left end). */
function openings(len: number, sSW: boolean): Op[] {
  // s runs from the sea end on the SW side (+v face) and from the land end on the NE side.
  const sOf = (u: number): number => (sSW ? u + HALF_L : HALF_L - u);
  const ops: Op[] = [];
  for (const u of [-37, -31.5, -26]) {
    ops.push({ s: sOf(u), w: 1.5, y0: 0.9, ys: 2.3, kind: 'pointed', rise: 1.05 });
  }
  for (const u of [-17.5, -10.8, -4.1, 2.6]) {
    ops.push({ s: sOf(u), w: 1.7, y0: 0.6, ys: 2.2, kind: 'pointed', rise: 1.2 });
  }
  for (let k = 0; k < 10; k++) {
    ops.push({ s: sOf(PAV.u0 + 1.35 + k * 2.63 + 1.0), w: 1.95, y0: 4.85, ys: 7.25, kind: 'flat' });
  }
  for (let b = 0; b < 5; b++) {
    const uc = LAND.u0 + 3.5 + b * 7;
    for (const du of [-1.0, 1.0]) {
      ops.push({ s: sOf(uc + du), w: 1.25, y0: 4.45, ys: 6.35, kind: 'pointed', rise: 0.85 });
      if (!(b % 2 === 1 && du > 0)) {
        ops.push({ s: sOf(uc + du), w: 1.25, y0: 1.3, ys: 2.8, kind: 'flat', lit: b !== 3 });
      }
    }
    if (b % 2 === 1) {
      ops.push({ s: sOf(uc + 1.0), w: 1.4, y0: 0, ys: 2.7, kind: 'flat', door: true });
    }
  }
  return ops.filter((o) => o.s > 0.5 && o.s < len - 0.5);
}

let quayEdge: [number, number] = [0, 0];

function longSide(t: TileContext, mesh: TileMesh, batch: Batch, f: Frame, v: number, yb: number, lights: LightInput[]): number {
  const side = v > 0 ? span(f, [-HALF_L, v], [HALF_L, v]) : span(f, [HALF_L, v], [-HALF_L, v]);
  const sSW = v > 0;
  const sOf = (u: number): number => (sSW ? u + HALF_L : HALF_L - u);
  const ops = openings(side.len, sSW);
  const inRange = (o: Op, a: number, b: number): boolean => o.s >= Math.min(a, b) && o.s <= Math.max(a, b);
  // Three wall panels of different heights (sea part, pavilion, land block).
  const parts: [number, number, number][] = [
    [SEA.u0, SEA.u1, SEA.h],
    [PAV.u0, PAV.u1, PAV.eave],
    [LAND.u0, LAND.u1, LAND.h],
  ];
  for (const [u0, u1, h] of parts) {
    const s0 = Math.min(sOf(u0), sOf(u1));
    const s1 = Math.max(sOf(u0), sOf(u1));
    const own = ops.filter((o) => inRange(o, s0, s1)).map((o) => ({ ...o, s: o.s - s0 }));
    const sub = subFace(side.face, s0);
    wall(mesh, WALL, sub, 0, s1 - s0, yb, h, own);
    for (const o of own) {
      dressOpening(mesh, batch, sub, o, o.door ? doorSt : win(o.lit !== false));
    }
    sillStreaks(mesh, sub, own, 0.07, { color: STREAK_CREAM, len: [0.4, 1.3], p: 0.7 }, Math.round(s0 * 31 + v * 7));
  }
  const trim = batch.of(TRIM);
  // Land block: pilasters, cornice, parapet coping. Pavilion: band between the floors, name board.
  for (let b = 0; b <= 5; b++) {
    const s = sOf(LAND.u0 + b * 7);
    faceBoxC(trim, side.face, s - 0.28, s + 0.28, yb, LAND.h - 0.5, -0.02, 0.12, 0.02, false);
  }
  const l0 = Math.min(sOf(LAND.u0), sOf(LAND.u1));
  const l1 = Math.max(sOf(LAND.u0), sOf(LAND.u1));
  faceBoxC(trim, side.face, l0, l1, LAND.h - 0.8, LAND.h - 0.5, -0.02, 0.18, 0.02);
  faceBoxC(trim, side.face, l0, l1, LAND.h - 0.06, LAND.h + 0.04, -0.3, 0.06, 0.015);
  faceBoxC(trim, side.face, l0, l1, 4.0, 4.2, -0.02, 0.1, 0.015);
  const p0 = Math.min(sOf(PAV.u0), sOf(PAV.u1));
  const p1 = Math.max(sOf(PAV.u0), sOf(PAV.u1));
  faceBoxC(trim, side.face, p0, p1, 3.95, 4.3, -0.02, 0.14, 0.02);
  if (sSW) {
    const c = (p0 + p1) / 2;
    faceBox(batch.of('hero_iron'), side.face, c - 3.2, c + 3.2, 3.98, 4.27, 0.14, 0.17, false, true);
  }
  const s0 = Math.min(sOf(SEA.u0), sOf(SEA.u1));
  const s1 = Math.max(sOf(SEA.u0), sOf(SEA.u1));
  faceBox(trim, side.face, s0, s1, SEA.h - 0.25, SEA.h + 0.05, -0.02, 0.14);
  railing(batch, side.face, s0 + 0.2, s1 - 0.2, SEA.h + 0.05);
  // Berth side over water (c03): a stained concrete quay face down to the water and a row of tyre fenders on chains.
  let fenders = 0;
  if (sSW) {
    const q = quayFace(t, mesh, batch, side.face, side.len);
    fenders = q.fenders;
    quayEdge = q.edge;
    // Life rings beside some doors and windows (c03).
    for (const u of [-33.5, -8.5, 30]) {
      lifeRing(batch, side.face, sOf(u), 1.75);
    }
  }
  // Wall lanterns over the ground-floor openings of the berth side, warm.
  for (const u of [-37, -26, -17.5, -4.1, 9.5, 23.5, 37.5]) {
    const p = side.face.p(sOf(u), 3.3, 0.35);
    lights.push({ type: 'point', position: p, kelvin: 2800, lumens: 650, night: true, source: 'lamp' });
  }
  return fenders;
}

/** An orange life ring on a wall bracket, centred at (s, y). */
function lifeRing(batch: Batch, face: Face, s: number, y: number): void {
  const b = batch.of('hero_lifering');
  const f = face.f;
  const p = face.p(s, y, 0.09);
  const [u, v] = f.local(p[0], p[2]);
  // A torus about the face normal: rings of a lathe would stand vertical, so emit quads directly.
  const R = 0.28;
  const r = 0.055;
  const n = 14;
  const m = 6;
  const at = (i: number, j: number): { p: Vec3; nn: Vec3 } => {
    const a = (i / n) * Math.PI * 2;
    const c = (j / m) * Math.PI * 2;
    const ds = Math.cos(a) * (R + r * Math.cos(c));
    const dy = Math.sin(a) * (R + r * Math.cos(c));
    const dd = r * Math.sin(c);
    const w = face.dir(ds, dy, dd);
    const nn = face.dir(Math.cos(a) * Math.cos(c), Math.sin(a) * Math.cos(c), Math.sin(c));
    return { p: [f.p(u, y, v)[0] + w[0], f.p(u, y, v)[1] + w[1], f.p(u, y, v)[2] + w[2]], nn };
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      b.quad(b.v(q[0].p, q[0].nn), b.v(q[1].p, q[1].nn), b.v(q[2].p, q[2].nn), b.v(q[3].p, q[3].nn));
    }
  }
  faceBox(batch.of('hero_iron'), face, s - 0.03, s + 0.03, y + R - 0.02, y + R + 0.1, 0, 0.12);
}

/**
 * The berth's quay edge (c03): the pier deck runs a few metres out beyond the wall, so the edge is found by walking
 * out from the wall along its normal to where the deck ends (area.land). On the street lane's quay wall there: rust
 * and algae run-off decals, yellow mooring bollards on the deck every ~9 m and a continuous row of tyre fenders on
 * chains (prop instances) touching each other. Returns the number of fenders and the edge distance range.
 */
function quayFace(t: TileContext, mesh: TileMesh, batch: Batch, face: Face, len: number): { fenders: number; edge: [number, number] } {
  const edgeAt = (s: number): number | null => {
    for (let d = 0.3; d < 14; d += 0.1) {
      const p = face.p(s, 0, d);
      if (t.area.land(p[0], p[2]) <= 0) {
        // Refine to 2 cm.
        let lo = d - 0.1;
        let hi = d;
        for (let i = 0; i < 3; i++) {
          const m = (lo + hi) / 2;
          const q = face.p(s, 0, m);
          if (t.area.land(q[0], q[2]) > 0) {
            lo = m;
          } else {
            hi = m;
          }
        }
        return lo;
      }
    }
    return null;
  };
  const r = rng(560);
  let n = 0;
  let eMin = Infinity;
  let eMax = -Infinity;
  const yb = batch.of('hero_bollard');
  let nextBollard = 3.2;
  for (let s = 0.55; s < len - 0.45; s += 0.86 + r() * 0.14) {
    const d = edgeAt(s);
    if (d === null) {
      continue;
    }
    eMin = Math.min(eMin, d);
    eMax = Math.max(eMax, d);
    const top = face.p(s, 0, d);
    const deckY = t.area.heights.at(top[0] - face.n[0] * 0.3, top[2] - face.n[2] * 0.3);
    if (s >= nextBollard) {
      const p = face.p(s, 0, d - 0.45);
      const [u, v] = face.f.local(p[0], p[2]);
      const y = deckY - face.f.y0;
      lathe(yb, face.f, u, v, [
        [0.16, y - 0.02],
        [0.13, y + 0.08],
        [0.11, y + 0.32],
        [0.17, y + 0.38],
        [0.17, y + 0.44],
        [0.001, y + 0.45],
      ], 10);
      nextBollard = s + 8.8 + r() * 1.2;
    }
    // Run-off on the quay wall under the coping (every other fender gap).
    if (r() < 0.55) {
      const q = face.p(s + 0.43, 0, d + 0.005);
      const col: [number, number, number, number] = r() < 0.5 ? [0.36, 0.22, 0.12, 0.6] : [0.2, 0.26, 0.14, 0.55];
      const u0 = r() * 0.5;
      mesh.decal('hero_leak', [q[0], deckY - 0.45, q[2]], face.n, { size: [0.3 + r() * 0.4, 0.6], offset: 0.01, rect: [u0, 0, u0 + 0.5, 0.92], color: col });
    }
    if (r() < 0.05) {
      continue;
    }
    const k = r();
    const p = face.p(s, 0, d + 0.03);
    t.place('hero_tyre_fender', [p[0], deckY - 0.12 - r() * 0.08, p[2]], face.f.yaw(face.nu, face.nv), { variant: k < 0.5 ? 'a' : k < 0.8 ? 'b' : 'c', ref: `hero/newPier/fender${n}`, seed: n });
    n++;
  }
  return { fenders: n, edge: [Math.round(eMin * 100) / 100, Math.round(eMax * 100) / 100] };
}

/** The face moved along itself so that s = 0 lies at `s0` of the original. */
function subFace(face: Face, s0: number): Face {
  const p = face.p(s0, 0, 0);
  const [u, v] = face.f.local(p[0], p[2]);
  return new Face(face.f, u, v, face.nu, face.nv);
}

/** Glass balustrade with a steel top rail on the edge of a roof terrace. */
function railing(batch: Batch, face: Face, s0: number, s1: number, y: number): void {
  faceBox(batch.of('hero_glass'), face, s0, s1, y, y + 0.95, -0.2, -0.18, true, false);
  faceBox(batch.of('hero_iron'), face, s0, s1, y + 0.95, y + 1.0, -0.22, -0.16, false, true);
  for (let s = s0; s <= s1 + 1e-6; s += 1.5) {
    faceBox(batch.of('hero_iron'), face, s - 0.03, s + 0.03, y, y + 0.95, -0.22, -0.16, false, false);
  }
}

function ends(mesh: TileMesh, batch: Batch, f: Frame, yb: number): void {
  // Land end: three arched entrances and pointed upper windows.
  const land = span(f, [HALF_L, HALF_W], [HALF_L, -HALF_W]);
  const c = land.len / 2;
  const ops: Op[] = [
    { s: c - 4, w: 2.0, y0: 0, ys: 2.5, kind: 'pointed', rise: 1.35, door: true },
    { s: c, w: 2.0, y0: 0, ys: 2.5, kind: 'pointed', rise: 1.35, door: true },
    { s: c + 4, w: 2.0, y0: 0, ys: 2.5, kind: 'pointed', rise: 1.35, door: true },
    { s: c - 4, w: 1.3, y0: 4.45, ys: 6.35, kind: 'pointed', rise: 0.85 },
    { s: c, w: 1.3, y0: 4.45, ys: 6.35, kind: 'pointed', rise: 0.85 },
    { s: c + 4, w: 1.3, y0: 4.45, ys: 6.35, kind: 'pointed', rise: 0.85 },
  ];
  wall(mesh, WALL, land.face, 0, land.len, yb, LAND.h, ops);
  for (const o of ops) {
    dressOpening(mesh, batch, land.face, o, o.door ? doorSt : win(true));
  }
  faceBox(batch.of(TRIM), land.face, 0, land.len, LAND.h - 0.8, LAND.h - 0.5, -0.02, 0.18);
  faceBox(batch.of(TRIM), land.face, 0, land.len, LAND.h - 0.06, LAND.h + 0.04, -0.3, 0.06);
  // Sea end of the low part.
  const sea = span(f, [-HALF_L, -HALF_W], [-HALF_L, HALF_W]);
  const so: Op[] = [-5, 0, 5].map((d) => ({ s: sea.len / 2 + d, w: 1.5, y0: 0.9, ys: 2.3, kind: 'pointed' as const, rise: 1.05 }));
  wall(mesh, WALL, sea.face, 0, sea.len, yb, SEA.h, so);
  for (const o of so) {
    dressOpening(mesh, batch, sea.face, o, win(true));
  }
  railing(batch, sea.face, 0.2, sea.len - 0.2, SEA.h + 0.05);
  // Pavilion end walls above the lower neighbours, and the land block's inner parapet.
  const pavSea = span(f, [PAV.u0, -HALF_W], [PAV.u0, HALF_W]);
  wall(mesh, WALL, pavSea.face, 0, pavSea.len, SEA.h - 0.3, PAV.eave, [4, 9, 13.5].map((s) => ({ s, w: 1.95, y0: 4.85, ys: 7.25, kind: 'flat' as const })));
  const pavLand = span(f, [PAV.u1, HALF_W], [PAV.u1, -HALF_W]);
  wall(mesh, WALL, pavLand.face, 0, pavLand.len, LAND.h - 0.5, PAV.eave);
  for (const e of [span(f, [LAND.u0, HALF_W], [LAND.u1, HALF_W]), span(f, [LAND.u1, -HALF_W], [LAND.u0, -HALF_W]), span(f, [LAND.u1, HALF_W], [LAND.u1, -HALF_W])]) {
    wall(mesh, WALL, e.face.offset(-0.25), 0, e.len, LAND.h - 0.45, LAND.h, [], { back: true });
  }
}
