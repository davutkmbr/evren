/**
 * Headwear (hood, flight cap, börk, headband) and accessories (pauldrons, scarf, goggles, earrings, amulet).
 * All sculpt volumes skinned by the body underneath, except rigid items that follow one bone.
 */
import * as THREE from 'three';
import { PrimOp } from '../sdf/field';
import { RM } from '../materials-ids';
import { RSIDES, rsign } from '../skeleton';
import { basis, limbFrame, rotated, v3, type SculptContext } from './context';

export function sculptHeadwear(c: SculptContext): void {
  const { sc, lay, P, a, id, L } = c;
  const hf = lay.head;
  const hs = P.headScale;
  const p = (x: number, y: number, z: number): THREE.Vector3 => hf.p(x * hs, y * hs, z * hs);
  const R = (x: number, y: number, z: number): THREE.Vector3 => v3(x * hs, y * hs, z * hs);
  const B = basis(hf);
  const head = id('Head');
  const layer = L.headwear;
  switch (a.headwear) {
    case 'hood': {
      // A roomy hood: a soft shell well clear of the head with a peak at the back, the face opening framed by a
      // turned-back rim, the cowl falling onto the shoulders.
      const hood = { layer, bone: head, k: 0.03, mat: RM.cloak, noise: { amp: 0.003, freq: 32 } };
      const tilt = basis(rotated(hf, 0.18, 0, 0));
      sc.ellipsoid(hood, p(0, 0.1, -0.03), R(0.108, 0.118, 0.13), tilt);
      sc.cone(hood, p(0, 0.15, -0.07), p(0, 0.16, -0.16), 0.06 * hs, 0.018 * hs);
      sc.cone({ ...hood, bone: id('Neck'), bone1: head, ramp: [0.3, 0.9] }, lay.j.Neck.clone().addScaledVector(lay.chest.z, -0.02), p(0, 0.02, -0.05), 0.13 * P.s, 0.095 * hs);
      // Hollow, then open the face wide.
      sc.ellipsoid({ layer, op: PrimOp.Subtract, bone: head, k: 0.012 }, p(0, 0.1, -0.02), R(0.092, 0.104, 0.112), tilt);
      sc.ellipsoid({ layer, op: PrimOp.Subtract, bone: head, k: 0.02 }, p(0, 0.05, 0.13), R(0.086, 0.125, 0.095), basis(rotated(hf, -0.35, 0, 0)));
      // Turned-back rim around the opening.
      sc.torus({ layer, bone: head, k: 0.014, mat: RM.cloak }, p(0, 0.07, 0.058), 0.082 * hs, 0.012 * hs, basis(rotated(hf, 1.15, 0, 0)), 0.95, 1.4);
      break;
    }
    case 'cap': {
      // Leather flight cap over the skull with ear flaps and a fleece edge.
      const m = { layer, op: PrimOp.Mask, bone: head, k: 0.01 };
      sc.ellipsoid(m, p(0, 0.16, -0.02), R(0.11, 0.08, 0.125), B);
      for (const side of RSIDES) {
        const sg = rsign(side);
        sc.ellipsoid(m, p(0.07 * sg, 0.055, -0.01), R(0.035, 0.05, 0.045), B);
        sc.cone({ layer, bone: head, k: 0.006, mat: RM.darkLeather }, p(0.068 * sg, 0.02, 0.012), p(0.05 * sg, -0.035, 0.05), 0.004 * hs, 0.004 * hs);
      }
      sc.ellipsoid({ layer, op: PrimOp.Subtract, bone: head, k: 0.008 }, p(0, 0.075, 0.12), R(0.072, 0.052, 0.06), B);
      sc.torus({ layer, bone: head, k: 0.008, mat: RM.fur }, p(0, 0.132, 0.052), 0.06 * hs, 0.008 * hs, basis(rotated(hf, 0.35, 0, 0)), 1.1, 0.7);
      break;
    }
    case 'bork': {
      // Börk: a tall rounded felt cap with a wide fur band.
      sc.ellipsoid({ layer, bone: head, k: 0.02, mat: RM.felt }, p(0, 0.175, -0.015), R(0.082, 0.085, 0.095), basis(rotated(hf, -0.1, 0, 0)));
      sc.torus({ layer, bone: head, k: 0.015, mat: RM.fur, noise: { amp: 0.003, freq: 70 } }, p(0, 0.13, -0.012), 0.078 * hs, 0.022 * hs, basis(rotated(hf, 0.12, 0, 0)), 1.0, 1.12);
      break;
    }
    case 'headband': {
      // Cloth band (accent) around the forehead, knot at the back.
      const m = { layer, op: PrimOp.Mask, bone: head, k: 0.004 };
      const hb = rotated(hf, 0.2, 0, 0, p(0, 0.13, -0.01));
      sc.cylinder(m, hb.p(0, -0.012 * hs, 0), hb.p(0, 0.012 * hs, 0), 0.2);
      sc.ellipsoid({ layer, bone: head, k: 0.008, mat: RM.accent }, p(0, 0.125, -0.108), R(0.018, 0.014, 0.012), B);
      for (const sg of [1, -1]) {
        sc.cone({ layer, bone: head, k: 0.006, mat: RM.accent }, p(0.008 * sg, 0.12, -0.11), p(0.03 * sg, 0.05, -0.13), 0.009 * hs, 0.006 * hs, { sz: 0.4, hint: hf.z });
      }
      break;
    }
  }
}

