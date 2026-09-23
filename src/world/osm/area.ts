/**
 * Vertical-slice area of real OpenStreetMap content (Eminönü, Galata Bridge, Karaköy, Galata, Tophane, Cihangir),
 * behind `?osm=1`. OSM_AREA is the single source of the bbox: scripts/data/fetch-osm.mjs parses it from this file,
 * and the procedural city / vegetation / life traffic exclusions derive from osmExclusionRect().
 */
import type { WorldBounds } from '../../core/contracts';
import { latLonToLocal } from '../../core/geo-coords';

export const OSM_AREA = { south: 41.015, west: 28.965, north: 41.038, east: 28.99 } as const;

/** Metres beyond the area where OSM still replaces the procedural city (the data is fetched ~75 m wider). */
export const OSM_SEAM = 40;

/**
 * Procedural park / forest / cemetery trees stay inside the area while this is false (urban and street trees are
 * always removed). The details layer switches it (details/policy.ts) once it plants park vegetation itself.
 */
export { OWNS_PARK_TREES as OSM_OWNS_PARK_TREES } from './details/policy';

export const OSM_DATA_URL = `${import.meta.env.BASE_URL}data/osm/slice.json`;

export function osmEnabled(params: URLSearchParams): boolean {
  return params.get('osm') === '1';
}

/** Local-metre rectangle of OSM_AREA itself (no seam). */
export function osmAreaRect(): WorldBounds {
  const sw = latLonToLocal(OSM_AREA.south, OSM_AREA.west);
  const ne = latLonToLocal(OSM_AREA.north, OSM_AREA.east);
  return { minX: sw.x, maxX: ne.x, minZ: ne.z, maxZ: sw.z };
}

/** Local-metre rectangle (area + seam) where procedural buildings, trees and road traffic step aside for OSM content. */
export function osmExclusionRect(): WorldBounds {
  const a = osmAreaRect();
  return { minX: a.minX - OSM_SEAM, maxX: a.maxX + OSM_SEAM, minZ: a.minZ - OSM_SEAM, maxZ: a.maxZ + OSM_SEAM };
}
