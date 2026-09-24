import * as THREE from 'three';
import type { EngineContext, HdrPass, HdrPassInputs } from '../../core/contracts';
import { createPostMaterial, FullscreenRenderer } from '../post/fullscreen';
import { COMMON_GLSL } from '../shaders/common.glsl';

/** Per-frame inputs of the weather pass (written by the weather system). */
export interface WeatherPassParams {
  /** Aerial blur radius (px at 900 px of internal height) at full distance, 0 = off. */
  blurRadius: number;
  /** Distance (m) where the blur starts and the distance scale (m) over which it grows (63 % at start + scale). */
  blurStart: number;
  blurScale: number;
  /** Extra blur toward the screen edges (0 = uniform, 1 = twice the radius in the corners). */
  blurEdge: number;
  /** Ground fog extinction at sea level (1/m) and its scale height (m). */
  fogDensity: number;
  fogHeight: number;
  /** 0..1 patchiness of the fog banks. */
  fogPatches: number;
  /** Fog in-scattered radiance (isotropic part) and the sun's forward lobe (linear HDR). */
  readonly fogLight: THREE.Color;
  readonly fogSun: THREE.Color;
  /** Drift of the fog banks (world metres, xz). */
  readonly fogDrift: THREE.Vector2;
  /** Lightning: radiance added to sky/distant pixels and to everything (linear HDR), direction of the channel. */
  readonly flashSky: THREE.Color;
  readonly flashNear: THREE.Color;
  readonly flashDir: THREE.Vector3;
}

export function createWeatherPassParams(): WeatherPassParams {
  return {
    blurRadius: 0,
    blurStart: 600,
    blurScale: 5000,
    blurEdge: 0.5,
    fogDensity: 0,
    fogHeight: 70,
    fogPatches: 0.6,
    fogLight: new THREE.Color(),
    fogSun: new THREE.Color(),
    fogDrift: new THREE.Vector2(),
    flashSky: new THREE.Color(),
    flashNear: new THREE.Color(),
    flashDir: new THREE.Vector3(0, 1, 0),
  };
}

const COC_GLSL = /* glsl */ `
uniform vec4 uBlur;
uniform float uAspect;
/*
 * Blur radius (px) of a pixel. Like the haze it stands for, the softening grows with the air between the camera and
 * the surface: 1 - exp(-(d - start) / scale), so nearby streets stay crisp and the far shores go soft. Slightly more
 * toward the screen edges (lens field curvature), never enough to read as a tilt-shift miniature.
 */
float cocAt(vec2 uv, float d) {
  float dist = linearDepth(max(d, 0.0));
  float k = 1.0 - exp(-max(dist - uBlur.y, 0.0) / uBlur.z);
  vec2 c = (uv - 0.5) * vec2(uAspect, 1.0);
  float edge = smoothstep(0.35, 1.0, length(c) / length(vec2(uAspect, 1.0) * 0.5));
  return uBlur.x * k * (1.0 + uBlur.w * edge);
}
`;

/**
 * Half resolution gather: a 16-tap Vogel disk sized by the pixel's blur radius. Samples that are sharper (nearer)
 * than the centre do not contribute, so the dragon and near roofs never smear into the distance behind them.
 */
const BLUR_FRAG = /* glsl */ `
${COMMON_GLSL}
${COC_GLSL}
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 uTexel;
varying vec2 vUv;
const int TAPS = 16;
void main() {
  float d0 = texture2D(tDepth, vUv).r;
  float coc0 = cocAt(vUv, d0);
  vec3 c0 = texture2D(tScene, vUv).rgb;
  if (coc0 < 0.3) {
    gl_FragColor = vec4(c0, coc0);
    return;
  }
  vec3 sum = c0;
  float wsum = 1.0;
  float spin = hash12(gl_FragCoord.xy) * 6.2831853;
  for (int i = 0; i < TAPS; i++) {
    float r = sqrt((float(i) + 0.5) / float(TAPS));
    float a = float(i) * 2.39996323 + spin;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * (r * coc0) * uTexel;
    float coc = cocAt(uv, texture2D(tDepth, uv).r);
    float w = clamp(coc / coc0 * 2.0 - 1.0, 0.0, 1.0);
    sum += texture2D(tScene, uv).rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / wsum, coc0);
}
`;

