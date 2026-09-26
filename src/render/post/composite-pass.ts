import * as THREE from 'three';
import type { UnderwaterView } from '../../core/contracts';
import type { BloomChain } from './bloom';
import { createPostMaterial, type FullscreenRenderer } from './fullscreen';
import type { GradingState } from './grading';
import type { SunFlare } from './lens-flare';
import type { ToneMapper } from './options';
import { COMPOSITE_FRAG } from './shaders/composite.glsl';

const TONEMAPPER_DEFINE: Record<ToneMapper, number> = { agx: 0, aces: 1, neutral: 2 };
/** Without a dragon service (test scenes): everything closer than this (m) is kept sharp by the speed effect. */
const SPEED_FALLBACK_DEPTH = 45;
/** Screen-covering mask radius (uv units) used when the camera is inside the dragon's bounding sphere. */
const MASK_FULLSCREEN = 16;
const WATER_IOR = 1.333;

/**
 * The underwater look (phase 21 stage 4), all evaluated inside the composite (no extra pass) and only while the
 * `underwater` service says the lens is under or near the surface.
 */
export const UNDERWATER_LOOK = {
  /** Extinction (1/m, rgb) of Bosphorus / Marmara water: green-blue, murky (~15–25 m visibility by day). */
  sigma: [0.4, 0.12, 0.13] as const,
  /** In-scattered water colour per unit of surface light (green-turquoise). */
  scatter: [0.03, 0.17, 0.16] as const,
  /** Fraction of the extinction the daylight loses per metre on its way down to a lit point (depth darkening). */
  downwelling: 0.8,
  /** Caustic brightening near the surface. */
  caustics: 1.6,
  /** Light shafts: strength, max march distance (m), steps per quality preset (0 = off). */
  shaftStrength: 0.9,
  shaftReach: 24,
  shaftSteps: { low: 0, medium: 3, high: 5, ultra: 6 } as Record<string, number>,
  /** Lens waterline: half-width of the soft split and of the wet band, in metres at the near plane. */
  lensSplit: 0.0025,
  lensBand: 0.006,
  /**
   * Exposure lift under water (EV, scaled by the smoothed submersion): auto exposure meters the scene before the
   * medium darkens it, so without this the water would read ~1-1.5 EV too dark.
   */
  exposureEv: 0.8,
} as const;

export interface CompositeFrame {
  hdr: THREE.Texture;
  depth: THREE.Texture;
  width: number;
  height: number;
  bloom: BloomChain;
  bloomEnabled: boolean;
  exposure: number;
  grading: GradingState;
  flareIntensity: number;
  /** 0..1 as set by the camera (response curve applied here). */
  speedEffect: number;
  time: number;
  frame: number;
  camera: THREE.PerspectiveCamera;
}

/**
 * HDR -> display-encoded composite at internal resolution (see COMPOSITE_FRAG).
 * Also owns the underwater medium state, derived from the camera height and the environment light.
 */
export class CompositePass {
  /** 0 above water .. 1 fully submerged (smoothed `underwater` service state). */
  underwater = 0;
  /** Lens effects active this frame (the underwater branch of the composite runs). */
  lensActive = false;
  /** Quality preset (light shaft steps). */
  preset = 'high';
  private readonly material: THREE.ShaderMaterial;
  private readonly camPos = new THREE.Vector3();
  private readonly tmpView = new THREE.Vector3();

