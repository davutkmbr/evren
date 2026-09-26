/**
 * Foam field GLSL (phase 21 stage 7c): the simulation step, the stamp pass and the water shader's sampling.
 *
 * Field channels (half-float RGBA, one texel = FoamQuality.texel metres of sea, window around the camera):
 *   r = fresh / whitecap foam (decays in a few seconds), g = wake foam (turbulent water behind hulls and the dragon,
 *   tens of seconds), b = bubbles under fresh foam (the bright aquamarine patch), a = slick (the smooth track a hull
 *   leaves). tools/headless/foam-check.ts ports FOAM_SIM_FRAG and FOAM_STAMP_* to JS line by line; keep them in step.
 */
import { WATER_COMMON_GLSL } from '../shaders/water-common.glsl';
import { GRAVITY } from '../config';
import { WHITECAPS } from './config';
import { CREST_N } from './whitecaps';

const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/**
 * Whitecaps (whitecaps.ts): the crest threshold from the z_N table (crestZ / crestThreshold / crestEdge), the local
 * breaking probability (localBreakProbability) and the breaking cells (foamHash / breakCell). Shared by the sim and the
 * water fragment; tools/headless/foam-check.ts compares the JS twins.
 */
export const FOAM_BREAK_GLSL = /* glsl */ `
uniform float uCrestZ[${CREST_N}];

float foamCrestZ(float nEff) {
  float n = clamp(nEff, 1.0, ${f(CREST_N)}) - 1.0;
  int n0 = int(floor(n));
  int n1 = min(n0 + 1, ${CREST_N - 1});
  return mix(uCrestZ[n0], uCrestZ[n1], n - float(n0));
}

float foamCrestEdge(float edge, float sigma) {
  return max(min(edge, ${f(WHITECAPS.edgeSigma)} * sigma), 1e-5);
}

float foamBreakProb(float probOpen, float omegaOpen, float omegaLocal) {
  if (probOpen <= 0.0 || omegaLocal <= 0.0) return 0.0;
  float lnDev = clamp(${f(WHITECAPS.devExp)} * log(omegaOpen / omegaLocal), log(${f(WHITECAPS.devMin)}), 0.0);
  return min(1.0, probOpen * exp(lnDev));
}

uint foamHash(uint a, uint b) {
  uint x = (a * 0x27d4eb2du) ^ (b + 0x9e3779b9u + (a << 6u) + (a >> 2u));
  x ^= x >> 15u;
  x *= 0x2c1b3c6du;
  x ^= x >> 12u;
  x *= 0x297a2d39u;
  x ^= x >> 15u;
  return x;
}

// The breaking cell at world point w (see breakCell): d = downwind unit direction, c = phase speed, t = cell clock.
float foamBreakCell(vec2 w, float t, vec2 d, float c, float prob) {
  if (prob <= 0.0) return 0.0;
  float u = (dot(w, d) - c * t) / ${f(WHITECAPS.cellAlong)};
  float v = dot(w, vec2(-d.y, d.x)) / ${f(WHITECAPS.cellAcross)};
  uint cell = foamHash(uint(int(floor(u))), uint(int(floor(v))));
  int bucket = int(floor(t / ${f(WHITECAPS.cellTime)} + float(cell) / 4294967296.0));
  float roll = float(foamHash(cell, uint(bucket))) / 4294967296.0;
  return roll < prob ? 1.0 : 0.0;
}
`;

/**
 * One simulation step (full window into the other ping-pong target):
 * 1. advection: semi-Lagrangian back-trace along the surface current + the Stokes drift of the local Gerstner slots
 *    + the wind drift, bilinear between texel centres (manual, zero outside the window), the scroll folded in;
 * 2. decay of every channel (per-step keep factors);
 * 3. sources, each filling toward 1 at its rate (saturating):
 *    - breaking crests of the wind sea: the Jacobian of the Gerstner displacement at the texel (the slot table of the
 *      water shaders, slots the grid cannot carry faded out) below the whitecap threshold (whitecaps.ts);
 *    - breaking wave-particle crests (hull wakes, splash rings): the particle slope above FOAM_SIM.particleBreak;
 *    - surf: crests arriving within FOAM_SIM.surfBand of the coast (the geo coast-distance field);
 * 4. nothing over land.
 * `uGrid.w` = 0 runs an apply-only pass (clear / scroll, no time passes).
 */
