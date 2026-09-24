/**
 * Haldun Taner Sahnesi (OSM way 102190100), the 1927 Kadıköy market hall by Umberto Ferrari in the First National
 * Architecture style, a theatre since 1990 (hero-spots 'haldun-taner'; spec section 2 and 3, camera c04).
 *
 * Built as in the 2013–2019 photos (c04-day, context/haldun-taner-kiosks-2013, context/haldun-taner-rihtim-dusk):
 * - plan from the OSM ring (63 × 30 m walls, the central range traced 2–5 m further out at its canopy): two
 *   two-storey end pavilions (12.5 and 13.3 m) joined by a single-storey arcaded range with the market hall behind;
 * - a continuous timber-lined canopy on curved iron brackets round the whole ground floor (3.2 m deep, 4.75 m at the
 *   wall), pointed ("Seljuk") arches with dark green glazing in every bay under it;
 * - pavilions: paired pointed windows on the upper floor with turquoise tile panels over them, a tiled frieze under
 *   the cornice, a parapet with a stepped crest (tile band inside the steps) at the centre of every face, and
 *   octagonal corner turrets with pointed caps;
 * - the hall: lean-to metal roofs from the arcade parapet up to a clerestory with a band of windows, and a pitched
 *   metal roof above it (ridge 12.4 m), inside the spec's 12–14 m;
 * - dusty salmon render (0xcdb3a2) with a lighter trim, stone plinth.
 * The colour after the restoration that began in 2021 is unknown (spec), so this keeps the documented pre-2021 state.
 *
 * LOD0 has every opening with reveals, frames and glazing bars, the tile panels, crests, turrets and the canopy with
 * its brackets; LOD1 is the massing with the canopy slab, the roofs and flat window shapes.
 */
import type { LightInput } from '../lights';
import { LOD0, LOD1, type RGBA, type TileMesh, type Vec3 } from '../mesh';
import type { TileContext } from '../registry';
import { Batch, box, type Builder, dressOpening, type Face, faceBox, Frame, hpoly, lathe, ngon, type Opening, outline, prism, rgba, shape, span, tilePanel, type V2, wall, type WindowStyle } from './kit';
import { type HeroBuild, longestEdgeHeading } from './pier1926';

/* Plan (u along the long axis, 63.9°; v 90° clockwise of it, towards the Rıhtım side). Walls, not the OSM line. */
const V0 = -14.45;
const V1 = 15.43;
const WEST = { u0: -31.35, u1: -18.9 };
const EAST = { u0: 18.6, u1: 31.85 };
/* Heights above the hall floor. */
const PLINTH = 0.4;
const SPRING = 2.95;
const CANOPY_WALL = 4.78;
const CANOPY_EDGE = 4.42;
const CANOPY_D = 3.2;
const STRING = [5.75, 5.95] as const;
const RANGE_TOP = 6.45;
const UF_SILL = 6.55;
const UF_SPRING = 8.3;
const FRIEZE = [9.35, 9.85] as const;
const CORNICE = [9.9, 10.35] as const;
const PARAPET = 11.05;
const STEP = 0.52;
const CLERESTORY_V = 7.6;
const CLERESTORY = [8.45, 9.85] as const;
const RIDGE = 12.4;

const RENDER = 'hero_ht_render';
const TRIM = 'hero_ht_trim';
const GREEN = 'hero_ht_green';

const arcadeStyle = (lit: boolean): WindowStyle => ({ wall: RENDER, frame: GREEN, pane: lit ? 'hero_glass_lit' : 'hero_glass', reveal: 0.38, frameW: 0.08, mullions: 2, transom: true, radials: 2, surround: { mat: TRIM, w: 0.14, d: 0.04 } });
const doorStyle: WindowStyle = { wall: RENDER, frame: GREEN, pane: 'hero_ht_door', fan: 'hero_glass_lit', reveal: 0.38, frameW: 0.08, mullions: 1, transom: true, radials: 2, surround: { mat: TRIM, w: 0.14, d: 0.04 } };
const upperStyle = (lit: boolean): WindowStyle => ({ wall: RENDER, frame: GREEN, pane: lit ? 'hero_glass_lit' : 'hero_glass', reveal: 0.3, frameW: 0.06, mullions: 1, transom: true, radials: 1, sill: { mat: TRIM, depth: 0.1, h: 0.08 }, surround: { mat: TRIM, w: 0.1, d: 0.035 } });

type Kind = 'arch' | 'door' | 'upper' | 'dark';
interface Op extends Opening {
  k: Kind;
}

/** Turquoise Seljuk tile band: cobalt border, turquoise field with white eight-point stars and cobalt knots. */
function seljuk(i: number, j: number, ni: number, nj: number): RGBA {
  const cobalt = rgba(0x1f4a8f);
  const turq = rgba(0x2a9a9c);
  const white = rgba(0xece8dc);
  if (j === 0 || j === nj - 1 || i === 0 || i === ni - 1) {
    return cobalt;
  }
  const a = (i - 1) % 3;
  const b = (j - 1) % 3;
  if (a === 1 && b === 1) {
    return white;
  }
  return (i + j) % 4 === 0 ? cobalt : turq;
}

