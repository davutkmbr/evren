/**
 * The 1926 Kadıköy pier (Tarihi Kadıköy İskelesi, OSM way 102190096), First National Architecture style, restored
 * 2022–23 as the İBB İskele Kütüphanesi and Vapur Kafe.
 *
 * Sources: .docs/research/kadikoy-hero-spots.json ('kadikoy-tarihi-iskele'), .docs/street/s1-strip.md (heroes) and
 * the reference photos c01-day / c01-night / c02-day / context/pier-1926-loggia-night, measured by projecting the OSM
 * footprint with the fitted cameras of tools/world-compiler/s1/cameras.json:
 * - plan from the OSM ring (36.7 × 16.7 m): main body 27.6 × 15.25 m, a 13.5 m land-side pavilion projecting 1.5 m,
 *   open arcaded loggias with roof terraces at both ends (east 5.1 m deep, west 3.9 m);
 * - heights above the entrance floor: ground floor 4.95 m, eaves 9.1 m, hipped Marseille-tile roof (22°) to 12.8 m,
 *   pavilion parapet 10.3 m with corner crests to 11.3 m, loggia arches springing at 3.1 m, terrace parapet 6.1 m;
 * - white render, stone plinth, round-arched windows with dark frames, pointed loggia arches with iron railings,
 *   Kütahya tile panels over the window groups, two chimneys and the small lead dome seen behind the ridge today.
 *
 * LOD0 has every opening with reveals, surrounds, frames, glazing bars and the tile cells; LOD1 is the massing with
 * the roof and flat window shapes.
 */
import type { LightInput } from '../lights';
import { LOD0, LOD1, type RGBA, type TileMesh, type Vec3 } from '../mesh';
import type { TileContext } from '../registry';
import { lanternLights } from '../street/lights';
import {
  Batch,
  box,
  Builder,
  domeProfile,
  downpipe,
  dressOpening,
  Face,
  faceBar,
  faceBox,
  faceBoxC,
  Frame,
  gutter,
  hippedRoof,
  ridgeCap,
  hpoly,
  lathe,
  type Opening,
  outline,
  rgba,
  shape,
  span,
  tilePanel,
  type V2,
  wall,
  type WindowStyle,
} from './kit';
import { HeroWeather, repairPatches, sillStreaks, type WxProfile } from './weather';

/**
 * Weathering of the restored (2022–23) pier: light grime with patchy variation, splash and damp above the stone
 * plinth, dirty ledges and soffits, rain-streak bands under the cornice, the terrace edge and the string course,
 * worn arrises, grey streaks under the sills, lichen and soot patches on an uneven tile roof, rusty railings.
 */
const PIER_WX: Record<string, WxProfile> = {
  hero_render: { dirt: 0.04, vary: 0.08, splash: 0.4, splashH: 1.1, damp: 0.55, dampH: 0.55, side: 0.2, up: 0.35, down: 0.3, edge: 0.3, streak: 0.22, bandH: 1.0, tint: 0.04 },
  hero_render_trim: { dirt: 0.05, vary: 0.08, splash: 0.3, splashH: 0.9, up: 0.4, down: 0.35, side: 0.06, edge: 0.45, streak: 0.18, bandH: 0.8, tint: 0.03 },
  hero_render_soffit: { dirt: 0.3, vary: 0.2, down: 0.2, side: 0.1, edge: 0.2, tint: 0.06 },
  hero_plinth: { dirt: 0.25, vary: 0.15, splash: 0.35, splashH: 0.6, damp: 0.7, dampH: 0.45, up: 0.3, side: 0.05, edge: 0.5, tint: 0.05 },
  hero_roof_tile: { dirt: 0.22, vary: 0.32, grid: 1.5, displace: 0.028, tint: 0.1 },
  hero_tile_panel: { dirt: 0.25, vary: 0.2, up: 0.2, streak: 0.25, bandH: 0.6, tint: 0.06 },
  hero_frame: { dirt: 0.15, vary: 0.1, up: 0.2, edge: 0.55 },
  hero_door: { dirt: 0.2, vary: 0.1, splash: 0.3, splashH: 0.8, edge: 0.5 },
  hero_iron: { dirt: 0.3, vary: 0.3, up: 0.15, edge: 0.6 },
  hero_lead: { dirt: 0.35, vary: 0.35, up: 0.15, streak: 0.2 },
  hero_floor: { dirt: 0.18, vary: 0.25, grid: 2.0, tint: 0.05 },
};
const STREAK_WHITE: [number, number, number, number] = [0.42, 0.38, 0.33, 0.4];

/* Plan (local u along the long axis, towards 64.4°; v towards the land side, 154.4°). */
const MAIN = { u0: -13.8, u1: 13.8, v0: -9.9, v1: 5.35 };
const PAV = { u0: -6.75, u1: 6.75, v1: 6.85 };
const LOGGIA = { v0: -6.5, v1: 2.9, eastU: 18.9, westU: -17.7 };
/* Heights above the entrance floor. */
const PLINTH = 0.35;
const STRING = [4.7, 4.95] as const;
const CORNICE = 8.75;
const EAVE = 9.1;
const OVERHANG = 1.1;
const PITCH = 22;
const PAV_TOP = 10.6;
const PAV_PARAPET = 11.2;
const TERRACE = 5.0;
const PARAPET = 6.05;

const TRIM = 'hero_render_trim';
const RENDER = 'hero_render';

