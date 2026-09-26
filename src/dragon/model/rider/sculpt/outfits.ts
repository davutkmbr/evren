/**
 * Outfits: garments are shells grown from the skin (offset layers) and cut by coverage masks, stacked by thickness
 * (shirt and trousers, then the tunic / coat, then armour), with region paint for materials (trousers vs shirt) and
 * woven border bands (ch0), plus a few volumes (collars, coat skirts, cuffs, sashes). Chunky on purpose: clear
 * silhouettes and readable hems at game distance.
 */
import * as THREE from 'three';
import { PrimOp } from '../sdf/field';
import { RM } from '../materials-ids';
import { Frame, RSIDES, rsign, type RSide } from '../skeleton';
import { basis, limbFrame, v3, type SculptContext } from './context';

export interface GarmentLayers {
  under: number;
  loose: number;
  tunic: number;
  outer: number;
  boots: number;
  gloves: number;
}

/** Layer definitions per outfit (thickness, default material, folds). */
export function garmentLayers(c: { sc: import('../sdf/sculpt').Sculpt; skin: number; outfit: string; gloves: boolean }): GarmentLayers {
  const { sc, skin } = c;
  const folds = (amp: number, f: number): { noiseAmp: number; noiseFreq: [number, number, number] } => ({ noiseAmp: amp, noiseFreq: [f, f * 0.8, f] });
  const under = sc.addLayer({ mat: RM.linen, offsetOf: skin, thickness: 0.005, maskK: 0.004, ...folds(0.0016, 45) });
  // Loose garments hang from a softened body (helper layer, not drawn): they bridge the hollows instead of hugging.
  const loose = sc.addLayer({ mat: RM.primary, visible: false, offsetOf: skin, thickness: 0.01, maskK: 0 });
  const tunicMat = c.outfit === 'pilot' ? RM.leather : RM.primary;
  const tunic = sc.addLayer({ mat: tunicMat, offsetOf: loose, thickness: c.outfit === 'pilot' ? 0.004 : 0.0, maskK: 0.006, ...folds(c.outfit === 'pilot' ? 0.0028 : 0.004, 20) });
  const outer = sc.addLayer({ mat: c.outfit === 'akinci' ? RM.mail : RM.leather, offsetOf: tunic, thickness: c.outfit === 'akinci' ? 0.006 : 0.009, maskK: 0.004, ...folds(0.0006, 60) });
  const boots = sc.addLayer({ mat: c.outfit === 'steppe' ? RM.felt : RM.darkLeather, offsetOf: skin, thickness: 0.016, maskK: 0.004, ...folds(0.0015, 30) });
  const gloves = sc.addLayer({ mat: RM.leather, offsetOf: skin, thickness: 0.0035, maskK: 0.003, ...folds(0.0006, 90) });
  return { under, loose, tunic, outer, boots, gloves };
}

const mask = (layer: number, bone: number, k = 0.012): { layer: number; op: PrimOp; bone: number; k: number } => ({ layer, op: PrimOp.Mask, bone, k });

/** Arm coverage from the shoulder to `end` (0 shoulder, 1 elbow, 2 wrist), radius r. */
function maskArm(c: SculptContext, layer: number, side: RSide, end: number, r = 0.075): void {
  const { lay, sc, id } = c;
  const sh = lay.j[`${side}Arm`];
  const el = lay.j[`${side}ForeArm`];
  const wr = lay.j[`${side}Hand`];
  const tip = end <= 1 ? sh.clone().lerp(el, end) : el.clone().lerp(wr, end - 1);
  const start = sh.clone().addScaledVector(el.clone().sub(sh).normalize(), -0.06);
  // Cylinders (flat ends: the hem is a clean ring); the elbow gets a sphere so the two pieces join.
  if (end <= 1) {
    sc.cylinder(mask(layer, id(`${side}Arm`), 0.008), start, tip, r);
  } else {
    sc.cylinder(mask(layer, id(`${side}Arm`), 0.008), start, el, r);
    sc.sphere(mask(layer, id(`${side}ForeArm`), 0.008), el, r);
    sc.cylinder(mask(layer, id(`${side}ForeArm`), 0.008), el, tip, r * 0.85);
  }
}

