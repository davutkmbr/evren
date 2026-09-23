import * as THREE from 'three';
import { SHARED_GLSL } from '../shaders';
import { CLOUD_SHADOW_REF_HEIGHT } from '../shaders/cloudshadow.glsl';
import type { CloudQualityLevel } from './config';
import type { CloudShadowGlobals, CloudUniformSet } from './cloud-uniforms';
import { createPassMaterial, type FullscreenQuad } from './fullscreen';
import { CLOUD_COMMON_GLSL } from './glsl/cloud-common.glsl';
import { SHADOW_FRAGMENT } from './glsl/passes.glsl';

const SHADOW_STEPS = 26;
/** A full re-bake is spread over this many frames (clouds drift ~1 m in that time against ~70 m texels). */
const SLICES = 4;

function createShadowTarget(size: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    // Must be true when the storage is allocated (immutable texStorage gets its mip levels then); toggled per bake.
    generateMipmaps: true,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt;
}

/**
 * Bakes sun transmittance through the cloud layer into a texture centred on the camera's view region
 * (indexed on the reference plane, see cloudshadow.glsl.ts). Double-buffered: the back buffer is re-baked a quarter
 * of its rows per frame (scissored) and swapped in, with its region, once complete (~0.06 ms per frame on high).
 */
export class CloudShadowMap {
  readonly material: THREE.ShaderMaterial;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private front = 0;
  private slice = 0;
  private hasFront = false;
  private size = 0;
  private extent = 36_000;
  private enabled = true;
  /** Region being baked into the back buffer (xy centre, z extent) and the region of the front buffer. */
  private readonly region = new THREE.Vector4();
  private readonly frontRegion = new THREE.Vector4();
  private readonly forward = new THREE.Vector3();
  private readonly initialized = new WeakSet<THREE.WebGLRenderTarget>();

  constructor(
    private readonly quad: FullscreenQuad,
    shared: CloudUniformSet,
    private readonly globals: CloudShadowGlobals,
  ) {
    this.material = createPassMaterial(
      `${SHARED_GLSL}\n${CLOUD_COMMON_GLSL}\n${SHADOW_FRAGMENT}`,
      { ...(shared as unknown as Record<string, THREE.IUniform>), uShadowRegion: { value: this.region } },
      { SHADOW_STEPS, SHADOW_SIZE: 512 },
    );
  }

  setLevel(level: CloudQualityLevel): void {
    const extentChanged = this.extent !== level.shadowExtent;
    this.extent = level.shadowExtent;
    this.enabled = true;
    if (level.shadowMapSize !== this.size) {
      this.size = level.shadowMapSize;
      this.targets?.[0].dispose();
      this.targets?.[1].dispose();
      this.targets = [createShadowTarget(this.size), createShadowTarget(this.size)];
      (this.material.defines as Record<string, number>).SHADOW_SIZE = this.size;
      this.material.needsUpdate = true;
      this.restart();
    } else if (extentChanged) {
      this.restart();
    }
  }

  disable(): void {
    this.enabled = false;
    this.globals.map.value = this.globals.white;
    this.globals.xform.value.w = 0;
    this.restart();
  }

  private restart(): void {
    this.hasFront = false;
    this.slice = 0;
  }

