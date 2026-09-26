/**
 * Weathering of the façade kit (format 1.1): where physics puts dirt, and the colour drift of old paint.
 *
 * Everything here is a deterministic function of world position and the building's plan, so shared vertices of a
 * welded wall sheet (frame.ts Batch.sheet) agree and gradients stay continuous across cells:
 * - `_WEATHER` [dirt, streak, edge, damp] of wall vertices (wallWeather): grime in concave corners, under slabs,
 *   çıkma soffits and the roof edge; run-off streaks below slab lines and cornices; edge wear on convex corners and
 *   the parapet top; rising damp and splash 0.3–1.2 m at the wall base.
 * - COLOR_0 of painted walls (paintAt): macro mottling (no two square metres alike), sun fading on south- and
 *   west-facing faces (lighter, greyer towards the top), dust, contact darkening at the ground.
 * - A low-frequency tilt of the shading normal (wavyTilt): hand-floated render is never flat.
 */
import type { RGBA, Weather } from '../mesh';
import { h01, mix, scale } from './frame';

/* Noise. */

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0, 1] on a unit lattice (2D), seeded. */
export function vnoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const at = (i: number, j: number): number => h01(seed + i * 0.1731 + j * 0.3197, i * 12.37 + j * 7.91);
  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const d = at(x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Two octaves of value noise in [0, 1] at `scale` metres. */
export function fbm(x: number, y: number, scaleM: number, seed: number): number {
  return (vnoise(x / scaleM, y / scaleM, seed) * 2 + vnoise((x / scaleM) * 2.3 + 17.1, (y / scaleM) * 2.3 - 3.7, seed + 5.3)) / 3;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/* Wall description the functions read (built per edge by build.ts). */

export interface WallInfo {
  /** Building seed and wear (0 clean .. 1 heavily worn). */
  seed: number;
  wear: number;
  /** Edge length and ends: convex ends get edge wear, concave ends and party joints collect grime. */
  len: number;
  convexL: boolean;
  convexR: boolean;
  /** Ground height in front of the wall at r. */
  gAt: (r: number) => number;
  /** Top of the wall (parapet top or eave) and the roof slab. */
  wallTop: number;
  roofY: number;
  /** First floor line (top of the shop band) and the upper floor lines. */
  G1: number;
  floors: readonly number[];
  /** Çıkma span on this wall (grime under its soffit and in the corners it makes), if any. */
  cikma: { c0: number; c1: number; y0: number } | null;
  /** Unit outward normal (x, z) and the world position of r = 0 (for world-anchored noise). */
  nx: number;
  nz: number;
  ox: number;
  oz: number;
  rx: number;
  rz: number;
  /** Cornice or deep eave at the roof line (heavier run-off below it). */
  cornice: boolean;
  /** Party wall (blank, unpainted side): more grime, no damp band at a shop base. */
  party: boolean;
}

/** World-anchored along-wall coordinate (so noise continues around corners at similar heights). */
function along(w: WallInfo, r: number): number {
  return (w.ox + w.rx * r) * 0.71 + (w.oz + w.rz * r) * 0.53;
}

/** `_WEATHER` of a wall vertex at frame (r, y) on the wall plane. */
export function wallWeather(w: WallInfo, r: number, y: number): Weather {
  const a = along(w, r);
  const g = w.gAt(r);
  const k = 0.55 + 0.9 * w.wear;
  const patch = fbm(a, y, 2.6, w.seed);
  // Dirt: a patchy base, concave ends, under the roof edge, under the çıkma soffit and in its corners.
  let dirt = (0.05 + 0.22 * patch) * (w.party ? 1.5 : 1);
  if (!w.convexL) {
    dirt += 0.55 * clamp01(1 - r / 0.55);
  }
  if (!w.convexR) {
    dirt += 0.55 * clamp01(1 - (w.len - r) / 0.55);
  }
  dirt += 0.45 * clamp01((y - (w.wallTop - 0.9)) / 0.9);
  for (const fy of w.floors) {
    if (y < fy && y > fy - 0.4) {
      dirt += 0.18 * (1 - (fy - y) / 0.4);
    }
  }
  const ck = w.cikma;
  if (ck) {
    if (y < ck.y0 && y > ck.y0 - 0.9 && r > ck.c0 - 0.4 && r < ck.c1 + 0.4) {
      dirt += 0.6 * (1 - (ck.y0 - y) / 0.9);
    }
    if (y > ck.y0) {
      const dc = Math.min(Math.abs(r - ck.c0), Math.abs(r - ck.c1));
      dirt += 0.4 * clamp01(1 - dc / 0.5);
    }
  }
  // Streaks: run-off below the roof edge / cornice and below every slab line, broken up along the wall.
  const runs = fbm(a * 1.7, 0, 1.3, w.seed + 11);
  let streak = 0.08 * patch;
  const topRun = w.cornice ? 2.6 : 1.8;
  const yTop = w.wallTop - 0.15;
  if (y < yTop && y > yTop - topRun) {
    streak += (0.3 + 0.5 * runs) * Math.pow(1 - (yTop - y) / topRun, 0.8);
  }
  for (const fy of w.floors) {
    if (y < fy && y > fy - 1.3) {
      streak += (0.08 + 0.45 * runs) * Math.pow(1 - (fy - y) / 1.3, 1.2) * (0.4 + 0.6 * fbm(a, fy, 3.1, w.seed + 29));
    }
  }
  // Edge wear on the parapet / eave arris (corners: the chamfer strips of build.ts carry it).
  const edge = 0.7 * clamp01(1 - (w.wallTop - y) / 0.8);
  // Rising damp and splash at the base: 0.3-1.2 m, wavy along the wall.
  const hd = 0.3 + 0.9 * clamp01(0.25 + 0.55 * fbm(a, 0, 1.9, w.seed + 41) + 0.3 * w.wear);
  const damp = y < g + hd ? Math.pow(1 - clamp01((y - g) / hd), 1.35) : 0;
  return [clamp01(dirt * k), clamp01(streak * (0.5 + w.wear)), clamp01(edge * (0.6 + 0.6 * w.wear)), clamp01(damp * (0.65 + 0.5 * w.wear))];
}

/** Sun-exposure of a face (x, z normal): 1 facing south-south-west (Istanbul's afternoon sun), 0 facing north. */
export function sunExposure(nx: number, nz: number): number {
  // World frame: +X east, +Z south. SSW = (-0.45, 0.89).
  return clamp01(nx * -0.45 + nz * 0.89);
}

/**
 * Painted wall colour at frame (r, y): the plan's paint, mottled at 0.9 and 2.8 m, faded where the sun hits (south
 * and west faces, more towards the top), dustier near the ground, darker in the contact zone at the base.
 */
export function paintAt(w: WallInfo, base: RGBA, r: number, y: number): RGBA {
  const a = along(w, r);
  const g = w.gAt(r);
  const big = fbm(a, y, 2.8, w.seed + 3) - 0.5;
  const small = vnoise(a / 0.9 + 3.1, y / 0.9, w.seed + 7) - 0.5;
  let c = scale(base, 1 + 0.16 * big + 0.07 * small);
  // Old paint drifts towards a grey-brown dust tone, unevenly.
  const dust: RGBA = [0.42, 0.39, 0.35, 1];
  c = mix(c, scale(dust, (c[0] + c[1] + c[2]) / 3 / 0.39), 0.05 + 0.12 * clamp01(0.5 + big) * (0.5 + w.wear));
  // Sun fading: towards a lighter, greyer version of the paint, strongest high on south / west faces.
  const sun = sunExposure(w.nx, w.nz);
  if (sun > 0) {
    const lum = (c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15) * 1.18;
    const faded: RGBA = [lum * 1.02, lum, lum * 0.95, 1];
    const height = clamp01((y - g) / Math.max(3, w.wallTop - g));
    c = mix(c, faded, sun * (0.1 + 0.22 * height) * (0.7 + 0.6 * w.wear));
  }
  // Contact darkening in the first 0.35 m (splash and AO); the damp layer adds the wet band on top.
  if (y < g + 0.35) {
    c = scale(c, 0.8 + 0.2 * clamp01((y - g) / 0.35));
  }
  return [Math.min(1, c[0]), Math.min(1, c[1]), Math.min(1, c[2]), base[3]];
}

/** Low-frequency normal tilt (radians about the wall's r and y axes): about ±1.2° waves of 1.5–4 m. */
export function wavyTilt(w: WallInfo, r: number, y: number): [number, number] {
  const a = along(w, r);
  const amp = 0.021 * (0.6 + 0.6 * w.wear);
  return [(fbm(a, y, 1.7, w.seed + 71) - 0.5) * 2 * amp, (fbm(a + 9.3, y, 2.1, w.seed + 83) - 0.5) * 2 * amp];
}
