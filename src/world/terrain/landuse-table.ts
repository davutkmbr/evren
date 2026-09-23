import * as THREE from 'three';
import { LandUse } from '../../core/contracts';

/**
 * Per land-use surface descriptor, blended bilinearly across land-use cells in the shader (smooth, organic zone edges):
 *   d0 = (built fabric, paved ground, tree canopy, grass)
 *   d1 = (sand, farmland, bare/rocky ground, quay/shore stone)
 *   d2 = (airport, cemetery, night-light density, irrigation: 1 = watered green, 0 = dry summer grass)
 */
type Descriptor = [number, number, number, number, number, number, number, number, number, number, number, number];

const TABLE: Partial<Record<LandUse, Descriptor>> = {
  [LandUse.Water]: [0, 0.45, 0, 0, 0, 0, 0.25, 1, 0, 0, 0.25, 0],
  [LandUse.Beach]: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0.15, 0],
  [LandUse.Urban]: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0.6],
  [LandUse.HistoricUrban]: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.1, 0.6],
  [LandUse.Highrise]: [1, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 1.3, 0.8],
  [LandUse.Industrial]: [1, 0, 0, 0, 0, 0, 0.1, 0, 0, 0, 0.8, 0.2],
  [LandUse.Park]: [0, 0.08, 0.4, 0.55, 0, 0, 0, 0, 0, 0, 0.25, 1],
  [LandUse.Forest]: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.3],
  [LandUse.Farmland]: [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.02, 0],
  [LandUse.Airport]: [0, 0, 0, 0.35, 0, 0, 0, 0, 1, 0, 0.6, 0],
  [LandUse.Cemetery]: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0.05, 0.3],
  [LandUse.Landmark]: [0, 0.7, 0.15, 0.25, 0, 0, 0, 0, 0, 0, 0.7, 1],
  [LandUse.Road]: [0.35, 0.65, 0, 0, 0, 0, 0, 0, 0, 0, 1.1, 0.4],
  [LandUse.Suburban]: [0.55, 0, 0.25, 0.3, 0, 0, 0, 0, 0, 0, 0.5, 0.5],
};

/** 16 classes × 3 vec4 for the uLandUseTable uniform. */
export function buildLandUseTable(out: THREE.Vector4[]): void {
  for (let c = 0; c < 16; c++) {
    const d = TABLE[c as LandUse] ?? TABLE[LandUse.Urban]!;
    out[c * 3].set(d[0], d[1], d[2], d[3]);
    out[c * 3 + 1].set(d[4], d[5], d[6], d[7]);
    out[c * 3 + 2].set(d[8], d[9], d[10], d[11]);
  }
}
