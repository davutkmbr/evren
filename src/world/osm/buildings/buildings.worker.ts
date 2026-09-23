/// <reference lib="webworker" />
/** Builds the OSM building meshes, detail instances, rooftop props and colliders off the main thread (index.ts). */
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
  return {
    facade: b.facade.take(),
    roof: b.roof.take(),
    details: details.kinds,
    tiles: details.tiles,
    props,
    colliders: b.colliders,
    stats: {
      ...b.stats,
      ...infill.stats,
      ...Object.fromEntries(Object.entries(details.counts).map(([k, v]) => [`d_${k}`, v])),
      facadeTris: b.facade.triangles,
      roofTris: b.roof.triangles,
      infillMs: Math.round(t1 - t0),
      ms: Math.round(performance.now() - t0),
    },
  };
});
