/**
 * The new Kadıköy pier (Eminönü–Karaköy iskelesi, OSM way 560203763): built 1982, re-clad 2005–08 with light precast
 * panels and arched openings. Simpler than the 1926 pier: correct massing and openings.
 *
 * Measured on c03-day (cameras.json pose, OSM footprint 82.3 × 18.0 m, long axis 123°/303°): from the sea end, a
 * one-storey part with a roof terrace (20 m, 4.2 m), the two-storey pavilion (27 m) with arched ground-floor openings,
 * a glazed upper floor and a hipped standing-seam roof (eaves 8.0 m, ridge about 11.4 m), then the land block (35 m,
 * parapet 8.6 m) in five pilastered bays of paired pointed-arch windows over rectangular ones. Cream panels, white
 * frames, grey metal roof.
 */
import type { LightInput } from '../lights';
import { LOD0, LOD1, type TileMesh } from '../mesh';
import type { TileContext } from '../registry';
import { Batch, box, dressOpening, Face, faceBox, Frame, hippedRoof, hpoly, type Opening, outline, shape, span, wall, type WindowStyle } from './kit';
import { type HeroBuild, longestEdgeHeading } from './pier1926';

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
  const mesh = t.mesh;
  const lights: LightInput[] = [];

  mesh.withLod(LOD0, () => {
    const batch = new Batch(mesh);
    for (const sideV of [HALF_W, -HALF_W]) {
      longSide(mesh, batch, f, sideV, yb, lights);
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
    instances: 0,
    notes: { origin: [Math.round(ox * 100) / 100, Math.round(oz * 100) / 100], headingDeg: Math.round(heading * 100) / 100, eaveY: Math.round((floorY + PAV.eave) * 100) / 100, ridgeY: Math.round((floorY + ridge) * 100) / 100, landParapetY: Math.round((floorY + LAND.h) * 100) / 100 },
  };
}

/** Openings of a long side in face coordinates (s from the face's left end). */
function openings(len: number, sSW: boolean): Op[] {
  // s runs from the sea end on the SW side (+v face) and from the land end on the NE side.
  const sOf = (u: number): number => (sSW ? u + HALF_L : HALF_L - u);
  const ops: Op[] = [];
  for (const u of [-37, -31.5, -26]) {
    ops.push({ s: sOf(u), w: 1.5, y0: 0.9, ys: 2.4, kind: 'round' });
  }
  for (const u of [-17.5, -10.8, -4.1, 2.6]) {
    ops.push({ s: sOf(u), w: 1.7, y0: 0.6, ys: 2.3, kind: 'round' });
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

function longSide(mesh: TileMesh, batch: Batch, f: Frame, v: number, yb: number, lights: LightInput[]): void {
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
  }
  const trim = batch.of(TRIM);
  // Land block: pilasters, cornice, parapet coping. Pavilion: band between the floors, name board.
  for (let b = 0; b <= 5; b++) {
    const s = sOf(LAND.u0 + b * 7);
    faceBox(trim, side.face, s - 0.28, s + 0.28, yb, LAND.h - 0.5, -0.02, 0.12, false, false);
  }
  const l0 = Math.min(sOf(LAND.u0), sOf(LAND.u1));
  const l1 = Math.max(sOf(LAND.u0), sOf(LAND.u1));
  faceBox(trim, side.face, l0, l1, LAND.h - 0.8, LAND.h - 0.5, -0.02, 0.18);
  faceBox(trim, side.face, l0, l1, LAND.h - 0.06, LAND.h + 0.04, -0.3, 0.06);
  faceBox(trim, side.face, l0, l1, 4.0, 4.2, -0.02, 0.1);
  const p0 = Math.min(sOf(PAV.u0), sOf(PAV.u1));
  const p1 = Math.max(sOf(PAV.u0), sOf(PAV.u1));
  faceBox(trim, side.face, p0, p1, 3.95, 4.3, -0.02, 0.14);
  if (sSW) {
    const c = (p0 + p1) / 2;
    faceBox(batch.of('hero_iron'), side.face, c - 3.2, c + 3.2, 3.98, 4.27, 0.14, 0.17, false, true);
  }
  const s0 = Math.min(sOf(SEA.u0), sOf(SEA.u1));
  const s1 = Math.max(sOf(SEA.u0), sOf(SEA.u1));
  faceBox(trim, side.face, s0, s1, SEA.h - 0.25, SEA.h + 0.05, -0.02, 0.14);
  railing(batch, side.face, s0 + 0.2, s1 - 0.2, SEA.h + 0.05);
  // Wall lanterns over the ground-floor openings of the berth side, warm.
  for (const u of [-37, -26, -17.5, -4.1, 9.5, 23.5, 37.5]) {
    const p = side.face.p(sOf(u), 3.3, 0.35);
    lights.push({ type: 'point', position: p, kelvin: 2800, lumens: 650, night: true, source: 'lamp' });
  }
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
    { s: c - 4, w: 2.0, y0: 0, ys: 2.6, kind: 'round', door: true },
    { s: c, w: 2.0, y0: 0, ys: 2.6, kind: 'round', door: true },
    { s: c + 4, w: 2.0, y0: 0, ys: 2.6, kind: 'round', door: true },
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
  const so: Op[] = [-5, 0, 5].map((d) => ({ s: sea.len / 2 + d, w: 1.5, y0: 0.9, ys: 2.4, kind: 'round' as const }));
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
