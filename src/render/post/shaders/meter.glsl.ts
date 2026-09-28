import { POST_COMMON_GLSL } from './common.glsl';

/** Writes log2 luminance (R) and linear luminance (G) of the source, box-filtered over the meter texel footprint. */
export const METER_FRAG = /* glsl */ `
${POST_COMMON_GLSL}
uniform sampler2D tSource;
uniform vec2 uFootprint;
varying vec2 vUv;

void main() {
  vec2 d = uFootprint * 0.25;
  vec3 c = textureLod(tSource, vUv + vec2(-d.x, -d.y), 0.0).rgb;
  c += textureLod(tSource, vUv + vec2(d.x, -d.y), 0.0).rgb;
  c += textureLod(tSource, vUv + vec2(-d.x, d.y), 0.0).rgb;
  c += textureLod(tSource, vUv + vec2(d.x, d.y), 0.0).rgb;
  float l = postLuma(sanitizeHdr(c * 0.25));
  gl_FragColor = vec4(log2(max(l, 1e-7)), l, 0.0, 1.0);
}
`;

/**
 * Sun visibility for the lens flare (1x1 output): fraction of a small disc around the sun that is sky (depth),
 * multiplied by how much of the sky radiance survived the HDR passes (clouds) there.
 * rgb = sun colour * transmitted visibility, a = geometric visibility.
 */
export const FLARE_VISIBILITY_FRAG = /* glsl */ `
${POST_COMMON_GLSL}
uniform sampler2D tBefore;
uniform sampler2D tAfter;
uniform sampler2D tDepth;
uniform vec2 uSunUV;
uniform vec2 uRadius;
uniform vec3 uSunColor;
uniform float uNear;
uniform float uFar;
uniform float uSkyDistance;

void main() {
  const int N = 24;
  float visible = 0.0;
  float transmitted = 0.0;
  for (int i = 0; i < N; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / float(N));
    float a = fi * 2.39996323;
    vec2 uv = uSunUV + vec2(cos(a), sin(a)) * r * uRadius;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
      continue;
    }
    float depth = textureLod(tDepth, uv, 0.0).r;
    float dist = postLinearDepth(depth, uNear, uFar);
    if (depth <= 0.0 || dist > uSkyDistance) {
      float before = postLuma(sanitizeHdr(textureLod(tBefore, uv, 0.0).rgb));
      float after = postLuma(sanitizeHdr(textureLod(tAfter, uv, 0.0).rgb));
      visible += 1.0;
      transmitted += clamp(after / max(before, 1e-4), 0.0, 1.0);
    }
  }
  visible /= float(N);
  transmitted /= float(N);
  gl_FragColor = vec4(uSunColor * transmitted, visible);
}
`;

/**
 * Centre-weighted log-luminance histogram of the meter grid (one fragment per bin, BINS x 1 output).
 * R = weight in this bin, G = weight of exactly black texels, B = total weight (the same in every bin).
 */
export const HISTOGRAM_FRAG = /* glsl */ `
uniform sampler2D tMeter;

void main() {
  int bin = int(gl_FragCoord.x);
  float scale = float(BINS) / (LOG_MAX - LOG_MIN);
  float inBin = 0.0;
  float black = 0.0;
  float total = 0.0;
  for (int y = 0; y < METER_H; y++) {
    // Centre-weighted with a slight bias toward the lower half (ground/city rather than open sky).
    float vb = (float(y) + 0.5) / float(METER_H) - 0.5 + 0.06;
    for (int x = 0; x < METER_W; x++) {
      float lg = texelFetch(tMeter, ivec2(x, y), 0).r;
      if (isnan(lg)) {
        continue;
      }
      float u = (float(x) + 0.5) / float(METER_W) - 0.5;
      float w = 0.35 + exp(-(u * u * 1.6 + vb * vb * 2.2) * 4.0);
      int b = int(floor((clamp(lg, -1e4, 1e4) - LOG_MIN) * scale));
      b = clamp(b, 0, BINS - 1);
      total += w;
      inBin += b == bin ? w : 0.0;
      black += lg <= BLACK_LOG ? w : 0.0;
    }
  }
  gl_FragColor = vec4(inBin, black, total, 1.0);
}
`;

/**
 * Exposure adaptation (2x1 ping-pong state). Averages the [lowPercent, highPercent] band of the histogram, maps it to
 * a target EV (middle-grey key, clamped range, perceptual compensation for dark / bright / night scenes, ?ev= bias)
 * and moves the previous EV toward it with the rising / falling time constants.
 * Texel 0: (exposure, ev, target ev, has measurement); texel 1: (metered log2 luminance, black fraction, 0, 1).
 */
