/**
 * Details layer of one OSM region, headless: builds the region's worker base (geo windows + street raster) and runs the
 * details build (osm/details/details.worker.ts buildDetails) as the game does, then prints the build stats: props per
 * kind (p_*), stand refusals, trees, walkers and timings.
 *
 *   npx tsx tools/headless/osm-details-check.ts [region id ...]      # default: besiktas kadikoy sultanahmet
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildHeadlessGeo } from './geo';
import { osmRegions } from '../../src/world/osm/regions';
import type { OsmData } from '../../src/world/osm/data';
import { clipWaysToLand } from '../../src/world/osm/shared/land';
import { openLandmarkPassages } from '../../src/world/osm/shared/landmark-passages';
import { landmarkClaims } from '../../src/world/landmarks/claims';
import { groundRect } from '../../src/world/osm/shared/ground';
import { cutGeoWindows, reservedPads } from '../../src/world/osm/shared/foundation';
import { buildStreetRaster, streetRasterInput } from '../../src/world/osm/shared/street-field';
import { buildDetails } from '../../src/world/osm/details/details.worker';
import { mosquePads } from '../../src/world/osm/details/mosque-pads';
import { perchClearings } from '../../src/world/perches/clearings';
import type { OsmWorkerBase } from '../../src/world/osm/shared/protocol';

const ROOT = resolve(import.meta.dirname, '../..');
const geo = buildHeadlessGeo();
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['besiktas', 'kadikoy', 'sultanahmet'];
for (const id of ids) {
  const def = osmRegions().find((r) => r.id === id);
  if (!def) {
    console.log(`${id}: no such region`);
    continue;
  }
  const t0 = performance.now();
  const data = JSON.parse(readFileSync(resolve(ROOT, 'public', def.url.replace(/^\//, '')), 'utf8')) as OsmData;
  clipWaysToLand(data, (x, z) => geo.coastDistance(x, z));
  const claims = landmarkClaims(geo);
  openLandmarkPassages(data, claims);
  const rect = groundRect(def.rect);
  const street = buildStreetRaster(streetRasterInput(data, (x, z) => geo.coastDistance(x, z)), rect);
  const base = { rect, area: def.area, ...cutGeoWindows(geo, rect), reserved: reservedPads(geo), street, fade: def.fade } as OsmWorkerBase;
  const res = buildDetails({
    base,
    data: { points: data.points, lines: data.lines, areas: data.areas, buildings: data.buildings, roads: data.roads, rails: data.rails },
    crowdScale: 1,
    deck: null,
    pads: Array.from(landmarkClaims(geo, 10).pads),
    lines: Array.from(claims.lines),
    infillClaims: claims,
    mosques: mosquePads(geo),
    clearings: perchClearings(geo),
  });
  const st = res.stats as Record<string, number>;
  const props = Object.entries(st).filter(([k]) => k.startsWith('p_')).map(([k, v]) => `${k.slice(2)} ${v}`);
  const refused = Object.entries(st).filter(([k, v]) => k.startsWith('stand.') && !k.endsWith('kept') && v > 0).map(([k, v]) => `${k.slice(6)} ${v}`);
  console.log(`${id}: ${Math.round(performance.now() - t0)} ms, prop tris ${st.propTris} + kits ${st.kitTris} (drawn through the street hole), trees ${st.trees}`);
  console.log(`  props: ${props.join(', ')}`);
  console.log(`  refused by the stand rule: ${refused.join(', ') || '-'}`);
}
