/**
 * Schema (version 2) of public/data/osm/slice.json and the region files public/data/osm/regions/*.json, written by
 * scripts/data/fetch-osm.mjs, and its typed loader.
 * Data © OpenStreetMap contributors, ODbL 1.0.
 *
 * Conventions:
 * - Coordinates are local metres of src/core/geo-coords.ts (+X east, +Z south), rounded to 0.1 m, stored flat as
 *   [x0, z0, x1, z1, ...].
 * - Rings (`ring`, `holes`) are not closed. Outer rings have a positive shoelace area in the x/z plane (see
 *   shared/geometry.ts ringArea), holes a negative one.
 * - `kind` of areas, lines and points is the defining OSM tag as "key=value" (e.g. "leisure=park",
 *   "highway=street_lamp"); buildings and roads keep the bare value of building=* / highway=*.
 * - `id` is the OSM id: positive for ways, negative for relations. Useful for per-feature overrides.
 * - Optional string tags are trimmed; colour / material / shape style values are lower-cased.
 * - Roads and rails keep every vertex shared with another road / rail (junctions) and every vertex that is a point
 *   feature (crossing, signal, stop). Those vertices carry a compact integer `ref` (not an OSM id) in `refs`, and the
 *   matching point has the same `ref`, so the network is routable and points know the ways they sit on.
 */
import type { WorldBounds } from '../../core/contracts';

export const OSM_SCHEMA_VERSION = 2;

/** Building outline (building=*) or Simple 3D Buildings part (building:part=*). */
export interface OsmBuilding {
  id: number;
  /** Outer ring, flat x, z pairs. */
  ring: number[];
  /** Inner rings (courtyards, light wells) of multipolygon buildings. */
  holes?: number[][];
  /** building=* value, or building:part=* value when `part` (e.g. "yes", "apartments", "mosque", "roof"). */
  kind: string;
  /** True for building:part records. */
  part?: true;
  /** Outline that has building:part children: render the parts instead of the outline (S3DB rule). */
  hasParts?: true;
  /** Total height above ground incl. roof (m). */
  height?: number;
  /** Height of the bottom of this part / building above ground (m). */
  minHeight?: number;
  /** building:levels (above ground, excl. roof levels). */
  levels?: number;
  /**
   * Streamed regions only: storeys estimated for an untagged building (no height / levels) by scripts/data/fetch-osm.mjs
   * fillLevels: the median of its tagged neighbours. The renderer uses it in place of the district's floor range.
   */
  levelsFill?: number;
  /** building:min_level. */
  minLevel?: number;
  /** roof:levels. */
  roofLevels?: number;
  /** roof:height (m). */
  roofHeight?: number;
  /** roof:shape ("flat", "gabled", "hipped", "pyramidal", "dome", "onion", "skillion", ...). */
  roofShape?: string;
  /** roof:colour (CSS name or #hex, as tagged; THREE.Color.setStyle reads both). */
  roofColour?: string;
  roofMaterial?: string;
  /** roof:orientation ("along" / "across"). */
  roofOrientation?: string;
  /** roof:direction in degrees. */
  roofDirection?: number;
  /** building:colour. */
  colour?: string;
  /** building:material ("stone", "brick", "plaster", "concrete", "glass", "wood", ...). */
  material?: string;
  amenity?: string;
  historic?: string;
  shop?: string;
  tourism?: string;
  religion?: string;
  architecture?: string;
  use?: string;
  startDate?: string;
  name?: string;
}

/** Linear highway=* way (carriageways, footways, steps, paths). Oneway ways point in the travel direction. */
export interface OsmRoad {
  id: number;
  pts: number[];
  /** highway=* value ("primary", "residential", "pedestrian", "footway", "steps", "service", ...). */
  kind: string;
  /** Carriageway / path width (m): the width tag when `widthTagged`, otherwise estimated from class and lanes. */
  width: number;
  widthTagged?: true;
  lanes?: number;
  /** lanes:forward / lanes:backward relative to `pts` order. */
  lanesForward?: number;
  lanesBackward?: number;
  /** oneway=yes / -1 (already reversed), roundabouts and motorways. */
  oneway?: true;
  bridge?: true;
  /** tunnel=* other than "no" (incl. building passages). */
  tunnel?: true;
  /** covered=yes (arcades, passages under roofs). */
  covered?: true;
  layer?: number;
  /** km/h. */
  maxspeed?: number;
  surface?: string;
  smoothness?: string;
  /** Normalised sidewalk tagging. */
  sidewalk?: 'both' | 'left' | 'right' | 'no' | 'separate';
  lit?: boolean;
  /** [left, right] kerbside parking orientation: "parallel", "diagonal", "perpendicular", "no", ... */
  parking?: [string, string];
  /** motor_vehicle / vehicle / access value ("no", "destination", "private", ...). */
  access?: string;
  junction?: string;
  service?: string;
  /** footway=* ("sidewalk", "crossing"). */
  footway?: string;
  /** crossing=* of footway=crossing ways. */
  crossing?: string;
  incline?: string;
  stepCount?: number;
  name?: string;
  /** [vertexIndex, ref, ...] junction / feature vertices (see file header). */
  refs?: number[];
}

