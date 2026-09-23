import * as THREE from 'three';
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
  /** 0 above water .. 1 fully submerged (camera below y = 0). */
  underwater = 0;
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
   * Underwater absorption/scattering inputs; light = linear sun + sky irradiance reaching the surface.
   * `overWater` = there is a water column under the camera (false over land, where a camera below sea level is only
   * clipping into low terrain and must not turn the whole frame into sea water).
   */
  updateUnderwater(camera: THREE.PerspectiveCamera, sunDir: THREE.Vector3, sunColor: THREE.Color, ambient: THREE.Color, overWater = true): void {
    const camPos = this.camPos.setFromMatrixPosition(camera.matrixWorld);
    this.underwater = overWater && camPos.y < 0 ? THREE.MathUtils.smoothstep(-camPos.y, 0, 0.35) : 0;
    if (this.underwater <= 0) {
      return;
    }
    const u = this.material.uniforms;
    const sunLum = sunColor.r * 0.2126 + sunColor.g * 0.7152 + sunColor.b * 0.0722;
    const ambLum = ambient.r * 0.2126 + ambient.g * 0.7152 + ambient.b * 0.0722;
    const light = ambLum * 0.9 + sunLum * Math.max(sunDir.y, 0) * 0.35;
    // In-scattered colour of Marmara/Bosphorus water (green-turquoise, red absorbed).
    (u.uWaterLight.value as THREE.Color).setRGB(0.035 * light, 0.2 * light, 0.2 * light);
    u.uCamDepth.value = Math.max(0, -camPos.y);
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
    u.uUnderwater.value = this.underwater;
    u.uNear.value = f.camera.near;
    u.uFar.value = f.camera.far;
    fs.draw(renderer, this.material, output);
  }

  dispose(): void {
    this.material.dispose();
  }
}
