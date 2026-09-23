import * as THREE from 'three';

/** Vertex shader for a single oversized triangle; `vUv` spans [0,1] over the viewport. */
export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export interface PostMaterialOptions {
  name: string;
  fragmentShader: string;
  vertexShader?: string;
  uniforms: Record<string, THREE.IUniform>;
  defines?: Record<string, string | number | boolean>;
  blending?: 'none' | 'additive';
}

export function createPostMaterial(opts: PostMaterialOptions): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    name: opts.name,
    vertexShader: opts.vertexShader ?? FULLSCREEN_VERTEX,
    fragmentShader: opts.fragmentShader,
    uniforms: opts.uniforms,
    defines: opts.defines ?? {},
    depthTest: false,
    depthWrite: false,
    fog: false,
    lights: false,
    toneMapped: false,
  });
  if (opts.blending === 'additive') {
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneFactor;
    material.blendEquation = THREE.AddEquation;
    material.blendSrcAlpha = THREE.ZeroFactor;
    material.blendDstAlpha = THREE.OneFactor;
  } else {
    material.blending = THREE.NoBlending;
  }
  return material;
}

/**
 * Draws full-screen passes with one shared triangle. Rendering a Mesh directly (instead of a Scene)
 * skips scene traversal, lights, fog and background handling.
 */
export class FullscreenRenderer {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry: THREE.BufferGeometry;
  private readonly mesh: THREE.Mesh;

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.mesh = new THREE.Mesh(this.geometry);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldAutoUpdate = false;
  }

  /** Renders `material` over the whole target (null = canvas). Never clears. */
  draw(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.mesh, this.camera);
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
