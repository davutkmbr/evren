/** Dev tool: prints the ground fields (land, carriageway distance, kerb, surface) at points (npx tsx field-probe.ts x,z ...). */
import { resolve } from 'node:path';
import { latLonToLocal } from '../../../../../src/core/geo-coords';
import { readArea, ROOT } from '../../../lib/areas.mjs';
import { buildFoundation } from '../../foundation';
import { groundHeights, landField, PierField } from '../../ground';
import { loadStreetData } from '../../osm-street';

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
for (const arg of process.argv.slice(2)) {
  const [x, z] = arg.split(',').map(Number);
  const s = f.surface;
  console.log(arg, { land: +land(x, z).toFixed(2), coast: +s.geo.coast(x, z).toFixed(2), pier: +piers.at(x, z).toFixed(2), water: s.geo.isWater(x, z), D: +s.distance(x, z).toFixed(2), B: +s.buildingDistance(x, z).toFixed(2), kerbed: s.kerbed(x, z), ped: s.pedestrianStreet(x, z), ground: s.groundAt(x, z), y: +h.at(x, z).toFixed(2), inside: f.footprints.inside(x, z) });
}

if (process.env.CROSSINGS) {
  const { streetContext } = await import('../common');
  const a = { shared: new Map(), data, foundation: f, heights: h, land } as unknown as Parameters<typeof streetContext>[0];
  const sc = streetContext(a);
  const [cx, cz, r] = process.env.CROSSINGS.split(',').map(Number);
  for (const c of sc.crossings) {
    if (Math.hypot((c.ax + c.bx) / 2 - cx, (c.az + c.bz) / 2 - cz) < r) {
      console.log('crossing', c.kind, [c.ax, c.az, c.bx, c.bz].map((v) => v.toFixed(1)).join(','), 'width', c.width, 'street', sc.streets[c.street].kind, sc.streets[c.street].name);
    }
  }
  console.log('dropped near', sc.dropped.filter((d) => Math.hypot(d.x - cx, d.z - cz) < r).length);
}