/** Leg coverage from the hip to `end` (0 hip, 1 knee, 2 ankle, 2.6 toes). */
function maskLeg(c: SculptContext, layer: number, side: RSide, from: number, end: number, r = 0.12): void {
  const { lay, sc, id } = c;
  const pts = [lay.j[`${side}UpLeg`], lay.j[`${side}Leg`], lay.j[`${side}Foot`], lay.j[`${side}ToeBase`]];
  const at = (t: number): THREE.Vector3 => {
    const i = Math.min(Math.floor(t), 2);
    const f = t - i;
    const b = i < 2 ? pts[i + 1] : pts[3].clone().addScaledVector(pts[3].clone().sub(pts[2]).normalize(), 0.08);
    return pts[i].clone().lerp(b, f / (i < 2 ? 1 : 0.6));
  };
  const stops = [from];
  for (let t = Math.floor(from) + 1; t < end; t++) {
    stops.push(t);
  }
  stops.push(end);
  for (let i = 0; i < stops.length - 1; i++) {
    const t0 = stops[i];
    const m = mask(layer, id(t0 < 1 ? `${side}UpLeg` : t0 < 2 ? `${side}Leg` : `${side}Foot`), 0.008);
    // Joints inside the covered span get a sphere so the straight pieces join around the bend.
    if (i > 0) {
      sc.sphere(m, at(stops[i]), r);
    }
    sc.cylinder(m, at(stops[i]), at(stops[i + 1]), r);
  }
}

/**
 * Torso coverage between `bottom` and `top` (heights along the spine from the hips joint, m): a slab with flat ends,
 * so the hem is a clean line (the thighs below the waist stay out unless a leg mask adds them).
 */
function maskTorso(c: SculptContext, layer: number, bottom: number, top: number, halfWidth = 0.3): void {
  const { lay, sc, id } = c;
  const f = lay.pelvis;
  const center = lay.j.Hips.clone().addScaledVector(f.y, (bottom + top) / 2).addScaledVector(f.z, 0.0);
  sc.box(mask(layer, id('Spine1'), 0.01), center, v3(halfWidth, (top - bottom) / 2, 0.26), 0.02, basis(f));
}

/** Height of the neck base above the hips joint along the spine (garment tops end here, the neckline cuts). */
function neckTop(c: SculptContext): number {
  return c.lay.j.Neck.clone().sub(c.lay.j.Hips).dot(c.lay.pelvis.y) + 0.03 * c.P.s;
}

/** Neck opening: removes the shell around the neck above the collar line. */
function neckline(c: SculptContext, layer: number, drop = 0.0, width = 1): void {
  const { lay, sc, id, P } = c;
  const cf = lay.chest;
  const s = P.s;
  sc.ellipsoid(
    { layer, op: PrimOp.Subtract, bone: id('Neck'), k: 0.006 },
    lay.j.Neck.clone().addScaledVector(cf.y, 0.03 * s - drop).addScaledVector(cf.z, 0.03 * s),
    v3(0.075 * s * width, 0.06 * s, 0.085 * s),
    basis(cf),
  );
}

/** Arm holes: removes a sleeveless garment's shell from the arms. */
function armHoles(c: SculptContext, layer: number, r = 0.058): void {
  const { lay, sc, id } = c;
  for (const side of RSIDES) {
    const sh = lay.j[`${side}Arm`];
    const el = lay.j[`${side}ForeArm`];
    const dir = el.clone().sub(sh).normalize();
    sc.cone({ layer, op: PrimOp.Subtract, bone: id(`${side}Arm`), k: 0.012 }, sh.clone().addScaledVector(dir, 0.035), el.clone().addScaledVector(dir, 0.3), r, r);
  }
}

/** Woven border band (ch0 on cloth) around a hem: a thin slab mask painted in `layer`. */
function band(c: SculptContext, layer: number, center: THREE.Vector3, normal: THREE.Vector3, radius: number, width: number): void {
  const f = limbFrame(center, center.clone().add(normal), v3(0, 0, -1));
  c.sc.cylinder({ layer, op: PrimOp.Paint, bone: 0, channels: [0.35], feather: 0.002 }, center.clone().addScaledVector(f.y, -width / 2), center.clone().addScaledVector(f.y, width / 2), radius);
}

