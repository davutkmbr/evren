/**
 * Shared GLSL (core-owned). Declares the global uniforms (see core/uniforms.ts) and generic helpers.
 * Included by SHARED_GLSL. Do not redeclare these names in module shaders.
 */
export const COMMON_GLSL = /* glsl */ `
uniform float uTime;
uniform float uTimeOfDay;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform vec3 uAmbient;
uniform float uNight;
uniform vec3 uWind;
uniform vec3 uCamPos;
uniform float uCamNear;
uniform float uCamFar;
uniform vec2 uResolution;
uniform float uFogDensity;
uniform float uFogHeightFalloff;
uniform vec3 uFogColor;

#ifndef PI
#define PI 3.141592653589793
#endif

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }

float vnoise2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1,0,0)), n010 = hash13(i + vec3(0,1,0)), n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1)), n101 = hash13(i + vec3(1,0,1)), n011 = hash13(i + vec3(0,1,1)), n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float fbm2(vec2 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * vnoise2(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
  return s;
}
float fbm3(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * vnoise3(p); p = p * 2.02 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}

/* Reversed-Z float depth (1 = near, 0 = far) -> positive linear view distance along -Z. */
float linearDepth(float d) {
  return (uCamFar * uCamNear) / (d * (uCamFar - uCamNear) + uCamNear);
}
/* Reconstruct view-space position from uv + reversed depth. projInv = camera.projectionMatrixInverse. */
vec3 viewPosFromDepth(vec2 uv, float d, mat4 projInv) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, d, 1.0);
  vec4 v = projInv * ndc;
  return v.xyz / v.w;
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;
