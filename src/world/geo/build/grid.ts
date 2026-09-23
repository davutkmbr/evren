import { WORLD_HALF_SIZE } from '../../../core/geo-coords';

/** Grid layouts shared by the builder (worker) and the query side. All grids cover the full world square. */
export interface GridSpec {
  size: number;
  cell: number;
  /** World coordinate of the center of cell 0 (same for x and z). */
  origin: number;
}

export function spec(size: number): GridSpec {
  const cell = (WORLD_HALF_SIZE * 2) / size;
  return { size, cell, origin: -WORLD_HALF_SIZE + cell / 2 };
}

/** Heights and signed coast distance: 2048² (~23.4 m cells). */
export const HEIGHT_GRID = spec(2048);
/** Land use: 4096² (~11.7 m cells) so road corridors and pads stay crisp. */
export const LANDUSE_GRID = spec(4096);
/** Building density: 1024² (~46.9 m cells), bilinear. */
export const DENSITY_GRID = spec(1024);
/** District index: 512² (~94 m cells), nearest. */
export const DISTRICT_GRID = spec(512);
/** Coarse sea-floor fields (depth spline, shelf length): 128² (375 m cells), Catmull-Rom upsampled. */
export const COARSE_GRID = spec(128);
/** Land relief spline evaluation: 256² (188 m cells) so ridges and knolls ~400 m across survive. */
export const LAND_SPLINE_GRID = spec(256);

export const NO_DISTRICT = 255;

/** Bilinear sample of a float grid at world x/z (clamped to the edges). */
export function sampleBilinear(data: Float32Array, g: GridSpec, x: number, z: number): number {
  const n = g.size;
  let fx = (x - g.origin) / g.cell;
  let fz = (z - g.origin) / g.cell;
  if (fx < 0) {
    fx = 0;
  } else if (fx > n - 1.0001) {
    fx = n - 1.0001;
  }
  if (fz < 0) {
    fz = 0;
  } else if (fz > n - 1.0001) {
    fz = n - 1.0001;
  }
  const ix = fx | 0;
  const iz = fz | 0;
  const tx = fx - ix;
  const tz = fz - iz;
  const i = iz * n + ix;
  const a = data[i];
  const b = data[i + 1];
  const c = data[i + n];
  const d = data[i + n + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

/** Nearest-cell index for world x/z, or -1 outside the grid. */
export function cellIndex(g: GridSpec, x: number, z: number): number {
  const ix = Math.floor((x - g.origin) / g.cell + 0.5);
  const iz = Math.floor((z - g.origin) / g.cell + 0.5);
  if (ix < 0 || iz < 0 || ix >= g.size || iz >= g.size) {
    return -1;
  }
  return iz * g.size + ix;
}
