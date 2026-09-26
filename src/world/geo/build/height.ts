import type { BuildInput } from '../types';
import { CapMode } from '../../landmarks/structure-volumes';
import { HEIGHT_GRID, sampleBilinear } from './grid';
import type { NoiseFrame } from './noise-tile';
import { stampDisc, stampPolyline } from './raster';
import type { CoarseUpsampler } from './upsample';

export interface HeightFields {
  /** Land relief spline (m). */
  land: CoarseUpsampler;
  /** 0..1 where dense spot heights pin the relief (real hills already present, less synthetic dissection). */
  coverage: CoarseUpsampler;
  /** Sea depth spline (positive m). */
  depth: CoarseUpsampler;
  /** Underwater shore ramp length (m). */
  shelf: CoarseUpsampler;
}

export interface HeightNoise {
  fine: NoiseFrame;
  medium: NoiseFrame;
}

const MIN_LAND = 0.6;
/** E[2·|n|] of the world noise frames (measured): subtracting it makes billow noise zero-mean. */
const BILLOW_MEAN = 0.29;

/**
 * Base terrain: regional spline relief + dissection noise, ramped down to ~1 m at the shoreline;
 * sea floor from the depth spline ramped up to ~−0.6 m at the shore. Sign always matches the coast mask.
 */
export function composeBaseHeights(
  coast: Float32Array,
  lakeDepth: Uint8Array,
  beachness: Uint8Array,
  nearLake: Uint8Array,
  fields: HeightFields,
  noise: HeightNoise,
): Float32Array {
  const g = HEIGHT_GRID;
  const n = g.size;
  const out = new Float32Array(n * n);
  const rowLand = new Float32Array(n);
  const rowCover = new Float32Array(n);
  const rowDepth = new Float32Array(n);
  const rowShelf = new Float32Array(n);
  for (let r = 0; r < n; r++) {
    fields.land.row(r, rowLand);
    fields.coverage.row(r, rowCover);
    fields.depth.row(r, rowDepth);
    fields.shelf.row(r, rowShelf);
    const z = g.origin + r * g.cell;
    for (let c = 0; c < n; c++) {
      const k = r * n + c;
      const x = g.origin + c * g.cell;
      const d = coast[k];
      const fine = noise.fine.at(x, z);
      const beach = beachness[k] * (1 / 255);
      if (d >= 0) {
        const F = rowLand[c] > 2 ? rowLand[c] : 2;
        const med = noise.medium.at(x, z);
        const cover = rowCover[c] < 0 ? 0 : rowCover[c] > 1 ? 1 : rowCover[c];
        let dissect = (F - 12) * 0.19 * (1 - 0.6 * cover);
        dissect = dissect < 0 ? 0 : dissect > 48 ? 48 : dissect;
        // Billow noise (sharp creases, rounded crests) centred on zero so the surveyed spline level is kept.
        const gully = noise.fine.at(x * 0.45 + 311, z * 0.45 - 97);
        const ravine = (F > 20 ? (F - 20) * 0.07 : 0) * (Math.abs(gully) * 2 - BILLOW_MEAN);
        const detail = dissect * (Math.abs(med) * 2 - BILLOW_MEAN) + ravine + (1.5 + 0.03 * F) * fine;
        let h0 = F + detail;
        const shoreH = 1.3 - 0.75 * beach;
        if (h0 < shoreH + 0.5) {
          h0 = shoreH + 0.5;
        }
        // Lakes sit at sea level (the water plane), so their banks get long valley-like ramps.
        const ramp = 1 - Math.exp(-d / (135 + 220 * beach + 520 * nearLake[k] * (1 / 255)));
        const h = shoreH + (h0 - shoreH) * ramp;
        out[k] = h > MIN_LAND ? h : MIN_LAND;
      } else {
        const lake = lakeDepth[k];
        let D: number;
        let L: number;
        if (lake > 0) {
          D = lake;
          L = 55;
        } else {
          D = rowDepth[c] > 3 ? rowDepth[c] : 3;
          // Sandy shores slope gently, but only in the near-shore band (no circular shoals offshore).
          const nearShore = d > -150 ? 1 : d < -450 ? 0 : (d + 450) / 300;
          L = rowShelf[c] + 260 * beach * nearShore;
        }
        const e = 1 - Math.exp(d / L);
        const h = -(0.6 + (D - 0.6) * e) + fine * 1.4 * e;
        out[k] = h < -0.3 ? h : -0.3;
      }
    }
  }
  return out;
}

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * Carves river valleys: flat floors following the surveyed profile, smooth shoulders, straight walls.
 * The carve fades out over the outer part of each valley's reach so interfluves keep their surveyed height
 * (no shoulder step where the reach ends).
 */
