import * as THREE from 'three';
import { POST_COMMON_GLSL } from './shaders/common.glsl';
import { createPostMaterial, type FullscreenRenderer } from './fullscreen';
import { createColorTarget } from './targets';

/**
 * Temporal antialiasing (phase 25, stage 1: the static world; .docs/planning/25-temporal-aa.md).
 *
 * The scene is rendered with a sub-pixel Halton(2, 3) jitter on the projection (jitter() / unjitter() around the scene
 * render only: the water mirror, the shadow cascades and the clouds keep the plain matrices). The resolve reprojects
 * every pixel into the previous frame through its depth and the previous, unjittered view-projection (camera motion
 * only; moving objects get velocity and a reactive mask in later stages), rejects history where the previous depth
 * disagrees (disocclusion), clips it to the current 3x3 neighbourhood's variance in YCoCg (Salvi 2016) and blends it
 * with the current frame. Colours are compared in a reversible tone-mapped space (c / (1 + luma)) so HDR highlights do
 * not dominate the clip. The history's alpha holds each pixel's view distance, for the next frame's disocclusion test.
 * Reference implementation: three's TRAANode / TAAUtils (examples/jsm/tsl, WebGPU only).
 */

/** Jitter sequence length (Halton 2, 3). */
const JITTER_PHASES = 8;
/** Weight of the current frame in steady state. */
const CURRENT_WEIGHT = 0.1;
/** A camera jump beyond this (m) or turn beyond this (rad) in one frame drops the history (cuts, teleports). */
const CUT_DISTANCE = 60;
const CUT_ANGLE = 0.5;

