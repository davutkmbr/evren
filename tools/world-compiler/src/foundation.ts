/**
 * Compiler foundation: the flight world's terrain (the geo build, run in Node) cut to the area, the shoreline from
 * the OSM coastline (coast.ts), the shared street raster (src/world/osm/shared/street-field.ts) and the StreetSurface
 * query over them. Same code the OSM slice uses at runtime, so the tiles sit on the flight world's terrain.
 *
 * Heights are the runtime slice's, input for input: the geo height window and the geo coast (`groundCoast`, which
 * the quay raise follows) are cut from the same grids the flight game cuts them from (src/world/osm/shared/
 * foundation.ts cutGeoWindows), over a rect on the global ground lattice (ground.ts groundRect), so a compiled tile's
 * ground and the runtime OSM ground are the same surface wherever both exist (bridge decks landing on the streets,
 * anything placed on StreetSurface.heightAt at runtime). Reclaimed quays the geo terrain still treats as sea floor are
 * levelled by the quay raise (it holds QUAY_TOP wherever the geo coast is below QUAY_FLAT, sea included).
 *
 * The street layer's own change: `coast` (land and water only: the quay walls, the land field, zones) is the signed
 * distance to the OSM coastline on a 2 m grid (exact within 24 m of the shore, interpolated from an 8 m grid further
 * away) instead of the 23 m geo grid, which misses the reclaimed quays by up to ~90 m.
 */
import type { WorldBounds } from '../../../src/core/contracts';
import { buildWorld } from '../../../src/world/geo/build/build-world';
import { type GridSpec, HEIGHT_GRID, LANDUSE_GRID } from '../../../src/world/geo/build/grid';
import { prepareBuildInput } from '../../../src/world/geo/prepare';
import type { OsmData } from '../../../src/world/osm/data';
import { FootprintIndex } from '../../../src/world/osm/shared/footprints';
import { groundRect } from '../../../src/world/osm/shared/ground';
import type { GridWin, OsmWorkerBase } from '../../../src/world/osm/shared/protocol';
import { buildStreetRaster, streetRasterInput } from '../../../src/world/osm/shared/street-field';
import { StreetSurface } from '../../../src/world/osm/shared/street-surface';
import { CoastField } from './coast';

/** Geo grid margin (m) kept around the rect for bilinear lookups. */
const WINDOW_MARGIN = 40;
const COAST_CELL = 2;
const COAST_COARSE = 8;
const COAST_EXACT = 24;

/** The part of a Foundation that is plain data (worker threads get it from the main thread instead of rebuilding it). */
export interface SharedFoundation {
  base: OsmWorkerBase;
  coastSource: 'osm' | 'geo';
}

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
/** Window of a coast grid (sampleGrid's layout). */
export interface CoastSpec {
  x0: number;
  z0: number;
  w: number;
  h: number;
  cell: number;
}

const coastSpec = (rect: WorldBounds, cell: number): CoastSpec => {
  const x0 = rect.minX - WINDOW_MARGIN;
  const z0 = rect.minZ - WINDOW_MARGIN;
  return { x0, z0, w: Math.ceil((rect.maxX + WINDOW_MARGIN - x0) / cell) + 1, h: Math.ceil((rect.maxZ + WINDOW_MARGIN - z0) / cell) + 1, cell };
};

/** The OSM coast grids a foundation needs (coarse, then fine), or null when the data has no coastline. */
export function coastPlan(data: OsmData, rect: WorldBounds, margin = 40): { coarse: CoastSpec; fine: CoastSpec } | null {
  if (!new CoastField(data).segments) {
    return null;
  }
  const outer = groundRect({ minX: rect.minX - margin, maxX: rect.maxX + margin, minZ: rect.minZ - margin, maxZ: rect.maxZ + margin });
  return { coarse: coastSpec(outer, COAST_COARSE), fine: coastSpec(outer, COAST_CELL) };
}

/**
 * Rows [j0, j1) of a coast grid: the exact signed distance on the coarse grid (`coarse` null), or on the fine grid
 * the exact one within COAST_EXACT of the shore and the coarse grid's bilinear value elsewhere. Worker threads
 * compute row ranges of the main thread's grids with it (the same values as one thread computing them all).
 */
export function coastRows(shore: CoastField, spec: CoastSpec, coarse: GridWin<Float32Array> | null, j0: number, j1: number): Float32Array {
  const out = new Float32Array((j1 - j0) * spec.w);
  for (let j = j0; j < j1; j++) {
    for (let i = 0; i < spec.w; i++) {
      const x = spec.x0 + i * spec.cell;
      const z = spec.z0 + j * spec.cell;
      let v: number;
      if (!coarse) {
        v = shore.at(x, z);
      } else {
        const c = bilinear(coarse, x, z);
        v = Math.abs(c) < COAST_EXACT ? shore.at(x, z) : c;
      }
      out[(j - j0) * spec.w + i] = v;
    }
  }
  return out;
}

/** Grids from coastRows (all rows). */
export const coastGrid = (spec: CoastSpec, data: Float32Array): GridWin<Float32Array> => ({ data, ...spec });

export function buildFoundation(data: OsmData, rect: WorldBounds, margin = 40, shared?: SharedFoundation, coastGrids?: GridWin<Float32Array> | null): Foundation {
  if (shared) {
    // Worker threads (--jobs): the main thread's terrain windows, coast and street raster (parallel/share.ts).
    return { rect, base: shared.base, surface: new StreetSurface(shared.base), footprints: new FootprintIndex(data.buildings), coastSource: shared.coastSource, ms: { geo: 0, coast: 0, raster: 0 } };
  }
  const t0 = performance.now();
  const world = buildWorld(prepareBuildInput().input);
  const outer = groundRect({ minX: rect.minX - margin, maxX: rect.maxX + margin, minZ: rect.minZ - margin, maxZ: rect.maxZ + margin });
  const landUse = cut(world.landUse, LANDUSE_GRID, outer);
  const t1 = performance.now();
  const shore = new CoastField(data);
  let coast: GridWin<Float32Array>;
  const coastSource = shore.segments ? 'osm' : 'geo';
  if (shore.segments && coastGrids) {
    // Sampled by the worker threads (coastPlan, coastRows).
    coast = coastGrids;
  } else if (shore.segments) {
    const coarse = sampleGrid(outer, COAST_COARSE, (x, z) => shore.at(x, z));
    coast = sampleGrid(outer, COAST_CELL, (x, z) => {
      const c = bilinear(coarse, x, z);
      return Math.abs(c) < COAST_EXACT ? shore.at(x, z) : c;
    });
  } else {
    coast = cut(world.coast, HEIGHT_GRID, outer);
  }
  const height = cut(world.height, HEIGHT_GRID, outer);
  const groundCoast = cut(world.coast, HEIGHT_GRID, outer);
  const t2 = performance.now();
  const street = buildStreetRaster(streetRasterInput(data, (x, z) => bilinear(coast, x, z)), outer);
  const t3 = performance.now();
  // No reserved pads: the street layer draws its own ground everywhere. Buildings on the game's landmark claims are
  // flagged as landmarks instead (district.ts landmarkOf, `--landmarks none`).
  const base: OsmWorkerBase = { rect: outer, area: rect, height, coast, groundCoast, landUse, reserved: [], street };
  return {
    rect,
    base,
    surface: new StreetSurface(base),
    footprints: new FootprintIndex(data.buildings),
    coastSource,
    ms: { geo: Math.round(t1 - t0), coast: Math.round(t2 - t1), raster: Math.round(t3 - t2) },
  };
}
