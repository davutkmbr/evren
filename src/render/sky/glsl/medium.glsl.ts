/**
 * Participating medium + LUT parameterisations shared by the atmosphere LUT shaders, the sky dome and the stars
 * (kilometre units, planet-centred coordinates). Based on Hillaire 2020 / Bruneton 2017.
 */
export const MEDIUM_GLSL = /* glsl */ `
#ifndef PI
#define PI 3.141592653589793
#endif
#define ATMO_RG 6360.0
#define ATMO_RT 6460.0

uniform vec3 uRayleighSca;
uniform float uRayleighInvH;
uniform vec4 uMieParams;      // scattering, extinction, 1/H, g
uniform vec3 uOzoneAbs;
uniform vec3 uHazeSca;
uniform vec3 uHazeExt;
uniform vec2 uHazeParams;     // 1/H, g
uniform vec3 uGroundAlbedo;
uniform vec4 uMediumMul;      // x haze multiplier, y aerosol multiplier

struct AtmoMedium {
  vec3 scaR;
  vec3 scaM;
  vec3 scaH;
  vec3 ext;
};

AtmoMedium sampleMedium(float hKm) {
  float h = max(hKm, 0.0);
  float dR = exp(-h * uRayleighInvH);
  float dM = exp(-h * uMieParams.z) * uMediumMul.y;
  float dH = exp(-h * uHazeParams.x) * uMediumMul.x;
  float dO = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  AtmoMedium m;
  m.scaR = uRayleighSca * dR;
  m.scaM = vec3(uMieParams.x * dM);
  m.scaH = uHazeSca * dH;
  m.ext = m.scaR + vec3(uMieParams.y * dM) + uHazeExt * dH + uOzoneAbs * dO;
  return m;
}

float phaseRayleigh(float c) {
  return 3.0 / (16.0 * PI) * (1.0 + c * c);
}

/* Cornette-Shanks (normalised Henyey-Greenstein variant with a Rayleigh-like back lobe). */
float phaseCS(float g, float c) {
  float g2 = g * g;
  float k = 3.0 / (8.0 * PI) * (1.0 - g2) / (2.0 + g2);
  return k * (1.0 + c * c) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-5), 1.5);
}

/* Humid urban/maritime haze: forward diffraction aureole + broad lobe (two-term Cornette-Shanks, effective g ~0.72). */
float phaseHaze(float c) {
  return 0.8 * phaseCS(uHazeParams.y, c) + 0.2 * phaseCS(0.4, c);
}

/* Distance to the nearest positive intersection with a planet-centred sphere, or -1. */
float raySphere(vec3 ro, vec3 rd, float radius) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  float s = sqrt(disc);
  float t0 = -b - s;
  float t1 = -b + s;
  if (t0 > 0.0) return t0;
  if (t1 > 0.0) return t1;
  return -1.0;
}

float fromUnitToSubUv(float u, float res) { return (u + 0.5 / res) * (res / (res + 1.0)); }
float fromSubUvToUnit(float u, float res) { return (u - 0.5 / res) * (res / (res - 1.0)); }

/* Bruneton transmittance mapping. */
vec2 transmittanceUv(float r, float mu) {
  float H = sqrt(ATMO_RT * ATMO_RT - ATMO_RG * ATMO_RG);
  float rho = sqrt(max(r * r - ATMO_RG * ATMO_RG, 0.0));
  float disc = r * r * (mu * mu - 1.0) + ATMO_RT * ATMO_RT;
  float d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  float dMin = ATMO_RT - r;
  float dMax = rho + H;
  return vec2((d - dMin) / (dMax - dMin), rho / H);
}

void transmittanceParams(vec2 uv, out float r, out float mu) {
  float H = sqrt(ATMO_RT * ATMO_RT - ATMO_RG * ATMO_RG);
  float rho = H * uv.y;
  r = sqrt(rho * rho + ATMO_RG * ATMO_RG);
  float dMin = ATMO_RT - r;
  float dMax = rho + H;
  float d = dMin + uv.x * (dMax - dMin);
  mu = d == 0.0 ? 1.0 : (H * H - rho * rho - d * d) / (2.0 * r * d);
  mu = clamp(mu, -1.0, 1.0);
}

#ifdef USE_TRANSMITTANCE_LUT
uniform sampler2D uTransmittanceLUT;
vec3 sampleTransmittance(float r, float mu) {
  vec2 uv = transmittanceUv(r, mu);
  vec2 size = vec2(textureSize(uTransmittanceLUT, 0));
  uv = vec2(fromUnitToSubUv(uv.x, size.x), fromUnitToSubUv(uv.y, size.y));
  return textureLod(uTransmittanceLUT, uv, 0.0).rgb;
}
/* Smooth planet shadow over the angular size of the light source (sin ~ 0.0047). */
float planetShadow(float r, float muLight) {
  float muHorizon = -sqrt(max(1.0 - (ATMO_RG / r) * (ATMO_RG / r), 0.0));
  return smoothstep(muHorizon - 0.0047, muHorizon + 0.0047, muLight);
}
#endif

#ifdef USE_MULTISCATTERING_LUT
uniform sampler2D uMultiScatteringLUT;
vec3 sampleMultiScattering(float r, float muLight) {
  vec2 size = vec2(textureSize(uMultiScatteringLUT, 0));
  vec2 uv = vec2(clamp(muLight * 0.5 + 0.5, 0.0, 1.0), clamp((r - ATMO_RG) / (ATMO_RT - ATMO_RG), 0.0, 1.0));
  uv = vec2(fromUnitToSubUv(uv.x, size.x), fromUnitToSubUv(uv.y, size.y));
  return textureLod(uMultiScatteringLUT, uv, 0.0).rgb;
}
#endif
`;
