import * as THREE from 'three';
import { SMAABlendShader, SMAAEdgesShader, SMAAWeightsShader } from 'three/examples/jsm/shaders/SMAAShader.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { createPostMaterial, type FullscreenRenderer } from './fullscreen';
import { createColorTarget } from './targets';
import { FXAA_FRAG } from './shaders/fxaa.glsl';

/** Post anti-aliasing on the display-encoded (gamma) image at internal resolution. */
export interface AntialiasPass {
  /** Returns false when nothing was written (caller keeps using `input`). */
  render(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget): boolean;
  setSize(width: number, height: number): void;
  /** Draws every material once (compiles the programs up front instead of mid-flight). */
  warmUp(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget): void;
  dispose(): void;
}

export class FxaaPass implements AntialiasPass {
  private readonly material = createPostMaterial({
    name: 'post.fxaa',
    fragmentShader: FXAA_FRAG,
    uniforms: { tSource: { value: null }, uTexel: { value: new THREE.Vector2() } },
  });

  render(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget): boolean {
    this.material.uniforms.tSource.value = input.texture;
    fs.draw(renderer, this.material, output);
    return true;
  }

  warmUp(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget): void {
    this.render(renderer, fs, input, output);
  }

  setSize(width: number, height: number): void {
    (this.material.uniforms.uTexel.value as THREE.Vector2).set(1 / width, 1 / height);
  }

  dispose(): void {
    this.material.dispose();
  }
}

interface ShaderDef {
  defines?: Record<string, string>;
  uniforms: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
}

interface SmaaLookupSource {
  _getAreaTexture(): string;
  _getSearchTexture(): string;
}

/** Replaces three's camera transform with a clip-space full-screen triangle and returns a post material. */
function smaaMaterial(name: string, def: ShaderDef, defines: Record<string, string>): THREE.ShaderMaterial {
  const vertexShader = def.vertexShader.replace(/gl_Position\s*=\s*projectionMatrix\s*\*\s*modelViewMatrix\s*\*\s*vec4\(\s*position\s*,\s*1\.0\s*\)\s*;/, 'gl_Position = vec4( position.xy, 0.0, 1.0 );');
  return createPostMaterial({
    name,
    vertexShader,
    fragmentShader: def.fragmentShader,
    uniforms: THREE.UniformsUtils.clone(def.uniforms),
    defines: { ...(def.defines ?? {}), ...defines },
  });
}

function loadLookupTexture(dataUrl: string, name: string, nearest: boolean): THREE.Texture {
  const texture = new THREE.Texture();
  texture.name = name;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.minFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  texture.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  const image = new Image();
  image.onload = () => {
    texture.image = image;
    texture.needsUpdate = true;
  };
  image.src = dataUrl;
  return texture;
}

export function smaaAvailable(): boolean {
  const proto = SMAAPass.prototype as unknown as Partial<SmaaLookupSource>;
  return typeof proto._getAreaTexture === 'function' && typeof proto._getSearchTexture === 'function';
}

/**
 * SMAA 1x (three's port of SMAA v2.8, colour edges) with the "Medium" search (8 steps, threshold 0.1): MSAA already resolves geometric edges on the presets that use it.
 * The area/search lookup tables are the ones shipped as library code inside three's SMAAPass.
 */
export class SmaaPass implements AntialiasPass {
  private readonly edgesTarget: THREE.WebGLRenderTarget;
  private readonly weightsTarget: THREE.WebGLRenderTarget;
  private readonly edges: THREE.ShaderMaterial;
  private readonly weights: THREE.ShaderMaterial;
  private readonly blend: THREE.ShaderMaterial;
  private readonly areaTexture: THREE.Texture;
  private readonly searchTexture: THREE.Texture;

  constructor() {
    const proto = SMAAPass.prototype as unknown as SmaaLookupSource;
    this.areaTexture = loadLookupTexture(proto._getAreaTexture(), 'post.smaaArea', false);
    this.searchTexture = loadLookupTexture(proto._getSearchTexture(), 'post.smaaSearch', true);
    this.edgesTarget = createColorTarget(1, 1, { name: 'post.smaaEdges', type: THREE.UnsignedByteType });
    this.weightsTarget = createColorTarget(1, 1, { name: 'post.smaaWeights', type: THREE.UnsignedByteType });
    this.edges = smaaMaterial('post.smaaEdges', SMAAEdgesShader as ShaderDef, { SMAA_THRESHOLD: '0.1' });
    this.weights = smaaMaterial('post.smaaWeights', SMAAWeightsShader as ShaderDef, { SMAA_MAX_SEARCH_STEPS: '8' });
    this.blend = smaaMaterial('post.smaaBlend', SMAABlendShader as ShaderDef, {});
    this.weights.uniforms.tDiffuse.value = this.edgesTarget.texture;
    this.weights.uniforms.tArea.value = this.areaTexture;
    this.weights.uniforms.tSearch.value = this.searchTexture;
    this.blend.uniforms.tDiffuse.value = this.weightsTarget.texture;
  }

  render(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget): boolean {
    if (!this.areaTexture.image || !this.searchTexture.image) {
      return false;
    }
    this.draw(renderer, fs, input, output);
    return true;
  }

  /** Lookup textures may still be decoding: they bind as empty textures, which is fine for compiling. */
  warmUp(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget): void {
    this.draw(renderer, fs, input, output);
  }

  private draw(renderer: THREE.WebGLRenderer, fs: FullscreenRenderer, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget): void {
    this.edges.uniforms.tDiffuse.value = input.texture;
    renderer.setRenderTarget(this.edgesTarget);
    renderer.clear(true, false, false);
    fs.draw(renderer, this.edges, this.edgesTarget);
    fs.draw(renderer, this.weights, this.weightsTarget);
    this.blend.uniforms.tColor.value = input.texture;
    fs.draw(renderer, this.blend, output);
  }

  setSize(width: number, height: number): void {
    this.edgesTarget.setSize(width, height);
    this.weightsTarget.setSize(width, height);
    for (const m of [this.edges, this.weights, this.blend]) {
      (m.uniforms.resolution.value as THREE.Vector2).set(1 / width, 1 / height);
    }
  }

  dispose(): void {
    this.edgesTarget.dispose();
    this.weightsTarget.dispose();
    this.edges.dispose();
    this.weights.dispose();
    this.blend.dispose();
    this.areaTexture.dispose();
    this.searchTexture.dispose();
  }
}
