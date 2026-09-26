/// <reference lib="webworker" />
/**
 * City generation worker: holds static world data, answers tile (geometry) and collider requests. With the far OSM
 * layer (phase 24) a request waits for its 2 km bake block (osm-blocks.ts) before it is built.
 */
import { LEVEL_SIZES, type ColliderRequestMsg, type CityWorkerRequest, type CityWorkerResult, type TileRequestMsg } from '../protocol';
import type { DecodedBuildings } from '../osm/format';
import { blockKeyOf, loadBlock } from './osm-blocks';
import { buildColliders, buildTile, forgetCells } from './tile';
import { WorldData } from './world-data';

declare const self: DedicatedWorkerGlobalScope;

const WORLD_HALF = 24000;

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
  const w = world;
  // The far OSM layer's block (one per tile: city tiles lie inside one 2 km block) is fetched first when there is one.
  const x0 = -WORLD_HALF + msg.ix * (msg.type === 'tile' ? LEVEL_SIZES[msg.level] : msg.size);
  const z0 = -WORLD_HALF + msg.iz * (msg.type === 'tile' ? LEVEL_SIZES[msg.level] : msg.size);
  const blockJob = w.osm ? loadBlock(w.osm, blockKeyOf(x0 + 1, z0 + 1)) : Promise.resolve(null);
  void blockJob.then((block) => run(msg, w, block));
};

function run(msg: TileRequestMsg | ColliderRequestMsg, world: WorldData, block: DecodedBuildings | null): void {
  try {
    const res = msg.type === 'tile' ? buildTile(msg, world, block) : buildColliders(msg, world, block);
    self.postMessage(res, transferables(res));
  } catch (err) {
    console.error('[city.worker] job failed', err);
    if (msg.type === 'tile') {
      const empty: CityWorkerResult = { type: 'tile', id: msg.id, mesh: null, sphere: [0, 0, 0, 0], top: 0, lampPos: new Float32Array(0), lampCol: new Uint8Array(0), buildings: 0, classEnds: [0, 0, 0, 0], detailStart: 0, nearWater: false, ms: 0 };
      self.postMessage(empty);
    } else {
      self.postMessage({ type: 'colliders', id: msg.id, boxes: new Float32Array(0), ms: 0 } satisfies CityWorkerResult);
    }
  }
}
