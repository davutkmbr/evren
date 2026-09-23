import { MEDIUM_GLSL } from './medium.glsl';

export const FULLSCREEN_VERTEX = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const TRANSMITTANCE_FRAGMENT = /* glsl */ `
${MEDIUM_GLSL}
uniform vec2 uSize;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float r, mu;
  transmittanceParams(vec2(fromSubUvToUnit(uv.x, uSize.x), fromSubUvToUnit(uv.y, uSize.y)), r, mu);
  vec3 ro = vec3(0.0, r, 0.0);
  vec3 rd = vec3(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0);
  float tMax = raySphere(ro, rd, ATMO_RT);
  vec3 depth = vec3(0.0);
  const int STEPS = 48;
  float dt = max(tMax, 0.0) / float(STEPS);
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (float(i) + 0.5) * dt;
    depth += sampleMedium(length(p) - ATMO_RG).ext * dt;
  }
  gl_FragColor = vec4(exp(-depth), 1.0);
}
`;

export const MULTI_SCATTERING_FRAGMENT = /* glsl */ `
#define USE_TRANSMITTANCE_LUT
${MEDIUM_GLSL}
uniform vec2 uSize;

void integrateDirection(vec3 ro, vec3 rd, vec3 lightDir, inout vec3 lum, inout vec3 fms) {
  float tBottom = raySphere(ro, rd, ATMO_RG);
  float tTop = raySphere(ro, rd, ATMO_RT);
  bool hitGround = tBottom > 0.0;
  float tMax = hitGround ? tBottom : max(tTop, 0.0);
  const int STEPS = 24;
  float dt = tMax / float(STEPS);
  vec3 T = vec3(1.0);
  vec3 L = vec3(0.0);
  vec3 F = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (float(i) + 0.5) * dt;
    float r = length(p);
    AtmoMedium m = sampleMedium(r - ATMO_RG);
    float muL = dot(p / r, lightDir);
    vec3 sca = m.scaR + m.scaM + m.scaH;
    vec3 ext = max(m.ext, vec3(1e-7));
    vec3 S = planetShadow(r, muL) * sampleTransmittance(r, muL) * sca * (1.0 / (4.0 * PI));
    vec3 Tstep = exp(-ext * dt);
    L += T * (S - S * Tstep) / ext;
    F += T * (sca - sca * Tstep) / ext;
    T *= Tstep;
  }
  if (hitGround) {
    vec3 p = ro + rd * tBottom;
    vec3 n = normalize(p);
    float muL = dot(n, lightDir);
    L += T * sampleTransmittance(ATMO_RG, muL) * max(muL, 0.0) * uGroundAlbedo / PI;
  }
  lum += L;
  fms += F;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float muL = fromSubUvToUnit(uv.x, uSize.x) * 2.0 - 1.0;
  float r = ATMO_RG + clamp(fromSubUvToUnit(uv.y, uSize.y), 0.0, 1.0) * (ATMO_RT - ATMO_RG);
  r = clamp(r, ATMO_RG + 0.01, ATMO_RT - 0.01);
  vec3 ro = vec3(0.0, r, 0.0);
  vec3 lightDir = normalize(vec3(sqrt(max(1.0 - muL * muL, 0.0)), muL, 0.0));
  vec3 lum = vec3(0.0);
  vec3 fms = vec3(0.0);
  const int SQRT_N = 8;
  for (int i = 0; i < SQRT_N; i++) {
    for (int j = 0; j < SQRT_N; j++) {
      float theta = 2.0 * PI * (float(i) + 0.5) / float(SQRT_N);
      float phi = acos(1.0 - 2.0 * (float(j) + 0.5) / float(SQRT_N));
      vec3 rd = vec3(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta));
      integrateDirection(ro, rd, lightDir, lum, fms);
    }
  }
  float invN = 1.0 / float(SQRT_N * SQRT_N);
  vec3 L2 = lum * invN;
  vec3 f = fms * invN;
  gl_FragColor = vec4(L2 / max(1.0 - f, vec3(1e-3)), 1.0);
}
`;

