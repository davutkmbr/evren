import { POST_COMMON_GLSL } from './common.glsl';
import { EXPOSURE_GLSL } from './meter.glsl';

/**
 * 13-tap "dual box" downsample (Jimenez, CoD: Advanced Warfare, 2014).
 * KARIS: first mip uses per-group Karis weighting to suppress sub-pixel fireflies (sun glints) without a threshold.
 */
export const BLOOM_DOWNSAMPLE_FRAG = /* glsl */ `
${POST_COMMON_GLSL}
${EXPOSURE_GLSL}
uniform sampler2D tSource;
/* Exposure state (the Karis weights work on exposed luminance). */
uniform sampler2D tExposure;
uniform vec2 uTexel;
uniform float uKarisScale;
varying vec2 vUv;

vec3 tap(vec2 offset) {
#if KARIS
  return sanitizeHdr(textureLod(tSource, vUv + offset * uTexel, 0.0).rgb);
#else
  return textureLod(tSource, vUv + offset * uTexel, 0.0).rgb;
#endif
}

float karisWeight(vec3 c, float scale) {
  return 1.0 / (1.0 + postLuma(c) * scale);
}

void main() {
  vec3 a = tap(vec2(-2.0, 2.0));
  vec3 b = tap(vec2(0.0, 2.0));
  vec3 c = tap(vec2(2.0, 2.0));
  vec3 d = tap(vec2(-2.0, 0.0));
  vec3 e = tap(vec2(0.0, 0.0));
  vec3 f = tap(vec2(2.0, 0.0));
  vec3 g = tap(vec2(-2.0, -2.0));
  vec3 h = tap(vec2(0.0, -2.0));
  vec3 i = tap(vec2(2.0, -2.0));
  vec3 j = tap(vec2(-1.0, 1.0));
  vec3 k = tap(vec2(1.0, 1.0));
  vec3 l = tap(vec2(-1.0, -1.0));
  vec3 m = tap(vec2(1.0, -1.0));
#if KARIS
  float karisScale = postExposure(tExposure) * uKarisScale;
  vec3 g0 = (a + b + d + e) * 0.25;
  vec3 g1 = (b + c + e + f) * 0.25;
  vec3 g2 = (d + e + g + h) * 0.25;
  vec3 g3 = (e + f + h + i) * 0.25;
  vec3 g4 = (j + k + l + m) * 0.25;
  float w0 = karisWeight(g0, karisScale) * 0.125;
  float w1 = karisWeight(g1, karisScale) * 0.125;
  float w2 = karisWeight(g2, karisScale) * 0.125;
  float w3 = karisWeight(g3, karisScale) * 0.125;
  float w4 = karisWeight(g4, karisScale) * 0.5;
  vec3 result = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
#else
  vec3 result = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
#endif
  gl_FragColor = vec4(max(result, vec3(0.0)), 1.0);
}
`;

/** 3x3 tent upsample, blended additively onto the next larger mip. */
export const BLOOM_UPSAMPLE_FRAG = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel;
uniform float uRadius;
uniform float uWeight;
varying vec2 vUv;

void main() {
  vec2 d = uTexel * uRadius;
  vec3 s = textureLod(tSource, vUv, 0.0).rgb * 4.0;
  s += textureLod(tSource, vUv + vec2(-d.x, 0.0), 0.0).rgb * 2.0;
  s += textureLod(tSource, vUv + vec2(d.x, 0.0), 0.0).rgb * 2.0;
  s += textureLod(tSource, vUv + vec2(0.0, -d.y), 0.0).rgb * 2.0;
  s += textureLod(tSource, vUv + vec2(0.0, d.y), 0.0).rgb * 2.0;
  s += textureLod(tSource, vUv + vec2(-d.x, -d.y), 0.0).rgb;
  s += textureLod(tSource, vUv + vec2(d.x, -d.y), 0.0).rgb;
  s += textureLod(tSource, vUv + vec2(-d.x, d.y), 0.0).rgb;
  s += textureLod(tSource, vUv + vec2(d.x, d.y), 0.0).rgb;
  gl_FragColor = vec4(s * (uWeight / 16.0), 1.0);
}
`;
