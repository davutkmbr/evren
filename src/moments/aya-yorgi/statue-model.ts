/**
 * The knight statue of "Aya Yorgi'nin Meydan Okuması" (actor 'moments/aya-yorgi-knight-statue'): an original bronze
 * statue of a soldier saint on a limestone plinth, built in Blender (tools/moments/knight_statue.py) from the approved
 * CC0 MakeHuman body and exported as public/models/moments/aya-yorgi-statue.glb: one skinned bronze mesh (baked
 * patina albedo, ORM and normal maps) on a Mixamo-named skeleton, and the plinth.
 *
 * Joints for the three animations (./pose.ts) are the skeleton's own bones: the spear arm (RightArm), the shield arm
 * (LeftArm), the shoulders (the shrug), the head (it follows the dragon); `figure` turns the whole figure on its
 * plinth. Model space: +Z the statue's front, +X its left, the origin at the plinth's foot.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/** The figure's scale (the model is built at human scale, 1.93 m tall) and the plinth's height in the game (m). */
export const FIGURE_SCALE = 3.4;
export const PLINTH_H = 0.76 * FIGURE_SCALE;
export const STATUE_HEIGHT = PLINTH_H + FIGURE_SCALE * 1.93;
/** Half the plinth's footprint (m) and the depth of its buried foundation (m). */
export const PLINTH_HALF = 0.76 * FIGURE_SCALE;
export const FOUNDATION_DEPTH = 0.75 * FIGURE_SCALE;
const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
export const STATUE_URL = `${BASE}models/moments/aya-yorgi-statue.glb`;

/**
 * Where the plinth sits on sloping ground (pure): the lowest terrain under its footprint (centre, corners, edge
 * midpoints), so no corner hangs in the air; the uphill side buries its lower steps. `spread` is the rise across the
 * footprint (the foundation hides up to FOUNDATION_DEPTH below the base).
 */
export function plinthBase(heightAt: (x: number, z: number) => number, x: number, z: number, half = PLINTH_HALF): { y: number; spread: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of [-1, 0, 1]) {
    for (const j of [-1, 0, 1]) {
      const h = heightAt(x + i * half, z + j * half);
      if (Number.isFinite(h)) {
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
  }
  return Number.isFinite(lo) ? { y: lo, spread: hi - lo } : { y: 0, spread: 0 };
}

/** A bone turned about the axes of the figure's own frame, on top of its rest rotation. */
export class FigureJoint {
  readonly rest: THREE.Quaternion;
  /** The figure's X, Y and Z axes in the bone's local frame (at rest). */
  private readonly axes: THREE.Vector3[];
  private readonly q = new THREE.Quaternion();

  constructor(
    readonly bone: THREE.Bone,
    figure: THREE.Object3D,
  ) {
    this.rest = bone.quaternion.clone();
    figure.updateWorldMatrix(true, true);
    const boneInFigure = figure.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    const toBone = boneInFigure.invert();
    this.axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((a) => a.applyQuaternion(toBone));
  }

  /** Rest rotation, then turns about the figure's X, Y and Z axes (radians). */
  set(x: number, y = 0, z = 0): void {
    const b = this.bone.quaternion.copy(this.rest);
    if (x) b.multiply(this.q.setFromAxisAngle(this.axes[0], x));
    if (y) b.multiply(this.q.setFromAxisAngle(this.axes[1], y));
    if (z) b.multiply(this.q.setFromAxisAngle(this.axes[2], z));
  }
}

export interface KnightStatue {
  root: THREE.Group;
  /** The figure (the skeleton's root): rotation.y turns it toward the challenger; the plinth stays. */
  figure: THREE.Object3D;
  spearArm: FigureJoint;
  shieldArm: FigureJoint;
  shoulders: [FigureJoint, FigureJoint];
  head: FigureJoint;
  dispose(): void;
}

let gltfLoader: GLTFLoader | undefined;
function loader(): GLTFLoader {
  if (!gltfLoader) {
    const draco = new DRACOLoader();
    draco.setDecoderPath(`${BASE}draco/`);
    gltfLoader = new GLTFLoader().setDRACOLoader(draco);
  }
  return gltfLoader;
}

/** Wraps a loaded statue scene (the glTF scene: the rig with the skinned bronze mesh, and the plinth). */
export function statueFromScene(scene: THREE.Object3D): KnightStatue {
  const root = new THREE.Group();
  root.name = 'moment-aya-yorgi-statue';
  scene.scale.setScalar(FIGURE_SCALE);
  root.add(scene);
  const bones = new Map<string, THREE.Bone>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      // The figure moves a little around its bind pose; its bounds are not recomputed per frame.
      m.frustumCulled = !(m as THREE.SkinnedMesh).isSkinnedMesh;
    }
    const b = o as THREE.Bone;
    if (b.isBone) {
      bones.set(b.name.replace(/^mixamorig:?/, ''), b);
    }
  });
  // The figure turns on its plinth about a pivot in the model's own frame (+Y up, +Z front), whatever transform the
  // exported skeleton node carries.
  const rigNode = bones.get('Hips')?.parent ?? scene;
  const figure = new THREE.Group();
  figure.name = 'figure';
  scene.add(figure);
  scene.updateWorldMatrix(true, true);
  figure.attach(rigNode);
  const joint = (name: string): FigureJoint => {
    const b = bones.get(name);
    if (!b) throw new Error(`aya-yorgi statue: bone ${name} missing`);
    return new FigureJoint(b, figure);
  };
  return {
    root,
    figure,
    spearArm: joint('RightArm'),
    shieldArm: joint('LeftArm'),
    shoulders: [joint('LeftShoulder'), joint('RightShoulder')],
    head: joint('Head'),
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mat = m.material as THREE.MeshStandardMaterial;
          for (const t of new Set([mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.aoMap])) t?.dispose();
          mat.dispose();
        }
      });
    },
  };
}

/** Loads the statue (Draco mesh, WebP maps). */
export async function loadKnightStatue(url = STATUE_URL): Promise<KnightStatue> {
  const gltf = await loader().loadAsync(url);
  return statueFromScene(gltf.scene);
}
