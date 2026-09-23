import * as THREE from 'three';

export interface BakeTargetOptions {
  width: number;
  height: number;
  type?: THREE.TextureDataType;
  srgb?: boolean;
  mipmaps?: boolean;
  wrap?: THREE.Wrapping;
  anisotropy?: number;
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Renders full-screen fragment programs into textures (runtime procedural texture generation). */
export class TextureBaker {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly materials = new Map<string, THREE.ShaderMaterial>();

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new THREE.Mesh(geo);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  createTarget(opts: BakeTargetOptions): THREE.WebGLRenderTarget {
    const mip = opts.mipmaps ?? true;
    const rt = new THREE.WebGLRenderTarget(opts.width, opts.height, {
      type: opts.type ?? THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: mip,
      minFilter: mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: opts.wrap ?? THREE.RepeatWrapping,
      wrapT: opts.wrap ?? THREE.RepeatWrapping,
      anisotropy: opts.anisotropy ?? 1,
      colorSpace: opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    });
    return rt;
  }

  /** Runs `fragmentShader` over the whole target. Uniform `vUv` varying is available (0..1). */
  bake(target: THREE.WebGLRenderTarget, fragmentShader: string, uniforms: Record<string, THREE.IUniform>): void {
    let material = this.materials.get(fragmentShader);
    if (!material) {
      material = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      this.materials.set(fragmentShader, material);
    } else {
      // Programs are cached per shader source: only the uniform values change between bakes.
      for (const key in uniforms) {
        const u = material.uniforms[key];
        if (u) {
          u.value = uniforms[key].value;
        } else {
          material.uniforms[key] = uniforms[key];
        }
      }
    }
    this.quad.material = material;
    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevToneMapping = renderer.toneMapping;
    const prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    renderer.toneMapping = prevToneMapping;
    renderer.xr.enabled = prevXr;
    // Drop texture references so baked inputs can be garbage collected.
    for (const key in material.uniforms) {
      const u = material.uniforms[key];
      if (u.value instanceof THREE.Texture) {
        u.value = null;
      }
    }
  }

  dispose(): void {
    this.quad.geometry.dispose();
    for (const m of this.materials.values()) {
      m.dispose();
    }
    this.materials.clear();
  }
}
