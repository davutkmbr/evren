import type { DistrictStyle, LandUse, LandmarkBuilder, LandmarkFootprint, LandmarkKind, RoadKind } from '../../core/contracts';

/** A closed ring of lat/lon pairs. Land rings are counter-clockwise in map view (north up). */
export interface CoastRing {
  id: string;
  name: string;
  kind: 'mainland' | 'island' | 'lake';
  /** Lakes only: maximum depth (m) below the water line. */
  depth?: number;
  /** Flat lat, lon pairs. */
  ll: readonly number[];
}

/** Local-space ring (meters), flat x, z pairs. */
export type FlatRing = Float64Array;

/** A zone polygon painted into the land-use grid. */
export interface ZoneDef {
  name: string;
  use: LandUse;
  /** Flat lat, lon pairs (closed implicitly). */
  ll: readonly number[];
  /** Forest belts that leave a strip of yalı/village along the shore (Bosphorus). */
  shoreStrip?: boolean;
}

/** A circular zone (villages inside forests, beach stretches, small parks). */
export interface CircleZoneDef {
  name: string;
  use: LandUse;
  lat: number;
  lon: number;
  radius: number;
}

export interface BeachDef {
  name: string;
  lat: number;
  lon: number;
  /** Stretch radius (m) along which the shoreline is sandy. */
  radius: number;
  /** Width of the sand band (m) on land. */
  width: number;
}

export interface DistrictDef {
  id: string;
  name: string;
  side: 'europe' | 'asia' | 'island';
  lat: number;
  lon: number;
  style: DistrictStyle;
  density: number;
  floorsMean: number;
  floorsMax: number;
  /** Relative size for the weighted Voronoi partition (km, ~ typical radius). */
  reach: number;
}

export interface LandmarkData {
  id: string;
  name: string;
  kind: LandmarkKind;
  builder: LandmarkBuilder;
  lat: number;
  lon: number;
  headingDeg: number;
  radius: number;
  height: number;
  info: string;
  year?: number;
  /** Anchor points as flat lat, lon pairs. */
  anchors?: readonly number[];
  /** Per-anchor heights (m) for clusters; exposed as an extra `height` on each anchor. */
  anchorHeights?: readonly number[];
  /** Reserved polygon (lat, lon pairs) for 'polygon' footprints when it differs from the anchors. */
  footprintPolygon?: readonly number[];
  /**
   * How the terrain/land use treats the site:
   * - 'pad': flatten a disc of `radius` and reserve it (default)
   * - 'cluster': small pads around each anchor only (skyscraper clusters)
   * - 'line': reserve a corridor along the anchors (walls, aqueduct), no flattening
   * - 'polygon': anchors form a polygon; reserve it, flatten gently
   * - 'slope': reserve a disc of `radius` but keep the natural hillside (fortresses climbing a slope)
   * - 'none': no terrain or land-use changes (bridges)
   */
  footprint?: LandmarkFootprint;
  /** Corridor half width for 'line' footprints, pad radius per anchor for 'cluster' (m). */
  footprintWidth?: number;
  /**
   * Full width (m) of the modelled body of a 'line' landmark (e.g. the aqueduct piers). The OSM building layer drops
   * every building whose outline comes within half of it (plus a clearance) of the line.
   */
  bodyWidth?: number;
}

export interface RoadData {
  id: string;
  name: string;
  kind: RoadKind;
  width: number;
  /** Flat lat, lon pairs. */
  ll: readonly number[];
}

/** Everything the grid builder needs, already projected to local meters. */
export interface BuildInput {
  landRings: FlatRing[];
  /** Per land ring: 0 = Europe, 1 = Asia, 2 = Princes' Islands. */
  landRingSides: number[];
  /** Channels with steep underwater banks (Bosphorus, Golden Horn). */
  steepChannels: FlatRing[];
  lakeRings: { ring: FlatRing; depth: number }[];
  zones: { ring: FlatRing; use: LandUse; shoreStrip: boolean }[];
  circles: { x: number; z: number; radius: number; use: LandUse }[];
  beaches: { x: number; z: number; radius: number; width: number }[];
  /** Flat x, z, elevation triples. */
  elevationPoints: Float64Array;
  /** Flat x, z, depth (positive) triples. */
  bathymetryPoints: Float64Array;
  /** Dense ground spot heights of the visual core: flat x, z, elevation triples (see data/spot-heights.ts). */
  spotHeights: Float64Array;
  /** pts: flat x, z, floor-elevation triples (upstream -> mouth). */
  rivers: { pts: Float64Array; halfWidth: number; wallSlope: number }[];
  /** headingRad: ridge direction (compass, radians); elongation ≥ 1 stretches the bump along it. */
  summits: { x: number; z: number; elevation: number; radius: number; headingRad: number; elongation: number }[];
  /** Low shore flats (quays, fills): selection polyline + band profile, see data/relief.ts ShoreFlat. */
  flats: { pts: Float64Array; reach: number; width: number; level: number; rise: number; wallSlope: number }[];
  pads: { x: number; z: number; radius: number; blend: number; strength: number }[];
  reservedDiscs: { x: number; z: number; radius: number }[];
  reservedLines: { pts: Float64Array; halfWidth: number }[];
  reservedPolygons: FlatRing[];
  /**
   * Road corridors; `highway`: the name of a motorway or ring road (its sections share it): their verges and the
   * junction pockets between two different highways turn green (landuse.ts).
   */
  roads: { pts: Float64Array; halfWidth: number; overWater: boolean; highway?: string }[];
  /** Breakwater centerlines (already part of landRings); painted as paved, non-buildable ground. */
  breakwaters: { pts: Float64Array; halfWidth: number }[];
  districts: { x: number; z: number; reach: number; side: number; density: number; historic: boolean }[];
  /** Landmark mosques: neighbourhood mosque sites keep clear of them. */
  landmarkMosques: { x: number; z: number; radius: number }[];
  mosqueTarget: number;
  /**
   * Rects where the real OSM map is drawn (osm/regions.ts osmStaticExclusion): no neighbourhood mosque site may reach
   * into them, so a procedural mosque never replaces mapped buildings (the OSM mosques are drawn there instead).
   */
  siteExclusion: { minX: number; maxX: number; minZ: number; maxZ: number }[];
  /**
   * The far OSM layer's coverage mask (city/osm/mask.ts; 1 = the baked OSM buildings stand there): no neighbourhood
   * mosque site reaches into those cells (the real mosques stand there), and the OSM land use is stamped only there
   * (osm-land.ts).
   */
  siteMask: Uint8Array;
}

export interface MosqueSite {
  x: number;
  z: number;
  y: number;
  radius: number;
  size: number;
  headingDeg: number;
}

export interface BuildOutput {
  height: Float32Array;
  coast: Float32Array;
  landUse: Uint8Array;
  density: Uint8Array;
  district: Uint8Array;
  /** Final pad elevations (same order as BuildInput.pads). */
  padHeights: Float32Array;
  mosqueSites: Float32Array;
  timings: Record<string, number>;
}
