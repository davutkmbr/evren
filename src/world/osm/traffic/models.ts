/**
 * Procedural vehicle models of the traffic layer, three LODs each (see catalog.ts Model). Bodies are parametric
 * lofts (body.ts); head / tail light clusters, grilles, intakes, bumpers, number plates, rear glass and bus / tram
 * doors are conforming patches laid onto the body surface, so they read at close range and light up at night.
 * Proportions follow the vehicles that fill İstanbul's streets: Fiat Egea / Toyota Corolla sedans, Renault Clio /
 * Hyundai i20 hatchbacks, Dacia Duster-class SUVs, the yellow Fiat Doblo taxi, Doblo Cargo / Transit Connect vans,
 * Ford Transit / Mercedes Sprinter vans and dolmuş minibuses, 12 m low-floor city buses (Mercedes Citaro / Otokar
 * Kent class), Isuzu NPR-class light trucks, courier scooters, the Alstom Citadis X04 of T1 and the İstiklal
 * nostalgic tram. LOD0 (close) carries every detail, LOD1 simplified patches, LOD2 the shell and lamps only.
 */
import type * as THREE from 'three';
import { AMBER, Body, type BodySpec, frontPatch, GLASS, HEAD, type Outline, PLATE, PLATE_BLUE, rearPatch, RIM, sidePatch, TAIL, TRIM, TYRE, archPatch } from './body';
import { MODEL_LENGTH, MODEL_WIDTH, Model } from './catalog';
import { face, ModelBuilder, VehicleMat as M, type Face, type Rgb } from './model-builder';

export const LOD_COUNT = 3;

const CHROME: Rgb = [0.7, 0.71, 0.73];
const DARK: Rgb = [0.05, 0.052, 0.056];

const trimF = (): Face => face(M.Trim, TRIM);
const glassF = (): Face => face(M.Glass, GLASS);

/** Patch resolution per LOD (grid cells across / up). */
function res(lod: number, na: number, nb: number): [number, number] {
  return lod === 0 ? [na, nb] : lod === 1 ? [Math.max(1, Math.ceil(na / 2)), Math.max(1, Math.ceil(nb / 2))] : [1, 1];
}

/* ------------------------------------------------------------------ */
/* Shared parts                                                        */
/* ------------------------------------------------------------------ */

/** Wheels: tyre with sidewall, alloy rim with spoke openings and hub (LOD0), plain tyre + rim disc (LOD1). */
function wheels(mb: ModelBuilder, body: Body, lod: number, twinRear = false, rimRgb: Rgb = RIM): void {
  if (lod >= 2) {
    return;
  }
  const spec = body.spec;
  const seg = lod === 0 ? 18 : 8;
  const tyre = face(M.Rubber, TYRE);
  const rim = face(M.Chrome, rimRgb);
  const hole = face(M.Trim, DARK);
  const R = spec.wheelR;
  const hw = body.hw - 0.03;
  for (const a of spec.axles) {
    const z = a - body.L / 2;
    const twin = twinRear && a === spec.axles[spec.axles.length - 1];
    for (const s of [-1, 1]) {
      const xo = s * hw;
      const xi = s * (hw - spec.wheelW * (twin ? 2.05 : 1));
      // LOD0 closes the outer side with the sidewall ring and the recessed rim; LOD1 with a flat cap + rim disc
      mb.cylinderX(Math.min(xo, xi), Math.max(xo, xi), R, z, R, seg, tyre, tyre, lod === 0 ? 0 : s > 0 ? 2 : 1);
      if (lod === 0) {
        // sidewall, rim, spoke openings, hub
        mb.ringX(xo, R, z, R * 0.64, R, seg, s, tyre);
        mb.ringX(xo - s * 0.006, R, z, R * 0.2, R * 0.645, seg, s, rim);
        const spokes = 5;
        for (let k = 0; k < spokes; k++) {
          sector(mb, xo - s * 0.004, R, z, R * 0.27, R * 0.58, ((k + 0.5) / spokes) * Math.PI * 2 - 0.3, ((k + 0.5) / spokes) * Math.PI * 2 + 0.3, s, hole);
        }
        mb.ringX(xo - s * 0.003, R, z, 0, R * 0.205, 10, s, face(M.Chrome, [0.45, 0.46, 0.48]));
      } else {
        mb.ringX(xo + s * 0.002, R, z, 0, R * 0.64, seg, s, rim);
      }
    }
  }
}

