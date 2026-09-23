import * as THREE from 'three';

/** Single oversized triangle drawn with its own scene/camera; used by every cloud pass. */
export class FullscreenQuad {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mesh: THREE.Mesh;

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.mesh = new THREE.Mesh(geometry);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.scene.matrixWorldAutoUpdate = false;
  }

  /** Renders `material` into `target` (layer = 3D texture slice). autoClear is suspended while drawing. */
  render(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null, layer = 0): void {
    this.mesh.material = material;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target, layer);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }

  /** Builds a scene containing one mesh per material, for renderer.compileAsync(). */
  compileScene(materials: THREE.Material[]): THREE.Scene {
    const scene = new THREE.Scene();
    for (const m of materials) {
      const mesh = new THREE.Mesh(this.mesh.geometry, m);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    return scene;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}

export function createPassMaterial(
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
  defines: Record<string, string | number> = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`,
    fragmentShader,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    blending: THREE.NoBlending,
  });
}