export const FOAM_SIM_FRAG = /* glsl */ `
precision highp float;
precision highp int;
${WATER_COMMON_GLSL}

uniform sampler2D uPrev;
uniform vec4 uGrid;    // x = texels per side, y = clear (1 = start from zero), z = texel (m), w = advance (1) / apply only (0)
uniform vec4 uShift;   // xy = scroll (texels: new texel i reads old texel i + shift), zw = window min corner relative to uOrigin (m)
uniform vec4 uKeep;    // per-step keep factors of r, g, b, a
uniform vec4 uFill;    // per-step fill of breaking crests, particle crests, surf; w = step (s)
uniform vec4 uCaps;    // x = open-sea breaking probability of a crest (0: none), y = soft edge, z = crest -> wake share, w = particle -> wake share
uniform vec4 uBreak;   // xy = downwind direction, z = open-sea mean frequency (rad/s), w = breaking cell clock (s)
${FOAM_BREAK_GLSL}
uniform vec4 uDrift;   // xy = wind drift (m/s), z = particle breaking slope, w = its soft edge
uniform vec4 uSurf;    // x = surf band (m), y = surf crest (x local Hs), z / w = slot fade from / to (texels)

vec4 foamPrev(ivec2 i) {
  int n = int(uGrid.x + 0.5);
  if (i.x < 0 || i.y < 0 || i.x >= n || i.y >= n) return vec4(0.0);
  return texelFetch(uPrev, i, 0);
}

// Bilinear between texel centres at continuous texel coordinates t (centre of texel i at i + 0.5).
vec4 foamPrevBilinear(vec2 t) {
  vec2 s = t - 0.5;
  vec2 b = floor(s);
  vec2 w = s - b;
  ivec2 i = ivec2(b);
  vec4 v00 = foamPrev(i);
  vec4 v10 = foamPrev(i + ivec2(1, 0));
  vec4 v01 = foamPrev(i + ivec2(0, 1));
  vec4 v11 = foamPrev(i + ivec2(1, 1));
  return mix(mix(v00, v10, w.x), mix(v01, v11, w.x), w.y);
}

void main() {
  vec2 p = floor(gl_FragCoord.xy);
  if (uGrid.y > 0.5 && uGrid.w < 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
  if (uGrid.w < 0.5) {
    gl_FragColor = foamPrev(ivec2(p + uShift.xy));
    return;
  }
  float texel = uGrid.z;
  vec2 xo = uShift.zw + (p + 0.5) * texel;
  vec2 guv = geoUV(uOrigin + xo);
  float coast = texture(uGeoCoast, guv).r;
  vec4 region = texture(uRegionTex, guv);
  vec4 flow = texture(uFlowTex, guv);
  vec4 groups = waveGroupWeights(region, flow, coast);
  float land = smoothstep(0.0, 25.0, coast);
  float keep = 1.0 - land;

  // Gerstner slots at the texel (undisplaced point): Jacobian, height, local Hs, Stokes drift.
  float jxx = 0.0;
  float jxz = 0.0;
  float jzz = 0.0;
  float h = 0.0;
  float var2 = 0.0;
  float m1 = 0.0;
  float q2 = 0.0;
  float q4 = 0.0;
  vec2 stokes = vec2(0.0);
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 amp = uWaveAmp[i];
    if (amp.x <= 0.0) continue;
    vec4 dir = uWaveDir[i];
    float g = pickGroup(groups, amp.w);
    if (g <= 0.0) continue;
    float ph = dir.z * dot(dir.xy, xo) + amp.z;
    float s = sin(ph);
    float A = amp.x * g;
    h += A * s;
    var2 += A * A;
    float om = sqrt(${f(GRAVITY)} * dir.z);
    m1 += A * A * om;
    stokes += dir.xy * (A * A * om * dir.z);
    float fade = smoothstep(uSurf.z * texel, uSurf.w * texel, dir.w);
    if (fade <= 0.0) continue;
    float qf = amp.y * g * fade;
    float qq = qf * qf;
    q2 += qq;
    q4 += qq * qq;
    float qs = qf * s;
    jxx += dir.x * dir.x * qs;
    jxz += dir.x * dir.y * qs;
    jzz += dir.y * dir.y * qs;
  }
  float ja = 1.0 - jxx * keep;
  float jc = 1.0 - jzz * keep;
  float jb = jxz * keep;
  float J = ja * jc - jb * jb;
  h = h * keep - land * 1.5;
  float hs = 4.0 * sqrt(var2 * 0.5) * keep;
  stokes *= keep;

  // 1 + 2: advect and decay.
  vec2 vel = flow.xy + stokes + uDrift.xy;
  vec2 src = p + 0.5 + uShift.xy - vel * (uFill.w / texel);
  vec4 st = uGrid.y > 0.5 ? vec4(0.0) : foamPrevBilinear(src) * uKeep;

  // 3: sources.
  // Whitecaps (whitecaps.ts): the steepest crests, breaking per cell with the local probability.
  float brk = 0.0;
  float sigL = sqrt(0.5 * q2) * keep;
  if (uCaps.x > 0.0 && sigL > 1e-5 && m1 > 0.0) {
    float omL = m1 / var2;
    float jth = 1.0 - foamCrestZ(q2 * q2 / max(q4, 1e-20)) * sigL;
    float edge = foamCrestEdge(uCaps.y, sigL);
    float crestMask = 1.0 - smoothstep(jth - edge, jth + edge, J);
    if (crestMask > 0.0) {
      brk = crestMask * foamBreakCell(uOrigin + xo, uBreak.w, uBreak.xy, ${f(GRAVITY)} / omL, foamBreakProb(uCaps.x, uBreak.z, omL));
    }
  }
  float pBrk = 0.0;
  float hp = 0.0;
  if (uWaveParams.x > 0.5) {
    vec4 wp = waveParticlesAt(xo);
    hp = wp.r;
    pBrk = smoothstep(uDrift.z - uDrift.w, uDrift.z + uDrift.w, length(wp.gb)) * step(0.0, wp.r);
  }
  float offshore = -coast;
  float band = (1.0 - smoothstep(uSurf.x * 0.4, uSurf.x, offshore)) * smoothstep(-4.0, 1.0, offshore);
  float crest = smoothstep(uSurf.y, uSurf.y * 2.5, (h + hp) / max(hs + 2.0 * abs(hp), 0.05));
  float surf = band * crest * smoothstep(0.05, 0.6, hs + 2.0 * abs(hp));
  float fc = uFill.x * brk;
  float fp = uFill.y * pBrk;
  float fs = uFill.z * surf;
  st.r += (1.0 - st.r) * clamp(fc + fp + fs, 0.0, 1.0);
  st.g += (1.0 - st.g) * clamp(fc * uCaps.z + fp * uCaps.w + fs * 0.3, 0.0, 1.0);
  st.b += (1.0 - st.b) * clamp(fc + fp + fs * 0.6, 0.0, 1.0);
  // 4: nothing over land.
  st *= 1.0 - smoothstep(0.0, 4.0, coast);
  gl_FragColor = clamp(st, 0.0, 1.0);
}
`;

