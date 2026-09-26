/**
 * Where and how often dolphin pods show (pure logic, no engine): the spawn rate from the time of day, the sea state and
 * the weather, and the choice of an open-water site within view of the camera, away from the shore, the traffic lanes,
 * the ferry routes and the vessels. The headless check runs the same functions on the real geography.
 */
import { DOLPHIN_SEA, DOLPHIN_SPAWN, DOLPHIN_TIME_WEIGHT } from './config';

/** What the spawn rate depends on. */
export interface SpawnConditions {
  /** Local time of day (h). */
  hours: number;
  /** Significant wave height of the open sea (m) and the 10 m wind (m/s), from the water service. */
  waveHeight: number;
  windSpeed: number;
  /** Smoothed weather 0..1 (render/weather `current`). */
  rain: number;
  storm: number;
  fog: number;
}

function lerpTable(table: readonly (readonly [number, number])[], x: number): number {
  for (let i = 0; i + 1 < table.length; i++) {
    const [x0, y0] = table[i];
    const [x1, y1] = table[i + 1];
    if (x >= x0 && x <= x1) {
      return y0 + ((y1 - y0) * (x - x0)) / Math.max(1e-9, x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Time-of-day weight (more in the morning, few at night). */
export function timeWeight(hours: number): number {
  const h = ((hours % 24) + 24) % 24;
  return lerpTable(DOLPHIN_TIME_WEIGHT, h);
}

/** Sea and weather weight: calm seas favoured, none in rough seas, strong wind or a storm. */
export function seaWeight(c: SpawnConditions): number {
  const S = DOLPHIN_SEA;
  if (c.storm > S.stormCut || c.windSpeed > S.maxWind || !(c.waveHeight < S.rough)) {
    return 0;
  }
  const calm = c.waveHeight <= S.calm ? S.calmBonus : 1 - smooth(S.calm, S.rough, c.waveHeight);
  const weather = (1 - S.rainCut * Math.min(1, Math.max(0, c.rain))) * (1 - S.fogCut * Math.min(1, Math.max(0, c.fog)));
  return Math.max(0, calm * weather);
}

/** Pods per second somewhere within view under these conditions. */
export function spawnRate(c: SpawnConditions): number {
  return DOLPHIN_SPAWN.baseRate * timeWeight(c.hours) * seaWeight(c);
}

/** The geography and traffic a site is checked against (adapters over GeoQuery, LaneField and the fleet). */
export interface SpawnWorld {
  isWater(x: number, z: number): boolean;
  /** Signed distance to the coast (m): positive on land, negative over water. */
  coastDistance(x: number, z: number): number;
  /** Terrain height (m; negative = sea floor). */
  heightAt(x: number, z: number): number;
  /** Name of the water body (the Golden Horn is excluded), when known. */
  waterName?(x: number, z: number): string | null;
  /** Distance to the nearest lane or ferry route (m, capped). */
  laneDistance(x: number, z: number): number;
  /** Distance from the strait's centreline (m); its course (unit, north → south) into `out`. */
  course(x: number, z: number, out: { x: number; z: number }): number;
  /** Distance to the nearest vessel (m, capped). */
  vesselDistance(x: number, z: number): number;
}

export type SiteRefusal = 'land' | 'shore' | 'shallow' | 'region' | 'lane' | 'vessel' | null;

const scratchCourse = { x: 0, z: 1 };

/** Why (x, z) is not a dolphin site, or null when it is one. */
export function siteRefusal(w: SpawnWorld, x: number, z: number): SiteRefusal {
  const S = DOLPHIN_SPAWN;
  if (!w.isWater(x, z)) return 'land';
  if (w.coastDistance(x, z) > -S.minShore) return 'shore';
  if (w.heightAt(x, z) > -S.minDepth) return 'shallow';
  const name = w.waterName?.(x, z);
  if (name === 'Haliç' || w.course(x, z, scratchCourse) > S.maxFromStrait) return 'region';
  if (w.laneDistance(x, z) < S.minLane) return 'lane';
  if (w.vesselDistance(x, z) < S.minVessel) return 'vessel';
  return null;
}

export interface SpawnSite {
  x: number;
  z: number;
  /** Unit heading of the pod's travel (along the strait, either way). */
  hx: number;
  hz: number;
}

/**
 * A site within view: `camX/camZ` the camera, `fwdX/fwdZ` its horizontal view direction (unit). Tries a few random
 * points in the distance band around the view; null when none is open water away from the traffic.
 */
export function findSpawnSite(
  w: SpawnWorld,
  camX: number,
  camZ: number,
  fwdX: number,
  fwdZ: number,
  rng: () => number,
  band: { near: number; far: number; halfAngle: number } = { near: DOLPHIN_SPAWN.nearDistance, far: DOLPHIN_SPAWN.farDistance, halfAngle: DOLPHIN_SPAWN.halfAngle },
): SpawnSite | null {
  const base = Math.atan2(fwdX, fwdZ);
  for (let i = 0; i < DOLPHIN_SPAWN.tries; i++) {
    const a = base + (rng() * 2 - 1) * band.halfAngle;
    const d = band.near + (band.far - band.near) * rng();
    const x = camX + Math.sin(a) * d;
    const z = camZ + Math.cos(a) * d;
    if (siteRefusal(w, x, z) !== null) continue;
    const c = { x: 0, z: 1 };
    w.course(x, z, c);
    const sign = rng() < 0.5 ? -1 : 1;
    return { x, z, hx: c.x * sign, hz: c.z * sign };
  }
  return null;
}
