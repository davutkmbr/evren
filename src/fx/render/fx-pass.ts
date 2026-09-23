import * as THREE from 'three';
import type { EngineContext, HdrPass, HdrPassInputs } from '../../core/contracts';
import { RenderLayers } from '../../core/contracts';
import type { ParticlePool } from '../particles/particle-pool';
import { COMPOSITE_FRAGMENT, FULLSCREEN_VERTEX } from '../shaders/composite.glsl';
import { SHARP_FRAGMENT, SHARP_VERTEX } from '../shaders/sharp.glsl';
import { TRAIL_FRAGMENT, TRAIL_VERTEX } from '../shaders/trail.glsl';
import { VOLUMETRIC_FRAGMENT, VOLUMETRIC_VERTEX } from '../shaders/volumetric.glsl';
import type { NoiseVolumes } from './noise-volumes';

/** Values the fx system writes every frame before the pass renders. */
export interface FxRenderState {
  now: number;
  wind: THREE.Vector3;
  camVel: THREE.Vector3;
  volCount: number;
  /** Live sharp particles listed in the sharp order array; speed motes are drawn as the instances after them. */
  sharpCount: number;
  moteCount: number;
  moteBox: number;
  moteOffset: THREE.Vector3;
  moteStrength: number;
  moteSize: number;
  trailsVisible: boolean;
  trailLife: number;
  fireLightPos: [THREE.Vector3, THREE.Vector3];
  fireLightColor: [THREE.Color, THREE.Color];
  hazeStrength: number;
}

/** Upper bound of speed motes per frame (instances appended after the sharp particles). */
export const MAX_MOTES = 1400;

const PREMULTIPLIED: Partial<THREE.ShaderMaterialParameters> = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  fog: false,
  lights: false,
  side: THREE.DoubleSide,
};

function quadGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.instanceCount = 0;
  return g;
}

