import type { DecodedLand } from '../city/osm/format';
import type { BuildOutput } from './types';

export type GeoWorkerRequest =
  | { type: 'full'; land: DecodedLand | null }
  | { type: 'coast' }
  | { type: 'relief' }
  | { type: 'landuse'; land: DecodedLand | null }
  | { type: 'height'; coast: Float32Array; lakeDepth: Uint8Array }
  | { type: 'finish'; landUse: Uint8Array; density: Uint8Array; district: Uint8Array; timings: Record<string, number> };

export type GeoWorkerResponse =
  | { type: 'full'; out: BuildOutput }
  | { type: 'coast'; coast: Float32Array; lakeDepth: Uint8Array }
  | { type: 'relief' }
  | { type: 'landuse'; landUse: Uint8Array; density: Uint8Array; district: Uint8Array; timings: Record<string, number> };
