/**
 * No vehicles on the water: builds the flight-scale road network (life/traffic/road-network.ts) with the bridge decks
 * of the structure builders (as the 'roadSurface' service publishes them) and checks that every road sample off a
 * deck over the sea (terrain at least 0.4 m below the water line) hides its cars.
 *
 *   npx tsx tools/headless/traffic-water-check.ts
 */
import { buildHeadlessGeo } from './geo';
import type { DeckData } from '../../src/world/landmarks/structures/types';
import { StructureBuild } from '../../src/world/landmarks/structures/build/context';
import { builderFor } from '../../src/world/landmarks/structures/builders/registry';
import { prepareSite } from '../../src/world/landmarks/structures/system/site-planner';
import { RoadSurface } from '../../src/world/landmarks/structures/system/road-surface';
import { RoadNetwork, SampleKind } from '../../src/world/life/traffic/road-network';

const geo = buildHeadlessGeo();
const decks: DeckData[] = [];
for (const l of geo.landmarks) {
  if (l.builder !== 'structures') {
    continue;
  }
  const b = new StructureBuild(prepareSite(l, geo));
  builderFor(b.def)(b);
  decks.push(...b.result(0).decks);
}
const net = new RoadNetwork(geo, 1, [], new RoadSurface(decks));
let total = 0;
let overWater = 0;
const shown = new Map<string, number>();
for (const t of net.tracks) {
  for (let k = 0; k < t.count; k++) {
    const i = t.start + k;
    const o = i * net.stride;
    total++;
    if (net.kinds[i] !== SampleKind.Ground || geo.heightAt(net.samples[o], net.samples[o + 2]) > -0.4) {
      continue;
    }
    overWater++;
    if (net.samples[o + 3] < 0.999) {
      const n = t.def.name ?? t.def.kind;
      shown.set(n, (shown.get(n) ?? 0) + 1);
    }
  }
}
console.log(`${total} road samples, ${decks.length} bridge decks, ${overWater} off-deck samples over the water`);
for (const [name, n] of shown) {
  console.log(`FAIL ${name}: cars shown on ${n} samples over the water`);
}
process.exit(shown.size ? 1 : 0);
