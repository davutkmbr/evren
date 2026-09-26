/** Messages between the buildings layer and buildings.worker.ts. */
import type { OsmArea, OsmBuilding, OsmRail, OsmRoad } from '../data';
import type { LandmarkClaims } from '../../landmarks/claim-shapes';
import type { Passage } from '../shared/passages';
import type { MeshArrays, OsmWorkerBase } from '../shared/protocol';
import type { DetailKind, DetailStream, DetailTiles } from './details';
import type { PropKind } from './roofs';

export interface BuildingsRequest {
  base: OsmWorkerBase;
  buildings: OsmBuilding[];
  /** x, z, Poi kind triples (build.ts Poi). */
  pois: Float32Array;
  /** Ground claims of the modelled landmarks and neighbourhood mosques (landmarks/claims.ts). */
  claims: LandmarkClaims;
  /** Building passages (shared/passages.ts findPassages) the buildings open: arches, lining, free colliders. */
  passages?: Passage[];
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
  /** Footprint prism records (encodePrism). */
  colliders: Float32Array;
  /** OSM id per prism record. */
  colliderIds: Float64Array;
  stats: Record<string, number>;
}

/** Appends a footprint prism record: bottom, top, ring count, then per ring its point count and x, z pairs. */
export function encodePrism(out: number[], bottom: number, top: number, rings: readonly (readonly number[])[]): void {
  out.push(bottom, top, rings.length);
  for (const ring of rings) {
    out.push(ring.length / 2);
    for (const v of ring) {
      out.push(v);
    }
  }
}

/** Reads the prism records written by encodePrism. */
export function decodePrisms(data: Float32Array, visit: (bottom: number, top: number, rings: Float32Array[], index: number) => void): void {
  let k = 0;
  let index = 0;
  while (k < data.length) {
    const bottom = data[k];
    const top = data[k + 1];
    const count = data[k + 2];
    k += 3;
    const rings: Float32Array[] = [];
    for (let i = 0; i < count; i++) {
      const n = data[k++];
      rings.push(data.slice(k, k + n * 2));
      k += n * 2;
    }
    visit(bottom, top, rings, index++);
  }
}