const doorStyle: WindowStyle = { wall: RENDER, frame: 'hero_frame', pane: 'hero_door', fan: 'hero_glass_lit', reveal: 0.3, frameW: 0.08, transom: true, radials: 3, surround: { mat: TRIM, w: 0.16, d: 0.05 } };
const winStyle = (lit: boolean): WindowStyle => ({ wall: RENDER, frame: 'hero_frame', pane: lit ? 'hero_glass_lit' : 'hero_glass', reveal: 0.28, frameW: 0.07, mullions: 1, transom: true, radials: 2, sill: { mat: TRIM, depth: 0.08, h: 0.08 }, surround: { mat: TRIM, w: 0.13, d: 0.04 } });

type Kind = 'door' | 'win' | 'dark';
interface Op extends Opening {
  k: Kind;
}

const door = (s: number, w = 1.4, ys = 2.9): Op => ({ s, w, y0: 0, ys, kind: 'round', door: true, k: 'door' });
const gfWin = (s: number, w = 1.05, lit = true): Op => ({ s, w, y0: 1.05, ys: 2.75, kind: 'round', k: lit ? 'win' : 'dark' });
const ufWin = (s: number, w = 1.05, lit = true, ys = 7.45): Op => ({ s, w, y0: 5.85, ys, kind: 'round', k: lit ? 'win' : 'dark' });
const pointedDoor = (s: number, w = 1.3): Op => ({ s, w, y0: 0, ys: 2.35, kind: 'pointed', rise: w * 0.7, door: true, k: 'door' });
const pointedWin = (s: number, w = 1.0): Op => ({ s, w, y0: 1.0, ys: 2.45, kind: 'pointed', rise: w * 0.7, k: 'win' });

/** Kütahya tile pattern (COLOR_0): cobalt border, turquoise field with white rosettes and a few red accents. */
export function kutahya(i: number, j: number, ni: number, nj: number): RGBA {
  const cobalt = rgba(0x1d4f9e);
  const turq = rgba(0x2f9fa6);
  const white = rgba(0xf1efe7);
  const red = rgba(0xb4402f);
  if (i === 0 || j === 0 || i === ni - 1 || j === nj - 1) {
    return cobalt;
  }
  const a = (i - 1) % 4;
  const b = (j - 1) % 4;
  if ((a === 1 || a === 2) && (b === 1 || b === 2)) {
    return (a + b) % 2 === 0 ? white : red;
  }
  return (a + b) % 2 === 0 ? turq : cobalt;
}

export interface HeroBuild {
  /** World height of the highest roof point (the building record's new topY). */
  topY: number;
  floorY: number;
  lights: number;
  instances: number;
  notes: Record<string, unknown>;
}