const RESOLVE_FRAGMENT = /* glsl */ `
${POST_COMMON_GLSL}
uniform sampler2D tCurrent;
uniform sampler2D tDepth;
uniform sampler2D tHistory;
uniform vec2 uSize;
uniform float uNear;
uniform float uFar;
uniform vec2 uTan;
uniform mat4 uCamWorld;
uniform mat4 uPrevViewProj;
uniform mat4 uPrevView;
uniform float uHistoryValid;
uniform float uCurrentWeight;
/* Debug bits (window.__evren.ctx.pipeline.taa): 1 = no variance clip, 2 = no disocclusion test. */
uniform int uFlags;
/* Width of the variance clip box in standard deviations. */
uniform float uGamma;
varying vec2 vUv;

// Bit-level finiteness (fast-math compilers fold isnan() away): one bad pixel must never enter the history.
bool taaFinite(vec4 c) {
  uvec4 e = floatBitsToUint(c) & 0x7f800000u;
  return all(notEqual(e, uvec4(0x7f800000u)));
}

vec3 taaFetch(ivec2 p) {
  vec4 c = texelFetch(tCurrent, clamp(p, ivec2(0), ivec2(uSize) - 1), 0);
  return taaFinite(c) ? max(c.rgb, vec3(0.0)) : vec3(0.0);
}

// Reversible tone map: neighbourhood statistics and blending in a perceptual-ish range.
vec3 taaTonemap(vec3 c) { return c / (1.0 + max(max(c.r, c.g), c.b)); }
vec3 taaUntonemap(vec3 c) { return c / max(1.0 - max(max(c.r, c.g), c.b), 1e-4); }
vec3 taaToYCoCg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 taaFromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }

// Catmull-Rom history lookup (5 taps), sharper than bilinear so the history does not blur over time.
vec4 taaHistory(vec2 uv) {
  vec2 hs = vec2(textureSize(tHistory, 0));
  vec2 samplePos = uv * hs;
  vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
  vec2 f = samplePos - texPos1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 tc0 = (texPos1 - 1.0) / hs;
  vec2 tc3 = (texPos1 + 2.0) / hs;
  vec2 tc12 = (texPos1 + w2 / w12) / hs;
  vec4 r = textureLod(tHistory, vec2(tc12.x, tc0.y), 0.0) * (w12.x * w0.y);
  r += textureLod(tHistory, vec2(tc0.x, tc12.y), 0.0) * (w0.x * w12.y);
  r += textureLod(tHistory, tc12, 0.0) * (w12.x * w12.y);
  r += textureLod(tHistory, vec2(tc3.x, tc12.y), 0.0) * (w3.x * w12.y);
  r += textureLod(tHistory, vec2(tc12.x, tc3.y), 0.0) * (w12.x * w3.y);
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  r /= wsum;
  // Depth (alpha) from the nearest texel: interpolated distances across an edge would hide a disocclusion.
  r.a = textureLod(tHistory, uv, 0.0).a;
  return r;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 center = taaFetch(p);

  // Neighbourhood: variance of the tone-mapped YCoCg colours, and the closest depth (reversed-Z: largest value).
  vec3 m1 = vec3(0.0);
  vec3 m2 = vec3(0.0);
  float closest = 0.0;
  ivec2 closestP = p;
  float nearD = 1e9;
  float farD = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      ivec2 q = p + ivec2(i, j);
      vec3 c = taaToYCoCg(taaTonemap(taaFetch(q)));
      m1 += c;
      m2 += c * c;
      float d = texelFetch(tDepth, clamp(q, ivec2(0), ivec2(uSize) - 1), 0).r;
      float qd = d <= 0.0 ? uFar : postLinearDepth(d, uNear, uFar);
      nearD = min(nearD, qd);
      farD = max(farD, qd);
      if (d > closest) {
        closest = d;
        closestP = q;
      }
    }
  }
  vec3 mean = m1 / 9.0;
  vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, vec3(0.0))) * uGamma;

  // World position of the closest surface in the neighbourhood (sky: a far point along the view ray).
  float dist = closest <= 0.0 ? uFar : postLinearDepth(closest, uNear, uFar);
  vec2 ndc = (vec2(closestP) + 0.5) / uSize * 2.0 - 1.0;
  vec3 viewPos = vec3(ndc * uTan * dist, -dist);
  vec4 world = uCamWorld * vec4(viewPos, 1.0);
  vec4 prevClip = uPrevViewProj * world;
  vec2 prevUv = prevClip.xy / prevClip.w * 0.5 + 0.5;
  // Motion of this pixel (the closest sample's motion, applied at this pixel).
  vec2 motion = prevUv - (vec2(closestP) + 0.5) / uSize;
  vec2 historyUv = vUv + motion;

  float currentDist = texelFetch(tDepth, p, 0).r <= 0.0 ? uFar : postLinearDepth(texelFetch(tDepth, p, 0).r, uNear, uFar);
  float alpha = uCurrentWeight;
  bool valid = uHistoryValid > 0.5 && prevClip.w > 0.0 && all(greaterThan(historyUv, vec2(0.0))) && all(lessThan(historyUv, vec2(1.0)));
  vec4 hist = valid ? taaHistory(historyUv) : vec4(0.0);
  if (valid && !taaFinite(hist)) {
    valid = false;
  }
  if (valid && closest > 0.0 && (uFlags & 2) == 0) {
    // Disocclusion: the distance the previous frame stored here must fall within this neighbourhood's distances as
    // the previous camera sees them (scaled by the camera's own move along the view). A single-surface comparison
    // rejects static pixels: across a jittered pixel of distant, grazing ground the distance varies by more than any
    // fixed tolerance.
    float k = -(uPrevView * world).z / max(dist, 1e-3);
    float seen = hist.a;
    if (seen < nearD * k * 0.97 - 0.1 || seen > farD * k * 1.03 + 0.1) {
      valid = false;
    }
  }
  vec3 result;
  if (!valid) {
    result = center;
  } else {
    vec3 h = taaToYCoCg(taaTonemap(max(hist.rgb, vec3(0.0))));
    // Variance clip: move the history towards the neighbourhood mean until it lies inside mean +- sigma.
    vec3 lo = mean - sigma;
    vec3 hi = mean + sigma;
    vec3 c = taaToYCoCg(taaTonemap(center));
    vec3 toH = h - mean;
    vec3 extent = max(hi - mean, vec3(1e-5));
    vec3 unit = abs(toH / extent);
    float m = max(unit.x, max(unit.y, unit.z));
    h = m > 1.0 && (uFlags & 1) == 0 ? mean + toH / m : h;
    // Faster convergence under motion (less blur trailing a moving camera).
    float motionPx = length(motion * uSize);
    alpha = mix(uCurrentWeight, 0.35, clamp(motionPx / 24.0, 0.0, 1.0));
    // Luma-weighted blend (flicker reduction, Karis 2014): a brighter sample counts for less.
    float wc = alpha / (1.0 + c.x);
    float wh = (1.0 - alpha) / (1.0 + h.x);
    vec3 blended = (c * wc + h * wh) / (wc + wh);
    result = taaUntonemap(taaFromYCoCg(blended));
  }
  gl_FragColor = vec4(max(result, vec3(0.0)), currentDist);
}
`;

