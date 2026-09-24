// Dev tool: LOD0 triangles per material of one tile glb (node tri-probe.mjs <glb>).
import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read(process.argv[2]);
const per = new Map();
let total = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const p of mesh.listPrimitives()) {
    const n = (p.getIndices()?.getCount() ?? 0) / 3;
    total += n;
    const m = p.getMaterial()?.getName() ?? '?';
    per.set(m, (per.get(m) ?? 0) + n);
  }
}
const mine = /^(st_(oil|grime|gum|gap|crack|seal|apron|apron_patch|road_patch|pit_soil|wet|rail|groove|cable|kerb))/;
let wear = 0;
for (const [m, n] of per) if (/^st_(oil|grime|gum|gap|crack|seal|apron_patch|road_patch|pit_soil)$/.test(m)) wear += n;
console.log(process.argv[2].split('/').pop(), 'total', total, 'wearDecals', wear, [...per.entries()].filter(([m]) => mine.test(m)).map(([m, n]) => `${m}:${n}`).join(' '));
