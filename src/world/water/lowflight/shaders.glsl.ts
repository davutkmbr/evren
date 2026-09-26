import { DISTURBANCE_SIM } from './config';

/** vec4 uniforms per stamp in the simulation shader. */
export const STAMP_VEC4S = 3;

/**
 * Disturbance simulation step (one full-window pass into the other ping-pong target). Channels:
 *  r = ripple height (m), g = the previous step's height (the wave equation's second time level),
 *  b = roughness (the dark, ruffled "cat's paw" look; decays and spreads a little), a = foam (decays).
 * The window scrolls by whole texels (uShift) so a moving window never resamples its state. Stamps are capsules / disks /
 * rings in texel space (see disturbance-window.ts); only the frame's first step applies them, the scroll and the clear.
 * A sponge band along the edges absorbs ripples instead of reflecting them back in.
 */
export const DISTURBANCE_SIM_FRAG = /* glsl */ `
precision highp float;
precision highp int;

#define MAX_STAMPS ${DISTURBANCE_SIM.maxStamps}

uniform sampler2D uPrev;
uniform vec2 uShift;                  // texels: new texel i reads old texel i + shift
uniform vec4 uGrid;                   // x = texels per side, y = clear (1 = start from zero), zw = window origin mod 512 (texels)
uniform vec4 uSimA;                   // x = (c dt / dx)^2, y = ripple velocity keep per step, z = roughness keep, w = foam keep
uniform vec4 uSimB;                   // x = roughness diffusion per step, y = ripple height keep, z = time (s), w = stamp count
uniform float uAdvance;               // 1 = one simulation step, 0 = apply scroll / clear / stamps only (no time passes)
uniform vec4 uStamps[MAX_STAMPS * ${STAMP_VEC4S}];

float dHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

float dNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dHash(i);
  float b = dHash(i + vec2(1.0, 0.0));
  float c = dHash(i + vec2(0.0, 1.0));
  float d = dHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec4 prevAt(vec2 texel) {
  vec2 t = texel + uShift;
  if (uGrid.y > 0.5 || t.x < 0.0 || t.y < 0.0 || t.x >= uGrid.x || t.y >= uGrid.x) {
    return vec4(0.0);
  }
  return texelFetch(uPrev, ivec2(t), 0);
}

void main() {
  vec2 p = floor(gl_FragCoord.xy);
  vec4 c = prevAt(p);
  vec4 l = prevAt(p - vec2(1.0, 0.0));
  vec4 r = prevAt(p + vec2(1.0, 0.0));
  vec4 d = prevAt(p - vec2(0.0, 1.0));
  vec4 u = prevAt(p + vec2(0.0, 1.0));

  float h = c.r;
  float hp = c.g;
  float lap = l.r + r.r + d.r + u.r - 4.0 * h;
  float hn = h;
  float hOld = hp;
  float rough = c.b;
  float foam = c.a;
  if (uAdvance > 0.5) {
    hn = h * uSimB.y + (h - hp) * uSimA.y + uSimA.x * lap;
    float edge = min(min(p.x, p.y), min(uGrid.x - 1.0 - p.x, uGrid.x - 1.0 - p.y));
    hn *= mix(0.86, 1.0, smoothstep(0.0, 10.0, edge));
    hOld = h;
    rough = mix(c.b, 0.25 * (l.b + r.b + d.b + u.b), uSimB.x) * uSimA.z;
    foam = c.a * uSimA.w;
  }

  vec2 pc = p + 0.5;
  vec2 pw = pc + uGrid.zw;
  int count = int(uSimB.w + 0.5);
  for (int i = 0; i < MAX_STAMPS; i++) {
    if (i >= count) break;
    vec4 A = uStamps[i * ${STAMP_VEC4S}];
    vec4 B = uStamps[i * ${STAMP_VEC4S} + 1];
    vec4 C = uStamps[i * ${STAMP_VEC4S} + 2];
    vec2 pa = pc - A.xy;
    vec2 ba = A.zw - A.xy;
    float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    float dist = length(pa - ba * t);
    float w;
    if (B.y > 0.0) {
      float bandHalf = 0.5 * B.y;
      w = 1.0 - smoothstep(bandHalf * 0.4, bandHalf + 0.75, abs(dist - (B.x - bandHalf)));
    } else {
      w = 1.0 - smoothstep(B.x * 0.45, B.x + 0.5, dist);
    }
    if (w <= 0.0) continue;
    float n = dNoise(pw * 0.42 + vec2(uSimB.z * 3.1, -uSimB.z * 2.3));
    float patchy = dNoise(pw * 0.17 + 7.3);
    hn += C.x * w * mix(1.0, (n * 2.0 - 1.0) * 1.7, C.w);
    rough += C.y * w * mix(1.0, 0.3 + 1.4 * patchy, C.w);
    foam += C.z * w * mix(1.0, 0.35 + 1.3 * patchy, C.w);
  }

  hn = clamp(hn, -2.0, 2.0);
  gl_FragColor = vec4(hn, hOld, clamp(rough, 0.0, 4.0), clamp(foam, 0.0, 1.5));
}
`;

/** Water fragment uniforms of the disturbance field. */
export const DISTURBANCE_WATER_UNIFORMS_GLSL = /* glsl */ `
uniform sampler2D uDistTex;
uniform vec4 uDistRect;               // xy = window min corner relative to uOrigin (m), z = 1 / window extent (m), w = texel (m)
uniform vec4 uDistParams;             // x = on (0 / 1), y = slope scale, z = roughness scale, w = foam scale
`;

/**
 * Water fragment: samples the disturbance field at the undisplaced surface point `xo` (inside a uniform branch that
 * costs nothing while the field is off). Declares distSlope (height gradient, before the footprint fade), distRough,
 * distFoam and distEdge.
 */
export const DISTURBANCE_WATER_SAMPLE_GLSL = /* glsl */ `
  vec2 distSlope = vec2(0.0);
  float distRough = 0.0;
  float distFoam = 0.0;
  if (uDistParams.x > 0.5) {
    vec2 duv = (xo - uDistRect.xy) * uDistRect.z;
    vec2 inner = min(duv, 1.0 - duv);
    float distEdge = smoothstep(0.0, 0.1, min(inner.x, inner.y));
    if (distEdge > 0.0) {
      float du = uDistRect.w * uDistRect.z;
      vec4 dc = textureLod(uDistTex, duv, 0.0);
      float hxp = textureLod(uDistTex, duv + vec2(du, 0.0), 0.0).r;
      float hxm = textureLod(uDistTex, duv - vec2(du, 0.0), 0.0).r;
      float hzp = textureLod(uDistTex, duv + vec2(0.0, du), 0.0).r;
      float hzm = textureLod(uDistTex, duv - vec2(0.0, du), 0.0).r;
      distSlope = vec2(hxp - hxm, hzp - hzm) * (uDistParams.y * distEdge / (2.0 * uDistRect.w));
      distRough = max(dc.b, 0.0) * uDistParams.z * distEdge;
      distFoam = clamp(dc.a, 0.0, 1.5) * uDistParams.w * distEdge;
    }
  }
`;