/** The softened body loose garments hang from: big smooth masses, no muscle detail, no fingers. */
function sculptLooseBody(c: SculptContext, layer: number): void {
  const { lay, sc, id, P } = c;
  const s = P.s;
  const g = (0.95 + 0.2 * P.build) * s;
  const fem = 1 - P.shape;
  const pf = lay.pelvis;
  const cf = lay.chest;
  const L = { layer, k: 0.07, bone: id('Hips') };
  // The whole skin (offset) is the base; the soft masses smooth over it.
  sc.sphere({ layer, op: PrimOp.Mask, bone: id('Hips') }, lay.j.Spine1, 2.5);
  sc.ellipsoid(L, pf.p(0, 0.0, 0.0), v3((0.19 + 0.02 * fem) * g, 0.13 * s, 0.15 * g), basis(pf));
  sc.ellipsoid({ ...L, bone: id('Spine') }, lay.j.Spine.clone().lerp(lay.j.Spine1, 0.5).addScaledVector(cf.z, 0.02 * s), v3(0.165 * g, 0.12 * s, 0.14 * g), basis(cf));
  sc.ellipsoid({ ...L, bone: id('Spine2') }, cf.p(0, 0.09 * s, 0.03 * s), v3((0.18 + 0.01 * P.shape) * g, 0.16 * s, 0.14 * g), basis(cf));
  sc.cone({ ...L, bone: id('Neck'), k: 0.05 }, lay.j.Neck, lay.j.Neck.clone().lerp(lay.j.Head, 0.6), 0.065 * s, 0.055 * s);
  for (const side of RSIDES) {
    const sh = lay.j[`${side}Arm`];
    const el = lay.j[`${side}ForeArm`];
    const wr = lay.j[`${side}Hand`];
    sc.sphere({ ...L, bone: id(`${side}Arm`), k: 0.06 }, sh.clone().add(v3(0.01 * rsign(side) * s, 0.015 * s, 0)), 0.068 * g);
    sc.cone({ ...L, bone: id(`${side}Arm`), k: 0.04 }, sh, el, 0.062 * g, 0.052 * g);
    sc.cone({ ...L, bone: id(`${side}ForeArm`), k: 0.03 }, el, wr, 0.052 * g, 0.042 * g);
    const hip = lay.j[`${side}UpLeg`];
    const knee = lay.j[`${side}Leg`];
    const ankle = lay.j[`${side}Foot`];
    sc.cone({ ...L, bone: id(`${side}UpLeg`), k: 0.06 }, hip, knee, 0.11 * g, 0.075 * g);
    sc.cone({ ...L, bone: id(`${side}Leg`), k: 0.03 }, knee, ankle, 0.07 * g, 0.055 * g);
  }
}

