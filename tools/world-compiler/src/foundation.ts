/**
 * Compiler foundation: the flight world's terrain (the geo build, run in Node) cut to the area, the shoreline from
 * the OSM coastline (coast.ts), the shared street raster (src/world/osm/shared/street-field.ts) and the StreetSurface
 * query over them. Same code the ?osm=1 slice uses at runtime, so the tiles sit on the flight world's terrain.
 *
 * Street-layer changes to the geo windows (they only feed the compiler):
 * - coast: signed distance to the OSM coastline on a 2 m grid (exact within 24 m of the shore, interpolated from an
 *   8 m grid further away) instead of the 23 m geo grid, which misses the reclaimed quays by up to ~90 m;
 * - height: resampled to the 5 m ground grid and held at least at QUAY_TOP on OSM land, so reclaimed ground that the
 *   geo build still treats as sea floor becomes a level quay.
 */
import type { WorldBounds } from '../../../src/core/contracts';
import { buildWorld } from '../../../src/world/geo/build/build-world';
import { type GridSpec, HEIGHT_GRID, LANDUSE_GRID, sampleBilinear } from '../../../src/world/geo/build/grid';
import { prepareBuildInput } from '../../../src/world/geo/prepare';
import type { OsmData } from '../../../src/world/osm/data';
import { FootprintIndex } from '../../../src/world/osm/shared/footprints';
import { GROUND_STEP } from '../../../src/world/osm/shared/ground';
import type { GridWin, OsmWorkerBase } from '../../../src/world/osm/shared/protocol';
import { buildStreetRaster, streetRasterInput } from '../../../src/world/osm/shared/street-field';
import { QUAY_TOP, StreetSurface } from '../../../src/world/osm/shared/street-surface';
import { CoastField } from './coast';

/** Geo grid margin (m) kept around the rect for bilinear lookups. */
const WINDOW_MARGIN = 40;
const COAST_CELL = 2;
const COAST_COARSE = 8;
const COAST_EXACT = 24;

export interface Foundation {
  /** Tile-aligned build rect (all tiles). */
  rect: WorldBounds;
  base: OsmWorkerBase;
  surface: StreetSurface;
  footprints: FootprintIndex;
  /** Shoreline source: 'osm' (coastline ways) or 'geo' (no coastline in the data). */
  coastSource: 'osm' | 'geo';
  ms: { geo: number; coast: number; raster: number };
}

function cut<T extends Float32Array | Uint8Array>(data: T, g: GridSpec, rect: WorldBounds): GridWin<T> {
  const c0 = Math.max(0, Math.floor((rect.minX - WINDOW_MARGIN - g.origin) / g.cell));
  const c1 = Math.min(g.size - 1, Math.ceil((rect.maxX + WINDOW_MARGIN - g.origin) / g.cell));
  const r0 = Math.max(0, Math.floor((rect.minZ - WINDOW_MARGIN - g.origin) / g.cell));
  const r1 = Math.min(g.size - 1, Math.ceil((rect.maxZ + WINDOW_MARGIN - g.origin) / g.cell));
  const w = c1 - c0 + 1;
  const h = r1 - r0 + 1;
  const Ctor = data.constructor as { new (n: number): T };
  const out = new Ctor(w * h);
  for (let r = 0; r < h; r++) {
    const src = (r0 + r) * g.size + c0;
    out.set(data.subarray(src, src + w) as never, r * w);
  }
  return { data: out, w, h, x0: g.origin + c0 * g.cell, z0: g.origin + r0 * g.cell, cell: g.cell };
}

/** Samples `fn` on a regular grid covering `rect` plus WINDOW_MARGIN, first cell centred on rect.min - margin. */
function sampleGrid(rect: WorldBounds, cell: number, fn: (x: number, z: number) => number): GridWin<Float32Array> {
  const x0 = rect.minX - WINDOW_MARGIN;
  const z0 = rect.minZ - WINDOW_MARGIN;
  const w = Math.ceil((rect.maxX + WINDOW_MARGIN - x0) / cell) + 1;
  const h = Math.ceil((rect.maxZ + WINDOW_MARGIN - z0) / cell) + 1;
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      data[j * w + i] = fn(x0 + i * cell, z0 + j * cell);
    }
  }
  return { data, w, h, x0, z0, cell };
}

function bilinear(g: GridWin<Float32Array>, x: number, z: number): number {
  const fx = Math.min(g.w - 1.0001, Math.max(0, (x - g.x0) / g.cell));
  const fz = Math.min(g.h - 1.0001, Math.max(0, (z - g.z0) / g.cell));
  const i = fx | 0;
  const j = fz | 0;
  const tx = fx - i;
  const tz = fz - j;
  const d = g.data;
  const k = j * g.w + i;
  const top = d[k] + (d[k + 1] - d[k]) * tx;
  const bottom = d[k + g.w] + (d[k + g.w + 1] - d[k + g.w]) * tx;
  return top + (bottom - top) * tz;
}

/**
 * `rect`: the tile-aligned area of all tiles. The street raster covers it plus `margin` so distance fields near the
 * outer tile edges still see streets beyond them (street-profile data is fetched ~155 m wider than the area).
 */
export function buildFoundation(data: OsmData, rect: WorldBounds, margin = 40): Foundation {
  const t0 = performance.now();
  const world = buildWorld(prepareBuildInput().input);
  const outer = { minX: rect.minX - margin, maxX: rect.maxX + margin, minZ: rect.minZ - margin, maxZ: rect.maxZ + margin };
  const landUse = cut(world.landUse, LANDUSE_GRID, outer);
  const t1 = performance.now();
  const shore = new CoastField(data);
  let coast: GridWin<Float32Array>;
  const coastSource = shore.segments ? 'osm' : 'geo';
  if (shore.segments) {
    const coarse = sampleGrid(outer, COAST_COARSE, (x, z) => shore.at(x, z));
    coast = sampleGrid(outer, COAST_CELL, (x, z) => {
      const c = bilinear(coarse, x, z);
      return Math.abs(c) < COAST_EXACT ? shore.at(x, z) : c;
    });
  } else {
    coast = cut(world.coast, HEIGHT_GRID, outer);
  }
  const height = sampleGrid(outer, GROUND_STEP, (x, z) => {
    const h = sampleBilinear(world.height, HEIGHT_GRID, x, z);
    return bilinear(coast, x, z) > 0 ? Math.max(h, QUAY_TOP) : h;
  });
  const t2 = performance.now();
  const street = buildStreetRaster(streetRasterInput(data), outer);
  const t3 = performance.now();
  // No landmark pads: the street layer draws every OSM building itself (hero buildings included).
  const base: OsmWorkerBase = { rect: outer, area: rect, height, coast, landUse, reserved: [], street };
  return {
    rect,
    base,
    surface: new StreetSurface(base),
    footprints: new FootprintIndex(data.buildings),
    coastSource,
    ms: { geo: Math.round(t1 - t0), coast: Math.round(t2 - t1), raster: Math.round(t3 - t2) },
  };
}
