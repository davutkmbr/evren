/**
 * The rider character: builds skeleton + skinned mesh (+ ink outline) from an appearance and parents the skeleton
 * under an anchor bone (the dragon's chest). Rebuild on appearance changes; recolour without rebuilding.
 */
import * as THREE from 'three';
import { geometryKey, type RiderAppearance } from './appearance';
import { buildRiderLayout, createRiderSkeleton, type RiderSkeleton } from './skeleton';
import { buildRiderParts, buildRiderSculpt, type RiderDetail } from './build';
import { meshSculpt } from './sdf/mesher';
import { mergeRiderGeometry } from './parts';
import { applyRiderColours, createRiderMaterial, createRiderOutlineMaterial, type RiderMaterialUniforms } from './material';

export interface RiderCharacterOptions {
  /** Bone the rider's hips hang from, and its rig-space rest position. */
  anchor: THREE.Object3D;
  anchorRest: THREE.Vector3;
  /** Object the meshes are added to (the rig root: meshes live in rig space). */
  meshParent: THREE.Object3D;
  detail?: RiderDetail;
  outline?: boolean;
}

export class RiderCharacter {
  skel!: RiderSkeleton;
  mesh!: THREE.SkinnedMesh;
  outline?: THREE.SkinnedMesh;
  readonly material: THREE.MeshStandardMaterial;
  readonly depthMaterial: THREE.MeshDepthMaterial;
  readonly outlineMaterial: THREE.ShaderMaterial;
  readonly uniforms: RiderMaterialUniforms;
  private key = '';
  stats = { vertices: 0, triangles: 0, ms: 0 };

  constructor(
    private readonly opts: RiderCharacterOptions,
    appearance: RiderAppearance,
  ) {
    const m = createRiderMaterial(new THREE.Vector3());
    this.material = m.material;
    this.depthMaterial = m.depthMaterial;
    this.uniforms = m.uniforms;
    this.outlineMaterial = createRiderOutlineMaterial(m.uniforms);
    this.setAppearance(appearance);
  }

  /** Applies an appearance: recolours always, rebuilds geometry only when a shape-affecting field changed. */
  setAppearance(a: RiderAppearance): void {
    applyRiderColours(this.uniforms, a);
    const key = geometryKey(a);
    if (key === this.key) {
      return;
    }
    this.key = key;
    const t0 = performance.now();
    const layout = buildRiderLayout(a);
    const skel = createRiderSkeleton(layout, this.opts.anchorRest);
    const job = buildRiderSculpt(a, layout, skel.id, skel.bones.length, this.opts.detail ?? 'high');
    const sculpt = meshSculpt(job.sculpt, job.boneCount, job.regions, job.hidden);
    const geo = mergeRiderGeometry(sculpt, buildRiderParts(a, layout, skel.id));
    geo.boundingSphere = new THREE.Sphere(layout.j.Spine1.clone(), 1.6);
    this.dispose(false);
    this.skel = skel;
    this.opts.anchor.add(skel.root);
    skel.root.updateMatrixWorld(true);
    this.mesh = new THREE.SkinnedMesh(geo, this.material);
    this.mesh.name = 'rider';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.customDepthMaterial = this.depthMaterial;
    this.mesh.bind(skel.skeleton, new THREE.Matrix4());
    this.mesh.frustumCulled = false;
    this.opts.meshParent.add(this.mesh);
    if (this.opts.outline !== false) {
      this.outline = new THREE.SkinnedMesh(geo, this.outlineMaterial);
      this.outline.name = 'rider-outline';
      this.outline.bind(skel.skeleton, new THREE.Matrix4());
      this.outline.frustumCulled = false;
      this.opts.meshParent.add(this.outline);
    }
    this.uniforms.uHidePoint.value.copy(layout.j.Neck);
    this.stats = { vertices: sculpt.stats.vertices, triangles: geo.index!.count / 3, ms: performance.now() - t0 };
  }

  dispose(materials = true): void {
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.outline?.removeFromParent();
      this.mesh.geometry.dispose();
      this.skel.root.removeFromParent();
      this.skel.skeleton.dispose();
    }
    if (materials) {
      this.material.dispose();
      this.depthMaterial.dispose();
      this.outlineMaterial.dispose();
    }
  }
}
