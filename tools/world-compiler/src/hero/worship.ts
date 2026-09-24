/**
 * Massing of the two places of worship on the strip whose OSM outlines format 0 drops for their single part:
 *
 * - Sultan III. Mustafa (İskele) Camii (w102190093, 1761; hero-spots 'iskele-camii-kadikoy'): square cut-stone prayer
 *   hall under a single lead dome on an octagonal drum (the OSM dome part w694298377, 11.2 m across, top about 15 m),
 *   three windows per side wall (the middle one higher), a last-congregation portico with three pointed arches and
 *   small domes on the entrance side (away from the qibla axis, 119°), lower annexes filling the rest of the outline,
 *   and a single-balcony stone minaret (about 34 m) at the portico corner.
 * - Aya Efimia (w694298362; spec section 3, c07 / c08): the church body as a rendered block under a low grey roof, and
 *   the stone bell tower of the OSM part w694298363 (belfry with arched openings, octagonal lead dome and cross, about
 *   21 m) rising above the precinct roofs.
 */
import type { LightInput } from '../lights';
import { LOD0, LOD1 } from '../mesh';
import type { TileContext } from '../registry';
import { Batch, box, domeProfile, dressOpening, faceBox, Frame, hippedRoof, hpoly, lathe, ngon, type Opening, outline, prism, shape, span, type V2, wall, type WindowStyle } from './kit';
import type { HeroBuild } from './pier1926';

const r2 = (v: number): number => Math.round(v * 100) / 100;

function centroid(ring: readonly number[]): [number, number] {
  const n = ring.length / 2;
  let x = 0;
  let z = 0;
  for (let k = 0; k < n; k++) {
    x += ring[k * 2];
    z += ring[k * 2 + 1];
  }
  return [x / n, z / n];
}

/** Sutherland–Hodgman clip of a plan polygon to the half-plane a·u + b·v <= c. */
function clipHalf(poly: readonly V2[], a: number, b: number, c: number): V2[] {
  const out: V2[] = [];
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k];
    const q = poly[(k + 1) % poly.length];
    const dp = a * p[0] + b * p[1] - c;
    const dq = a * q[0] + b * q[1] - c;
    if (dp <= 0) {
      out.push(p);
    }
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

function area(poly: readonly V2[]): number {
  let s = 0;
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k];
    const q = poly[(k + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

/** Plain block over a plan polygon: walls from yb to h (one face per edge), flat roof; `shops` cuts a row of shop
 * windows and doors (LOD0) into every edge longer than 3 m. */
function block(t: TileContext, batch: Batch, f: Frame, poly: readonly V2[], yb: number, h: number, wallMat: string, roofMat: string, shops = false): void {
  const pts = area(poly) < 0 ? [...poly].reverse() : [...poly];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % pts.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) {
      continue;
    }
    // Counter-clockwise in (u, v): the outside is to the right of a -> b; span() puts the normal on the left, so
    // walk the edge backwards.
    const e = span(f, b, a);
    const ops: Opening[] = [];
    if (shops && e.len > 3) {
      const nShop = Math.floor(e.len / 3.1);
      for (let i = 0; i < nShop; i++) {
        const sc = (e.len * (i + 0.5)) / nShop;
        ops.push(i % 3 === 1 ? { s: sc, w: 1.0, y0: 0, ys: 2.4, kind: 'flat', door: true } : { s: sc, w: 2.1, y0: 0.45, ys: 2.6, kind: 'flat' });
      }
    }
    t.mesh.withLod(LOD0, () => {
      wall(t.mesh, wallMat, e.face, 0, e.len, yb, h, ops);
      for (const o of ops) {
        dressOpening(t.mesh, batch, e.face, o, { wall: wallMat, frame: 'hero_iron', pane: o.door ? 'hero_door' : 'hero_glass_lit', reveal: 0.25, frameW: 0.05, mullions: o.door ? 0 : 1 });
      }
      faceBox(batch.of('hero_stone_trim'), e.face, -0.08, e.len + 0.08, h - 0.25, h, -0.02, 0.12);
    });
    t.mesh.withLod(LOD1, () => {
      wall(t.mesh, wallMat, e.face, 0, e.len, yb, h);
      for (const o of ops) {
        shape(t.mesh, 'hero_glass_lit', e.face, outline(o, 4), [], 0.02);
      }
    });
  }
  hpoly(t.mesh, roofMat, f, pts, h);
}