  constructor(toneMapper: ToneMapper, flare: SunFlare, grading: GradingState) {
    this.material = createPostMaterial({
      name: 'post.composite',
      fragmentShader: COMPOSITE_FRAG,
      defines: { TONEMAPPER: TONEMAPPER_DEFINE[toneMapper] },
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        tBloom: { value: null },
        tFlare: { value: flare.texture },
        uTexel: { value: new THREE.Vector2() },
        uBloomTexel: { value: new THREE.Vector2() },
        uBloomStrength: { value: 0 },
        uBloomNorm: { value: 1 },
        uExposure: { value: 1 },
        uWhiteBalance: { value: grading.whiteBalance },
        uLookSlope: { value: grading.lookSlope },
        uLookPower: { value: 1 },
        uLookSat: { value: 1 },
        uLift: { value: grading.lift },
        uGain: { value: grading.gain },
        uShadowTint: { value: grading.shadowTint },
        uHighlightTint: { value: grading.highlightTint },
        uVignette: { value: 0.25 },
        uAspect: { value: 1 },
        uSpeed: { value: 0 },
        uMaskCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uMaskRadius: { value: new THREE.Vector2(MASK_FULLSCREEN, MASK_FULLSCREEN) },
        uMaskDepth: { value: SPEED_FALLBACK_DEPTH },
        uTime: { value: 0 },
        uFrame: { value: 0 },
        uSunUV: { value: flare.sunUV },
        uFlareIntensity: { value: 0 },
        uUnderwater: { value: 0 },
        uWaterLight: { value: new THREE.Color() },
        uCamDepth: { value: 0 },
        uWaterPlane: { value: new THREE.Vector4(0, 1, 0, 0) },
        uSurfaceY: { value: 0 },
        uWaterSigma: { value: new THREE.Vector3(...UNDERWATER_LOOK.sigma) },
        uSunRefr: { value: new THREE.Vector3(0, -1, 0) },
        uShaftColor: { value: new THREE.Color() },
        uShaft: { value: new THREE.Vector2(0, UNDERWATER_LOOK.shaftReach) },
        uCaustic: { value: new THREE.Vector2(UNDERWATER_LOOK.caustics, UNDERWATER_LOOK.downwelling) },
        uLensBand: { value: new THREE.Vector2(UNDERWATER_LOOK.lensSplit, UNDERWATER_LOOK.lensBand) },
        uDroplets: { value: 0 },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uPurkinje: { value: 0 },
      },
    });
  }

  /**
   * Underwater inputs from the `underwater` service (null: no water module, e.g. test scenes, where the flat sea at
   * y = 0 stands in). Light = linear sun + sky irradiance reaching the surface. `overWater` = there is a water column
   * under the camera (only used by the fallback). Everything stays off (branch skipped) while the lens is dry.
   */
  updateUnderwater(
    camera: THREE.PerspectiveCamera,
    sunDir: THREE.Vector3,
    sunColor: THREE.Color,
    ambient: THREE.Color,
    view: UnderwaterView | null,
    overWater = true,
  ): void {
    const u = this.material.uniforms;
    const camPos = this.camPos.setFromMatrixPosition(camera.matrixWorld);
    let surfaceY = 0;
    let droplets = 0;
    if (view) {
      this.lensActive = view.lensActive;
      this.underwater = view.amount;
      surfaceY = view.surfaceY;
      droplets = view.droplets;
      const n = view.surfaceNormal;
      (u.uWaterPlane.value as THREE.Vector4).set(n.x, n.y, n.z, n.x * camPos.x + n.y * surfaceY + n.z * camPos.z);
    } else {
      this.lensActive = overWater && camPos.y < 0.9;
      this.underwater = overWater && camPos.y < 0 ? 1 : 0;
      (u.uWaterPlane.value as THREE.Vector4).set(0, 1, 0, 0);
    }
    u.uDroplets.value = droplets;
    u.uUnderwater.value = this.lensActive ? 1 : 0;
    if (!this.lensActive) {
      return;
    }
    u.uSurfaceY.value = surfaceY;
    const sunLum = sunColor.r * 0.2126 + sunColor.g * 0.7152 + sunColor.b * 0.0722;
    const ambLum = ambient.r * 0.2126 + ambient.g * 0.7152 + ambient.b * 0.0722;
    const sunUp = Math.max(sunDir.y, 0);
    const light = ambLum * 0.9 + sunLum * sunUp * 0.35;
    const sc = UNDERWATER_LOOK.scatter;
    (u.uWaterLight.value as THREE.Color).setRGB(sc[0] * light, sc[1] * light, sc[2] * light);
    u.uCamDepth.value = Math.max(0, surfaceY - camPos.y);
    // Sunlight refracted into the water (Snell): shafts and caustics are projected up along this direction.
    const refr = u.uSunRefr.value as THREE.Vector3;
    const flat = Math.hypot(sunDir.x, sunDir.z);
    const sinT = Math.min(1, Math.sqrt(Math.max(0, 1 - sunDir.y * sunDir.y)) / WATER_IOR);
    const cosT = Math.sqrt(1 - sinT * sinT);
    if (flat > 1e-4) {
      refr.set((-sunDir.x / flat) * sinT, -cosT, (-sunDir.z / flat) * sinT);
    } else {
      refr.set(0, -1, 0);
    }
    const steps = UNDERWATER_LOOK.shaftSteps[this.preset] ?? 4;
    const shaft = sunLum * Math.sqrt(sunUp) * UNDERWATER_LOOK.shaftStrength * 0.02;
    (u.uShaftColor.value as THREE.Color).setRGB(0.25 * shaft, shaft, 0.9 * shaft);
    (u.uShaft.value as THREE.Vector2).set(shaft > 1e-5 ? steps : 0, UNDERWATER_LOOK.shaftReach);
    (u.uProjInv.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (u.uCamWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
    (u.uCamPos.value as THREE.Vector3).copy(camPos);
  }

  /**
   * Speed-effect protection mask: the rider's dragon as a bounding sphere (world centre + radius) projected to the
   * screen. Pixels inside its disc that are nearer than the sphere's far side are never smeared. `center` null =
   * no dragon known: keep everything within SPEED_FALLBACK_DEPTH sharp.
   */
  updateSpeedMask(camera: THREE.PerspectiveCamera, center: THREE.Vector3 | null, radius: number): void {
    const u = this.material.uniforms;
    const maskCenter = u.uMaskCenter.value as THREE.Vector2;
    const maskRadius = u.uMaskRadius.value as THREE.Vector2;
    if (!center) {
      maskCenter.set(0.5, 0.5);
      maskRadius.set(MASK_FULLSCREEN, MASK_FULLSCREEN);
      u.uMaskDepth.value = SPEED_FALLBACK_DEPTH;
      return;
    }
    const v = this.tmpView.copy(center).applyMatrix4(camera.matrixWorldInverse);
    const viewZ = -v.z;
    u.uMaskDepth.value = Math.max(viewZ, 0) + radius;
    const d2 = v.lengthSq() - radius * radius;
    if (viewZ - radius <= camera.near * 4 || d2 <= 1) {
      maskCenter.set(0.5, 0.5);
      maskRadius.set(MASK_FULLSCREEN, MASK_FULLSCREEN);
      return;
    }
    v.applyMatrix4(camera.projectionMatrix);
    maskCenter.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    // Angular radius of the sphere mapped to uv (slightly conservative away from the view axis).
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) / camera.zoom;
    const ry = Math.min(MASK_FULLSCREEN, (radius / Math.sqrt(d2) / tanHalf) * 0.5);
    maskRadius.set(ry / camera.aspect, ry);
  }

  render(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, f: CompositeFrame, output: THREE.WebGLRenderTarget): void {
    const u = this.material.uniforms;
    const g = f.grading;
    u.tColor.value = f.hdr;
    u.tDepth.value = f.depth;
    u.tBloom.value = f.bloom.result;
    const bloomSize = f.bloom.mipSize(0);
    (u.uBloomTexel.value as THREE.Vector2).set(1 / bloomSize.x, 1 / bloomSize.y);
    (u.uTexel.value as THREE.Vector2).set(1 / f.width, 1 / f.height);
    // mip 0 holds the SUM of all bloom levels: normalise it, then mix energy-conservingly.
    u.uBloomStrength.value = f.bloomEnabled ? g.bloomStrength : 0;
    u.uBloomNorm.value = 1 / f.bloom.levels;
    u.uExposure.value = f.exposure;
    u.uLookPower.value = g.lookPower;
    u.uLookSat.value = g.lookSaturation;
    u.uVignette.value = g.vignette;
    u.uPurkinje.value = g.purkinje;
    u.uAspect.value = f.width / f.height;
    const speed = THREE.MathUtils.clamp(f.speedEffect, 0, 1);
    u.uSpeed.value = speed * Math.sqrt(speed);
    u.uTime.value = f.time;
    u.uFrame.value = f.frame;
    u.uFlareIntensity.value = f.flareIntensity;
    u.uNear.value = f.camera.near;
    u.uFar.value = f.camera.far;
    fs.draw(renderer, this.material, output);
  }

  dispose(): void {
    this.material.dispose();
  }
}
