/// <reference lib="webworker" />
import { transferablesOf } from './mesh-builder';
import { generateAllSpecies } from './tree-gen';

/** Builds every species mesh off the main thread and transfers the vertex streams back. */
self.onmessage = (): void => {
  const t0 = performance.now();
  const meshes = generateAllSpecies();
  const transfer: ArrayBuffer[] = [];
  for (const m of meshes) {
    transfer.push(...transferablesOf(m.lod0), ...transferablesOf(m.lod1));
  }
  (self as unknown as Worker).postMessage({ meshes, ms: performance.now() - t0 }, transfer);
};