/** railway=* track (T1 tram, İstiklal nostalgic tram, F2 Tünel funicular, metro, mainline). */
export interface OsmRail {
  id: number;
  /** "tram" | "light_rail" | "funicular" | "subway" | "rail" | "narrow_gauge" | "monorail". */
  kind: string;
  pts: number[];
  /** Track gauge (m). */
  gauge: number;
  bridge?: true;
  tunnel?: true;
  /** Embedded in the street surface (tram tracks in the carriageway). */
  embedded?: true;
  layer?: number;
  /** Route refs of the lines using this track ("T1", "T2", "F2", ...). */
  routes?: string[];
  /** A piece of a bridge way over land that meets the ground (street-field.ts streetRasterInput). */
  landed?: true;
  /** service=* ("siding", "yard", "crossover", "spur"). */
  service?: string;
  usage?: string;
  electrified?: string;
  name?: string;
  refs?: number[];
}

/** Polygon feature: landuse, parks, squares, pedestrian areas, parking, piers, water, platforms. */
export interface OsmArea {
  id: number;
  /** "key=value", e.g. "leisure=park", "place=square", "highway=pedestrian", "amenity=parking", "man_made=pier". */
  kind: string;
  ring: number[];
  holes?: number[][];
  layer?: number;
  surface?: string;
  /** parking=* of parking areas ("surface", "multi-storey", "underground", "street_side"). */
  parking?: string;
  sport?: string;
  name?: string;
}

/** Linear non-road feature: walls, fences, kerbs, tree rows, coastline, piers / quays drawn as lines, platforms. */
export interface OsmLine {
  id: number;
  /** "barrier=wall", "barrier=retaining_wall", "natural=tree_row", "natural=coastline", "man_made=pier", ... */
  kind: string;
  pts: number[];
  /** The way is a closed loop (first point repeated at the end is removed). */
  closed?: true;
  height?: number;
  width?: number;
  material?: string;
  surface?: string;
  name?: string;
}

/** Point feature (node). */
export interface OsmPoint {
  /** "highway=street_lamp", "highway=traffic_signals", "highway=crossing", "highway=bus_stop", "railway=tram_stop",
   *  "natural=tree", "amenity=bench", "amenity=waste_basket", "barrier=bollard", "amenity=fountain", "shop=kiosk",
   *  "shop=*" / "amenity=cafe" ... (POIs for shop fronts), "emergency=fire_hydrant", "advertising=*", ... */
  kind: string;
  x: number;
  z: number;
  /** Junction ref when the node is a vertex of a road / rail (see file header). */
  ref?: number;
  /** Indices into OsmData.roads / OsmData.rails of the ways through this node. */
  roads?: number[];
  rails?: number[];
  name?: string;
  /** Crossings: crossing=* ("marked", "zebra", "traffic_signals", "uncontrolled", "unmarked", ...). */
  crossing?: string;
  /** crossing:markings=* ("zebra", "lines", "no", ...). */
  markings?: string;
  /** crossing:signals=*. */
  signals?: string;
  /** direction / traffic_signals:direction ("forward", "backward", "both" or degrees). */
  direction?: string;
  /** Street lamps: lamp_mount ("bent_mast", "straight_mast", "wall_mounted", ...). */
  mount?: string;
  /** support=* ("pole", "wall_mounted", "ceiling", ...). */
  support?: string;
  lightCount?: string;
  /** Bus / tram stops. */
  shelter?: string;
  bench?: string;
  /** Trees. */
  species?: string;
  genus?: string;
  leafType?: string;
  denotation?: string;
  /** Height (m) when tagged (trees, lamps, masts). */
  height?: number;
  /** Tree crown diameter (m). */
  crown?: number;
  material?: string;
  colour?: string;
  backrest?: string;
  cuisine?: string;
  level?: string;
}

export interface OsmData {
  version: number;
  source: string;
  /** Fetch date (YYYY-MM-DD) and Overpass database timestamp. */
  fetched: string;
  osmBase: string | null;
  /** Slice / region area in degrees and local metres. The data itself extends ~75 m beyond it. */
  bbox: { south: number; west: number; north: number; east: number } & WorldBounds;
  /** Outlines and building:part records (filter with `part` / `hasParts`). */
  buildings: OsmBuilding[];
  roads: OsmRoad[];
  rails: OsmRail[];
  areas: OsmArea[];
  lines: OsmLine[];
  points: OsmPoint[];
}

export async function loadOsmData(url: string): Promise<OsmData> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[osm] ${url}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as OsmData;
  if (data.version !== OSM_SCHEMA_VERSION) {
    throw new Error(`[osm] ${url}: schema version ${data.version}, expected ${OSM_SCHEMA_VERSION} (re-run scripts/data/fetch-osm.mjs)`);
  }
  return data;
}

/** Points of one kind ("highway=street_lamp"), or of several kinds when given a predicate. */
export function pointsOf(data: OsmData, kind: string | ((kind: string) => boolean)): OsmPoint[] {
  const test = typeof kind === 'string' ? (k: string) => k === kind : kind;
  return data.points.filter((p) => test(p.kind));
}

/** Areas of one kind ("leisure=park"), or of several kinds when given a predicate. */
export function areasOf(data: OsmData, kind: string | ((kind: string) => boolean)): OsmArea[] {
  const test = typeof kind === 'string' ? (k: string) => k === kind : kind;
  return data.areas.filter((a) => test(a.kind));
}

/** Lines of one kind ("natural=tree_row"), or of several kinds when given a predicate. */
export function linesOf(data: OsmData, kind: string | ((kind: string) => boolean)): OsmLine[] {
  const test = typeof kind === 'string' ? (k: string) => k === kind : kind;
  return data.lines.filter((l) => test(l.kind));
}
