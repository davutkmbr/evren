import * as THREE from 'three';
import { RenderLayers } from '../../../core/contracts';
import type { QualityPreset } from '../../../core/quality';
import { COMMON_GLSL } from '../../../render/shaders';

/** Floating particles (suspended matter) around an under-water camera. */
export const UNDERWATER_PARTICLES = {
  /** Points per quality preset (one draw call; hidden, so free, above water). */
  count: { low: 250, medium: 600, high: 1200, ultra: 1800 } as Record<QualityPreset, number>,
  /** Edge of the cube around the camera the points wrap in (m). */
  box: 22,
  /** Mote diameter range (m). */
  sizeMin: 0.012,
  sizeMax: 0.045,
  /** Brightness relative to the ambient + sun light reaching the surface. */
  brightness: 0.35,
} as const;

const MAX_COUNT = 1800;

const VERTEX = /* glsl */ `
${COMMON_GLSL}
attribute vec4 aSeed;
uniform float uBox;
uniform float uSurfaceY;
uniform float uPointScale;
uniform vec3 uDrift;
uniform vec2 uSize;
varying float vShade;

void main() {
  vec3 rel = fract(aSeed.xyz - (uCamPos - uDrift) / uBox) - 0.5;
  vec3 wp = uCamPos + rel * uBox;
  float ph = aSeed.w * 43.0;
  wp += vec3(sin(uTime * 0.31 + ph), sin(uTime * 0.23 + ph * 1.7), cos(uTime * 0.27 + ph * 2.3)) * 0.18;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float dist = max(-mv.z, 0.05);
  float edge = 1.0 - smoothstep(0.32, 0.5, max(abs(rel.x), max(abs(rel.y), abs(rel.z))));
  float wet = step(wp.y, uSurfaceY - 0.05);
  float size = mix(uSize.x, uSize.y, aSeed.w * aSeed.w) * uPointScale / dist * edge * wet;
  vShade = 0.55 + 0.45 * fract(aSeed.w * 7.31);
  gl_Position = size < 0.35 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
  gl_PointSize = clamp(size, 1.0, 5.0);
}
`;

const FRAGMENT = /* glsl */ `
${COMMON_GLSL}
uniform float uBrightness;
varying float vShade;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) {
    discard;
  }
  vec3 light = uAmbient + uSunColor * max(uSunDir.y, 0.0) * 0.3;
  gl_FragColor = vec4(light * vec3(0.75, 1.0, 0.9) * (uBrightness * vShade), 1.0);
}
`;

/**
 * A small GPU point field that wraps around the camera (world-locked, drifting with the current): one opaque draw
 * with depth, so the post pipeline's underwater fog treats every mote at its own distance. Hidden above water.
 */
export class UnderwaterParticles {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly drift = new THREE.Vector3();

  constructor(preset: QualityPreset) {
    const seeds = new Float32Array(MAX_COUNT * 4);
    let s = 0x9e3779b9;
    const rnd = (): number => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) % 1_000_003) / 1_000_003;
    };
    for (let i = 0; i < seeds.length; i++) {
      seeds[i] = rnd();
    }
    const geometry = new THREE.BufferGeometry();
    // three needs a position attribute for the draw count; the shader places every point from aSeed.
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_COUNT * 3), 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.material = new THREE.ShaderMaterial({
      name: 'underwater-particles',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uBox: { value: UNDERWATER_PARTICLES.box },
        uSurfaceY: { value: 0 },
        uPointScale: { value: 400 },
        uDrift: { value: this.drift },
        uSize: { value: new THREE.Vector2(UNDERWATER_PARTICLES.sizeMin, UNDERWATER_PARTICLES.sizeMax) },
        uBrightness: { value: UNDERWATER_PARTICLES.brightness },
      },
      depthWrite: true,
      depthTest: true,
      transparent: false,
      fog: false,
      lights: false,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.name = 'underwater-particles';
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.layers.set(RenderLayers.NoReflection);
    this.setQuality(preset);
  }

  setQuality(preset: QualityPreset): void {
    this.points.geometry.setDrawRange(0, Math.min(MAX_COUNT, UNDERWATER_PARTICLES.count[preset] ?? UNDERWATER_PARTICLES.count.high));
  }

  /**
   * `visible` = the camera is (nearly) under water; `current` = the water's drift velocity at the camera (m/s),
   * `pixelsPerRadian` = projection[1][1] * internal height / 2 (point size scale).
   */
  update(visible: boolean, dt: number, surfaceY: number, current: THREE.Vector3, pixelsPerRadian: number): void {
    this.points.visible = visible;
    if (!visible) {
      return;
    }
    const u = this.material.uniforms;
    if (Number.isFinite(current.x + current.y + current.z)) {
      this.drift.addScaledVector(current, Math.min(Math.max(dt, 0), 0.1));
      // Keep the accumulator small (only its value modulo the box matters).
      const box = UNDERWATER_PARTICLES.box;
      this.drift.set(this.drift.x % box, this.drift.y % box, this.drift.z % box);
    }
    u.uSurfaceY.value = surfaceY;
    u.uPointScale.value = pixelsPerRadian;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