  private computeRegion(camera: THREE.Camera, sunDir: THREE.Vector3): void {
    const sy = Math.max(sunDir.y, 0.05);
    const cx = camera.matrixWorld.elements[12];
    const cz = camera.matrixWorld.elements[14];
    camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() > 1e-6) {
      this.forward.normalize();
    }
    let ox = (sunDir.x / sy) * CLOUD_SHADOW_REF_HEIGHT;
    let oz = (sunDir.z / sy) * CLOUD_SHADOW_REF_HEIGHT;
    const maxOffset = this.extent * 0.3;
    const len = Math.hypot(ox, oz);
    if (len > maxOffset) {
      ox *= maxOffset / len;
      oz *= maxOffset / len;
    }
    const texel = this.extent / this.size;
    const centerX = Math.round((cx + ox + this.forward.x * this.extent * 0.18) / texel) * texel;
    const centerZ = Math.round((cz + oz + this.forward.z * this.extent * 0.18) / texel) * texel;
    this.region.set(centerX, centerZ, this.extent, 0);
  }

  /** Bakes rows [slice/slices, (slice+1)/slices) of `rt`; the mip chain is rebuilt after the last slice. */
  private bakeSlice(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget, slice: number, slices: number): boolean {
    const rows = Math.ceil(this.size / slices);
    const y0 = slice * rows;
    const last = slice === slices - 1;
    if (!this.initialized.has(rt)) {
      rt.texture.generateMipmaps = true;
      renderer.initRenderTarget(rt);
      this.initialized.add(rt);
    }
    rt.scissor.set(0, y0, this.size, Math.max(0, Math.min(rows, this.size - y0)));
    rt.scissorTest = true;
    rt.texture.generateMipmaps = last;
    this.quad.render(renderer, this.material, rt);
    rt.scissorTest = false;
    rt.texture.generateMipmaps = false;
    return last;
  }

  update(renderer: THREE.WebGLRenderer, camera: THREE.Camera, sunDir: THREE.Vector3, night: number): void {
    const targets = this.targets;
    if (!this.enabled || !targets) {
      return;
    }
    const strength = (1 - THREE.MathUtils.smoothstep(night, 0.75, 0.98)) * THREE.MathUtils.smoothstep(sunDir.y, -0.01, 0.03);
    const xform = this.globals.xform.value;
    if (strength <= 0) {
      xform.w = 0;
      this.restart();
      return;
    }
    const prev = renderer.getRenderTarget();
    if (!this.hasFront) {
      // First bake (or after a reset): complete it in one frame so shadows never pop in late.
      this.computeRegion(camera, sunDir);
      const rt = targets[this.front];
      for (let i = 0; i < SLICES; i++) {
        this.bakeSlice(renderer, rt, i, SLICES);
      }
      this.frontRegion.copy(this.region);
      this.hasFront = true;
      this.slice = 0;
    } else {
      if (this.slice === 0) {
        this.computeRegion(camera, sunDir);
      }
      const back = targets[1 - this.front];
      if (this.bakeSlice(renderer, back, this.slice, SLICES)) {
        this.front = 1 - this.front;
        this.frontRegion.copy(this.region);
        this.slice = 0;
      } else {
        this.slice++;
      }
    }
    renderer.setRenderTarget(prev);
    this.globals.map.value = targets[this.front].texture;
    xform.set(this.frontRegion.x, this.frontRegion.y, 1 / this.frontRegion.z, strength);
  }

  /** Debug: R channel of the current map as a grayscale byte array (row 0 = v 0). */
  readback(renderer: THREE.WebGLRenderer): { size: number; data: Uint8Array; region: number[] } | null {
    if (!this.targets) {
      return null;
    }
    const px = new Uint8Array(this.size * this.size * 4);
    renderer.readRenderTargetPixels(this.targets[this.front], 0, 0, this.size, this.size, px);
    const data = new Uint8Array(this.size * this.size);
    for (let i = 0; i < data.length; i++) {
      data[i] = px[i * 4];
    }
    return { size: this.size, data, region: this.frontRegion.toArray() };
  }

  /** Debug: average wall time (ms) of one full (all slices) synchronous re-bake. */
  benchmark(renderer: THREE.WebGLRenderer, camera: THREE.Camera, sunDir: THREE.Vector3, iterations: number): number {
    if (!this.targets) {
      return -1;
    }
    const rt = this.targets[1 - this.front];
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    const sync = (): void => {
      renderer.setRenderTarget(rt);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    };
    this.computeRegion(camera, sunDir);
    sync();
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      for (let s = 0; s < SLICES; s++) {
        this.bakeSlice(renderer, rt, s, SLICES);
      }
    }
    sync();
    this.restart();
    return (performance.now() - t0) / iterations;
  }

  dispose(): void {
    this.targets?.[0].dispose();
    this.targets?.[1].dispose();
    this.material.dispose();
  }
}
