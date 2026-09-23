/**
 * Geo build worker. Two instances run the pipeline concurrently (see build/build-world.ts):
 *   A: 'coast' → 'landuse' (districts, land use, density)     B: 'relief' → 'height' → 'finish'
 * or one instance runs everything with 'full'.
 */
import { buildWorld, stageCoast, stageHeight, stageLandUse, stageRelief, stageSites } from './build/build-world';
import type { CoastStage, HeightStage, ReliefStage, Timings } from './build/build-world';
import { prepareBuildInput } from './prepare';
import type { BuildInput } from './types';
import type { GeoWorkerRequest, GeoWorkerResponse } from './worker-protocol';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<GeoWorkerRequest>) => void) | null;
  postMessage: (msg: GeoWorkerResponse, transfer: Transferable[]) => void;
};

let input: BuildInput | null = null;
let coastStage: CoastStage | null = null;
let relief: ReliefStage | null = null;
let heights: HeightStage | null = null;
const timings: Timings = {};

function getInput(): BuildInput {
  if (!input) {
    const t0 = performance.now();
    input = prepareBuildInput().input;
    timings.prepare = Math.round(performance.now() - t0);
  }
  return input;
}

scope.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'full': {
      const out = buildWorld(getInput());
      scope.postMessage({ type: 'full', out }, [out.height.buffer, out.coast.buffer, out.landUse.buffer, out.density.buffer, out.district.buffer, out.padHeights.buffer, out.mosqueSites.buffer]);
      break;
    }
    case 'coast': {
      coastStage = stageCoast(getInput(), timings);
      const coast = coastStage.coast.slice();
      const lakeDepth = coastStage.lakeDepth.slice();
      scope.postMessage({ type: 'coast', coast, lakeDepth }, [coast.buffer, lakeDepth.buffer]);
      break;
    }
    case 'relief': {
      relief = stageRelief(getInput(), timings);
      scope.postMessage({ type: 'relief' }, []);
      break;
    }
    case 'landuse': {
      const lu = stageLandUse(getInput(), coastStage!.coast, timings);
      scope.postMessage({ type: 'landuse', landUse: lu.landUse, density: lu.density, district: lu.district, timings }, [
        lu.landUse.buffer,
        lu.density.buffer,
        lu.district.buffer,
      ]);
      break;
    }
    case 'height': {
      coastStage = { coast: msg.coast, lakeDepth: msg.lakeDepth };
      heights = stageHeight(getInput(), coastStage, relief!, timings);
      break;
    }
    case 'finish': {
      const lu = { landUse: msg.landUse, density: msg.density };
      const mosqueSites = stageSites(getInput(), heights!.height, coastStage!.coast, lu, timings);
      const out = {
        height: heights!.height,
        coast: coastStage!.coast,
        landUse: lu.landUse,
        density: lu.density,
        district: msg.district,
        padHeights: heights!.padHeights,
        mosqueSites,
        timings: { ...msg.timings, ...timings },
      };
      scope.postMessage({ type: 'full', out }, [out.height.buffer, out.coast.buffer, out.landUse.buffer, out.density.buffer, out.district.buffer, out.padHeights.buffer, out.mosqueSites.buffer]);
      input = null;
      coastStage = null;
      relief = null;
      heights = null;
      break;
    }
  }
};
