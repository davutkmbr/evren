/** Messages between the details layer and details.worker.ts. */
import type { OsmData } from '../data';
import type { MeshArrays, OsmWorkerBase } from '../shared/protocol';
import type { TreeSpecies } from './trees/species';

/** Galata Bridge deck frame (waterfront/bridge.ts GalataDeck): origin, unit axis, end and bascule pier stations. */
export interface DeckFrame {
  ox: number;
  oz: number;
  ax: number;
  az: number;
  s0: number;
  s1: number;
  piers: number[];
}

export interface DetailsRequest {
  base: OsmWorkerBase;
  data: Pick<OsmData, 'points' | 'lines' | 'areas' | 'buildings' | 'roads' | 'rails'>;
  /** Pedestrian count multiplier (quality preset). */
  crowdScale: number;
  /** Galata Bridge deck of the structures module (null when the landmark is missing). */
  deck: DeckFrame | null;
  /**
   * Landmark and neighbourhood mosque pads kept free of trees, furniture and walkers: x, z, radius triples (bridges
   * excluded: their decks are linear and handled through `deck`).
   */
  pads: number[];
  /** Mosque pads (landmark mosques and neighbourhood mosques): x, z, radius triples. */
  mosques: number[];
  /** Pads as the buildings layer passes them to its infill (buildings/index.ts landmarkPads): x, z, radius. */
  infillPads: number[];
}

/** Ground cover raster: RGBA8 signed-distance coverage over the build rect (channels: cover/cover.ts CoverChannel). */
export interface CoverRaster {
  rgba: Uint8Array;
  w: number;
  h: number;
  minX: number;
  minZ: number;
  px: number;
}

/** Floats per walk graph vertex: x, y, z, nx, nz, half width. */
export const VERT_STRIDE = 6;

/**
 * Pedestrian walk network (crowd/graph.ts). Vertices carry a lateral frame so a pedestrian keeps its side of a lane
 * through bends: position = (x, z) + (nx, nz) * lateral * halfWidth.
 */
export interface WalkGraph {
  /** VERT_STRIDE floats per vertex. y is NaN on bridge decks (resolved on the main thread, see index.ts). */
  verts: Float32Array;
  /** CSR adjacency: the neighbours of v are nbr[start[v] .. start[v + 1]). */
  start: Uint32Array;
  nbr: Uint32Array;
  /** Desired pedestrian density (people per metre) of the edge behind each adjacency entry. */
  weight: Float32Array;
}

/** Floats per stationary person: x, y, z, yaw, pose, look seed. */
export const STANDER_STRIDE = 6;

/** Body poses of the people shader (crowd/people.ts). */
export const Pose = { Walk: 0, Stand: 1, Fish: 2, Sit: 3 } as const;

/** Floats per flag: pole base x, y, z, yaw of the cloth, pole height, kind (0 Turkish flag, 1 banner). */
export const FLAG_STRIDE = 6;

/** Floats per pigeon flock: x, y, z, radius, count. */
export const PIGEON_STRIDE = 5;

export interface DetailsResult {
  cover: { mesh: MeshArrays; raster: CoverRaster } | null;
  /** INSTANCE_STRIDE records per tree species. */
  trees: Record<TreeSpecies, Float32Array>;
  walk: WalkGraph;
  standers: Float32Array;
  /** Static street furniture merged into one vertex-coloured mesh (position, normal, color, aGlow). */
  props: MeshArrays | null;
  /** Rocking boats (position, normal, color, aGlow, aPivot = pivot x, z, rocking amplitude, phase). */
  boats: MeshArrays | null;
  flags: Float32Array;
  pigeons: Float32Array;
  stats: Record<string, number>;
}
