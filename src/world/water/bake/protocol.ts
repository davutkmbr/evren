import type { BandBakeResult } from './spectrum-bake';
import type { FoamBakeResult } from './foam-bake';
import type { RegionBakeInput, RegionBakeResult } from './region-bake';

export type WaterJobRequest =
  | { id: number; kind: 'spectrum' }
  | { id: number; kind: 'regions'; input: RegionBakeInput };

export interface SpectrumJobResult {
  bands: BandBakeResult;
  foam: FoamBakeResult;
  ms: number;
}

export type WaterJobResponse =
  | { id: number; ok: true; kind: 'spectrum'; result: SpectrumJobResult }
  | { id: number; ok: true; kind: 'regions'; result: RegionBakeResult }
  | { id: number; ok: false; error: string };
