import type { WorldBounds } from './contracts';

/**
 * Local tangent-plane projection centered on the Bosphorus (between Beşiktaş and Üsküdar).
 * x = east meters, z = south meters (so north is -Z), y = up.
 */
export const WORLD_ORIGIN = { lat: 41.045, lon: 29.02 } as const;

const EARTH_RADIUS = 6_378_137;
const DEG = Math.PI / 180;
const METERS_PER_DEG_LAT = 111_132.954 - 559.822 * Math.cos(2 * WORLD_ORIGIN.lat * DEG) + 1.175 * Math.cos(4 * WORLD_ORIGIN.lat * DEG);
const METERS_PER_DEG_LON = (Math.PI / 180) * EARTH_RADIUS * Math.cos(WORLD_ORIGIN.lat * DEG);

/** Half extent of the playable square (meters). */
export const WORLD_HALF_SIZE = 24_000;

export const WORLD_BOUNDS: WorldBounds = {
  minX: -WORLD_HALF_SIZE,
  maxX: WORLD_HALF_SIZE,
  minZ: -WORLD_HALF_SIZE,
  maxZ: WORLD_HALF_SIZE,
};

/** Maximum flight ceiling (m). */
export const WORLD_CEILING = 4_000;

export function latLonToLocal(lat: number, lon: number): { x: number; z: number } {
  return {
    x: (lon - WORLD_ORIGIN.lon) * METERS_PER_DEG_LON,
    z: -(lat - WORLD_ORIGIN.lat) * METERS_PER_DEG_LAT,
  };
}

export function localToLatLon(x: number, z: number): { lat: number; lon: number } {
  return {
    lat: WORLD_ORIGIN.lat - z / METERS_PER_DEG_LAT,
    lon: WORLD_ORIGIN.lon + x / METERS_PER_DEG_LON,
  };
}

/** Compass heading (0 = north, clockwise) -> yaw around +Y for an object whose forward is -Z. */
export function headingToYaw(headingDeg: number): number {
  return -headingDeg * DEG;
}

/** Yaw around +Y (object forward -Z) -> compass heading degrees in [0, 360). */
export function yawToHeading(yaw: number): number {
  const h = (-yaw / DEG) % 360;
  return h < 0 ? h + 360 : h;
}
