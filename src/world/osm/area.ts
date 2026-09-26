/**
 * Vertical-slice area of real OpenStreetMap content (Eminönü, Galata Bridge, Karaköy, Galata, Tophane, Cihangir),
 * always part of the map. OSM_AREA is the single source of the bbox: scripts/data/fetch-osm.mjs parses it from this
 * file; its build rect (osmExclusionRect(), grown to the ground lattice) is the first entry of regions.ts.
 */
import type { WorldBounds } from '../../core/contracts';
import { latLonToLocal } from '../../core/geo-coords';

export const OSM_AREA = { south: 41.015, west: 28.965, north: 41.038, east: 28.99 } as const;

/**
 * Kadıköy core, the first street-layer district (.docs/planning/16-street-layer.md): Rıhtım with both ferry piers,
 * the çarşı, Altıyol, Bahariye down to Süreyya Operası and the start of Moda Caddesi, with ~100 m of margin.
 */
export const KADIKOY_AREA = { south: 40.9848, west: 29.0185, north: 40.995, east: 29.0325 } as const;

/**
 * Eminönü, the second street-layer district (close-range detail where the dragon lands): Yeni Cami and its square,
 * Mısır Çarşısı, the Eminönü piers and the south end of the Galata Bridge, inside OSM_AREA.
 */
export const EMINONU_AREA = { south: 41.015, west: 28.9675, north: 41.0195, east: 28.9765 } as const;

/**
 * One area of real OSM data. `dataFile` is where scripts/data/fetch-osm.mjs writes it (repo-relative).
 * `profile`: 'slice' is the flight-scale slice schema (version 2, src/world/osm/data.ts); 'street' is the same
 * schema plus the street-layer extension read by tools/world-compiler (documented in its README.md).
 */
export interface OsmAreaDef {
  readonly id: string;
  readonly bbox: { readonly south: number; readonly west: number; readonly north: number; readonly east: number };
  readonly dataFile: string;
  readonly profile: 'slice' | 'street';
}

/**
 * Every OSM area. Keep one entry per line in this exact shape: fetch-osm.mjs and the world compiler parse it from the
 * source text (tools/world-compiler/lib/areas.mjs), and `bbox` must name an `export const X = { ... } as const` above.
 * Only 'galata' (OSM_AREA) feeds the runtime slice; the others are compiler inputs. The flight-scale regions around the
 * landing spots are planned separately (scripts/data/osm-regions.mjs -> regions.json, streamed by regions.ts / index.ts),
 * and the procedural exclusion lists cover the slice and every region (regions.ts).
 */
export const OSM_AREAS: readonly OsmAreaDef[] = [
  { id: 'galata', bbox: OSM_AREA, dataFile: 'public/data/osm/slice.json', profile: 'slice' },
  { id: 'kadikoy', bbox: KADIKOY_AREA, dataFile: 'data/osm/kadikoy.json', profile: 'street' },
  { id: 'eminonu', bbox: EMINONU_AREA, dataFile: 'data/osm/eminonu.json', profile: 'street' },
];

/** Metres beyond the area where OSM still replaces the procedural city (the data is fetched ~75 m wider). */
export const OSM_SEAM = 40;

/**
 * Procedural park / forest / cemetery trees stay inside the area while this is false (urban and street trees are
 * always removed). The details layer switches it (details/policy.ts) once it plants park vegetation itself.
 */
export { OWNS_PARK_TREES as OSM_OWNS_PARK_TREES } from './details/policy';

// `?.`: modules are also imported by the Node checks in tools/headless, where import.meta.env does not exist.
export const OSM_DATA_URL = `${import.meta.env?.BASE_URL ?? "/"}data/osm/slice.json`;

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
