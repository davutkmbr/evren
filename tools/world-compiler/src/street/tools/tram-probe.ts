/** Dev tool: corrected tram track near a point vs OSM (npx tsx tram-probe.ts x,z,r). */
import { resolve } from 'node:path';
import { latLonToLocal } from '../../../../../src/core/geo-coords';
import { readArea, ROOT } from '../../../lib/areas.mjs';
import { buildFoundation } from '../../foundation';
import { groundHeights, landField, PierField } from '../../ground';
import { loadStreetData } from '../../osm-street';
import { streetContext } from '../common';

const area = readArea('kadikoy');
const data = loadStreetData(resolve(ROOT, area.dataFile));
const sw = latLonToLocal(area.bbox.south, area.bbox.west);
const ne = latLonToLocal(area.bbox.north, area.bbox.east);
const T = 100;
const rect = { minX: Math.floor(sw.x / T) * T, maxX: Math.ceil(ne.x / T) * T, minZ: Math.floor(ne.z / T) * T, maxZ: Math.ceil(sw.z / T) * T };
const f = buildFoundation(data, rect);
const piers = new PierField(data);
const land = landField(f, piers);
const h = groundHeights(f.surface);
const a = { shared: new Map(), data, foundation: f, heights: h, land } as unknown as Parameters<typeof streetContext>[0];
const sc = streetContext(a);
const [cx, cz, r] = (process.argv[2] ?? '271,6032,30').split(',').map(Number);
for (const tr of sc.tram) {
  for (let k = 0; k < tr.pts.length; k += 2) {
    const x = tr.pts[k];
    const z = tr.pts[k + 1];
    if (Math.hypot(x - cx, z - cz) < r) {
      console.log(x.toFixed(2), z.toFixed(2), 'D', f.surface.distance(x, z).toFixed(2));
    }
  }
}