/**
 * Stamp pass: one instanced quad per stamp around its tapered capsule (or ring), drawn into the latest field target
 * with MAX blending, so a stamp holds the field at least at its levels (frame-rate independent: repeated stamps of a
 * continuous source never add up).
 */
export const FOAM_STAMP_VERT = /* glsl */ `
attribute vec2 corner;
attribute vec4 iA;   // x0, z0, x1, z1 relative to the window's min corner (m)
attribute vec4 iB;   // r0, r1, ring band (0 = filled), unused
attribute vec4 iC;   // levels: foam, wake, bubbles, slick
uniform vec4 uWin;   // x = 1 / window extent (m), y = texel (m)
varying vec2 vPos;
varying vec4 vA;
varying vec4 vB;
varying vec4 vC;

void main() {
  vec2 a = iA.xy;
  vec2 b = iA.zw;
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float r = max(iB.x, iB.y) + iB.z + uWin.y;
  vec2 c = 0.5 * (a + b);
  vec2 p = c + dir * (corner.x * (0.5 * len + r)) + perp * (corner.y * r);
  gl_Position = vec4(p * uWin.x * 2.0 - 1.0, 0.0, 1.0);
  vPos = p;
  vA = iA;
  vB = iB;
  vC = iC;
}
`;

export const FOAM_STAMP_FRAG = /* glsl */ `
precision highp float;
uniform vec4 uWin;
varying vec2 vPos;
varying vec4 vA;
varying vec4 vB;
varying vec4 vC;

void main() {
  vec2 pa = vPos - vA.xy;
  vec2 ba = vA.zw - vA.xy;
  float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - ba * t);
  float r = mix(vB.x, vB.y, t);
  float w;
  if (vB.z > 0.0) {
    w = 1.0 - smoothstep(0.5 * vB.z, 0.5 * vB.z + uWin.y, abs(d - r));
  } else {
    w = 1.0 - smoothstep(r * 0.55, r, d);
  }
  if (w <= 0.0) discard;
  gl_FragColor = vC * w;
}
`;

/** Water fragment: foam field uniforms and the window lookup. */
export const FOAM_WATER_GLSL = /* glsl */ `
uniform sampler2D uFoamField;         // foam field: r = fresh foam, g = wake foam, b = bubbles, a = slick
uniform vec4 uFoamRect;               // xy = window min corner relative to uOrigin (m), z = 1 / window extent (m), w = texel (m)
uniform vec4 uFoamParams;             // x = field on (0 / 1), y = edge fade share, z = wind drift (m/s)
uniform vec4 uFoamCaps;               // x = shader-only whitecap Jacobian threshold (< 0: none), y = soft edge, z = coverage W(U10), w = far-cap noise threshold

/** The foam field at xo (relative to uOrigin); w of the result's companion 'edge' is the window weight. */
vec4 foamFieldAt(vec2 xo, out float edge) {
  edge = 0.0;
  if (uFoamParams.x < 0.5) return vec4(0.0);
  vec2 uv = (xo - uFoamRect.xy) * uFoamRect.z;
  vec2 inner = min(uv, 1.0 - uv);
  edge = smoothstep(0.0, uFoamParams.y, min(inner.x, inner.y));
  return edge > 0.0 ? textureLod(uFoamField, uv, 0.0) * edge : vec4(0.0);
}
`;
