/**
 * Aerial perspective + sky lookups (OWNED BY render/sky).
 *
 * Public GLSL API (available everywhere SHARED_GLSL is included):
 *   vec3 applyAtmosphere(vec3 color, vec3 worldPos)  // transmittance + in-scattering between uCamPos and worldPos
 *   vec3 skyRadiance(vec3 dir)                        // sky radiance seen from the camera (no sun disk): reflections/ambient
 *   vec3 atmoTransmittance(vec3 worldPos)             // camera -> worldPos transmittance (e.g. to fade additive effects)
 *   vec3 keyLightAt(vec3 worldPos)                    // key light irradiance (sun by day, moon by night) at that altitude,
 *                                                     // reddened by the atmosphere, 0 inside the planet's shadow
 *   uniform vec3 uKeyLightDir                         // unit vector toward the key light (sun or moon)
 *   (uSunColor/uSunDir remain the SUN at ground level; at night use uKeyLightDir + keyLightAt() for moonlight.)
 * Built-in lit materials (MeshStandard/Physical...) already receive keyLightRatio() and cloudShadow() on the key light
 * (patched lights_fragment_begin, see render/sky/shader-patches.ts) - do not apply them again in material patches.
 *
 * Aerial perspective model: per-channel optical depth of Rayleigh (8 km), aerosol (1.2 km) and a humid Marmara haze
 * layer (0.85 km) integrated analytically along the view ray; in-scattered light is the camera's sky-view LUT radiance in
 * that direction weighted by (1 - T(d)) / (1 - T(full ray)), so distant terrain converges exactly to the horizon sky
 * (including sun glow, twilight colours and the city's night skyglow) and rays going up/down behave correctly.
 * Without the sky system (other sandboxes) everything falls back to a simple height fog (uAtmoState.y == 0).
 */
import { ATMOSPHERE, KEY_LIGHT_HEIGHTS } from '../sky/params';

const f = (n: number): string => {
  const s = n.toPrecision(7);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};
const v3 = (a: readonly number[], scale = 1): string => `vec3(${f(a[0] * scale)}, ${f(a[1] * scale)}, ${f(a[2] * scale)})`;

const hazeExt = [0, 1, 2].map((i) => ATMOSPHERE.hazeScatteringPerKm[i] + ATMOSPHERE.hazeAbsorptionPerKm[i]);
const chapman = (scaleHeightKm: number): number => Math.sqrt((Math.PI * ATMOSPHERE.groundRadiusKm) / (2 * scaleHeightKm));
const H = KEY_LIGHT_HEIGHTS;

