import type { DecodedLand } from '../../city/osm/format';
import { stampOsmLand } from './osm-land';
import { WORLD_ORIGIN } from '../../../core/geo-coords';
import type { BuildInput, BuildOutput } from '../types';
import { buildDensityGrid, buildDistrictGrid, qiblaBearing, selectMosqueSites } from './areas';
import { COARSE_GRID, HEIGHT_GRID, LAND_SPLINE_GRID, spec } from './grid';
import type { GridSpec } from './grid';
import { applyShoreFlats, capUnderStructures, carveValleys, composeBaseHeights, flattenPads, raiseSummits } from './height';
import { buildLandUse, reserveDiscs } from './landuse';
import { NoiseFrame, NoiseTile } from './noise-tile';
import { fillRingsValue, pointInRing, stampDisc } from './raster';
import { signedCoastDistance } from './sdf';
import { applySpotHeights } from './spots';
import { evaluateOnGrid, fitThinPlateSpline } from './tps';
import { CoarseUpsampler, resampleGrid } from './upsample';

/**
 * The world build is split into stages so two workers can run them concurrently:
 *   worker A: coast (mask + SDF) → districts → land use + density
 *   worker B: relief splines → heights (needs A's coast) → mosque sites (needs A's land use)
 * `buildWorld` runs the same stages sequentially (main-thread fallback, benchmarks).
 */
export type Timings = Record<string, number>;

export function stopwatch(timings: Timings): (name: string) => void {
  let t = performance.now();
  return (name) => {
    const now = performance.now();
    timings[name] = Math.round((now - t) * 10) / 10;
    t = now;
  };
}

export interface NoiseSet {
  fine: NoiseFrame;
  medium: NoiseFrame;
}

let noiseSet: NoiseSet | null = null;

/** Shared deterministic noise frames (one 512² tile per worker). */
export function worldNoise(): NoiseSet {
  if (!noiseSet) {
    const tile = new NoiseTile(512, 6, 4, 90210);
    noiseSet = {
      fine: new NoiseFrame(tile, 5.5, 0.52, 17.3, 101.9),
      medium: new NoiseFrame(tile, 17, -0.31, 211.7, 37.1),
    };
  }
  return noiseSet;
}

export interface CoastStage {
  lakeDepth: Uint8Array;
  coast: Float32Array;
}

export function stageCoast(input: BuildInput, timings: Timings): CoastStage {
  const lap = stopwatch(timings);
  const g = HEIGHT_GRID;
  const total = g.size * g.size;
  const mask = new Uint8Array(total);
  fillRingsValue(input.landRings, g, mask, 1);
  const lakeDepth = new Uint8Array(total);
  for (const lake of input.lakeRings) {
    fillRingsValue([lake.ring], g, mask, 0);
    fillRingsValue([lake.ring], g, lakeDepth, Math.max(1, Math.min(255, Math.round(lake.depth))));
  }
  lap('mask');
  const coast = signedCoastDistance(mask, [...input.landRings, ...input.lakeRings.map((l) => l.ring)], g);
  lap('coastSdf');
  return { lakeDepth, coast };
}

export interface ReliefStage {
  landCoarse: Float32Array;
  depthCoarse: Float32Array;
  shelfCoarse: Float32Array;
}

/** Smoothing of the land relief spline (km² on the kernel diagonal): ~6 m RMS at the survey points. */
const LAND_SPLINE_SMOOTHING = 0.3;

/** Coarse cells whose Catmull-Rom footprint touches land (rings rasterized at 2× coarse resolution, dilated). */
function coarseLandMask(input: BuildInput, grid: GridSpec): Uint8Array {
  const m = grid.size;
  const fineSpec = spec(m * 2);
  const fine = new Uint8Array(m * m * 4);
  fillRingsValue(input.landRings, fineSpec, fine, 1);
  const out = new Uint8Array(m * m);
  for (let r = 0; r < m * 2; r++) {
    for (let c = 0; c < m * 2; c++) {
      if (!fine[r * m * 2 + c]) {
        continue;
      }
      const cr = r >> 1;
      const cc = c >> 1;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = cr + dr;
          const c2 = cc + dc;
          if (rr >= 0 && c2 >= 0 && rr < m && c2 < m) {
            out[rr * m + c2] = 1;
          }
        }
      }
    }
  }
  return out;
}