/** Full resolution: sharp/blurred mix, exponential ground fog with drifting banks, lightning flash. */
const COMPOSITE_FRAG = /* glsl */ `
${COMMON_GLSL}
${COC_GLSL}
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tBlur;
uniform float uBlurOn;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec4 uFog;
uniform vec3 uFogLight;
uniform vec3 uFogSun;
uniform vec2 uFogDrift;
uniform vec3 uFlashSky;
uniform vec3 uFlashNear;
uniform vec3 uFlashDir;
varying vec2 vUv;

const float SKY_DISTANCE = 30000.0;

float hgPhase(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  float d = texture2D(tDepth, vUv).r;
  if (uBlurOn > 0.5) {
    float coc = cocAt(vUv, d);
    vec3 blurred = texture2D(tBlur, vUv).rgb;
    col = mix(col, blurred, smoothstep(0.3, 1.1, coc));
  }

  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, 0.5, 1.0);
  vec3 dirView = normalize(v.xyz / v.w);
  vec3 dir = normalize(mat3(uCamWorld) * dirView);
  bool sky = d <= 0.0;
  float dist = sky ? SKY_DISTANCE : min(linearDepth(d) / max(-dirView.z, 1e-3), SKY_DISTANCE);

  if (uFog.x > 0.0) {
    float h0 = max(uCamPos.y, -2.0);
    float H = uFog.y;
    float h1 = max(h0 + dist * dir.y, -2.0);
    float od = abs(dir.y) > 1e-4
      ? uFog.x * H * (exp(-h0 / H) - exp(-h1 / H)) / dir.y
      : uFog.x * exp(-h0 / H) * dist;
    // Drifting banks: thinner and thicker patches keyed to where the ray ends up.
    vec2 endXZ = uCamPos.xz + dir.xz * min(dist, 6000.0);
    float n = fbm2((endXZ + uFogDrift) / 850.0, 3);
    od *= mix(1.0, 0.25 + 1.5 * n, uFog.z);
    float T = exp(-max(od, 0.0));
    vec3 inscatter = uFogLight + uFogSun * hgPhase(dot(dir, uSunDir), 0.6);
    col = col * T + inscatter * (1.0 - T);
  }

  // The flash lights the cloud deck around the channel most (a glow a few kilometres wide), the rest of the sky less.
  float far = sky ? 1.0 : smoothstep(1200.0, 9000.0, dist);
  float glow = 0.3 + 0.7 * pow(max(dot(dir, uFlashDir), 0.0), 18.0) + 0.25 * fbm2(dir.xz / max(dir.y + 0.35, 0.1) * 3.0 + uFlashDir.xz * 7.0, 3);
  col += uFlashSky * far * glow + uFlashNear * (1.0 - 0.5 * far);
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Weather HdrPass (after the clouds, before transparent effects): aerial blur of the distance, ground fog and the
 * lightning flash. Disabled (zero cost) when all three are off.
 */
export class WeatherPass implements HdrPass {
  readonly name = 'weather';
  readonly order = 110;
  enabled = false;
  readonly params = createWeatherPassParams();

  private readonly fs = new FullscreenRenderer();
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly blurTarget: THREE.WebGLRenderTarget;
  private readonly blurUniform = new THREE.Vector4();
  private width = 1;
  private height = 1;
  /**
   * Drawn over the composited image (after blur and fog): rain streaks and lightning. Their materials test against
   * the scene depth themselves (the pass output has no depth buffer); `overlayDepth` receives it every frame.
   */
  readonly overlay = new THREE.Scene();
  readonly overlayDepth: THREE.IUniform<THREE.Texture | null> = { value: null };
  /** Set by the system when rain or a bolt is visible (keeps the pass running for the overlay). */
  overlayActive = false;

  constructor() {
    this.blurTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.blurTarget.texture.name = 'weather.blur';
    const shared = {
      uBlur: { value: this.blurUniform },
      uAspect: { value: 1 },
    };
    this.blurMaterial = createPostMaterial({
      name: 'weather.blur',
      fragmentShader: BLUR_FRAG,
      uniforms: {
        ...shared,
        tScene: { value: null },
        tDepth: { value: null },
        uTexel: { value: new THREE.Vector2() },
      },
    });
    const p = this.params;
    this.compositeMaterial = createPostMaterial({
      name: 'weather.composite',
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        ...shared,
        tScene: { value: null },
        tDepth: { value: null },
        tBlur: { value: this.blurTarget.texture },
        uBlurOn: { value: 0 },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uFog: { value: new THREE.Vector4() },
        uFogLight: { value: p.fogLight },
        uFogSun: { value: p.fogSun },
        uFogDrift: { value: p.fogDrift },
        uFlashSky: { value: p.flashSky },
        uFlashNear: { value: p.flashNear },
        uFlashDir: { value: p.flashDir },
      },
    });
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.blurTarget.setSize(Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2)));
  }

  /** True when any effect is active (the system toggles `enabled` from it). */
  get active(): boolean {
    const p = this.params;
    return this.overlayActive || p.blurRadius > 0.05 || p.fogDensity > 1e-6 || p.flashSky.r + p.flashNear.r > 1e-5;
  }

  render(renderer: THREE.WebGLRenderer, inputs: HdrPassInputs, output: THREE.WebGLRenderTarget, ctx: EngineContext): void {
    const p = this.params;
    const cam = ctx.camera;
    if (output.width !== this.width || output.height !== this.height) {
      this.setSize(output.width, output.height);
    }
    const scale = this.height / 900;
    this.blurUniform.set(p.blurRadius * scale, p.blurStart, Math.max(p.blurScale, 1), p.blurEdge);
    const aspect = this.width / this.height;
    const blurOn = p.blurRadius > 0.05;

    if (blurOn) {
      const u = this.blurMaterial.uniforms;
      u.tScene.value = inputs.color;
      u.tDepth.value = inputs.depth;
      u.uAspect.value = aspect;
      (u.uTexel.value as THREE.Vector2).set(1 / this.width, 1 / this.height);
      this.fs.draw(renderer, this.blurMaterial, this.blurTarget);
    }

    const c = this.compositeMaterial.uniforms;
    c.tScene.value = inputs.color;
    c.tDepth.value = inputs.depth;
    c.uAspect.value = aspect;
    c.uBlurOn.value = blurOn ? 1 : 0;
    (c.uProjInv.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    (c.uCamWorld.value as THREE.Matrix4).copy(cam.matrixWorld);
    (c.uFog.value as THREE.Vector4).set(p.fogDensity, Math.max(p.fogHeight, 1), p.fogPatches, 0);
    this.fs.draw(renderer, this.compositeMaterial, output);

    if (this.overlayActive) {
      this.overlayDepth.value = inputs.depth;
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(output);
      renderer.render(this.overlay, cam);
      renderer.autoClear = autoClear;
    }
  }

  dispose(): void {
    this.blurTarget.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
    this.fs.dispose();
  }
}
