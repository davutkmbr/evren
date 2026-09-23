import * as THREE from 'three';
import { createPostMaterial, type FullscreenRenderer } from './fullscreen';
import { createColorTarget } from './targets';
import { FLARE_VISIBILITY_FRAG } from './shaders/meter.glsl';

const SUN_SAMPLE_RADIUS_DEG = 0.6;

/**
 * Sun lens flare driver: projects the sun, and (when on screen) measures its visibility on the GPU
 * into a 1x1 texture that the composite reads (no CPU readback). Ghosts/starburst are drawn in the composite.
 */
export class SunFlare {
  readonly sunUV = new THREE.Vector2(0.5, 0.5);
  /** Screen-edge and elevation fade applied in the composite, 0 = skip. */
  intensity = 0;
  enabled = true;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly tmp = new THREE.Vector3();

  constructor() {
    this.target = createColorTarget(1, 1, { name: 'post.flare', filter: THREE.NearestFilter });
    this.material = createPostMaterial({
      name: 'post.flareVisibility',
      fragmentShader: FLARE_VISIBILITY_FRAG,
      uniforms: {
        tBefore: { value: null },
        tAfter: { value: null },
        tDepth: { value: null },
        uSunUV: { value: this.sunUV },
        uRadius: { value: new THREE.Vector2() },
        uSunColor: { value: new THREE.Color() },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uSkyDistance: { value: 30000 },
      },
    });
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  /** Synchronous readback of the visibility texel (rgb = transmitted sun colour, a = visibility). Debug only. */
  readVisibility(renderer: THREE.WebGLRenderer): number[] {
    const out = new Float32Array(4);
    const gl = renderer.getContext() as WebGL2RenderingContext;
    renderer.setRenderTarget(this.target);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
    renderer.setRenderTarget(null);
    return Array.from(out);
  }

  /** Projects the sun; returns true when the visibility pass should run this frame. */
  update(camera: THREE.PerspectiveCamera, sunDirection: THREE.Vector3, sunColor: THREE.Color, nightFactor: number): boolean {
    this.intensity = 0;
    if (!this.enabled || sunDirection.y < -0.03 || nightFactor > 0.97) {
      return false;
    }
    const v = this.tmp.setFromMatrixPosition(camera.matrixWorld).addScaledVector(sunDirection, 1000);
    v.applyMatrix4(camera.matrixWorldInverse);
    if (v.z >= -1) {
      return false;
    }
    v.applyMatrix4(camera.projectionMatrix);
    const u = v.x * 0.5 + 0.5;
    const w = v.y * 0.5 + 0.5;
    const outside = Math.max(0, -u, u - 1, -w, w - 1);
    const edgeFade = 1 - smoothstep(0, 0.12, outside);
    if (edgeFade <= 0) {
      return false;
    }
    this.sunUV.set(u, w);
    const elevationFade = smoothstep(-0.03, 0.06, sunDirection.y);
    this.intensity = edgeFade * elevationFade * (1 - nightFactor);
    if (this.intensity <= 0.001) {
      this.intensity = 0;
      return false;
    }
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const ry = (Math.tan(THREE.MathUtils.degToRad(SUN_SAMPLE_RADIUS_DEG)) / tanHalf) * 0.5;
    const uniforms = this.material.uniforms;
    (uniforms.uRadius.value as THREE.Vector2).set(ry / camera.aspect, ry);
    (uniforms.uSunColor.value as THREE.Color).copy(sunColor);
    uniforms.uNear.value = camera.near;
    uniforms.uFar.value = camera.far;
    uniforms.uSkyDistance.value = Math.min(camera.far * 0.5, 30000);
    return true;
  }

  render(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, before: THREE.Texture, after: THREE.Texture, depth: THREE.Texture): void {
    const uniforms = this.material.uniforms;
    uniforms.tBefore.value = before;
    uniforms.tAfter.value = after;
    uniforms.tDepth.value = depth;
    fs.draw(renderer, this.material, this.target);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