export function carveValleys(height: Float32Array, coast: Float32Array, rivers: BuildInput['rivers'], noise: HeightNoise): void {
  const g = HEIGHT_GRID;
  const n = g.size;
  const valley = new Float32Array(height.length).fill(Infinity);
  for (const river of rivers) {
    const pts = river.pts;
    const m = pts.length / 3;
    const flat = new Float64Array(m * 2);
    for (let i = 0; i < m; i++) {
      flat[i * 2] = pts[i * 3];
      flat[i * 2 + 1] = pts[i * 3 + 1];
    }
    const hw = river.halfWidth;
    const slope = Math.max(0.12, river.wallSlope);
    const reach = hw + Math.min(900, Math.max(300, 110 / slope));
    const fadeStart = hw + (reach - hw) * 0.45;
    const fadeLen = reach - fadeStart;
    stampPolyline(flat, reach, g, (k, dist, seg, t) => {
      if (coast[k] <= 0) {
        return;
      }
      const floor = pts[seg * 3 + 2] + (pts[seg * 3 + 5] - pts[seg * 3 + 2]) * t;
      // Irregular valley: floor width and wall steepness wander with position.
      const x = g.origin + (k % n) * g.cell;
      const z = g.origin + ((k / n) | 0) * g.cell;
      const wobble = noise.medium.at(x * 0.35 + 900, z * 0.35 - 400);
      const u = dist - hw * (1 + 0.45 * wobble);
      const wall = u > 0 ? Math.sqrt(u * u + 1600) - 40 : 0;
      const v = floor + 0.6 + slope * (1 - 0.3 * wobble) * wall;
      const h = height[k];
      if (v >= h + 24) {
        return;
      }
      let w = 1;
      if (dist > fadeStart) {
        const f = 1 - (dist - fadeStart) / fadeLen;
        w = f * f * (3 - 2 * f);
      }
      const carved = h + (smin(h, v, 24) - h) * w;
      if (carved < valley[k]) {
        valley[k] = carved;
      }
    });
  }
  for (let k = 0; k < height.length; k++) {
    const v = valley[k];
    if (v === Infinity || coast[k] <= 0) {
      continue;
    }
    if (v < height[k]) {
      height[k] = v > MIN_LAND ? v : MIN_LAND;
    }
  }
}

/**
 * Lowers the ground along authored shore flats: a band `width` m wide measured from the real shoreline at
 * `level` + `rise`·d, then rising at `wallSlope`. Blended with a soft minimum so it only ever cuts.
 */
export function applyShoreFlats(height: Float32Array, coast: Float32Array, flats: BuildInput['flats']): void {
  const g = HEIGHT_GRID;
  const weight = new Uint8Array(height.length);
  const touched: number[] = [];
  for (const f of flats) {
    const inner = f.reach * 0.6;
    const fade = f.reach - inner;
    touched.length = 0;
    stampPolyline(f.pts, f.reach, g, (k, d) => {
      if (coast[k] <= 0) {
        return;
      }
      let w = 1;
      if (d > inner) {
        const t = 1 - (d - inner) / fade;
        w = t * t * (3 - 2 * t);
      }
      const q = Math.round(w * 255);
      if (q > weight[k]) {
        if (weight[k] === 0) {
          touched.push(k);
        }
        weight[k] = q;
      }
    });
    const soft = 18;
    for (const k of touched) {
      const w = weight[k] * (1 / 255);
      weight[k] = 0;
      const d = coast[k];
      const over = d - f.width;
      const wall = over > 40 ? over : soft * Math.log1p(Math.exp(over / soft));
      const v = f.level + f.rise * (d < f.width ? d : f.width) + f.wallSlope * wall;
      const h = height[k];
      if (v >= h + 3) {
        continue;
      }
      const lo = v < h ? v : h;
      let nh = smin(h, v, 3);
      nh = nh > lo - 0.25 ? nh : lo - 0.25;
      const out = h + (nh - h) * w;
      height[k] = out > MIN_LAND ? out : MIN_LAND;
    }
  }
}

/**
 * Adds smooth bumps so authored summits reach their surveyed elevation exactly. Each bump is an anisotropic
 * Gaussian stretched along the ridge heading, with its falloff distance warped by noise so contours wander.
 */
export function raiseSummits(height: Float32Array, coast: Float32Array, summits: BuildInput['summits'], noise: HeightNoise): void {
  const g = HEIGHT_GRID;
  const n = g.size;
  for (const s of summits) {
    const current = sampleBilinear(height, g, s.x, s.z);
    const delta = s.elevation - current;
    // Compass heading → unit ridge direction in x (east) / z (south).
    const ax = Math.sin(s.headingRad);
    const az = -Math.cos(s.headingRad);
    const invAlong2 = 1 / (s.radius * s.elongation) ** 2;
    const invAcross2 = 1 / (s.radius * s.radius);
    stampDisc(s.x, s.z, s.radius * s.elongation * 2.3, g, (k) => {
      if (coast[k] <= 0) {
        return;
      }
      const dx = g.origin + (k % n) * g.cell - s.x;
      const dz = g.origin + ((k / n) | 0) * g.cell - s.z;
      const along = dx * ax + dz * az;
      const across = dz * ax - dx * az;
      const q = along * along * invAlong2 + across * across * invAcross2;
      const warp = 1 + 0.45 * noise.medium.at(s.x * 0.7 + dx * 1.3 + 517, s.z * 0.7 + dz * 1.3 - 229);
      const h = height[k] + delta * Math.exp(-2.2 * q * warp);
      height[k] = h > MIN_LAND ? h : MIN_LAND;
    });
  }
}

