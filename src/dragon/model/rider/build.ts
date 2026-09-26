/**
 * Rider geometry build: appearance -> skeleton layout -> sculpt (body, head, clothes, hair, gear) -> meshed regions
 * + separate parts (eyes, cloak, straps) -> one skinned BufferGeometry in rig space.
 */
import * as THREE from 'three';
import type { RiderAppearance } from './appearance';
import type { RiderSkeletonLayout } from './skeleton';
import { Sculpt } from './sdf/sculpt';
import type { CompiledSculpt } from './sdf/field';
import type { MeshRegion, SculptMesh } from './sdf/mesher';
import { RM } from './materials-ids';
import type { RiderLayers, SculptContext } from './sculpt/context';
import { sculptBody } from './sculpt/body';
import { EYE_RADIUS, sculptHead } from './sculpt/head';
import { HAIR_SHELL, sculptHair } from './sculpt/hair';
import { garmentLayers, sculptOutfit } from './sculpt/outfits';
import { sculptGear, sculptHeadwear } from './sculpt/gear';
import { buildCloak, PartsBuilder } from './parts';

export interface RiderSculptJob {
  sculpt: CompiledSculpt;
  regions: MeshRegion[];
  hidden: number[];
  boneCount: number;
}

/** Mesh resolution per quality tier (m): body, head, face, hands. */
export const RIDER_DETAIL = {
  high: { body: 0.0068, head: 0.0032, face: 0.0022, hands: 0.0028 },
  low: { body: 0.0095, head: 0.0045, face: 0.0032, hands: 0.004 },
} as const;
export type RiderDetail = keyof typeof RIDER_DETAIL;

function boxOf(points: THREE.Vector3[], pad: number): MeshRegion {
  const b = new THREE.Box3().setFromPoints(points).expandByScalar(pad);
  return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z], voxel: 0 };
}

function frameBox(f: { p(a: number, b: number, c: number): THREE.Vector3 }, lo: [number, number, number], hi: [number, number, number], voxel: number): MeshRegion {
  const pts: THREE.Vector3[] = [];
  for (const x of [lo[0], hi[0]]) {
    for (const y of [lo[1], hi[1]]) {
      for (const z of [lo[2], hi[2]]) {
        pts.push(f.p(x, y, z));
      }
    }
  }
  const r = boxOf(pts, 0);
  r.voxel = voxel;
  return r;
}

export function buildRiderSculpt(a: RiderAppearance, lay: RiderSkeletonLayout, id: (name: string) => number, boneCount: number, detail: RiderDetail = 'high'): RiderSculptJob {
  const sc = new Sculpt();
  const skin = sc.addLayer({ mat: RM.skin, weights: true });
  const G = garmentLayers({ sc, skin, outfit: a.outfit, gloves: a.gloves });
  const L: RiderLayers = {
    skin,
    ...G,
    hair: sc.addLayer({ mat: RM.hair, offsetOf: skin, thickness: HAIR_SHELL[a.hair] ?? 0.006, maskK: 0.006, noiseAmp: a.hair === 'buzz' ? 0 : 0.0018, noiseFreq: [110, 45, 110] }),
    beard: sc.addLayer({ mat: RM.hair, offsetOf: skin, thickness: a.facialHair === 'full' ? 0.007 : 0.0045, maskK: 0.005, noiseAmp: 0.0012, noiseFreq: [140, 90, 140] }),
    headwear: sc.addLayer({ mat: RM.leather }),
    gear: sc.addLayer({ mat: RM.leather }),
  };
  const c: SculptContext = { sc, L, lay, a, P: lay.props, id };
  sculptBody(c);
  sculptHead(c);
  sculptHair(c);
  sculptOutfit(c, G);
  sculptHeadwear(c);
  sculptGear(c);

  const res = RIDER_DETAIL[detail];
  const hs = lay.props.headScale;
  const all = boxOf(Object.values(lay.j), 0.16);
  all.voxel = res.body;
  const regions: MeshRegion[] = [all];
  regions.push(frameBox(lay.head, [-0.115 * hs, -0.085 * hs, -0.13 * hs], [0.115 * hs, 0.205 * hs, 0.15 * hs], res.head));
  regions.push(frameBox(lay.head, [-0.052 * hs, -0.034 * hs, 0.07 * hs], [0.052 * hs, 0.1 * hs, 0.15 * hs], res.face));
  for (const side of ['Right', 'Left'] as const) {
    const hs2 = lay.props.handScale;
    regions.push(frameBox(lay.hands[side].frame, [-0.05 * hs2, -0.02 * hs2, -0.07 * hs2], [0.05 * hs2, 0.2 * hs2, 0.085 * hs2], res.hands));
  }
  const hidden = ['Head', 'Neck', 'Jaw', 'LeftEye', 'RightEye', 'LeftEyelid', 'RightEyelid', 'LeftMouth', 'RightMouth', 'Hair1', 'Hair2', 'Hair3'].map(id);
  return { sculpt: sc.compile(), regions, hidden, boneCount };
}

/** Sculpt mesh -> BufferGeometry (rig space, skinned). */
export function sculptGeometry(m: SculptMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(m.skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(m.skinWeight, 4));
  g.setAttribute('aData', new THREE.BufferAttribute(m.data, 4));
  g.setAttribute('aExtra', new THREE.BufferAttribute(m.extra, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return g;
}

/** Parts outside the sculpt: eyeballs (gaze = the Eye bones). */
export function buildRiderParts(a: RiderAppearance, lay: RiderSkeletonLayout, id: (name: string) => number): PartsBuilder {
  const parts = new PartsBuilder();
  const hs = lay.props.headScale;
  for (const side of ['Right', 'Left'] as const) {
    // Eyes converge slightly on a point ~1.5 m ahead.
    const eye = lay.j[`${side}Eye`];
    const target = lay.head.p(0, 0.07 * hs, 1.5);
    parts.sphere(eye, EYE_RADIUS * hs, target.sub(eye), lay.head.y, id(`${side}Eye`), RM.eye, 16, 24, 1);
  }
  if (a.cloak) {
    buildCloak(parts, lay.cloakPivot, lay.props.shoulderHalf * 1.12, { chest: id('Spine2'), spine: id('Spine1'), cloak: id('Cloak') }, RM.cloak);
  }
  return parts;
}