export function sculptOutfit(c: SculptContext, G: GarmentLayers): void {
  sculptLooseBody(c, G.loose);
  const { lay, sc, id, P, a } = c;
  const s = P.s;
  const cf = lay.chest;
  const pf = lay.pelvis;
  const up = pf.y;
  const hips = lay.j.Hips;
  const spine2 = id('Spine2');
  const hipsB = id('Hips');

  // --- Under layer: shirt (linen) + trousers (secondary colour, painted) for every outfit.
  maskTorso(c, G.under, -0.2 * s, neckTop(c));
  for (const side of RSIDES) {
    maskArm(c, G.under, side, 1.93);
    maskLeg(c, G.under, side, 0, 1.92);
    // Trousers: from the waist down.
    const tp = { layer: G.under, op: PrimOp.Paint, bone: hipsB, paintMat: RM.secondary, feather: 0.004 };
    sc.cylinder(tp, lay.j[`${side}UpLeg`], lay.j[`${side}Leg`], 0.16);
    sc.sphere(tp, lay.j[`${side}Leg`], 0.14);
    sc.cylinder(tp, lay.j[`${side}Leg`], lay.j[`${side}Foot`], 0.14);
  }
  sc.cylinder({ layer: G.under, op: PrimOp.Paint, bone: hipsB, paintMat: RM.secondary, feather: 0.004 }, hips.clone().addScaledVector(up, -0.25 * s), hips.clone().addScaledVector(up, 0.1 * s), 0.3);
  neckline(c, G.under, 0.005);

  // --- Boots: to below the knee (steppe felt boots a little higher), a turned-down cuff.
  const bootTop = a.outfit === 'steppe' ? 1.12 : 1.18;
  for (const side of RSIDES) {
    maskLeg(c, G.boots, side, bootTop, 2.7, 0.11);
    const knee = lay.j[`${side}Leg`];
    const ankle = lay.j[`${side}Foot`];
    const cuff = knee.clone().lerp(ankle, bootTop - 1 + 0.035);
    const sf = limbFrame(knee, ankle, v3(0, 0, -1));
    sc.torus({ layer: G.boots, bone: id(`${side}Leg`), k: 0.012 }, cuff, 0.046 * s, 0.011 * s, basis(sf), 1.05, 1.1);
    // Sole and heel.
    const toe = lay.j[`${side}ToeBase`];
    const ff = limbFrame(ankle, toe, v3(0, 1, 0));
    const fwd = toe.clone().sub(ankle).setY(0).normalize();
    const sole = ankle.clone().lerp(toe, 0.5).add(v3(0, -0.075 * s, 0)).addScaledVector(fwd, 0.02 * s);
    sc.box({ layer: G.boots, bone: id(`${side}Foot`), k: 0.01, mat: RM.darkLeather }, sole, v3(0.045 * s, 0.012 * s, 0.13 * s), 0.01 * s, basis(Frame.fromYZ(sole, v3(0, 1, 0), fwd)));
    void ff;
  }

  // --- Gloves (toggle): leather to above the wrist with a flared cuff.
  if (a.gloves) {
    for (const side of RSIDES) {
      const wr = lay.j[`${side}Hand`];
      const el = lay.j[`${side}ForeArm`];
      const f = lay.hands[side].frame;
      sc.ellipsoid(mask(G.gloves, id(`${side}Hand`), 0.004), f.p(0, 0.08 * P.handScale, 0), v3(0.09, 0.15, 0.1).multiplyScalar(P.handScale), basis(f));
      const cuffC = wr.clone().lerp(el, 0.12);
      sc.cone({ layer: G.gloves, bone: id(`${side}ForeArmTwist`), bone1: id(`${side}Hand`), ramp: [0.2, 1], k: 0.008 }, cuffC.clone().lerp(el, 0.12), wr.clone().lerp(el, 0.02), 0.036 * s, 0.03 * s, { sz: 1.12, hint: f.z });
    }
  }

  switch (a.outfit) {
    case 'akinci':
      akinci(c, G);
      break;
    case 'traveller':
      traveller(c, G);
      break;
    case 'pilot':
      pilot(c, G);
      break;
    case 'kaftan':
      kaftan(c, G);
      break;
    case 'steppe':
      steppe(c, G);
      break;
  }
  void cf;
  void spine2;
}

/** Waist belt: a band shell (dark leather) with a buckle. */
function belt(c: SculptContext, layer: number, height: number, width: number, mat: number, buckle = true): void {
  const { lay, sc, id, P } = c;
  const s = P.s;
  const up = lay.pelvis.y;
  const center = lay.j.Hips.clone().addScaledVector(up, height * s);
  sc.cylinder(mask(layer, id('Hips'), 0.003), center.clone().addScaledVector(up, (-width / 2) * s), center.clone().addScaledVector(up, (width / 2) * s), 0.3);
  sc.cylinder({ layer, op: PrimOp.Paint, bone: 0, paintMat: mat, feather: 0.002 }, center.clone().addScaledVector(up, (-width / 2 - 0.004) * s), center.clone().addScaledVector(up, (width / 2 + 0.004) * s), 0.3);
  if (buckle) {
    // Buckle on the front of the belt: find the front surface roughly from the waist ellipsoid depth.
    const front = center.clone().addScaledVector(lay.pelvis.z, (0.12 + 0.03 * P.build) * s);
    sc.box({ layer: c.L.gear, bone: id('Hips'), k: 0.002, mat: RM.metal }, front, v3(0.022 * s, (width * 0.55) * s, 0.006 * s), 0.004 * s, basis(lay.pelvis));
  }
}