/** Halton low-discrepancy value of `index` in `base` (0..1). */
function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

export class TemporalAA {
  private readonly history: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  readonly material: THREE.ShaderMaterial;
  private current = 0;
  private valid = false;
  private readonly prevViewProj = new THREE.Matrix4();
  private readonly prevView = new THREE.Matrix4();
  private readonly prevPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly savedE8 = [0, 0];
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private jittered = false;

  constructor() {
    this.history = [createColorTarget(1, 1, { name: 'post.taaA' }), createColorTarget(1, 1, { name: 'post.taaB' })];
    this.material = createPostMaterial({
      name: 'post.taaResolve',
      fragmentShader: RESOLVE_FRAGMENT,
      uniforms: {
        tCurrent: { value: null },
        tDepth: { value: null },
        tHistory: { value: null },
        uSize: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uTan: { value: new THREE.Vector2(1, 1) },
        uCamWorld: { value: new THREE.Matrix4() },
        uPrevViewProj: { value: new THREE.Matrix4() },
        uPrevView: { value: new THREE.Matrix4() },
        uHistoryValid: { value: 0 },
        uCurrentWeight: { value: CURRENT_WEIGHT },
        uFlags: { value: 0 },
        uGamma: { value: 1 },
      },
    });
  }

  /** Drops the history (teleports, cuts, quality changes): the next frame starts from the current image. */
  reset(): void {
    this.valid = false;
  }

  /** Shifts the projection by this frame's sub-pixel offset (call right before the scene render; undo with unjitter). */
  jitter(camera: THREE.PerspectiveCamera, frame: number, width: number, height: number): void {
    const k = (frame % JITTER_PHASES) + 1;
    const jx = halton(k, 2) - 0.5;
    const jy = halton(k, 3) - 0.5;
    const e = camera.projectionMatrix.elements;
    this.savedE8[0] = e[8];
    this.savedE8[1] = e[9];
    // ndc.x = (e0 x + e8 z) / -z: adding d to e8 moves the image by -d in NDC.
    e[8] -= (2 * jx) / width;
    e[9] -= (2 * jy) / height;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    this.jittered = true;
  }

  unjitter(camera: THREE.PerspectiveCamera): void {
    if (!this.jittered) {
      return;
    }
    const e = camera.projectionMatrix.elements;
    e[8] = this.savedE8[0];
    e[9] = this.savedE8[1];
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    this.jittered = false;
  }

  /**
   * Resolves `color` (this frame's jittered HDR scene) against the history into the next history target and returns
   * its texture. `camera` must be unjittered again.
   */
  resolve(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, color: THREE.Texture, depth: THREE.Texture, camera: THREE.PerspectiveCamera, width: number, height: number): THREE.Texture {
    camera.updateMatrixWorld();
    camera.matrixWorld.decompose(this.pos, this.quat, _scale);
    if (this.valid && (this.pos.distanceTo(this.prevPos) > CUT_DISTANCE || this.quat.angleTo(this.prevQuat) > CUT_ANGLE)) {
      this.valid = false;
    }
    const src = this.history[this.current];
    const dst = this.history[1 - this.current];
    if (dst.width !== width || dst.height !== height) {
      // A resolution step keeps the history: it is sampled by uv, the old target just has another size.
      dst.setSize(width, height);
    }
    const u = this.material.uniforms;
    u.tCurrent.value = color;
    u.tDepth.value = depth;
    u.tHistory.value = src.texture;
    (u.uSize.value as THREE.Vector2).set(width, height);
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    const e = camera.projectionMatrix.elements;
    (u.uTan.value as THREE.Vector2).set(1 / e[0], 1 / e[5]);
    (u.uCamWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
    (u.uPrevViewProj.value as THREE.Matrix4).copy(this.prevViewProj);
    (u.uPrevView.value as THREE.Matrix4).copy(this.prevView);
    u.uHistoryValid.value = this.valid ? 1 : 0;
    fs.draw(renderer, this.material, dst);

    this.prevView.copy(camera.matrixWorldInverse);
    this.prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.current = 1 - this.current;
    this.valid = true;
    return dst.texture;
  }

  dispose(): void {
    this.history[0].dispose();
    this.history[1].dispose();
    this.material.dispose();
  }
}

const _scale = new THREE.Vector3();
