import * as THREE from 'three';

/** Render pass kinds an instance can have a separate geometry for (index into the per-instance triple). */
const PassKind = { Main: 0, Shadow: 1, Other: 2 } as const;
type PassKind = (typeof PassKind)[keyof typeof PassKind];

/**
 * BatchedMesh whose instances may use a different geometry (or none) per render pass: the main camera sees the LOD
 * chosen by the system, shadow maps and other cameras (water reflection) get cheaper proxies. Switching happens in
 * onBeforeRender/onBeforeShadow, so there are no extra draw calls; only instances whose passes differ are touched.
 */
export class LodBatchedMesh extends THREE.BatchedMesh {
  mainCamera: THREE.Camera | null = null;
  /** Per instance: geometry id for [main, shadow, other] passes, -1 = hidden. */
  private passGeometry: Int32Array;
  /** Geometry id currently applied to the batch per instance, -1 = hidden. */
  private applied: Int32Array;
  private readonly mixed = new Set<number>();
  private appliedPass: PassKind = PassKind.Main;

  constructor(maxInstanceCount: number, maxVertexCount: number, maxIndexCount: number, material: THREE.Material) {
    super(maxInstanceCount, maxVertexCount, maxIndexCount, material);
    this.passGeometry = new Int32Array(maxInstanceCount * 3).fill(-2);
    this.applied = new Int32Array(maxInstanceCount).fill(-2);
  }

  /** Sets the geometry an instance shows in the main, shadow and other passes (-1 hides it in that pass). */
  setInstanceLods(instanceId: number, main: number, shadow: number, other: number): void {
    const o = instanceId * 3;
    const g = this.passGeometry;
    if (g[o] === main && g[o + 1] === shadow && g[o + 2] === other) {
      return;
    }
    g[o] = main;
    g[o + 1] = shadow;
    g[o + 2] = other;
    if (main !== shadow || main !== other) {
      this.mixed.add(instanceId);
    } else {
      this.mixed.delete(instanceId);
    }
    this.applyInstance(instanceId, this.appliedPass);
  }

  private applyInstance(instanceId: number, pass: PassKind): void {
    const want = this.passGeometry[instanceId * 3 + pass];
    const cur = this.applied[instanceId];
    if (want === cur) {
      return;
    }
    if (want < 0) {
      this.setVisibleAt(instanceId, false);
    } else {
      if (cur < 0) {
        this.setVisibleAt(instanceId, true);
      }
      if (this.getGeometryIdAt(instanceId) !== want) {
        this.setGeometryIdAt(instanceId, want);
      }
    }
    this.applied[instanceId] = want;
  }

  private applyPass(pass: PassKind): void {
    if (pass === this.appliedPass) {
      return;
    }
    this.appliedPass = pass;
    for (const id of this.mixed) {
      this.applyInstance(id, pass);
    }
  }

  override onBeforeRender(renderer: THREE.WebGLRenderer, scene: THREE.Scene | null, camera: THREE.Camera, geometry: THREE.BufferGeometry, material: THREE.Material, group?: THREE.Group): void {
    if (scene !== null) {
      this.applyPass(camera === this.mainCamera ? PassKind.Main : PassKind.Other);
    }
    super.onBeforeRender(renderer, scene as THREE.Scene, camera, geometry, material, group as THREE.Group);
  }

  override onBeforeShadow(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, shadowCamera: THREE.Camera, geometry: THREE.BufferGeometry, depthMaterial: THREE.Material, group: THREE.Group): void {
    this.applyPass(PassKind.Shadow);
    super.onBeforeShadow(renderer, scene, camera, shadowCamera, geometry, depthMaterial, group);
  }
}