export const ATMOSPHERE_GLSL = /* glsl */ `
uniform sampler2D uSkyViewLUT;
uniform vec4 uAtmoState;
uniform vec3 uAtmoGround;
uniform vec3 uKeyLightDir;
uniform vec3 uKeyLightColor;
uniform vec3 uKeyLightRatio[6];

#define ATMO_KEYLIGHT_TINT 1
const float ATMO_RG_M = ${f(ATMOSPHERE.groundRadiusKm * 1000)};
const vec3 ATMO_BETA_R = ${v3(ATMOSPHERE.rayleighScatteringPerKm, 1e-3)};
const float ATMO_EXT_M = ${f(ATMOSPHERE.mieExtinctionPerKm * 1e-3)};
const vec3 ATMO_EXT_H = ${v3(hazeExt, 1e-3)};
const vec3 ATMO_SCALE_H = vec3(${f(ATMOSPHERE.rayleighScaleHeightKm * 1000)}, ${f(ATMOSPHERE.mieScaleHeightKm * 1000)}, ${f(ATMOSPHERE.hazeScaleHeightKm * 1000)});
const vec3 ATMO_CHAPMAN_C = vec3(${f(chapman(ATMOSPHERE.rayleighScaleHeightKm))}, ${f(chapman(ATMOSPHERE.mieScaleHeightKm))}, ${f(chapman(ATMOSPHERE.hazeScaleHeightKm))});

float atmoHorizonDip(float camAlt) {
  return sqrt(2.0 * max(camAlt, 1.0) / ATMO_RG_M);
}

/* Sky-view LUT (Hillaire 2020 mapping, absolute azimuth, horizon row exactly at v = 0.5). rgb = in-scatter, a = T. */
vec4 atmoSkyViewSample(vec3 dir) {
  float camKm = 6360.0 + max(uAtmoState.x, 1.0) * 0.001;
  float vHorizon = sqrt(max(camKm * camKm - 6360.0 * 6360.0, 0.0));
  float beta = acos(clamp(vHorizon / camKm, -1.0, 1.0));
  float zenithHorizon = PI - beta;
  float viewZenith = acos(clamp(dir.y, -1.0, 1.0));
  float v;
  if (viewZenith < zenithHorizon) {
    v = (1.0 - sqrt(max(1.0 - viewZenith / zenithHorizon, 0.0))) * 0.5;
  } else {
    v = sqrt(clamp((viewZenith - zenithHorizon) / beta, 0.0, 1.0)) * 0.5 + 0.5;
  }
  vec2 size = vec2(textureSize(uSkyViewLUT, 0));
  v = (v * (size.y - 1.0) + 0.5) / size.y;
  float u = atan(dir.x, -dir.z) * (0.5 / PI) + 0.5;
  return textureLod(uSkyViewLUT, vec2(u, v), 0.0);
}

/* Integrated density (m) of Rayleigh / aerosol / haze along a straight segment (exponential height falloff). */
vec3 atmoColumn(float h0, float dy, float dist) {
  vec3 a = max((dy * dist) / ATMO_SCALE_H, -h0 / ATMO_SCALE_H - 0.5);
  bvec3 nearZero = lessThan(abs(a), vec3(1e-4));
  vec3 safeA = mix(a, vec3(1e-4), nearZero);
  vec3 fa = mix((1.0 - exp(-safeA)) / safeA, 1.0 - 0.5 * a, nearZero);
  return exp(-h0 / ATMO_SCALE_H) * dist * fa;
}

vec3 atmoOpticalDepth(vec3 column) {
  return ATMO_BETA_R * column.x + ATMO_EXT_M * uAtmoState.w * column.y + ATMO_EXT_H * uAtmoState.z * column.z;
}

/* Optical depth of the whole view ray (to space, or to the ground when it dips below the horizon). */
vec3 atmoFullRayDepth(float h0, float dy) {
  vec3 base = exp(-h0 / ATMO_SCALE_H);
  vec3 invC = 1.0 / ATMO_CHAPMAN_C;
  vec3 column;
  if (dy >= -atmoHorizonDip(h0)) {
    column = ATMO_SCALE_H * base / (max(dy, 0.0) * (1.0 - invC) + invC);
  } else {
    column = ATMO_SCALE_H * (1.0 - base) / max(vec3(-dy), invC);
  }
  return atmoOpticalDepth(column);
}

vec3 atmoTransmittance(vec3 worldPos) {
  vec3 d = worldPos - uCamPos;
  float dist = length(d);
  if (dist < 1e-3) return vec3(1.0);
  if (uAtmoState.y < 0.5) return vec3(exp(-uFogDensity * dist));
  return exp(-atmoOpticalDepth(atmoColumn(max(uCamPos.y, 0.0), d.y / dist, dist)));
}

vec3 skyRadiance(vec3 dir) {
  if (uAtmoState.y < 0.5) {
    float up = clamp(dir.y, -1.0, 1.0);
    vec3 zenith = mix(vec3(0.18, 0.36, 0.75), vec3(0.004, 0.006, 0.015), uNight);
    vec3 horizon = mix(vec3(0.65, 0.72, 0.82), vec3(0.02, 0.025, 0.04), uNight);
    vec3 c = mix(horizon, zenith, pow(max(up, 0.0), 0.5));
    c += uSunColor * pow(max(dot(dir, uSunDir), 0.0), 8.0) * 0.15;
    return up < 0.0 ? horizon * 0.6 : c;
  }
  vec4 s = atmoSkyViewSample(dir);
  float ground = step(dir.y, -atmoHorizonDip(uAtmoState.x));
  return s.rgb + ground * s.a * uAtmoGround;
}

vec3 applyAtmosphere(vec3 color, vec3 worldPos) {
  vec3 d = worldPos - uCamPos;
  float dist = length(d);
  if (dist < 1e-3) return color;
  vec3 dir = d / dist;
  if (uAtmoState.y < 0.5) {
    float fh = max(uFogHeightFalloff, 1e-5);
    float integ = abs(d.y) > 0.01 ? (exp(-fh * uCamPos.y) - exp(-fh * (uCamPos.y + d.y))) / (fh * d.y) : exp(-fh * uCamPos.y);
    float amount = 1.0 - exp(-uFogDensity * dist * max(integ, 0.0));
    float sunAmt = pow(max(dot(dir, uSunDir), 0.0), 6.0);
    vec3 fogC = mix(uFogColor, uSunColor * 0.25 + uFogColor, sunAmt * (1.0 - uNight));
    return mix(color, fogC, clamp(amount, 0.0, 1.0));
  }
  float h0 = max(uCamPos.y, 0.0);
  vec3 T = exp(-atmoOpticalDepth(atmoColumn(h0, dir.y, dist)));
  vec3 Tfull = exp(-atmoFullRayDepth(h0, dir.y));
  vec3 w = clamp((1.0 - T) / max(1.0 - Tfull, vec3(1e-5)), 0.0, 1.0);
  return color * T + atmoSkyViewSample(dir).rgb * w;
}

/* Key light (sun/moon) transmittance relative to the reference altitude ${H[H.length - 1]} m (includes planet shadow). */
vec3 keyLightRatio(float h) {
  if (uAtmoState.y < 0.5) return vec3(1.0);
  h = clamp(h, 0.0, ${f(H[5])});
  if (h < ${f(H[1])}) return mix(uKeyLightRatio[0], uKeyLightRatio[1], h * ${f(1 / (H[1] - H[0]))});
  if (h < ${f(H[2])}) return mix(uKeyLightRatio[1], uKeyLightRatio[2], (h - ${f(H[1])}) * ${f(1 / (H[2] - H[1]))});
  if (h < ${f(H[3])}) return mix(uKeyLightRatio[2], uKeyLightRatio[3], (h - ${f(H[2])}) * ${f(1 / (H[3] - H[2]))});
  if (h < ${f(H[4])}) return mix(uKeyLightRatio[3], uKeyLightRatio[4], (h - ${f(H[3])}) * ${f(1 / (H[4] - H[3]))});
  return mix(uKeyLightRatio[4], uKeyLightRatio[5], (h - ${f(H[4])}) * ${f(1 / (H[5] - H[4]))});
}

vec3 keyLightAt(vec3 worldPos) {
  if (uAtmoState.y < 0.5) return uSunColor;
  return uKeyLightColor * keyLightRatio(worldPos.y);
}
`;

// Register the sky's global uniforms (placeholder LUT until the sky system runs). Dynamic import breaks the
// core/uniforms <-> shaders import cycle; it resolves long before the first program compiles.
void import('../sky/globals').then((m) => m.registerAtmosphereGlobals());
