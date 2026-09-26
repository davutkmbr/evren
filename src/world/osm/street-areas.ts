/**
 * Rects of the compiled street areas (tools/world-compiler): the OSM_AREAS street entries plus one square per landing
 * spot (tools/world-compiler/districts/landing-spots.json), each grown to the compiler's 100 m tile grid. Inside
 * these rects the street tiles replace the flight-scale OSM layer up close, so the flight layer must not invent
 * anything there that the tiles do not have (buildings/infill.ts keeps its parcels out).
 *
 * Same computation as tools/world-compiler/lib/areas.mjs readAreas() + cli.ts (tile grid); `npm run check:map`
 * compares the two.
 */
import type { WorldBounds } from '../../core/contracts';
import { latLonToLocal, WORLD_ORIGIN } from '../../core/geo-coords';
import spotsFile from '../../../tools/world-compiler/districts/landing-spots.json';
import { OSM_AREAS } from './area';

/** Tile size (m) of the compiled street layer (tools/world-compiler/src/format.ts TILE_SIZE). */
export const STREET_TILE_SIZE = 100;

export interface StreetAreaRect {
  id: string;
  /** Tile-aligned rect of every tile that touches the area. */
  rect: WorldBounds;
}

interface Spot {
  id: string;
  lat: number;
  lon: number;
  radius: number;
  area?: string;
}

/** Square of half side `radius` around a landing spot, in degrees (lib/areas.mjs readLandingSpots). */
function spotBbox(s: Spot): { south: number; west: number; north: number; east: number } {
  const o = WORLD_ORIGIN;
  const deg = Math.PI / 180;
  const mLat = 111_132.954 - 559.822 * Math.cos(2 * o.lat * deg) + 1.175 * Math.cos(4 * o.lat * deg);
  const mLon = deg * 6_378_137 * Math.cos(o.lat * deg);
  const x = (s.lon - o.lon) * mLon;
  const z = -(s.lat - o.lat) * mLat;
  const rect = { minX: Math.round(x - s.radius), minZ: Math.round(z - s.radius), maxX: Math.round(x + s.radius), maxZ: Math.round(z + s.radius) };
  return { south: o.lat - rect.maxZ / mLat, west: o.lon + rect.minX / mLon, north: o.lat - rect.minZ / mLat, east: o.lon + rect.maxX / mLon };
}

/** Tile rect of a bbox (tools/world-compiler/src/cli.ts). */
function tileRect(bbox: { south: number; west: number; north: number; east: number }): WorldBounds {
  const T = STREET_TILE_SIZE;
  const sw = latLonToLocal(bbox.south, bbox.west);
  const ne = latLonToLocal(bbox.north, bbox.east);
  const i0 = Math.floor(sw.x / T);
  const i1 = Math.floor((ne.x - 1e-6) / T);
  const j0 = Math.floor(ne.z / T);
  const j1 = Math.floor((sw.z - 1e-6) / T);
  return { minX: i0 * T, maxX: (i1 + 1) * T, minZ: j0 * T, maxZ: (j1 + 1) * T };
}

let cached: StreetAreaRect[] | null = null;

/** Every compiled street area with its tile rect. */
export function streetAreaRects(): readonly StreetAreaRect[] {
  if (cached) {
    return cached;
  }
  const out: StreetAreaRect[] = OSM_AREAS.filter((a) => a.profile === 'street').map((a) => ({ id: a.id, rect: tileRect(a.bbox) }));
  for (const s of (spotsFile as { spots: Spot[] }).spots) {
    if (!s.area && !out.some((a) => a.id === s.id)) {
      out.push({ id: s.id, rect: tileRect(spotBbox(s)) });
    }
  }
  return (cached = out);
}