function traveller(c: SculptContext, G: GarmentLayers): void {
  const { lay, sc, id, P } = c;
  const s = P.s;
  // Wool tunic (primary) to the hips with half sleeves, over the shirt; woven band at the hem.
  maskTorso(c, G.tunic, -0.07 * s, neckTop(c));
  for (const side of RSIDES) {
    maskArm(c, G.tunic, side, 1.35);
    maskLeg(c, G.tunic, side, 0, 0.4, 0.15);
  }
  neckline(c, G.tunic, 0.012, 1.05);
  // Leather cuirass: chest and belly, no sleeves, moulded; a lighter edge.
  // A rounded shell over chest and belly (no box corners).
  sc.ellipsoid(mask(G.outer, id('Spine2'), 0.01), lay.chest.p(0, 0.05 * s, 0.03 * s), v3(P.shoulderHalf * 0.98, 0.25 * s, 0.24 * s), basis(lay.chest));
  armHoles(c, G.outer, 0.064 * s);
  neckline(c, G.outer, 0.035, 1.15);
  // Moulded chest plates and the lower lames.
  const cf = lay.chest;
  for (const side of RSIDES) {
    const sg = rsign(side);
    sc.ellipsoid({ layer: G.outer, bone: id('Spine2'), k: 0.03 }, cf.p(0.06 * sg * s, 0.13 * s, 0.1 * s), v3(0.07, 0.06, 0.03).multiplyScalar(s), basis(cf));
    // Bracers on the forearms (laced leather).
    const el = lay.j[`${side}ForeArm`];
    const wr = lay.j[`${side}Hand`];
    const ff = limbFrame(el, wr, v3(0, 1, 0));
    sc.cone({ layer: G.outer, bone: id(`${side}ForeArm`), bone1: id(`${side}ForeArmTwist`), ramp: [0.3, 0.9], k: 0.006, mat: RM.leather }, el.clone().lerp(wr, 0.35), el.clone().lerp(wr, 0.9), 0.04 * s, 0.031 * s, { sz: 1.1, hint: ff.z });
  }
  belt(c, G.outer, -0.02, 0.05, RM.darkLeather);
  // Lames below the belt over the hips (a short skirt of leather strips).
  for (let k = -2; k <= 2; k++) {
    const pf = lay.pelvis;
    sc.box({ layer: G.outer, bone: id('Hips'), k: 0.004, mat: RM.darkLeather }, pf.p(k * 0.055 * s, -0.08 * s, 0.13 * s), v3(0.026 * s, 0.055 * s, 0.008 * s), 0.004 * s, basis(pf));
  }
}

function pilot(c: SculptContext, G: GarmentLayers): void {
  const { lay, sc, id, P } = c;
  const s = P.s;
  const cf = lay.chest;
  // Leather flight jacket to the hips, full sleeves with knit cuffs, a fleece collar and a zip line.
  maskTorso(c, G.tunic, -0.12 * s, neckTop(c));
  for (const side of RSIDES) {
    maskArm(c, G.tunic, side, 1.88, 0.08);
    maskLeg(c, G.tunic, side, 0, 0.18, 0.14);
    const wr = lay.j[`${side}Hand`];
    const el = lay.j[`${side}ForeArm`];
    const f = lay.hands[side].frame;
    sc.cone({ layer: G.tunic, bone: id(`${side}ForeArmTwist`), k: 0.006, mat: RM.secondary }, wr.clone().lerp(el, 0.18), wr.clone().lerp(el, 0.1), 0.04 * s, 0.038 * s, { sz: 1.1, hint: f.z });
  }
  neckline(c, G.tunic, 0.02, 1.0);
  // Fleece collar: a thick roll around the neckline, open at the front.
  sc.torus({ layer: G.tunic, bone: id('Spine2'), bone1: id('Neck'), ramp: [0.3, 0.9], k: 0.012, mat: RM.fur }, lay.j.Neck.clone().addScaledVector(cf.y, -0.01 * s).addScaledVector(cf.z, 0.035 * s), 0.07 * s, 0.022 * s, basis(cf), 1.15, 1.05);
  sc.ellipsoid({ layer: G.tunic, op: PrimOp.Subtract, bone: id('Spine2'), k: 0.01 }, lay.j.Neck.clone().addScaledVector(cf.z, 0.13 * s).addScaledVector(cf.y, -0.03 * s), v3(0.035, 0.07, 0.05).multiplyScalar(s), basis(cf));
  // Zip / placket and a waistband.
  sc.box({ layer: G.tunic, op: PrimOp.Paint, bone: 0, paintMat: RM.darkLeather, feather: 0.002 }, cf.p(0, 0.02 * s, 0.14 * s), v3(0.006 * s, 0.35 * s, 0.1 * s), 0.002, basis(cf));
  belt(c, G.tunic, -0.1, 0.045, RM.secondary, false);
  // Chest pockets.
  for (const side of RSIDES) {
    const sg = rsign(side);
    sc.box({ layer: G.outer, bone: id('Spine2'), k: 0.004, mat: RM.leather }, cf.p(0.07 * sg * s, 0.11 * s, 0.12 * s), v3(0.035 * s, 0.03 * s, 0.006 * s), 0.004 * s, basis(cf));
  }
}