function ribbonGeometry(points: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const pos = new Float32Array(points * 2 * 3);
  for (let k = 0; k < points; k++) {
    pos[k * 6] = k;
    pos[k * 6 + 1] = -1;
    pos[k * 6 + 3] = k;
    pos[k * 6 + 4] = 1;
  }
  const index: number[] = [];
  for (let k = 0; k < points - 1; k++) {
    const a = k * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(index);
  g.instanceCount = 2;
  return g;
}

/**
 * HDR pass: (1) sorted volumetric particles -> half-res MRT (premultiplied color + heat/opacity depth), (2) full-res
 * composite with joint-bilateral upsampling and heat haze, (3) trails + sharp particles blended on top (trails fade
 * behind the particle layer's opacity where it lies in front of them). Manual soft depth tests against the scene
 * depth; nothing writes depth. 3-4 draw calls when active, disabled when idle.
 */
export class FxPass implements HdrPass {
  readonly name = 'fx-particles';
  readonly order = 150;
  enabled = false;
  lowScale = 0.5;

  private lowTarget: THREE.WebGLRenderTarget;
  private readonly volMaterial: THREE.ShaderMaterial;
  private readonly sharpMaterial: THREE.ShaderMaterial;
  private readonly trailMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly volGeometry: THREE.InstancedBufferGeometry;
  private readonly sharpGeometry: THREE.InstancedBufferGeometry;
  private readonly trailGeometry: THREE.InstancedBufferGeometry;
  private slotAttribute: THREE.InstancedBufferAttribute;
  private sharpSlotAttribute: THREE.InstancedBufferAttribute;
  private readonly volScene = new THREE.Scene();
  private readonly overlayScene = new THREE.Scene();
  private readonly compositeScene = new THREE.Scene();
  private readonly trailMesh: THREE.Mesh;
  private readonly sharpMesh: THREE.Mesh;
  private readonly orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly clearColor = new THREE.Color();
  private readonly shared: Record<string, THREE.IUniform>;

  constructor(
    private readonly state: FxRenderState,
    volumes: NoiseVolumes,
    blackbody: THREE.Texture,
    trailTexture: THREE.Texture,
    trailPoints: number,
  ) {
    this.lowTarget = this.createLowTarget(2, 2);
    this.shared = {
      uNow: { value: 0 },
      uWindFx: { value: new THREE.Vector3() },
      uCamVel: { value: new THREE.Vector3() },
      uShutter: { value: 1 / 60 },
      uTanHalfFov: { value: Math.tan(Math.PI / 6) },
      tCurl: { value: volumes.curl },
      tNoise: { value: volumes.noise },
      tBlackbody: { value: blackbody },
      tDepth: { value: null },
    };
    const s = this.shared;

    this.volMaterial = new THREE.ShaderMaterial({
      ...PREMULTIPLIED,
      uniforms: {
        ...s,
        tData: { value: null },
        uInvTarget: { value: new THREE.Vector2(1, 1) },
        uTargetHeight: { value: 1 },
        uNearFade: { value: 0.3 },
        uFireLightPos0: { value: state.fireLightPos[0] },
        uFireLightPos1: { value: state.fireLightPos[1] },
        uFireLightCol0: { value: state.fireLightColor[0] },
        uFireLightCol1: { value: state.fireLightColor[1] },
      },
      vertexShader: VOLUMETRIC_VERTEX,
      fragmentShader: VOLUMETRIC_FRAGMENT,
    });
    const fullInv = { value: new THREE.Vector2(1, 1) };
    const fullHeight = { value: 1 };
    this.sharpMaterial = new THREE.ShaderMaterial({
      ...PREMULTIPLIED,
      uniforms: {
        ...s,
        tData: { value: null },
        uInvTarget: fullInv,
        uTargetHeight: fullHeight,
        uSharpCount: { value: 0 },
        uMoteBox: { value: 36 },
        uMoteOffset: { value: state.moteOffset },
        uMoteStrength: { value: 0 },
        uMoteSize: { value: 0.012 },
      },
      vertexShader: SHARP_VERTEX,
      fragmentShader: SHARP_FRAGMENT,
    });
    this.trailMaterial = new THREE.ShaderMaterial({
      ...PREMULTIPLIED,
      uniforms: {
        ...s,
        tTrail: { value: trailTexture },
        tVol: { value: null },
        tHeat: { value: null },
        uHasVol: { value: 0 },
        uPoints: { value: trailPoints },
        uSink: { value: 1.3 },
        uTrailLife: { value: 3 },
        uInvTarget: fullInv,
        uTargetHeight: fullHeight,
      },
      vertexShader: TRAIL_VERTEX,
      fragmentShader: TRAIL_FRAGMENT,
    });
    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tDepth: s.tDepth,
        tVol: { value: null },
        tHeat: { value: null },
        tNoise: s.tNoise,
        uLowSize: { value: new THREE.Vector2(1, 1) },
        uFullSize: { value: new THREE.Vector2(1, 1) },
        uHasVol: { value: 0 },
        uHazeStrength: { value: 8 },
        uFxTime: s.uNow,
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      fog: false,
    });

    this.volGeometry = quadGeometry();
    this.slotAttribute = new THREE.InstancedBufferAttribute(new Float32Array(1), 1);
    this.volGeometry.setAttribute('aSlot', this.slotAttribute);
    const volMesh = new THREE.Mesh(this.volGeometry, this.volMaterial);
    volMesh.frustumCulled = false;
    volMesh.layers.set(RenderLayers.NoReflection);
    this.volScene.add(volMesh);

    this.trailGeometry = ribbonGeometry(trailPoints);
    this.trailMesh = new THREE.Mesh(this.trailGeometry, this.trailMaterial);
    this.trailMesh.frustumCulled = false;
    this.trailMesh.layers.set(RenderLayers.NoReflection);
    this.trailMesh.renderOrder = 0;
    this.sharpGeometry = quadGeometry();
    this.sharpSlotAttribute = new THREE.InstancedBufferAttribute(new Float32Array(1), 1);
    this.sharpGeometry.setAttribute('aSlot', this.sharpSlotAttribute);
    this.sharpMesh = new THREE.Mesh(this.sharpGeometry, this.sharpMaterial);
    this.sharpMesh.frustumCulled = false;
    this.sharpMesh.layers.set(RenderLayers.NoReflection);
    this.sharpMesh.renderOrder = 1;
    this.overlayScene.add(this.trailMesh, this.sharpMesh);

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMaterial);
    quad.frustumCulled = false;
    this.compositeScene.add(quad);
  }

  /** Binds (new) particle pools; the slot attributes are sized to the pools (sharp: + speed motes). */
  setPools(vol: ParticlePool, sharp: ParticlePool): void {
    this.volMaterial.uniforms.tData.value = vol.texture;
    this.sharpMaterial.uniforms.tData.value = sharp.texture;
    // Frees the GPU buffers of the previous slot attributes (three re-uploads the rest lazily).
    this.volGeometry.dispose();
    this.slotAttribute = new THREE.InstancedBufferAttribute(new Float32Array(vol.capacity), 1);
    this.slotAttribute.setUsage(THREE.DynamicDrawUsage);
    this.volGeometry.setAttribute('aSlot', this.slotAttribute);
    this.volGeometry.instanceCount = 0;
    this.sharpGeometry.dispose();
    this.sharpSlotAttribute = new THREE.InstancedBufferAttribute(new Float32Array(sharp.capacity + MAX_MOTES), 1);
    this.sharpSlotAttribute.setUsage(THREE.DynamicDrawUsage);
    this.sharpGeometry.setAttribute('aSlot', this.sharpSlotAttribute);
    this.sharpGeometry.instanceCount = 0;
  }

  /** Draw order array for the volumetric pool (fill `count` entries, then call commitOrder). */
  get orderArray(): Float32Array {
    return this.slotAttribute.array as Float32Array;
  }

  commitOrder(count: number): void {
    if (count > 0) {
      this.slotAttribute.clearUpdateRanges();
      this.slotAttribute.addUpdateRange(0, count);
      this.slotAttribute.needsUpdate = true;
    }
    this.volGeometry.instanceCount = count;
  }

  /** Slot list of the sharp pool (fill `count` entries, then call commitSharp). */
  get sharpOrderArray(): Float32Array {
    return this.sharpSlotAttribute.array as Float32Array;
  }

  commitSharp(count: number): void {
    if (count > 0) {
      this.sharpSlotAttribute.clearUpdateRanges();
      this.sharpSlotAttribute.addUpdateRange(0, count);
      this.sharpSlotAttribute.needsUpdate = true;
    }
  }

  render(renderer: THREE.WebGLRenderer, inputs: HdrPassInputs, output: THREE.WebGLRenderTarget, ctx: EngineContext): void {
    const st = this.state;
    const camera = ctx.camera;
    const w = output.width;
    const h = output.height;
    const lw = Math.max(1, Math.round(w * this.lowScale));
    const lh = Math.max(1, Math.round(h * this.lowScale));
    if (this.lowTarget.width !== lw || this.lowTarget.height !== lh) {
      this.lowTarget.setSize(lw, lh);
    }

    const s = this.shared;
    s.uNow.value = st.now;
    (s.uWindFx.value as THREE.Vector3).copy(st.wind);
    (s.uCamVel.value as THREE.Vector3).copy(st.camVel);
    s.uTanHalfFov.value = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) / Math.max(camera.zoom, 1e-3);
    s.tDepth.value = inputs.depth;

    const vu = this.volMaterial.uniforms;
    (vu.uInvTarget.value as THREE.Vector2).set(1 / lw, 1 / lh);
    vu.uTargetHeight.value = lh;
    vu.uNearFade.value = Math.max(camera.near, 0.25);
    const su = this.sharpMaterial.uniforms;
    (su.uInvTarget.value as THREE.Vector2).set(1 / w, 1 / h);
    su.uTargetHeight.value = h;
    su.uSharpCount.value = st.sharpCount;
    su.uMoteBox.value = st.moteBox;
    su.uMoteStrength.value = st.moteStrength;
    su.uMoteSize.value = st.moteSize;
    const sharpInstances = st.sharpCount + st.moteCount;
    this.sharpGeometry.instanceCount = sharpInstances;
    this.trailMaterial.uniforms.uTrailLife.value = st.trailLife;
    this.trailMesh.visible = st.trailsVisible;
    this.sharpMesh.visible = sharpInstances > 0;

    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();

    const hasVol = st.volCount > 0;
    if (hasVol) {
      renderer.setRenderTarget(this.lowTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.render(this.volScene, camera);
    }

    const cu = this.compositeMaterial.uniforms;
    cu.tScene.value = inputs.color;
    cu.tVol.value = this.lowTarget.textures[0];
    cu.tHeat.value = this.lowTarget.textures[1];
    cu.uHasVol.value = hasVol ? 1 : 0;
    (cu.uLowSize.value as THREE.Vector2).set(lw, lh);
    (cu.uFullSize.value as THREE.Vector2).set(w, h);
    cu.uHazeStrength.value = st.hazeStrength * (h / 900);
    renderer.setRenderTarget(output);
    renderer.render(this.compositeScene, this.orthoCamera);

    if (this.trailMesh.visible || this.sharpMesh.visible) {
      const tu = this.trailMaterial.uniforms;
      tu.tVol.value = this.lowTarget.textures[0];
      tu.tHeat.value = this.lowTarget.textures[1];
      tu.uHasVol.value = hasVol ? 1 : 0;
      renderer.render(this.overlayScene, camera);
    }

    renderer.setClearColor(this.clearColor, clearAlpha);
    renderer.autoClear = autoClear;
  }

  /**
   * Compiles every fx program up front (the pass scenes are not part of the main scene, so the engine's
   * compileAsync does not see them): avoids a hitch the first time the dragon breathes fire.
   */
  async precompile(renderer: THREE.WebGLRenderer, camera: THREE.Camera): Promise<void> {
    const scenes = [this.volScene, this.overlayScene, this.compositeScene];
    const visible = [this.trailMesh.visible, this.sharpMesh.visible];
    this.trailMesh.visible = true;
    this.sharpMesh.visible = true;
    try {
      for (const scene of scenes) {
        await renderer.compileAsync(scene, scene === this.compositeScene ? this.orthoCamera : camera);
      }
    } finally {
      this.trailMesh.visible = visible[0];
      this.sharpMesh.visible = visible[1];
    }
  }

  /**
   * Draws every program once into tiny targets with the pipeline's formats (RGBA16F output, MRT half-res layer):
   * ANGLE/Metal builds pipeline state objects at the first draw, not at compile time.
   */
  warmUp(renderer: THREE.WebGLRenderer, ctx: EngineContext): void {
    const input = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(4, 4, THREE.FloatType),
    });
    const output = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    const st = this.state;
    const saved = [st.volCount, st.sharpCount, st.trailsVisible] as const;
    const prevTarget = renderer.getRenderTarget();
    try {
      this.orderArray[0] = 0;
      this.commitOrder(1);
      this.sharpOrderArray[0] = 0;
      this.commitSharp(1);
      st.volCount = 1;
      st.sharpCount = 1;
      st.trailsVisible = true;
      this.render(renderer, { color: input.texture, depth: input.depthTexture as THREE.DepthTexture }, output, ctx);
    } finally {
      [st.volCount, st.sharpCount, st.trailsVisible] = saved;
      this.commitOrder(0);
      renderer.setRenderTarget(prevTarget);
      input.depthTexture?.dispose();
      input.dispose();
      output.dispose();
    }
  }

  setSize(): void {
    /* The low-resolution target follows the output size lazily in render(). */
  }

  private createLowTarget(w: number, h: number): THREE.WebGLRenderTarget {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      count: 2,
      // Linear: the ribbons take one filtered tap; the composite samples texel centres (same as nearest there).
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    return rt;
  }

  dispose(): void {
    this.lowTarget.dispose();
    this.volMaterial.dispose();
    this.sharpMaterial.dispose();
    this.trailMaterial.dispose();
    this.compositeMaterial.dispose();
    this.volGeometry.dispose();
    this.sharpGeometry.dispose();
    this.trailGeometry.dispose();
    (this.compositeScene.children[0] as THREE.Mesh).geometry.dispose();
  }
}
