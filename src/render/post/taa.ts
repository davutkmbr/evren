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

/** Jitter sequence length (Halton 2, 3) at scale 1; upscaling uses 8 x (display / render)^2 phases (FSR 2). */
const JITTER_PHASES = 8;
/** Weight of the current frame in steady state. */
const CURRENT_WEIGHT = 0.1;
/** Weight of the current frame on reactive movers (traffic, vessels, crowd): trails shorter than a frame or two. */
const REACTIVE_WEIGHT = 0.25;
/** A camera jump beyond this (m) or turn beyond this (rad) in one frame drops the history (cuts, teleports). */
const CUT_DISTANCE = 60;
const CUT_ANGLE = 0.5;

const RESOLVE_FRAGMENT = /* glsl */ `
${POST_COMMON_GLSL}
uniform sampler2D tCurrent;
uniform sampler2D tDepth;
uniform sampler2D tHistory;
/* Tracked objects' motion (post/velocity.ts): xy NDC motion, z current / w previous view depth, z = 0: none. */
uniform sampler2D tVelocity;
uniform float uVelocityOn;
/* Reactive movers' depth (post/velocity.ts renderReactive; reversed-Z, 0 = none). */
uniform sampler2D tReactive;
uniform float uReactiveOn;
uniform float uReactiveWeight;
/* Input (internal, jittered) size. */
uniform vec2 uSize;
/* Upscaling: this frame's sample position relative to each input texel centre (input pixels), and output pixels per
   input pixel. */
uniform vec2 uSampleOffset;
uniform vec2 uOutScale;
uniform float uNear;
uniform float uFar;
uniform vec2 uTan;
uniform mat4 uCamWorld;
uniform mat4 uPrevViewProj;
uniform mat4 uPrevView;
uniform float uHistoryValid;
uniform float uCurrentWeight;
/* Debug bits (window.__evren.ctx.pipeline.taa): 1 = no variance clip, 2 = no disocclusion test, 4 = show the path
   (red: object velocity, green: history kept, blue: reactive). */
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
#ifdef TAAU
  // Output pixel centre in input pixels; input texel i holds the scene at i + 0.5 + uSampleOffset (jitter), so the
  // nearest sample is floor(pIn - uSampleOffset).
  vec2 pIn = vUv * uSize;
  ivec2 p = clamp(ivec2(floor(pIn - uSampleOffset)), ivec2(0), ivec2(uSize) - 1);
  // This frame's colour at the output pixel: the 3x3 input samples weighted by their distance to the output pixel
  // centre (Gaussian approximation of Blackman-Harris, as in three's TAAUNode / FSR 2), in the tone-mapped space.
  vec3 cSum = vec3(0.0);
  float wSum = 0.0;
  // The same taps with the kernel in input pixels (TAAUNode's): smooth where the history cannot help (disocclusion,
  // fast motion, deforming objects), where the narrow kernel would show the input's stair steps.
  vec3 cWideSum = vec3(0.0);
  float wWideSum = 0.0;
  vec3 boxMin = vec3(1e9);
  vec3 boxMax = vec3(-1e9);
#else
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 center = taaFetch(p);
#endif

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
      vec3 tc = taaTonemap(taaFetch(q));
#ifdef TAAU
      // Distance in output pixels: the kernel keeps the output's sharpness; the history fills the gaps.
      vec2 dq = (pIn - (vec2(q) + 0.5 + uSampleOffset)) * uOutScale;
      float wq = exp(-2.29 * dot(dq, dq));
      cSum += tc * wq;
      wSum += wq;
      vec2 dw = pIn - (vec2(q) + 0.5 + uSampleOffset);
      float ww = exp(-2.29 * dot(dw, dw));
      cWideSum += tc * ww;
      wWideSum += ww;
#endif
      vec3 c = taaToYCoCg(tc);
      m1 += c;
#ifdef TAAU
      boxMin = min(boxMin, c);
      boxMax = max(boxMax, c);
#endif
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
#ifdef TAAU
  vec3 centerSharp = cSum / max(wSum, 1e-5);
  vec3 centerWide = cWideSum / max(wWideSum, 1e-5);
  vec3 center = taaUntonemap(centerWide);
  // How well this frame covers the output pixel: 1 when the nearest sample lands on its centre (distance in output
  // pixels). Where it does not, the accumulated history carries the pixel.
  vec2 dNear = (pIn - (vec2(p) + 0.5 + uSampleOffset)) * uOutScale;
  float coverage = exp(-2.0 * dot(dNear, dNear));
#endif
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
  // A tracked object in front at the closest sample (its velocity pass depth matches the scene there): its own motion.
  float k = -(uPrevView * world).z / max(dist, 1e-3);
  bool object = false;
  float objectPrevDist = 0.0;
  if (uVelocityOn > 0.5) {
    vec4 vel = texelFetch(tVelocity, closestP, 0);
    if (vel.z > 0.0 && abs(vel.z - dist) < 0.02 * dist + 0.3) {
      motion = -vel.xy * 0.5;
      objectPrevDist = vel.w;
      object = true;
    }
  }
  vec2 historyUv = vUv + motion;
  // A reactive mover (traffic, vessels, crowd, animals) at the closest sample: mostly this frame, so it leaves no trail.
  bool reactive = false;
  if (uReactiveOn > 0.5) {
    float rd = texelFetch(tReactive, closestP, 0).r;
    if (rd > 0.0) {
      float rdist = postLinearDepth(rd, uNear, uFar);
      reactive = abs(rdist - dist) < 0.02 * dist + 0.3;
    }
  }

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
    // Static range test (see above); a tracked object deforms and turns (wings), so its pixels also pass when the
    // history holds the distance its velocity pass says this surface had in the previous frame (nearest history
    // texel). Silhouette pixels take the object's motion (closest sample) but may show the background: either counts.
    float seen = hist.a;
    bool staticOk = seen >= nearD * k * 0.97 - 0.1 && seen <= farD * k * 1.03 + 0.1;
    bool objectOk = false;
    if (object) {
      float seenNearest = texelFetch(tHistory, ivec2(historyUv * vec2(textureSize(tHistory, 0))), 0).a;
      objectOk = abs(seenNearest - objectPrevDist) <= 0.04 * objectPrevDist + 0.2;
    }
    if (!staticOk && !objectOk) {
      valid = false;
    }
  }
  vec3 result;
  if (!valid) {
    result = center;
  } else {
    vec3 h = taaToYCoCg(taaTonemap(max(hist.rgb, vec3(0.0))));
    // Variance clip: move the history towards the neighbourhood mean until it lies inside mean +- sigma.
#ifdef TAAU
    // The neighbourhood's min / max: detail finer than the input samples lies inside their range but often outside
    // mean +- sigma, which would pull the upscaled history back to the input's blur.
    vec3 lo = boxMin;
    vec3 hi = boxMax;
    mean = 0.5 * (lo + hi);
#else
    vec3 lo = mean - sigma;
    vec3 hi = mean + sigma;
#endif
#ifdef TAAU
    float soft = object ? 1.0 : max(clamp(length(motion * uSize) / 8.0, 0.0, 1.0), reactive ? 0.5 : 0.0);
    vec3 c = taaToYCoCg(mix(centerSharp, centerWide, soft));
#else
    vec3 c = taaToYCoCg(taaTonemap(center));
#endif
    vec3 toH = h - mean;
    vec3 extent = max(hi - mean, vec3(1e-5));
    vec3 unit = abs(toH / extent);
    float m = max(unit.x, max(unit.y, unit.z));
    h = m > 1.0 && (uFlags & 1) == 0 ? mean + toH / m : h;
    // Faster convergence under motion (less blur trailing a moving camera).
    float motionPx = length(motion * uSize);
#ifdef TAAU
    float stillWeight = uCurrentWeight * (0.3 + 1.4 * coverage);
#else
    float stillWeight = uCurrentWeight;
#endif
    alpha = mix(stillWeight, 0.35, clamp(motionPx / 24.0, 0.0, 1.0));
    // Deforming objects (wings, rider) are only approximated by their velocity: a little more of the current frame.
    alpha = object ? max(alpha, 0.2) : alpha;
    alpha = reactive ? max(alpha, uReactiveWeight) : alpha;
    // Luma-weighted blend (flicker reduction, Karis 2014): a brighter sample counts for less.
    float wc = alpha / (1.0 + c.x);
    float wh = (1.0 - alpha) / (1.0 + h.x);
    vec3 blended = (c * wc + h * wh) / (wc + wh);
    result = taaUntonemap(taaFromYCoCg(blended));
  }
  if ((uFlags & 8) != 0) {
    // seen / expected (current distance x k): 0.5 = equal.
    gl_FragColor = vec4(vec3(0.5 * hist.a / max(currentDist * k, 1e-3), k * 0.5, float(valid)), currentDist);
    return;
  }
  if ((uFlags & 4) != 0) {
    result = vec3(object ? 1.0 : 0.0, valid ? 1.0 : 0.0, reactive ? 1.0 : 0.0) * 2.0;
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
  /** The upscaling variant (created on first use; shares the uniforms). */
  private upscaleMaterial: THREE.ShaderMaterial | null = null;
  private current = 0;
  /** This frame's jitter (input pixels, the image's shift). */
  private readonly jitterPx = new THREE.Vector2();
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
        tVelocity: { value: null },
        uVelocityOn: { value: 0 },
        tReactive: { value: null },
        uReactiveOn: { value: 0 },
        uReactiveWeight: { value: REACTIVE_WEIGHT },
        uSize: { value: new THREE.Vector2(1, 1) },
        uSampleOffset: { value: new THREE.Vector2() },
        uOutScale: { value: new THREE.Vector2(1, 1) },
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

  /** The previous frame's unjittered view-projection (the velocity pass's reference). */
  get previousViewProjection(): THREE.Matrix4 {
    return this.prevViewProj;
  }

  /** This frame's unjittered view-projection (valid while jittered: the projection before the offset). */
  viewProjection(camera: THREE.PerspectiveCamera, out: THREE.Matrix4): THREE.Matrix4 {
    out.copy(camera.projectionMatrix);
    if (this.jittered) {
      out.elements[8] = this.savedE8[0];
      out.elements[9] = this.savedE8[1];
    }
    return out.multiply(camera.matrixWorldInverse);
  }

  /** Drops the history (teleports, cuts, quality changes): the next frame starts from the current image. */
  reset(): void {
    this.valid = false;
  }

  /**
   * Shifts the projection by this frame's sub-pixel offset (call right before the scene render; undo with unjitter).
   * `upscale` = display / render size per axis: the sequence grows to 8 x upscale^2 phases so every output pixel
   * receives samples near its centre (FSR 2's recommendation).
   */
  jitter(camera: THREE.PerspectiveCamera, frame: number, width: number, height: number, upscale = 1): void {
    const phases = upscale > 1.001 ? Math.ceil(JITTER_PHASES * upscale * upscale) : JITTER_PHASES;
    const k = (frame % phases) + 1;
    const jx = halton(k, 2) - 0.5;
    const jy = halton(k, 3) - 0.5;
    const e = camera.projectionMatrix.elements;
    this.savedE8[0] = e[8];
    this.savedE8[1] = e[9];
    // ndc.x = (e0 x + e8 z) / -z: adding d to e8 moves the image by -d in NDC.
    e[8] -= (2 * jx) / width;
    e[9] -= (2 * jy) / height;
    this.jitterPx.set(jx, jy);
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
   * its texture. `camera` must be unjittered again. `width` x `height` is the input (render) size; with `upscale` the
   * history and the result have the output size `outWidth` x `outHeight` (temporal upscaling, stage 5).
   */
  resolve(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, color: THREE.Texture, depth: THREE.Texture, camera: THREE.PerspectiveCamera, width: number, height: number, velocity: THREE.Texture | null = null, reactive: THREE.Texture | null = null, upscale: { width: number; height: number } | null = null): THREE.Texture {
    camera.updateMatrixWorld();
    camera.matrixWorld.decompose(this.pos, this.quat, _scale);
    if (this.valid && (this.pos.distanceTo(this.prevPos) > CUT_DISTANCE || this.quat.angleTo(this.prevQuat) > CUT_ANGLE)) {
      this.valid = false;
    }
    const src = this.history[this.current];
    const dst = this.history[1 - this.current];
    const outWidth = upscale ? upscale.width : width;
    const outHeight = upscale ? upscale.height : height;
    if (dst.width !== outWidth || dst.height !== outHeight) {
      // A resolution step keeps the history: it is sampled by uv, the old target just has another size.
      dst.setSize(outWidth, outHeight);
    }
    const u = this.material.uniforms;
    // The image moved by +jitter: input texel i holds the scene at i + 0.5 - jitter.
    (u.uSampleOffset.value as THREE.Vector2).set(-this.jitterPx.x, -this.jitterPx.y);
    (u.uOutScale.value as THREE.Vector2).set(outWidth / width, outHeight / height);
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
    u.tVelocity.value = velocity;
    u.uVelocityOn.value = velocity ? 1 : 0;
    u.tReactive.value = reactive;
    u.uReactiveOn.value = reactive ? 1 : 0;
    fs.draw(renderer, upscale ? this.upscaler() : this.material, dst);

    this.prevView.copy(camera.matrixWorldInverse);
    this.prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.current = 1 - this.current;
    this.valid = true;
    return dst.texture;
  }

  private upscaler(): THREE.ShaderMaterial {
    if (!this.upscaleMaterial) {
      this.upscaleMaterial = createPostMaterial({ name: 'post.taauResolve', fragmentShader: RESOLVE_FRAGMENT, uniforms: this.material.uniforms, defines: { TAAU: 1 } });
    }
    return this.upscaleMaterial;
  }

  dispose(): void {
    this.history[0].dispose();
    this.history[1].dispose();
    this.material.dispose();
    this.upscaleMaterial?.dispose();
  }
}

const _scale = new THREE.Vector3();