function kaftan(c: SculptContext, G: GarmentLayers): void {
  const { lay, sc, id, P } = c;
  const s = P.s;
  const cf = lay.chest;
  const pf = lay.pelvis;
  // Long kaftan (primary): body, long sleeves, a skirt over the thighs down to the knees; bordered hems; sash.
  maskTorso(c, G.tunic, -0.15 * s, neckTop(c));
  for (const side of RSIDES) {
    maskArm(c, G.tunic, side, 1.9, 0.085);
    maskLeg(c, G.tunic, side, 0, 0.92, 0.16);
    // Border bands at the cuffs and the skirt hem.
    const wr = lay.j[`${side}Hand`];
    const el = lay.j[`${side}ForeArm`];
    band(c, G.tunic, el.clone().lerp(wr, 0.86), wr.clone().sub(el).normalize(), 0.09, 0.03 * s);
    const hip = lay.j[`${side}UpLeg`];
    const knee = lay.j[`${side}Leg`];
    band(c, G.tunic, hip.clone().lerp(knee, 0.88), knee.clone().sub(hip).normalize(), 0.14, 0.04 * s);
  }
  // Overlapping front (a diagonal ridge) and a standing collar.
  sc.cone({ layer: G.tunic, bone: id('Spine2'), bone1: id('Hips'), ramp: [0.2, 0.9], k: 0.01 }, cf.p(0.05 * s, 0.22 * s, 0.13 * s), pf.p(-0.07 * s, -0.02 * s, 0.13 * s), 0.009 * s, 0.009 * s);
  sc.torus({ layer: G.tunic, bone: id('Neck'), bone1: id('Spine2'), ramp: [0.2, 0.9], k: 0.008, mat: RM.accent }, lay.j.Neck.clone().addScaledVector(cf.y, 0.015 * s).addScaledVector(cf.z, 0.03 * s), 0.058 * s, 0.012 * s, basis(cf), 1.1, 1.15);
  neckline(c, G.tunic, 0.0, 1.0);
  // Wide sash (accent) wrapped at the waist, the knot's ends on the left hip.
  belt(c, G.outer, 0.02, 0.085, RM.accent, false);
  sc.ellipsoid({ layer: G.outer, bone: id('Hips'), k: 0.012, mat: RM.accent }, pf.p(-0.12 * s, 0.0, 0.08 * s), v3(0.03, 0.035, 0.025).multiplyScalar(s), basis(pf));
  sc.cone({ layer: G.outer, bone: id('Hips'), k: 0.01, mat: RM.accent }, pf.p(-0.12 * s, -0.01 * s, 0.09 * s), pf.p(-0.15 * s, -0.16 * s, 0.1 * s), 0.02 * s, 0.028 * s, { sz: 0.4, hint: pf.z });
}

