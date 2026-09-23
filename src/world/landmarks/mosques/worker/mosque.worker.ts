/// <reference lib="webworker" />
import { runMosqueJob } from './run';
import { modelTransferables, type MosqueRequest, type MosqueResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<MosqueRequest>) => {
  const { id, job } = event.data;
  const t0 = performance.now();
  try {
    const models = runMosqueJob(job);
    const response: MosqueResponse = { id, models, ms: performance.now() - t0 };
    scope.postMessage(response, modelTransferables(models));
  } catch (err) {
    const response: MosqueResponse = { id, models: [], error: String((err as Error)?.stack ?? err), ms: performance.now() - t0 };
    scope.postMessage(response);
  }
};
