/**
 * Street tile formats (see ../README.md): what the compiler writes to public/world/<area>/. World coordinates are
 * Evren local metres (src/core/geo-coords.ts): +X east, +Y up, +Z south, origin 41.045 N 29.02 E. Positions are
 * [x, y, z]; footprints are flat [x0, z0, x1, z1, ...] with positive shoelace area (outer) as in the OSM schema.
 *
 * Format 0: greybox (flat colours, one glb per tile). Format 1 adds textured PBR materials with shared external
 * textures, UV0/UV1, LOD glbs with distance bands, prop instances, a light list and a strip at full detail.
 * Format 1.1 (additive, `format` stays 1): the `_WEATHER` vertex attribute, material variants and weather layers.
 * Format 1.2 (additive): façade module slots per tile (`slots`) and the module library reference (`modules`), see
 * src/street/modules/format.ts.
 */
import type { ModulesRef, SlotsRef } from '../../../src/street/modules/format';

export type FormatVersion = 0 | 1;
/** Default output format of the compiler (`--format 0|1` picks one). */
export const FORMAT: FormatVersion = 1;
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
  /** Format 1: 'full' or 'greybox'. */
  detail?: 'full' | 'greybox';
  /** Format 1: per-LOD glb, hash, size and triangles (glb / bytes / triangles above describe LOD0). */
  lods?: { level: number; glb: string; hash: string; bytes: number; triangles: number }[];
  instances?: number;
  lights?: number;
  /** Format 1.2: the tile's façade module slots (src/street/modules/format.ts). */
  slots?: SlotsRef;
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
  format: FormatVersion;
  area: string;
  compiler: { name: string; version: string };
  /** Format 1: glbs use KHR_mesh_quantization + EXT_meshopt_compression (a meshopt decoder is required). */
  compression?: 'meshopt';
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
  /** Format 1. */
  lod?: LodPolicy;
  strip?: StripInfo;
  materialDefs?: MaterialRec[];
  textures?: TextureRec[];
  props?: Record<string, PropRec>;
  /** Credits of every external asset in the output (licence, author, conditions and how they were met). */
  assets?: AssetCreditRec[];
  /** Totals of the output (format 1). */
  totals?: { tiles: number; lod0Triangles: number; lod1Triangles: number; instances: number; lights: number; textureBytes: number; propBytes: number; glbBytes: number };
  /** Format 1.2: the façade module library and this area's palette for it. */
  modules?: ModulesRef;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Format 1                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------- */

/**
 * How runtimes switch LODs. A tile shows LOD k while the horizontal distance d from the camera to the tile's
 * `bounds` square satisfies bands[k].min <= d < bands[k].max. `hysteresis` metres are added to a band's max before
 * leaving it (no flicker at the border). Tiles beyond the last band are not drawn. Instances are drawn while d is
 * below their prop's `drawDistance` (and never beyond the last band).
 */
export interface LodPolicy {
  bands: { level: number; min: number; max: number }[];
  hysteresis: number;
}

/** The rect compiled at full detail (LOD0 street detail); every other tile is greybox (LOD0 = LOD1). */
export interface StripInfo {
  /** Where the rect came from: a file path, 'cli' or 'route:<id>'. */
  source: string;
  rect: Bounds2;
  tiles: string[];
}

export interface MaterialRec {
  id: string;
  /** Linear RGBA factor (tint). */
  baseColorFactor: [number, number, number, number];
  /** Texture files under textures/ (relative to the index); null: none. */
  baseColor: string | null;
  normal: string | null;
  /** R = AO, G = roughness, B = metalness. */
  orm: string | null;
  /** Metres per texture repeat (UV0 = metres / tiling). */
  tiling: [number, number];
  roughness: number;
  metallic: number;
  alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff?: number;
  doubleSided: boolean;
  emissive?: { color: [number, number, number]; nits: number; night: boolean; source: string };
  surface?: string;
  castShadow: boolean;
  /** Source texture set (asset id or ph_<folder>). */
  set?: string;
  /** Format 1.1: a `<base>@<variant>` material names its base material and variant. */
  variantOf?: string;
  variant?: string;
  /** Format 1.1: weathering layers driven by the `_WEATHER` vertex attribute. */
  weather?: WeatherRec;
}

/** `_WEATHER` channel of each layer: x = dirt, y = streak, z = edge, w = damp. */
export const WEATHER_CHANNEL = { dirt: 0, streak: 1, edge: 2, damp: 3 } as const;

/**
 * One weathering layer as runtimes read it. Layer UV = UV0 × (material tiling / layer tiling), per axis. Coverage
 * m = clamp(_WEATHER[channel] × strength, 0, 1) × (alpha ? layer base colour alpha : 1) × mix(1, convexity, curvature).
 */
