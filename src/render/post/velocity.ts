import * as THREE from 'three';
import { motionRoots, reactiveRoots } from '../../core/motion';

/**
 * Screen-space velocity of the tracked moving objects (core/motion.ts), for the TAA resolve (phase 25, stage 2).
 * Every visible mesh under a tracked root is drawn once more with one shader that transforms each vertex twice: with
 * this frame's matrices (and bones) and with the previous frame's. Output per pixel: xy = NDC motion (current minus
 * previous, unjittered), z = current view depth, w = previous view depth; z = 0 where no tracked object was drawn.
 * The target has its own depth buffer (the objects occlude each other); occlusion by the rest of the scene is resolved
 * in the TAA pass by comparing z with the scene depth. Vertex effects of the objects' own materials (breathing, wing
 * membrane flutter) are left out: they move a few centimetres.
 *
 * Reactive mask (stage 3): the movers registered with trackReactive (traffic, crowd, animals: GPU-animated or
 * instanced, no previous transforms to reproduce) are drawn once more with their own materials by a copy of the main
 * camera into `mask` (depth only matters). For that render the scene's child list is swapped for the lights and the
 * visible reactive roots: the lights keep every material on its program, the roots keep their real parents (world
 * matrices), and the renderer does not walk the whole scene (~0.9 ms). The resolve lowers the history weight where the
 * mask's depth matches the scene's.
 */

const VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform mat4 uPrevModel;
uniform mat4 uViewProj;
uniform mat4 uPrevViewProj;
#ifdef USE_SKINNING
uniform highp sampler2D uPrevBones;
// three's bone matrices are world-space and bindMatrixInverse follows the mesh's world matrix every frame (attached
// bind mode): the previous skinned position needs the previous bindMatrixInverse, or the motion counts twice.
uniform mat4 uPrevBindInverse;
mat4 prevBoneMatrix(const in float i) {
  int size = textureSize(uPrevBones, 0).x;
  int j = int(i) * 4;
  int x = j % size;
  int y = j / size;
  return mat4(texelFetch(uPrevBones, ivec2(x, y), 0), texelFetch(uPrevBones, ivec2(x + 1, y), 0),
              texelFetch(uPrevBones, ivec2(x + 2, y), 0), texelFetch(uPrevBones, ivec2(x + 3, y), 0));
}
#endif
varying vec4 vCur;
varying vec4 vPrev;
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  vec3 prevT = transformed;
  #include <skinning_vertex>
  #ifdef USE_SKINNING
    vec4 pv = bindMatrix * vec4(prevT, 1.0);
    vec4 ps = prevBoneMatrix(skinIndex.x) * pv * skinWeight.x + prevBoneMatrix(skinIndex.y) * pv * skinWeight.y +
              prevBoneMatrix(skinIndex.z) * pv * skinWeight.z + prevBoneMatrix(skinIndex.w) * pv * skinWeight.w;
    prevT = (uPrevBindInverse * ps).xyz;
  #endif
  vec4 wc = modelMatrix * vec4(transformed, 1.0);
  vec4 wp = uPrevModel * vec4(prevT, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wc;
  vCur = uViewProj * wc;
  vPrev = uPrevViewProj * wp;
}
`;

const FRAGMENT = /* glsl */ `
varying vec4 vCur;
varying vec4 vPrev;
void main() {
  gl_FragColor = vec4(vCur.xy / vCur.w - vPrev.xy / vPrev.w, vCur.w, vPrev.w);
}
`;

interface Previous {
  model: THREE.Matrix4;
  bindInverse: THREE.Matrix4;
  bones: THREE.DataTexture | null;
}

const _clear = new THREE.Color();
/** Lights are re-collected this often, in frames. */
const LIGHT_SCAN_FRAMES = 120;

export class ObjectVelocity {
  readonly target: THREE.WebGLRenderTarget;
  /** Reactive movers' depth (stage 3); `reactive` says whether it holds anything this frame. */
  readonly mask: THREE.WebGLRenderTarget;
  reactive = false;
  /** CPU time of the reactive pass (ms, smoothed; diagnostics). */
  reactiveMs = 0;
  private readonly maskCamera = new THREE.PerspectiveCamera();
  private lightScan = 0;
  private readonly lights: THREE.Light[] = [];
  private readonly children: THREE.Object3D[] = [];
  private readonly material: THREE.ShaderMaterial;
  private readonly previous = new WeakMap<THREE.Object3D, Previous>();
  private readonly drawn: THREE.Mesh[] = [];
  private readonly saved: THREE.Material[] = [];
  /** Whether the last render drew anything (the resolve skips the lookups otherwise). */
  active = false;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.target.texture.name = 'post.velocity';
    const maskDepth = new THREE.DepthTexture(1, 1, THREE.FloatType);
    maskDepth.minFilter = THREE.NearestFilter;
    maskDepth.magFilter = THREE.NearestFilter;
    this.mask = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      depthTexture: maskDepth,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.mask.texture.name = 'post.reactiveMask';
    this.maskCamera.matrixAutoUpdate = false;
    this.maskCamera.matrixWorldAutoUpdate = false;
    (this.maskCamera as unknown as { _reversedDepth: boolean })._reversedDepth = true;
    this.material = new THREE.ShaderMaterial({
      name: 'post.velocity',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uPrevModel: { value: new THREE.Matrix4() },
        uViewProj: { value: new THREE.Matrix4() },
        uPrevViewProj: { value: new THREE.Matrix4() },
        uPrevBones: { value: null },
        uPrevBindInverse: { value: new THREE.Matrix4() },
      },
      side: THREE.DoubleSide,
      fog: false,
      lights: false,
      toneMapped: false,
    });
    // Per object: its previous model matrix and bones (uniforms re-uploaded for every object).
    this.material.onBeforeRender = (_r, _s, _c, _g, object) => {
      const prev = this.previous.get(object);
      const u = this.material.uniforms;
      (u.uPrevModel.value as THREE.Matrix4).copy(prev ? prev.model : object.matrixWorld);
      const skinned = object as THREE.SkinnedMesh;
      u.uPrevBones.value = skinned.isSkinnedMesh ? (prev?.bones ?? skinned.skeleton.boneTexture) : null;
      if (skinned.isSkinnedMesh) {
        (u.uPrevBindInverse.value as THREE.Matrix4).copy(prev ? prev.bindInverse : skinned.bindMatrixInverse);
      }
      this.material.uniformsNeedUpdate = true;
    };
  }

  /**
   * Draws the tracked objects' velocity. `camera` carries this frame's (jittered) projection, `viewProj` and
   * `prevViewProj` are the unjittered matrices of this and the previous frame.
   */
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, viewProj: THREE.Matrix4, prevViewProj: THREE.Matrix4, width: number, height: number): void {
    if (this.target.width !== width || this.target.height !== height) {
      this.target.setSize(width, height);
    }
    const u = this.material.uniforms;
    (u.uViewProj.value as THREE.Matrix4).copy(viewProj);
    (u.uPrevViewProj.value as THREE.Matrix4).copy(prevViewProj);
    const previousTarget = renderer.getRenderTarget();
    renderer.getClearColor(_clear);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.active = false;
    for (const root of motionRoots) {
      if (!root.visible || !root.parent) {
        continue;
      }
      this.drawn.length = 0;
      root.traverseVisible((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && !(mesh as unknown as THREE.InstancedMesh).isInstancedMesh && mesh.layers.test(camera.layers)) {
          this.drawn.push(mesh);
        }
      });
      if (!this.drawn.length) {
        continue;
      }
      this.saved.length = 0;
      for (const m of this.drawn) {
        this.saved.push(m.material as THREE.Material);
        m.material = this.material;
      }
      try {
        for (const m of this.drawn) {
          renderer.render(m, camera);
        }
      } finally {
        this.drawn.forEach((m, i) => {
          m.material = this.saved[i];
        });
      }
      this.active = true;
      for (const m of this.drawn) {
        this.remember(m);
      }
    }
    renderer.autoClear = autoClear;
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(_clear, clearAlpha);
  }

  /**
   * Draws the reactive movers into `mask` with their own materials: the main camera's (jittered) matrices, only the
   * reactive layer. Call right after the scene render, from inside the jitter.
   */
  renderReactive(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number): void {
    const t0 = performance.now();
    this.reactive = false;
    try {
      this.drawReactive(renderer, scene, camera, width, height);
    } finally {
      this.reactiveMs += (performance.now() - t0 - this.reactiveMs) * 0.1;
    }
  }

  private drawReactive(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number): void {
    if (reactiveRoots.size === 0) {
      return;
    }
    const list = this.children;
    list.length = 0;
    for (const root of reactiveRoots) {
      if (visibleInScene(root, scene)) {
        list.push(root);
      }
    }
    if (!list.length) {
      return;
    }
    if (this.lightScan-- <= 0) {
      this.lightScan = LIGHT_SCAN_FRAMES;
      this.lights.length = 0;
      scene.traverse((o) => {
        if ((o as THREE.Light).isLight) {
          this.lights.push(o as THREE.Light);
        }
      });
    }
    list.push(...this.lights);
    if (this.mask.width !== width || this.mask.height !== height) {
      this.mask.setSize(width, height);
    }
    const cam = this.maskCamera;
    cam.matrixWorld.copy(camera.matrixWorld);
    cam.matrixWorldInverse.copy(camera.matrixWorldInverse);
    cam.projectionMatrix.copy(camera.projectionMatrix);
    cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    cam.near = camera.near;
    cam.far = camera.far;
    cam.fov = camera.fov;
    cam.aspect = camera.aspect;
    cam.layers.mask = camera.layers.mask;
    const previousTarget = renderer.getRenderTarget();
    renderer.getClearColor(_clear);
    const clearAlpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    renderer.setRenderTarget(this.mask);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.autoClear = false;
    const children = scene.children;
    const autoUpdate = scene.matrixWorldAutoUpdate;
    scene.children = this.children;
    scene.matrixWorldAutoUpdate = false;
    try {
      renderer.render(scene, cam);
      this.reactive = true;
    } finally {
      scene.children = children;
      scene.matrixWorldAutoUpdate = autoUpdate;
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(_clear, clearAlpha);
    }
  }

  /** Keeps this frame's model matrix and bones as the next frame's previous ones. */
  private remember(mesh: THREE.Mesh): void {
    let prev = this.previous.get(mesh);
    if (!prev) {
      prev = { model: new THREE.Matrix4(), bindInverse: new THREE.Matrix4(), bones: null };
      this.previous.set(mesh, prev);
    }
    prev.model.copy(mesh.matrixWorld);
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      prev.bindInverse.copy(skinned.bindMatrixInverse);
    }
    if (skinned.isSkinnedMesh && skinned.skeleton.boneTexture) {
      const src = skinned.skeleton.boneTexture;
      const img = src.image as { data: Float32Array; width: number; height: number };
      if (!prev.bones || (prev.bones.image as { data: Float32Array }).data.length !== img.data.length) {
        prev.bones?.dispose();
        prev.bones = new THREE.DataTexture(new Float32Array(img.data.length), img.width, img.height, THREE.RGBAFormat, THREE.FloatType);
      }
      (prev.bones.image as { data: Float32Array }).data.set(img.data);
      prev.bones.needsUpdate = true;
    }
  }

  dispose(): void {
    this.target.dispose();
    this.mask.dispose();
    this.material.dispose();
  }
}

/** Whether `object` and every ancestor up to `scene` are visible. */
function visibleInScene(object: THREE.Object3D, scene: THREE.Scene): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) {
    if (!o.visible) {
      return false;
    }
    if (o === scene) {
      return true;
    }
  }
  return false;
}