/**
 * Drops surveyed points that sit on the shoreline itself: their near-zero values would drag the regional
 * surface down along every coast; the shore ramp in composeBaseHeights models that final drop instead
 * (this is what keeps the Bosphorus slopes steep).
 */
function inlandElevationPoints(input: BuildInput, minCoastDistance: number): Float64Array {
  const pts = input.elevationPoints;
  const keep: number[] = [];
  const rings = [...input.landRings, ...input.lakeRings.map((l) => l.ring)];
  const min2 = minCoastDistance * minCoastDistance;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i];
    const z = pts[i + 1];
    let near = false;
    for (const r of rings) {
      const m = r.length >> 1;
      for (let a = 0; a < m && !near; a++) {
        const b = (a + 1) % m;
        const ax = r[a * 2];
        const az = r[a * 2 + 1];
        const dx = r[b * 2] - ax;
        const dz = r[b * 2 + 1] - az;
        const l2 = dx * dx + dz * dz;
        let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + dx * t - x;
        const ez = az + dz * t - z;
        near = ex * ex + ez * ez < min2;
      }
      if (near) {
        break;
      }
    }
    if (!near) {
      keep.push(x, z, pts[i + 2]);
    }
  }
  return new Float64Array(keep);
}

export function stageRelief(input: BuildInput, timings: Timings): ReliefStage {
  const lap = stopwatch(timings);
  const landSpline = fitThinPlateSpline(inlandElevationPoints(input, 350), LAND_SPLINE_SMOOTHING);
  const depthSpline = fitThinPlateSpline(input.bathymetryPoints, 0.2);
  lap('splineFit');
  // The spline is smooth at the survey spacing (~1 km), so 375 m sampling loses nothing; it is resampled to the
  // 188 m relief grid where the dense spot heights add the finer hills and valleys.
  const landCoarse = resampleGrid(evaluateOnGrid(landSpline, COARSE_GRID, coarseLandMask(input, COARSE_GRID)), COARSE_GRID, LAND_SPLINE_GRID);
  const depthCoarse = evaluateOnGrid(depthSpline, COARSE_GRID);
  const m = COARSE_GRID.size;
  const shelfCoarse = new Float32Array(m * m);
  for (let r = 0; r < m; r++) {
    const z = COARSE_GRID.origin + r * COARSE_GRID.cell;
    for (let c = 0; c < m; c++) {
      const x = COARSE_GRID.origin + c * COARSE_GRID.cell;
      const steep = input.steepChannels.some((ring) => pointInRing(ring, x, z));
      shelfCoarse[r * m + c] = steep ? 75 : 230;
    }
  }
  lap('splineEval');
  return { landCoarse, depthCoarse, shelfCoarse };
}

export interface LandUseStage {
  landUse: Uint8Array;
  density: Uint8Array;
  district: Uint8Array;
}

export function stageLandUse(input: BuildInput, coast: Float32Array, timings: Timings, osmLand?: DecodedLand | null): LandUseStage {
  const lap = stopwatch(timings);
  const district = buildDistrictGrid(input);
  lap('districts');
  const noise = worldNoise();
  lap('noiseTileA');
  const landUse = buildLandUse(input, coast, noise);
  lap('landUse');
  // Real parks and woods where the far OSM layer draws the buildings (osm-land.ts).
  if (osmLand) {
    stampOsmLand(landUse, osmLand, input.siteMask);
    lap('osmLand');
  }
  const density = buildDensityGrid(input, landUse, district, noise.medium);
  lap('density');
  return { landUse, density, district };
}

export interface HeightStage {
  height: Float32Array;
  padHeights: Float32Array;
}

