/**
 * Hair and facial hair: shells grown from the scalp / jaw (offset layers cut by coverage masks) with clumpy noise,
 * plus style volumes (quiff, bun, ponytail, braid, long fall). Tails are skinned to the Hair1..3 chain (secondary
 * motion). Stubble and the beard's edge are skin paint.
 */
import * as THREE from 'three';
import { PrimOp } from '../sdf/field';
import { RM } from '../materials-ids';
import { Frame, RSIDES, rsign } from '../skeleton';
import { basis, rotated, v3, type SculptContext } from './context';

export const HAIR_SHELL: Record<string, number> = { buzz: 0.0012, short: 0.006, swept: 0.008, ponytail: 0.005, braid: 0.005, bun: 0.005, long: 0.008 };

export function sculptHair(c: SculptContext): void {
  const { sc, lay, P, a, id, L } = c;
  const hf = lay.head;
  const hs = P.headScale;
  const p = (x: number, y: number, z: number): THREE.Vector3 => hf.p(x * hs, y * hs, z * hs);
  const R = (x: number, y: number, z: number): THREE.Vector3 => v3(x * hs, y * hs, z * hs);
  const B = basis(hf);
  const head = id('Head');
  const style = a.hair;
  const layer = L.hair;
  // Under a hood or hat the hair is not built beyond the tails (they hang out of the hood).
  const covered = a.headwear === 'hood' || a.headwear === 'bork' || a.headwear === 'cap';

  if (!covered || style === 'buzz') {
    // Scalp coverage: crown, back of the head down to the nape, temples and sideburns (ears stay free).
    const m = { layer, op: PrimOp.Mask, bone: head, k: 0.012 };
    sc.ellipsoid(m, p(0, 0.165, -0.02), R(0.1, 0.07, 0.112), B);
    sc.ellipsoid(m, p(0, 0.075, -0.07), R(0.088, 0.09, 0.058), B);
    for (const side of RSIDES) {
      const sg = rsign(side);
      sc.ellipsoid(m, p(0.066 * sg, 0.108, 0.022), R(0.02, 0.026, 0.018), B);
      sc.ellipsoid(m, p(0.069 * sg, 0.078, 0.022), R(0.012, 0.018, 0.006), B);
    }
    // Hairline over the forehead: a gentle curve, higher at the temples.
    sc.ellipsoid({ layer, op: PrimOp.Subtract, bone: head, k: 0.01 }, p(0, 0.075, 0.12), R(0.075, 0.062, 0.06), B);
  }
  const clump = { amp: 0.0022, freq: 70 };
  if (!covered) {
    if (style === 'short') {
      // Soft fringe tufts falling onto the forehead.
      for (let k = -1; k <= 1; k++) {
        sc.ellipsoid({ layer, bone: head, k: 0.012, noise: clump }, p(0.022 * k, 0.142, 0.07), R(0.022, 0.012, 0.022), basis(rotated(hf, -0.4, 0.2 * k, 0)));
      }
    } else if (style === 'swept') {
      // Volume swept up and back from the forehead.
      sc.ellipsoid({ layer, bone: head, k: 0.025, noise: clump }, p(0, 0.172, 0.005), R(0.066, 0.035, 0.09), basis(rotated(hf, 0.25, 0, 0)));
      sc.ellipsoid({ layer, bone: head, k: 0.02, noise: clump }, p(0, 0.165, 0.058), R(0.045, 0.028, 0.035), basis(rotated(hf, 0.5, 0, 0)));
    } else if (style === 'long') {
      // Full hair over the crown, parted, falling past the ears to the shoulders behind.
      sc.ellipsoid({ layer, bone: head, k: 0.03, noise: clump }, p(0, 0.15, -0.02), R(0.085, 0.06, 0.1), B);
      for (const side of RSIDES) {
        const sg = rsign(side);
        sc.cone({ layer, bone: head, k: 0.03, noise: clump }, p(0.06 * sg, 0.12, -0.02), p(0.07 * sg, 0.0, -0.05), 0.03 * hs, 0.028 * hs);
      }
    }
  }
  // Tails (skinned to the hair chain): out of a hood too.
  const h = lay.hair;
  const hair1 = id('Hair1');
  const hair2 = id('Hair2');
  const hair3 = id('Hair3');
  const tie = h[0];
  const tail = (from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, b0: number, b1: number): void => {
    sc.cone({ layer, bone: b0, bone1: b1, ramp: [0.4, 1.0], own: true, k: 0.012, noise: clump }, from, to, r0 * hs, r1 * hs);
  };
  const end = h[3].clone().addScaledVector(h[3].clone().sub(h[2]).normalize(), 0.08 * hs);
  if (style === 'ponytail') {
    sc.torus({ layer, bone: hair1, own: true, k: 0.004, mat: RM.darkLeather }, tie.clone(), 0.012 * hs, 0.005 * hs, basis(rotated(hf, 1.2, 0, 0)));
    tail(tie, h[1], 0.016, 0.022, hair1, hair2);
    tail(h[1], h[2], 0.022, 0.019, hair2, hair3);
    tail(h[2], end, 0.019, 0.006, hair3, hair3);
  } else if (style === 'braid') {
    sc.torus({ layer, bone: hair1, own: true, k: 0.004, mat: RM.darkLeather }, tie.clone(), 0.011 * hs, 0.005 * hs, basis(rotated(hf, 1.2, 0, 0)));
    const pts = [tie, h[1], h[2], h[3], end.clone().addScaledVector(h[3].clone().sub(h[2]).normalize(), 0.06 * hs)];
    const bones = [hair1, hair2, hair3, hair3];
    for (let i = 0; i < 4; i++) {
      const seg = limbDir(pts[i], pts[i + 1]);
      const n = 5;
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const q = pts[i].clone().lerp(pts[i + 1], t).addScaledVector(seg.side, ((k + i * n) % 2 ? 1 : -1) * 0.006 * hs);
        const r = (0.014 - 0.0022 * i) * hs;
        sc.ellipsoid({ layer, bone: bones[i], own: true, k: 0.004 }, q, v3(r, r * 1.5, r * 0.9), basis(rotated(seg.frame, 0, 0, ((k + i * n) % 2 ? 1 : -1) * 0.5)));
      }
    }
    sc.torus({ layer, bone: hair3, own: true, k: 0.003, mat: RM.darkLeather }, pts[4].clone(), 0.008 * hs, 0.004 * hs, basis(limbDir(pts[3], pts[4]).frame));
  } else if (style === 'bun') {
    const bun = p(0, 0.152, -0.075);
    sc.sphere({ layer, bone: head, k: 0.012, noise: { amp: 0.002, freq: 90 } }, bun, 0.034 * hs);
    sc.torus({ layer, bone: head, k: 0.004, mat: RM.darkLeather }, p(0, 0.145, -0.058), 0.022 * hs, 0.004 * hs, basis(rotated(hf, 0.9, 0, 0)));
  } else if (style === 'long') {
    tail(p(0, 0.08, -0.09), h[2], 0.06, 0.05, head, hair2);
    tail(h[2], end, 0.05, 0.03, hair2, hair3);
  }

  sculptFacialHair(c);
}

