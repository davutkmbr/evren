import * as THREE from 'three';

/** Full-screen triangle vertex shader for bake passes: vUv covers the target exactly. */
export const BAKE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Renders full-screen shader passes into render targets (or single layers of array targets). */
export class GpuBaker {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(geometry);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Compiles the material's program without blocking (KHR_parallel_shader_compile when available). */
  async prepare(material: THREE.Material): Promise<void> {
    this.quad.material = material;
    await this.renderer.compileAsync(this.scene, this.camera);
  }

  render(material: THREE.Material, target: THREE.WebGLRenderTarget, layer = 0): void {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevLayer = r.getActiveCubeFace();
    const prevMip = r.getActiveMipmapLevel();
    const prevAutoClear = r.autoClear;
    const prevXr = r.xr.enabled;
    r.xr.enabled = false;
    r.autoClear = false;
    this.quad.material = material;
    r.setRenderTarget(target, layer);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prevTarget, prevLayer, prevMip);
    r.autoClear = prevAutoClear;
    r.xr.enabled = prevXr;
  }

  dispose(): void {
    this.quad.geometry.dispose();
  }
}

export function bakeMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string | number> = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: BAKE_VERTEX,
    fragmentShader,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    fog: false,
    toneMapped: false,
  });
}
