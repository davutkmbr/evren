/**
 * Shared resources of every remote dragon: the skinned geometry (procedural rider and fixed reins) and the baked scale
 * and membrane textures (their own, smaller than the local dragon's). Built once, on the first remote dragon. Each
 * dragon gets its own material objects (createMaterials) for its per-dragon uniforms (breath, membrane billow and
 * flutter, the rider's airflow); they share the textures and, having the same shader code, one compiled program.
 */
import * as THREE from 'three';
import { buildBoneSpecs } from '../model/anatomy';
import { buildSkeleton } from '../model/skeleton';
import { buildDragonGeometry } from '../model/geometry/assemble';
import { RIDER_HIDE_POINT } from '../model/geometry/rider';
import { TextureBaker } from '../model/materials/texture-baker';
import { bakeScaleTextures, type ScaleTextures } from '../model/materials/scale-textures';
import { bakeMembraneTextures, type MembraneTextures } from '../model/materials/membrane-textures';
import { createBodyMaterial, type BodyMaterialUniforms } from '../model/materials/body-material';
import { createMembraneMaterial, type MembraneUniforms } from '../model/materials/membrane-material';
import { createRiderMaterial, type RiderUniforms } from '../model/materials/rider-material';

/** Remote dragons are mostly seen from a distance: half the local dragon's texture size. */
const TEXTURE_SIZE = 1024;

export interface DragonMaterials {
  /** Material and shadow depth material per kit geometry (body, membrane, rider). */
  parts: { material: THREE.Material; depthMaterial: THREE.Material }[];
  body: BodyMaterialUniforms;
  membrane: MembraneUniforms;
  rider: RiderUniforms;
  dispose(): void;
}

export class RemoteDragonKit {
  /** Body, membrane and rider geometry, in the order of DragonMaterials.parts. */
  readonly geometries: { name: string; geometry: THREE.BufferGeometry }[];
  readonly triangles: number;
  private readonly baker: TextureBaker;
  private readonly scaleTex: ScaleTextures;
  private readonly membraneTex: MembraneTextures;

  constructor(renderer: THREE.WebGLRenderer) {
    const skel = buildSkeleton(buildBoneSpecs());
    const geo = buildDragonGeometry(skel, { proceduralRider: true, dynamicReins: false });
    skel.skeleton.dispose();
    this.baker = new TextureBaker(renderer);
    this.scaleTex = bakeScaleTextures(this.baker, TEXTURE_SIZE, 4);
    this.membraneTex = bakeMembraneTextures(this.baker, TEXTURE_SIZE, 4);
    this.geometries = [
      { name: 'remote-dragon-body', geometry: geo.bodyGeometry },
      { name: 'remote-dragon-membrane', geometry: geo.membraneGeometry },
      { name: 'remote-dragon-rider', geometry: geo.riderGeometry },
    ];
    this.triangles = geo.triangles.body + geo.triangles.membrane + geo.triangles.rider;
  }

  createMaterials(): DragonMaterials {
    const body = createBodyMaterial(this.scaleTex);
    const membrane = createMembraneMaterial(this.membraneTex);
    const rider = createRiderMaterial(RIDER_HIDE_POINT);
    const parts = [body, membrane, rider].map((m) => ({ material: m.material as THREE.Material, depthMaterial: m.depthMaterial as THREE.Material }));
    return {
      parts,
      body: body.uniforms,
      membrane: membrane.uniforms,
      rider: rider.uniforms,
      dispose: () => {
        for (const p of parts) {
          p.material.dispose();
          p.depthMaterial.dispose();
        }
      },
    };
  }

  dispose(): void {
    for (const g of this.geometries) {
      g.geometry.dispose();
    }
    for (const rt of [...this.scaleTex.targets, ...this.membraneTex.targets]) {
      rt.dispose();
    }
    this.baker.dispose();
  }
}
