import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { InstanceRec, PropRef } from './format';

/** One mesh of a prop variant, with its transform relative to the prop origin. */
interface PropPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
}

interface LoadedProp {
  ref: PropRef;
  /** Variant name -> parts; '' = the whole prop. */
  variants: Map<string, PropPart[]>;
}

/**
 * Street props of format 1 (index.props): each prop glb is loaded once, and every tile's instances become one
 * InstancedMesh per (prop, variant, part). Geometries and materials are shared by all tiles; a tile's group only owns
 * its instance buffers.
 */
export class PropLibrary {
  private readonly props = new Map<string, Promise<LoadedProp | null>>();
  private readonly tmp = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(
    private readonly baseUrl: string,
    private readonly refs: Readonly<Record<string, PropRef>>,
    private readonly loader: GLTFLoader,
    /** Called once per material of a newly loaded prop (shadow flags, emissive bookkeeping). */
    private readonly onMaterial: (m: THREE.Material) => void,
  ) {}

  private load(id: string): Promise<LoadedProp | null> {
    let p = this.props.get(id);
    if (!p) {
      const ref = this.refs[id];
      if (!ref) {
        console.warn(`[street] unknown prop '${id}'`);
        p = Promise.resolve(null);
      } else {
        const url = new URL(ref.glb, new URL(this.baseUrl, window.location.href)).href;
        p = this.loader
          .loadAsync(url)
          .then((gltf) => {
            const scene = gltf.scene;
            scene.updateMatrixWorld(true);
            const variants = new Map<string, PropPart[]>();
            const collect = (root: THREE.Object3D): PropPart[] => {
              const parts: PropPart[] = [];
              root.traverse((o) => {
                const mesh = o as THREE.Mesh;
                if (mesh.isMesh) {
                  const material = mesh.material as THREE.Material;
                  this.onMaterial(material);
                  parts.push({ geometry: mesh.geometry, material, matrix: mesh.matrixWorld.clone() });
                }
              });
              return parts;
            };
            variants.set('', collect(scene));
            for (const child of scene.children) {
              variants.set(child.name, collect(child));
            }
            return { ref, variants };
          })
          .catch((err: unknown) => {
            console.error(`[street] prop ${id} failed`, err);
            return null;
          });
      }
      this.props.set(id, p);
    }
    return p;
  }

  /** Instanced meshes of one tile's instances (grouped per prop and variant); each child has userData.drawDistance. */
  async build(instances: readonly InstanceRec[], shadows: boolean): Promise<THREE.Group> {
    const group = new THREE.Group();
    group.name = 'props';
    const byKey = new Map<string, InstanceRec[]>();
    for (const inst of instances) {
      const key = `${inst.asset}|${inst.variant ?? ''}`;
      byKey.set(key, [...(byKey.get(key) ?? []), inst]);
    }
    for (const [key, list] of byKey) {
      const [asset, variant] = key.split('|');
      const prop = await this.load(asset);
      const parts = prop?.variants.get(variant);
      if (!prop || !parts) {
        continue;
      }
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        mesh.name = `${asset}${variant ? `:${variant}` : ''}`;
        list.forEach((inst, k) => {
          this.p.set(inst.position[0], inst.position[1], inst.position[2]);
          this.q.set(inst.rotation[0], inst.rotation[1], inst.rotation[2], inst.rotation[3]);
          const sc = inst.scale ?? 1;
          if (typeof sc === 'number') {
            this.s.setScalar(sc);
          } else {
            this.s.set(sc[0], sc[1], sc[2]);
          }
          this.tmp.compose(this.p, this.q, this.s).multiply(part.matrix);
          mesh.setMatrixAt(k, this.tmp);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = shadows && prop.ref.castShadow;
        mesh.receiveShadow = shadows;
        mesh.userData.drawDistance = prop.ref.drawDistance;
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
    }
    group.matrixAutoUpdate = false;
    return group;
  }

  /** Frees a tile's instance buffers (geometry and materials stay shared). */
  static dispose(group: THREE.Group): void {
    for (const c of group.children) {
      (c as THREE.InstancedMesh).dispose();
    }
  }
}
