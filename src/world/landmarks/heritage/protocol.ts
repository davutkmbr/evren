import type { MeshData } from './build/mesh-builder';

/** Plain copy of the LandmarkDef fields the builders need (structured-clone friendly). */
export interface SiteDef {
  id: string;
  kind: string;
  x: number;
  z: number;
  y: number;
  headingDeg: number;
  radius: number;
  height: number;
  anchors: { x: number; z: number }[];
  /** Full width (m) of a line landmark's body (LandmarkDef.bodyWidth). */
  bodyWidth?: number;
  /** Stations (m along the anchors) where OSM ways pass through a line landmark (data/crossings.json). */
  crossings: number[];
}

/** Axis-aligned grid window (cell-centred, same layout as the geo height grid). */
export interface GridWindow {
  originX: number;
  originZ: number;
  cell: number;
  w: number;
  h: number;
  data: Float32Array;
}

export interface SiteJob {
  def: SiteDef;
  heights: GridWindow;
  /** Signed coast distance (m, positive on land) on the same cells. */
  coast: GridWindow;
  /** Local coastline polylines near the site (flat x, z pairs). */
  coastlines: Float64Array[];
  lods: number;
}

export type ColliderDesc =
  | { kind: 'box'; cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; yaw: number }
  | { kind: 'cylinder'; x: number; y: number; z: number; r: number; h: number };

export interface ChunkResult {
  key: string;
  originX: number;
  originZ: number;
  /** One entry per LOD (index 0 = most detailed). */
  lods: MeshData[];
}

export interface SiteResult {
  id: string;
  chunks: ChunkResult[];
  colliders: ColliderDesc[];
  ms: number;
  error?: string;
}

export type WorkerRequest = { type: 'build'; jobs: SiteJob[] };

export type WorkerResponse = { type: 'site'; result: SiteResult } | { type: 'done' };
