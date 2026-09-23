import { BASE_NOISE_SIZE, CLOUD_CONSTANTS as C, DETAIL_NOISE_SIZE, WEATHER_SIZE } from '../config';

/** Float literal for GLSL. */
export function glslFloat(n: number): string {
  const s = String(n);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

/**
 * Cloud field definition shared by the raymarcher, the shadow-map baker and the light march.
 * Must be prepended AFTER SHARED_GLSL. Density is dimensionless [0,1]; extinction = density * uCloudShape.y.
 */
export const CLOUD_COMMON_GLSL = /* glsl */ `
#define CLOUD_R ${glslFloat(C.planetRadius)}
#define CLOUD_INV_R ${glslFloat(1 / C.planetRadius)}
#define CLOUD_INV_2R ${glslFloat(0.5 / C.planetRadius)}
#define CLOUD_BOTTOM ${glslFloat(C.layerBottom)}
#define CLOUD_TOP ${glslFloat(C.layerTop)}
#define CLOUD_CU_BASE_VAR ${glslFloat(C.cumulusBaseVariation)}
#define CLOUD_CU_THICK_MIN ${glslFloat(C.cumulusThicknessMin)}
#define CLOUD_CU_THICK_MAX ${glslFloat(C.cumulusThicknessMax)}
#define CLOUD_SC_BASE ${glslFloat(C.stratoBase)}
#define CLOUD_SC_THICK ${glslFloat(C.stratoThickness)}
#define CLOUD_CIRRUS_H ${glslFloat(C.cirrusHeight)}
#define CLOUD_INV_WEATHER ${glslFloat(1 / C.weatherPeriod)}
#define CLOUD_INV_BASE ${glslFloat(1 / C.baseNoisePeriod)}
#define CLOUD_INV_DETAIL ${glslFloat(1 / C.detailNoisePeriod)}
#define CLOUD_INV_CIRRUS ${glslFloat(1 / C.cirrusPeriod)}
#define CLOUD_REGIONAL_SCALE 0.371
#define CLOUD_WEATHER_SIZE ${glslFloat(WEATHER_SIZE)}
#define CLOUD_WEATHER_TEXEL ${glslFloat(C.weatherPeriod / WEATHER_SIZE)}
#define CLOUD_BASE_TEXEL ${glslFloat(C.baseNoisePeriod / BASE_NOISE_SIZE)}
#define CLOUD_DETAIL_TEXEL ${glslFloat(C.detailNoisePeriod / DETAIL_NOISE_SIZE)}
#define CLOUD_PUSH_MAX 0.85
#define CLOUD_W_MEAN 0.725
#define CLOUD_W_ZSCALE 8.3
#define CLOUD_DETAIL_MAX 0.34

uniform sampler2D uCloudWeather;
uniform highp sampler3D uCloudBaseNoise;
uniform highp sampler3D uCloudDetailNoise;
uniform sampler2D uCloudCirrus;
uniform sampler2D uCloudGlow;
/* xy: weather/noise horizontal offset (m, wrapped), z: base noise vertical evolution (m), w: detail evolution (m). */
uniform vec4 uCloudWind;
/* xy: regional-lookup offset (m), zw: cirrus offset (m). */
uniform vec4 uCloudWind2;
/* x: coverage bias, y: extinction 1/m, z: detail erosion, w: cumulus base mean (m). */
uniform vec4 uCloudShape;
uniform vec3 uCloudLightDir;
uniform vec3 uCloudLightColor;
/* Multiplier on the sky ambient; ground-bounce radiance added at cloud bases. */
uniform vec3 uCloudAmbientTop;
uniform vec3 uCloudAmbientBottom;
uniform vec3 uCloudGlowColor;
/* x: altitude of the Earth's shadow (m) for the key light (fallback path), y: unused, z: cirrus coverage,
   w: key-light gain standing in for the multiple scattering the octave model under-estimates. */
uniform vec4 uCloudMisc;
/* Shape tuning multipliers (x: lobe amplitude, y: large billow amplitude, z: base ambient, w: floret amplitude). */
uniform vec4 uCloudTune;

/* Altitude above a spherical Earth (paraboloid approximation, centre at (0,-R,0)). */
float cloudAltitude(vec3 p) {
  return p.y + dot(p.xz, p.xz) * CLOUD_INV_2R;
}

/* Ray vs iso-altitude shell H. Returns false when there is no intersection. */
bool cloudShell(vec3 ro, vec3 rd, float H, out float t0, out float t1) {
  float a = dot(rd.xz, rd.xz) * CLOUD_INV_2R;
  float b = rd.y + dot(ro.xz, rd.xz) * CLOUD_INV_R;
  float c = cloudAltitude(ro) - H;
  t0 = -1.0;
  t1 = -1.0;
  if (a < 1e-13) {
    if (abs(b) < 1e-9) return false;
    t0 = -c / b;
    t1 = t0;
    return true;
  }
  float disc = b * b - 4.0 * a * c;
  if (disc < 0.0) return false;
  float sq = sqrt(disc);
  float q = -0.5 * (b + (b >= 0.0 ? sq : -sq));
  float r0 = q / a;
  float r1 = abs(q) > 1e-12 ? c / q : r0;
  t0 = min(r0, r1);
  t1 = max(r0, r1);
  return true;
}

/* Parametric interval of the ray inside [bottom, top]; clipped to tLimit. */
bool cloudLayerInterval(vec3 ro, vec3 rd, float bottom, float top, float tLimit, out float tMin, out float tMax) {
  float alt = cloudAltitude(ro);
  float b0, b1, u0, u1;
  bool hb = cloudShell(ro, rd, bottom, b0, b1);
  bool ht = cloudShell(ro, rd, top, u0, u1);
  tMin = 0.0;
  tMax = tLimit;
  if (alt < bottom) {
    if (!hb || b1 <= 0.0) return false;
    tMin = b1;
    tMax = (ht && u1 > 0.0) ? u1 : tLimit;
  } else if (alt < top) {
    tMin = 0.0;
    tMax = (ht && u1 > 0.0) ? u1 : tLimit;
    if (hb && b0 > 0.0) tMax = min(tMax, b0);
  } else {
    if (!ht || u0 <= 0.0) return false;
    tMin = u0;
    tMax = u1;
    if (hb && b0 > 0.0) tMax = min(tMax, b0);
  }
  tMax = min(tMax, tLimit);
  return tMax > tMin;
}

float cloudLod(float footprint, float texel) {
  return max(log2(max(footprint, 1.0) / texel), 0.0);
}

/* Weather map lookup. For primary (view-ray) samples a cubic B-spline from 4 trilinear taps on the grid of the
   selected mip: bilinear interpolation would make cloud outlines polygonal (straight-edged flat bases far away) and
   walls would extrude those facets into vertical streaks. The light march and shadow bake use plain lookups. */
bool gCloudCubicWeather = true;

vec4 cloudWeather(vec2 xz, float footprint, bool cubicAllowed) {
  float lod = cloudLod(footprint, CLOUD_WEATHER_TEXEL);
  vec2 uv = xz * CLOUD_INV_WEATHER;
#ifdef CLOUD_DEBUG_NOCUBIC
  cubicAllowed = false;
#endif
  /* Light march (gCloudCubicWeather false): stay near the base level, coarse mips would cast straight-edged
     shadows from polygonal occluders. */
  if (!cubicAllowed) return textureLod(uCloudWeather, uv, gCloudCubicWeather ? lod : min(lod, 0.5));
  float size = CLOUD_WEATHER_SIZE * exp2(-floor(lod));
  vec2 pos = uv * size - 0.5;
  vec2 i = floor(pos);
  vec2 f = pos - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 1.0 + w1 / g0 + 0.5) / size;
  vec2 h1 = (i + 1.0 + w3 / g1 + 0.5) / size;
  return (textureLod(uCloudWeather, h0, lod) * g0.x + textureLod(uCloudWeather, vec2(h1.x, h0.y), lod) * g1.x) * g0.y
       + (textureLod(uCloudWeather, vec2(h0.x, h1.y), lod) * g0.x + textureLod(uCloudWeather, h1, lod) * g1.x) * g1.y;
}

/* Regional instability z-score at p (very low frequency: callers may reuse it over a few km). */
float cloudRegional(vec2 xz) {
  vec2 rq = mat2(0.8, -0.6, 0.6, 0.8) * ((xz - uCloudWind2.xy) * (CLOUD_INV_WEATHER * CLOUD_REGIONAL_SCALE)) + vec2(0.31, 0.77);
  return (textureLod(uCloudWeather, rq, 0.0).a - 0.5) * 10.0 + uCloudShape.x * 4.0;
}

/*
 * Density at p (alt = cloudAltitude(p)). footprint = pixel footprint in meters (for mip selection).
 * detail: 0 = cheap (shape only), 1 = full detail. near.x: 0..1 weight of the close-range puffs (flying through),
 * near.y: 0..1 their contrast (0 = the puffs' mean density, used in the first metres so the rider is not sprinkled).
 * reg < -90 means "not known yet": it is fetched lazily (only near clouds) and written back for reuse.
 * hFrac returns the relative height inside the local cloud (0 base .. 1 top) for ambient lighting.
 *
 * Cumulus = weather-map footprint (1 - r^2 per cloud) extruded as walls from a flat condensation base to
 * ~25 % of the local thickness, capped by a dome whose height grows with coverage (cores tower over the flanks).
 * Worley lobes (inverted cellular noise = convex bulges) displace the surface, strongest at the top (cauliflower
 * turrets) and weakest at the base, where the erosion is wispy instead.
 */
/* Side output of the last cloudDensityR() call with near.x > 0: multiplier on the in-scattered light that makes the
   fog around the camera read as distinct lighter and darker wisps (1 elsewhere). */
float gCloudNearShade = 1.0;

float cloudDensityR(vec3 p, float alt, float footprint, float detail, vec2 near, inout float reg, out float hFrac) {
  hFrac = 0.5;
  gCloudNearShade = 1.0;
  if (alt < CLOUD_BOTTOM || alt > CLOUD_TOP) return 0.0;
  vec2 wxz = p.xz - uCloudWind.xy;
  vec4 w = cloudWeather(wxz, footprint, gCloudCubicWeather && detail > 0.0);
  if (w.r + w.b < 0.003) return 0.0;
  if (reg < -90.0) reg = cloudRegional(p.xz);
  float cu = w.r * smoothstep(-1.6, 0.9, reg);
  float sc = w.b * smoothstep(-0.8, 1.2, reg);

  float baseH = uCloudShape.w + clamp(reg, -2.0, 2.0) * CLOUD_CU_BASE_VAR * 0.25;
  float thick = mix(CLOUD_CU_THICK_MIN, CLOUD_CU_THICK_MAX, w.g) * mix(0.8, 1.1, smoothstep(-1.0, 1.5, reg));
  float h = (alt - baseH) / thick;
  float hd = max(h - 0.25, 0.0) * (1.0 / 0.75);
  float cuShape = (h > -0.1 && h < 1.3) ? cu - hd * hd : -1.0;
  /* Noise may push the surface outward only inside the weather envelope (fades to 0 where cu -> 0). */
  float envelope = clamp(cu * 5.0, 0.0, 1.0);

  float hs = (alt - CLOUD_SC_BASE - clamp(reg, -2.0, 2.0) * 40.0) / CLOUD_SC_THICK;
  float scShape = (hs > 0.0 && hs < 1.0) ? sc - abs(hs - 0.45) * 1.5 : -1.0;
  float scEnvelope = clamp(sc * 5.0, 0.0, 1.0);
  if (cuShape + CLOUD_PUSH_MAX * envelope <= 0.0 && scShape + 0.6 * scEnvelope <= 0.0) return 0.0;

  vec3 np = vec3(wxz.x, alt - uCloudWind.z, wxz.y) * CLOUD_INV_BASE;
  vec4 n = textureLod(uCloudBaseNoise, np, cloudLod(footprint, CLOUD_BASE_TEXEL));
  /* z-scores of the baked statistics (billow 0.746 +- 0.076, rounded Worley fbm 0.725 +- 0.12). */
  float zBig = (n.r - 0.746) * 13.2;
  vec3 zw = (n.gba - CLOUD_W_MEAN) * CLOUD_W_ZSCALE;
  float lobe = zw.y * 0.55 + zw.z * 0.45;

  float hc = clamp(h, 0.0, 1.0);
  /* Lobe amplitude comparable to the profile itself: the silhouette is a union of rounded Worley bulges. */
  float push = zBig * 0.1 * uCloudTune.y + lobe * mix(0.4, 0.5, smoothstep(0.05, 0.7, hc)) * uCloudTune.x - 0.08;
  /* Erosion bites deep at the rim but only shallowly inside (cu > ~0.5), so noise sculpts the outline without
     punching tunnels through a cloud's body. */
  float s = cuShape + clamp(push, -(0.25 + 0.6 * (1.0 - cu)), CLOUD_PUSH_MAX) * envelope;
  float ssc = scShape + clamp(zw.z * 0.2 + zw.y * 0.1 - 0.04, -0.6, 0.38) * scEnvelope;
  hFrac = hc;
  if (s < -CLOUD_DETAIL_MAX * envelope && ssc < -0.2 * scEnvelope) return 0.0;

  /* Florets (64-256 m Worley cells) on the upper surfaces, soft wispy erosion near the base. */
  float nearMod = 1.0;
  if (detail > 0.0) {
    vec3 dp = vec3(wxz.x, alt - uCloudWind.w, wxz.y) * CLOUD_INV_DETAIL + (n.gba - 0.5) * 0.15;
    vec3 dn = textureLod(uCloudDetailNoise, dp, cloudLod(footprint, CLOUD_DETAIL_TEXEL)).rgb;
    float floret = (dn.r * 0.3 + dn.g * 0.42 + dn.b * 0.28 - CLOUD_W_MEAN) * 8.0;
    float wisp = clamp((dn.g * 0.6 + dn.b * 0.4 - CLOUD_W_MEAN) * 4.0 + 0.5, 0.0, 1.0);
    if (near.x > 0.0) {
      /* Close to the camera: 4-32 m puffs with real gaps (mean ~0.55, i.e. ~60-120 m visibility like real cumulus)
         so flying through shows many wisps rushing past instead of a uniform whiteout. */
      vec3 dn2 = textureLod(uCloudDetailNoise, dp * 8.0 + dn * 0.4, 0.0).rgb;
      float puff = dn2.r * 0.55 + dn2.g * 0.45;
      float puffDensity = mix(0.62, smoothstep(CLOUD_W_MEAN - 0.06, CLOUD_W_MEAN + 0.1, puff) * 1.25 + 0.04, near.y);
      nearMod = mix(1.0, puffDensity, near.x);
      floret += (puff - CLOUD_W_MEAN) * 4.0 * near.x * near.y;
      gCloudNearShade = clamp(1.0 + ((dn.r - CLOUD_W_MEAN) * 0.2 + (puff - CLOUD_W_MEAN) * 0.16 * near.y) * CLOUD_W_ZSCALE * near.x, 0.55, 1.45);
    }
    float amp = uCloudShape.z * detail;
    float top = smoothstep(0.02, 0.16, hc);
    s += clamp(mix(-wisp * 0.12, floret * 0.16 * uCloudTune.w, top), -CLOUD_DETAIL_MAX, CLOUD_DETAIL_MAX) * amp * envelope;
    ssc += clamp(floret * 0.05 - wisp * 0.06, -0.2, 0.2) * amp * scEnvelope;
  }
  float d = 0.0;
  if (s > 0.0) {
    /* Flat condensation base, undulating by a few tens of metres so it never renders as a perfect plane. */
    float hb = alt - baseH + (zBig * 0.6 + zw.z * 0.4) * 14.0;
    float inner = clamp(0.62 + lobe * 0.22 + zBig * 0.08, 0.25, 1.0);
    d = smoothstep(0.0, 0.03, s) * smoothstep(0.0, 22.0, hb) * inner * nearMod;
  }
  if (ssc > 0.0) {
    float dsc = smoothstep(0.0, 0.14, ssc) * smoothstep(0.0, 0.12, hs) * smoothstep(1.0, 0.7, hs) * 0.6 * nearMod;
    if (dsc > d) {
      d = dsc;
      hFrac = clamp(hs, 0.0, 1.0);
    }
  }
  return d;
}

/* Conservative, cheap (one weather fetch) test: can any cloud exist at p once noise is added? Used by the coarse
   empty-space march so small distant clouds are never stepped over. */
bool cloudMayExist(vec3 p, float alt, float footprint, inout float reg) {
  if (alt < CLOUD_BOTTOM || alt > CLOUD_TOP) return false;
  vec2 wxz = p.xz - uCloudWind.xy;
  vec4 w = cloudWeather(wxz, footprint, false);
  if (w.r + w.b < 0.003) return false;
  if (reg < -90.0) reg = cloudRegional(p.xz);
  float cu = w.r * smoothstep(-1.6, 0.9, reg);
  float sc = w.b * smoothstep(-0.8, 1.2, reg);
  float baseH = uCloudShape.w + clamp(reg, -2.0, 2.0) * CLOUD_CU_BASE_VAR * 0.25;
  float thick = mix(CLOUD_CU_THICK_MIN, CLOUD_CU_THICK_MAX, w.g) * mix(0.8, 1.1, smoothstep(-1.0, 1.5, reg));
  float h = (alt - baseH) / thick;
  float hd = max(h - 0.25, 0.0) * (1.0 / 0.75);
  float cuShape = (h > -0.1 && h < 1.3) ? cu - hd * hd : -1.0;
  float hs = (alt - CLOUD_SC_BASE - clamp(reg, -2.0, 2.0) * 40.0) / CLOUD_SC_THICK;
  float scShape = (hs > 0.0 && hs < 1.0) ? sc - abs(hs - 0.45) * 1.5 : -1.0;
  return cuShape + CLOUD_PUSH_MAX * clamp(cu * 5.0, 0.0, 1.0) > 0.0 || scShape + 0.6 * clamp(sc * 5.0, 0.0, 1.0) > 0.0;
}

float cloudDensity(vec3 p, float alt, float footprint, float detail, vec2 near, out float hFrac) {
  float reg = -100.0;
  return cloudDensityR(p, alt, footprint, detail, near, reg, hFrac);
}

float cloudHG(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566371 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

/* Dual-lobe Henyey-Greenstein, anisotropy scaled per multi-scattering octave. */
float cloudPhase(float c, float k) {
  return mix(cloudHG(c, 0.82 * k), cloudHG(c, -0.28 * k), 0.28) + 0.035 * cloudHG(c, 0.97 * k);
}

/* Optical depth (in density*m) toward the key light; the first detailSteps samples include the florets so
   small bulges shadow each other, the rest use the cheap shape density. */
float cloudLightDepthFrom(vec3 p, int first, int steps, int detailSteps, float jitter, float regIn) {
  float reg = regIn;
  float od = 0.0;
  float len = 26.0;
  float t = len * jitter * 0.5;
  gCloudCubicWeather = false;
  for (int i = 0; i < 7; i++) {
    if (i >= steps) break;
    if (i < first) {
      t += len;
      len *= 2.1;
      continue;
    }
    /* The last segment is doubled so few steps still reach the top of towering clouds (dark bases). */
    float seg = i == steps - 1 ? len * 2.0 : len;
    vec3 q = p + uCloudLightDir * (t + seg * 0.5);
    float alt = cloudAltitude(q);
    if (alt > CLOUD_TOP) break;
    float hf;
    od += cloudDensityR(q, alt, seg * 0.5, i < detailSteps ? 1.0 : 0.0, vec2(0.0), reg, hf) * seg;
    t += len;
    len *= 2.1;
  }
  gCloudCubicWeather = true;
  return od;
}

float cloudLightDepth(vec3 p, int steps, int detailSteps, float jitter, float regIn) {
  return cloudLightDepthFrom(p, 0, steps, detailSteps, jitter, regIn);
}

/* Fraction of the key light reaching altitude alt (Earth's shadow at twilight). */
float cloudEarthShadow(float alt, float shadowAlt) {
  return clamp((alt - shadowAlt) / 260.0 + 0.5, 0.0, 1.0);
}

/* Key light irradiance at a cloud sample: the sky's altitude-dependent key light when available. */
vec3 cloudKeyLight(vec3 p, float alt) {
#ifdef ATMO_KEYLIGHT_TINT
  if (uAtmoState.y > 0.5) return keyLightAt(vec3(p.x, alt, p.z)) * uCloudMisc.w;
#endif
  return uCloudLightColor * (uCloudMisc.w * cloudEarthShadow(alt, uCloudMisc.x));
}

/* In-scattered key light (multi-scattering octaves + powder); keyLight = cloudKeyLight(). */
vec3 cloudSunLight(vec3 keyLight, float lightOD, float cosT, float sigma) {
  float ext = lightOD * uCloudShape.y;
  float s = 0.0;
  float a = 1.0;
  float b = 1.0;
  float k = 1.0;
  for (int i = 0; i < 4; i++) {
    s += b * cloudPhase(cosT, k) * exp(-ext * a);
    a *= 0.35;
    b *= 0.75;
    k *= 0.5;
  }
  float powder = 1.0 - exp(-sigma * 55.0);
  s *= mix(1.0, powder, 0.65 * clamp(0.6 - 0.6 * cosT, 0.0, 1.0));
  return keyLight * s;
}

/* Isotropic sky light seen by the cloud (average of the upper hemisphere), evaluated once per pixel. */
vec3 cloudSkyAmbient() {
  vec3 side = normalize(vec3(uCloudLightDir.x, 0.0, uCloudLightDir.z) + vec3(1e-4, 0.0, 0.0));
  vec3 z = skyRadiance(vec3(0.0, 1.0, 0.0));
  vec3 a = skyRadiance(normalize(side + vec3(0.0, 0.45, 0.0)));
  vec3 b = skyRadiance(normalize(-side + vec3(0.0, 0.45, 0.0)));
  vec3 c = skyRadiance(normalize(vec3(-side.z, 0.45, side.x)));
  return z * 0.4 + (a + b + c) * 0.2;
}

vec3 cloudAmbientLight(vec3 p, float hFrac, vec3 skyAmb) {
  float h = smoothstep(0.0, 1.0, hFrac);
  vec3 amb = (skyAmb * mix(0.13 * uCloudTune.z, 0.62, h) + uCloudAmbientBottom * (1.0 - h)) * uCloudAmbientTop;
  if (uCloudGlowColor.r > 0.0) {
    float glow = textureLod(uCloudGlow, p.xz * ${glslFloat(1 / 64000)} + 0.5, 0.0).r;
    amb += uCloudGlowColor * (glow * (1.0 - hFrac) * (1.0 - hFrac));
  }
  return amb;
}

/* Cirrus sheet: returns opacity; rgb radiance written to col (before aerial perspective). */
/* footprint: width (m) of the pixel cone where the ray meets the cirrus shell. */
float cloudCirrus(vec3 pc, vec3 rd, float cosT, vec3 skyAmb, float footprint, out vec3 col) {
  col = vec3(0.0);
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  vec2 q = rot * (pc.xz - uCloudWind2.zw) * CLOUD_INV_CIRRUS;
  /* Explicit filter footprint: this runs in divergent control flow, where implicit derivatives are undefined (random
     mip levels = a speckled band of cirrus along the horizon, most visible when it is lit at twilight). The pixel cone
     is stretched by 1 / |rd.y| along the ray's horizontal direction on the (flat) cirrus shell. */
  vec2 hdir = dot(rd.xz, rd.xz) > 1e-8 ? normalize(rd.xz) : vec2(1.0, 0.0);
  vec2 gAlong = rot * (hdir * (footprint / max(abs(rd.y), 0.02))) * CLOUD_INV_CIRRUS;
  vec2 gSide = rot * (vec2(-hdir.y, hdir.x) * footprint) * CLOUD_INV_CIRRUS;
  vec2 c = textureGrad(uCloudCirrus, q, gAlong, gSide).rg;
  float dens = c.r * uCloudMisc.z;
  if (dens < 0.002) return 0.0;
  float slant = min(inversesqrt(rd.y * rd.y + 0.02), 4.0);
  float a = 1.0 - exp(-dens * 0.3 * slant);
  float ph = mix(cloudHG(cosT, 0.72), cloudHG(cosT, -0.2), 0.3);
  col = cloudKeyLight(pc, CLOUD_CIRRUS_H) * (ph * 0.7) + skyAmb * 1.1;
  return a;
}
`;
