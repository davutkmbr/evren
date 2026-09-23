/**
 * Street tile format 0 (see ../README.md): what the compiler writes to public/world/<area>/. World coordinates are
 * Evren local metres (src/core/geo-coords.ts): +X east, +Y up, +Z south, origin 41.045 N 29.02 E. Positions are
 * [x, y, z]; footprints are flat [x0, z0, x1, z1, ...] with positive shoelace area (outer) as in the OSM schema.
 */
export const FORMAT = 0;
export const TILE_SIZE = 100;

export type XYZ = [number, number, number];

export interface Bounds2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface TileRef {
  /** "<i>_<j>" with i = floor(x / TILE_SIZE), j = floor(z / TILE_SIZE). */
  id: string;
  i: number;
  j: number;
  bounds: Bounds2;
  glb: string;
  manifest: string;
  /** sha256 (first 16 hex) of the glb bytes and of the manifest text, and of both together. */
  glbHash: string;
  manifestHash: string;
  hash: string;
  bytes: number;
  triangles: number;
}

export interface IndexManifest {
  format: typeof FORMAT;
  area: string;
  compiler: { name: string; version: string };
  frame: { origin: { lat: number; lon: number }; axes: string; units: 'm'; seaLevel: 0 };
  osm: { source: string; licence: string; fetched: string; osmBase: string | null; bbox: { south: number; west: number; north: number; east: number } };
  tileSize: number;
  /** Area bbox in local metres and the tile-aligned rect of all tiles. */
  areaBounds: Bounds2;
  rect: Bounds2;
  materials: { name: string; color: string }[];
  tiles: TileRef[];
  walkGraph: { file: string; hash: string; vertices: number; edges: number };
  laneGraph: { file: string; hash: string; paths: number };
  /** sha256 (first 16 hex) over every tile hash and both graphs: changes when any output changes. */
  hash: string;
}

export interface BuildingRec {
  /** "w<way id>" / "r<relation id>", "-<k>" suffix for further polygons of one relation. */
  id: string;
  /** OSM id as in the schema (positive way, negative relation). */
  osmId: number;
  kind: string;
  /** building:part record (Simple 3D Buildings): rendered instead of its outline. */
  part?: true;
  name?: string;
  footprint: number[];
  holes?: number[][];
  /** Ground reference (lowest ground under the footprint), bottom and top of the block. */
  groundY: number;
  bottomY: number;
  topY: number;
  /** topY - groundY. */
  height: number;
  heightSource: 'height' | 'levels' | 'default';
  levels?: number;
  doors: string[];
}

export interface DoorRec {
  /** "<building id>/d<k>". */
  id: string;
  building: string;
  /** Centre of the opening on the facade plane, at the threshold (floor) height. */
  position: XYZ;
  /** Outward horizontal facade normal. */
  normal: XYZ;
  width: number;
  height: number;
  /** Recess depth behind the facade (m). */
  depth: number;
  /** false: an entrance=* node; true: placed from a storefront POI on the street side. */
  inferred: boolean;
  /** entrance=* value, or "shop" for inferred doors. */
  entrance: string;
  /** POI ids this door serves. */
  pois: string[];
}

export interface PoiRec {
  /** "p<k>": k is the index of the point in the area data file (stable for one data file). */
  id: string;
  /** "shop=bakery", "amenity=cafe", "craft=tailor", ... */
  kind: string;
  /** OSM name, kept as data only (never shown: businesses in the game are fictional). */
  osmName?: string;
  position: XYZ;
  building?: string;
  door?: string;
}

export interface LampRec {
  /** Foot of the post / wall bracket. */
  position: XYZ;
  /** "arm" (kerb mast), "armLow", "double" (median), "lantern" (post), "wall" (facade bracket). */
  kind: string;
  /** Compass heading (deg) the head faces. */
  heading: number;
  light: 'sodium' | 'led' | 'warm';
  /** Placed by the street lighting rules (src/world/osm/streets/lamps.ts), not an OSM highway=street_lamp node. */
  inferred: boolean;
  mount?: string;
  height?: number;
}

export interface TreeRec {
  position: XYZ;
  height?: number;
  crown?: number;
  species?: string;
  genus?: string;
  leafType?: string;
}

export interface BenchRec {
  position: XYZ;
  kind: string;
  backrest?: string;
}

export interface SpawnRec {
  position: XYZ;
  /** Compass heading (deg, 0 = north, clockwise) along the walkway. */
  heading: number;
  /** "walk": on the walk graph; "pier": ferry landing. */
  kind: 'walk' | 'pier';
}

export interface TileManifest {
  format: typeof FORMAT;
  area: string;
  id: string;
  i: number;
  j: number;
  bounds: Bounds2;
  /** Translation of the glb's root node: mesh vertices are relative to it. */
  origin: XYZ;
  /** World AABB of the geometry (buildings overhang the tile: each belongs to the tile of its centroid). */
  content: { min: XYZ; max: XYZ };
  glb: string;
  triangles: number;
  buildings: BuildingRec[];
  doors: DoorRec[];
  pois: PoiRec[];
  lamps: LampRec[];
  trees: TreeRec[];
  benches: BenchRec[];
  spawns: SpawnRec[];
}

export interface WalkGraphFile {
  format: typeof FORMAT;
  area: string;
  /** Vertex i: x, y, z at [3 i .. 3 i + 2]; lane half width halfWidth[i]. */
  vertices: number[];
  halfWidth: number[];
  /** Undirected edges as vertex index pairs [a0, b0, a1, b1, ...] and their desired walker density (people / m). */
  edges: number[];
  density: number[];
  /** Tile id of every vertex. */
  tile: string[];
}

export interface LaneGraphFile {
  format: typeof FORMAT;
  area: string;
  /** Directed drivable paths: lanes (along a street) and connectors (through a junction). */
  paths: { id: number; kind: 'lane' | 'connector'; points: number[]; next: number[]; flags: number }[];
}
