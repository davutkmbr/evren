/// <reference lib="webworker" />
/** City generation worker: holds static world data, answers tile (geometry) and collider requests. */
import type { CityWorkerRequest, CityWorkerResult } from '../protocol';
import { buildColliders, buildTile, forgetCells } from './tile';
import { WorldData } from './world-data';

declare const self: DedicatedWorkerGlobalScope;

let world: WorldData | null = null;

function transferables(res: CityWorkerResult): Transferable[] {
  if (res.type === 'colliders') {
    return [res.boxes.buffer];
  }
  const list: Transferable[] = [res.lampPos.buffer, res.lampCol.buffer];
  if (res.mesh) {
    const m = res.mesh;
    list.push(m.position.buffer, m.normal.buffer, m.facade.buffer, m.color.buffer, m.params.buffer, m.index.buffer);
  }
  return list;
}

self.onmessage = (ev: MessageEvent<CityWorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    world = new WorldData(msg);
    return;
  }
  if (msg.type === 'forget') {
    forgetCells(msg);
    return;
  }
  if (!world) {
    return;
  }
  try {
    const res = msg.type === 'tile' ? buildTile(msg, world) : buildColliders(msg, world);
    self.postMessage(res, transferables(res));
  } catch (err) {
    console.error('[city.worker] job failed', err);
    if (msg.type === 'tile') {
      const empty: CityWorkerResult = { type: 'tile', id: msg.id, mesh: null, sphere: [0, 0, 0, 0], lampPos: new Float32Array(0), lampCol: new Uint8Array(0), buildings: 0, classEnds: [0, 0, 0, 0], detailStart: 0, nearWater: false, ms: 0 };
      self.postMessage(empty);
    } else {
      self.postMessage({ type: 'colliders', id: msg.id, boxes: new Float32Array(0), ms: 0 } satisfies CityWorkerResult);
    }
  }
};
