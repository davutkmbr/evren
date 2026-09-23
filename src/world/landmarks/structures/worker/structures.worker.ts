/**
 * Structures geometry worker: builds every requested site with its registered builder and streams the results
 * back (typed arrays transferred, never copied).
 */
import { StructureBuild } from '../build/context';
import { builderFor } from '../builders/registry';
import type { StructureResult, WorkerRequest, WorkerResponse } from '../types';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (msg: WorkerResponse, transfer?: Transferable[]) => void;
};

function transferables(r: StructureResult): Transferable[] {
  const list: Transferable[] = [r.wires.buffer as ArrayBuffer, r.lights.buffer as ArrayBuffer];
  for (const d of r.decks) {
    list.push(d.heights.buffer as ArrayBuffer);
  }
  for (const p of r.parts) {
    for (const g of p.lods) {
      list.push(g.position.buffer as ArrayBuffer, g.normal.buffer as ArrayBuffer, g.uv.buffer as ArrayBuffer);
      list.push(g.color.buffer as ArrayBuffer, g.surf.buffer as ArrayBuffer, g.emit.buffer as ArrayBuffer, g.index.buffer as ArrayBuffer);
    }
  }
  return list;
}

scope.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.type !== 'build') {
    return;
  }
  const t0 = performance.now();
  for (const site of req.sites) {
    const t = performance.now();
    try {
      const build = new StructureBuild(site);
      builderFor(site.def)(build);
      const result = build.result(performance.now() - t);
      const msg: WorkerResponse = { type: 'structure', result };
      scope.postMessage(msg, transferables(result));
    } catch (err) {
      const msg: WorkerResponse = { type: 'error', id: site.def.id, message: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) };
      scope.postMessage(msg);
    }
  }
  const done: WorkerResponse = { type: 'done', ms: performance.now() - t0 };
  scope.postMessage(done);
};
