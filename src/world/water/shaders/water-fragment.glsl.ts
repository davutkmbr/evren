import { SHARED_GLSL } from '../../../render/shaders';
import { BAND_COUNT, WATER_IOR } from '../config';
import { WATER_COMMON_GLSL } from './water-common.glsl';
import { WATER_SKY_GLSL } from './water-sky.glsl';

const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/**
 * Water surface shading (linear HDR radiance):
 * - normal = analytic Gerstner slopes + up to BAND_COUNT detail bands (advected by the surface current); components
 *   finer than the pixel footprint are faded out and their slope variance moves into the GGX roughness
 *   (Bruneton-style filtering), so glitter turns into a correctly broadened sun/moon path with distance
 * - exact dielectric Fresnel (n = 1.333), sky reflection via skyRadiance() or the planar reflection (looked up along
 *   the true reflected ray, anisotropically blurred by the unresolved roughness)
 * - water body from regional remote-sensing reflectance and attenuation, sea floor in shallow water
 * - whitecaps (Gerstner crest compression x wind), shore break/lapping foam, current slicks
 * - underside with Snell's window when the camera is below the surface
 */
export const WATER_FRAGMENT_GLSL = /* glsl */ `
#include <common>
#include <packing>
#include <shadowmap_pars_fragment>
${SHARED_GLSL}
${WATER_COMMON_GLSL}
${WATER_SKY_GLSL}

#ifndef WATER_BANDS
#define WATER_BANDS ${BAND_COUNT}
#endif
#define WATER_ETA ${f(WATER_IOR)}

uniform sampler2DArray uBands;
uniform vec4 uBandA[${BAND_COUNT}];   // xy = time coefficients * rms slope, z = 1/tile, w = mean square slope
uniform vec4 uBandB[${BAND_COUNT}];   // xy = tile offset of uOrigin, z = wavelength
uniform vec4 uFlowPhase;              // x, y = flow-map time of phase A/B (s), z, w = weights
uniform vec4 uFlowJump;               // per-cycle uv jumps of phase A/B (m)
uniform vec4 uSeaParams;              // U10, capillary mean square slope, whitecap threshold, whitecap strength
uniform vec4 uWindParams;             // downwind dir, gust drift (m)
uniform vec4 uFoamOffset;
uniform sampler2D uFoamTex;
uniform sampler2D uReflTex;
uniform sampler2D uReflDepth;
uniform mat4 uReflMatrix;
uniform mat4 uReflInvProj;
uniform vec4 uReflParams;             // x = planar on, y = distortion distance scale
uniform vec3 uRrs[5];
uniform vec3 uAtten[5];
uniform vec3 uFloorAlbedo[5];
uniform float uRoughness[5];

varying vec3 vWorld;
varying vec4 vLagr;

float badFloat(float x) {
  return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u ? 1.0 : 0.0;
}
float badFloat3(vec3 v) {
  return max(max(badFloat(v.x), badFloat(v.y)), badFloat(v.z));
}

vec2 projectRefl(vec3 p, out float w) {
  vec4 q = uReflMatrix * vec4(p, 1.0);
  w = q.w;
  return q.xy / max(q.w, 1e-4);
}

// Cubic B-spline reconstruction of the mirror at mip 0 (4 bilinear taps, GPU Gems 2 ch. 20). The mirror renders at a
// fraction of the screen resolution and calm water magnifies it 2-3x: bilinear magnification is only C0, so the texel
// grid shows as stair steps along every silhouette. The B-spline is C2 and never negative (no halos, no ringing on
// the premultiplied coverage).
vec4 mirrorBSpline(vec2 uv) {
  vec2 ts = vec2(textureSize(uReflTex, 0));
  vec2 st = uv * ts - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 p0 = (i - 0.5 + w1 / g0) / ts;
  vec2 p1 = (i + 1.5 + w3 / g1) / ts;
  return (textureLod(uReflTex, vec2(p0.x, p0.y), 0.0) * g0.x + textureLod(uReflTex, vec2(p1.x, p0.y), 0.0) * g1.x) * g0.y +
         (textureLod(uReflTex, vec2(p0.x, p1.y), 0.0) * g0.x + textureLod(uReflTex, vec2(p1.x, p1.y), 0.0) * g1.x) * g1.y;
}

// Mirror-space distance from the water point to what the flat mirror sees, bilinearly filtered by hand
// (float depth textures are not filterable; nearest reads make the normal distortion jump in texel blocks).
float reflDistanceAt(vec2 uv, vec3 waterPos) {
  vec2 ts = vec2(textureSize(uReflDepth, 0));
  vec2 st = uv * ts - 0.5;
  ivec2 i0 = ivec2(floor(st));
  vec2 f = fract(st);
  float camDist = length(uCamPos - waterPos);
  float acc = 0.0;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    ivec2 c = clamp(i0 + o, ivec2(0), ivec2(ts) - 1);
    float d = texelFetch(uReflDepth, c, 0).r;
    float dist = 6000.0;
    if (d > 0.0) {
      vec2 cuv = (vec2(c) + 0.5) / ts;
      vec4 vp = uReflInvProj * vec4(cuv * 2.0 - 1.0, d, 1.0);
      dist = clamp(length(vp.xyz / vp.w) - camDist, 2.0, 6000.0);
    }
    float wgt = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
    acc += log(dist) * wgt;
  }
  return exp(acc);
}


void main() {
  vec3 P = vWorld;
  vec2 xo = vLagr.xy;
  vec2 world0 = uOrigin + xo;
  vec2 guv = geoUV(world0);
  float coast = texture(uGeoCoast, guv).r;
  vec4 region = texture(uRegionTex, guv);
  vec4 flow = texture(uFlowTex, guv);
  float floorDepth = max(-texture(uGeoHeight, guv).r, 0.0);
  float offshore = -coast;
  float lake = lakeWeight(region);
  vec4 rw = region;
  float fetch = fetchExposure(flow);
  vec3 groups = waveGroupWeights(region, flow, coast);
  vec2 U = flow.xy;
  float flowMag = length(U);

  // Low-frequency roughness modulation: wind gust patches ("cat's paws") stretched downwind, glassy slicks,
  // calmer water in the lee of the shore.
  vec2 wd = uWindParams.xy;
  vec2 gp = world0 - uWindParams.zw;
  vec2 gq = vec2(dot(gp, wd), dot(gp, vec2(-wd.y, wd.x)));
  vec2 gustWarp = vec2(fbm2(gq * (1.0 / 1400.0) + vec2(3.1, 0.4), 2), fbm2(gq * (1.0 / 1400.0) + vec2(8.7, 5.2), 2)) - 0.5;
  float gust = fbm2(gq * vec2(1.0 / 640.0, 1.0 / 330.0) + gustWarp * 1.8, 3);
  float slick = fbm2(world0 * (1.0 / 1500.0) + vec2(7.3, 1.9), 2);
  float roughMul = dot(rw, vec4(uRoughness[0], uRoughness[1], uRoughness[2], uRoughness[3])) + lake * uRoughness[4];
  roughMul *= mix(0.7, 1.45, smoothstep(0.25, 0.75, gust));
  roughMul *= mix(0.45, 1.0, smoothstep(0.2, 0.3, slick));
  roughMul *= mix(0.6, 1.0, smoothstep(0.0, 160.0, offshore));
  // Fast current (Rumelihisari, Akintiburnu) and wind against it make the surface choppier.
  roughMul *= 1.0 + 0.3 * smoothstep(0.9, 2.6, flowMag);
  float r2 = roughMul * roughMul;

  // Pixel footprint in metres (anisotropy capped at 5:1 like the texture hardware).
  vec2 dX = dFdx(xo);
  vec2 dY = dFdy(xo);
  float fpA = length(dX);
  float fpB = length(dY);
  float fpMax = max(fpA, fpB);
  float fp = sqrt(fpMax * max(min(fpA, fpB), fpMax * 0.2));

  // Everything with implicit derivatives is sampled here, in uniform control flow.
  vec2 foamUvA = (xo - U * uFlowPhase.x) / 9.0 + uFoamOffset.xy;
  vec2 foamUvB = (xo - U * uFlowPhase.y) / 9.0 + uFoamOffset.xy + 0.37;
  vec4 foamTex = mix(texture(uFoamTex, foamUvA), texture(uFoamTex, foamUvB), uFlowPhase.w);
  float fineFoam = texture(uFoamTex, xo / 3.3 + uFoamOffset.zw).g;
  vec2 flowDir = flowMag > 1e-4 ? U / flowMag : vec2(0.0, 1.0);
  vec2 slickUv = vec2(dot(world0, flowDir) / 1500.0 - uTime * flowMag / 1500.0, dot(world0, vec2(flowDir.y, -flowDir.x)) / 120.0);
  float slickLines = texture(uFoamTex, slickUv).b;
  float wFlat;
  vec2 flatUv = projectRefl(vec3(P.x, 0.0, P.z), wFlat);
  vec2 flatDx = dFdx(flatUv);
  vec2 flatDy = dFdy(flatUv);
  float reflDepth = uReflParams.x > 0.5 ? texture(uReflDepth, flatUv).r : 0.0;

  // ---- Gerstner slopes (analytic) ----
  vec3 dPdx = vec3(1.0, 0.0, 0.0);
  vec3 dPdz = vec3(0.0, 0.0, 1.0);
  float lostVar = 0.0;
  float capTotal = 0.0;
  float capResolved = 0.0;
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 amp = uWaveAmp[i];
    if (amp.x <= 0.0) continue;
    vec4 dir = uWaveDir[i];
    float g = pickGroup(groups, amp.w);
    if (g <= 1e-4) continue;
    float wa = dir.z * amp.x * g;
    float fade = 1.0 - smoothstep(0.08, 0.3, fp / dir.w);
    lostVar += 0.5 * wa * wa * (1.0 - fade * fade);
    float breakingWave = amp.w < 1.5 ? wa * wa : 0.0;
    capTotal += breakingWave;
    capResolved += breakingWave * fade;
    if (fade <= 0.0) continue;
    wa *= fade;
    float q = amp.y * g * fade;
    float ph = dir.z * dot(dir.xy, xo) + amp.z;
    float s = sin(ph);
    float c = cos(ph);
    vec2 Dw = dir.xy;
    dPdx += vec3(-q * Dw.x * Dw.x * s, wa * Dw.x * c, -q * Dw.x * Dw.y * s);
    dPdz += vec3(-q * Dw.x * Dw.y * s, wa * Dw.y * c, -q * Dw.y * Dw.y * s);
  }
  vec3 nG = normalize(cross(dPdz, dPdx));
  float jacobian = dPdx.x * dPdz.z - dPdx.z * dPdz.x;
  vec2 slope = -nG.xz / max(nG.y, 0.25);

  // ---- Detail bands, advected by the surface current with a two-phase flow map ----
  float advect = smoothstep(0.002, 0.05, flowMag);
  vec2 offA = -U * uFlowPhase.x + uFlowJump.xy * advect;
  vec2 offB = -U * uFlowPhase.y + uFlowJump.zw * advect;
  float wA = uFlowPhase.z;
  float wB = uFlowPhase.w;
  // Blending two uncorrelated fields loses variance; renormalise (Heitz & Neyret) where they differ.
  float wNorm = mix(1.0 / (wA + wB), inversesqrt(wA * wA + wB * wB), advect);
  vec2 bandSlope = vec2(0.0);
  for (int b = 0; b < WATER_BANDS; b++) {
    vec4 A = uBandA[b];
    vec4 B = uBandB[b];
    float fade = 1.0 - smoothstep(0.14, 0.4, fp / B.z);
    lostVar += A.w * r2 * (1.0 - fade * fade);
    if (fade <= 0.0) continue;
    vec2 gdx = dX * A.z;
    vec2 gdy = dY * A.z;
    vec2 base = xo * A.z + B.xy;
    float layer = float(b);
    vec4 t;
    if (flowMag > 0.002) {
      vec4 ta = textureGrad(uBands, vec3(base + offA * A.z, layer), gdx, gdy);
      vec4 tb = textureGrad(uBands, vec3(base + offB * A.z, layer), gdx, gdy);
      t = (ta * wA + tb * wB) * wNorm;
    } else {
      t = textureGrad(uBands, vec3(base, layer), gdx, gdy);
    }
    bandSlope += vec2(dot(t.xy, A.xy), dot(t.zw, A.xy)) * fade;
  }
  bandSlope *= roughMul;
  slope += bandSlope;
  // Bands skipped by the quality setting count as unresolved roughness.
  for (int b = WATER_BANDS; b < ${BAND_COUNT}; b++) {
    lostVar += uBandA[b].w * r2;
  }

  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  float sigma2 = lostVar + uSeaParams.y * r2 + 0.0003;
  float alpha = clamp(sqrt(sigma2), 0.02, 0.65);

  vec3 toCam = uCamPos - P;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-4);
  vec3 L = uKeyLightDir;

  float shadow = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
    shadow = getSunShadow(sunShadowMap[0], sunLightShadows[0], 0);
  #endif
  vec3 keyE = keyLightAt(P) * (shadow * cloudShadow(P));
  vec3 Ed = keyE * max(L.y, 0.0) + uAmbient;

  vec3 rrs = rw.x * uRrs[0] + rw.y * uRrs[1] + rw.z * uRrs[2] + rw.w * uRrs[3] + lake * uRrs[4];
  vec3 atten = rw.x * uAtten[0] + rw.y * uAtten[1] + rw.z * uAtten[2] + rw.w * uAtten[3] + lake * uAtten[4];
  vec3 floorAlbedo = rw.x * uFloorAlbedo[0] + rw.y * uFloorAlbedo[1] + rw.z * uFloorAlbedo[2] + rw.w * uFloorAlbedo[3] + lake * uFloorAlbedo[4];

  if (!gl_FrontFacing && uCamPos.y < 0.6) {
    // Underside: Snell's window (refracted sky) inside ~48.6 deg, total internal reflection outside.
    float cosI = clamp(-dot(V, N), 0.0, 1.0);
    float Fu = fresnelDielectric(cosI, 1.0 / WATER_ETA);
    vec3 tDir = refract(-V, -N, WATER_ETA);
    vec3 scatterUp = rrs * Ed * 2.2 + uAmbient * 0.004;
    vec3 sky = vec3(0.0);
    if (dot(tDir, tDir) > 0.0) {
      tDir = normalize(tDir);
      sky = skyRadiance(vec3(tDir.x, max(tDir.y, 0.003), tDir.z));
      sky += keyE * pow(max(dot(tDir, L), 0.0), 900.0) * 300.0;
    }
    vec3 under = sky * (1.0 - Fu) + scatterUp * Fu;
    gl_FragColor = vec4(badFloat3(under) > 0.0 ? vec3(0.0) : min(under, vec3(6e4)), 1.0);
    return;
  }

  float NdV = dot(N, V);
  if (NdV < 0.03) {
    N = normalize(N + V * (0.03 - NdV));
    NdV = dot(N, V);
  }
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.0);
  R = normalize(R + vec3(0.0, 0.002, 0.0));

  // Rough water reflects less at grazing angles than the mean-normal Fresnel suggests.
  float fresnel = fresnelDielectric(min(1.0, NdV + alpha * 0.3 * (1.0 - NdV)), WATER_ETA);

  // ---- Reflection ----
  vec3 reflection = skyReflection(P, R, alpha * 1.4);
  if (uReflParams.x > 0.5) {
    // Distance from the water point to what the flat mirror sees there (reflection depth buffer), so the per-pixel
    // normal distortion streaks distant lights correctly without smearing nearby reflections (the dragon).
    float Dr = reflDistanceAt(flatUv, vec3(P.x, 0.0, P.z));
    float wq;
    vec2 ruv = projectRefl(P + R * Dr, wq);
    if (wq > 1e-3) {
      float wu;
      vec2 upUv = projectRefl(P + R * Dr + vec3(0.0, Dr * 0.05, 0.0), wu) - ruv;
      float cone = 2.0 * alpha;
      vec2 gUp = upUv * (cone / 0.05);
      vec2 gSide = vec2(-upUv.y, upUv.x) * (cone / 0.05) * mix(0.35, 1.0, clamp(V.y * 2.0, 0.0, 1.0));
      // Premultiplied by geometry coverage (see reflection.ts): filtered with the same footprint as the colour, so
      // silhouettes against the sky stay smooth at any mip level.
      vec2 gx = flatDx + gSide;
      vec2 gy = flatDy + gUp;
      // Footprint in mirror texels: magnified (< 1) -> cubic reconstruction, minified -> mips + anisotropic filtering.
      vec2 rts = vec2(textureSize(uReflTex, 0));
      float texels = max(length(gx * rts), length(gy * rts));
      float cubic = 1.0 - smoothstep(0.9, 1.6, texels);
      vec4 mirror = cubic < 1.0 ? textureGrad(uReflTex, ruv, gx, gy) : vec4(0.0);
      if (cubic > 0.0) {
        mirror = mix(mirror, mirrorBSpline(ruv), cubic);
      }
      // Bit-level test: fast-math GPU compilers fold x != x away, and one non-finite texel would spread through the mips.
      bool badMirror = badFloat3(mirror.rgb) + badFloat(mirror.a) > 0.0;
      float cover = badMirror ? 0.0 : clamp(mirror.a, 0.0, 1.0);
      // Sky seen in the mirror comes from skyReflection() (no sun/moon disks: the GGX glitter below reflects those).
      vec3 planar = (badMirror ? vec3(0.0) : clamp(mirror.rgb, vec3(0.0), vec3(1e4))) + reflection * (1.0 - cover);
      float lum = max(max(planar.r, planar.g), planar.b);
      planar *= lum > 60.0 ? (60.0 + 10.0 * log(lum / 60.0)) / lum : 1.0;
      vec2 e = smoothstep(vec2(0.0), vec2(0.035), ruv) * smoothstep(vec2(1.0), vec2(0.965), ruv);
      reflection = mix(reflection, planar, e.x * e.y);
    }
  }

  // ---- Key light (sun by day, moon by night): GGX glitter ----
  vec3 specular = vec3(0.0);
  float NdL = dot(N, L);
  if (NdL > 0.0 && L.y > -0.03) {
    vec3 H = normalize(L + V);
    float NdH = max(dot(N, H), 0.0);
    float VdH = max(dot(V, H), 0.0);
    float a2 = alpha * alpha;
    float dd = NdH * NdH * (a2 - 1.0) + 1.0;
    float Dggx = a2 / (PI * dd * dd);
    float visL = NdV * sqrt(NdL * NdL * (1.0 - a2) + a2);
    float visV = NdL * sqrt(NdV * NdV * (1.0 - a2) + a2);
    float Vis = 0.5 / max(visL + visV, 1e-5);
    float Fh = fresnelDielectric(VdH, WATER_ETA);
    specular = min(keyE * (Dggx * Vis * Fh * NdL), vec3(30000.0));
  }

  // ---- Water body + shallow sea floor ----
  float cosT = sqrt(max(1.0 - (1.0 - NdV * NdV) / (WATER_ETA * WATER_ETA), 0.05));
  float column = max(floorDepth + vLagr.z, 0.0);
  vec3 Tfloor = exp(-atten * column * (1.0 + 1.0 / cosT));
  float ripple = fbm2(world0 * 0.35, 3);
  vec3 floorL = floorAlbedo * (0.7 + 0.6 * ripple) * (0.5 / PI);
  vec3 body = (rrs * (1.0 - Tfloor) + floorL * Tfloor) * Ed;
  body *= (1.0 - fresnel) / 0.98;

  // Light transmitted through thin wave crests toward a low sun (teal glow on the lee side of crests).
  float crest = clamp(vLagr.z * 3.0, 0.0, 1.0) * groups.x;
  float backLit = pow(clamp(dot(-V, L), 0.0, 1.0), 4.0) * (1.0 - clamp(L.y * 2.5, 0.0, 1.0));
  body += keyE * rrs * (crest * backLit * 14.0);

  vec3 color = reflection * fresnel + specular + body;

  // ---- Foam ----
  float breakup = foamTex.a;
  // Whitecaps (Monahan coverage ~ U^3.4: none below ~4 m/s, a few % in a 12 m/s poyraz), gusty patches only.
  float capMask = smoothstep(0.35, 0.8, gust + breakup * 0.4) * (groups.x + groups.y) * 0.8 * uSeaParams.w;
  // Where the wind sea is resolved, caps sit on strongly compressed Gerstner crests; further out the waves are
  // filtered away, so drifting, evolving crest-shaped patches (elongated crosswind) keep the same coverage.
  float capJ = smoothstep(uSeaParams.z, uSeaParams.z - 0.22, jacobian);
  vec2 capP = gq * vec2(1.0 / 6.5, 1.0 / 12.0);
  float capNoise = vnoise3(vec3(capP, uTime * 0.16)) * 0.62 + vnoise3(vec3(capP * 2.7 + 5.3, uTime * 0.37)) * 0.38;
  float capThreshold = mix(0.9, 0.72, uSeaParams.w);
  float capN = smoothstep(capThreshold, capThreshold + 0.05, capNoise);
  float capRes = capTotal > 1e-8 ? capResolved / capTotal : 1.0;
  float farBlend = smoothstep(1.5, 6.0, fp);
  float capFoam = mix(capN, capJ, capRes) * capMask * clamp(foamTex.r * 1.6 + fineFoam * 0.5, 0.0, 1.0) * (1.0 - farBlend);
  // Sub-pixel whitecaps brighten the sea statistically.
  float farCaps = uSeaParams.w * uSeaParams.w * 0.05 * (groups.x + groups.y) * farBlend;

  // Shore: surf only on gently shelving, exposed beaches (Kilyos, Florya, Caddebostan...); quays and rocky banks get a
  // thin lapping line. Bed slope from the geo depth: beaches ~1:30, Bosphorus quays drop 10+ m within 30 m.
  float bedSlope = floorDepth / max(offshore, 6.0);
  float beach = (1.0 - smoothstep(0.035, 0.09, bedSlope)) * smoothstep(0.3, 0.6, fetch) * (1.0 - lake) * (1.0 - rw.w);
  float surfNoise = fbm2(world0 * (1.0 / 38.0), 2);
  float bandPhase = fract(offshore / (11.0 + 5.0 * surfNoise) + uTime * 0.105 + surfNoise * 1.7);
  float breaker = smoothstep(0.0, 0.08, bandPhase) * (1.0 - smoothstep(0.08, 0.5, bandPhase));
  breaker *= smoothstep(0.3, 0.6, surfNoise + breakup * 0.3) * (1.0 - smoothstep(8.0, 60.0, offshore)) * beach;
  float lapWidth = 0.8 + 1.6 * breakup + 5.0 * beach;
  float lap = (1.0 - smoothstep(0.0, lapWidth, offshore)) * smoothstep(-2.5, 0.0, offshore);
  float shoreFoam = clamp(breaker * 0.9 + lap * mix(0.55, 1.0, beach), 0.0, 1.0) * clamp(foamTex.r * 1.5 + fineFoam * 0.6, 0.0, 1.0);

  // Current slicks: foam lines drawn out along the Bosphorus current.
  float slicks = smoothstep(0.6, 0.95, slickLines) * smoothstep(0.8, 2.2, flowMag) * smoothstep(0.62, 0.9, breakup + gust * 0.3);
  slicks *= 0.3 * clamp(foamTex.r * 1.4 + fineFoam * 0.4, 0.0, 1.0) * (1.0 - smoothstep(0.4, 2.0, fp));

  float foam = clamp(capFoam + shoreFoam + slicks, 0.0, 1.0);
  vec3 foamL = vec3(0.78, 0.8, 0.8) * (1.0 / PI) * Ed;
  color = mix(color, foamL + specular * 0.05, foam);
  color += vec3(0.7) * (1.0 / PI) * Ed * farCaps;

  #if defined( WATER_DEBUG ) && WATER_DEBUG > 0
    #if WATER_DEBUG == 1
      color = (rw.r * vec3(0.1, 0.2, 1.0) + rw.g * vec3(0.1, 0.9, 0.9) + rw.b * vec3(0.1, 0.9, 0.1) + rw.a * vec3(0.9, 0.5, 0.1) + lake * vec3(0.9, 0.1, 0.9)) * 0.5;
    #elif WATER_DEBUG == 2
      color = vec3(0.5 + 0.25 * U.x, 0.5 + 0.25 * U.y, flowMag / 3.0) * 0.5;
    #elif WATER_DEBUG == 3
      color = vec3(fract(floorDepth / 10.0), clamp(floorDepth / 100.0, 0.0, 1.0), clamp(offshore / 3000.0, 0.0, 1.0)) * 0.5;
    #elif WATER_DEBUG == 4
      color = vec3(roughMul * 0.25, alpha, groups.x * 0.5) * 0.5;
    #elif WATER_DEBUG == 5
      color = vec3(fetch, beach, shoreFoam) * 0.5;
    #elif WATER_DEBUG == 6
      vec3 finalProbe = applyAtmosphere(color, P);
      color = vec3(badFloat3(reflection), badFloat3(specular), badFloat3(body)) + vec3(badFloat(foam)) * vec3(1.0, 0.0, 1.0) + vec3(badFloat3(color), badFloat3(finalProbe), 0.0) * 0.5;
      color = dot(color, vec3(1.0)) > 0.0 ? color : vec3(0.02);
    #endif
    gl_FragColor = vec4(color, 1.0);
  #else
    vec3 radiance = applyAtmosphere(color, P);
    // A single non-finite pixel would poison auto exposure and bloom for the rest of the session.
    gl_FragColor = vec4(badFloat3(radiance) > 0.0 ? vec3(0.0) : min(radiance, vec3(6e4)), 1.0);
  #endif
}
`;