export function stageHeight(input: BuildInput, coastStage: CoastStage, relief: ReliefStage, timings: Timings): HeightStage {
  const lap = stopwatch(timings);
  const g = HEIGHT_GRID;
  const noise = worldNoise();
  lap('noiseTileB');
  const beachness = new Uint8Array(g.size * g.size);
  for (const b of input.beaches) {
    const inner = b.radius * 0.65;
    stampDisc(b.x, b.z, b.radius, g, (k, d) => {
      const w = d <= inner ? 1 : 1 - (d - inner) / (b.radius - inner);
      beachness[k] = Math.max(beachness[k], Math.round(w * 255));
    });
  }
  const nearLake = new Uint8Array(g.size * g.size);
  for (const lake of input.lakeRings) {
    const ring = lake.ring;
    for (let i = 0; i < ring.length; i += 2) {
      stampDisc(ring[i], ring[i + 1], 800, g, (k, d) => {
        const w = Math.round(255 * Math.min(1, (800 - d) / 500));
        if (w > nearLake[k]) {
          nearLake[k] = w;
        }
      });
    }
  }
  const coverage = applySpotHeights(relief.landCoarse, LAND_SPLINE_GRID, input.spotHeights, coastStage.coast);
  lap('spotHeights');
  const height = composeBaseHeights(
    coastStage.coast,
    coastStage.lakeDepth,
    beachness,
    nearLake,
    {
      land: new CoarseUpsampler(relief.landCoarse, LAND_SPLINE_GRID, g),
      coverage: new CoarseUpsampler(coverage, LAND_SPLINE_GRID, g),
      depth: new CoarseUpsampler(relief.depthCoarse, COARSE_GRID, g),
      shelf: new CoarseUpsampler(relief.shelfCoarse, COARSE_GRID, g),
    },
    noise,
  );
  lap('heightBase');
  carveValleys(height, coastStage.coast, input.rivers, noise);
  lap('valleys');
  applyShoreFlats(height, coastStage.coast, input.flats);
  lap('shoreFlats');
  raiseSummits(height, coastStage.coast, input.summits, noise);
  const padHeights = flattenPads(height, coastStage.coast, input.pads);
  lap('summitsPads');
  // Bridges (landmarks/structure-volumes.ts): no ground above a deck, pier or anchorage.
  capUnderStructures(height, input.structureCaps, input.structureStride);
  lap('structureCaps');
  return { height, padHeights };
}

/** Picks neighborhood mosque sites, flattens their pads and reserves them. Mutates height and landUse. */
export function stageSites(input: BuildInput, height: Float32Array, coast: Float32Array, lu: Pick<LandUseStage, 'landUse' | 'density'>, timings: Timings): Float32Array {
  const lap = stopwatch(timings);
  const sites = selectMosqueSites(input, height, lu.landUse, lu.density, qiblaBearing(WORLD_ORIGIN.lat, WORLD_ORIGIN.lon));
  const siteHeights = flattenPads(
    height,
    coast,
    sites.map((s) => ({ x: s.x, z: s.z, radius: s.radius * 0.8, blend: 22, strength: 0.85 })),
  );
  reserveDiscs(lu.landUse, sites);
  const out = new Float32Array(sites.length * 6);
  sites.forEach((s, i) => {
    out.set([s.x, s.z, siteHeights[i], s.radius, s.size, s.headingDeg], i * 6);
  });
  lap('mosqueSites');
  return out;
}

/** Builds every geo grid sequentially. Pure and deterministic. `osmLand`: the far city bake's land use (osm-land.ts). */
export function buildWorld(input: BuildInput, osmLand?: DecodedLand | null): BuildOutput {
  const timings: Timings = {};
  const coastStage = stageCoast(input, timings);
  const relief = stageRelief(input, timings);
  const lu = stageLandUse(input, coastStage.coast, timings, osmLand);
  const { height, padHeights } = stageHeight(input, coastStage, relief, timings);
  const mosqueSites = stageSites(input, height, coastStage.coast, lu, timings);
  return { height, coast: coastStage.coast, landUse: lu.landUse, density: lu.density, district: lu.district, padHeights, mosqueSites, timings };
}