/** Flattens landmark pads toward their center elevation; returns the pad elevations. */
export function flattenPads(height: Float32Array, coast: Float32Array, pads: BuildInput['pads']): Float32Array {
  const g = HEIGHT_GRID;
  const out = new Float32Array(pads.length);
  pads.forEach((p, i) => {
    let y = sampleBilinear(height, g, p.x, p.z);
    if (y < 1.2) {
      y = 1.2;
    }
    out[i] = y;
    const outer = p.radius + p.blend;
    stampDisc(p.x, p.z, outer, g, (k, d) => {
      if (coast[k] <= 0) {
        return;
      }
      let w = 1;
      if (d > p.radius) {
        const t = (outer - d) / p.blend;
        w = t * t * (3 - 2 * t);
      }
      w *= p.strength;
      const h = height[k] + (y - height[k]) * w;
      height[k] = h > MIN_LAND ? h : MIN_LAND;
    });
  });
  return out;
}

/** Ground (m) a bridge box may have above its top before the cap lowers it (deck joints meet the street ground). */
export const STRUCTURE_CAP_TOLERANCE = 1.2;
/** The capped ground sits this far (m) above the box top: a deck joint still meets it. */
const STRUCTURE_CAP_LIFT = 0.25;

/**
 * Lowers the terrain wherever it rises above a bridge's road (landmarks/structure-volumes.ts, STRUCTURE_STRIDE floats
 * per box, the deck pieces by their CapMode): an approach cut into a hillside, a cross slope under a wide deck. Boxes are stored with their local x along the bridge axis: every height node over a box and within one
 * cell to either side is capped at its top (bilinear sampling then stays under it across the deck), and the cap rises
 * at 1:1 over the next two cells, so the cut has banks. Nothing widens along the axis, and only ground more than
 * STRUCTURE_CAP_TOLERANCE above the top is touched: where an approach meets the ground nothing moves (the bridge
 * builders end their approaches there), so a rebake of the volumes finds the same deck.
 */
/** Share of a bridge-end deck's half width around the axis where the cap leaves the ground alone. */
const END_AXIS = 0.5;

export function capUnderStructures(height: Float32Array, boxes: ArrayLike<number>, stride: number): number {
  const g = HEIGHT_GRID;
  const grow = g.cell;
  const bank = g.cell * 2;
  let capped = 0;
  for (let o = 0; o + stride <= boxes.length; o += stride) {
    const [cx, cz, hx, hz, yaw, top, mode] = [boxes[o], boxes[o + 1], boxes[o + 2], boxes[o + 3], boxes[o + 4], boxes[o + 7], boxes[o + 8]];
    if (mode === CapMode.None) {
      continue;
    }
    // Near a bridge end: only the ground beside the axis is lowered.
    const end = mode === CapMode.DeckEnd;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const ex = Math.abs(cos) * hx + Math.abs(sin) * hz + grow + bank;
    const ez = Math.abs(sin) * hx + Math.abs(cos) * hz + grow + bank;
    const c0 = Math.max(0, Math.ceil((cx - ex - g.origin) / g.cell));
    const c1 = Math.min(g.size - 1, Math.floor((cx + ex - g.origin) / g.cell));
    const r0 = Math.max(0, Math.ceil((cz - ez - g.origin) / g.cell));
    const r1 = Math.min(g.size - 1, Math.floor((cz + ez - g.origin) / g.cell));
    for (let r = r0; r <= r1; r++) {
      const z = g.origin + r * g.cell;
      for (let c = c0; c <= c1; c++) {
        const x = g.origin + c * g.cell;
        const dx = x - cx;
        const dz = z - cz;
        // Box-local plan coordinates (core/collision.ts convention).
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        const d = Math.max(0, Math.abs(lz) - hz);
        if (Math.abs(lx) > hx || d > grow + bank || (end && Math.abs(lz) < hz * END_AXIS)) {
          continue;
        }
        const cap = top + STRUCTURE_CAP_LIFT + Math.max(0, d - grow);
        const k = r * g.size + c;
        if (height[k] > cap && height[k] > top + STRUCTURE_CAP_TOLERANCE) {
          height[k] = cap;
          capped++;
        }
      }
    }
  }
  return capped;
}
