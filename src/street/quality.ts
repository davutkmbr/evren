/**
 * Preview quality levels of the street sandbox (`?q=low|medium|high`, key Q cycles them live). Everything but
 * `antialias` (a WebGL context flag) switches without a reload.
 */
export type Quality = 'low' | 'medium' | 'high';

export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

export interface QualityPreset {
  /** Multiplies the device pixel ratio (capped by `?dpr`). */
  renderScale: number;
  antialias: boolean;
  /** Sun shadow map size in texels; 0 = no shadows. */
  shadowMap: number;
  /** Half extent (m) of the sun's shadow box, which sits just ahead of the camera. */
  shadowHalf: number;
  /** Tiles within this distance of the camera are loaded (m). */
  radius: number;
  /** Multiplies every prop's `drawDistance`. */
  propDistanceScale: number;
  /** Placeholder people are culled beyond this distance (m). */
  personDistance: number;
  /** Props under ~1.6 m (bollards, chairs, AC units, animals, bowls) are culled beyond this distance (m). */
  smallPropDistance: number;
  /** Multiplies the prop LOD switch distances (props[id].lods[].distance); < 1 switches to coarser levels sooner. */
  lodBias: number;
  /** Real point and spot lights given to the nearest lit manifest lights (dusk and night); the rest only glow. */
  pointLights: number;
  spotLights: number;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: { renderScale: 0.6, antialias: false, shadowMap: 1024, shadowHalf: 30, radius: 200, propDistanceScale: 0.6, personDistance: 70, smallPropDistance: 35, lodBias: 0.5, pointLights: 2, spotLights: 2 },
  medium: { renderScale: 0.8, antialias: true, shadowMap: 1024, shadowHalf: 40, radius: 300, propDistanceScale: 0.85, personDistance: 100, smallPropDistance: 50, lodBias: 0.75, pointLights: 4, spotLights: 4 },
  high: { renderScale: 1, antialias: true, shadowMap: 2048, shadowHalf: 60, radius: 400, propDistanceScale: 1, personDistance: 120, smallPropDistance: 60, lodBias: 1, pointLights: 8, spotLights: 8 },
};

export function parseQuality(v: string | null): Quality {
  return v === 'low' || v === 'high' ? v : 'medium';
}

export function nextQuality(q: Quality): Quality {
  return QUALITIES[(QUALITIES.indexOf(q) + 1) % QUALITIES.length];
}
