/**
 * Bakes src/world/landmarks/data/structure-volumes.json (npm run bake:structures): the solid volumes of the bridges,
 * which every other layer keeps clear of (src/world/landmarks/structure-volumes.ts). Re-run after changing a bridge
 * builder, a bridge landmark or the terrain; `npm run check:map` fails while the file is stale.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildHeadlessGeo } from '../../tools/headless/geo';
import { computeStructureVolumes } from '../../tools/headless/structure-volumes';
import { STRUCTURE_STRIDE } from '../../src/world/landmarks/structure-volumes';
import { ROOT } from '../../tools/world-compiler/lib/areas.mjs';

const file = computeStructureVolumes(buildHeadlessGeo());
const out = resolve(ROOT, 'src/world/landmarks/data/structure-volumes.json');
writeFileSync(out, `${JSON.stringify(file)}\n`);
console.log(`structure volumes: ${file.structures.map((s) => `${s.id} ${s.boxes.length / STRUCTURE_STRIDE}`).join(', ')} -> ${out}`);