export interface WeatherLayerRec {
  channel: 0 | 1 | 2 | 3;
  /** Registry material the maps come from (null: flat layer). */
  material: string | null;
  /** Texture files (relative to the index in the manifest, to the glb in glTF extras), or null. */
  baseColor: string | null;
  normal: string | null;
  /** G = roughness (R = AO and B = metalness are not used by layers). */
  orm: string | null;
  /** The base colour texture carries coverage in its alpha. */
  alpha: boolean;
  /** Metres per layer repeat. */
  tiling: [number, number];
  /** Sampler wrap of the layer maps on both axes (mirror = glTF MIRRORED_REPEAT). */
  wrap: 'repeat' | 'mirror';
  /** Linear RGB multiplied into the layer colour. */
  tint: [number, number, number];
  strength: number;
  blend: 'mix' | 'multiply';
  darken: number;
  /** Layer roughness: a constant when `orm` is null, the factor on ORM green otherwise; null keeps the base roughness. */
  roughness: number | null;
  normalScale: number;
  curvature: number;
}

export interface WeatherRec {
  attribute: '_WEATHER';
  layers: { dirt?: WeatherLayerRec; streak?: WeatherLayerRec; edge?: WeatherLayerRec; damp?: WeatherLayerRec };
}

export interface TextureRec {
  file: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
}

export interface PropRec {
  id: string;
  glb: string;
  hash: string;
  bytes: number;
  triangles: number;
  /** Node names inside the glb that instances may pick (`variant`); absent variant = the whole scene. */
  variants: string[];
  /** Local AABB of the whole prop (metres, +Y up, origin at its foot). */
  bounds: { min: XYZ; max: XYZ };
  drawDistance: number;
  castShadow: boolean;
  /** Approved asset id (approved.json) or 'procedural'. */
  source: string;
  /** Lights attached to every instance (prop-local positions; see LightRec). */
  lights?: Omit<LightRec, 'id' | 'ref'>[];
  /**
   * Decimated LODs (street/prop-lod.ts): same nodes and materials in `glb` (relative to the index); draw level k from
   * `distance` metres on (LOD0 = `glb` above before the first), `error` = its largest geometric error (m).
   */
  lods?: { level: number; glb: string; hash: string; bytes: number; triangles: number; error: number; distance: number }[];
}

export interface AssetCreditRec {
  id: string;
  name: string;
  kind: string;
  source: string;
  url: string;
  licence: string;
  author: string;
  attribution: string | null;
  conditions?: { text: string; met: string }[];
  /** Where it is used: material ids and prop ids. */
  usedBy: string[];
}

export interface LodRef {
  level: number;
  glb: string;
  hash: string;
  bytes: number;
  triangles: number;
  /** Per-tile lightmap / AO atlas that UV1 addresses (the atlas itself is baked later). */
  lightmap: { size: number; texelsPerM: number; padding: number; charts: number } | null;
}

export interface InstanceRec {
  /** Prop id (index.props). */
  asset: string;
  /** Node name in the prop glb; absent: the whole prop. */
  variant?: string;
  position: XYZ;
  /** Unit quaternion [x, y, z, w] (glTF order). */
  rotation: [number, number, number, number];
  /** Uniform or per-axis scale (default 1). */
  scale?: number | XYZ;
  /** Record this instance stands for (lamp index, door id, POI id...). */
  ref?: string;
  /** Integer for runtime variation (tint, animation phase). */
  seed?: number;
}

/**
 * A light. Physical units: `intensity` is candela (cd) for point and spot lights and nits (cd/m²) for area lights;
 * `lumens` is the total output. `range` is where a runtime may cut the light off (illuminance < ~0.3 lx).
 */
export interface LightRec {
  /** "<tile>/l<k>". */
  id: string;
  type: 'point' | 'spot' | 'area';
  position: XYZ;
  /** Unit vector the light points along (spot, area). */
  direction?: XYZ;
  /** Correlated colour temperature (K) and the linear RGB it maps to (max channel 1). */
  kelvin: number;
  color: [number, number, number];
  intensity: number;
  lumens: number;
  range: number;
  /** Spot cone half-angles (degrees). */
  cone?: { inner: number; outer: number };
  /** Area light size (width, height) in metres. */
  size?: [number, number];
  /** On at night only (false: always on, e.g. interiors). */
  night: boolean;
  source: 'lamp' | 'sign' | 'window' | 'interior' | 'other';
  /** Instance or record the light belongs to. */
  ref?: string;
  castShadow?: boolean;
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
  /**
   * Format 1: the building is a landmark (place of worship, tomb, fountain, hamam, covered bazaar...) compiled as
   * simple massing: `worship`, `market`, `landmark` or the OSM historic / amenity value. A runtime that draws its own
   * landmark model can hide this building's geometry (its footprint and height stay valid for colliders).
   */
  landmark?: string;
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
  format: FormatVersion;
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
  /** Format 1: 'full' (inside the strip) or 'greybox'. */
  detail?: 'full' | 'greybox';
  /** Format 1: the glb of every LOD (LOD0 first; greybox tiles point every LOD at one glb). */
  lods?: LodRef[];
  instances?: InstanceRec[];
  lights?: LightRec[];
  /** Records added by compile steps, keyed by step id (façade plans, shopfronts, interiors...). */
  extra?: Record<string, unknown>;
}

export interface WalkGraphFile {
  format: FormatVersion;
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
  format: FormatVersion;
  area: string;
  /** Directed drivable paths: lanes (along a street) and connectors (through a junction). */
  paths: { id: number; kind: 'lane' | 'connector'; points: number[]; next: number[]; flags: number }[];
}
