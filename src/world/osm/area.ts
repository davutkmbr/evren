/** Prototype area of real OpenStreetMap streets and buildings (Galata / Karaköy / Tophane / Cihangir), behind `?osm=1`. */
import type { WorldBounds } from '../../core/contracts';
import { latLonToLocal } from '../../core/geo-coords';

export const OSM_AREA = { south: 41.0215, west: 28.968, north: 41.038, east: 28.99 } as const;

/** Metres beyond the area where OSM still replaces the procedural city (the data is fetched ~75 m wider). */
export const OSM_SEAM = 40;

export const OSM_DATA_URL = `${import.meta.env.BASE_URL}data/osm/galata.json`;

export function osmEnabled(params: URLSearchParams): boolean {
  return params.get('osm') === '1';
}

/** Local-metre rectangle where procedural buildings and urban trees are skipped and OSM content is built. */
export function osmExclusionRect(): WorldBounds {
  const sw = latLonToLocal(OSM_AREA.south, OSM_AREA.west);
  const ne = latLonToLocal(OSM_AREA.north, OSM_AREA.east);
  return { minX: sw.x - OSM_SEAM, maxX: ne.x + OSM_SEAM, minZ: ne.z - OSM_SEAM, maxZ: sw.z + OSM_SEAM };
}

export interface OsmBuilding {
  /** Flat x, z pairs, counter-clockwise in the x/z plane, not closed. */
  ring: number[];
  height?: number;
  levels?: number;
  roof?: string;
  kind: string;
}

export interface OsmRoad {
  pts: number[];
  kind: string;
  width: number;
  lanes?: number;
  bridge?: boolean;
  name?: string;
  surface?: string;
  oneway?: boolean;
}

export interface OsmData {
  bbox: typeof OSM_AREA & WorldBounds;
  buildings: OsmBuilding[];
  roads: OsmRoad[];
  /** Pedestrian areas (squares). */
  plazas: { ring: number[] }[];
  trams: { pts: number[]; gauge: number }[];
  /** Flat x, z pairs of single trees. */
  trees: number[];
  treeRows: { pts: number[] }[];
  /** Flat x, z pairs of marked pedestrian crossings. */
  crossings: number[];
}