/* ------------------------------------------------------------------------------------------------------------- */
/* İskele Camii                                                                                                    */
/* ------------------------------------------------------------------------------------------------------------- */

const HALL = 6.9;
const HALL_H = 8.2;
const PORTICO_U = -13.6;
const PORTICO_H = 6.0;

export function buildIskeleCamii(t: TileContext, outlineRing: readonly number[], domeRing: readonly number[], bottomY: number): HeroBuild {
  const [ox, oz] = centroid(domeRing);
  const heading = 119;
  const probe = new Frame(ox, oz, 0, heading);
  const g = (u: number, v: number): number => {
    const p = probe.p(u, 0, v);
    return t.area.heights.at(p[0], p[2]);
  };
  const floorY = r2(Math.max(g(PORTICO_U - 1, 0), g(0, HALL + 1), g(0, -HALL - 1)));
  const f = new Frame(ox, oz, floorY, heading);
  const yb = bottomY - floorY;
  const mesh = t.mesh;
  const n = outlineRing.length / 2;
  const plan: V2[] = [];
  for (let k = 0; k < n; k++) {
    plan.push(f.local(outlineRing[k * 2], outlineRing[k * 2 + 1]));
  }
  const stone = 'hero_stone';
  const trim = 'hero_stone_trim';
  const lead = 'hero_lead';
  const lights: LightInput[] = [];
  const winSt: WindowStyle = { wall: stone, frame: 'hero_iron', pane: 'hero_glass_lit', reveal: 0.6, frameW: 0.05, mullions: 2, transom: true, radials: 2, sill: { mat: trim, depth: 0.08, h: 0.1 }, surround: { mat: trim, w: 0.14, d: 0.04 } };
  const lowerSt: WindowStyle = { wall: stone, frame: 'hero_iron', pane: 'hero_glass', reveal: 0.55, frameW: 0.04, mullions: 3, transom: false, sill: { mat: trim, depth: 0.1, h: 0.12 }, surround: { mat: trim, w: 0.2, d: 0.06 } };
  const doorSt: WindowStyle = { wall: stone, frame: 'hero_frame', pane: 'hero_door', fan: 'hero_glass_lit', reveal: 0.5, frameW: 0.08, transom: true, surround: { mat: trim, w: 0.18, d: 0.05 } };

  // Annexes: the outline outside the hall and portico, as 4.2 m cut-stone blocks with flat lead roofs.
  const annexes = [clipHalf(plan, 1, 0, PORTICO_U), clipHalf(plan, -1, 0, -HALL), clipHalf(clipHalf(clipHalf(plan, 0, 1, -HALL), -1, 0, -PORTICO_U), 1, 0, HALL)].filter((p) => p.length >= 3 && Math.abs(area(p)) > 6);

  const batch = new Batch(mesh);
  for (const a of annexes) {
    block(t, batch, f, a, yb, 3.8, stone, lead, true);
  }
  // Prayer hall: four walls with the side windows (middle one higher) and upper windows; the door on the portico side.
  mesh.withLod(LOD0, () => {
    const b0 = new Batch(mesh);
    const faces = [span(f, [HALL, HALL], [HALL, -HALL]), span(f, [-HALL, -HALL], [-HALL, HALL]), span(f, [-HALL, HALL], [HALL, HALL]), span(f, [HALL, -HALL], [-HALL, -HALL])];
    faces.forEach((e, i) => {
      const c = e.len / 2;
      // Ottoman scheme: rectangular lower windows in stone frames, pointed-arch upper windows with iron grilles.
      const ops: Opening[] = [
        { s: c - 4.0, w: 1.2, y0: 1.2, ys: 3.3, kind: 'flat' },
        { s: c, w: 1.2, y0: 1.2, ys: 3.3, kind: 'flat' },
        { s: c + 4.0, w: 1.2, y0: 1.2, ys: 3.3, kind: 'flat' },
        { s: c - 2.2, w: 0.95, y0: 5.4, ys: 6.7, kind: 'pointed', rise: 0.75 },
        { s: c + 2.2, w: 0.95, y0: 5.4, ys: 6.7, kind: 'pointed', rise: 0.75 },
      ];
      if (i === 1) {
        ops.splice(1, 1, { s: c, w: 1.5, y0: 0, ys: 2.8, kind: 'pointed', rise: 1.0, door: true });
      }
      wall(mesh, stone, e.face, 0, e.len, yb, HALL_H, ops);
      for (const o of ops) {
        dressOpening(mesh, b0, e.face, o, o.door ? doorSt : o.kind === 'flat' ? lowerSt : winSt);
      }
    });
    b0.flush();
  });
  mesh.withLod(LOD1, () => {
    const b1 = new Batch(mesh);
    box(b1.of(stone), f, -HALL, HALL, yb, HALL_H, -HALL, HALL);
    b1.flush();
  });
  const s = batch.of(stone);
  const tr = batch.of(trim);
  // Cornice, octagonal transition with corner weights, drum, dome and alem.
  box(tr, f, -HALL - 0.2, HALL + 0.2, HALL_H, HALL_H + 0.3, -HALL - 0.2, HALL + 0.2, { bottom: true, top: true });
  prism(s, f, ngon(0, 0, HALL * 1.02, 8, Math.PI / 8), HALL_H + 0.3, HALL_H + 1.5);
  for (const [cu, cv] of [
    [HALL - 0.6, HALL - 0.6],
    [-HALL + 0.6, HALL - 0.6],
    [HALL - 0.6, -HALL + 0.6],
    [-HALL + 0.6, -HALL + 0.6],
  ]) {
    lathe(batch.of(lead), f, cu, cv, [
      [0.55, HALL_H + 0.3],
      [0.55, HALL_H + 1.2],
      ...domeProfile(0.55, 0.7, HALL_H + 1.2, 4).slice(1),
    ], 8);
  }
  lathe(s, f, 0, 0, [
    [6.0, HALL_H + 1.5],
    [6.0, HALL_H + 2.3],
  ], 16, 0, true);
  lathe(batch.of(lead), f, 0, 0, [[6.15, HALL_H + 2.3], ...domeProfile(6.15, 4.4, HALL_H + 2.3, 10).slice(1)], 28);
  lathe(batch.of('hero_iron'), f, 0, 0, [
    [0.05, HALL_H + 6.6],
    [0.16, HALL_H + 6.9],
    [0.05, HALL_H + 7.2],
    [0.13, HALL_H + 7.45],
    [0, HALL_H + 7.9],
  ], 8);
  // Last-congregation portico: three pointed arches (glazed today) under three small domes.
  const pu0 = PORTICO_U;
  const front = span(f, [pu0, -HALL], [pu0, HALL]);
  const arches: Opening[] = [-4.3, 0, 4.3].map((d) => ({ s: front.len / 2 + d, w: 3.2, y0: 0, ys: 3.2, kind: 'pointed' as const, rise: 1.9, door: true }));
  mesh.withLod(LOD0, () => {
    const b0 = new Batch(mesh);
    wall(mesh, stone, front.face, 0, front.len, yb, PORTICO_H, arches);
    for (const o of arches) {
      dressOpening(mesh, b0, front.face, o, { wall: stone, frame: 'hero_iron', pane: 'hero_glass_lit', reveal: 0.35, frameW: 0.06, mullions: 2, transom: true, surround: { mat: trim, w: 0.2, d: 0.05 } });
    }
    for (const [a, b] of [
      [
        [pu0, HALL],
        [-HALL, HALL],
      ],
      [
        [-HALL, -HALL],
        [pu0, -HALL],
      ],
    ] as [V2, V2][]) {
      const e = span(f, a, b);
      wall(mesh, stone, e.face, 0, e.len, yb, PORTICO_H);
    }
    b0.flush();
  });
  mesh.withLod(LOD1, () => {
    const b1 = new Batch(mesh);
    box(b1.of(stone), f, pu0, -HALL, yb, PORTICO_H, -HALL, HALL);
    for (const o of arches) {
      shape(mesh, 'hero_glass_lit', front.face, outline(o, 6), [], 0.02);
    }
    b1.flush();
  });
  box(tr, f, pu0 - 0.15, -HALL, PORTICO_H, PORTICO_H + 0.25, -HALL - 0.15, HALL + 0.15, { bottom: true, top: true });
  for (const dv of [-4.2, 0, 4.2]) {
    const cu = (pu0 + -HALL) / 2;
    lathe(s, f, cu, dv, [
      [1.8, PORTICO_H + 0.25],
      [1.8, PORTICO_H + 0.6],
    ], 8, Math.PI / 8);
    lathe(batch.of(lead), f, cu, dv, [[1.9, PORTICO_H + 0.6], ...domeProfile(1.9, 1.2, PORTICO_H + 0.6, 6).slice(1)], 16);
  }
  hpoly(mesh, lead, f, [
    [pu0, -HALL],
    [-HALL, -HALL],
    [-HALL, HALL],
    [pu0, HALL],
  ], PORTICO_H + 0.26);
  // Minaret at the portico's right-hand corner (facing the qibla): square base, polygonal shaft, one şerefe.
  const mu = -HALL - 0.1;
  const mv = HALL + 0.5;
  box(s, f, mu - 1.5, mu + 1.5, yb, 7.5, mv - 1.5, mv + 1.5);
  prism(s, f, ngon(mu, mv, 1.55, 12, Math.PI / 12), 7.5, 8.6);
  const shaft = batch.of(stone);
  lathe(shaft, f, mu, mv, [
    [1.3, 8.6],
    [1.2, 24.6],
  ], 12, Math.PI / 12, true);
  lathe(tr, f, mu, mv, [
    [1.2, 24.6],
    [1.5, 25.0],
    [1.8, 25.35],
    [2.0, 25.6],
    [2.0, 25.75],
  ], 12, Math.PI / 12, true);
  hpoly(mesh, trim, f, ngon(mu, mv, 2.0, 12, Math.PI / 12), 25.75);
  lathe(tr, f, mu, mv, [
    [2.0, 25.75],
    [2.0, 26.75],
  ], 12, Math.PI / 12, true);
  lathe(shaft, f, mu, mv, [
    [1.05, 26.0],
    [1.0, 29.6],
  ], 12, Math.PI / 12, true);
  lathe(batch.of(lead), f, mu, mv, [
    [1.15, 29.6],
    [0.9, 31.2],
    [0.45, 33.2],
    [0.05, 34.2],
    [0, 34.4],
  ], 12, Math.PI / 12, true);
  lathe(batch.of('hero_iron'), f, mu, mv, [
    [0.04, 34.3],
    [0.12, 34.6],
    [0.04, 34.9],
    [0, 35.4],
  ], 6);
  batch.flush();
  // Night: warm-white floodlights on the dome and the minaret, a lit şerefe ring.
  for (const [cu, cv] of [
    [HALL + 3, HALL + 3],
    [HALL + 3, -HALL - 3],
    [pu0 - 3, -HALL - 2],
  ]) {
    const d = f.d(-cu, 18, -cv);
    const l = Math.hypot(...d);
    lights.push({ type: 'spot', position: f.p(cu, 0.6, cv), direction: [d[0] / l, d[1] / l, d[2] / l], kelvin: 3300, lumens: 6000, cone: { inner: 12, outer: 24 }, night: true, source: 'other' });
  }
  lights.push({ type: 'spot', position: f.p(mu + 3, 0.6, mv + 2.5), direction: norm(f.d(-3, 26, -2.5)), kelvin: 3300, lumens: 4000, cone: { inner: 4, outer: 9 }, night: true, source: 'other' });
  lights.push({ type: 'point', position: f.p(mu, 26.3, mv), kelvin: 3000, lumens: 1500, night: true, source: 'lamp' });
  for (const l of lights) {
    t.lights.add({ ...l, ref: 'hero/iskeleCamii' });
  }
  return {
    topY: r2(floorY + 34.4),
    floorY,
    lights: lights.length,
    instances: 0,
    notes: { origin: [r2(ox), r2(oz)], headingDeg: heading, hallSide: 2 * HALL, domeTopY: r2(floorY + HALL_H + 2.3 + 4.4), minaretTopY: r2(floorY + 35.4), annexes: annexes.length },
  };
}

