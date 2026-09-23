import { NOISE_GEN_GLSL } from './noise-gen.glsl';

/**
 * 128^3 base shape: R = Perlin-Worley billow (remapped by the low-frequency Worley fbm; ~0.746 +- 0.076),
 * GBA = rounded Worley fbm at 4/8/16 cells per tile (~0.725 +- 0.12).
 */
export const BAKE_BASE_FRAGMENT = /* glsl */ `
${NOISE_GEN_GLSL}
uniform float uLayer;
uniform float uSize;
varying vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 p = vec3(vUv, (uLayer + 0.5) / uSize);
  float perlin = ngPerlinFbm3(p, 4.0, 5, 3.0);
  float pfbm = clamp(abs(perlin) * 1.35, 0.0, 1.0);
  float g = ngWorleyFbm3(p, 4.0, 1.0);
  float b = ngWorleyFbm3(p, 8.0, 5.0);
  float a = ngWorleyFbm3(p, 16.0, 9.0);
  float pw = clamp(ngRemap(pfbm, 0.0, 1.0, g, 1.0), 0.0, 1.0);
  float billow = ngRemap(pw, g * 0.625 + b * 0.25 + a * 0.125 - 1.0, 1.0, 0.0, 1.0);
  outColor = vec4(clamp(billow, 0.0, 1.0), ngWorleyRoundFbm3(p, 4.0, 1.0), ngWorleyRoundFbm3(p, 8.0, 5.0), ngWorleyRoundFbm3(p, 16.0, 9.0));
}
`;

/** 32^3 detail: RGB = rounded Worley fbm at 2/4/8 cells per tile (~0.725 +- 0.12). */
export const BAKE_DETAIL_FRAGMENT = /* glsl */ `
${NOISE_GEN_GLSL}
uniform float uLayer;
uniform float uSize;
varying vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 p = vec3(vUv, (uLayer + 0.5) / uSize);
  outColor = vec4(ngWorleyRoundFbm3(p, 2.0, 21.0), ngWorleyRoundFbm3(p, 4.0, 25.0), ngWorleyRoundFbm3(p, 8.0, 29.0), 1.0);
}
`;

/**
 * Weather map (tileable, one tile = weatherPeriod meters):
 *   R = cumulus coverage (individual clouds from jittered cells at three scales, domain-warped outlines)
 *   G = tower height factor (larger clouds grow taller)
 *   B = stratocumulus coverage (sparse flat patches)
 *   A = low-frequency regional field (instability; sampled rotated/scaled to break periodicity)
 */
export const BAKE_WEATHER_FRAGMENT = /* glsl */ `
${NOISE_GEN_GLSL}
varying vec2 vUv;
layout(location = 0) out vec4 outColor;

void cloudCells(vec2 uv, float n, float seed, float prob, float rMin, float rMax, float hMin, float hMax,
                inout float cov, inout float hw, inout float ws) {
  vec2 p = uv * n;
  vec2 id = floor(p);
  vec2 f = p - id;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 c = mod(id + o, n);
      vec4 h = ngHash42(c + seed);
      if (h.z > prob) continue;
      vec2 center = o + 0.22 + 0.56 * ngHash22(c + seed + 7.3) - f;
      float r = mix(rMin, rMax, h.w);
      float ang = h.x * 6.2831853;
      vec2 ax = vec2(cos(ang), sin(ang));
      vec2 d = vec2(dot(center, ax), dot(center, vec2(-ax.y, ax.x)) * (1.0 + 0.45 * h.y));
      float dist = length(d) / r;
      float blob = clamp(1.0 - dist * dist, 0.0, 1.0);
      cov = 1.0 - (1.0 - cov) * (1.0 - blob);
      float hh = mix(hMin, hMax, clamp(h.w * 0.75 + h.y * 0.25, 0.0, 1.0));
      hw += blob * hh;
      ws += blob;
    }
  }
}

void main() {
  vec2 uv = vUv;
  vec2 warp = vec2(ngFbm2(uv, vec2(20.0), 4, 1.0), ngFbm2(uv, vec2(20.0), 4, 2.0)) - 0.5;
  vec2 uvw = uv + warp * (0.9 / 32.0);
  float cov = 0.0;
  float hw = 0.0;
  float ws = 0.0;
  cloudCells(uvw, 16.0, 3.0, 0.45, 0.22, 0.42, 0.5, 1.0, cov, hw, ws);
  cloudCells(uvw, 32.0, 11.0, 0.45, 0.2, 0.38, 0.3, 0.65, cov, hw, ws);
  cloudCells(uvw, 64.0, 19.0, 0.4, 0.22, 0.42, 0.1, 0.35, cov, hw, ws);
  float height = ws > 1e-4 ? hw / ws : 0.3;
  float scField = ngFbm2(uv + warp * 0.02, vec2(6.0), 5, 31.0);
  float scMask = ngFbm2(uv, vec2(2.0), 3, 37.0);
  float sc = smoothstep(0.58, 0.74, scField) * smoothstep(0.5, 0.68, scMask);
  float regional = ngFbm2(uv, vec2(3.0), 5, 41.0);
  outColor = vec4(cov, height, sc, regional);
}
`;

/** Cirrus: R = fibrous streak density, G = regional mask. Streaks run along +u. */
export const BAKE_CIRRUS_FRAGMENT = /* glsl */ `
${NOISE_GEN_GLSL}
varying vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec2 uv = vUv;
  vec2 w = vec2(ngFbm2(uv, vec2(3.0), 5, 51.0), ngFbm2(uv, vec2(3.0), 5, 53.0)) - 0.5;
  vec2 w2 = vec2(ngFbm2(uv, vec2(12.0), 3, 55.0), ngFbm2(uv, vec2(12.0), 3, 56.0)) - 0.5;
  vec2 q = uv + w * 0.16 + w2 * 0.025;
  float strands = ngFbm2(q, vec2(6.0, 28.0), 5, 57.0);
  float fibres = ngFbm2(q + w2 * 0.01, vec2(24.0, 192.0), 3, 59.0);
  float mask = smoothstep(0.5, 0.72, ngFbm2(uv + w * 0.05, vec2(3.0), 5, 61.0));
  float d = smoothstep(0.52, 0.8, strands * 0.8 + fibres * 0.3 - 0.05) * mask;
  d *= 0.6 + 0.4 * fibres;
  outColor = vec4(d, mask, 0.0, 1.0);
}
`;
