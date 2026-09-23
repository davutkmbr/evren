/// <reference lib="webworker" />
import { bakeBands } from './spectrum-bake';
import { bakeFoam } from './foam-bake';
import { bakeRegions } from './region-bake';
import type { WaterJobRequest, WaterJobResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<WaterJobRequest>): void => {
  const job = event.data;
  try {
    if (job.kind === 'spectrum') {
      const t0 = performance.now();
      const bands = bakeBands();
      const foam = bakeFoam();
      const msg: WaterJobResponse = { id: job.id, ok: true, kind: 'spectrum', result: { bands, foam, ms: Math.round(performance.now() - t0) } };
      scope.postMessage(msg, [bands.data.buffer, foam.data.buffer]);
    } else {
      const result = bakeRegions(job.input);
      const msg: WaterJobResponse = { id: job.id, ok: true, kind: 'regions', result };
      scope.postMessage(msg, [result.flow.buffer, result.region.buffer]);
    }
  } catch (err) {
    const msg: WaterJobResponse = { id: job.id, ok: false, error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) };
    scope.postMessage(msg);
  }
};
