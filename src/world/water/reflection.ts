/**
 * Planar reflection of the scene in the sea plane y = 0.
 * The mirror camera renders RenderLayers.Default only (small detail lives on NoReflection), with an oblique near
 * plane on the water (Lengyel) adapted to three's reversed-Z projection (clip z in [0, w], near -> w, far -> 0).
 * The result is mip-mapped so the water shader can blur it by the unresolved wave roughness.
 */
import * as THREE from 'three';
import { RenderLayers } from '../../core/contracts';

const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();
const _target = new THREE.Vector3();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
const _invProj = new THREE.Matrix4();
const _invProjT = new THREE.Matrix4();
const _clipPlaneClip = new THREE.Vector4();
const _bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 1, 0, 0, 0, 0, 1);
const _corner = new THREE.Vector3();
const _waterNormal = new THREE.Vector3(0, 1, 0);
const _ndc = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;

export class PlanarReflection {
  readonly camera = new THREE.PerspectiveCamera();
  /** World -> reflection texture uv (xy/w), without the oblique clip. */
  readonly textureMatrix = new THREE.Matrix4();
  target: THREE.WebGLRenderTarget;
  /** False when the last frame skipped the pass (camera under water / water not in view). */
  valid = false;
  /** Vertical field of view scale of the mirror camera relative to the main camera. */
  fovScale = 1.12;
  private width = 0;
  private height = 0;

  constructor(anisotropy: number) {
    this.camera.layers.set(RenderLayers.Default);
    this.camera.matrixAutoUpdate = true;
    // Mark the mirror camera as reversed-Z up front: the renderer would otherwise rebuild its projection (and drop
    // the oblique clip plane) on first use.
    (this.camera as unknown as { _reversedDepth: boolean })._reversedDepth = true;
    this.target = this.createTarget(2, 2, anisotropy);
  }

  private createTarget(width: number, height: number, anisotropy: number): THREE.WebGLRenderTarget {
    const depthTexture = new THREE.DepthTexture(width, height, THREE.FloatType);
    depthTexture.name = 'water.reflectionDepth';
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      depthTexture,
      stencilBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      samples: 0,
    });
    target.texture.name = 'water.reflection';
    target.texture.anisotropy = anisotropy;
    return target;
  }

  setSize(width: number, height: number, anisotropy: number): void {
    const w = Math.max(16, Math.round(width / 8) * 8);
    const h = Math.max(16, Math.round(height / 8) * 8);
    // Dynamic resolution moves the internal size in small steps; only reallocate for a real change (the mirror
    // projection is resolution independent, a slightly larger/smaller target is just a little more/less sharp).
    const same = (a: number, b: number): boolean => b > 0 && Math.abs(a - b) <= b * 0.12;
    if (same(w, this.width) && same(h, this.height)) {
      return;
    }
    this.width = w;
    this.height = h;
    this.target.dispose();
    this.target = this.createTarget(w, h, anisotropy);
  }

  /** True if any part of the main camera's view could see the water plane from above. */
  static seesWater(camera: THREE.PerspectiveCamera): boolean {
    if (camera.position.y <= 0.02) {
      return false;
    }
    _invProj.copy(camera.projectionMatrixInverse);
    for (const [x, y] of _ndc) {
      _corner.set(x, y, 0.5).applyMatrix4(_invProj).transformDirection(camera.matrixWorld);
      if (_corner.y < 0.02) {
        return true;
      }
    }
    return false;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, main: THREE.PerspectiveCamera, hide: THREE.Object3D): void {
    const cam = this.camera;
    main.updateMatrixWorld();
    const eye = main.position;
    // Mirror position, forward and up across y = 0.
    _forward.set(0, 0, -1).transformDirection(main.matrixWorld);
    _up.set(0, 1, 0).transformDirection(main.matrixWorld);
    cam.position.set(eye.x, -eye.y, eye.z);
    _forward.y = -_forward.y;
    _up.y = -_up.y;
    cam.up.copy(_up);
    _target.copy(cam.position).add(_forward);
    cam.lookAt(_target);
    cam.fov = Math.min(main.fov * this.fovScale, 150);
    cam.aspect = main.aspect;
    cam.near = main.near;
    cam.far = main.far * 2;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    this.textureMatrix.copy(_bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    // Oblique near plane = the water plane (view space), reversed-Z variant of Lengyel's construction.
    _plane.set(_waterNormal, 0).applyMatrix4(cam.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const proj = cam.projectionMatrix;
    _invProj.copy(proj).invert();
    _invProjT.copy(_invProj).transpose();
    _clipPlaneClip.copy(_clip).applyMatrix4(_invProjT);
    _q.set(Math.sign(_clipPlaneClip.x), Math.sign(_clipPlaneClip.y), 0, 1).applyMatrix4(_invProj);
    const cq = _clip.dot(_q);
    if (Math.abs(cq) > 1e-12) {
      const a = -_q.z / _q.w / (cq / _q.w);
      const e = proj.elements;
      e[2] = -a * _clip.x;
      e[6] = -a * _clip.y;
      e[10] = -1 - a * _clip.z;
      e[14] = -a * _clip.w;
      cam.projectionMatrixInverse.copy(proj).invert();
    }

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const wasVisible = hide.visible;
    hide.visible = false;
    renderer.autoClear = true;
    renderer.setRenderTarget(this.target);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = previousAutoClear;
    hide.visible = wasVisible;
    this.valid = true;
  }

  dispose(): void {
    this.target.dispose();
  }
}
