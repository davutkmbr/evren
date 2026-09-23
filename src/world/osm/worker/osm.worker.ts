/// <reference lib="webworker" />
/** Builds every OSM prototype mesh off the main thread (see ../index.ts). */
import type { MeshArrays, OsmBuildRequest, OsmBuildResult } from '../protocol';
import { buildBuildings, FACADE_SETS } from './buildings';
import { buildDecals, buildLamps, buildTrees, classifyStreets, GroundGrid, StreetField } from './streets';
import { GeoSampler } from './support';

function build(req: OsmBuildRequest): OsmBuildResult {
  const t0 = performance.now();
  const geo = new GeoSampler(req);
  const { rect, data } = req;
  const extent = Math.max(rect.maxX - rect.minX, rect.maxZ - rect.minZ);
  const field = new StreetField(rect.minX, rect.minZ, extent);
  const streets = classifyStreets(data.roads);
  for (const s of streets) {
    field.stampStreet(s);
  }
  for (const p of data.plazas) {
    field.fillPlaza(p.ring);
  }
  const tField = performance.now();
  const b = buildBuildings(data.buildings, geo, field, req.reserved, rect);
  const tBuild = performance.now();
  const ground = new GroundGrid(rect.minX, rect.minZ, rect.maxX, rect.maxZ, geo);
  const groundMesh = ground.build(field, req.reserved);
  const decals = buildDecals(streets, data, ground, field);
  const lamps = buildLamps(streets, ground, geo, b.index, field);
  const trees = buildTrees(data, geo, b.index);
  const meshes: Record<string, MeshArrays> = {};
  for (const k of FACADE_SETS) {
    meshes[k] = b.facades[k].take('color');
  }
  meshes.roof = b.roof.take('color');
  meshes.ground = groundMesh.take();
  meshes.paint = decals.paint.take('color');
  meshes.rails = decals.rails.take('color');
  const t1 = performance.now();
  return {
    meshes,
    instances: { ...b.instances, lampArm: lamps.arm, lampLantern: lamps.lantern, tree: trees },
    colliders: b.colliders,
    mask: { rgba: field.rgba(), size: field.size, pool: lamps.pool, poolSize: lamps.poolSize, minX: field.minX, minZ: field.minZ, extent },
    stats: {
      ...b.stats,
      streets: streets.length,
      crossings: decals.crossings,
      lamps: (lamps.arm.length + lamps.lantern.length) / 9,
      trees: trees.length / 9,
      fieldMs: Math.round(tField - t0),
      buildingsMs: Math.round(tBuild - tField),
      streetsMs: Math.round(t1 - tBuild),
      totalMs: Math.round(performance.now() - t0),
    },
  };
}

function transferables(res: OsmBuildResult): Transferable[] {
  const list: Transferable[] = [res.colliders.buffer, res.mask.rgba.buffer, res.mask.pool.buffer];
  for (const m of Object.values(res.meshes)) {
    list.push(m.index.buffer);
    for (const a of Object.values(m.attributes)) {
      list.push(a.array.buffer);
    }
  }
  for (const a of Object.values(res.instances)) {
    list.push(a.buffer);
  }
  return list;
}

self.onmessage = (e: MessageEvent<OsmBuildRequest>) => {
  try {
    const res = build(e.data);
    (self as unknown as Worker).postMessage({ ok: true, res }, transferables(res));
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String((err as Error)?.stack ?? err) });
  }
};
