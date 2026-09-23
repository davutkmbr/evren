/**
 * Geography of Istanbul: coastline, relief, land use, districts, landmarks, roads and mosque sites.
 * Grids are generated at init in a module worker (fallback: main thread) and served as O(1) lookups.
 */
import type { System } from '../../core/contracts';
import { UpdateOrder } from '../../core/contracts';
import { buildGeography } from './build-client';
import { buildCoastlines, buildDistrictDefs, buildLandmarkDefs, buildRoadDefs, prepareBuildInput } from './prepare';
import { GeoQueryImpl } from './query';

export { GeoQueryImpl } from './query';

/** Creates the geo system; provides the 'geo' service (GeoQuery) during init. */
export function createGeoSystem(): System {
  let geo: GeoQueryImpl | null = null;
  // Kick the worker build off immediately: it overlaps with the systems initialised before geo.
  const build = buildGeography();
  return {
    name: 'geo',
    order: UpdateOrder.World,
    async init(ctx) {
      const t0 = performance.now();
      const out = await build;
      const { padIndex } = prepareBuildInput();
      const landmarks = buildLandmarkDefs();
      for (const l of landmarks) {
        const pi = padIndex.get(l.id);
        l.y = pi !== undefined ? out.padHeights[pi] : 0;
      }
      const sites = out.mosqueSites;
      const mosqueSites = [];
      for (let i = 0; i < sites.length; i += 6) {
        mosqueSites.push({ x: sites[i], z: sites[i + 1], y: sites[i + 2], radius: sites[i + 3], size: sites[i + 4], headingDeg: sites[i + 5] });
      }
      geo = new GeoQueryImpl({
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
      ctx.services.provide('geo', geo);
      const ms = Math.round(performance.now() - t0);
      console.info(`[geo] ready (init wait ${ms} ms, build wall ${out.timings.wall} ms) ${JSON.stringify(out.timings)}`);
    },
    dispose() {
      geo?.dispose();
      geo = null;
    },
  };
}
