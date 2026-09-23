import type { QualitySettings } from '../../core/quality';

export type AntialiasMode = 'none' | 'fxaa' | 'smaa';
export type ToneMapper = 'agx' | 'aces' | 'neutral';
export type PostDebugView = 'off' | 'hdr' | 'luminance' | 'depth' | 'bloom';

/** Developer overrides parsed from the URL. `null` = follow the quality preset. */
export interface PostOverrides {
  /** ?ev=<stops> exposure compensation. */
  evBias: number;
  /** ?tm=agx|aces|neutral */
  toneMapper: ToneMapper;
  /** ?aa=none|fxaa|smaa */
  antialias: AntialiasMode | null;
  /** ?msaa=0|2|4 */
  msaa: number | null;
  /** ?scale=0.5..1 pins the render scale (disables dynamic resolution). */
  fixedScale: number | null;
  /** ?dynres=0 disables dynamic resolution (renders at maxRenderScale). */
  dynamicResolution: boolean;
  /** ?bloom=0|1 */
  bloom: boolean | null;
  /** ?flare=0 */
  flare: boolean;
  /** ?grain=0 */
  grain: boolean;
  /** ?sharpen=0..1 */
  sharpen: number | null;
  /** ?speed=0..1 forces the speed effect (testing). */
  speed: number | null;
  /** ?postdebug=hdr|luminance|depth|bloom */
  debugView: PostDebugView;
  /** ?exposure=<linear> fixes the exposure (disables adaptation). */
  fixedExposure: number | null;
}

function num(params: URLSearchParams, key: string): number | null {
  if (!params.has(key)) {
    return null;
  }
  const v = Number(params.get(key));
  return Number.isFinite(v) ? v : null;
}

export function parsePostOverrides(params: URLSearchParams): PostOverrides {
  const aa = params.get('aa');
  const tm = params.get('tm');
  const bloom = params.get('bloom');
  const dbg = params.get('postdebug');
  return {
    evBias: num(params, 'ev') ?? 0,
    toneMapper: tm === 'aces' || tm === 'neutral' ? tm : 'agx',
    antialias: aa === 'none' || aa === 'fxaa' || aa === 'smaa' ? aa : null,
    msaa: num(params, 'msaa'),
    fixedScale: num(params, 'scale'),
    dynamicResolution: params.get('dynres') !== '0',
    bloom: bloom === null ? null : bloom !== '0',
    flare: params.get('flare') !== '0',
    grain: params.get('grain') !== '0',
    sharpen: num(params, 'sharpen'),
    speed: num(params, 'speed'),
    debugView: dbg === 'hdr' || dbg === 'luminance' || dbg === 'depth' || dbg === 'bloom' ? dbg : 'off',
    fixedExposure: num(params, 'exposure'),
  };
}

/** Effective settings resolved from the quality preset + overrides. */
export interface ResolvedPostSettings {
  antialias: AntialiasMode;
  msaaSamples: number;
  bloom: boolean;
  minScale: number;
  maxScale: number;
  targetFrameMs: number;
  sharpen: number;
}

export function resolvePostSettings(q: QualitySettings, o: PostOverrides, maxSamples: number): ResolvedPostSettings {
  // MSAA resolves sub-pixel geometry (bridge cables, minarets) that post AA cannot reconstruct. Measured on an
  // M2 Max at 1600x900: 2x is nearly free, 4x adds ~1.2-1.7 ms and ~70 MB to the scene pass, so only ultra uses 4x
  // (high = 2x MSAA + SMAA).
  const presetMsaa = q.preset === 'ultra' ? 4 : q.preset === 'high' || q.preset === 'medium' ? 2 : 0;
  const msaa = Math.max(0, Math.min(maxSamples, Math.round(o.msaa ?? presetMsaa)));
  return {
    antialias: o.antialias ?? q.antialias,
    msaaSamples: msaa >= 2 ? msaa : 0,
    bloom: o.bloom ?? q.bloom,
    minScale: q.minRenderScale,
    maxScale: q.maxRenderScale,
    targetFrameMs: q.targetFrameMs,
    sharpen: o.sharpen ?? 0.2,
  };
}
