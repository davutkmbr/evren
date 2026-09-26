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
    case 'cicak': {
      // Çiçak: a steel dome rising to a gilt finial, a short peak, a sliding nasal, cheek plates, a mail curtain over
      // the nape and a plume (sorguç) at the front.
      const steel = { layer, bone: head, k: 0.006, mat: RM.iron };
      const gilt = { layer, bone: head, k: 0.003, mat: RM.metal };
      sc.ellipsoid(steel, p(0, 0.122, -0.014), R(0.083, 0.078, 0.097), basis(rotated(hf, 0.06, 0, 0)));
      sc.cone({ ...steel, k: 0.03 }, p(0, 0.17, -0.016), p(0, 0.232, -0.028), 0.05 * hs, 0.006 * hs);
      sc.cone(gilt, p(0, 0.225, -0.027), p(0, 0.262, -0.034), 0.007 * hs, 0.002 * hs);
      sc.sphere(gilt, p(0, 0.226, -0.027), 0.009 * hs);
      // Gilt band around the rim and a gilt ridge up the front.
      sc.torus(gilt, p(0, 0.088, -0.012), 0.084 * hs, 0.005 * hs, basis(rotated(hf, 0.1, 0, 0)), 1.0, 1.15);
      // Peak over the brow.
      sc.ellipsoid(steel, p(0, 0.09, 0.09), R(0.05, 0.0045, 0.026), basis(rotated(hf, -0.15, 0, 0)));
      // Nasal: a bar down over the nose bridge, with a leaf-shaped end.
      sc.box(steel, p(0, 0.074, 0.103), R(0.0035, 0.024, 0.0025), 0.0015 * hs, basis(rotated(hf, 0.12, 0, 0)));
      sc.ellipsoid(gilt, p(0, 0.051, 0.106), R(0.006, 0.008, 0.0025), basis(rotated(hf, 0.12, 0, 0)));
      sc.ellipsoid(gilt, p(0, 0.104, 0.1), R(0.006, 0.01, 0.004), B);
      for (const side of RSIDES) {
        const sg = rsign(side);
        // Cheek plates hanging from the rim in front of the ears.
        sc.ellipsoid(steel, p(0.07 * sg, 0.042, 0.026), R(0.007, 0.042, 0.028), basis(rotated(hf, 0, 0.35 * sg, 0.12 * sg)));
      }
      // Mail curtain: a shell around the back and sides of the neck.
      const aventail = { layer, bone: id('Neck'), bone1: head, ramp: [0.2, 0.8] as [number, number], k: 0.01, mat: RM.mail };
      sc.ellipsoid(aventail, p(0, 0.02, -0.03), R(0.094, 0.085, 0.092), B);
      sc.ellipsoid({ layer, op: PrimOp.Subtract, bone: head, k: 0.006 }, p(0, 0.03, -0.028), R(0.084, 0.09, 0.083), B);
      sc.box({ layer, op: PrimOp.Subtract, bone: head, k: 0.01 }, p(0, 0.0, 0.1), R(0.15, 0.2, 0.09), 0.01, B);
      sc.box({ layer, op: PrimOp.Subtract, bone: head, k: 0.004 }, p(0, -0.16, 0.0), R(0.2, 0.09, 0.2), 0.01, B);
      // Plume (sorguç): a gilt holder and a tall feather sweeping back.
      const q0 = p(0, 0.16, 0.058);
      const q1 = p(0, 0.23, 0.05);
      const q2 = p(0, 0.3, 0.0);
      const q3 = p(0, 0.33, -0.07);
      sc.cone(gilt, p(0, 0.13, 0.078), q0, 0.007 * hs, 0.005 * hs);
      const plume = { layer, bone: head, k: 0.008, mat: RM.accent, own: true, noise: { amp: 0.002, freq: 120 } };
      sc.cone(plume, q0, q1, 0.006 * hs, 0.014 * hs, { sx: 0.35, hint: hf.x });
      sc.cone(plume, q1, q2, 0.014 * hs, 0.016 * hs, { sx: 0.35, hint: hf.x });
      sc.cone(plume, q2, q3, 0.016 * hs, 0.004 * hs, { sx: 0.35, hint: hf.x });
      break;
    }
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

  if (a.outfit === 'akinci') {
    // A pelt thrown over the left shoulder, tied across the chest, its tail hanging down the back.
    const sh = lay.j.LeftArm;
    const fur = { layer: gear, bone: id('LeftShoulder'), bone1: id('Spine2'), ramp: [0.4, 1] as [number, number], k: 0.02, mat: RM.fur, noise: { amp: 0.004, freq: 45 } };
    sc.ellipsoid(fur, sh.clone().add(v3(0.01 * s, 0.035 * s, 0.01 * s)), v3(0.1, 0.045, 0.11).multiplyScalar(s), basis(rotated(cf, 0, 0, 0.35)));
    sc.ellipsoid(fur, cf.p(-0.07 * s, 0.14 * s, -0.1 * s), v3(0.1, 0.14, 0.03).multiplyScalar(s), basis(rotated(cf, 0.1, 0, 0.25)));
    sc.cone(fur, cf.p(-0.11 * s, 0.02 * s, -0.12 * s), cf.p(-0.13 * s, -0.25 * s, -0.16 * s), 0.035 * s, 0.018 * s);
    sc.cone({ layer: gear, bone: id('Spine2'), k: 0.004, mat: RM.darkLeather }, sh.clone().add(v3(0.0, 0.03 * s, 0.06 * s)), cf.p(0.1 * s, 0.02 * s, 0.14 * s), 0.008 * s, 0.008 * s);
    // Kılıç in its scabbard on the left hip: a gentle curve back and down, gilt fittings, the hilt forward.
    const pf = lay.pelvis;
    const hip = pf.p(-0.21 * s, 0.03 * s, 0.06 * s);
    const k1 = pf.p(-0.25 * s, -0.04 * s, -0.12 * s);
    const k2 = pf.p(-0.27 * s, -0.08 * s, -0.36 * s);
    const k3 = pf.p(-0.28 * s, -0.06 * s, -0.58 * s);
    const sheath = { layer: gear, bone: id('Hips'), k: 0.006, mat: RM.darkLeather };
    sc.cone(sheath, hip, k1, 0.018 * s, 0.017 * s, { sx: 0.5, hint: v3(0, 1, 0) });
    sc.cone(sheath, k1, k2, 0.017 * s, 0.016 * s, { sx: 0.5, hint: v3(0, 1, 0) });
    sc.cone(sheath, k2, k3, 0.016 * s, 0.012 * s, { sx: 0.5, hint: v3(0, 1, 0) });
    sc.sphere({ ...sheath, mat: RM.metal }, k3, 0.014 * s);
    sc.torus({ ...sheath, mat: RM.metal }, hip.clone().lerp(k1, 0.15), 0.02 * s, 0.004 * s, basis(limbFrame(hip, k1, v3(0, 1, 0))), 0.55, 1.0);
    const guard = hip.clone().addScaledVector(hip.clone().sub(k1).normalize(), 0.015 * s);
    const grip = hip.clone().addScaledVector(hip.clone().sub(k1).normalize(), 0.12 * s).add(v3(0, 0.02 * s, 0));
    sc.box({ ...sheath, mat: RM.metal }, guard, v3(0.012, 0.006, 0.05).multiplyScalar(s), 0.003 * s, basis(limbFrame(guard, grip, v3(0, 1, 0))));
    sc.cone({ ...sheath, mat: RM.darkLeather }, guard, grip, 0.011 * s, 0.012 * s);
    sc.sphere({ ...sheath, mat: RM.metal }, grip, 0.016 * s);
  }

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
    sc.cone({ layer: gear, bone: id('Spine2'), k: 0.012, mat: RM.accent, noise: { amp: 0.002, freq: 55 } }, lay.j.Neck.clone().addScaledVector(cf.z, 0.09 * s).addScaledVector(cf.x, 0.03 * s), cf.p(0.05 * s, 0.1 * s, 0.13 * s), 0.024 * s, 0.028 * s, { sz: 0.45, hint: cf.z });
  }

  if (a.goggles !== 'none') {
    // Brass-rimmed goggles on the eyes or pushed up on the brow, with a strap around the head.
    const onEyes = a.goggles === 'eyes';
    const gf = onEyes ? hf : rotated(hf, -0.5, 0, 0);
    const base = onEyes ? hp(0, 0.066, 0.092) : hp(0, 0.14, 0.078);
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