function norm(d: [number, number, number]): [number, number, number] {
  const l = Math.hypot(...d);
  return [d[0] / l, d[1] / l, d[2] / l];
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Aya Efimia                                                                                                      */
/* ------------------------------------------------------------------------------------------------------------- */

const CHURCH_H = 8.6;

export function buildAyaEfimia(t: TileContext, churchRing: readonly number[], towerRing: readonly number[], bottomY: number): HeroBuild {
  const [ox, oz] = centroid(churchRing);
  const heading = 106;
  const n = churchRing.length / 2;
  let maxG = -Infinity;
  for (let k = 0; k < n; k++) {
    maxG = Math.max(maxG, t.area.heights.at(churchRing[k * 2], churchRing[k * 2 + 1]));
  }
  const floorY = r2(maxG);
  const f = new Frame(ox, oz, floorY, heading);
  const yb = bottomY - floorY;
  const mesh = t.mesh;
  const plan: V2[] = [];
  for (let k = 0; k < n; k++) {
    plan.push(f.local(churchRing[k * 2], churchRing[k * 2 + 1]));
  }
  const pts = area(plan) < 0 ? [...plan].reverse() : plan;
  const batch = new Batch(mesh);
  const winSt: WindowStyle = { wall: 'hero_render_yellow', frame: 'hero_frame_white', pane: 'hero_glass', reveal: 0.35, frameW: 0.06, mullions: 1, transom: true, sill: { mat: 'hero_render_yellow_trim', depth: 0.06, h: 0.08 } };
  // Church body: yellow render, tall arched windows, a cornice and a hipped Marseille-tile roof over the main mass.
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % pts.length];
    const e = span(f, b, a);
    if (e.len < 0.05) {
      continue;
    }
    const ops: Opening[] = [];
    const nWin = Math.floor((e.len - 1.2) / 2.6);
    for (let i = 0; i < nWin; i++) {
      ops.push({ s: (e.len * (i + 0.5)) / nWin, w: 1.0, y0: 2.2, ys: 5.0, kind: 'round' });
    }
    mesh.withLod(LOD0, () => {
      wall(mesh, 'hero_render_yellow', e.face, 0, e.len, yb, CHURCH_H, ops);
      for (const o of ops) {
        dressOpening(mesh, batch, e.face, o, winSt);
      }
    });
    mesh.withLod(LOD1, () => {
      wall(mesh, 'hero_render_yellow', e.face, 0, e.len, yb, CHURCH_H);
      for (const o of ops) {
        shape(mesh, 'hero_glass', e.face, outline(o, 6), [], 0.02);
      }
    });
    faceBox(batch.of('hero_render_yellow_trim'), e.face, -0.12, e.len + 0.12, CHURCH_H - 0.35, CHURCH_H, -0.02, 0.16);
    faceBox(batch.of('hero_render_yellow_trim'), e.face, -0.05, e.len + 0.05, yb, 0.6, -0.02, 0.05, false, false);
  }
  hpoly(mesh, 'hero_roof_tile', f, pts, CHURCH_H + 0.05);
  hippedRoof(mesh, 'hero_roof_tile', 'hero_render_yellow_trim', f, -9.1, 6.5, -5.4, 9.8, CHURCH_H + 0.12, 7.6 * Math.tan((25 * Math.PI) / 180), 0.45, 0.14, batch);
  // Bell tower on the OSM part: square stone shaft, belfry with arched openings, octagonal drum, lead dome, cross.
  const [tcx, tcz] = centroid(towerRing);
  const [tu, tv] = f.local(tcx, tcz);
  const half = 1.7;
  const st = batch.of('hero_stone');
  const tr = batch.of('hero_stone_trim');
  box(st, f, tu - half, tu + half, CHURCH_H - 0.5, 13.4, tv - half, tv + half);
  box(tr, f, tu - half - 0.15, tu + half + 0.15, 13.4, 13.65, tv - half - 0.15, tv + half + 0.15, { bottom: true, top: true });
  // Belfry: four corner piers and arched openings (dark louvres behind).
  const bel = 13.65;
  const belTop = 17.0;
  mesh.withLod(LOD0, () => {
    for (const [a, b] of [
      [
        [tu - half + 0.1, tv + half - 0.1],
        [tu + half - 0.1, tv + half - 0.1],
      ],
      [
        [tu + half - 0.1, tv + half - 0.1],
        [tu + half - 0.1, tv - half + 0.1],
      ],
      [
        [tu + half - 0.1, tv - half + 0.1],
        [tu - half + 0.1, tv - half + 0.1],
      ],
      [
        [tu - half + 0.1, tv - half + 0.1],
        [tu - half + 0.1, tv + half - 0.1],
      ],
    ] as [V2, V2][]) {
      const e = span(f, a, b);
      const o: Opening = { s: e.len / 2, w: 1.3, y0: bel + 0.3, ys: 15.9, kind: 'round' };
      wall(mesh, 'hero_stone', e.face, 0, e.len, bel, belTop, [o]);
      dressOpening(mesh, batch, e.face, o, { wall: 'hero_stone', frame: 'hero_iron', pane: 'hero_glass', reveal: 0.35, frameW: 0.05, mullions: 2, surround: { mat: 'hero_stone_trim', w: 0.12, d: 0.05 } });
    }
  });
  mesh.withLod(LOD1, () => {
    box(batch.of('hero_stone'), f, tu - half + 0.1, tu + half - 0.1, bel, belTop, tv - half + 0.1, tv + half - 0.1);
  });
  box(tr, f, tu - half - 0.2, tu + half + 0.2, belTop, belTop + 0.3, tv - half - 0.2, tv + half + 0.2, { bottom: true, top: true });
  prism(st, f, ngon(tu, tv, 1.35, 8, Math.PI / 8), belTop + 0.3, belTop + 1.3);
  lathe(batch.of('hero_lead'), f, tu, tv, [[1.5, belTop + 1.3], ...domeProfile(1.5, 1.6, belTop + 1.3, 6).slice(1)], 8, Math.PI / 8);
  const cross = batch.of('hero_iron');
  box(cross, f, tu - 0.05, tu + 0.05, belTop + 2.85, belTop + 4.0, tv - 0.05, tv + 0.05);
  box(cross, f, tu - 0.35, tu + 0.35, belTop + 3.45, belTop + 3.55, tv - 0.05, tv + 0.05);
  batch.flush();
  const lights: LightInput[] = [];
  for (const [du, dv] of [
    [4, 4],
    [-4, -4],
  ]) {
    lights.push({ type: 'spot', position: f.p(tu + du, CHURCH_H + 0.3, tv + dv), direction: norm(f.d(-du, 9, -dv)), kelvin: 3000, lumens: 2500, cone: { inner: 10, outer: 20 }, night: true, source: 'other' });
  }
  for (const l of lights) {
    t.lights.add({ ...l, ref: 'hero/ayaEfimia' });
  }
  return {
    topY: r2(floorY + belTop + 4.0),
    floorY,
    lights: lights.length,
    instances: 0,
    notes: { origin: [r2(ox), r2(oz)], headingDeg: heading, bodyTopY: r2(floorY + CHURCH_H), towerTopY: r2(floorY + belTop + 4.0) },
  };
}
