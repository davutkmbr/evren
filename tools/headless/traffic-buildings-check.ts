/**
 * No vehicles through buildings: builds the lane graph of every flight-scale OSM region as the traffic worker does
 * (osm/traffic/network.ts with the building obstacles, osm/traffic/obstacles.ts) and counts the samples of visible
 * lanes and connectors that lie inside a building. Tunnels (hidden paths) are not counted.
 *
 *   npx tsx tools/headless/traffic-buildings-check.ts [--region a,b] [--verbose]
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OsmData } from '../../src/world/osm/data';
import { buildNetwork } from '../../src/world/osm/traffic/network';
import { BuildingObstacles } from '../../src/world/osm/traffic/obstacles';
import { PathFlag } from '../../src/world/osm/traffic/paths';
import { LaneFlag, SAMPLE_STRIDE } from '../../src/world/osm/traffic/protocol';
import { osmRegions } from '../../src/world/osm/regions';
import { cutGeoWindows, reservedPads } from '../../src/world/osm/shared/foundation';
import { groundRect } from '../../src/world/osm/shared/ground';
import type { OsmWorkerBase } from '../../src/world/osm/shared/protocol';
import { buildStreetRaster, streetRasterInput } from '../../src/world/osm/shared/street-field';
import { StreetSurface } from '../../src/world/osm/shared/street-surface';
import { ROOT } from '../world-compiler/lib/areas.mjs';
import { buildHeadlessGeo } from './geo';

/** Share of visible path samples allowed inside a building (resampling of the lane paths near façades). */
const MAX_SHARE = 0.0002;

const args = process.argv.slice(2);
const ONLY = args.includes('--region') ? args[args.indexOf('--region') + 1].split(',') : null;
const VERBOSE = args.includes('--verbose');

const geo = buildHeadlessGeo();
let samples = 0;
let blocked = 0;
let lanes = 0;
let sinks = 0;
for (const r of osmRegions()) {
  const file = resolve(ROOT, 'public', r.url.replace(/^\//, ''));
  if ((ONLY && !ONLY.includes(r.id)) || !existsSync(file)) {
    continue;
  }
  const data = JSON.parse(readFileSync(file, 'utf8')) as OsmData;
  const rect = groundRect(r.rect);
  const base = { rect, area: r.area, ...cutGeoWindows(geo, rect), reserved: reservedPads(geo), street: buildStreetRaster(streetRasterInput(data, (x, z) => geo.coastDistance(x, z)), rect) } as OsmWorkerBase;
  const obstacles = new BuildingObstacles(data.buildings);
  const net = buildNetwork(data, new StreetSurface(base), r.rect, [], obstacles);
  const p = net.pool;
  let here = 0;
  for (let id = 0; id < p.size; id++) {
    if (p.flags[id] & PathFlag.Hidden) {
      continue;
    }
    for (let k = 0; k < p.count[id]; k++) {
      const o = (p.start[id] + k) * SAMPLE_STRIDE;
      samples++;
      if (obstacles.blocks(p.samples.array[o], p.samples.array[o + 2])) {
        here++;
        if (VERBOSE && here <= 3) {
          console.log(`  ${r.id}: ${p.samples.array[o].toFixed(0)}, ${p.samples.array[o + 2].toFixed(0)}`);
        }
      }
    }
  }
  blocked += here;
  lanes += net.lanes.length;
  sinks += net.lanes.filter((l) => l.flags & LaneFlag.Sink).length;
}
const share = blocked / Math.max(1, samples);
console.log(`${samples} visible lane / connector samples in ${lanes} lanes (${sinks} sinks): ${blocked} inside a building (${(share * 100).toFixed(3)} %, max ${(MAX_SHARE * 100).toFixed(2)} %)`);
process.exit(share > MAX_SHARE ? 1 : 0);
