/**
 * The far OSM layer's coverage mask (mask.json, written by scripts/data/osm-city-bake.ts): which 250 m cells draw
 * the baked OSM buildings (1) and which keep the procedural city (0). Imported statically so the geo build, the city
 * workers and the checks read the same cells.
 */
import { BAKE_HALF, type CoverageMaskFile, decodeMask, MASK_CELL, MASK_SIZE } from './format';
import file from './mask.json';

let cached: Uint8Array | null = null;
let cachedBuilt: Uint8Array | null = null;

/** MASK_SIZE x MASK_SIZE cells, row-major (z rows); 1 = OSM. */
export function osmCoverageMask(): Uint8Array {
  return (cached ??= decodeMask(file as CoverageMaskFile));
}

/** Cells holding at least one baked building (same layout). */
export function osmBuiltMask(): Uint8Array {
  const f = file as CoverageMaskFile;
  return (cachedBuilt ??= f.built ? decodeMask({ bits: f.built, size: f.size }) : new Uint8Array(MASK_SIZE * MASK_SIZE));
}

/** Mask cell index of a world point, -1 outside the square. */
export function maskCellOf(x: number, z: number): number {
  const i = Math.floor((x + BAKE_HALF) / MASK_CELL);
  const j = Math.floor((z + BAKE_HALF) / MASK_CELL);
  return i < 0 || j < 0 || i >= MASK_SIZE || j >= MASK_SIZE ? -1 : j * MASK_SIZE + i;
}

/** True when OSM draws the buildings at (x, z). */
export function isOsmCell(x: number, z: number): boolean {
  const k = maskCellOf(x, z);
  return k >= 0 && osmCoverageMask()[k] === 1;
}