export function sculptGear(c: SculptContext): void {
  const { sc, lay, P, a, id, L } = c;
  const s = P.s;
  const hf = lay.head;
  const hs = P.headScale;
  const cf = lay.chest;
  const gear = L.gear;
  const hp = (x: number, y: number, z: number): THREE.Vector3 => hf.p(x * hs, y * hs, z * hs);

  if (a.pauldrons) {
    // Three overlapping leather lames over each shoulder.
    for (const side of RSIDES) {
      const sg = rsign(side);
      const sh = lay.j[`${side}Arm`];
      const el = lay.j[`${side}ForeArm`];
      const uf = limbFrame(sh, el, v3(0, 0.25, -1));
      for (let k = 0; k < 3; k++) {
        const cpos = sh.clone().addScaledVector(uf.y, (0.005 + 0.045 * k) * s).add(v3(0.022 * sg * s, 0, 0));
        sc.ellipsoid({ layer: gear, bone: id(`${side}Shoulder`), bone1: id(`${side}Arm`), ramp: [0.2, 0.9], k: 0.004, mat: k === 0 ? RM.leather : RM.darkLeather }, cpos, v3(0.072 - 0.006 * k, 0.03, 0.072 - 0.006 * k).multiplyScalar(s * (0.95 + 0.1 * P.build)), basis(rotated(uf, 0, 0, 0)));
      }
      // Hollow underneath so they sit on the shoulder as plates.
      sc.cone({ layer: gear, op: PrimOp.Subtract, bone: id(`${side}Arm`), k: 0.006 }, sh.clone().addScaledVector(uf.y, -0.05 * s), sh.clone().lerp(el, 0.6), 0.055 * s, 0.05 * s);
    }
  }

  if (a.scarf) {
    // Thick wool scarf wound twice around the neck, a tail over the chest and one blowing back over the shoulder.
    const neck = lay.j.Neck;
    const mid = neck.clone().lerp(lay.j.Head, 0.35);
    const nf = limbFrame(neck, lay.j.Head, v3(0, 0, -1));
    const scarf = { layer: gear, bone: id('Neck'), bone1: id('Spine2'), ramp: [0.4, 0.0] as [number, number], k: 0.014, mat: RM.accent, noise: { amp: 0.0025, freq: 55 } };
    sc.torus({ ...scarf, ramp: [0.0, 1.0] }, mid.clone().addScaledVector(nf.z, 0.012 * s), 0.058 * s, 0.022 * s, basis(rotated(nf, 0.15, 0, 0.05)), 1.08, 1.15);
    sc.torus({ ...scarf, ramp: [0.0, 1.0] }, neck.clone().addScaledVector(nf.y, 0.01 * s).addScaledVector(nf.z, 0.018 * s), 0.07 * s, 0.022 * s, basis(rotated(nf, -0.1, 0, -0.08)), 1.1, 1.18);
    sc.cone({ layer: gear, bone: id('Spine2'), k: 0.012, mat: RM.accent, noise: { amp: 0.002, freq: 55 } }, cf.p(0.03 * s, 0.26 * s, 0.1 * s), cf.p(0.05 * s, 0.1 * s, 0.13 * s), 0.024 * s, 0.028 * s, { sz: 0.45, hint: cf.z });
  }

  if (a.goggles !== 'none') {
    // Brass-rimmed goggles on the eyes or pushed up on the brow, with a strap around the head.
    const onEyes = a.goggles === 'eyes';
    const gf = onEyes ? hf : rotated(hf, -0.5, 0, 0);
    const base = onEyes ? hp(0, 0.062, 0.094) : hp(0, 0.14, 0.078);
    for (const side of RSIDES) {
      const sg = rsign(side);
      const cpos = base.clone().addScaledVector(gf.x, 0.033 * sg * hs);
      const lens = limbFrame(cpos, cpos.clone().add(gf.z), gf.y);
      sc.torus({ layer: gear, bone: id('Head'), k: 0.003, mat: RM.metal }, cpos, 0.017 * hs, 0.0048 * hs, basis(lens));
      sc.ellipsoid({ layer: gear, bone: id('Head'), k: 0.002, mat: RM.glass }, cpos.clone().addScaledVector(gf.z, -0.004 * hs), v3(0.0175, 0.0175, 0.008).multiplyScalar(hs), basis(rotated(gf, 0, 0, 0)));
      // Leather eye cup behind the rim.
      sc.cone({ layer: gear, bone: id('Head'), k: 0.004, mat: RM.darkLeather }, cpos.clone().addScaledVector(gf.z, -0.004 * hs), cpos.clone().addScaledVector(gf.z, -0.018 * hs), 0.019 * hs, 0.018 * hs);
    }
    sc.cone({ layer: gear, bone: id('Head'), k: 0.003, mat: RM.darkLeather }, base.clone().addScaledVector(gf.x, -0.014 * hs).addScaledVector(gf.z, -0.004 * hs), base.clone().addScaledVector(gf.x, 0.014 * hs).addScaledVector(gf.z, -0.004 * hs), 0.004 * hs, 0.004 * hs);
    // Strap around the head (just over the hair or the hood).
    const strapR = a.headwear === 'hood' ? 0.108 : 0.086;
    const strap = rotated(gf, 0.08, 0, 0, base.clone().addScaledVector(gf.z, -0.095 * hs));
    sc.torus({ layer: gear, bone: id('Head'), k: 0.003, mat: RM.darkLeather }, strap.o, strapR * hs, 0.0045 * hs, basis(rotated(strap, Math.PI / 2 - 0.05, 0, 0)), 0.9, 1.1);
  }

  if (a.earrings) {
    for (const side of RSIDES) {
      const sg = rsign(side);
      const lobe = hp(0.074 * sg, 0.036, 0.006);
      sc.torus({ layer: gear, bone: id('Head'), k: 0.001, mat: RM.metal, own: true }, lobe.clone().add(v3(0, -0.008 * hs, 0)), 0.007 * hs, 0.0022 * hs, basis(rotated(hf, 0, Math.PI / 2, 0)));
    }
  }

  if (a.amulet) {
    // Round medallion on the chest (the cord is a separate strand in parts).
    const pos = cf.p(0, 0.2 * s, 0.14 * s);
    sc.torus({ layer: gear, bone: id('Spine2'), k: 0.002, mat: RM.metal }, pos, 0.014 * s, 0.004 * s, basis(rotated(cf, Math.PI / 2 - 0.3, 0, 0)));
    sc.ellipsoid({ layer: gear, bone: id('Spine2'), k: 0.002, mat: RM.accent }, pos, v3(0.012, 0.012, 0.004).multiplyScalar(s), basis(rotated(cf, -0.3, 0, 0)));
  }
}
