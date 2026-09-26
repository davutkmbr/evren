import { POST_COMMON_GLSL } from './common.glsl';
import { TONEMAP_GLSL } from './tonemap.glsl';

/**
 * HDR -> display composite at internal resolution:
 * lens droplets, underwater medium (per-pixel waterline, fog, depth tint, caustics, light shafts), speed blur + edge
 * chromatic aberration, bloom, lens flare, vignette, exposure,
 * Purkinje shift, white balance, tone mapping + look, lift/gain. Alpha = perceptual luma (FXAA input).
 */
export const COMPOSITE_FRAG = /* glsl */ `
${POST_COMMON_GLSL}
${TONEMAP_GLSL}
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tBloom;
uniform sampler2D tFlare;
uniform vec2 uTexel;
uniform vec2 uBloomTexel;
uniform float uBloomStrength;
uniform float uBloomNorm;
uniform float uExposure;
uniform vec3 uWhiteBalance;
uniform vec3 uLookSlope;
uniform float uLookPower;
uniform float uLookSat;
uniform vec3 uLift;
uniform vec3 uGain;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uVignette;
uniform float uAspect;
uniform float uSpeed;
uniform vec2 uMaskCenter;
uniform vec2 uMaskRadius;
uniform float uMaskDepth;
uniform float uTime;
uniform float uFrame;
uniform vec2 uSunUV;
uniform float uFlareIntensity;
uniform float uUnderwater;
uniform vec3 uWaterLight;
uniform float uCamDepth;
uniform vec4 uWaterPlane;
uniform float uSurfaceY;
uniform vec3 uWaterSigma;
uniform vec3 uSunRefr;
uniform vec3 uShaftColor;
uniform vec2 uShaft;
uniform vec2 uCaustic;
uniform vec2 uLensBand;
uniform float uDroplets;
uniform float uNear;
uniform float uFar;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uPurkinje;
varying vec2 vUv;

vec3 sampleBloom(vec2 uv) {
  vec2 d = uBloomTexel;
  vec3 s = textureLod(tBloom, uv, 0.0).rgb * 4.0;
  s += textureLod(tBloom, uv + vec2(-d.x, 0.0), 0.0).rgb * 2.0;
  s += textureLod(tBloom, uv + vec2(d.x, 0.0), 0.0).rgb * 2.0;
  s += textureLod(tBloom, uv + vec2(0.0, -d.y), 0.0).rgb * 2.0;
  s += textureLod(tBloom, uv + vec2(0.0, d.y), 0.0).rgb * 2.0;
  s += textureLod(tBloom, uv - d, 0.0).rgb;
  s += textureLod(tBloom, uv + d, 0.0).rgb;
  s += textureLod(tBloom, uv + vec2(-d.x, d.y), 0.0).rgb;
  s += textureLod(tBloom, uv + vec2(d.x, -d.y), 0.0).rgb;
  return s / 16.0;
}

float vnoise1(float x) {
  float i = floor(x);
  float f = fract(x);
  float a = postHash12(vec2(i, 17.0));
  float b = postHash12(vec2(i + 1.0, 17.0));
  return mix(a, b, f * f * (3.0 - 2.0 * f));
}

/*
 * 0 on the rider's own dragon (inside its projected bounding sphere AND in front of the sphere's far side),
 * 1 everywhere else: close scenery at the frame edges still streaks, the dragon never does.
 */
float farWeight(vec2 uv) {
  vec2 q = (uv - uMaskCenter) / uMaskRadius;
  float inside = 1.0 - smoothstep(1.0, 1.3, length(q));
  if (inside <= 0.0) {
    return 1.0;
  }
  float d = textureLod(tDepth, uv, 0.0).r;
  float z = d <= 0.0 ? 1e9 : postLinearDepth(d, uNear, uFar);
  float near = 1.0 - smoothstep(uMaskDepth, uMaskDepth * 1.15 + 3.0, z);
  return 1.0 - inside * near;
}

/* Radial motion blur toward the screen edges + edge-only lateral chromatic aberration. Never smears near geometry. */
vec3 speedSample(vec2 uv, float jitter) {
  vec2 center = vec2(0.5, 0.5);
  vec2 dir = uv - center;
  float r = length(dir * vec2(uAspect, 1.0));
  float mask = smoothstep(0.28, 1.0, r) * uSpeed;
  vec3 base = textureLod(tColor, uv, 0.0).rgb;
  if (mask < 0.002) {
    return base;
  }
  mask *= farWeight(uv);
  if (mask < 0.002) {
    return base;
  }
  float ang = atan(dir.y, dir.x);
  float streak = 0.55 + 0.45 * vnoise1(ang * 38.0 + uTime * 0.35) * vnoise1(ang * 9.0 - uTime * 0.2 + 3.0);
  float len = 0.055 * mask * streak;
  float ca = 0.004 * mask;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  const int TAPS = 8;
  for (int i = 0; i < TAPS; i++) {
    float t = (float(i) + jitter) / float(TAPS);
    vec2 p = uv - dir * len * t;
    float w = farWeight(p);
    vec2 d = p - center;
    acc.r += textureLod(tColor, center + d * (1.0 + ca), 0.0).r * w;
    acc.g += textureLod(tColor, p, 0.0).g * w;
    acc.b += textureLod(tColor, center + d * (1.0 - ca), 0.0).b * w;
    wsum += w;
  }
  return wsum > 0.5 ? acc / wsum : base;
}

float hexDist(vec2 p) {
  p = abs(p);
  return max(p.x * 0.866025 + p.y * 0.5, p.y);
}

vec3 lensFlare(vec2 uv) {
  vec4 src = texelFetch(tFlare, ivec2(0, 0), 0);
  vec3 light = src.rgb * uFlareIntensity;
  if (dot(light, vec3(1.0)) < 1e-4) {
    return vec3(0.0);
  }
  vec2 asp = vec2(uAspect, 1.0);
  vec2 p = (uv - 0.5) * asp;
  vec2 s = (uSunUV - 0.5) * asp;
  vec3 acc = vec3(0.0);

  // Ghosts: images of the aperture mirrored through the optical centre.
  const int GHOSTS = 6;
  float ks[6] = float[6](-0.28, -0.52, -0.74, -1.05, 0.38, -1.42);
  float sizes[6] = float[6](0.035, 0.085, 0.022, 0.15, 0.05, 0.3);
  vec3 tints[6] = vec3[6](
    vec3(0.55, 0.85, 1.0), vec3(1.0, 0.72, 0.42), vec3(0.6, 1.0, 0.65),
    vec3(0.45, 0.6, 1.0), vec3(1.0, 0.55, 0.75), vec3(0.8, 0.9, 1.0));
  float weights[6] = float[6](0.038, 0.013, 0.045, 0.0065, 0.016, 0.0014);
  for (int i = 0; i < GHOSTS; i++) {
    vec2 q = p - s * ks[i];
    float d = hexDist(q) / sizes[i];
    float body = 1.0 - smoothstep(0.82, 1.0, d);
    float rim = smoothstep(0.7, 0.97, d) * body;
    float g = body * (0.55 + 0.9 * rim);
    // Lateral dispersion: red and blue fringes of each ghost.
    float dr = hexDist(q * 0.985) / sizes[i];
    float db = hexDist(q * 1.015) / sizes[i];
    vec3 disp = vec3(1.0 - smoothstep(0.82, 1.0, dr), g, 1.0 - smoothstep(0.82, 1.0, db));
    acc += tints[i] * mix(vec3(g), disp, 0.5) * weights[i];
  }

  vec2 fromSun = p - s;
  float rs = length(fromSun);

  // Diffraction starburst (7-blade aperture -> 14 spikes) with fine random streaks.
  float ang = atan(fromSun.y, fromSun.x);
  float spikes = pow(abs(cos(ang * 7.0 + 0.4)), 220.0);
  float fine = pow(vnoise1(ang * 90.0) * vnoise1(ang * 31.0 + 5.0), 2.0);
  float spikeLen = 0.6 + 0.4 * vnoise1(ang * 7.0 / 3.14159 * 2.0 + 11.0);
  acc += vec3(1.0, 0.97, 0.92) * spikes * exp(-rs * 13.0 / spikeLen) * 0.16;
  acc += vec3(1.0, 0.96, 0.9) * fine * exp(-rs * 20.0) * 0.18;
  // Veiling glare: the real sun is far brighter than a half-float disc can hold, so its lens scatter is added here.
  // The wide veil scales with visibility squared (a half-hidden sun loses most of its haze) and stays local.
  acc += vec3(1.0, 0.96, 0.9) * exp(-rs * 70.0) * 9.0;
  acc += vec3(1.0, 0.94, 0.86) * (exp(-rs * 16.0) * 0.5 + exp(-rs * 5.5) * 0.02 * src.a);

  return acc * light;
}

float causticPattern(vec2 p, float t) {
  vec2 q = p;
  float acc = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    q += vec2(sin(q.y * 1.3 + t * (0.7 + 0.2 * fi)), cos(q.x * 1.1 - t * (0.6 + 0.15 * fi))) * 0.55;
    acc += abs(sin(q.x * 1.9 + fi) * sin(q.y * 1.7 - fi));
  }
  float c = 1.0 - clamp(acc / 1.6, 0.0, 1.0);
  return pow(c, 6.0);
}

/* Signed height (m) of a world point above the water plane at the camera (the lens waterline). */
float waterPlaneHeight(vec3 p) {
  return dot(uWaterPlane.xyz, p) - uWaterPlane.w;
}

/* Soft light shafts: brightness of the sunlight that entered the surface at q (constant along each refracted ray). */
float shaftPattern(vec2 q, float t) {
  float s = sin(q.x * 0.83 + t * 0.35) * sin(q.y * 0.71 - t * 0.28) + 0.6 * sin((q.x + q.y) * 1.63 + t * 0.52);
  s = clamp(s * 0.45 + 0.35, 0.0, 1.0);
  return s * s;
}

/* Light shafts along the view ray (uShaft.x steps over at most uShaft.y m), projected up the refracted sun ray. */
vec3 lightShafts(vec3 worldDir, float dist, float jitter) {
  int steps = int(uShaft.x);
  float len = min(dist, uShaft.y);
  float acc = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= steps) {
      break;
    }
    float t = (float(i) + jitter) / uShaft.x * len;
    vec3 p = uCamPos + worldDir * t;
    float pd = max(uSurfaceY - p.y, 0.0);
    vec2 q = p.xz - uSunRefr.xz * (pd / max(-uSunRefr.y, 0.2));
    acc += shaftPattern(q, uTime) * exp(-uWaterSigma.g * (t + pd));
  }
  return uShaftColor * (acc * len / max(uShaft.x, 1.0));
}

vec3 underwaterMedium(vec3 color, vec2 uv, float jitter) {
  float depth = textureLod(tDepth, uv, 0.0).r;
  vec4 vp = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 viewDir = normalize(vp.xyz / vp.w);
  float z = depth <= 0.0 ? 1e5 : postLinearDepth(depth, uNear, uFar);
  float dist = z / max(-viewDir.z, 1e-3);
  vec3 worldDir = normalize(mat3(uCamWorld) * viewDir);
  // Coastal (Marmara / Bosphorus) water: red absorbed within metres, green-blue visibility of a couple of tens of m.
  vec3 trans = exp(-uWaterSigma * min(dist, 400.0));
  float surfaceLight = exp(-uWaterSigma.g * 0.75 * uCamDepth);
  float upness = clamp(worldDir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 medium = uWaterLight * surfaceLight * (0.14 + 0.86 * upness * upness);
  vec3 lit = color;
  if (depth > 0.0) {
    vec3 wp = uCamPos + worldDir * dist;
    float pd = max(uSurfaceY - wp.y, 0.0);
    // Daylight lost on its way down to the point, then caustics from the waves above (projected along the sun).
    lit *= exp(-uWaterSigma * (uCaustic.y * pd));
    vec2 q = wp.xz - uSunRefr.xz * (pd / max(-uSunRefr.y, 0.2));
    float c = causticPattern(q * 0.45, uTime * 1.1);
    lit *= 1.0 + c * uCaustic.x * exp(-0.12 * pd) * exp(-dist * 0.03);
  }
  vec3 result = lit * trans + medium * (1.0 - trans);
  if (uShaft.x > 0.5) {
    result += lightShafts(worldDir, dist, jitter);
  }
  return result;
}

/* Signed height of this pixel's near-plane point above the lens waterline (m): < 0 = the pixel looks from under water. */
float lensWaterHeight(vec2 uv) {
  vec4 vp = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 viewDir = vp.xyz / vp.w;
  vec3 nearPoint = viewDir * (uNear / max(-viewDir.z, 1e-4));
  return waterPlaneHeight(uCamPos + mat3(uCamWorld) * nearPoint);
}

/* Droplets on the lens after a breach: uv offset of one layer of drops (grid cells per screen height), rim in .z. */
vec3 dropletLayer(vec2 uv, float cells, float seed) {
  vec2 grid = vec2(uAspect * cells, cells);
  vec2 g = uv * grid;
  vec2 cell = floor(g);
  float h = postHash12(cell + seed);
  if (h > 0.55) {
    return vec3(0.0);
  }
  float fall = (1.0 - uDroplets) * (0.3 + 1.2 * h);
  vec2 c = vec2(0.25 + 0.5 * postHash12(cell + seed + 7.7), 0.35 + 0.4 * postHash12(cell + seed + 1.3) - fall);
  float r = (0.16 + 0.2 * postHash12(cell + seed + 5.9)) * (0.55 + 0.45 * uDroplets);
  vec2 d = fract(g) - c;
  d.y *= 0.85;
  float l = length(d) / r;
  if (l >= 1.0) {
    return vec3(0.0);
  }
  float bulge = sqrt(1.0 - l * l);
  return vec3(-d / grid * (0.6 + 0.9 * bulge), smoothstep(0.65, 1.0, l));
}

void main() {
  vec2 uv = vUv;
  float jitter = interleavedGradientNoise(gl_FragCoord.xy, uFrame);
  // Lens under water: which side of the waterline this pixel's near-plane point is on, and the wet band on the line.
  float underMask = 0.0;
  float wetBand = 0.0;
  if (uUnderwater > 0.0) {
    float hLens = lensWaterHeight(vUv);
    underMask = 1.0 - smoothstep(-uLensBand.x, uLensBand.x, hLens);
    wetBand = exp(-(hLens * hLens) / (uLensBand.y * uLensBand.y));
    uv += vec2(sin(uv.y * 22.0 + uTime * 1.7), cos(uv.x * 19.0 + uTime * 1.3)) * 0.0022 * underMask;
    uv.y += 0.012 * wetBand;
  }
  float dropRim = 0.0;
  if (uDroplets > 0.0) {
    vec3 a = dropletLayer(vUv, 7.0, 3.1);
    vec3 b = dropletLayer(vUv + vec2(0.37, 0.11), 13.0, 11.7);
    float fade = smoothstep(0.0, 0.35, uDroplets);
    uv += (a.xy + b.xy) * fade;
    dropRim = max(a.z, b.z) * fade;
  }
  vec3 col = uSpeed > 0.001 ? speedSample(uv, jitter) : textureLod(tColor, uv, 0.0).rgb;
  col = sanitizeHdr(col);

  if (uBloomStrength > 0.0) {
    col = mix(col, sampleBloom(uv) * uBloomNorm, uBloomStrength);
  }
  if (uFlareIntensity > 0.0) {
    col += lensFlare(uv);
  }
  if (underMask > 0.0) {
    col = mix(col, underwaterMedium(col, uv, jitter), underMask);
  }
  if (wetBand > 0.01) {
    // The meniscus on the lens: a thin, bright, slightly milky line where the water crosses it.
    col = mix(col, col * 0.7 + uWaterLight * 0.6 + postLuma(col) * 0.15, 0.55 * wetBand);
  }
  if (dropRim > 0.0) {
    col *= 1.0 - 0.3 * dropRim;
  }

  vec2 vc = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r2 = dot(vc, vc) / (0.25 * (uAspect * uAspect + 1.0));
  col *= mix(1.0, 1.0 / ((1.0 + 0.55 * r2) * (1.0 + 0.55 * r2)), uVignette);

  // Rod (scotopic) vision when dark-adapted: whatever displays darker than ~mid grey loses saturation and
  // shifts toward blue; bright lights keep their colour.
  if (uPurkinje > 0.0) {
    float exposedLum = postLuma(col) * uExposure;
    float scotopic = dot(col, vec3(0.08, 0.52, 0.40));
    float rod = uPurkinje * (1.0 - smoothstep(0.03, 0.6, exposedLum));
    col = mix(col, scotopic * vec3(0.62, 0.8, 1.12), rod);
  }

  col *= uExposure * uWhiteBalance;
  vec3 display = displayTransform(col, uLookSlope, uLookPower, uLookSat);
  // Split toning: warmth/coolness keyed to display luminance, so a warm key light does not turn blue sky sepia.
  float tl = dot(display, LUMA_REC709);
  vec3 tint = 1.0 + (uShadowTint - 1.0) * ((1.0 - tl) * (1.0 - tl)) + (uHighlightTint - 1.0) * (tl * tl);
  display = clamp(display * tint * uGain + uLift * (1.0 - display), 0.0, 1.0);
  // The composite target is 8-bit: dither before quantisation (triangular, +-1 LSB) to avoid banding in the sky.
  vec2 px = gl_FragCoord.xy;
  float fr = fract(uFrame * 0.618034);
  display += (postHash12(px + fr * 97.0) + postHash12(px.yx * 1.13 + 23.0 - fr * 61.0) - 1.0) / 255.0;
  display = clamp(display, 0.0, 1.0);
  gl_FragColor = vec4(display, dot(display, vec3(0.299, 0.587, 0.114)));
}
`;
