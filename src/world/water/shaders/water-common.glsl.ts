import { MAX_WAVES } from '../config';
import { WAVE_WATER_GLSL } from '../particles/shaders.glsl';

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
${WAVE_WATER_GLSL}

vec2 geoUV(vec2 world) {
  return (world - uWorldRect.xy) * uWorldRect.zw;
}

float pickGroup(vec4 g, float group) {
  return group < 0.5 ? g.x : (group < 1.5 ? g.y : (group < 2.5 ? g.z : g.w));
}

float lakeWeight(vec4 region) {
  return clamp((1.0 - dot(region, vec4(1.0)) - 0.006) * 1.006, 0.0, 1.0);
}

/** 0..1 log-fetch exposure for the current wind regime (0 = < 150 m of open water upwind, 1 = open Black Sea). */
float fetchExposure(vec4 flow) {
  return clamp(mix(flow.z, flow.w, uSeaRegime.x), 0.0, 1.0);
}

/**
 * Wave group weights (short sea, long wind sea, swell, chop): water body, fetch (fetch-limited growth: the short sea
 * needs a few km, the long sea tens of km, the chop grows everywhere incl. the Golden Horn and lakes) and distance
 * offshore (shoaling/sheltering in the last tens of metres). The swell comes from the Black Sea in a poyraz and from
 * the Marmara in a lodos.
 */
vec4 waveGroupWeights(vec4 region, vec4 flow, float coast) {
  float offshore = -coast;
  float lake = lakeWeight(region);
  float fetch = fetchExposure(flow);
  float shore = smoothstep(0.0, 45.0, offshore);
  float sea = dot(region, vec4(1.0));
  float chopW = sea * mix(0.35, 1.0, shore) * mix(0.45, 1.0, smoothstep(0.05, 0.35, fetch)) + lake * 0.5 * shore;
  float shortW = (region.r + region.g + region.b + region.a * 0.15) * mix(0.3, 1.0, shore) * mix(0.1, 1.0, smoothstep(0.2, 0.5, fetch));
  float longW = (region.r + region.b + region.g * 0.25) * smoothstep(0.6, 0.9, fetch) * mix(0.15, 1.0, shore);
  vec4 swellRegion = mix(vec4(1.0, 0.04, 0.25, 0.0), vec4(0.15, 0.06, 1.0, 0.0), uSeaRegime.x);
  float swellW = dot(region, swellRegion) * smoothstep(60.0, 1800.0, offshore) * smoothstep(0.45, 0.85, fetch);
  return vec4(shortW, longW, swellW, chopW);
}

/** Gerstner displacement; components under-sampled by the local vertex spacing are filtered out. */
vec3 gerstnerDisplacement(vec2 xo, vec4 groups, float spacing) {
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
