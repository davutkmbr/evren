/**
 * Quality presets. Every module reads its knobs from `ctx.quality.settings` and must react to
 * `ctx.quality.onChange` (rebuild/re-stream) without a page reload.
 */
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  preset: QualityPreset;
  /** Max device pixel ratio used by the renderer. */
  maxPixelRatio: number;
  /** Dynamic resolution bounds (fraction of native). */
  minRenderScale: number;
  maxRenderScale: number;
  /** Frame-time target for dynamic resolution (ms). */
  targetFrameMs: number;
  shadowMapSize: number;
  /** Max shadow distance (m). */
  shadowDistance: number;
  /** Terrain: multiplier on LOD distances (higher = more detail farther). */
  terrainLodScale: number;
  /** City: radius (m) in which individual buildings are drawn. */
  cityDrawDistance: number;
  /** City: fraction of candidate lots that get a building (performance lever). */
  cityDensityScale: number;
  /** Trees: instance draw radius (m). */
  treeDrawDistance: number;
  treeDensityScale: number;
  /** Landmarks: distance at which detailed LOD switches to simplified LOD (m). */
  landmarkDetailDistance: number;
  waterReflections: 'sky' | 'planar';
  /** 0 = off, 1..3 = increasing raymarch steps/resolution. */
  cloudQuality: 0 | 1 | 2 | 3;
  bloom: boolean;
  antialias: 'none' | 'fxaa' | 'smaa';
  particleBudget: number;
  birdCount: number;
  shipCount: number;
  anisotropy: number;
}

export const QUALITY_PRESETS: Record<QualityPreset, QualitySettings> = {
  low: {
    preset: 'low',
    maxPixelRatio: 1,
    minRenderScale: 0.6,
    maxRenderScale: 0.85,
    targetFrameMs: 16.6,
    shadowMapSize: 1024,
    shadowDistance: 600,
    terrainLodScale: 0.6,
    cityDrawDistance: 3500,
    cityDensityScale: 0.55,
    treeDrawDistance: 1500,
    treeDensityScale: 0.4,
    landmarkDetailDistance: 900,
    waterReflections: 'sky',
    cloudQuality: 1,
    bloom: false,
    antialias: 'fxaa',
    particleBudget: 4000,
    birdCount: 60,
    shipCount: 25,
    anisotropy: 2,
  },
  medium: {
    preset: 'medium',
    maxPixelRatio: 1.25,
    minRenderScale: 0.7,
    maxRenderScale: 1,
    targetFrameMs: 16.6,
    shadowMapSize: 2048,
    shadowDistance: 1200,
    terrainLodScale: 0.85,
    cityDrawDistance: 6000,
    cityDensityScale: 0.8,
    treeDrawDistance: 2500,
    treeDensityScale: 0.7,
    landmarkDetailDistance: 1500,
    waterReflections: 'sky',
    cloudQuality: 2,
    bloom: true,
    antialias: 'fxaa',
    particleBudget: 8000,
    birdCount: 150,
    shipCount: 45,
    anisotropy: 4,
  },
  high: {
    preset: 'high',
    maxPixelRatio: 1.5,
    minRenderScale: 0.75,
    maxRenderScale: 1,
    targetFrameMs: 16.6,
    shadowMapSize: 4096,
    shadowDistance: 2000,
    terrainLodScale: 1,
    cityDrawDistance: 9000,
    cityDensityScale: 1,
    treeDrawDistance: 4000,
    treeDensityScale: 1,
    landmarkDetailDistance: 2500,
    waterReflections: 'planar',
    cloudQuality: 2,
    bloom: true,
    antialias: 'smaa',
    particleBudget: 16000,
    birdCount: 300,
    shipCount: 70,
    anisotropy: 8,
  },
  ultra: {
    preset: 'ultra',
    maxPixelRatio: 2,
    minRenderScale: 0.8,
    maxRenderScale: 1,
    targetFrameMs: 16.6,
    shadowMapSize: 4096,
    shadowDistance: 3500,
    terrainLodScale: 1.4,
    cityDrawDistance: 14000,
    cityDensityScale: 1,
    treeDrawDistance: 6000,
    treeDensityScale: 1,
    landmarkDetailDistance: 4000,
    waterReflections: 'planar',
    cloudQuality: 3,
    bloom: true,
    antialias: 'smaa',
    particleBudget: 32000,
    birdCount: 500,
    shipCount: 100,
    anisotropy: 16,
  },
};

type Listener = (s: QualitySettings) => void;

export class QualityManager {
  settings: QualitySettings;
  private listeners = new Set<Listener>();

  constructor(preset: QualityPreset) {
    this.settings = { ...QUALITY_PRESETS[preset] };
  }

  static detectPreset(renderer: { capabilities: { maxTextureSize: number } }, gl: WebGL2RenderingContext): QualityPreset {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    if (/swiftshader|llvmpipe|software/.test(name)) {
      return 'low';
    }
    if (/apple m\d (max|ultra|pro)|rtx|radeon rx [67]\d{3}|rx 7\d{3}/.test(name)) {
      return 'high';
    }
    if (/apple m\d|apple gpu|rtx|gtx 1[06]|radeon/.test(name)) {
      return 'medium';
    }
    if (/intel|mali|adreno|powervr/.test(name)) {
      return 'low';
    }
    return renderer.capabilities.maxTextureSize >= 16384 ? 'medium' : 'low';
  }

  setPreset(preset: QualityPreset): void {
    this.settings = { ...QUALITY_PRESETS[preset] };
    this.emit();
  }

  update(patch: Partial<QualitySettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.emit();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) {
      fn(this.settings);
    }
  }
}
