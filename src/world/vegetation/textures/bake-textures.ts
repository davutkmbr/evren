import * as THREE from 'three';
import { TEX_LAYER_COUNT, TexLayer } from '../species';
import { BARK_FRAGMENT, BARK_VERTEX } from './bark.glsl';
import { LEAF_FRAGMENT, LEAF_VERTEX } from './leaf.glsl';
import { buildLeafLayers, LEAF_MEAN_COLOR } from './twig-layouts';

/** Albedo (sRGB) and (normal.xy, AO, roughness|translucency) texture arrays shared by bark and foliage. */
export interface VegetationTextureSet {
  readonly target: THREE.WebGLArrayRenderTarget;
  readonly albedo: THREE.Texture;
  readonly normal: THREE.Texture;
  dispose(): void;
}

const CLEAR_FRAGMENT = /* glsl */ `
precision highp float;
layout(location = 0) out vec4 outAlbedo;
layout(location = 1) out vec4 outNormal;
uniform vec3 uColor;
void main() {
  outAlbedo = vec4(uColor, 0.0);
  outNormal = vec4(0.5, 0.5, 1.0, 0.0);
}
`;

const BARK_TYPES: Record<number, number> = {
  [TexLayer.BarkStonePine]: 0,
  [TexLayer.BarkPine]: 1,
  [TexLayer.BarkCypress]: 2,
  [TexLayer.BarkPlane]: 3,
  [TexLayer.BarkOak]: 4,
  [TexLayer.BarkPalm]: 5,
};

/** Creates a two-attachment texture-array target (albedo sRGB + linear data), mipmapped and repeating. */
export function createArrayTarget(size: number, layers: number, anisotropy: number, wrap: THREE.Wrapping, depthBuffer: boolean): THREE.WebGLArrayRenderTarget {
  const target = new THREE.WebGLArrayRenderTarget(size, size, layers, {
    count: 2,
    depthBuffer,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    generateMipmaps: false,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: wrap,
    wrapT: wrap,
    anisotropy,
  });
  const second = new THREE.DataArrayTexture(null, size, size, layers);
  second.isRenderTargetTexture = true;
  (second as unknown as { renderTarget: THREE.RenderTarget }).renderTarget = target;
  target.textures[1] = second;
  for (const t of target.textures) {
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = wrap;
    t.wrapT = wrap;
    t.anisotropy = anisotropy;
    t.generateMipmaps = false;
  }
  target.textures[0].colorSpace = THREE.SRGBColorSpace;
  target.textures[1].colorSpace = THREE.NoColorSpace;
  return target;
}

function fullscreenTriangle(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

/** Renders into one layer of an array target; the last call before `finish` should set generateMipmaps. */
export class LayerRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly prevTarget: THREE.WebGLRenderTarget | null;
  private readonly prevAutoClear: boolean;
  private readonly prevClearColor = new THREE.Color();
  private readonly prevClearAlpha: number;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.prevTarget = renderer.getRenderTarget();
    this.prevAutoClear = renderer.autoClear;
    renderer.getClearColor(this.prevClearColor);
    this.prevClearAlpha = renderer.getClearAlpha();
    renderer.autoClear = false;
  }

  draw(target: THREE.WebGLArrayRenderTarget, layer: number, object: THREE.Object3D, camera?: THREE.Camera): void {
    this.scene.add(object);
    this.renderer.setRenderTarget(target, layer);
    this.renderer.render(this.scene, camera ?? this.camera);
    this.scene.remove(object);
  }

  restore(): void {
    this.renderer.setRenderTarget(this.prevTarget);
    this.renderer.autoClear = this.prevAutoClear;
    this.renderer.setClearColor(this.prevClearColor, this.prevClearAlpha);
  }
}

/** Triggers mipmap generation of both attachments with one empty render. */
export function finishMipmaps(renderer: THREE.WebGLRenderer, target: THREE.WebGLArrayRenderTarget, lr: LayerRenderer): void {
  for (const t of target.textures) {
    t.generateMipmaps = true;
  }
  lr.draw(target, 0, new THREE.Group());
}

/**
 * Bakes every bark and foliage layer on the GPU (a few ms): bark from tileable procedural patterns, foliage by
 * rasterising procedural twig sprays leaf by leaf.
 */
export function bakeVegetationTextures(renderer: THREE.WebGLRenderer, size: number, anisotropy: number): VegetationTextureSet {
  const target = createArrayTarget(size, TEX_LAYER_COUNT, anisotropy, THREE.RepeatWrapping, false);
  const lr = new LayerRenderer(renderer);
  const tri = fullscreenTriangle();

  const clearMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: BARK_VERTEX,
    fragmentShader: CLEAR_FRAGMENT,
    uniforms: { uColor: { value: new THREE.Vector3(...LEAF_MEAN_COLOR) } },
    depthTest: false,
    depthWrite: false,
  });
  const barkMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: BARK_VERTEX,
    fragmentShader: BARK_FRAGMENT,
    uniforms: { uType: { value: 0 }, uTexel: { value: 1 / size } },
    depthTest: false,
    depthWrite: false,
  });
  const leafMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: LEAF_VERTEX,
    fragmentShader: LEAF_FRAGMENT,
    uniforms: {
      uColorA: { value: new THREE.Vector3() },
      uColorB: { value: new THREE.Vector3() },
      uTwigColor: { value: new THREE.Vector3() },
      uTranslucency: { value: 1 },
    },
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const clearMesh = new THREE.Mesh(tri, clearMat);
  clearMesh.frustumCulled = false;
  const barkMesh = new THREE.Mesh(tri, barkMat);
  barkMesh.frustumCulled = false;

  for (const [layer, type] of Object.entries(BARK_TYPES)) {
    barkMat.uniforms.uType.value = type;
    lr.draw(target, Number(layer), barkMesh);
  }

  const quad = new THREE.PlaneGeometry(1, 1);
  for (const spec of buildLeafLayers()) {
    lr.draw(target, spec.layer, clearMesh);
    const n = spec.instances.length;
    const a = new Float32Array(n * 4);
    const b = new Float32Array(n * 4);
    const c = new Float32Array(n * 4);
    spec.instances.forEach((l, i) => {
      a.set([l.x, l.y, l.angle, l.length], i * 4);
      b.set([l.halfWidth, l.shape, l.roll, l.pitch], i * 4);
      c.set([l.colorMix, l.bright, n > 1 ? i / (n - 1) : 1, l.fold], i * 4);
    });
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(a, 4));
    g.setAttribute('iB', new THREE.InstancedBufferAttribute(b, 4));
    g.setAttribute('iC', new THREE.InstancedBufferAttribute(c, 4));
    g.instanceCount = n;
    leafMat.uniforms.uColorA.value.set(...spec.colorA);
    leafMat.uniforms.uColorB.value.set(...spec.colorB);
    leafMat.uniforms.uTwigColor.value.set(...spec.twig);
    leafMat.uniforms.uTranslucency.value = spec.translucency;
    const mesh = new THREE.Mesh(g, leafMat);
    mesh.frustumCulled = false;
    lr.draw(target, spec.layer, mesh);
    g.dispose();
  }
  finishMipmaps(renderer, target, lr);
  lr.restore();

  tri.dispose();
  quad.dispose();
  clearMat.dispose();
  barkMat.dispose();
  leafMat.dispose();

  return {
    target,
    albedo: target.textures[0],
    normal: target.textures[1],
    dispose: () => target.dispose(),
  };
}
