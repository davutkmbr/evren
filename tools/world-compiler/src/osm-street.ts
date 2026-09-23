/**
 * Street extension ('street/1') of the OSM schema (version 2, src/world/osm/data.ts) written by
 * scripts/data/fetch-osm.mjs for areas with profile 'street' (data/osm/<area>.json). Every field is optional and
 * additive, so the file still satisfies OsmData; the runtime slice (profile 'slice') never carries these fields.
 * Data © OpenStreetMap contributors, ODbL 1.0.
 */
import { readFileSync } from 'node:fs';
import { OSM_SCHEMA_VERSION, type OsmData, type OsmPoint, type OsmRoad } from '../../../src/world/osm/data';

export const STREET_EXTENSION = 'street/1';

/**
 * Point kinds added by the extension:
 * - "entrance=<value>" (main, yes, shop, service, staircase, home, garage, emergency, ...): building doors. Entrances
 *   win over every other kind of the node.
 * - "craft=<value>": workshops (POIs like shop=* / amenity=*).
 * - "kerb=<value>": kerb nodes that carry no other kind (crossing kerbs: lowered, raised, flush).
 */
export interface OsmStreetPoint extends OsmPoint {
  /** Entrances: OSM way id of the building outline (or building:part way) the node is a vertex of. */
  building?: number;
  /** Entrances: door=* (hinged, sliding, revolving, no, ...). */
  door?: string;
  /** Entrances: access=*. */
  access?: string;
  wheelchair?: string;
  /** Entrances: ref=* (door / staircase number; `ref` itself is the junction ref of the schema). */
  entranceRef?: string;
  /** Entrances: addr:housenumber. */
  housenumber?: string;
  /** Entrances: width / door:width (m). */
  width?: number;
  /** kerb=* (lowered, raised, flush, rolled, no) on any point. */
  kerb?: string;
}

export interface OsmStreetRoad extends OsmRoad {
  /** [left, right] sidewalk width (m, 0 = not tagged on that side) from sidewalk:{both,left,right}:width. */
  sidewalkWidth?: [number, number];
  /** kerb=* of the way (crossing footways). */
  kerb?: string;
}

/** Areas gain "area:highway=<value>" kinds (sidewalk and carriageway polygons). */
export interface OsmStreetData extends OsmData {
  area?: string;
  extension?: string;
  points: OsmStreetPoint[];
  roads: OsmStreetRoad[];
}

export function loadStreetData(file: string): OsmStreetData {
  const data = JSON.parse(readFileSync(file, 'utf8')) as OsmStreetData;
  if (data.version !== OSM_SCHEMA_VERSION) {
    throw new Error(`${file}: schema version ${data.version}, expected ${OSM_SCHEMA_VERSION} (re-run scripts/data/fetch-osm.mjs)`);
  }
  if (data.extension !== STREET_EXTENSION) {
    throw new Error(`${file}: extension ${data.extension ?? 'none'}, expected ${STREET_EXTENSION} (fetch with a 'street' profile area)`);
  }
  return data;
}