/** Builds the pier into the tile; `ring` is the OSM outline (flat x, z). */
export function buildPier1926(t: TileContext, ring: readonly number[], bottomY: number): HeroBuild {
  const n = ring.length / 2;
  let ox = 0;
  let oz = 0;
  for (let k = 0; k < n; k++) {
    ox += ring[k * 2];
    oz += ring[k * 2 + 1];
  }
  ox /= n;
  oz /= n;
  const heading = longestEdgeHeading(ring);
  // Entrance floor: the highest ground in front of the land-side doors and the east loggia (no door is buried).
  const probe = new Frame(ox, oz, 0, heading);
  const fronts: V2[] = [
    [LOGGIA.eastU + 1.2, -1.8],
    [PAV.u0 + 4.6, PAV.v1 + 1.0],
    [PAV.u1 - 4.6, PAV.v1 + 1.0],
    [10.3, MAIN.v1 + 1.0],
    [-10.3, MAIN.v1 + 1.0],
  ];
  const at = (u: number, v: number): number => {
    const p = probe.p(u, 0, v);
    return t.area.heights.at(p[0], p[2]);
  };
  const floorY = Math.round(Math.max(...fronts.map(([u, v]) => at(u, v))) * 100) / 100;
  const f = new Frame(ox, oz, floorY, heading);
  const yb = bottomY - floorY;
  const lights: LightInput[] = [];
  let instances = 0;
  const wx = new HeroWeather({
    seed: 1926,
    ground: (x, z) => Math.min(floorY, t.area.heights.at(x, z)),
    profiles: PIER_WX,
    shelters: [CORNICE, STRING[0], 4.75, PAV_TOP - 0.25, PARAPET].map((y) => floorY + y),
  });
  const mesh = wx.wrap(t.mesh);

  mesh.withLod(LOD0, () => {
    const batch = new Batch(mesh);
    mainBody(mesh, batch, f, yb, at, lights);
    pavilion(mesh, batch, f, yb, lights);
    loggia(mesh, batch, f, yb, 1, lights);
    loggia(mesh, batch, f, yb, -1, lights);
    roofAndDome(mesh, batch, f, true);
    batch.flush();
  });
  mesh.withLod(LOD1, () => {
    const batch = new Batch(mesh);
    lod1(mesh, batch, f, yb);
    roofAndDome(mesh, batch, f, false);
    batch.flush();
  });

  // Night: interior glow behind the windows and in the loggias (warm), apron lamp posts east of the loggia.
  for (const u of [-8.5, 0, 8.5]) {
    lights.push({ type: 'point', position: f.p(u, 6.9, -2.2), kelvin: 2800, lumens: 1400, night: true, source: 'window' });
  }
  for (const u of [-7, 7]) {
    lights.push({ type: 'point', position: f.p(u, 3.0, -2.2), kelvin: 3000, lumens: 1200, night: true, source: 'window' });
  }
  for (const sgn of [1, -1]) {
    const uc = sgn > 0 ? (MAIN.u1 + LOGGIA.eastU) / 2 : (MAIN.u0 + LOGGIA.westU) / 2;
    lights.push({ type: 'point', position: f.p(uc, 4.3, -1.8), kelvin: 2700, lumens: 700, night: true, source: 'interior' });
  }
  for (const u of [-7.5, 7.5]) {
    const p = f.p(u, 0, MAIN.v0 - 3.2);
    const pos: [number, number, number] = [p[0], t.area.heights.at(p[0], p[2]), p[2]];
    t.place('street_lamp_01', pos, f.yaw(0, -1), { ref: `hero/pier1926/lamp${u < 0 ? 0 : 1}`, lights: false });
    lanternLights(t, 'street_lamp_01', pos, f.yaw(0, -1), `hero/pier1926/lamp${u < 0 ? 0 : 1}`, 3000);
    instances++;
  }
  for (const l of lights) {
    t.lights.add({ ...l, ref: l.ref ?? 'hero/pier1926' });
  }
  const ridge = EAVE + 0.18 + ((MAIN.v1 - MAIN.v0) / 2 + OVERHANG) * Math.tan((PITCH * Math.PI) / 180);
  return {
    topY: Math.round((floorY + ridge) * 100) / 100,
    floorY,
    lights: lights.length + instances,
    instances,
    notes: { origin: [round2(ox), round2(oz)], headingDeg: round2(heading), eaveY: round2(floorY + EAVE), ridgeY: round2(floorY + ridge), parapetY: round2(floorY + PAV_PARAPET), weatherCutTriangles: wx.added },
  };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

export function longestEdgeHeading(ring: readonly number[]): number {
  const n = ring.length / 2;
  let best = 0;
  let h = 0;
  for (let k = 0; k < n; k++) {
    const dx = ring[((k + 1) % n) * 2] - ring[k * 2];
    const dz = ring[((k + 1) % n) * 2 + 1] - ring[k * 2 + 1];
    const l = Math.hypot(dx, dz);
    if (l > best) {
      best = l;
      h = (Math.atan2(dx, -dz) * 180) / Math.PI;
    }
  }
  // Keep the long axis heading in [0, 180).
  return ((h % 180) + 180) % 180;
}

/* ------------------------------------------------------------------------------------------------------------- */

/** A façade of the main body: plinth, render wall with openings, dressings, corner pilasters, string course. */
function facade(mesh: TileMesh, batch: Batch, face: Face, len: number, yb: number, top: number, ops: readonly Op[], pilasters = true): void {
  // Plinth band between doors.
  const doors = ops.filter((o) => o.door).sort((a, b) => a.s - b.s);
  let s = 0;
  const plinth = batch.of('hero_plinth');
  for (const d of doors) {
    const l = d.s - d.w / 2 - 0.16;
    if (l > s + 0.01) {
      faceBoxC(plinth, face, s, l, yb, PLINTH, -0.05, 0.05, 0.025);
    }
    s = d.s + d.w / 2 + 0.16;
  }
  if (len > s + 0.01) {
    faceBoxC(plinth, face, s, len, yb, PLINTH, -0.05, 0.05, 0.025);
  }
  wall(mesh, RENDER, face, 0, len, PLINTH, top, ops);
  for (const o of ops) {
    dressOpening(mesh, batch, face, o, o.k === 'door' ? doorStyle : winStyle(o.k === 'win'));
  }
  const trim = batch.of(TRIM);
  faceBoxC(trim, face, 0, len, STRING[0], STRING[1], -0.02, 0.1, 0.02);
  if (pilasters) {
    faceBoxC(trim, face, 0, 0.45, PLINTH, CORNICE, -0.02, 0.06, 0.018, false);
    faceBoxC(trim, face, len - 0.45, len, PLINTH, CORNICE, -0.02, 0.06, 0.018, false);
  }
  // Weathering decals: grey streaks under most sills, a repair patch or two in the fresh render.
  const seed = Math.round(face.u0 * 131 + face.v0 * 71 + len * 13);
  sillStreaks(mesh, face, ops, 0.08, { color: STREAK_WHITE, len: [0.45, 1.5], p: 0.75 }, seed);
  repairPatches(mesh, 'hero_render@patch', face, 0.6, len - 0.6, PLINTH + 0.3, top - 0.7, ops, len > 8 ? 2 : 1, [[0.985, 0.98, 0.975, 1], [0.955, 0.95, 0.945, 1]], seed + 1);
}

/** Cornice under the eaves (two stepped bands). */
function cornice(batch: Batch, face: Face, len: number, y0: number, y1: number): void {
  const trim = batch.of(TRIM);
  const mid = (y0 + y1) / 2;
  faceBoxC(trim, face, -0.1, len + 0.1, y0, mid, -0.02, 0.1, 0.02);
  faceBoxC(trim, face, -0.2, len + 0.2, mid, y1, -0.02, 0.2, 0.025);
}

function panelOver(mesh: TileMesh, batch: Batch, face: Face, s0: number, s1: number, y0: number, y1: number): void {
  tilePanel(mesh, batch, 'hero_tile_panel', face, s0, s1, y0, y1, 0.015, 0.2, kutahya, { mat: TRIM, w: 0.08, d: 0.04 });
}

function mainBody(mesh: TileMesh, batch: Batch, f: Frame, yb: number, at: (u: number, v: number) => number, lights: LightInput[]): void {
  const { u0, u1, v0, v1 } = MAIN;
  // Sea face (s runs from u1 to u0).
  const sea = span(f, [u1, v0], [u0, v0]);
  const sc = sea.len / 2;
  const seaOps: Op[] = [door(sc - 2.2, 1.55, 2.7), door(sc, 1.55, 2.7), door(sc + 2.2, 1.55, 2.7)];
  for (const d of [5.6, 9.2, 12.3]) {
    seaOps.push(gfWin(sc - d), gfWin(sc + d));
  }
  seaOps.push(ufWin(sc - 1.55, 0.95), ufWin(sc, 0.95), ufWin(sc + 1.55, 0.95));
  for (const d of [5.6, 9.2, 12.3]) {
    seaOps.push(ufWin(sc - d, 1.05, d !== 12.3), ufWin(sc + d));
  }
  facade(mesh, batch, sea.face, sea.len, yb, CORNICE, seaOps);
  panelOver(mesh, batch, sea.face, sc - 2.3, sc + 2.3, 8.05, 8.6);
  cornice(batch, sea.face, sea.len, CORNICE, EAVE);
  steps(batch, sea.face, seaOps, (s) => groundAt(at, sea.face, s));

  // Land face: two sections either side of the pavilion.
  for (const [a, b] of [
    [u0, PAV.u0],
    [PAV.u1, u1],
  ] as const) {
    const land = span(f, [a, v1], [b, v1]);
    const c = land.len / 2;
    const ops: Op[] = [door(c), ufWin(c - 1.0, 0.72, true, 7.55), ufWin(c, 0.72, true, 7.55), ufWin(c + 1.0, 0.72, true, 7.55)];
    facade(mesh, batch, land.face, land.len, yb, CORNICE, ops);
    panelOver(mesh, batch, land.face, c - 1.55, c + 1.55, 8.1, 8.6);
    cornice(batch, land.face, land.len, CORNICE, EAVE);
    steps(batch, land.face, ops, (s) => groundAt(at, land.face, s));
    lights.push(washer(land.face, c + 2.2));
  }

  // End faces behind the loggias (east: s from v1 down to v0; west: from v0 up to v1).
  for (const east of [true, false]) {
    const e = east ? span(f, [u1, v1], [u1, v0]) : span(f, [u0, v0], [u0, v1]);
    const sOf = (v: number): number => (east ? v1 - v : v - v0);
    const vc = (LOGGIA.v0 + LOGGIA.v1) / 2;
    const ops: Op[] = [
      ufWin(sOf(vc + 4.65), 1.45),
      ufWin(sOf(vc + 1.65), 0.9),
      ufWin(sOf(vc), 0.9),
      ufWin(sOf(vc - 1.65), 0.9),
      ufWin(sOf(vc - 4.65), 1.45),
      pointedDoor(sOf(vc + 2.2)),
      pointedWin(sOf(vc)),
      pointedDoor(sOf(vc - 2.2)),
      { ...gfWin(sOf((LOGGIA.v1 + v1) / 2), 0.8), y0: 1.2, ys: 2.6 },
      { ...gfWin(sOf((LOGGIA.v0 + v0) / 2), 0.8), y0: 1.2, ys: 2.6 },
    ];
    // Sort so the notches of the wall contour run left to right.
    ops.sort((p, q) => p.s - q.s);
    facade(mesh, batch, e.face, e.len, yb, CORNICE, ops);
    cornice(batch, e.face, e.len, CORNICE, EAVE);
  }
}

/** Ground height in front of a face point. */
function groundAt(at: (u: number, v: number) => number, face: Face, s: number): number {
  const p = face.p(s, 0, 0.9);
  const [u, v] = face.f.local(p[0], p[2]);
  return at(u, v);
}

/** Stone steps in front of doors where the ground lies below the entrance floor. */
function steps(batch: Batch, face: Face, ops: readonly Op[], ground: (s: number) => number): void {
  const b = batch.of('hero_plinth');
  for (const o of ops) {
    if (!o.door) {
      continue;
    }
    const drop = face.f.y0 - ground(o.s);
    if (drop < 0.08) {
      continue;
    }
    const n = Math.min(9, Math.ceil(drop / 0.17));
    const rise = drop / n;
    for (let k = 1; k <= n; k++) {
      const y1 = -drop + rise * k;
      faceBox(b, face, o.s - o.w / 2 - 0.25, o.s + o.w / 2 + 0.25, -drop - 0.1, y1, -0.05, 0.3 * (n - k + 1), false, false);
    }
  }
}

/** Warm façade washer at the foot of a wall, aimed up the face. */
function washer(face: Face, s: number, lumens = 1100): LightInput {
  const d = face.dir(0, 0.93, -0.36);
  return { type: 'spot', position: face.p(s, 0.15, 0.7), direction: d, kelvin: 3000, lumens, cone: { inner: 18, outer: 40 }, night: true, source: 'other' };
}

function pavilion(mesh: TileMesh, batch: Batch, f: Frame, yb: number, lights: LightInput[]): void {
  const { u0, u1, v1 } = PAV;
  const v0 = MAIN.v1;
  const front = span(f, [u0, v1], [u1, v1]);
  const c = front.len / 2;
  const ops: Op[] = [
    gfWin(c - 4.7, 1.0),
    door(c - 2.1, 1.35, 2.6),
    door(c, 1.35, 2.6),
    door(c + 2.1, 1.35, 2.6),
    gfWin(c + 4.7, 1.0),
    ufWin(c - 4.7, 0.85),
    { ...ufWin(c - 1.55, 1.1), ys: 7.4 },
    { ...ufWin(c, 1.1), ys: 7.4 },
    { ...ufWin(c + 1.55, 1.1), ys: 7.4 },
    ufWin(c + 4.7, 0.85),
  ];
  facade(mesh, batch, front.face, front.len, yb, PAV_TOP, ops);
  lights.push(washer(front.face, c - 3.4, 1300), washer(front.face, c + 3.4, 1300));
  panelOver(mesh, batch, front.face, c - 2.55, c + 2.55, 8.25, 9.05);
  for (const s of [c - 4.7, c + 4.7]) {
    panelOver(mesh, batch, front.face, s - 0.3, s + 0.3, 8.35, 8.95);
  }
  // Sides (1.5 m) with a small window and a tile roundel stand-in.
  for (const [a, b] of [
    [
      [u1, v1],
      [u1, v0],
    ],
    [
      [u0, v0],
      [u0, v1],
    ],
  ] as [V2, V2][]) {
    const side = span(f, a, b);
    const sOps: Op[] = [{ s: side.len / 2, w: 0.5, y0: 6.3, ys: 7.25, kind: 'round', k: 'win' }];
    facade(mesh, batch, side.face, side.len, yb, PAV_TOP, sOps, false);
    panelOver(mesh, batch, side.face, side.len / 2 - 0.25, side.len / 2 + 0.25, 7.95, 8.45);
  }
  // Back wall above the main roof, flat roof, frieze, parapet with corner crests.
  const back = span(f, [u1, v0], [u0, v0]);
  wall(mesh, RENDER, back.face, 0, back.len, EAVE - 0.3, PAV_TOP + 0.12);
  hpoly(mesh, 'hero_floor', f, [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ], PAV_TOP + 0.15);
  const trim = batch.of(TRIM);
  for (const e of [front, span(f, [u1, v1], [u1, v0]), span(f, [u0, v0], [u0, v1]), back]) {
    faceBoxC(trim, e.face, -0.12, e.len + 0.12, PAV_TOP - 0.25, PAV_TOP, -0.02, 0.1, 0.02);
    faceBoxC(trim, e.face, -0.18, e.len + 0.18, PAV_TOP, PAV_TOP + 0.12, -0.02, 0.16, 0.02);
    // Parapet (0.25 thick): outer face is the wall plane, inner face 0.25 in.
    wall(mesh, RENDER, e.face, 0, e.len, PAV_TOP + 0.12, PAV_PARAPET);
    wall(mesh, RENDER, e.face.offset(-0.25), 0.25, e.len - 0.25, PAV_TOP + 0.15, PAV_PARAPET, [], { back: true });
    faceBoxC(trim, e.face, -0.05, e.len + 0.05, PAV_PARAPET, PAV_PARAPET + 0.08, -0.3, 0.05, 0.015);
  }
  // Corner crests: pedestal and a pointed finial on each front corner.
  const b = batch.of(TRIM);
  for (const u of [u0 + 0.45, u1 - 0.45]) {
    box(b, f, u - 0.45, u + 0.45, PAV_PARAPET, PAV_PARAPET + 0.7, v1 - 0.9, v1);
    box(b, f, u - 0.52, u + 0.52, PAV_PARAPET + 0.7, PAV_PARAPET + 0.8, v1 - 0.97, v1 + 0.07, { bottom: true, top: true });
    lathe(b, f, u, v1 - 0.45, [
      [0.34, PAV_PARAPET + 0.8],
      [0.4, PAV_PARAPET + 1.0],
      [0.26, PAV_PARAPET + 1.3],
      [0.06, PAV_PARAPET + 1.55],
      [0, PAV_PARAPET + 1.62],
    ], 12);
  }
  // Raised centre of the front parapet.
  box(b, f, -1.6, 1.6, PAV_PARAPET, PAV_PARAPET + 0.35, v1 - 0.25, v1);
}

/** Open loggia with a roof terrace at one end (dir +1: east, -1: west). */
function loggia(mesh: TileMesh, batch: Batch, f: Frame, yb: number, dir: 1 | -1, lights: LightInput[]): void {
  const uIn = dir > 0 ? MAIN.u1 : MAIN.u0;
  const uOut = dir > 0 ? LOGGIA.eastU : LOGGIA.westU;
  const { v0, v1 } = LOGGIA;
  const depth = 0.5;
  const uLo = Math.min(uIn, uOut);
  const uHi = Math.max(uIn, uOut);
  hpoly(mesh, 'hero_floor', f, [
    [uLo, v0],
    [uHi, v0],
    [uHi, v1],
    [uLo, v1],
  ], 0.01);
  hpoly(mesh, 'hero_render_soffit', f, [
    [uLo, v0],
    [uHi, v0],
    [uHi, v1],
    [uLo, v1],
  ], 4.55, true);
  hpoly(mesh, 'hero_floor', f, [
    [uLo, v0],
    [uHi, v0],
    [uHi, v1],
    [uLo, v1],
  ], TERRACE);
  // Front arcade (4 pointed arches) and the two sides (one wide arch each).
  const front = dir > 0 ? span(f, [uOut, v1], [uOut, v0]) : span(f, [uOut, v0], [uOut, v1]);
  const sideA = dir > 0 ? span(f, [uIn, v1], [uOut, v1]) : span(f, [uOut, v1], [uIn, v1]);
  const sideB = dir > 0 ? span(f, [uOut, v0], [uIn, v0]) : span(f, [uIn, v0], [uOut, v0]);
  const pier = 0.55;
  const bay = (front.len - pier) / 4;
  const arches: Op[] = [];
  for (let k = 0; k < 4; k++) {
    arches.push({ s: k * bay + pier + (bay - pier) / 2, w: bay - pier, y0: 0, ys: 3.1, kind: 'pointed', rise: (bay - pier) * 0.62, door: true, k: 'door' });
  }
  arcade(mesh, batch, front.face, front.len, yb, depth, arches);
  const railB = batch.of('hero_iron');
  for (const a of arches) {
    railing(railB, front.face, a.s - a.w / 2, a.s + a.w / 2, -depth / 2);
  }
  const sides = [sideA, sideB];
  for (const sd of sides) {
    const w = sd.len - 2 * 0.6;
    const big: Op = { s: sd.len / 2, w, y0: 0, ys: 2.4, kind: 'pointed', rise: 2.05, door: true, k: 'door' };
    arcade(mesh, batch, sd.face, sd.len, yb, depth, [big]);
  }
  // Terrace parapet (c01 photo): posts over the arcade piers with cap blocks on the coping, and between them sunken
  // panels framed by a raised moulding, each pierced by a group of square openings with a carved cross-and-boss
  // rosette in the middle of the wall.
  const yc = (TERRACE + PARAPET) / 2 + 0.02;
  for (const e of [front, ...sides]) {
    const posts = e === front ? Array.from({ length: 5 }, (_, k) => k * bay + pier / 2) : [0.16, e.len / 2, e.len - 0.16];
    const slots: Op[] = [];
    const panels: [number, number][] = [];
    for (let k = 0; k + 1 < posts.length; k++) {
      const a = posts[k] + 0.26;
      const b = posts[k + 1] - 0.26;
      const w = b - a;
      if (w < 0.5) {
        continue;
      }
      panels.push([a, b]);
      const nS = Math.max(2, Math.min(5, Math.floor(w / 0.42)));
      const inner = Math.min(w - 0.3, nS * 0.36);
      for (let i = 0; i < nS; i++) {
        const sc = (a + b) / 2 - inner / 2 + inner * ((i + 0.5) / nS);
        slots.push({ s: sc, w: 0.19, y0: yc - 0.095, ys: yc + 0.095, kind: 'flat', k: 'dark' });
      }
    }
    slots.sort((p, q) => p.s - q.s);
    wall(mesh, RENDER, e.face, 0, e.len, TERRACE - 0.05, PARAPET, slots);
    wall(mesh, RENDER, e.face.offset(-0.22), 0, e.len, TERRACE, PARAPET, slots, { back: true });
    const rb = batch.of(RENDER);
    const trim = batch.of(TRIM);
    for (const o of slots) {
      const loop = outline(o, 4);
      loopSidesThrough(rb, e.face, loop, 0, -0.22);
      faceBar(trim, e.face, [o.s - 0.095, yc], [o.s + 0.095, yc], 0.026, -0.124);
      faceBar(trim, e.face, [o.s, yc - 0.095], [o.s, yc + 0.095], 0.026, -0.124);
      faceBox(trim, e.face, o.s - 0.035, o.s + 0.035, yc - 0.035, yc + 0.035, -0.13, -0.085, false, true);
    }
    for (const [a, b] of panels) {
      const y0 = TERRACE + 0.16;
      const y1 = PARAPET - 0.13;
      faceBoxC(trim, e.face, a - 0.06, b + 0.06, y0 - 0.05, y0, -0.01, 0.028, 0.01);
      faceBoxC(trim, e.face, a - 0.06, b + 0.06, y1, y1 + 0.05, -0.01, 0.028, 0.01);
      faceBoxC(trim, e.face, a - 0.06, a - 0.01, y0, y1, -0.01, 0.028, 0.01, false);
      faceBoxC(trim, e.face, b + 0.01, b + 0.06, y0, y1, -0.01, 0.028, 0.01, false);
    }
    for (const p of posts) {
      faceBoxC(trim, e.face, p - 0.17, p + 0.17, TERRACE - 0.05, PARAPET, -0.02, 0.06, 0.015, false);
      faceBoxC(trim, e.face, p - 0.15, p + 0.15, PARAPET + 0.08, PARAPET + 0.2, -0.24, 0.03, 0.012);
    }
    faceBoxC(trim, e.face, -0.06, e.len + 0.06, PARAPET, PARAPET + 0.08, -0.28, 0.07, 0.015);
    faceBoxC(trim, e.face, -0.12, e.len + 0.12, 4.75, TERRACE - 0.05, -0.02, 0.14, 0.02);
  }
  // Uplights at the foot of the front piers.
  for (let k = 0; k <= 4; k++) {
    lights.push(washer(front.face, k * bay + pier / 2, 800));
  }
}

/** Side strip through a wall (pierced slots): quads from depth d0 to d1, facing into the hole. */
function loopSidesThrough(b: Builder, face: Face, loop: readonly V2[], d0: number, d1: number): void {
  const n = loop.length;
  for (let k = 0; k < n; k++) {
    const a = loop[k];
    const c = loop[(k + 1) % n];
    const ds = c[0] - a[0];
    const dy = c[1] - a[1];
    const l = Math.hypot(ds, dy) || 1;
    const nn = face.dir(-dy / l, ds / l, 0);
    b.flatQuad([face.p(a[0], a[1], d0), face.p(c[0], c[1], d0), face.p(c[0], c[1], d1), face.p(a[0], a[1], d1)], nn);
  }
}

/** Arcade wall of a loggia: outer and inner faces with the arches cut through, soffits, plinth and imposts. */
function arcade(mesh: TileMesh, batch: Batch, face: Face, len: number, yb: number, depth: number, arches: readonly Op[]): void {
  wall(mesh, RENDER, face, 0, len, 0, 4.95, arches);
  wall(mesh, RENDER, face.offset(-depth), 0, len, 0, 4.55, arches, { back: true });
  const rb = batch.of(RENDER);
  for (const a of arches) {
    const loop = outline(a, 16);
    // Soffit and jambs through the wall, facing into the arch.
    const n = loop.length;
    for (let k = 1; k < n; k++) {
      const p = loop[k];
      const q = loop[(k + 1) % n];
      if (Math.abs(p[1]) < 1e-6 && Math.abs(q[1]) < 1e-6) {
        continue;
      }
      const ds = q[0] - p[0];
      const dy = q[1] - p[1];
      const l = Math.hypot(ds, dy) || 1;
      const nn = face.dir(-dy / l, ds / l, 0);
      rb.flatQuad([face.p(p[0], p[1], 0.04), face.p(q[0], q[1], 0.04), face.p(q[0], q[1], -depth), face.p(p[0], p[1], -depth)], nn);
    }
    // Archivolt band.
    const g = { ...a, w: a.w + 0.3, rise: (a.rise ?? 0) + 0.15 };
    const outer = outline(g, 16);
    const band: V2[] = [...outer.slice(2).reverse(), ...loop.slice(2)];
    shape(mesh, TRIM, face, band, [], 0.04);
    // Impost blocks at the spring.
    faceBoxC(batch.of(TRIM), face, a.s - a.w / 2 - 0.12, a.s - a.w / 2 + 0.02, a.ys - 0.18, a.ys, -0.02, 0.07, 0.015);
    faceBoxC(batch.of(TRIM), face, a.s + a.w / 2 - 0.02, a.s + a.w / 2 + 0.12, a.ys - 0.18, a.ys, -0.02, 0.07, 0.015);
  }
  // Plinth on the piers.
  const plinth = batch.of('hero_plinth');
  const sorted = [...arches].sort((p, q) => p.s - q.s);
  let s = 0;
  for (const a of sorted) {
    faceBoxC(plinth, face, s, a.s - a.w / 2, yb, 0.3, -0.05, 0.05, 0.025);
    s = a.s + a.w / 2;
  }
  faceBoxC(plinth, face, s, len, yb, 0.3, -0.05, 0.05, 0.025);
}

/** Wrought-iron railing across an arch: rails and square bars with spear tips. */
function railing(b: Builder, face: Face, s0: number, s1: number, d: number): void {
  const top = 2.25;
  faceBar(b, face, [s0, 0.12], [s1, 0.12], 0.04, d - 0.02);
  faceBar(b, face, [s0, top], [s1, top], 0.04, d - 0.02);
  faceBar(b, face, [s0, 1.2], [s1, 1.2], 0.03, d - 0.015);
  const n = Math.max(2, Math.round((s1 - s0) / 0.13));
  for (let k = 1; k < n; k++) {
    const s = s0 + ((s1 - s0) * k) / n;
    faceBar(b, face, [s, 0.12], [s, top + 0.14], 0.026, d - 0.013);
  }
}

function roofAndDome(mesh: TileMesh, batch: Batch, f: Frame, detail: boolean): void {
  const { u0, u1, v0, v1 } = MAIN;
  const half = (v1 - v0) / 2 + OVERHANG;
  const rise = half * Math.tan((PITCH * Math.PI) / 180);
  hippedRoof(mesh, 'hero_roof_tile', 'hero_render_soffit', f, u0 - OVERHANG, u1 + OVERHANG, v0 - OVERHANG, v1 + OVERHANG, EAVE + 0.18, rise, OVERHANG, 0.18, batch);
  const ridgeY = EAVE + 0.18 + rise;
  if (detail) {
    // Ridge and hip caps, half-round gutters sagging a little along the eaves, downpipes near the corners.
    const eu0 = u0 - OVERHANG;
    const eu1 = u1 + OVERHANG;
    const ev0 = v0 - OVERHANG;
    const ev1 = v1 + OVERHANG;
    const hr = (ev1 - ev0) / 2;
    const cv = (ev0 + ev1) / 2;
    const cap = batch.of('hero_roof_tile');
    const y = EAVE + 0.18;
    const r0 = f.p(eu0 + hr, ridgeY + 0.03, cv);
    const r1 = f.p(eu1 - hr, ridgeY + 0.03, cv);
    ridgeCap(cap, r0, r1, 0.13);
    for (const [cu, cvv, r] of [
      [eu0, ev0, r0],
      [eu0, ev1, r0],
      [eu1, ev0, r1],
      [eu1, ev1, r1],
    ] as [number, number, Vec3][]) {
      ridgeCap(cap, f.p(cu, y + 0.02, cvv), r, 0.11);
    }
    const gb = batch.of('hero_lead');
    const g = 0.09;
    gutter(gb, f, [eu0, ev0 - g], [eu1, ev0 - g], EAVE + 0.1, 0.075, 0.03, 1);
    gutter(gb, f, [eu1 + g, ev0], [eu1 + g, ev1], EAVE + 0.1, 0.075, 0.022, 2);
    gutter(gb, f, [eu0 - g, ev0], [eu0 - g, ev1], EAVE + 0.1, 0.075, 0.018, 3);
    gutter(gb, f, [eu0, ev1 + g], [PAV.u0 - 0.1, ev1 + g], EAVE + 0.1, 0.075, 0.02, 4);
    gutter(gb, f, [PAV.u1 + 0.1, ev1 + g], [eu1, ev1 + g], EAVE + 0.1, 0.075, 0.025, 5);
    const sea = span(f, [u1, v0], [u0, v0]);
    const landW = span(f, [u0, v1], [PAV.u0, v1]);
    const landE = span(f, [PAV.u1, v1], [u1, v1]);
    for (const [face, s] of [
      [sea.face, 0.66],
      [sea.face, sea.len - 0.66],
      [landW.face, 0.66],
      [landE.face, landE.len - 0.66],
    ] as [Face, number][]) {
      downpipe(gb, face, s, EAVE - 0.05, -0.05, 0.1, 0.048, OVERHANG - 0.05);
    }
  }
  const vr = (v0 + v1) / 2;
  const b = batch.of(RENDER);
  const t = batch.of(TRIM);
  // Chimneys on the ridge.
  for (const u of [-6.3, 6.3]) {
    box(b, f, u - 0.45, u + 0.45, ridgeY - 0.6, ridgeY + 1.9, vr - 0.45, vr + 0.45);
    box(t, f, u - 0.58, u + 0.58, ridgeY + 1.9, ridgeY + 2.05, vr - 0.58, vr + 0.58, { bottom: true, top: true });
    if (detail) {
      for (const [du, dv] of [
        [-0.3, -0.3],
        [0.3, -0.3],
        [-0.3, 0.3],
        [0.3, 0.3],
      ]) {
        box(b, f, u + du - 0.1, u + du + 0.1, ridgeY + 2.05, ridgeY + 2.55, vr + dv - 0.1, vr + dv + 0.1);
      }
      box(t, f, u - 0.55, u + 0.55, ridgeY + 2.55, ridgeY + 2.7, vr - 0.55, vr + 0.55, { bottom: true, top: true });
    }
  }
  // The small lead dome behind the ridge (seen in c01 / c02 today) on a square base and octagonal drum.
  const du = 3.0;
  const dv = v0 + 2.6;
  const tan = Math.tan((PITCH * Math.PI) / 180);
  const yBase = EAVE + 0.18 + (dv - (v0 - OVERHANG)) * tan;
  const yLow = EAVE + 0.18 + (dv - 1.4 - (v0 - OVERHANG)) * tan - 0.15;
  box(b, f, du - 1.4, du + 1.4, yLow, yBase + 1.3, dv - 1.4, dv + 1.4);
  box(t, f, du - 1.5, du + 1.5, yBase + 1.3, yBase + 1.45, dv - 1.5, dv + 1.5, { bottom: true, top: true });
  const drum = batch.of(RENDER);
  lathe(drum, f, du, dv, [
    [1.2, yBase + 1.45],
    [1.2, yBase + 2.35],
  ], 8, Math.PI / 8);
  const lead = batch.of('hero_lead');
  lathe(lead, f, du, dv, [[1.32, yBase + 2.35], ...domeProfile(1.32, 1.35, yBase + 2.35, detail ? 8 : 4).slice(1)], detail ? 20 : 8);
  if (detail) {
    lathe(batch.of('hero_iron'), f, du, dv, [
      [0.035, yBase + 3.6],
      [0.035, yBase + 7.4],
      [0, yBase + 7.45],
    ], 6);
    lathe(batch.of('hero_lead'), f, du, dv, [
      [0, yBase + 3.62],
      [0.12, yBase + 3.72],
      [0.12, yBase + 3.9],
      [0, yBase + 4.02],
    ], 8);
  }
}

/** LOD1: massing, roof base, flat window shapes 2 cm proud of the walls. */
function lod1(mesh: TileMesh, batch: Batch, f: Frame, yb: number): void {
  const { u0, u1, v0, v1 } = MAIN;
  const b = batch.of(RENDER);
  box(b, f, u0, u1, yb, EAVE, v0, v1);
  box(b, f, PAV.u0, PAV.u1, yb, PAV_PARAPET, v1, PAV.v1);
  box(b, f, MAIN.u1, LOGGIA.eastU, yb, PARAPET, LOGGIA.v0, LOGGIA.v1);
  box(b, f, LOGGIA.westU, MAIN.u0, yb, PARAPET, LOGGIA.v0, LOGGIA.v1);
  const win = (face: Face, ops: Op[]): void => {
    for (const o of ops) {
      shape(mesh, o.door ? 'hero_door' : 'hero_glass_lit', face, outline(o, 6), [], 0.02);
    }
  };
  const sea = span(f, [u1, v0], [u0, v0]);
  const c = sea.len / 2;
  win(sea.face, [door(c - 2.2, 1.55, 2.7), door(c, 1.55, 2.7), door(c + 2.2, 1.55, 2.7), ...[-9.2, -5.6, 5.6, 9.2].flatMap((d) => [gfWin(c + d), ufWin(c + d)]), ufWin(c - 1.55, 0.95), ufWin(c, 0.95), ufWin(c + 1.55, 0.95)]);
  const pav = span(f, [PAV.u0, PAV.v1], [PAV.u1, PAV.v1]);
  const pc = pav.len / 2;
  win(pav.face, [door(pc - 2.1, 1.35, 2.6), door(pc, 1.35, 2.6), door(pc + 2.1, 1.35, 2.6), ufWin(pc - 1.55, 1.1), ufWin(pc, 1.1), ufWin(pc + 1.55, 1.1), ufWin(pc - 4.7, 0.85), ufWin(pc + 4.7, 0.85)]);
  for (const [a, bb] of [
    [u0, PAV.u0],
    [PAV.u1, u1],
  ] as const) {
    const land = span(f, [a, v1], [bb, v1]);
    const lc = land.len / 2;
    win(land.face, [door(lc), ufWin(lc - 1.0, 0.72), ufWin(lc, 0.72), ufWin(lc + 1.0, 0.72)]);
  }
  for (const east of [true, false]) {
    const uo = east ? LOGGIA.eastU : LOGGIA.westU;
    const front = east ? span(f, [uo, LOGGIA.v1], [uo, LOGGIA.v0]) : span(f, [uo, LOGGIA.v0], [uo, LOGGIA.v1]);
    const bay = (front.len - 0.55) / 4;
    const arches: Op[] = [];
    for (let k = 0; k < 4; k++) {
      arches.push({ s: k * bay + 0.55 + (bay - 0.55) / 2, w: bay - 0.55, y0: 0, ys: 3.1, kind: 'pointed', rise: (bay - 0.55) * 0.62, door: true, k: 'dark' });
    }
    for (const o of arches) {
      shape(mesh, 'hero_glass', front.face, outline(o, 6), [], 0.02);
    }
    const e = east ? span(f, [u1, v1], [u1, v0]) : span(f, [u0, v0], [u0, v1]);
    const vc = (LOGGIA.v0 + LOGGIA.v1) / 2;
    const sOf = (v: number): number => (east ? v1 - v : v - v0);
    win(e.face, [ufWin(sOf(vc + 4.65), 1.45), ufWin(sOf(vc + 1.65), 0.9), ufWin(sOf(vc), 0.9), ufWin(sOf(vc - 1.65), 0.9), ufWin(sOf(vc - 4.65), 1.45)]);
  }
}

