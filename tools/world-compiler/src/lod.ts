/**
 * LOD policy of format 1 (written to index.lod). A tile shows LOD0 (full street detail) while the camera is within
 * LOD0_MAX metres of its square, LOD1 (façade detail collapsed to the block) up to LOD1_MAX, and nothing beyond (the
 * flight world takes over). Runtimes add HYSTERESIS metres before leaving a band. Greybox tiles point both LODs at
 * one glb.
 */
import type { LodPolicy } from './format';
import { LOD0, LOD1 } from './mesh';

export const LOD0_MAX = 120;
export const LOD1_MAX = 600;
export const HYSTERESIS = 10;

export const LOD_POLICY: LodPolicy = {
  bands: [
    { level: 0, min: 0, max: LOD0_MAX },
    { level: 1, min: LOD0_MAX, max: LOD1_MAX },
  ],
  hysteresis: HYSTERESIS,
};

/** LOD levels written per tile, with their mesh masks and lightmap atlas sizes (full-detail / greybox tiles). */
export const LOD_LEVELS: { level: number; mask: number; lightmap: { full: number; greybox: number } }[] = [
  { level: 0, mask: LOD0, lightmap: { full: 2048, greybox: 1024 } },
  { level: 1, mask: LOD1, lightmap: { full: 1024, greybox: 1024 } },
];