export const SKY_VIEW_FRAGMENT = /* glsl */ `
#define USE_TRANSMITTANCE_LUT
#define USE_MULTISCATTERING_LUT
${MEDIUM_GLSL}
uniform vec2 uSize;
uniform float uCamAltKm;
uniform vec3 uLightDirA;
uniform vec3 uLightIllumA;
uniform vec3 uLightDirB;
uniform vec3 uLightIllumB;
uniform vec4 uLightPollution;   // rgb flux, w = 1 / scale height (km)
uniform vec2 uCityOffsetKm;     // camera world x/z (km) relative to the world origin (city centre)
uniform vec3 uAirglow;

/*
 * Relative upward light flux of greater Istanbul below a point (world x/z in km, -z = north): the lit area spans
 * ~40 km east-west along both shores, the Black Sea coast lies ~17 km north, the open Marmara ~15 km south.
 */
float cityLightDensity(vec2 xz) {
  float r = length(xz * vec2(0.75, 1.0));
  float extent = 1.0 - 0.85 * smoothstep(20.0, 65.0, r);
  float blackSea = mix(0.22, 1.0, smoothstep(-27.0, -13.0, xz.y));
  float marmara = 1.0 - 0.45 * smoothstep(8.0, 26.0, xz.y);
  return extent * blackSea * marmara;
}

vec3 lightScattering(AtmoMedium m, float r, vec3 up, vec3 rd, vec3 lightDir, vec3 illum) {
  float muL = dot(up, lightDir);
  float c = dot(rd, lightDir);
  vec3 single = m.scaR * phaseRayleigh(c) + m.scaM * phaseCS(uMieParams.w, c) + m.scaH * phaseHaze(c);
  vec3 sca = m.scaR + m.scaM + m.scaH;
  return illum * (planetShadow(r, muL) * sampleTransmittance(r, muL) * single + sampleMultiScattering(r, muL) * sca);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float r0 = ATMO_RG + max(uCamAltKm, 0.001);
  float vHorizon = sqrt(max(r0 * r0 - ATMO_RG * ATMO_RG, 0.0));
  float beta = acos(clamp(vHorizon / r0, -1.0, 1.0));
  float zenithHorizon = PI - beta;
  float v = fromSubUvToUnit(uv.y, uSize.y);
  float viewZenith;
  if (v < 0.5) {
    float c = 1.0 - 2.0 * v;
    viewZenith = zenithHorizon * (1.0 - c * c);
  } else {
    float c = 2.0 * v - 1.0;
    viewZenith = zenithHorizon + beta * c * c;
  }
  float az = (uv.x - 0.5) * 2.0 * PI;
  float sz = sin(viewZenith);
  vec3 rd = vec3(sz * sin(az), cos(viewZenith), -sz * cos(az));
  vec3 ro = vec3(0.0, r0, 0.0);

  float tBottom = raySphere(ro, rd, ATMO_RG);
  float tTop = raySphere(ro, rd, ATMO_RT);
  bool hitGround = tBottom > 0.0;
  float tMax = hitGround ? tBottom : max(tTop, 0.0);

  const int STEPS = 44;
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  float tPrev = 0.0;
  bool useB = dot(uLightIllumB, vec3(1.0)) > 0.0;
  bool useLP = dot(uLightPollution.rgb, vec3(1.0)) > 0.0;
  for (int i = 0; i < STEPS; i++) {
    float x = (float(i) + 1.0) / float(STEPS);
    float t = tMax * x * x;
    float dt = t - tPrev;
    float ts = tPrev + dt * 0.5;
    tPrev = t;
    vec3 p = ro + rd * ts;
    float r = length(p);
    vec3 up = p / r;
    AtmoMedium m = sampleMedium(r - ATMO_RG);
    vec3 ext = max(m.ext, vec3(1e-7));
    vec3 S = lightScattering(m, r, up, rd, uLightDirA, uLightIllumA);
    if (useB) S += lightScattering(m, r, up, rd, uLightDirB, uLightIllumB);
    if (useLP) {
      float city = cityLightDensity(uCityOffsetKm + vec2(p.x, p.z));
      S += uLightPollution.rgb * (city * exp(-(r - ATMO_RG) * uLightPollution.w)) * (m.scaR + m.scaM + m.scaH) * (1.0 / (4.0 * PI));
    }
    vec3 Tstep = exp(-ext * dt);
    L += T * (S - S * Tstep) / ext;
    T *= Tstep;
  }
  if (!hitGround) {
    float s = r0 / (ATMO_RG + 90.0);
    float vanRhijn = 1.0 / sqrt(max(1.0 - s * s * (1.0 - rd.y * rd.y), 0.02));
    L += uAirglow * vanRhijn * T;
  }
  gl_FragColor = vec4(L, T.g);
}
`;
