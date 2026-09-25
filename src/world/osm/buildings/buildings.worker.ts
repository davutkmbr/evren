/// <reference lib="webworker" />
/** Builds the OSM building meshes, detail instances, rooftop props and colliders off the main thread (index.ts). */
import { LOD_LEAF_STRIDE, lodTileIndex } from '../shared/mesh-tiles';
import { StreetSurface } from '../shared/street-surface';
import { serveWorker } from '../shared/worker';
import { buildBuildings } from './build';
import { findInfill } from './infill';
import type { BuildingsRequest, BuildingsResult } from './protocol';
import { PROP_KINDS, type PropKind } from './roofs';

serveWorker<BuildingsRequest, BuildingsResult>((req) => {
  const t0 = performance.now();
  const surface = new StreetSurface(req.base);
  const infill = req.infill ? findInfill(req.buildings, req.infill, req.pads, surface, req.base.area) : { parcels: [], stats: {} };
  const t1 = performance.now();
  const b = buildBuildings({ buildings: req.buildings, pois: req.pois, pads: req.pads, extra: infill.parcels }, surface, req.base.rect);
  const details = b.details.take();
  const props = Object.fromEntries(PROP_KINDS.map((k) => [k, b.props[k].take()])) as Record<PropKind, Float32Array>;
  const facade = b.facade.take();
  const roof = b.roof.take();
  const facadeTiles = lodTileIndex(facade.attributes.position.array as Float32Array, facade.index, b.facade.takeTriLod());
  const roofTiles = lodTileIndex(roof.attributes.position.array as Float32Array, roof.index, b.roof.takeTriLod());
  const farTris = (leaves: Float64Array): number => {
    let n = 0;
    for (let k = 3; k < leaves.length; k += LOD_LEAF_STRIDE) {
      n += leaves[k] / 3;
    }
    return n;
  };
  facade.index = facadeTiles.index;
  roof.index = roofTiles.index;
  return {
    facade,
    facadeTiles: facadeTiles.leaves,
    roof,
    roofTiles: roofTiles.leaves,
    details: details.kinds,
    tiles: details.tiles,
    props,
    colliders: b.colliders,
    colliderIds: b.colliderIds,
    stats: {
      ...b.stats,
      ...infill.stats,
      ...Object.fromEntries(Object.entries(details.counts).map(([k, v]) => [`d_${k}`, v])),
      facadeTris: b.facade.triangles,
      roofTris: b.roof.triangles,
      facadeFarTris: farTris(facadeTiles.leaves),
      roofFarTris: farTris(roofTiles.leaves),
      infillMs: Math.round(t1 - t0),
      ms: Math.round(performance.now() - t0),
    },
  };
});
