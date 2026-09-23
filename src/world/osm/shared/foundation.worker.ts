/// <reference lib="webworker" />
/** Builds the shared street raster once per load (see foundation.ts); layer workers receive it in OsmWorkerBase. */
import type { WorldBounds } from '../../../core/contracts';
import type { StreetRaster } from './protocol';
import { buildStreetRaster, type StreetRasterInput } from './street-field';
import { serveWorker } from './worker';

export interface FoundationRequest {
  data: StreetRasterInput;
  rect: WorldBounds;
}

serveWorker<FoundationRequest, { street: StreetRaster; ms: number }>((req) => {
  const t0 = performance.now();
  const street = buildStreetRaster(req.data, req.rect);
  return { street, ms: Math.round(performance.now() - t0) };
});