interface Ctx {
  mesh: TileMesh;
  batch: Batch;
  f: Frame;
  yb: number;
  lights: LightInput[];
  seed: number;
  /** Ground above the hall floor in front of a face point (0.7 m out). */
  g: (face: Face, s: number) => number;
}

/** Builds the market hall into the tile; `ring` is the OSM outline (flat x, z). */
export function buildHaldunTaner(t: TileContext, ring: readonly number[], bottomY: number): HeroBuild {
  const mesh = t.mesh;
  const n = ring.length / 2;
  let ox = 0;
  let oz = 0;
  for (let k = 0; k < n; k++) {
    ox += ring[k * 2] / n;
    oz += ring[k * 2 + 1] / n;
  }
  const heading = longestEdgeHeading(ring);
  const probe = new Frame(ox, oz, 0, heading);
  const at = (u: number, v: number): number => {
    const p = probe.p(u, 0, v);
    return t.area.heights.at(p[0], p[2]);
  };
  // Hall floor: the highest ground just outside the walls (thresholds never buried; the plinth shows elsewhere).
  const samples: V2[] = [];
  for (const u of [WEST.u0 - 0.8, -12, 0, 12, EAST.u1 + 0.8]) {
    samples.push([u, V0 - 0.8], [u, V1 + 0.8]);
  }
  // The compiled ground rises 1.7 m from the sea-side north-west corner to the Rıhtım-side south-east one: the hall
  // floor sits at the lowest wall foot (c04 side) and openings further up the slope start at the local ground.
  const floorY = Math.round((Math.min(...samples.map(([u, v]) => at(u, v))) + 0.05) * 100) / 100;
  const f = new Frame(ox, oz, floorY, heading);
  const yb = Math.min(bottomY - floorY, -0.4) - 0.2;
  const lights: LightInput[] = [];
  const g = (face: Face, s: number): number => {
    const p = face.p(s, 0, 0.7);
    return t.area.heights.at(p[0], p[2]) - floorY;
  };
  const c: Ctx = { mesh, batch: new Batch(mesh), f, yb, lights, seed: 7, g };

  mesh.withLod(LOD0, () => {
    pavilion(c, WEST.u0, WEST.u1, true);
    pavilion(c, EAST.u0, EAST.u1, false);
    range(c);
    hallRoof(c, true);
    canopy(c, true);
    c.batch.flush();
  });
  mesh.withLod(LOD1, () => {
    const b = new Batch(mesh);
    lod1(mesh, b, f, yb);
    const c1: Ctx = { mesh, batch: b, f, yb, lights: [], seed: 7, g };
    hallRoof(c1, false);
    canopy(c1, false);
    b.flush();
  });

  for (const l of lights) {
    t.lights.add({ ...l, ref: l.ref ?? 'hero/haldunTaner' });
  }
  const topY = Math.round((floorY + PARAPET + 4 * STEP + 0.9) * 100) / 100;
  return {
    topY,
    floorY,
    lights: lights.length,
    instances: 0,
    notes: { origin: [r2(ox), r2(oz)], headingDeg: r2(heading), canopyY: r2(floorY + CANOPY_WALL), parapetY: r2(floorY + PARAPET), ridgeY: r2(floorY + RIDGE) },
  };
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

/* ------------------------------------------------------------------------------------------------------------- */

/** Pointed openings of the arcade across [s0, s1] (bays of about `bay` m). */
function arcadeOps(s0: number, s1: number, bay: number, doorAt: number[] = []): Op[] {
  const len = s1 - s0;
  const nb = Math.max(1, Math.round(len / bay));
  const b = len / nb;
  const w = Math.min(2.6, b - 1.15);
  const out: Op[] = [];
  for (let k = 0; k < nb; k++) {
    const s = s0 + (k + 0.5) * b;
    const door = doorAt.includes(k);
    out.push({ s, w, y0: 0, ys: SPRING, kind: 'pointed', rise: w * 0.62, door: true, k: door ? 'door' : 'arch' });
  }
  return out;
}

/** Openings further up the slope start at the local ground: a hole with a sill instead of a notch at the floor. */
function onGround(c: Ctx, face: Face, ops: Op[]): Op[] {
  return ops.map((o) => {
    const g = Math.max(c.g(face, o.s - o.w / 2), c.g(face, o.s + o.w / 2));
    if (g <= PLINTH - 0.05) {
      return o;
    }
    const y0 = g + 0.12;
    return { ...o, y0, ys: Math.max(o.ys, y0 + 1.5), door: false };
  });
}

/** Paired (or tripled) pointed windows centred at s. */
function upperGroup(s: number, count: number, lit: boolean): Op[] {
  const w = 0.82;
  const gap = 0.34;
  const span0 = count * w + (count - 1) * gap;
  const out: Op[] = [];
  for (let k = 0; k < count; k++) {
    out.push({ s: s - span0 / 2 + w / 2 + k * (w + gap), w, y0: UF_SILL, ys: UF_SPRING, kind: 'pointed', rise: w * 0.7, k: lit ? 'upper' : 'dark' });
  }
  return out;
}

/** A pavilion face: plinth, render wall with the arcade below and window groups above, trims, tile panels. */
function pavilionFace(c: Ctx, face: Face, len: number, groups: { s: number; count: number }[], archesAtFloor: Op[], crest: { s: number; half: number } | null): void {
  const { mesh, batch } = c;
  const arches = onGround(c, face, archesAtFloor);
  const ups: Op[] = [];
  groups.forEach((g, k) => ups.push(...upperGroup(g.s, g.count, (k + Math.round(len)) % 3 !== 1)));
  const ops = [...arches, ...ups].sort((a, b) => a.s - b.s);
  plinth(batch, face, len, arches, c.yb);
  wall(mesh, RENDER, face, 0, len, PLINTH, PARAPET, ops);
  for (const o of arches) {
    dressOpening(mesh, batch, face, o, o.k === 'door' ? doorStyle : arcadeStyle(Math.round(o.s * 7) % 4 !== 0));
  }
  for (const o of ups) {
    dressOpening(mesh, batch, face, o, upperStyle(o.k === 'upper'));
  }
  const trim = batch.of(TRIM);
  // Plinth cap, string course over the canopy, cornice, parapet coping.
  faceBox(trim, face, 0, len, PLINTH, PLINTH + 0.08, -0.02, 0.07);
  faceBox(trim, face, -0.02, len + 0.02, STRING[0], STRING[1], -0.02, 0.1);
  faceBox(trim, face, -0.06, len + 0.06, CORNICE[0], (CORNICE[0] + CORNICE[1]) / 2, -0.02, 0.12);
  faceBox(trim, face, -0.14, len + 0.14, (CORNICE[0] + CORNICE[1]) / 2, CORNICE[1], -0.02, 0.24);
  // Tile panels over each window group (pointed-arch heads reach 8.87 m) and the frieze under the cornice.
  for (const g of groups) {
    const w = g.count * 0.82 + (g.count - 1) * 0.34 + 0.5;
    tilePanel(mesh, batch, 'hero_tile_panel', face, g.s - w / 2, g.s + w / 2, 9.0, 9.28, 0.02, 0.14, seljuk, { mat: TRIM, w: 0.05, d: 0.03 });
  }
  tilePanel(mesh, batch, 'hero_tile_panel', face, 0.5, len - 0.5, FRIEZE[0], FRIEZE[1] - 0.08, 0.015, 0.16, seljuk);
  // Pilasters at the corners (the turrets stand on them) and between groups.
  faceBox(trim, face, 0, 0.55, PLINTH, CORNICE[0], -0.02, 0.08, false, false);
  faceBox(trim, face, len - 0.55, len, PLINTH, CORNICE[0], -0.02, 0.08, false, false);
  // Parapet inner face and coping; the stepped crest.
  const inner = face.offset(-0.3);
  wall(mesh, RENDER, inner, 0.3, len - 0.3, CORNICE[1] - 0.2, PARAPET, [], { back: true });
  faceBox(trim, face, -0.04, len + 0.04, PARAPET, PARAPET + 0.1, -0.36, 0.06);
  if (crest) {
    stepCrest(c, face, crest.s, crest.half);
    const d = face.dir(0, 0.95, -0.3);
    c.lights.push({ type: 'spot', position: face.p(crest.s, CANOPY_WALL + 0.25, 1.1), direction: d, kelvin: 3000, lumens: 2200, cone: { inner: 20, outer: 45 }, night: true, source: 'other' });
  }
  arches.forEach((a, k) => {
    if (k % 2 === 0) {
      c.lights.push({ type: 'point', position: face.p(a.s, 3.5, 1.4), kelvin: 3000, lumens: 1500, night: true, source: 'interior' });
    }
  });
}

/** Plinth band between the door notches. */
function plinth(batch: Batch, face: Face, len: number, ops: readonly Op[], yb: number): void {
  const b = batch.of('hero_plinth');
  let s = 0;
  for (const o of ops.filter((q) => q.door).sort((p, q) => p.s - q.s)) {
    const l = o.s - o.w / 2 - 0.14;
    if (l > s + 0.01) {
      faceBox(b, face, s, l, yb, PLINTH, -0.05, 0.06);
    }
    s = o.s + o.w / 2 + 0.14;
  }
  if (len > s + 0.01) {
    faceBox(b, face, s, len, yb, PLINTH, -0.05, 0.06);
  }
}

/**
 * Stepped Seljuk crest over the parapet, centred at s: `steps` steps of STEP up each side to a flat top, the outer
 * face flush with the wall, a coping on every tread and a tile band following the steps inside, a finial on top.
 */
function stepCrest(c: Ctx, face: Face, s: number, half: number, steps = 4): void {
  const { mesh, batch } = c;
  const tread = (half - 0.9) / steps;
  // Staircase outline: each tread starts at the riser of the step below.
  const outline2: V2[] = [[s - half, PARAPET]];
  for (let k = 0; k < steps; k++) {
    const x = s - half + k * tread;
    const y = PARAPET + (k + 1) * STEP;
    outline2.push([x, y], [x + tread, y]);
  }
  for (let k = steps - 1; k >= 0; k--) {
    const x = s + half - k * tread;
    const y = PARAPET + (k + 1) * STEP;
    outline2.push([x - tread, y], [x, y]);
  }
  outline2.push([s + half, PARAPET]);
  const ring = outline2.filter((p, k, a) => k === 0 || Math.hypot(p[0] - a[k - 1][0], p[1] - a[k - 1][1]) > 1e-4);
  shape(mesh, RENDER, face, ring, [], 0);
  shape(mesh, RENDER, face.offset(-0.3), [...ring].reverse(), [], 0, true);
  const trim = batch.of(TRIM);
  for (let k = 0; k < steps; k++) {
    const y = PARAPET + (k + 1) * STEP;
    const xl = s - half + k * tread;
    const xr = s + half - k * tread;
    // Treads (left and right; the top one spans the middle) with a small coping, and the risers' sides.
    if (k === steps - 1) {
      faceBox(trim, face, xl - 0.04, xr + 0.04, y, y + 0.08, -0.34, 0.06);
    } else {
      faceBox(trim, face, xl - 0.04, xl + tread + 0.04, y, y + 0.08, -0.34, 0.06);
      faceBox(trim, face, xr - tread - 0.04, xr + 0.04, y, y + 0.08, -0.34, 0.06);
    }
    const rb = batch.of(RENDER);
    const yLo = PARAPET + k * STEP;
    faceBox(rb, face, xl - 0.001, xl + 0.001, yLo, y, -0.3, 0, false, false);
    faceBox(rb, face, xr - 0.001, xr + 0.001, yLo, y, -0.3, 0, false, false);
  }
  // Tile band following the steps just inside the outline: the two tread ends of every step, the full top step.
  for (let k = 0; k < steps; k++) {
    const y = PARAPET + (k + 1) * STEP;
    const xl = s - half + k * tread + 0.25;
    const xr = s + half - k * tread - 0.25;
    const y0 = y - STEP + 0.1;
    const y1 = y - 0.14;
    if (k === steps - 1) {
      tilePanel(mesh, batch, 'hero_tile_panel', face, xl, xr, y0, y1, 0.02, 0.14, seljuk);
    } else {
      tilePanel(mesh, batch, 'hero_tile_panel', face, xl, xl + tread, y0, y1, 0.02, 0.14, seljuk);
      tilePanel(mesh, batch, 'hero_tile_panel', face, xr - tread, xr, y0, y1, 0.02, 0.14, seljuk);
    }
  }
  // Finial: a short pole with a ball.
  const top = PARAPET + steps * STEP + 0.08;
  const p = face.p(s, 0, -0.15);
  const [u, v] = face.f.local(p[0], p[2]);
  lathe(batch.of('hero_iron'), face.f, u, v, [
    [0.04, top],
    [0.03, top + 1.1],
    [0, top + 1.12],
  ], 6);
  lathe(batch.of(TRIM), face.f, u, v, [
    [0.001, top + 0.55],
    [0.12, top + 0.62],
    [0.14, top + 0.72],
    [0.1, top + 0.82],
    [0.001, top + 0.88],
  ], 10);
}

/** Octagonal corner turret with a pointed cap, engaged at a pavilion corner (plan point u, v). */
function turret(c: Ctx, u: number, v: number): void {
  const b = c.batch.of(TRIM);
  const r = 0.5;
  prism(b, c.f, ngon(u, v, r, 8, Math.PI / 8), CORNICE[0], PARAPET + 0.9, false);
  lathe(b, c.f, u, v, [
    [r + 0.1, PARAPET + 0.9],
    [r + 0.1, PARAPET + 1.05],
    [r * 0.9, PARAPET + 1.1],
  ], 8, Math.PI / 8);
  lathe(c.batch.of(RENDER), c.f, u, v, [
    [r * 0.9, PARAPET + 1.1],
    [r * 0.85, PARAPET + 1.6],
  ], 8, Math.PI / 8);
  lathe(c.batch.of('hero_lead'), c.f, u, v, [
    [r * 0.95, PARAPET + 1.6],
    [r * 0.55, PARAPET + 2.2],
    [r * 0.12, PARAPET + 2.75],
    [0, PARAPET + 2.9],
  ], 8, Math.PI / 8);
}

function pavilion(c: Ctx, u0: number, u1: number, west: boolean): void {
  const { mesh, f } = c;
  const wLen = u1 - u0;
  // End face (29.9 m): 7 arcade bays below; paired windows above, a triple under the crest.
  const end = west ? span(f, [u0, V0], [u0, V1]) : span(f, [u1, V1], [u1, V0]);
  const eLen = end.len;
  const eArches = arcadeOps(0.9, eLen - 0.9, 4.1, [3]);
  const eGroups = eArches.map((a, k) => ({ s: a.s, count: k === 3 ? 3 : 2 }));
  pavilionFace(c, end.face, eLen, eGroups, eArches, { s: eLen / 2, half: 3.6 });
  // Long-side faces (12.5–13.3 m): 3 bays below, 2 window groups above, a crest in the middle.
  const north = span(f, [u1, V0], [u0, V0]);
  const south = span(f, [u0, V1], [u1, V1]);
  for (const side of [north, south]) {
    const arches = arcadeOps(0.9, side.len - 0.9, 3.9);
    const groups = [
      { s: side.len * 0.27, count: 2 },
      { s: side.len * 0.73, count: 2 },
    ];
    pavilionFace(c, side.face, side.len, groups, arches, { s: side.len / 2, half: 2.9 });
  }
  // Inner face over the hall roof (plain, three windows), and the flat roof inside the parapets.
  const inner = west ? span(f, [u1, V1], [u1, V0]) : span(f, [u0, V0], [u0, V1]);
  wall(mesh, RENDER, inner.face, 0, inner.len, RANGE_TOP - 0.3, PARAPET);
  wall(mesh, RENDER, inner.face.offset(-0.3), 0.3, inner.len - 0.3, CORNICE[1] - 0.2, PARAPET, [], { back: true });
  faceBox(c.batch.of(TRIM), inner.face, -0.04, inner.len + 0.04, PARAPET, PARAPET + 0.1, -0.36, 0.06);
  hpoly(mesh, 'hero_floor', f, [
    [u0, V0],
    [u1, V0],
    [u1, V1],
    [u0, V1],
  ], CORNICE[1] - 0.15);
  for (const [u, v] of [
    [u0, V0],
    [u1, V0],
    [u1, V1],
    [u0, V1],
  ] as V2[]) {
    const outerU = west ? u === u0 : u === u1;
    if (outerU) {
      turret(c, u, v);
    }
  }
  void wLen;
}

/** Central single-storey range on both long sides, with the parapet over the canopy. */
function range(c: Ctx): void {
  const { mesh, batch, f } = c;
  for (const northSide of [true, false]) {
    const face = northSide ? span(f, [EAST.u0, V0], [WEST.u1, V0]) : span(f, [WEST.u1, V1], [EAST.u0, V1]);
    const len = face.len;
    const arches = onGround(c, face.face, arcadeOps(0.3, len - 0.3, 4.15, northSide ? [4] : [2, 6]));
    plinth(batch, face.face, len, arches, c.yb);
    wall(mesh, RENDER, face.face, 0, len, PLINTH, RANGE_TOP, arches);
    for (const o of arches) {
      dressOpening(mesh, batch, face.face, o, o.k === 'door' ? doorStyle : arcadeStyle(Math.round(o.s * 3) % 5 !== 0));
    }
    const trim = batch.of(TRIM);
    faceBox(trim, face.face, 0, len, PLINTH, PLINTH + 0.08, -0.02, 0.07);
    faceBox(trim, face.face, 0, len, STRING[0], STRING[1], -0.02, 0.1);
    faceBox(trim, face.face, -0.04, len + 0.04, RANGE_TOP, RANGE_TOP + 0.1, -0.36, 0.06);
    // Diamond tile plaques on the parapet between the canopy and the coping, over every pier.
    for (let k = 0; k <= arches.length; k++) {
      const s = k === 0 ? 0.35 : k === arches.length ? len - 0.35 : (arches[k - 1].s + arches[k].s) / 2;
      if (s < 0.5 || s > len - 0.5) {
        continue;
      }
      tilePanel(mesh, batch, 'hero_tile_panel', face.face, s - 0.22, s + 0.22, 5.05, 5.49, 0.02, 0.11, seljuk, { mat: TRIM, w: 0.04, d: 0.025 });
    }
    wall(mesh, RENDER, face.face.offset(-0.3), 0.3, len - 0.3, STRING[1], RANGE_TOP, [], { back: true });
    // A low central crest over the entrance bay.
    const mid = arches.find((a) => a.k === 'door') ?? arches[Math.floor(arches.length / 2)];
    stepCrestLow(c, face.face, mid.s, 2.3);
    for (let k = 0; k < arches.length; k += 3) {
      const p = face.face.p(arches[k].s, 3.4, 1.6);
      c.lights.push({ type: 'point', position: p, kelvin: 3000, lumens: 1500, night: true, source: 'interior' });
    }
  }
}

/** Two-step crest on the range parapet. */
function stepCrestLow(c: Ctx, face: Face, s: number, half: number): void {
  const { mesh, batch } = c;
  const y0 = RANGE_TOP;
  const tread = (half - 0.8) / 2;
  const ring: V2[] = [
    [s - half, y0],
    [s - half, y0 + 0.45],
    [s - half + tread, y0 + 0.45],
    [s - half + tread, y0 + 0.9],
    [s + half - tread, y0 + 0.9],
    [s + half - tread, y0 + 0.45],
    [s + half, y0 + 0.45],
    [s + half, y0],
  ];
  shape(mesh, RENDER, face, ring, [], 0);
  shape(mesh, RENDER, face.offset(-0.3), ring, [], 0, true);
  const trim = batch.of(TRIM);
  faceBox(trim, face, s - half - 0.04, s - half + tread + 0.04, y0 + 0.45, y0 + 0.53, -0.34, 0.06);
  faceBox(trim, face, s + half - tread - 0.04, s + half + 0.04, y0 + 0.45, y0 + 0.53, -0.34, 0.06);
  faceBox(trim, face, s - half + tread - 0.04, s + half - tread + 0.04, y0 + 0.9, y0 + 0.98, -0.34, 0.06);
  tilePanel(mesh, batch, 'hero_tile_panel', face, s - half + tread + 0.2, s + half - tread - 0.2, y0 + 0.12, y0 + 0.72, 0.02, 0.15, seljuk);
}

/** The market hall roof: lean-to roofs from the range parapets to the clerestory, the clerestory, the pitched roof. */
function hallRoof(c: Ctx, detail: boolean): void {
  const { mesh, batch, f } = c;
  const uA = WEST.u1;
  const uB = EAST.u0;
  const roof = 'hero_metal_roof';
  for (const sgn of [-1, 1]) {
    const vWall = sgn < 0 ? V0 + 0.3 : V1 - 0.3;
    const vC = sgn * CLERESTORY_V;
    // Lean-to plane from (vWall, RANGE_TOP - 0.2) up to (vC, CLERESTORY[0]).
    const b = batch.of(roof);
    const nY = Math.abs(vWall - vC);
    const nV = CLERESTORY[0] - (RANGE_TOP - 0.2);
    const nl = Math.hypot(nY, nV);
    const n = f.d(0, nY / nl, (sgn * nV) / nl);
    const slope = Math.hypot(nY, nV);
    b.flatQuad([f.p(uA, RANGE_TOP - 0.2, vWall), f.p(uB, RANGE_TOP - 0.2, vWall), f.p(uB, CLERESTORY[0], vC), f.p(uA, CLERESTORY[0], vC)], n, [
      [uA, slope],
      [uB, slope],
      [uB, 0],
      [uA, 0],
    ]);
    // Clerestory wall with a band of windows (one every 1.9 m).
    const cl = sgn < 0 ? span(f, [uB, vC], [uA, vC]) : span(f, [uA, vC], [uB, vC]);
    const wins: Opening[] = [];
    if (detail) {
      const nw = Math.floor((cl.len - 1) / 1.9);
      for (let k = 0; k < nw; k++) {
        wins.push({ s: 0.5 + (cl.len - 1) * ((k + 0.5) / nw), w: 1.2, y0: CLERESTORY[0] + 0.25, ys: CLERESTORY[1] - 0.25, kind: 'flat' });
      }
    }
    wall(mesh, RENDER, cl.face, 0, cl.len, CLERESTORY[0] - 0.05, CLERESTORY[1], wins);
    for (const o of wins) {
      shape(mesh, 'hero_glass_lit', cl.face, outline(o, 4), [], -0.08);
      const rb = batch.of(RENDER);
      faceBox(rb, cl.face, o.s - o.w / 2, o.s + o.w / 2, o.y0 - 0.06, o.y0, -0.1, 0.04);
    }
    // Pitched roof above the clerestory: from (vC + overhang) at CLERESTORY[1] to the ridge at v 0.
    const vO = vC + sgn * 0.35;
    const rise = RIDGE - CLERESTORY[1];
    const rn = Math.hypot(Math.abs(vO), rise);
    const nn = f.d(0, Math.abs(vO) / rn, (sgn * rise) / rn);
    batch.of(roof).flatQuad([f.p(uA, CLERESTORY[1] - 0.03, vO), f.p(uB, CLERESTORY[1] - 0.03, vO), f.p(uB, RIDGE, 0), f.p(uA, RIDGE, 0)], nn, [
      [uA, rn],
      [uB, rn],
      [uB, 0],
      [uA, 0],
    ]);
    // Eave fascia.
    const fb = batch.of(TRIM);
    box(fb, f, uA, uB, CLERESTORY[1] - 0.2, CLERESTORY[1], Math.min(vO, vO + sgn * 0.06), Math.max(vO, vO + sgn * 0.06), { bottom: true, top: false });
  }
  // Gable ends against the pavilions (above their parapets) and a ridge cap.
  for (const u of [uA, uB]) {
    const g = u === uA ? span(f, [u, V1], [u, V0]) : span(f, [u, V0], [u, V1]);
    const mid = g.len / 2;
    const w = CLERESTORY_V + 0.35;
    shape(mesh, RENDER, g.face, [
      [mid - w, CLERESTORY[1] - 0.03],
      [mid + w, CLERESTORY[1] - 0.03],
      [mid, RIDGE],
    ], [], 0.02);
  }
  box(batch.of('hero_lead'), f, uA, uB, RIDGE - 0.05, RIDGE + 0.12, -0.15, 0.15, { bottom: false, top: true });
  if (detail) {
    // Roof vents along the ridge.
    for (let u = uA + 4; u < uB - 3; u += 7.5) {
      box(batch.of('hero_lead'), f, u - 0.6, u + 0.6, RIDGE, RIDGE + 0.55, -0.45, 0.45);
    }
  }
}

/**
 * The canopy round the ground floor: a sloped metal roof from CANOPY_WALL at the walls to CANOPY_EDGE at CANOPY_D
 * out (mitred at the corners), timber-lined soffit, a fascia with a scalloped valance, curved iron brackets.
 */
function canopy(c: Ctx, detail: boolean): void {
  const { batch, f } = c;
  const u0 = WEST.u0;
  const u1 = EAST.u1;
  const D = CANOPY_D;
  const inner: V2[] = [
    [u0, V0],
    [u1, V0],
    [u1, V1],
    [u0, V1],
  ];
  const outer: V2[] = [
    [u0 - D, V0 - D],
    [u1 + D, V0 - D],
    [u1 + D, V1 + D],
    [u0 - D, V1 + D],
  ];
  const outN: V2[] = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  const drop = CANOPY_WALL - CANOPY_EDGE;
  const sl = Math.hypot(D, drop);
  for (let k = 0; k < 4; k++) {
    const a = inner[k];
    const b = inner[(k + 1) % 4];
    const A = outer[k];
    const B = outer[(k + 1) % 4];
    const [nu, nv] = outN[k];
    const n = f.d((nu * drop) / sl, D / sl, (nv * drop) / sl);
    const along = (p: V2): number => (nu === 0 ? p[0] : p[1]);
    batch.of('hero_metal_roof').flatQuad([f.p(a[0], CANOPY_WALL, a[1]), f.p(b[0], CANOPY_WALL, b[1]), f.p(B[0], CANOPY_EDGE, B[1]), f.p(A[0], CANOPY_EDGE, A[1])], n, [
      [along(a), 0],
      [along(b), 0],
      [along(B), sl],
      [along(A), sl],
    ]);
    const sy = 0.14;
    const nd = f.d((-nu * drop) / sl, -D / sl, (-nv * drop) / sl);
    batch.of('hero_ht_soffit').flatQuad([f.p(a[0], CANOPY_WALL - sy, a[1]), f.p(b[0], CANOPY_WALL - sy, b[1]), f.p(B[0], CANOPY_EDGE - sy, B[1]), f.p(A[0], CANOPY_EDGE - sy, A[1])], nd, [
      [along(a), 0],
      [along(b), 0],
      [along(B), sl],
      [along(A), sl],
    ]);
    // Fascia board with a scalloped valance under it.
    const fa = span(f, B, A);
    const fb = batch.of(GREEN);
    fb.flatQuad([fa.face.p(0, CANOPY_EDGE - 0.3, 0), fa.face.p(fa.len, CANOPY_EDGE - 0.3, 0), fa.face.p(fa.len, CANOPY_EDGE + 0.04, 0), fa.face.p(0, CANOPY_EDGE + 0.04, 0)], fa.face.n);
    fb.flatQuad([fa.face.p(0, CANOPY_EDGE - 0.3, -0.03), fa.face.p(fa.len, CANOPY_EDGE - 0.3, -0.03), fa.face.p(fa.len, CANOPY_EDGE - 0.14, -0.03), fa.face.p(0, CANOPY_EDGE - 0.14, -0.03)], [-fa.face.n[0], 0, -fa.face.n[2]]);
    if (detail) {
      const nsc = Math.floor(fa.len / 0.42);
      const vb = batch.of(GREEN);
      for (let q = 0; q < nsc; q++) {
        const s0 = (fa.len * q) / nsc;
        const s1 = (fa.len * (q + 1)) / nsc;
        const pts: Vec3[] = [];
        for (let j = 0; j <= 6; j++) {
          const tt = j / 6;
          const s = s0 + (s1 - s0) * tt;
          pts.push(fa.face.p(s, CANOPY_EDGE - 0.3 - 0.1 * Math.sin(Math.PI * tt), 0.001));
        }
        const top0 = vb.v(fa.face.p(s0, CANOPY_EDGE - 0.3, 0.001), fa.face.n);
        const ids = pts.map((p) => vb.v(p, fa.face.n));
        for (let j = 0; j < 6; j++) {
          vb.tri(top0, ids[j], ids[j + 1]);
        }
        const top1 = vb.v(fa.face.p(s1, CANOPY_EDGE - 0.3, 0.001), fa.face.n);
        vb.tri(top0, ids[6], top1);
      }
    }
  }
  if (!detail) {
    return;
  }
  // Brackets: at the piers of every face (between arches), about every 4 m.
  const iron = batch.of('hero_iron');
  for (let k = 0; k < 4; k++) {
    const a = inner[k];
    const b = inner[(k + 1) % 4];
    const fa = span(f, b, a);
    const nb = Math.max(2, Math.round(fa.len / 4.1));
    for (let q = 0; q <= nb; q++) {
      const s = 0.6 + ((fa.len - 1.2) * q) / nb;
      bracket(iron, fa.face, s);
    }
  }
}

/** Curved iron bracket from the wall (y 3.35) up under the canopy soffit, 2.3 m out: a quarter ellipse and a strut. */
function bracket(b: Builder, face: Face, s: number): void {
  const pts: [number, number][] = [];
  const out = 2.3;
  const yLow = 3.35;
  const soff = (d: number): number => CANOPY_WALL - 0.15 - ((CANOPY_WALL - CANOPY_EDGE) * d) / CANOPY_D;
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * (Math.PI / 2);
    const d = out * (1 - Math.cos(a));
    const y = yLow + (soff(d) - yLow) * Math.sin(a);
    pts.push([d, y]);
  }
  const plate = (list: [number, number][], w: number, th: number): void => {
    for (let k = 0; k + 1 < list.length; k++) {
      const [d0, y0] = list[k];
      const [d1, y1] = list[k + 1];
      const l = Math.hypot(d1 - d0, y1 - y0) || 1;
      const pd = (-(y1 - y0) / l) * (th / 2);
      const py = ((d1 - d0) / l) * (th / 2);
      for (const side of [-1, 1]) {
        const ss = s + side * (w / 2);
        const nrm: Vec3 = [face.r[0] * side, 0, face.r[2] * side];
        b.flatQuad([face.p(ss, y0 - py, d0 - pd), face.p(ss, y1 - py, d1 - pd), face.p(ss, y1 + py, d1 + pd), face.p(ss, y0 + py, d0 + pd)], nrm);
      }
      const up = face.dir(0, (d1 - d0) / l, -(y1 - y0) / l);
      b.flatQuad([face.p(s - w / 2, y0 + py, d0 + pd), face.p(s + w / 2, y0 + py, d0 + pd), face.p(s + w / 2, y1 + py, d1 + pd), face.p(s - w / 2, y1 + py, d1 + pd)], up);
      b.flatQuad([face.p(s - w / 2, y0 - py, d0 - pd), face.p(s + w / 2, y0 - py, d0 - pd), face.p(s + w / 2, y1 - py, d1 - pd), face.p(s - w / 2, y1 - py, d1 - pd)], [-up[0], -up[1], -up[2]]);
    }
  };
  plate(pts, 0.05, 0.07);
  // Straight top rail under the soffit and a scroll ring in the corner.
  plate(
    [
      [0, soff(0)],
      [out + 0.3, soff(out + 0.3)],
    ],
    0.05,
    0.06,
  );
  const ring: [number, number][] = [];
  for (let k = 0; k <= 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    ring.push([0.55 + Math.cos(a) * 0.28, soff(0.55) - 0.4 + Math.sin(a) * 0.28]);
  }
  plate(ring, 0.03, 0.035);
}

