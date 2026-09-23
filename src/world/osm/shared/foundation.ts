/**
 * Main-thread foundation shared by every layer: cuts the geo grids to the build rect and builds the street raster
 * once (foundation.worker.ts), producing the OsmWorkerBase that index.ts puts into OsmContext.base.
 */
import type { GeoQuery, GridData, WorldBounds } from '../../../core/contracts';
import type { OsmData } from '../data';
import type { FoundationRequest } from './foundation.worker';
import type { GridWin, OsmWorkerBase, StreetRaster } from './protocol';
import { streetRasterInput } from './street-field';
import { runWorker, type WorkerJob } from './worker';

/** Metres of geo grid kept around the rect (bilinear lookups near the edge). */
const WINDOW_MARGIN = 40;

function cutGrid<T extends Float32Array | Uint8Array>(grid: GridData<T>, data: T, rect: WorldBounds, margin: number): GridWin<T> {
  const cell = grid.cellSize;
  const c0 = Math.max(0, Math.floor((rect.minX - margin - grid.originX) / cell));
  const c1 = Math.min(grid.width - 1, Math.ceil((rect.maxX + margin - grid.originX) / cell));
  const r0 = Math.max(0, Math.floor((rect.minZ - margin - grid.originZ) / cell));
  const r1 = Math.min(grid.height - 1, Math.ceil((rect.maxZ + margin - grid.originZ) / cell));
  const w = c1 - c0 + 1;
  const h = r1 - r0 + 1;
  const Ctor = data.constructor as { new (n: number): T };
  const out = new Ctor(w * h);
  for (let r = 0; r < h; r++) {
    const src = (r0 + r) * grid.width + c0;
    out.set(data.subarray(src, src + w) as never, r * w);
  }
  return { data: out, w, h, x0: grid.originX + c0 * cell, z0: grid.originZ + r0 * cell, cell };
}

/** Height, coast distance and land use windows over `rect` (coast read from its texture when it has the grid layout). */
export function cutGeoWindows(geo: GeoQuery, rect: WorldBounds): Pick<OsmWorkerBase, 'height' | 'coast' | 'landUse'> {
  const height = cutGrid(geo.heightGrid, geo.heightGrid.data, rect, WINDOW_MARGIN);
  const coastTex = (geo.getCoastDistanceTexture().image as { data?: unknown }).data;
  let coast: GridWin<Float32Array>;
  if (coastTex instanceof Float32Array && coastTex.length === geo.heightGrid.width * geo.heightGrid.height) {
    coast = cutGrid(geo.heightGrid, coastTex, rect, WINDOW_MARGIN);
  } else {
    const data = new Float32Array(height.w * height.h);
    for (let r = 0; r < height.h; r++) {
      for (let c = 0; c < height.w; c++) {
        data[r * height.w + c] = geo.coastDistance(height.x0 + c * height.cell, height.z0 + r * height.cell);
      }
    }
    coast = { ...height, data };
  }
  const landUse = cutGrid(geo.landUseGrid, geo.landUseGrid.data, rect, WINDOW_MARGIN);
  return { height, coast, landUse };
}

/** Landmark discs (grown by 10 m) and neighbourhood mosque pads as x, z, radius triples. */
export function reservedPads(geo: GeoQuery): number[] {
  const out: number[] = [];
  for (const l of geo.landmarks) {
    out.push(l.x, l.z, l.radius + 10);
  }
  for (const m of geo.smallMosqueSites) {
    out.push(m.x, m.z, m.radius);
  }
  return out;
}

/** Builds the worker base (geo windows + street raster); `ms` is the raster worker time. */
export function buildWorkerBase(geo: GeoQuery, data: OsmData, rect: WorldBounds, area: WorldBounds): WorkerJob<{ base: OsmWorkerBase; ms: number }> {
  const windows = cutGeoWindows(geo, rect);
  const reserved = reservedPads(geo);
  const worker = new Worker(new URL('./foundation.worker.ts', import.meta.url), { type: 'module', name: 'osm-foundation' });
  const job = runWorker<FoundationRequest, { street: StreetRaster; ms: number }>(worker, { data: streetRasterInput(data), rect });
  return {
    promise: job.promise.then(({ street, ms }) => ({ base: { rect, area, ...windows, reserved, street }, ms })),
    cancel: job.cancel,
  };
}
