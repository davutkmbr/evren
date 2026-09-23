/**
 * Tileable procedural noise used to bake the cloud textures on the GPU (once, at init).
 * All functions take coordinates in "cells" and an integer period so the result wraps seamlessly.
 */
export const NOISE_GEN_GLSL = /* glsl */ `
vec3 ngHash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
vec2 ngHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec4 ngHash42(vec2 p) {
  vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

float ngRemap(float v, float l0, float h0, float l1, float h1) {
  return l1 + (v - l0) * (h1 - l1) / (h0 - l0);
}

/* 3D gradient noise with integer period, ~[-1, 1]. */
float ngGrad3(vec3 x, float period, float seed) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 s = vec3(seed * 17.13, seed * 31.7, seed * 7.31);
  #define NG_G(o) dot(ngHash33(mod(i + o, period) + s) * 2.0 - 1.0, f - o)
  float n000 = NG_G(vec3(0.0, 0.0, 0.0));
  float n100 = NG_G(vec3(1.0, 0.0, 0.0));
  float n010 = NG_G(vec3(0.0, 1.0, 0.0));
  float n110 = NG_G(vec3(1.0, 1.0, 0.0));
  float n001 = NG_G(vec3(0.0, 0.0, 1.0));
  float n101 = NG_G(vec3(1.0, 0.0, 1.0));
  float n011 = NG_G(vec3(0.0, 1.0, 1.0));
  float n111 = NG_G(vec3(1.0, 1.0, 1.0));
  #undef NG_G
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

float ngPerlinFbm3(vec3 p, float freq, int octaves, float seed) {
  float g = exp2(-0.85);
  float amp = 1.0;
  float n = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    n += amp * ngGrad3(p * freq, freq, seed + float(i));
    freq *= 2.0;
    amp *= g;
  }
  return n;
}

/* Inverted cellular noise: 1 at feature points, falling to ~0 between them. */
float ngWorley3(vec3 p, float freq, float seed) {
  vec3 x = p * freq;
  vec3 id = floor(x);
  vec3 f = fract(x);
  float minD = 1e9;
  for (int k = -1; k <= 1; k++) {
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec3 o = vec3(float(i), float(j), float(k));
        vec3 c = mod(id + o, freq);
        vec3 r = o + ngHash33(c + seed * 13.7) - f;
        minD = min(minD, dot(r, r));
      }
    }
  }
  return 1.0 - clamp(sqrt(minD), 0.0, 1.0);
}

float ngWorleyFbm3(vec3 p, float freq, float seed) {
  return ngWorley3(p, freq, seed) * 0.625 + ngWorley3(p, freq * 2.0, seed + 1.0) * 0.25 + ngWorley3(p, freq * 4.0, seed + 2.0) * 0.125;
}

/* Rounded cellular noise: 1 - smooth-min of squared distances (k = 10). Paraboloid bumps with soft creases,
   i.e. convex bulges instead of the cones of 1 - F1. Statistics ~0.725 +- 0.12 (see cloud-common z-scores). */
float ngWorleyRound3(vec3 p, float freq, float seed) {
  vec3 x = p * freq;
  vec3 id = floor(x);
  vec3 f = fract(x);
  float acc = 0.0;
  for (int k = -1; k <= 1; k++) {
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec3 o = vec3(float(i), float(j), float(k));
        vec3 c = mod(id + o, freq);
        vec3 r = o + ngHash33(c + seed * 13.7) - f;
        acc += exp(-10.0 * dot(r, r));
      }
    }
  }
  return max(1.0 + log(max(acc, 1e-30)) * 0.1, 0.0);
}

float ngWorleyRoundFbm3(vec3 p, float freq, float seed) {
  return ngWorleyRound3(p, freq, seed) * 0.625 + ngWorleyRound3(p, freq * 2.0, seed + 1.0) * 0.25 + ngWorleyRound3(p, freq * 4.0, seed + 2.0) * 0.125;
}

/* 2D gradient noise with integer period, ~[-0.7, 0.7]. */
float ngGrad2(vec2 x, vec2 period, float seed) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 s = vec2(seed * 11.31, seed * 5.77);
  vec2 g00 = ngHash22(mod(i, period) + s) * 2.0 - 1.0;
  vec2 g10 = ngHash22(mod(i + vec2(1.0, 0.0), period) + s) * 2.0 - 1.0;
  vec2 g01 = ngHash22(mod(i + vec2(0.0, 1.0), period) + s) * 2.0 - 1.0;
  vec2 g11 = ngHash22(mod(i + vec2(1.0, 1.0), period) + s) * 2.0 - 1.0;
  float n00 = dot(g00, f);
  float n10 = dot(g10, f - vec2(1.0, 0.0));
  float n01 = dot(g01, f - vec2(0.0, 1.0));
  float n11 = dot(g11, f - vec2(1.0, 1.0));
  return mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);
}

/* Tileable fbm over uv in [0,1): freq = cells per tile on each axis. Output ~[0, 1]. */
float ngFbm2(vec2 uv, vec2 freq, int octaves, float seed) {
  float n = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    n += amp * ngGrad2(uv * freq, freq, seed + float(i) * 3.1);
    norm += amp;
    freq *= 2.0;
    amp *= 0.5;
  }
  return clamp(n / norm * 1.1 + 0.5, 0.0, 1.0);
}
`;
