/**
 * Builds the real GeoQuery in Node (no browser, no GPU) with the same steps as the geo system's init, for headless
 * checks and tests: `import { buildHeadlessGeo } from '../headless/geo'` and run the script with `npx tsx`.
 */
import { buildWorld } from '../../src/world/geo/build/build-world';
import { buildCoastlines, buildDistrictDefs, buildLandmarkDefs, buildRoadDefs, prepareBuildInput } from '../../src/world/geo/prepare';
import { GeoQueryImpl } from '../../src/world/geo/query';

let cached: GeoQueryImpl | null = null;

/** Builds (once per process) and returns the world geography; takes a few seconds. */
export function buildHeadlessGeo(): GeoQueryImpl {
  if (cached) {
    return cached;
  }
  const { input, padIndex } = prepareBuildInput();
  const out = buildWorld(input);
  const landmarks = buildLandmarkDefs();
  for (const l of landmarks) {
    const pi = padIndex.get(l.id);
    l.y = pi !== undefined ? out.padHeights[pi] : 0;
  }
  const mosqueSites = [];
  for (let i = 0; i < out.mosqueSites.length; i += 6) {
    const s = out.mosqueSites;
    mosqueSites.push({ x: s[i], z: s[i + 1], y: s[i + 2], radius: s[i + 3], size: s[i + 4], headingDeg: s[i + 5] });
  }
  const geo = new GeoQueryImpl({
    out,
    landmarks,
    roads: buildRoadDefs(),
    districts: buildDistrictDefs(),
    coastlines: buildCoastlines(),
    mosqueSites,
  });
  for (const l of landmarks) {
    if (padIndex.get(l.id) === undefined) {
      l.y = Math.max(0, geo.heightAt(l.x, l.z));
    }
  }
  cached = geo;
  return geo;
}
