/**
 * Where the stork kettle appears when the moment starts: ahead of the dragon and in view, on the best real thermal
 * the lift field (src/dragon/flight/lift.ts, the same field the dragon flies in) offers there, so the player can
 * actually join the spiral. Storks avoid thermals over the sea; over the strait the search reaches the hills of both
 * shores. When no usable thermal is in view (evening, haze, all water ahead) the kettle still appears ahead with a
 * plausible column of its own (the flock's minimum updraft, STORK_SITE.minUpdraft).
 */
import * as THREE from 'three';
import type { GeoQuery } from '../../core/contracts';
import { createLiftSample, sampleLift, type LiftConditions } from '../../dragon/flight/lift';

export const STORK_SITE = {
  /** Search ring ahead of the dragon (m) and half angle of the search cone (deg). */
  minDistance: 320,
  maxDistance: 1000,
  halfAngleDeg: 54,
  /** Kettle base below the dragon (m) and the kettle's depth (m). */
  baseBelow: 60,
  depth: 250,
  /** Ground clearance of the kettle base (m) and its ceiling (m ASL). */
  clearance: 120,
  ceiling: 1600,
  /** Thermal (m/s) at which a site counts as a real thermal. */
  realThermal: 0.8,
  /** Updraft the flock assumes at least (m/s): with ~1 m/s sink that is a ~1.8 m/s climb. */
  minUpdraft: 2.8,
  /** Glide course: compass bearing (deg) and random spread (±deg). South: the eastern flyway's storks cross the strait
   * and continue south to south-east over Anatolia toward the Levant. */
  courseDeg: 185,
  courseSpreadDeg: 15,
} as const;

export interface KettleSite {
  x: number;
  z: number;
  baseY: number;
  topY: number;
  /** Thermal updraft measured at the site (m/s, at mid-kettle height). */
  thermal: number;
  /** A real thermal of the lift field (≥ STORK_SITE.realThermal). */
  real: boolean;
  /** Glide course (unit x/z). */
  courseX: number;
  courseZ: number;
  /** Distance and bearing offset from the dragon's heading (m, deg). */
  distance: number;
  offsetDeg: number;
}

const _sample = createLiftSample();

/** Compass bearing (0 = north = -z, 90 = east = +x) to a unit x/z direction. */
export function bearingToDir(deg: number): { x: number; z: number } {
  const r = (deg * Math.PI) / 180;
  return { x: Math.sin(r), z: -Math.cos(r) };
}

/**
 * Picks the kettle site: candidates on rings ahead of the dragon within the view cone, scored by the lift field's
 * thermal at mid-kettle height (land only), with a small preference for the centre of view and a middle distance.
 * `rand` 0..1 varies the course.
 */
export function chooseKettleSite(geo: GeoQuery, cond: LiftConditions, x: number, z: number, altitude: number, headingDeg: number, rand = 0.5): KettleSite {
  const S = STORK_SITE;
  let best: KettleSite | null = null;
  let bestScore = -Infinity;
  for (let d = S.minDistance; d <= S.maxDistance + 1e-6; d += 85) {
    for (let a = -S.halfAngleDeg; a <= S.halfAngleDeg + 1e-6; a += 13.5) {
      const dir = bearingToDir(headingDeg + a);
      const cx = x + dir.x * d;
      const cz = z + dir.z * d;
      const ground = Math.max(0, geo.heightAt(cx, cz));
      const baseY = Math.max(ground + S.clearance, altitude - S.baseBelow);
      const topY = Math.min(S.ceiling, baseY + S.depth);
      const mid = (baseY + topY) / 2;
      const water = geo.isWater(cx, cz);
      sampleLift(geo, cx, cz, mid - ground, cond, _sample);
      const thermal = water ? Math.min(0, _sample.thermal) : _sample.thermal;
      const view = 1 - Math.abs(a) / (S.halfAngleDeg * 1.6);
      const mid01 = 1 - Math.abs(d - 450) / 700;
      const score = thermal + 0.35 * view + 0.25 * mid01 - (water ? 0.6 : 0);
      if (score > bestScore) {
        bestScore = score;
        const course = bearingToDir(S.courseDeg + (rand * 2 - 1) * S.courseSpreadDeg);
        best = { x: cx, z: cz, baseY, topY, thermal, real: thermal >= S.realThermal, courseX: course.x, courseZ: course.z, distance: d, offsetDeg: a };
      }
    }
  }
  return best!;
}

/** Lift conditions from the environment (sun, wind) with a weather factor on the sunshine. */
export function liftConditions(sun: THREE.Vector3, wind: THREE.Vector3, time: number, insolation = 1): LiftConditions {
  return { sunDirection: sun, wind, time, insolation };
}