/** Annular sector in the plane x = const facing s (spoke openings). */
function sector(mb: ModelBuilder, x: number, cy: number, cz: number, r0: number, r1: number, a0: number, a1: number, s: number, f: Face): void {
  const n = 3;
  const base = mb.pos.length / 3;
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    mb.vertex(x, cy + c * r0, cz + sn * r0, s, 0, 0, f);
    mb.vertex(x, cy + c * r1, cz + sn * r1, s, 0, 0, f);
  }
  for (let i = 0; i < n; i++) {
    const a = base + i * 2;
    if (s > 0) {
      mb.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    } else {
      mb.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
}

/** Side mirrors (body-coloured housing, black arm) at station u, height y. */
function mirrors(mb: ModelBuilder, body: Body, u: number, y: number, paint: Face, lod: number): void {
  if (lod >= 2) {
    return;
  }
  const w = body.width(u, y);
  const z = u - body.L / 2;
  for (const s of [-1, 1]) {
    const x = s * (Math.max(w, body.hw * 0.9) + 0.09);
    mb.box(x, y + 0.02, z + 0.04, 0.09, 0.065, 0.05, paint);
    if (lod === 0) {
      mb.box(x - s * 0.07, y - 0.02, z + 0.02, 0.05, 0.015, 0.025, trimF());
      mb.box(x, y + 0.02, z + 0.095, 0.075, 0.05, 0.004, glassF(), 16);
    }
  }
}

/** Turkish number plate (white, blue TR band on the left) centred at height y on the front or rear face. */
function plate(mb: ModelBuilder, body: Body, y: number, rear: boolean, lod: number, w = 0.52, h = 0.11): void {
  if (lod >= 2) {
    return;
  }
  const o: Outline = { x0: -w / 2, x1: w / 2, y0: y - h / 2, y1: y + h / 2 };
  const band: Outline = rear ? { x0: w / 2 - 0.045, x1: w / 2, y0: y - h / 2, y1: y + h / 2 } : { x0: -w / 2, x1: -w / 2 + 0.045, y0: y - h / 2, y1: y + h / 2 };
  const put = rear ? rearPatch : frontPatch;
  put(mb, body, o, face(M.Plate, PLATE), false, 2, 1, 0.012);
  if (lod === 0) {
    put(mb, body, band, face(M.Fixed, PLATE_BLUE), false, 1, 1, 0.014);
  }
}

interface Fascia {
  /** Right headlight (mirrored). */
  head: Outline;
  /** Centred grille and lower intake (black), chrome grille bar. */
  grille?: Outline;
  intake?: Outline;
  chromeBar?: Outline;
  /** Amber side indicators / fog lamps in the bumper (mirrored). */
  fog?: Outline;
  plateY: number;
}

interface RearDef {
  /** Right tail light (mirrored). */
  tail: Outline;
  /** Black lower bumper band (centred). */
  bumper?: Outline;
  /** Rear glass laid on the rear face (MPVs, vans). */
  glass?: Outline;
  /** Split line of twin rear doors. */
  split?: [number, number];
  plateY: number;
  /** Centre high-mounted stop lamp / reflector strip (centred). */
  strip?: Outline;
}

function fascia(mb: ModelBuilder, body: Body, f: Fascia, lod: number): void {
  const [na, nb] = res(lod, 5, 3);
  if (f.grille) {
    frontPatch(mb, body, f.grille, trimF(), false, na, nb, 0.004);
  }
  if (f.intake && lod < 2) {
    frontPatch(mb, body, f.intake, trimF(), false, na, 1, 0.004);
  }
  if (f.chromeBar && lod === 0) {
    frontPatch(mb, body, f.chromeBar, face(M.Chrome, CHROME), false, 3, 1, 0.008);
  }
  // headlight: black housing, then the lens inset
  const h = f.head;
  if (lod === 0) {
    frontPatch(mb, body, { ...h, x0: h.x0 - 0.02, x1: h.x1 + 0.01, x0t: (h.x0t ?? h.x0) - 0.02, x1t: (h.x1t ?? h.x1) + 0.01, y0: h.y0 - 0.015, y1: h.y1 + 0.015 }, trimF(), true, 4, 2, 0.005);
  }
  frontPatch(mb, body, h, face(M.Head, HEAD), true, na, Math.max(1, nb - 1), 0.009);
  if (f.fog && lod === 0) {
    frontPatch(mb, body, f.fog, face(M.Amber, AMBER), true, 2, 1, 0.008);
  }
  plate(mb, body, f.plateY, false, lod);
}

function rearFace(mb: ModelBuilder, body: Body, r: RearDef, lod: number): void {
  const [na, nb] = res(lod, 4, 3);
  if (r.glass) {
    rearPatch(mb, body, r.glass, glassF(), false, na, nb, 0.005);
  }
  if (r.split && lod === 0) {
    rearPatch(mb, body, { x0: -0.008, x1: 0.008, y0: r.split[0], y1: r.split[1] }, trimF(), false, 1, 4, 0.007);
  }
  if (r.bumper && lod < 2) {
    rearPatch(mb, body, r.bumper, trimF(), false, na, 1, 0.004);
  }
  if (lod === 0) {
    const t = r.tail;
    rearPatch(mb, body, { ...t, x0: t.x0 - 0.015, x1: t.x1 + 0.01, x0t: (t.x0t ?? t.x0) - 0.015, x1t: (t.x1t ?? t.x1) + 0.01, y0: t.y0 - 0.012, y1: t.y1 + 0.012 }, trimF(), true, 3, 2, 0.005);
  }
  rearPatch(mb, body, r.tail, face(M.Tail, TAIL), true, na, Math.max(1, nb - 1), 0.009);
  if (r.strip && lod === 0) {
    rearPatch(mb, body, r.strip, face(M.Tail, TAIL), false, 2, 1, 0.008);
  }
  plate(mb, body, r.plateY, true, lod);
}

/** Centre of an outline and the body surface point there (light sprite anchors). */
function anchor(body: Body, o: Outline, rear: boolean): [number, number, number] {
  const x = (o.x0 + o.x1 + (o.x0t ?? o.x0) + (o.x1t ?? o.x1)) / 4;
  const y = (o.y0 + o.y1) / 2;
  const u = rear ? body.rearU(x, y) : body.frontU(x, y);
  const uu = Number.isNaN(u) ? (rear ? body.L : 0) : u;
  return [x, y, uu - body.L / 2 + (rear ? 0.04 : -0.04)];
}

/* ------------------------------------------------------------------ */
/* Cars and vans                                                       */
/* ------------------------------------------------------------------ */

interface CarDef {
  spec: BodySpec;
  front: Fascia;
  rear: RearDef;
  /** Mirror station and height. */
  mirror: [number, number];
  extras?: (mb: ModelBuilder, body: Body, lod: number) => void;
}

function sedan(model: number): CarDef {
  const L = MODEL_LENGTH[model];
  return {
    spec: {
      length: L,
      width: MODEL_WIDTH[model],
      top: [
        [0, 0.56],
        [0.04, 0.64],
        [0.12, 0.71],
        [0.3, 0.77],
        [0.8, 0.86],
        [1.12, 0.92],
        [1.95, 1.43],
        [2.3, 1.47],
        [2.9, 1.45],
        [3.1, 1.41],
        [3.78, 1.08],
        [L - 0.14, 1.04],
        [L - 0.04, 1.0],
        [L, 0.92],
      ],
      belt: [
        [0, 0.8],
        [1.12, 0.92],
        [3.6, 1.0],
        [L, 1.02],
      ],
      bottomFront: 0.27,
      bottomRear: 0.33,
      clearance: 0.17,
      axles: [0.92, 0.92 + 2.65],
      wheelR: 0.31,
      wheelW: 0.21,
      tumble: 0.78,
      roundFront: 0.55,
      roundRear: 0.36,
      endWidth: 0.72,
      windshield: [1.12, 1.95],
      rearWindow: [3.1, 3.78],
      sideGlass: [[1.3, 3.6]],
      pillars: [2.5],
      pillarW: 0.1,
      creases: [1.12, 1.95, 3.1, 3.78, L - 0.14],
      sideMat: M.Glass,
    },
    front: {
      head: { x0: 0.42, x1: 0.84, x0t: 0.5, x1t: 0.8, y0: 0.6, y1: 0.71 },
      grille: { x0: -0.34, x1: 0.34, x0t: -0.3, x1t: 0.3, y0: 0.45, y1: 0.62 },
      intake: { x0: -0.5, x1: 0.5, y0: 0.27, y1: 0.36 },
      chromeBar: { x0: -0.3, x1: 0.3, y0: 0.59, y1: 0.61 },
      fog: { x0: 0.6, x1: 0.74, y0: 0.3, y1: 0.35 },
      plateY: 0.41,
    },
    rear: {
      tail: { x0: 0.5, x1: 0.87, x0t: 0.56, x1t: 0.86, y0: 0.84, y1: 0.97 },
      bumper: { x0: -0.75, x1: 0.75, y0: 0.32, y1: 0.4 },
      plateY: 0.7,
    },
    mirror: [1.22, 0.98],
  };
}

function hatch(model: number): CarDef {
  const L = MODEL_LENGTH[model];
  return {
    spec: {
      length: L,
      width: MODEL_WIDTH[model],
      top: [
        [0, 0.58],
        [0.04, 0.66],
        [0.12, 0.73],
        [0.3, 0.79],
        [0.8, 0.9],
        [1.0, 0.94],
        [1.78, 1.42],
        [2.15, 1.45],
        [3.25, 1.42],
        [L - 0.2, 1.2],
        [L - 0.08, 1.05],
        [L, 0.95],
      ],
      belt: [
        [0, 0.84],
        [1.0, 0.94],
        [3.4, 1.03],
        [L, 1.05],
      ],
      bottomFront: 0.28,
      bottomRear: 0.36,
      clearance: 0.16,
      axles: [0.82, 0.82 + 2.5],
      wheelR: 0.3,
      wheelW: 0.19,
      tumble: 0.8,
      roundFront: 0.5,
      roundRear: 0.3,
      endWidth: 0.74,
      windshield: [1.0, 1.78],
      rearWindow: [3.25, L - 0.2],
      sideGlass: [[1.15, 3.42]],
      pillars: [2.3],
      pillarW: 0.1,
      creases: [1.0, 1.78, 3.25, L - 0.2, L - 0.08],
      sideMat: M.Glass,
    },
    front: {
      head: { x0: 0.4, x1: 0.82, x0t: 0.5, x1t: 0.79, y0: 0.62, y1: 0.73 },
      grille: { x0: -0.3, x1: 0.3, y0: 0.47, y1: 0.62 },
      intake: { x0: -0.48, x1: 0.48, y0: 0.28, y1: 0.37 },
      fog: { x0: 0.58, x1: 0.7, y0: 0.31, y1: 0.36 },
      plateY: 0.42,
    },
    rear: {
      tail: { x0: 0.58, x1: 0.85, x0t: 0.66, x1t: 0.83, y0: 0.86, y1: 1.08 },
      bumper: { x0: -0.72, x1: 0.72, y0: 0.35, y1: 0.44 },
      plateY: 0.72,
    },
    mirror: [1.1, 1.0],
  };
}

function suv(model: number): CarDef {
  const L = MODEL_LENGTH[model];
  return {
    spec: {
      length: L,
      width: MODEL_WIDTH[model],
      top: [
        [0, 0.68],
        [0.04, 0.78],
        [0.14, 0.88],
        [0.4, 0.96],
        [0.95, 1.04],
        [1.12, 1.08],
        [1.9, 1.62],
        [2.3, 1.66],
        [3.85, 1.63],
        [L - 0.16, 1.42],
        [L - 0.06, 1.22],
        [L, 1.08],
      ],
      belt: [
        [0, 1.0],
        [1.12, 1.08],
        [3.9, 1.16],
        [L, 1.18],
      ],
      bottomFront: 0.36,
      bottomRear: 0.42,
      clearance: 0.22,
      axles: [0.93, 0.93 + 2.65],
      wheelR: 0.35,
      wheelW: 0.23,
      tumble: 0.83,
      roundFront: 0.5,
      roundRear: 0.34,
      endWidth: 0.76,
      windshield: [1.12, 1.9],
      rearWindow: [3.85, L - 0.16],
      sideGlass: [[1.3, 4.0]],
      pillars: [2.45, 3.45],
      pillarW: 0.12,
      creases: [1.12, 1.9, 3.85, L - 0.16, L - 0.06],
      sideMat: M.Glass,
      cladding: true,
    },
    front: {
      head: { x0: 0.46, x1: 0.88, x0t: 0.5, x1t: 0.86, y0: 0.8, y1: 0.91 },
      grille: { x0: -0.42, x1: 0.42, y0: 0.56, y1: 0.8 },
      intake: { x0: -0.55, x1: 0.55, y0: 0.37, y1: 0.47 },
      chromeBar: { x0: -0.42, x1: 0.42, y0: 0.71, y1: 0.735 },
      fog: { x0: 0.62, x1: 0.76, y0: 0.42, y1: 0.47 },
      plateY: 0.51,
    },
    rear: {
      tail: { x0: 0.56, x1: 0.9, x0t: 0.62, x1t: 0.88, y0: 0.94, y1: 1.08 },
      bumper: { x0: -0.8, x1: 0.8, y0: 0.42, y1: 0.55 },
      plateY: 0.82,
    },
    mirror: [1.25, 1.14],
    extras: (mb, body, lod) => {
      if (lod === 0) {
        // roof rails
        for (const s of [-1, 1]) {
          mb.box(s * body.hw * 0.66, 1.69, 0.35, 0.025, 0.03, 1.1, trimF());
        }
      }
    },
  };
}

/** Fiat Doblo: short sloping bonnet, steep screen, tall flat roof, vertical tailgate (taxi or cargo van). */
function doblo(model: number, windows: boolean): CarDef {
  const L = MODEL_LENGTH[model];
  return {
    spec: {
      length: L,
      width: MODEL_WIDTH[model],
      top: [
        [0, 0.64],
        [0.04, 0.74],
        [0.14, 0.84],
        [0.35, 0.95],
        [0.78, 1.06],
        [0.9, 1.1],
        [1.62, 1.8],
        [1.95, 1.85],
        [L - 0.14, 1.84],
        [L - 0.04, 1.78],
        [L, 1.7],
      ],
      belt: [
        [0, 0.95],
        [0.9, 1.1],
        [L, 1.12],
      ],
      bottomFront: 0.3,
      bottomRear: 0.4,
      clearance: 0.19,
      axles: [0.88, 0.88 + 2.75],
      wheelR: 0.32,
      wheelW: 0.2,
      tumble: 0.9,
      roundFront: 0.45,
      roundRear: 0.16,
      endWidth: 0.8,
      windshield: [0.9, 1.62],
      rearWindow: null,
      sideGlass: windows ? [[1.0, L - 0.24]] : [[1.0, 1.95]],
      pillars: windows ? [1.98, 3.25] : [],
      pillarW: 0.12,
      creases: [0.9, 1.62, L - 0.14],
      sideMat: M.Glass,
    },
    front: {
      head: { x0: 0.46, x1: 0.86, x0t: 0.52, x1t: 0.84, y0: 0.78, y1: 0.93 },
      grille: { x0: -0.36, x1: 0.36, y0: 0.56, y1: 0.76 },
      intake: { x0: -0.55, x1: 0.55, y0: 0.3, y1: 0.42 },
      chromeBar: { x0: -0.36, x1: 0.36, y0: 0.66, y1: 0.685 },
      plateY: 0.48,
    },
    rear: {
      tail: { x0: 0.76, x1: 0.9, y0: 0.9, y1: 1.34 },
      glass: windows ? { x0: -0.7, x1: 0.7, x0t: -0.64, x1t: 0.64, y0: 1.18, y1: 1.68 } : { x0: -0.7, x1: 0.7, x0t: -0.64, x1t: 0.64, y0: 1.3, y1: 1.68 },
      split: windows ? undefined : [0.5, 1.72],
      bumper: { x0: -0.82, x1: 0.82, y0: 0.4, y1: 0.54 },
      plateY: 0.88,
    },
    mirror: [1.0, 1.16],
  };
}

/** Ford Transit / Mercedes Sprinter high-roof body: panel van or dolmuş minibus. */
function highRoof(model: number, minibus: boolean): CarDef {
  const L = MODEL_LENGTH[model];
  const pillars: number[] = [];
  if (minibus) {
    for (let u = 2.2 + 1.05; u < L - 0.5; u += 1.05) {
      pillars.push(u);
    }
  }
  const H = minibus ? 2.68 : 2.46;
  return {
    spec: {
      length: L,
      width: MODEL_WIDTH[model],
      top: [
        [0, 0.7],
        [0.04, 0.82],
        [0.14, 0.95],
        [0.45, 1.08],
        [0.95, 1.2],
        [1.05, 1.24],
        [1.75, 2.1],
        [2.1, H - 0.04],
        [2.4, H],
        [L - 0.08, H - 0.01],
        [L, H - 0.1],
      ],
      belt: [
        [0, 1.1],
        [1.05, 1.24],
        [L, 1.26],
      ],
      glassTop: minibus
        ? [
            [0, 3],
            [2.1, 3],
            [2.35, H - 0.36],
            [L, H - 0.36],
          ]
        : undefined,
      bottomFront: 0.36,
      bottomRear: 0.48,
      clearance: 0.23,
      axles: [1.02, 1.02 + (minibus ? 4.3 : 3.5)],
      wheelR: 0.34,
      wheelW: 0.22,
      tumble: 0.93,
      roundFront: 0.5,
      roundRear: 0.1,
      endWidth: 0.86,
      windshield: [1.05, 1.75],
      rearWindow: null,
      sideGlass: minibus
        ? [
            [1.15, 2.05],
            [2.2, L - 0.35],
          ]
        : [[1.15, 2.1]],
      pillars,
      pillarW: 0.09,
      creases: [1.05, 1.75, 2.1],
      sideMat: M.Glass,
    },
    front: {
      head: { x0: 0.5, x1: 0.94, x0t: 0.56, x1t: 0.92, y0: 0.9, y1: 1.08 },
      grille: { x0: -0.42, x1: 0.42, y0: 0.6, y1: 0.92 },
      intake: { x0: -0.7, x1: 0.7, y0: 0.37, y1: 0.5 },
      plateY: 0.54,
    },
    rear: {
      tail: { x0: 0.88, x1: 1.0, y0: 0.62, y1: 1.3 },
      glass: { x0: -0.86, x1: 0.86, y0: H - 0.95, y1: H - 0.35 },
      split: [0.55, H - 0.15],
      bumper: { x0: -0.95, x1: 0.95, y0: 0.48, y1: 0.6 },
      strip: { x0: -0.2, x1: 0.2, y0: H - 0.2, y1: H - 0.16 },
      plateY: 0.72,
    },
    mirror: [1.12, 1.32],
    extras: (mb, body, lod) => {
      if (lod < 2) {
        // sliding side door seam and handle rail (right side)
        sidePatch(mb, body, 2.3, 2.32, 0.5, 1.9, trimF(), false, 1, 2);
        if (!minibus) {
          sidePatch(mb, body, 1.15, 2.1, 1.0, 1.02, trimF(), true, 2, 1, 0.006);
        }
      }
    },
  };
}

/** Taxi roof sign (lit "TAKSİ" box) on a body at station u. */
function taxiSign(mb: ModelBuilder, body: Body, u: number, lod: number): void {
  const y = body.top(u);
  const z = u - body.L / 2;
  mb.box(0, y + 0.1, z, 0.34, 0.085, 0.12, face(M.Sign, [0.98, 0.92, 0.62]), 4);
  if (lod === 0) {
    mb.box(0, y + 0.012, z, 0.3, 0.014, 0.1, trimF());
    // lettering band on both faces
    for (const s of [-1, 1]) {
      mb.box(0, y + 0.1, z + s * 0.121, 0.22, 0.03, 0.002, face(M.Trim, [0.02, 0.02, 0.02]), s > 0 ? 16 : 32);
    }
  }
}

function buildCar(mb: ModelBuilder, def: CarDef, lod: number): Body {
  const body = new Body(def.spec, lod);
  body.shell(mb);
  wheels(mb, body, lod);
  if (lod === 0) {
    for (const a of def.spec.axles) {
      archPatch(mb, body, a, def.spec.wheelR + 0.05, def.spec.wheelR + 0.1, trimF(), 8);
    }
  }
  fascia(mb, body, def.front, lod);
  rearFace(mb, body, def.rear, lod);
  mirrors(mb, body, def.mirror[0], def.mirror[1], def.spec.paint ?? face(M.Paint), lod);
  def.extras?.(mb, body, lod);
  return body;
}

/* ------------------------------------------------------------------ */
/* Bus, truck, scooter                                                 */
/* ------------------------------------------------------------------ */

function busSpec(): BodySpec {
  const L = MODEL_LENGTH[Model.Bus];
  const pillars: number[] = [];
  for (let u = 2.2; u < L - 0.8; u += 1.42) {
    pillars.push(u);
  }
  const white = face(M.Fixed, [0.86, 0.87, 0.86]);
  return {
    length: L,
    width: MODEL_WIDTH[Model.Bus],
    top: [
      [0, 0.9],
      [0.03, 2.4],
      [0.1, 2.85],
      [0.3, 3.02],
      [0.6, 3.08],
      [L - 0.4, 3.08],
      [L - 0.1, 3.0],
      [L, 2.8],
    ],
    belt: [
      [0, 0.95],
      [0.2, 1.05],
      [L, 1.1],
    ],
    glassTop: [
      [0, 2.7],
      [L, 2.72],
    ],
    bottomFront: 0.3,
    bottomRear: 0.42,
    clearance: 0.3,
    axles: [2.7, 2.7 + 5.9],
    wheelR: 0.5,
    wheelW: 0.3,
    tumble: 0.95,
    roundFront: 0.3,
    roundRear: 0.3,
    endWidth: 0.9,
    windshield: [0, 0],
    rearWindow: null,
    sideGlass: [[1.7, L - 0.45]],
    pillars,
    pillarW: 0.12,
    creases: [0.03, 0.1, L - 0.1],
    sideMat: M.Lit,
    roof: white,
  };
}

function busModel(mb: ModelBuilder, lod: number): Body {
  const spec = busSpec();
  const body = new Body(spec, lod);
  body.shell(mb);
  wheels(mb, body, lod, true, [0.7, 0.71, 0.72]);
  const L = spec.length;
  const [na, nb] = res(lod, 6, 4);
  // front: black mask, windscreen, LED destination display, headlights low in the corners, bumper
  frontPatch(mb, body, { x0: -1.22, x1: 1.22, y0: 0.9, y1: 2.98 }, trimF(), false, na, nb, 0.004);
  frontPatch(mb, body, { x0: -1.16, x1: 1.16, y0: 1.0, y1: 2.62 }, glassF(), false, na, nb, 0.008);
  frontPatch(mb, body, { x0: -0.95, x1: 0.95, y0: 2.68, y1: 2.9 }, face(M.Sign, [1.0, 0.5, 0.06]), false, 3, 1, 0.01);
  frontPatch(mb, body, { x0: -1.26, x1: 1.26, y0: 0.3, y1: 0.46 }, trimF(), false, 3, 1, 0.005);
  frontPatch(mb, body, { x0: 0.82, x1: 1.18, y0: 0.52, y1: 0.68 }, face(M.Head, HEAD), true, 2, 1, 0.009);
  plate(mb, body, 0.38, false, lod);
  // doors on the kerb side (+x): black frames, then glass panes
  if (lod < 2) {
    for (const [a, b] of [
      [0.35, 1.55],
      [5.35, 6.55],
      [9.35, 10.55],
    ]) {
      sidePatch(mb, body, a - 0.04, b + 0.04, 0.34, 2.76, trimF(), false, 2, 3, 0.005);
      sidePatch(mb, body, a + 0.03, (a + b) / 2 - 0.02, 0.4, 2.62, face(M.Lit, GLASS), false, 1, 3, 0.009);
      sidePatch(mb, body, (a + b) / 2 + 0.02, b - 0.03, 0.4, 2.62, face(M.Lit, GLASS), false, 1, 3, 0.009);
    }
    // driver's window (left-hand drive)
    sidePatch(mb, body, 0.25, 1.6, 1.15, 2.62, glassF(), -1, 2, 2, 0.006);
    mirrors(mb, body, 0.1, 2.3, face(M.Trim, TRIM), lod);
  }
  // rear: engine grille, rear window, tall tail lights, plate
  rearPatch(mb, body, { x0: -1.0, x1: 1.0, y0: 0.55, y1: 1.35 }, trimF(), false, 3, 2, 0.005);
  rearPatch(mb, body, { x0: -0.95, x1: 0.95, y0: 1.95, y1: 2.72 }, face(M.Lit, GLASS), false, 3, 2, 0.006);
  rearPatch(mb, body, { x0: 1.06, x1: 1.2, y0: 0.62, y1: 1.5 }, face(M.Tail, TAIL), true, 1, 2, 0.009);
  rearPatch(mb, body, { x0: -0.8, x1: 0.8, y0: 2.8, y1: 2.95 }, face(M.Sign, [1.0, 0.5, 0.06]), false, 2, 1, 0.009);
  plate(mb, body, 0.45, true, lod);
  if (lod < 2) {
    // roof air conditioning pod and CNG-free roof hatch
    mb.box(0, 3.2, -L / 2 + 4.8, body.hw * 0.66, 0.14, 1.5, face(M.Fixed, [0.82, 0.83, 0.82]), 4);
    mb.box(0, 3.12, L / 2 - 2.2, body.hw * 0.5, 0.06, 0.5, face(M.Fixed, [0.7, 0.71, 0.7]), 4);
  }
  return body;
}

function truckModel(mb: ModelBuilder, lod: number): Body {
  const L = MODEL_LENGTH[Model.Truck];
  const W = MODEL_WIDTH[Model.Truck];
  const cabL = 1.95;
  const cab: BodySpec = {
    length: cabL,
    width: 1.98,
    top: [
      [0, 1.02],
      [0.05, 1.35],
      [0.28, 2.18],
      [0.5, 2.3],
      [cabL - 0.05, 2.3],
      [cabL, 2.2],
    ],
    belt: [
      [0, 1.35],
      [cabL, 1.35],
    ],
    bottomFront: 0.55,
    bottomRear: 0.62,
    clearance: 0.6,
    axles: [],
    wheelR: 0.38,
    wheelW: 0.22,
    tumble: 0.95,
    roundFront: 0.16,
    roundRear: 0.05,
    endWidth: 0.9,
    windshield: [0.05, 0.3],
    rearWindow: null,
    sideGlass: [[0.1, 1.3]],
    pillars: [],
    pillarW: 0.1,
    creases: [0.05, 0.28],
    sideMat: M.Glass,
  };
  // the cab sits at the front of the vehicle frame: build it separately and shift it forward
  const tmp = new ModelBuilder();
  const body = new Body(cab, lod);
  body.shell(tmp);
  frontPatch(tmp, body, { x0: -0.92, x1: 0.92, y0: 1.4, y1: 2.12 }, glassF(), false, 3, 2, 0.006);
  frontPatch(tmp, body, { x0: -0.5, x1: 0.5, y0: 0.9, y1: 1.3 }, trimF(), false, 3, 2, 0.005);
  frontPatch(tmp, body, { x0: 0.62, x1: 0.92, y0: 0.9, y1: 1.08 }, face(M.Head, HEAD), true, 1, 1, 0.009);
  frontPatch(tmp, body, { x0: -0.99, x1: 0.99, y0: 0.55, y1: 0.8 }, face(M.Fixed, [0.5, 0.51, 0.52]), false, 2, 1, 0.005);
  plate(tmp, body, 0.68, false, lod);
  const dz = -L / 2 + cabL / 2;
  const base = mb.pos.length / 3;
  for (let i = 0; i < tmp.pos.length; i += 3) {
    mb.pos.push(tmp.pos[i], tmp.pos[i + 1], tmp.pos[i + 2] + dz);
  }
  mb.nrm.push(...tmp.nrm);
  mb.col.push(...tmp.col);
  mb.mat.push(...tmp.mat);
  for (const i of tmp.idx) {
    mb.idx.push(i + base);
  }
  // box body (paint), chassis rails, bumper
  const boxLen = L - cabL - 0.15;
  const boxZ = L / 2 - boxLen / 2;
  mb.box(0, 1.0 + 1.15, boxZ, W / 2, 1.15, boxLen / 2, face(M.Paint));
  if (lod < 2) {
    mb.box(0, 0.82, 0.3, 0.45, 0.12, L / 2 - 0.4, trimF());
    // rear doors seam, tail lights, underrun bar
    mb.box(0, 2.15, L / 2 + 0.004, 0.006, 1.1, 0.004, trimF(), 16);
    for (const s of [-1, 1]) {
      mb.box(s * 0.85, 0.8, L / 2 + 0.01, 0.12, 0.07, 0.03, face(M.Tail, TAIL), 16);
    }
    mb.box(0, 0.55, L / 2 - 0.05, W / 2 - 0.1, 0.05, 0.05, trimF());
    for (const s of [-1, 1]) {
      mb.box(s * 1.12, 1.9, -L / 2 + 0.3, 0.1, 0.16, 0.04, trimF());
    }
  }
  const wheelSpec = new Body({ ...cab, length: L, width: W - 0.08, axles: [1.1, 1.1 + 3.4], wheelR: 0.38 }, lod);
  wheels(mb, wheelSpec, lod, true, [0.55, 0.56, 0.57]);
  return body;
}

function motoModel(mb: ModelBuilder, lod: number): void {
  const dark = face(M.Trim, [0.06, 0.065, 0.07]);
  const bodyF = face(M.Fixed, [0.1, 0.105, 0.115]);
  const cloth = face(M.Cloth, [0.07, 0.075, 0.09]);
  const tyre = face(M.Rubber, TYRE);
  const seg = lod === 0 ? 12 : 6;
  mb.cylinderX(-0.05, 0.05, 0.24, -0.62, 0.24, seg, tyre, dark);
  mb.cylinderX(-0.055, 0.055, 0.24, 0.62, 0.24, seg, tyre, dark);
  // leg shield, floorboard, rear body under the seat, seat
  mb.box(0, 0.64, -0.5, 0.21, 0.32, 0.07, bodyF, 0, -0.32);
  mb.box(0, 0.35, -0.1, 0.17, 0.05, 0.32, bodyF);
  mb.box(0, 0.55, 0.42, 0.18, 0.18, 0.3, bodyF);
  mb.box(0, 0.76, 0.35, 0.15, 0.04, 0.3, dark);
  mb.box(0, 0.98, -0.53, 0.33, 0.02, 0.02, dark);
  // courier top box (paint = company colour) on a rack
  mb.box(0, 1.1, 0.68, 0.25, 0.23, 0.21, face(M.Paint));
  mb.box(0, 0.86, 0.66, 0.2, 0.02, 0.18, dark);
  if (lod < 2) {
    // rider: legs, torso in a dark jacket, arms, helmet in the company colour
    mb.box(0, 0.64, -0.06, 0.16, 0.08, 0.26, cloth);
    for (const s of [-1, 1]) {
      mb.box(s * 0.12, 0.44, -0.3, 0.05, 0.16, 0.06, cloth);
    }
    mb.box(0, 1.1, 0.12, 0.19, 0.3, 0.13, cloth, 0, 0.3);
    for (const s of [-1, 1]) {
      mb.box(s * 0.2, 1.06, -0.24, 0.05, 0.05, 0.25, cloth, 0, -0.5);
    }
    mb.blob(0, 1.5, 0.02, 0.14, 0.15, 0.16, face(M.Paint), lod === 0 ? 10 : 6);
    if (lod === 0) {
      mb.box(0, 1.5, -0.12, 0.1, 0.05, 0.03, glassF(), 0, 0.2);
    }
  } else {
    mb.box(0, 1.15, 0.05, 0.18, 0.4, 0.16, cloth);
  }
  mb.box(0, 0.86, -0.59, 0.07, 0.05, 0.03, face(M.Head, HEAD), 32);
  mb.box(0, 0.7, 0.74, 0.08, 0.03, 0.02, face(M.Tail, TAIL), 16);
}

/* ------------------------------------------------------------------ */
/* Trams                                                               */
/* ------------------------------------------------------------------ */

const TRAM_WHITE = face(M.Fixed, [0.87, 0.88, 0.87]);
const TRAM_RED = face(M.Fixed, [0.62, 0.035, 0.045]);
const TRAM_GREY = face(M.Fixed, [0.5, 0.51, 0.52]);

/** Alstom Citadis X04 module: cab (nose towards -Z) or intermediate module, with sliding doors on both sides. */
function citadisModel(mb: ModelBuilder, lod: number, cab: boolean): Body {
  const model = cab ? Model.CitadisEnd : Model.CitadisMid;
  const L = MODEL_LENGTH[model];
  const g0 = cab ? 1.75 : 0.3;
  const pillars: number[] = [];
  for (let u = g0 + 1.3; u < L - 0.5; u += 1.3) {
    pillars.push(u);
  }
  const spec: BodySpec = {
    length: L,
    width: MODEL_WIDTH[model],
    top: cab
      ? [
          [0, 0.62],
          [0.1, 1.02],
          [0.3, 1.22],
          [0.55, 1.5],
          [1.15, 2.9],
          [1.55, 3.22],
          [2.1, 3.3],
          [L, 3.3],
        ]
      : [
          [0, 3.3],
          [L, 3.3],
        ],
    belt: [
      [0, 1.02],
      [L, 1.02],
    ],
    glassTop: [
      [0, 2.62],
      [L, 2.62],
    ],
    bottomFront: cab ? 0.36 : 0.32,
    bottomRear: 0.32,
    clearance: 0.32,
    axles: [],
    wheelR: 0.33,
    wheelW: 0.12,
    tumble: 0.93,
    roundFront: cab ? 1.1 : 0.03,
    roundRear: 0.03,
    endWidth: cab ? 0.66 : 0.98,
    windshield: [0, 0],
    rearWindow: null,
    sideGlass: [[g0, L - 0.25]],
    pillars,
    pillarW: 0.16,
    creases: cab ? [0.55, 1.15, 1.55] : [],
    sideMat: M.Lit,
    roof: face(M.Fixed, [0.8, 0.81, 0.8]),
    bands: [[0.3, 0.64, TRAM_RED]],
    paint: TRAM_WHITE,
  };
  const body = new Body(spec, lod);
  body.shell(mb);
  const hw = body.hw;
  const z0 = -L / 2;
  const trim = trimF();
  const [na, nb] = res(lod, 6, 4);
  // doors: two double sliding doors per module on both sides (grey frame, lit glass)
  if (lod < 2) {
    const doors = cab ? [2.35, 6.6] : [L / 2];
    for (const d of doors) {
      sidePatch(mb, body, d - 0.72, d + 0.72, 0.34, 2.5, face(M.Fixed, [0.36, 0.37, 0.38]), true, 2, 3, 0.005);
      sidePatch(mb, body, d - 0.64, d - 0.03, 0.42, 2.4, face(M.Lit, GLASS), true, 1, 3, 0.009);
      sidePatch(mb, body, d + 0.03, d + 0.64, 0.42, 2.4, face(M.Lit, GLASS), true, 1, 3, 0.009);
    }
  }
  if (cab) {
    // nose: black mask with the raked windscreen, destination display, headlights, coupler cover
    frontPatch(mb, body, { x0: -1.2, x1: 1.2, x0t: -1.02, x1t: 1.02, y0: 1.28, y1: 3.02 }, trim, false, na, nb, 0.004);
    frontPatch(mb, body, { x0: -1.08, x1: 1.08, x0t: -0.94, x1t: 0.94, y0: 1.42, y1: 2.75 }, glassF(), false, na, nb, 0.008);
    frontPatch(mb, body, { x0: -0.7, x1: 0.7, y0: 2.8, y1: 2.97 }, face(M.Sign, [1.0, 0.55, 0.08]), false, 3, 1, 0.011);
    frontPatch(mb, body, { x0: 0.58, x1: 0.98, x0t: 0.62, x1t: 0.95, y0: 0.82, y1: 0.95 }, face(M.Head, HEAD), true, 2, 1, 0.009);
    frontPatch(mb, body, { x0: 0.98, x1: 1.12, y0: 1.02, y1: 1.12 }, face(M.Tail, TAIL), true, 1, 1, 0.009);
    frontPatch(mb, body, { x0: -0.35, x1: 0.35, y0: 0.45, y1: 0.7 }, TRAM_GREY, false, 2, 1, 0.006);
  }
  if (lod < 2) {
    // bogie skirts and roof equipment
    const bz = cab ? 2.0 : L / 2;
    mb.box(0, 0.26, z0 + bz, hw - 0.1, 0.16, 1.2, trim, 8);
    mb.box(0, 3.46, z0 + L * 0.55, hw * 0.55, 0.16, L * 0.26, TRAM_GREY, 4);
    if (!cab && lod === 0) {
      // pantograph
      const pz = z0 + L * 0.35;
      mb.box(0, 3.6, pz, 0.36, 0.03, 0.04, trim);
      mb.box(0, 3.9, pz + 0.28, 0.022, 0.32, 0.022, trim, 0, 0.9);
      mb.box(0, 4.18, pz + 0.08, 0.62, 0.016, 0.045, face(M.Chrome, RIM));
    }
    // articulation bellows at the inner ends
    const ends = cab ? [L / 2] : [-L / 2, L / 2];
    for (const e of ends) {
      mb.box(0, 1.75, e + Math.sign(e) * 0.08, hw * 0.86, 1.4, 0.1, trim);
    }
  }
  return body;
}

/** İstiklal nostalgic tram: red single-truck car, cream window frames, open platforms, trolley pole. */
function nostalgicModel(mb: ModelBuilder, lod: number): Body {
  const L = MODEL_LENGTH[Model.Nostalgic];
  const pillars: number[] = [];
  for (let u = 1.9; u < L - 1.7; u += 0.72) {
    pillars.push(u);
  }
  const cream = face(M.Fixed, [0.8, 0.72, 0.52]);
  const spec: BodySpec = {
    length: L,
    width: MODEL_WIDTH[Model.Nostalgic],
    top: [
      [0, 1.35],
      [0.06, 2.6],
      [0.3, 3.0],
      [L - 0.3, 3.0],
      [L - 0.06, 2.6],
      [L, 1.35],
    ],
    belt: [
      [0, 1.38],
      [L, 1.38],
    ],
    glassTop: [
      [0, 2.52],
      [L, 2.52],
    ],
    bottomFront: 0.55,
    bottomRear: 0.55,
    clearance: 0.55,
    axles: [],
    wheelR: 0.4,
    wheelW: 0.1,
    tumble: 0.95,
    roundFront: 0.75,
    roundRear: 0.75,
    endWidth: 0.66,
    windshield: [0, 0],
    rearWindow: null,
    sideGlass: [[1.45, L - 1.45]],
    pillars,
    pillarW: 0.13,
    creases: [0.06, 0.3, L - 0.3, L - 0.06],
    sideMat: M.Lit,
    roof: face(M.Fixed, [0.25, 0.23, 0.21]),
    bands: [
      [2.3, 2.95, cream],
      [1.3, 1.42, cream],
    ],
  };
  const body = new Body(spec, lod);
  body.shell(mb);
  const hw = body.hw;
  const trim = trimF();
  // end windows and headlamp on both platforms
  for (const put of [frontPatch, rearPatch]) {
    put(mb, body, { x0: -0.75, x1: 0.75, y0: 1.5, y1: 2.45 }, face(M.Lit, GLASS), false, 3, 2, 0.007);
    put(mb, body, { x0: -0.14, x1: 0.14, y0: 1.08, y1: 1.28 }, face(M.Head, HEAD), false, 1, 1, 0.01);
    put(mb, body, { x0: -0.6, x1: 0.6, y0: 2.62, y1: 2.84 }, face(M.Sign, [0.95, 0.88, 0.7]), false, 2, 1, 0.01);
  }
  // clerestory roof and trolley pole
  mb.box(0, 3.1, 0, hw * 0.45, 0.1, L / 2 - 1.3, face(M.Fixed, [0.3, 0.28, 0.26]));
  if (lod < 2) {
    mb.box(0, 3.26, 1.0, 0.25, 0.05, 0.35, trim);
    mb.box(0, 3.9, 2.3, 0.025, 0.025, 1.6, trim, 0, 0.42);
    // truck frame, wheels, lifeguard trays
    mb.box(0, 0.42, 0, hw - 0.25, 0.14, 1.9, trim);
    for (const z of [-1.5, 1.5]) {
      for (const s of [-1, 1]) {
        mb.cylinderX(s > 0 ? hw - 0.45 : -(hw - 0.35), s > 0 ? hw - 0.35 : -(hw - 0.45), 0.4, z, 0.4, lod === 0 ? 12 : 6, trim, trim);
      }
    }
    for (const e of [-1, 1]) {
      mb.box(0, 0.3, e * (L / 2 - 0.2), hw * 0.7, 0.04, 0.2, trim);
    }
  }
  return body;
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

/** Light sprite anchors per model (vehicle frame): headlights and tail lights. */
export interface ModelLights {
  head: [number, number, number][];
  tail: [number, number, number][];
}

function carDef(model: number): CarDef | null {
  switch (model) {
    case Model.Sedan:
    case Model.TaxiSedan:
      return sedan(model);
    case Model.Hatch:
      return hatch(model);
    case Model.Suv:
      return suv(model);
    case Model.TaxiDoblo:
      return doblo(model, true);
    case Model.Van:
      return doblo(model, false);
    case Model.PanelVan:
      return highRoof(model, false);
    case Model.Minibus:
      return highRoof(model, true);
    default:
      return null;
  }
}

export function buildModelGeometry(model: number, lod: number): THREE.BufferGeometry {
  const mb = new ModelBuilder();
  const car = carDef(model);
  if (car) {
    const body = buildCar(mb, car, lod);
    if (model === Model.TaxiSedan) {
      taxiSign(mb, body, 2.62, lod);
    } else if (model === Model.TaxiDoblo) {
      taxiSign(mb, body, 2.3, lod);
    }
    return mb.build();
  }
  switch (model) {
    case Model.Bus:
      busModel(mb, lod);
      break;
    case Model.Truck:
      truckModel(mb, lod);
      break;
    case Model.Moto:
      motoModel(mb, lod);
      break;
    case Model.CitadisEnd:
      citadisModel(mb, lod, true);
      break;
    case Model.CitadisMid:
      citadisModel(mb, lod, false);
      break;
    case Model.Nostalgic:
      nostalgicModel(mb, lod);
      break;
    default:
      throw new Error(`[osm:traffic] unknown model ${model}`);
  }
  return mb.build();
}

const lightCache = new Map<number, ModelLights>();

export function modelLights(model: number): ModelLights {
  const hit = lightCache.get(model);
  if (hit) {
    return hit;
  }
  let out: ModelLights;
  const car = carDef(model);
  const L = MODEL_LENGTH[model];
  if (car) {
    const body = new Body(car.spec, 0);
    const h = anchor(body, car.front.head, false);
    const t = anchor(body, car.rear.tail, true);
    out = {
      head: [
        [-h[0], h[1], h[2]],
        [h[0], h[1], h[2]],
      ],
      tail: [
        [-t[0], t[1], t[2]],
        [t[0], t[1], t[2]],
      ],
    };
  } else if (model === Model.Bus) {
    const body = new Body(busSpec(), 0);
    const h = anchor(body, { x0: 0.82, x1: 1.18, y0: 0.52, y1: 0.68 }, false);
    const t = anchor(body, { x0: 1.06, x1: 1.2, y0: 0.62, y1: 1.5 }, true);
    out = {
      head: [
        [-h[0], h[1], h[2]],
        [h[0], h[1], h[2]],
      ],
      tail: [
        [-t[0], t[1], t[2]],
        [t[0], t[1], t[2]],
      ],
    };
  } else if (model === Model.Moto) {
    out = { head: [[0, 0.86, -0.64]], tail: [[0, 0.7, 0.78]] };
  } else if (model === Model.Truck) {
    out = {
      head: [
        [-0.77, 0.99, -L / 2 - 0.02],
        [0.77, 0.99, -L / 2 - 0.02],
      ],
      tail: [
        [-0.85, 0.8, L / 2 + 0.05],
        [0.85, 0.8, L / 2 + 0.05],
      ],
    };
  } else if (model === Model.CitadisEnd) {
    out = {
      head: [
        [-0.79, 0.88, -L / 2 + 0.28],
        [0.79, 0.88, -L / 2 + 0.28],
      ],
      tail: [],
    };
  } else if (model === Model.Nostalgic) {
    out = { head: [[0, 1.18, -L / 2 - 0.05]], tail: [] };
  } else {
    out = { head: [], tail: [] };
  }
  lightCache.set(model, out);
  return out;
}