function limbDir(a: THREE.Vector3, b: THREE.Vector3): { frame: Frame; side: THREE.Vector3 } {
  const dir = b.clone().sub(a).normalize();
  const side = new THREE.Vector3(1, 0, 0).addScaledVector(dir, -dir.x).normalize();
  return { frame: new Frame(a.clone(), side.clone(), dir.clone(), new THREE.Vector3().crossVectors(side, dir).normalize()), side };
}

function sculptFacialHair(c: SculptContext): void {
  const { sc, lay, P, a, id, L } = c;
  const hf = lay.head;
  const hs = P.headScale;
  const p = (x: number, y: number, z: number): THREE.Vector3 => hf.p(x * hs, y * hs, z * hs);
  const R = (x: number, y: number, z: number): THREE.Vector3 => v3(x * hs, y * hs, z * hs);
  const B = basis(hf);
  const head = id('Head');
  const jaw = id('Jaw');
  const style = a.facialHair;
  if (style === 'none') {
    return;
  }
  const skin = L.skin;
  const layer = L.beard;
  const my = 0.004;
  const shadow = style === 'stubble' ? 0.75 : 0.5;
  const paint = { layer: skin, op: PrimOp.Paint, bone: head, feather: 0.006, channels: [undefined, undefined, undefined, shadow] as [undefined, undefined, undefined, number] };
  const full = style === 'short' || style === 'full';
  const chin = style === 'goatee' || full;
  const moustache = style === 'moustache' || style === 'goatee' || full;
  if (style === 'stubble' || full) {
    // Beard shadow over the jaw, chin and upper lip.
    for (const side of RSIDES) {
      const sg = rsign(side);
      sc.cone(paint, p(0.055 * sg, 0.045, 0.02), p(0.03 * sg, -0.01, 0.075), 0.014 * hs, 0.02 * hs);
    }
    sc.ellipsoid(paint, p(0, -0.018, 0.075), R(0.035, 0.022, 0.035), B);
    sc.ellipsoid(paint, p(0, my + 0.013, 0.102), R(0.024, 0.006, 0.012), B);
  }
  if (style === 'stubble') {
    return;
  }
  const m = { layer, op: PrimOp.Mask, bone: head, k: 0.006 };
  if (moustache) {
    sc.ellipsoid(m, p(0, my + 0.014, 0.104), R(0.027, 0.0065, 0.012), basis(rotated(hf, -0.3, 0, 0)));
    sc.ellipsoid({ layer: skin, op: PrimOp.Paint, bone: head, feather: 0.003, channels: [undefined, undefined, undefined, 0.6] }, p(0, my + 0.014, 0.104), R(0.028, 0.008, 0.012), B);
  }
  if (chin) {
    sc.ellipsoid({ ...m, bone: jaw }, p(0, -0.022, 0.092), R(0.02 + (full ? 0.02 : 0), 0.017, 0.02), B);
  }
  if (full) {
    for (const side of RSIDES) {
      const sg = rsign(side);
      sc.cone({ ...m, bone: jaw }, p(0.06 * sg, 0.05, 0.02), p(0.03 * sg, -0.018, 0.075), 0.012 * hs, 0.022 * hs);
    }
  }
  if (style === 'full') {
    // Volume under the chin.
    sc.ellipsoid({ layer, bone: jaw, k: 0.02, noise: { amp: 0.0025, freq: 80 } }, p(0, -0.038, 0.075), R(0.04, 0.03, 0.035), basis(rotated(hf, 0.3, 0, 0)));
  } else if (style === 'goatee') {
    sc.ellipsoid({ layer, bone: jaw, k: 0.01, noise: { amp: 0.0015, freq: 90 } }, p(0, -0.034, 0.09), R(0.015, 0.018, 0.013), B);
  }
}
