import { POST_COMMON_GLSL } from './common.glsl';

/** Writes log2 luminance (R) and linear luminance (G) of the source, box-filtered over the meter texel footprint. */
export const METER_FRAG = /* glsl */ `
${POST_COMMON_GLSL}
uniform sampler2D tSource;
uniform vec2 uFootprint;
varying vec2 vUv;

void main() {
  vec2 d = uFootprint * 0.25;
  vec3 c = textureLod(tSource, vUv + vec2(-d.x, -d.y), 0.0).rgb;
  c += textureLod(tSource, vUv + vec2(d.x, -d.y), 0.0).rgb;
  c += textureLod(tSource, vUv + vec2(-d.x, d.y), 0.0).rgb;
  c += textureLod(tSource, vUv + vec2(d.x, d.y), 0.0).rgb;
  float l = postLuma(sanitizeHdr(c * 0.25));
  gl_FragColor = vec4(log2(max(l, 1e-7)), l, 0.0, 1.0);
}
`;

/**
 * Sun visibility for the lens flare (1x1 output): fraction of a small disc around the sun that is sky (depth),
 * multiplied by how much of the sky radiance survived the HDR passes (clouds) there.
 * rgb = sun colour * transmitted visibility, a = geometric visibility.
 */
export const FLARE_VISIBILITY_FRAG = /* glsl */ `
${POST_COMMON_GLSL}
uniform sampler2D tBefore;
uniform sampler2D tAfter;
uniform sampler2D tDepth;
uniform vec2 uSunUV;
uniform vec2 uRadius;
uniform vec3 uSunColor;
uniform float uNear;
uniform float uFar;
uniform float uSkyDistance;

void main() {
  const int N = 24;
  float visible = 0.0;
  float transmitted = 0.0;
  for (int i = 0; i < N; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / float(N));
    float a = fi * 2.39996323;
    vec2 uv = uSunUV + vec2(cos(a), sin(a)) * r * uRadius;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
      continue;
    }
    float depth = textureLod(tDepth, uv, 0.0).r;
    float dist = postLinearDepth(depth, uNear, uFar);
    if (depth <= 0.0 || dist > uSkyDistance) {
      float before = postLuma(sanitizeHdr(textureLod(tBefore, uv, 0.0).rgb));
      float after = postLuma(sanitizeHdr(textureLod(tAfter, uv, 0.0).rgb));
      visible += 1.0;
      transmitted += clamp(after / max(before, 1e-4), 0.0, 1.0);
    }
  }
  visible /= float(N);
  transmitted /= float(N);
  gl_FragColor = vec4(uSunColor * transmitted, visible);
}
`;
