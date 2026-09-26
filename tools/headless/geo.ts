/**
 * Builds the real GeoQuery in Node (no browser, no GPU) with the same steps as the geo system's init, for headless
 * checks and tests: `import { buildHeadlessGeo } from '../headless/geo'` and run the script with `npx tsx`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeLand, type DecodedLand, OSM_LAND_URL } from '../../src/world/city/osm/format';
import { buildWorld } from '../../src/world/geo/build/build-world';
import { ROOT } from '../world-compiler/lib/areas.mjs';
import { buildCoastlines, buildDistrictDefs, buildLandmarkDefs, buildRoadDefs, prepareBuildInput } from '../../src/world/geo/prepare';
import { GeoQueryImpl } from '../../src/world/geo/query';

let cached: GeoQueryImpl | null = null;

/** The far city bake's land use from public/ (the browser fetches the same file, geo/build-client.ts); null when missing. */
export function readOsmLand(): DecodedLand | null {
  const file = resolve(ROOT, 'public', OSM_LAND_URL);
  return existsSync(file) ? decodeLand(new Uint8Array(gunzipSync(readFileSync(file)))) : null;
}

/** Builds (once per process) and returns the world geography, as the game builds it; takes a few seconds. */
export function buildHeadlessGeo(): GeoQueryImpl {
  return (cached ??= buildGeoWith(readOsmLand()));
}

/**
 * Builds a fresh geography with the given OSM land use (null: the hand-drawn land use only) and, when given, another
 * coverage mask than the committed one (the far city bake computes its own, scripts/data/osm-city-bake.ts).
 */
export function buildGeoWith(osmLand: DecodedLand | null, siteMask?: Uint8Array): GeoQueryImpl {
  const { input, padIndex } = prepareBuildInput();
  if (siteMask) {
    input.siteMask = siteMask;
  }
  const out = buildWorld(input, osmLand);
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
  return geo;
}