export const ADAPT_FRAG = /* glsl */ `
uniform sampler2D tHistogram;
uniform sampler2D tPrevious;
uniform float uDt;
uniform float uTauUp;
uniform float uTauDown;
uniform float uMinLog;
uniform float uMaxLog;
uniform float uLowPercent;
uniform float uHighPercent;
uniform float uNight;
uniform float uEvBias;
uniform float uSnap;
uniform float uFixed;

/* smoothstep that also accepts e0 > e1 (GLSL's is undefined there). */
float ramp(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

bool finite(float x) {
  return !isnan(x) && !isinf(x);
}

void main() {
  vec4 prev = texelFetch(tPrevious, ivec2(0, 0), 0);
  vec4 prevInfo = texelFetch(tPrevious, ivec2(1, 0), 0);
  float ev = prev.g;
  float target = prev.b;
  float has = prev.a;
  float averageLog = prevInfo.r;

  vec4 h0 = texelFetch(tHistogram, ivec2(0, 0), 0);
  float total = h0.b;
  float blackFraction = total > 0.0 ? h0.g / total : 0.0;
  // A meter without a single valid texel keeps the previous target.
  if (total > 0.0) {
    float scale = float(BINS) / (LOG_MAX - LOG_MIN);
    float lo = total * uLowPercent;
    float hi = total * uHighPercent;
    float acc = 0.0;
    float sum = 0.0;
    float wsum = 0.0;
    for (int b = 0; b < BINS; b++) {
      float w = texelFetch(tHistogram, ivec2(b, 0), 0).r;
      if (w <= 0.0) {
        continue;
      }
      float start = acc;
      acc += w;
      float overlap = min(acc, hi) - max(start, lo);
      if (overlap > 0.0) {
        sum += (LOG_MIN + (float(b) + 0.5) / scale) * overlap;
        wsum += overlap;
      }
    }
    float measured = wsum > 0.0 ? sum / wsum : 0.0;
    float clamped = clamp(measured, uMinLog, uMaxLog);
    float compensation = -1.6 * ramp(-1.5, -7.0, measured) + 0.35 * ramp(0.5, 3.5, measured) - 1.3 * uNight;
    float t = log2(KEY) - clamped + compensation + uEvBias;
    if (finite(t)) {
      averageLog = measured;
      target = t;
      if (has < 0.5 || uSnap > 0.5) {
        ev = t;
      }
      has = 1.0;
    }
  }
  if (has > 0.5) {
    float tau = target > ev ? uTauUp : uTauDown;
    ev += (target - ev) * (1.0 - exp(-uDt / tau));
  }
  if (!finite(ev)) {
    ev = finite(target) ? target : 0.0;
  }
  float exposure = uFixed > 0.0 ? uFixed : exp2(ev);
  gl_FragColor = int(gl_FragCoord.x) == 0 ? vec4(exposure, ev, target, has) : vec4(averageLog, blackFraction, 0.0, 1.0);
}
`;

/** Linear exposure from the adaptation state texture (texel 0, R). */
export const EXPOSURE_GLSL = /* glsl */ `
float postExposure(sampler2D state) {
  return texelFetch(state, ivec2(0, 0), 0).r;
}
`;

/**
 * Bit encoder of the exposure state for the CPU copy (see QueryReadout): discards unless bit uBit is set.
 * Bits 0-11: log2 exposure over [-16, 16] EV; 12-21: metered log2 luminance over [-24, 24]; 22-28: black fraction;
 * 29: has a measurement.
 */
export const EXPOSURE_BITS_FRAG = /* glsl */ `
uniform sampler2D tState;
uniform int uBit;

void main() {
  vec4 s = texelFetch(tState, ivec2(0, 0), 0);
  vec4 info = texelFetch(tState, ivec2(1, 0), 0);
  uint word;
  int bit;
  if (uBit < 12) {
    word = uint(clamp((log2(max(s.r, 1e-12)) + 16.0) / 32.0, 0.0, 1.0) * 4095.0 + 0.5);
    bit = uBit;
  } else if (uBit < 22) {
    word = uint(clamp((info.r + 24.0) / 48.0, 0.0, 1.0) * 1023.0 + 0.5);
    bit = uBit - 12;
  } else if (uBit < 29) {
    word = uint(clamp(info.g, 0.0, 1.0) * 127.0 + 0.5);
    bit = uBit - 22;
  } else {
    word = s.a > 0.5 ? 1u : 0u;
    bit = 0;
  }
  if (((word >> uint(bit)) & 1u) == 0u) {
    discard;
  }
  gl_FragColor = vec4(1.0);
}
`;