function steppe(c: SculptContext, G: GarmentLayers): void {
  const { lay, sc, id, P } = c;
  const s = P.s;
  const cf = lay.chest;
  const pf = lay.pelvis;
  // Wrap coat (primary) crossing right over left, fur trimmed collar / cuffs / hem, belted; felt boots.
  maskTorso(c, G.tunic, -0.15 * s, neckTop(c));
  for (const side of RSIDES) {
    maskArm(c, G.tunic, side, 1.88, 0.085);
    maskLeg(c, G.tunic, side, 0, 0.6, 0.16);
    const wr = lay.j[`${side}Hand`];
    const el = lay.j[`${side}ForeArm`];
    const ff = limbFrame(el, wr, v3(0, 1, 0));
    sc.torus({ layer: G.outer, bone: id(`${side}ForeArmTwist`), k: 0.01, mat: RM.fur }, el.clone().lerp(wr, 0.86), 0.042 * s, 0.014 * s, basis(ff), 1, 1.15);
    const hip = lay.j[`${side}UpLeg`];
    const knee = lay.j[`${side}Leg`];
    const tf = limbFrame(hip, knee, v3(0, 1, -0.3));
    sc.torus({ layer: G.outer, bone: id(`${side}UpLeg`), k: 0.012, mat: RM.fur }, hip.clone().lerp(knee, 0.6), 0.08 * s, 0.016 * s, basis(tf), 1.05, 1.0);
  }
  // Diagonal front edge with fur, from the left collarbone to the right hip.
  sc.cone({ layer: G.outer, bone: id('Spine2'), bone1: id('Hips'), ramp: [0.2, 0.9], k: 0.012, mat: RM.fur }, cf.p(-0.06 * s, 0.22 * s, 0.12 * s), pf.p(0.1 * s, -0.02 * s, 0.14 * s), 0.016 * s, 0.014 * s);
  sc.torus({ layer: G.outer, bone: id('Spine2'), bone1: id('Neck'), ramp: [0.3, 0.9], k: 0.01, mat: RM.fur }, lay.j.Neck.clone().addScaledVector(cf.y, -0.005 * s).addScaledVector(cf.z, 0.03 * s), 0.066 * s, 0.018 * s, basis(cf), 1.12, 1.08);
  neckline(c, G.tunic, 0.01, 1.0);
  belt(c, G.outer, -0.01, 0.05, RM.leather, true);
}

/**
 * Akıncı: Ottoman frontier cavalry, reimagined. A crimson dolama to the knees with elbow sleeves and çintemani
 * borders, a mail vest over it with a round mirror plate (ayna zırh) on the chest, mail sleeves under engraved steel
 * vambraces, a wide knotted sash and tall boots. The helmet (çiçak), pelt and sword are gear.
 */
