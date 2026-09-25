/** Messages between the buildings layer and buildings.worker.ts. */
import type { OsmArea, OsmBuilding, OsmRail, OsmRoad } from '../data';
import type { MeshArrays, OsmWorkerBase } from '../shared/protocol';
import type { DetailKind, DetailStream, DetailTiles } from './details';
import type { PropKind } from './roofs';

export interface BuildingsRequest {
  base: OsmWorkerBase;
  buildings: OsmBuilding[];
  /** x, z, Poi kind triples (build.ts Poi). */
  pois: Float32Array;
  /** Landmark and mosque pads (x, z, radius), bridges excluded. */
  pads: Float32Array;
  /** Street and open-space data for the infill of blocks OSM leaves empty (infill.ts); null disables infill. */
  infill: { roads: OsmRoad[]; areas: OsmArea[]; rails: OsmRail[] } | null;
}

export interface BuildingsResult {
  facade: MeshArrays;
  /** Near / far leaf tables of `facade` / `roof` (shared/mesh-tiles.ts lodTileIndex). */
  facadeTiles: Float64Array;
  roof: MeshArrays;
  roofTiles: Float64Array;
  details: Partial<Record<DetailKind, DetailStream>>;
  tiles: DetailTiles;
  /** INSTANCE_STRIDE records per rooftop prop kind. */
  props: Record<PropKind, Float32Array>;
  /** COLLIDER_STRIDE records. */
  colliders: Float32Array;
  stats: Record<string, number>;
}
