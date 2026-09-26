import * as THREE from 'three';
import { clamp, SimplexNoise, smoothstep } from '../../core/math/noise';
import { LandUse, type GeoQuery } from '../../core/contracts';

/**
 * Vertical air motion over the terrain: convective thermals and orographic (ridge) lift. Pure and allocation-free,
 * so the flight model, birds circling in thermals or a debug overlay can all query the same field.
 *
 * Thermals: the sun heats the ground (sun elevation, slope aspect toward the sun, land use), the heated air collects
 * and releases from summits and ridges (topographic position) and from drifting convective cells, and the column
 * leans downwind with height. Strongest over concrete and open ground in the afternoon, weak over forest, none over
 * water or at night.
 *
 * Ridge lift: air following the terrain rises at w = U · ∇h (U the boundary-layer wind), with the terrain gradient
 * taken over a baseline that grows with height (the flow aloft sees the whole hill, not the local bumps) and the
 * windward speed-up of low hills; weaker lee-side sink where the flow separates.
 */

/** Sun and wind that drive the lift field. */
export interface LiftConditions {
  /** Unit vector toward the sun (world, +Y up). */
  readonly sunDirection: THREE.Vector3;
  /** Wind at 100 m (m/s, world x/z; where the air moves to). */
  readonly wind: THREE.Vector3;
  /** Seconds on the drift clock of the convective cells (any monotonic clock; the sim uses its own time). */
  readonly time: number;
  /** Multiplier on the sunshine reaching the ground (clouds, weather); 1 = clear sky. Default 1. */
  readonly insolation?: number;
}

/** Breakdown of one lift sample (all m/s unless noted). */
export interface LiftSample {
  /** thermal + ridge. */
  total: number;
  /** Convective updraft (negative: sink between cells, cooling over the sea). */
  thermal: number;
  /** Orographic lift (negative on lee slopes). */
  ridge: number;
  /** Ground heating at the column's source, 0..~1.2 (sun, aspect, land use). */
  heating: number;
  /** Thermal release pattern at the source 0..1 (summit trigger or drifting cell core). */
  trigger: number;
  /** Convective strength 0..1 (sun height, afternoon heat soak, clouds, wind shear). */
  convection: number;
  /** Top of the convective layer above ground (m). */
  depth: number;
}

export function createLiftSample(): LiftSample {
  return { total: 0, thermal: 0, ridge: 0, heating: 0, trigger: 0, convection: 0, depth: 0 };
}

export const LIFT = {
  /** Peak thermal updraft (m/s) for full heating, full convection and a full trigger. */
  thermalMax: 5.6,
  /** Rise speed used for the downwind lean of a thermal column (m/s). */
  leanRise: 3,
  /** Horizontal lean cap (m). */
  leanMax: 2500,
  /** Radius (m) of the ground catchment feeding a column. */
  catchment: 220,
  /** Ring radius (m) for the topographic position (summit / ridge) test. */
  tpiRadius: 450,
  /** Height above the surrounding ring (m) where the summit trigger starts / is full. */
  tpiStart: 6,
  tpiFull: 40,
  /** Sink between thermal cells over heated land (m/s at full heating). */
  cellSink: 0.4,
  /** Sink over the sea on a sunny day (m/s): the land's thermals draw air that subsides over the water. */
  seaSink: 0.25,
  /** Gradient baseline for ridge lift: base + per metre of height above ground. */
  ridgeBase: 40,
  ridgePerMeter: 0.5,
  /** Height scale (m) of the ridge-lift decay above the surface. */
  ridgeDecay: 350,
  /** Windward speed-up of low hills: ΔS = min(k · slope, max). */
  speedUpSlope: 2,
  speedUpMax: 0.6,
  /** Lee-side sink as a fraction of the windward formula (separated flow). */
  leeFactor: 0.6,
} as const;

/** Relative sensible heat flux by land use (dry late-summer ground; concrete and bare ground strongest). */
const HEAT: Record<LandUse, number> = {
  [LandUse.Water]: 0,
  [LandUse.Beach]: 0.6,
  [LandUse.Urban]: 1,
  [LandUse.HistoricUrban]: 1,
  [LandUse.Highrise]: 0.95,
  [LandUse.Industrial]: 1.05,
  [LandUse.Park]: 0.45,
  [LandUse.Forest]: 0.3,
  [LandUse.Farmland]: 0.9,
  [LandUse.Airport]: 1.05,
  [LandUse.Cemetery]: 0.5,
  [LandUse.Landmark]: 0.85,
  [LandUse.Road]: 1,
  [LandUse.Suburban]: 0.8,
};

const RING = 6;
const RING_COS = Array.from({ length: RING }, (_, i) => Math.cos((i / RING) * Math.PI * 2));
const RING_SIN = Array.from({ length: RING }, (_, i) => Math.sin((i / RING) * Math.PI * 2));
const _n = new THREE.Vector3();
const _scratch = createLiftSample();
const cellNoise = new SimplexNoise(9127);

/** Mean-wind boundary-layer profile relative to 100 m (same law as the flight model's WindField). */
export function windProfile(agl: number): number {
  return clamp(Math.pow(Math.max(agl, 2) / 100, 0.22), 0.3, 1.6);
}

/** Water surface counts as flat ground at 0 m. */
function surface(geo: GeoQuery, x: number, z: number): number {
  return Math.max(geo.heightAt(x, z), 0);
}