function akinci(c: SculptContext, G: GarmentLayers): void {
  const { lay, sc, id, P } = c;
  const s = P.s;
  const cf = lay.chest;
  const pf = lay.pelvis;
  // Dolama.
  maskTorso(c, G.tunic, -0.16 * s, neckTop(c));
  for (const side of RSIDES) {
    maskArm(c, G.tunic, side, 1.06, 0.09);
    maskLeg(c, G.tunic, side, 0, 0.86, 0.17);
    const sh = lay.j[`${side}Arm`];
    const el = lay.j[`${side}ForeArm`];
    band(c, G.tunic, sh.clone().lerp(el, 1.0), el.clone().sub(sh).normalize(), 0.11, 0.035 * s);
    const hip = lay.j[`${side}UpLeg`];
    const knee = lay.j[`${side}Leg`];
    band(c, G.tunic, hip.clone().lerp(knee, 0.8), knee.clone().sub(hip).normalize(), 0.16, 0.06 * s);
    // Mail sleeves on the forearms (the under layer, painted mail) and steel vambraces over them.
    const wr = lay.j[`${side}Hand`];
    sc.cylinder({ layer: G.under, op: PrimOp.Paint, bone: 0, paintMat: RM.mail, feather: 0.003 }, sh, wr, 0.1);
    const ff = limbFrame(el, wr, v3(0, 1, 0));
    sc.cone({ layer: G.outer, bone: id(`${side}ForeArm`), bone1: id(`${side}ForeArmTwist`), ramp: [0.3, 0.9], k: 0.004, mat: RM.iron }, el.clone().lerp(wr, 0.3), el.clone().lerp(wr, 0.93), 0.042 * s, 0.033 * s, { sz: 1.12, hint: ff.z });
    sc.torus({ layer: G.outer, bone: id(`${side}ForeArmTwist`), k: 0.003, mat: RM.metal }, el.clone().lerp(wr, 0.93), 0.034 * s, 0.0045 * s, basis(ff), 0.9, 1.1);
    sc.torus({ layer: G.outer, bone: id(`${side}ForeArm`), k: 0.003, mat: RM.metal }, el.clone().lerp(wr, 0.3), 0.043 * s, 0.0045 * s, basis(ff), 0.9, 1.1);
  }
  // Front edge band down the chest and a standing collar.
  sc.box({ layer: G.tunic, op: PrimOp.Paint, bone: 0, channels: [0.35], feather: 0.002 }, cf.p(0, 0.05 * s, 0.2 * s), v3(0.022 * s, 0.4 * s, 0.12 * s), 0.002, basis(cf));
  sc.torus({ layer: G.tunic, bone: id('Neck'), bone1: id('Spine2'), ramp: [0.2, 0.9], k: 0.008, mat: RM.accent }, lay.j.Neck.clone().addScaledVector(cf.y, 0.012 * s).addScaledVector(cf.z, 0.028 * s), 0.056 * s, 0.011 * s, basis(cf), 1.1, 1.15);
  neckline(c, G.tunic, 0.0, 1.0);
  // Mail vest over the dolama.
  sc.ellipsoid(mask(G.outer, id('Spine2'), 0.01), cf.p(0, 0.06 * s, 0.03 * s), v3(P.shoulderHalf * 1.02, 0.23 * s, 0.24 * s), basis(cf));
  armHoles(c, G.outer, 0.07 * s);
  neckline(c, G.outer, 0.03, 1.2);
  // Mirror plate on the chest (steel disc, gilt rim) and two smaller plates on the flanks.
  const front = cf.p(0, 0.09 * s, 0.0).addScaledVector(cf.z, (0.155 + 0.02 * P.build) * s);
  const plate = limbFrame(front, front.clone().add(cf.z), cf.y);
  sc.cylinder({ layer: G.outer, bone: id('Spine2'), k: 0.006, mat: RM.iron }, front.clone().addScaledVector(cf.z, -0.01 * s), front.clone().addScaledVector(cf.z, 0.008 * s), 0.07 * s);
  sc.torus({ layer: G.outer, bone: id('Spine2'), k: 0.003, mat: RM.metal }, front.clone().addScaledVector(cf.z, 0.008 * s), 0.07 * s, 0.006 * s, basis(plate));
  sc.sphere({ layer: G.outer, bone: id('Spine2'), k: 0.004, mat: RM.metal }, front.clone().addScaledVector(cf.z, 0.012 * s), 0.014 * s);
  for (const side of RSIDES) {
    const sg = rsign(side);
    const f2 = cf.p(0.125 * sg * s, 0.0, 0.0).addScaledVector(cf.z, 0.1 * s);
    const n2 = cf.z.clone().multiplyScalar(0.6).addScaledVector(cf.x, 0.8 * sg).normalize();
    sc.cylinder({ layer: G.outer, bone: id('Spine1'), k: 0.005, mat: RM.iron }, f2.clone().addScaledVector(n2, -0.01 * s), f2.clone().addScaledVector(n2, 0.007 * s), 0.045 * s);
    sc.torus({ layer: G.outer, bone: id('Spine1'), k: 0.003, mat: RM.metal }, f2.clone().addScaledVector(n2, 0.007 * s), 0.045 * s, 0.0045 * s, basis(limbFrame(f2, f2.clone().add(n2), cf.y)));
  }
  // Wide knotted sash.
  belt(c, G.outer, 0.02, 0.09, RM.accent, false);
  sc.ellipsoid({ layer: G.outer, bone: id('Hips'), k: 0.012, mat: RM.accent }, pf.p(-0.13 * s, 0.02 * s, 0.07 * s), v3(0.028, 0.032, 0.024).multiplyScalar(s), basis(pf));
  sc.cone({ layer: G.outer, bone: id('Hips'), k: 0.01, mat: RM.accent }, pf.p(-0.14 * s, 0.0, 0.08 * s), pf.p(-0.17 * s, -0.17 * s, 0.1 * s), 0.02 * s, 0.03 * s, { sz: 0.4, hint: pf.z });
}
