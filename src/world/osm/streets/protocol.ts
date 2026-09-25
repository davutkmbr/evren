/** Messages between the streets layer and streets.worker.ts. */
import type { OsmData } from '../data';
import type { MeshArrays, OsmWorkerBase } from '../shared/protocol';
import type { PropKind } from './kinds';
import type { LightPool } from './lamps';

export interface StreetsRequest {
  base: OsmWorkerBase;
  data: Pick<OsmData, 'roads' | 'rails' | 'points' | 'buildings' | 'areas' | 'lines'>;
}

export interface StreetsResult {
  meshes: Partial<Record<'ground' | 'paint' | 'rails' | 'inlay' | 'masonry' | 'wires', MeshArrays>>;
  /** Near / far leaf table of the ground mesh (shared/mesh-tiles.ts lodTileIndex; far = plain 5 m grid cells). */
  groundTiles: Float64Array;
  /** INSTANCE_STRIDE records per street furniture model. */
  instances: Record<PropKind, Float32Array>;
  /** Light type (kinds.ts Light) per instance. */
  lights: Record<PropKind, Float32Array>;
  /** Lamp head sprites: x, y, z, r, g, b, radius. */
  sprites: Float32Array;
  pool: LightPool;
  stats: Record<string, number>;
}
