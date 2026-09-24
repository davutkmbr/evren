/// <reference lib="webworker" />
/** Builds the ground mesh, markings, masonry, overhead wires and street furniture off the main thread (index.ts). */
import { FootprintIndex } from '../shared/footprints';
import { classifyPaths, classifyStreets } from '../shared/street-field';
import { StreetSurface } from '../shared/street-surface';
import { serveWorker } from '../shared/worker';
import { buildBarriers } from './barriers';
import { buildCatenary } from './catenary';
import { buildDecals } from './decals';
import { buildFurniture } from './furniture';
import { tileIndex } from '../shared/mesh-tiles';
import { buildGroundMesh } from './ground-mesh';
import { buildLamps } from './lamps';
import { buildPlatforms, buildQuay, buildSteps, masonryMesh } from './masonry';
import type { StreetsRequest, StreetsResult } from './protocol';
import { landPads } from './pads';
import { PropSink } from './sink';

serveWorker<StreetsRequest, StreetsResult>((req) => {
  const t0 = performance.now();
  const surface = new StreetSurface(req.base);
  const footprints = new FootprintIndex(req.data.buildings);
  const streets = classifyStreets(req.data.roads);
  const paths = classifyPaths(req.data.roads);
  const t1 = performance.now();
  const padded = landPads(surface.geo, req.base.reserved);
  const ground = buildGroundMesh(surface, padded);
  const t2 = performance.now();
  const sink = new PropSink();
  const lamps = buildLamps(streets, paths, req.data, surface, footprints, sink, padded);
  const furniture = buildFurniture(streets, req.data, surface, footprints, sink);
  const catenary = buildCatenary(req.data, surface, footprints, sink);
  const decals = buildDecals(streets, req.data, surface, furniture.marks);
  const masonry = masonryMesh();
  const steps = buildSteps(masonry, paths, surface);
  const platforms = buildPlatforms(masonry, req.data, surface);
  const quay = buildQuay(masonry, ground.quay, surface, req.base.rect);
  const barriers = buildBarriers(masonry, req.data, surface, padded, req.base.rect);
  const { instances, lights } = sink.take();
  const groundArrays = ground.mesh.take();
  const tiled = tileIndex(groundArrays.attributes.position.array as Float32Array, groundArrays.index);
  groundArrays.index = tiled.index;
  return {
    groundTiles: tiled.tiles,
    meshes: {
      ground: groundArrays,
      paint: decals.paint.take('color'),
      rails: decals.rails.take('color'),
      inlay: decals.inlay.take('color'),
      masonry: masonry.take('color'),
      wires: catenary.wires.take(),
    },
    instances,
    lights,
    sprites: lamps.sprites,
    pool: lamps.pool,
    stats: {
      streets: streets.length,
      paths: paths.length,
      groundTris: ground.mesh.triangles,
      refinedCells: ground.stats.refined,
      kerbFaces: ground.stats.kerbFaces,
      groundPrepMs: ground.stats.prepMs,
      groundMeshMs: ground.stats.meshMs,
      crossings: decals.crossings,
      manholes: decals.manholes,
      lamps: lamps.lamps,
      masts: catenary.masts,
      steps,
      platforms,
      quay,
      ...barriers,
      ...furniture.stats,
      liftMs: Math.round(t1 - t0),
      groundMs: Math.round(t2 - t1),
      ms: Math.round(performance.now() - t0),
    },
  };
});
