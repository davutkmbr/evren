/**
 * The water module's sea in Node (no browser, no GPU) for headless checks: the real region/current bake over the
 * headless geography, the real SeaState and the CPU wave evaluator behind the `water` service.
 *
 *   const sea = createHeadlessSea(geo);
 *   sea.setWind('lodos', 16);          // forced 10 m wind (like ?wu10=16) blowing from the lodos quarter
 *   sea.advance(time, dt, x, z);       // per frame: sea state at `time`, shading origin snapped near (x, z)
 *   sim.world.water = sea.waves;
 */
import * as THREE from 'three';
import type { GeoQuery } from '../../src/core/contracts';
import { bakeRegions, type RegionBakeResult } from '../../src/world/water/bake/region-bake';
import { ORIGIN_SNAP, REGION_GRID_SIZE } from '../../src/world/water/config';
import { SeaState } from '../../src/world/water/sea-state';
import { decodeRegionMaps, WaveQuery } from '../../src/world/water/wave-query';

export type SeaWind = 'poyraz' | 'lodos' | 'cross';

/** Compass direction the wind blows FROM (render/sky/wind.ts); 'cross' is square to both (half-way sea regime). */
const WIND_FROM_DEG: Record<SeaWind, number> = { poyraz: 32, lodos: 218, cross: 125 };

export interface HeadlessSea {
  sea: SeaState;
  waves: WaveQuery;
  bake: RegionBakeResult;
  wind: THREE.Vector3;
  originX: number;
  originZ: number;
  setWind(from: SeaWind, u10: number): void;
  advance(time: number, dt: number, x: number, z: number): void;
}

let cachedBake: RegionBakeResult | null = null;

/** Same sampling as the water system's sampleGeoGrids. */
function regionBake(geo: GeoQuery): RegionBakeResult {
  if (cachedBake) {
    return cachedBake;
  }
  const size = REGION_GRID_SIZE;
  const b = geo.bounds;
  const height = new Float32Array(size * size);
  const coast = new Float32Array(size * size);
  const cw = (b.maxX - b.minX) / size;
  const ch = (b.maxZ - b.minZ) / size;
  for (let y = 0; y < size; y++) {
    const z = b.minZ + (y + 0.5) * ch;
    for (let x = 0; x < size; x++) {
      const wx = b.minX + (x + 0.5) * cw;
      height[y * size + x] = geo.heightAt(wx, z);
      coast[y * size + x] = geo.coastDistance(wx, z);
    }
  }
  cachedBake = bakeRegions({ size, height, coast });
  return cachedBake;
}

export function createHeadlessSea(geo: GeoQuery): HeadlessSea {
  const bake = regionBake(geo);
  const sea = new SeaState();
  const waves = new WaveQuery();
  waves.setCoast((x, z) => geo.coastDistance(x, z));
  waves.setRegions(decodeRegionMaps(bake));
  const wind = new THREE.Vector3();
  const out: HeadlessSea = {
    sea,
    waves,
    bake,
    wind,
    originX: 0,
    originZ: 0,
    setWind(from, u10) {
      const to = THREE.MathUtils.degToRad(WIND_FROM_DEG[from] + 180);
      const speed100 = u10 / 0.78;
      wind.set(Math.sin(to) * speed100, 0, -Math.cos(to) * speed100);
      sea.forcedU10 = u10;
    },
    advance(time, dt, x, z) {
      out.originX = Math.round(x / ORIGIN_SNAP) * ORIGIN_SNAP;
      out.originZ = Math.round(z / ORIGIN_SNAP) * ORIGIN_SNAP;
      sea.update(wind, time, dt, out.originX, out.originZ);
      waves.sync(sea, out.originX, out.originZ, time);
    },
  };
  return out;
}
