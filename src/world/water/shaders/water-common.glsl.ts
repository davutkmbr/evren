import { MAX_WAVES } from '../config';

/**
 * Declarations shared by the water vertex and fragment shaders.
 * Coordinates: `xo` = world xz relative to uOrigin (a 2 km lattice point near the camera) so every phase stays small.
 */
export const WATER_COMMON_GLSL = /* glsl */ `
#define WAVE_COUNT ${MAX_WAVES}

uniform vec4 uWaveDir[WAVE_COUNT];   // xy = direction, z = k, w = wavelength
uniform vec4 uWaveAmp[WAVE_COUNT];   // x = amplitude, y = Q*k*A, z = phase at origin, w = group
uniform vec2 uOrigin;
uniform vec2 uGridCenter;
uniform vec4 uWorldRect;             // minX, minZ, 1/width, 1/depth
uniform sampler2D uGeoHeight;
uniform sampler2D uGeoCoast;
uniform sampler2D uRegionTex;        // Black Sea, Bosphorus, Marmara, Golden Horn weights (all 0 on lakes)
uniform sampler2D uFlowTex;          // current xz (m/s), fetch exposure in a poyraz / in a lodos
uniform vec4 uSeaRegime;             // x = lodos weight of the current sea (0 = poyraz)

vec2 geoUV(vec2 world) {
  return (world - uWorldRect.xy) * uWorldRect.zw;
}

float pickGroup(vec3 g, float group) {
  return group < 0.5 ? g.x : (group < 1.5 ? g.y : g.z);
}

float lakeWeight(vec4 region) {
  return clamp((1.0 - dot(region, vec4(1.0)) - 0.006) * 1.006, 0.0, 1.0);
}

/** 0..1 log-fetch exposure for the current wind regime (0 = < 150 m of open water upwind, 1 = open Black Sea). */
float fetchExposure(vec4 flow) {
  return clamp(mix(flow.z, flow.w, uSeaRegime.x), 0.0, 1.0);
}

/**
 * Wave group weights (short chop, long wind sea, swell): water body, fetch (fetch-limited growth: the chop needs a
 * few km, the longer sea tens of km) and distance offshore (shoaling/sheltering in the last tens of metres).
 */
vec3 waveGroupWeights(vec4 region, vec4 flow, float coast) {
  float offshore = -coast;
  float lake = lakeWeight(region);
  float fetch = fetchExposure(flow);
  float shore = smoothstep(0.0, 45.0, offshore);
  float shortW = (region.r + region.g + region.b + region.a * 0.22) * mix(0.3, 1.0, shore) * mix(0.3, 1.0, smoothstep(0.03, 0.4, fetch));
  float longW = (region.r + region.b + region.g * 0.25) * smoothstep(0.35, 0.8, fetch) * mix(0.15, 1.0, shore);
  float swellW = (region.r + region.b * 0.25 + region.g * 0.04) * smoothstep(60.0, 1800.0, offshore) * smoothstep(0.45, 0.85, flow.z);
  return vec3(shortW + lake * 0.12 * shore, longW, swellW);
}

/** Gerstner displacement; components under-sampled by the local vertex spacing are filtered out. */
vec3 gerstnerDisplacement(vec2 xo, vec3 groups, float spacing) {
  vec3 d = vec3(0.0);
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 amp = uWaveAmp[i];
    if (amp.x <= 0.0) continue;
    vec4 dir = uWaveDir[i];
    float g = pickGroup(groups, amp.w) * (1.0 - smoothstep(dir.w * 0.1, dir.w * 0.22, spacing));
    if (g <= 0.0) continue;
    float ph = dir.z * dot(dir.xy, xo) + amp.z;
    float s = sin(ph);
    float c = cos(ph);
    d.xz += dir.xy * (amp.y * g / dir.z * c);
    d.y += amp.x * g * s;
  }
  return d;
}
`;