/** LOD1: massing, the canopy slab and flat window shapes 2 cm proud of the walls. */
function lod1(mesh: TileMesh, batch: Batch, f: Frame, yb: number): void {
  const b = batch.of(RENDER);
  box(b, f, WEST.u0, WEST.u1, yb, PARAPET, V0, V1);
  box(b, f, EAST.u0, EAST.u1, yb, PARAPET, V0, V1);
  box(b, f, WEST.u1, EAST.u0, yb, RANGE_TOP, V0, V1);
  for (const [u0, u1] of [
    [WEST.u0, WEST.u1],
    [EAST.u0, EAST.u1],
  ]) {
    for (const face of [span(f, [u1, V0], [u0, V0]), span(f, [u0, V1], [u1, V1])]) {
      for (const a of arcadeOps(0.9, face.len - 0.9, 3.9)) {
        shape(mesh, 'hero_glass', face.face, outline(a, 4), [], 0.02);
      }
      for (const s of [face.len * 0.27, face.len * 0.73]) {
        for (const o of upperGroup(s, 2, true)) {
          shape(mesh, 'hero_glass_lit', face.face, outline(o, 4), [], 0.02);
        }
      }
    }
  }
  for (const end of [span(f, [WEST.u0, V0], [WEST.u0, V1]), span(f, [EAST.u1, V1], [EAST.u1, V0])]) {
    for (const a of arcadeOps(0.9, end.len - 0.9, 4.1)) {
      shape(mesh, 'hero_glass', end.face, outline(a, 4), [], 0.02);
      for (const o of upperGroup(a.s, 2, true)) {
        shape(mesh, 'hero_glass_lit', end.face, outline(o, 4), [], 0.02);
      }
    }
  }
  for (const face of [span(f, [EAST.u0, V0], [WEST.u1, V0]), span(f, [WEST.u1, V1], [EAST.u0, V1])]) {
    for (const a of arcadeOps(0.3, face.len - 0.3, 4.15)) {
      shape(mesh, 'hero_glass', face.face, outline(a, 4), [], 0.02);
    }
  }
}
