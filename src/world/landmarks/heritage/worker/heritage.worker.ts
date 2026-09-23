/// <reference lib="webworker" />
import type { SiteJob, SiteResult, WorkerRequest, WorkerResponse } from '../protocol';
import { buildSite } from './build-site';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (ev: MessageEvent<WorkerRequest>): void => {
  const msg = ev.data;
  if (msg.type !== 'build') {
    return;
  }
  for (const job of msg.jobs) {
    const result: SiteResult = buildSite(job);
    const transfer: Transferable[] = [];
    for (const c of result.chunks) {
      for (const l of c.lods) {
        transfer.push(l.positions.buffer, l.normals.buffer, l.uvs.buffer, l.colors.buffer, l.surf.buffer, l.index.buffer);
      }
    }
    const out: WorkerResponse = { type: 'site', result };
    self.postMessage(out, transfer);
  }
  const done: WorkerResponse = { type: 'done' };
  self.postMessage(done);
};

export type { SiteJob };