/**
 * Convective strength from the sun alone: none below ~5° elevation, full with a high sun, and a heat-soaked ground in
 * the afternoon (sun in the west) keeps it higher than the same sun height in the morning.
 */
export function convectionStrength(sun: THREE.Vector3, insolation = 1): number {
  const height = smoothstep(0.08, 0.7, sun.y);
  const horizontal = Math.hypot(sun.x, sun.z);
  const west = horizontal > 1e-3 ? -sun.x / horizontal : 0;
  const soak = 0.78 + 0.22 * smoothstep(-0.3, 0.7, west);
  return height * soak * clamp(insolation, 0, 1);
}

/** Heating of one ground point relative to flat urban ground under the same sun (land use x slope aspect). */
function groundHeat(geo: GeoQuery, x: number, z: number, sun: THREE.Vector3): number {
  const heat = HEAT[geo.landUseAt(x, z)] ?? 0.5;
  if (heat <= 0) {
    return 0;
  }
  geo.normalAt(x, z, _n);
  const flat = Math.max(sun.y, 0.1);
  const incidence = Math.max(_n.x * sun.x + _n.y * sun.y + _n.z * sun.z, 0);
  return heat * clamp(incidence / flat, 0, 1.5);
}

/**
 * Vertical air motion (m/s) at `agl` metres above the terrain (or water) at x, z. Fills `out` with the breakdown
 * when given. Pure: the same inputs always give the same value.
 */
export function sampleLift(geo: GeoQuery, x: number, z: number, agl: number, cond: LiftConditions, out: LiftSample = _scratch): number {
  const wx = cond.wind.x;
  const wz = cond.wind.z;
  const wind100 = Math.hypot(wx, wz);
  const h = Math.max(agl, 0);

  // --- thermals ---------------------------------------------------------------------------------
  const convection = convectionStrength(cond.sunDirection, cond.insolation ?? 1) * (1 - 0.6 * smoothstep(4, 12, wind100));
  const depth = 400 + 1300 * convection;
  let thermal = 0;
  let heating = 0;
  let trigger = 0;
  if (convection > 0) {
    // The column leans downwind: the air at this height left the ground upwind by U · t, t = h / rise.
    const lean = Math.min((h / LIFT.leanRise) * windProfile(h * 0.5), LIFT.leanMax / Math.max(wind100, 1e-3));
    const sx = x - wx * lean;
    const sz = z - wz * lean;

    // Ground catchment feeding the column: land use and the sun on the slopes around the source.
    const sun = cond.sunDirection;
    let heat = groundHeat(geo, sx, sz, sun) * 2;
    let ring = 0;
    const hc = surface(geo, sx, sz);
    for (let i = 0; i < RING; i++) {
      heat += groundHeat(geo, sx + RING_COS[i] * LIFT.catchment, sz + RING_SIN[i] * LIFT.catchment, sun);
      ring += surface(geo, sx + RING_COS[i] * LIFT.tpiRadius, sz + RING_SIN[i] * LIFT.tpiRadius);
    }
    heating = heat / (RING + 2);

    // Release: summits and ridges (above their surroundings) hold a standing column; elsewhere drifting cells.
    const tpi = hc - ring / RING;
    const summit = smoothstep(LIFT.tpiStart, LIFT.tpiFull, tpi);
    const drift = cond.time * 0.8;
    const n =
      cellNoise.noise2((sx - wx * drift) / 850, (sz - wz * drift) / 850) * 0.75 + cellNoise.noise2(sx / 310 + 17.3, sz / 310 - 4.1) * 0.25;
    const cell = smoothstep(0.35, 0.8, n);
    trigger = Math.max(cell, summit);
    const between = smoothstep(0.0, -0.6, n) * (1 - summit);

    const profile = smoothstep(10, 120, h) * (1 - smoothstep(0.75 * depth, depth, h));
    thermal = (LIFT.thermalMax * trigger - LIFT.cellSink * between) * heating * convection * profile;
  }
  if (geo.heightAt(x, z) < -0.4) {
    // No thermals over the sea: the land's convection draws air that slowly subsides over the cooler water.
    thermal = -LIFT.seaSink * convection * smoothstep(20, 200, h);
  }

  // --- ridge lift -------------------------------------------------------------------------------
  let ridge = 0;
  if (wind100 > 0.1) {
    const ux = wx / wind100;
    const uz = wz / wind100;
    const d = LIFT.ridgeBase + LIFT.ridgePerMeter * h;
    const slope = (surface(geo, x + ux * d, z + uz * d) - surface(geo, x - ux * d, z - uz * d)) / (2 * d);
    const speed = wind100 * windProfile(h);
    const speedUp = 1 + Math.min(LIFT.speedUpSlope * Math.max(slope, 0), LIFT.speedUpMax);
    ridge = speed * slope * (slope > 0 ? speedUp : LIFT.leeFactor) * Math.exp(-h / LIFT.ridgeDecay);
  }

  out.thermal = thermal;
  out.ridge = ridge;
  out.total = thermal + ridge;
  out.heating = heating;
  out.trigger = trigger;
  out.convection = convection;
  out.depth = depth;
  return out.total;
}

/** `sampleLift` at a world altitude `y` (height above the terrain or water surface below). */
export function liftAt(geo: GeoQuery, x: number, y: number, z: number, cond: LiftConditions, out?: LiftSample): number {
  return sampleLift(geo, x, z, y - surface(geo, x, z), cond, out);
}
