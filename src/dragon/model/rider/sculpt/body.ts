/**
 * The rider's bare body as a sculpt of anatomical masses (ribcage, pelvis, pectorals, scapulae, deltoids, biceps /
 * triceps, forearm flexors, quadriceps, hamstrings, calves...), smoothly blended. Clothes are shells grown from it,
 * so it also shapes every garment. Head and face: head.ts.
 */
import * as THREE from 'three';
import { PrimOp } from '../sdf/field';
import { RM } from '../materials-ids';
import { FINGERS, RSIDES, rsign, type RSide } from '../skeleton';
import { basis, lerp, limbFrame, v3, type SculptContext } from './context';

export function sculptBody(c: SculptContext): void {
  sculptTorso(c);
  for (const side of RSIDES) {
    sculptArm(c, side);
    sculptHand(c, side);
    sculptLeg(c, side);
  }
}

function sculptTorso(c: SculptContext): void {
  const { sc, lay, P, id } = c;
  const L = c.L.skin;
  const s = P.s;
  const fem = 1 - P.shape;
  const b = P.build;
  const g = (0.9 + 0.22 * b) * s;
  const pf = lay.pelvis;
  const cf = lay.chest;
  const hips = id('Hips');
  const spine = id('Spine');
  const spine1 = id('Spine1');
  const spine2 = id('Spine2');
  const neck = id('Neck');
  const head = id('Head');
  const j = lay.j;

  // Pelvis and seat.
  sc.ellipsoid({ layer: L, bone: hips, k: 0.02 }, pf.p(0, 0.03 * s, 0.01 * s), v3((0.152 + 0.022 * fem) * g, 0.11 * s, 0.1 * g), basis(pf));
  for (const sg of [1, -1]) {
    // Gluteal masses, flattened on the saddle.
    sc.ellipsoid({ layer: L, bone: hips, k: 0.03 }, pf.p(0.068 * sg * s, -0.025 * s, -0.06 * s), v3(0.082 * g, 0.075 * g, 0.075 * g), basis(pf));
    // Hip (greater trochanter) masses, fuller with a feminine shape.
    sc.ellipsoid(
      { layer: L, bone: hips, bone1: id(sg > 0 ? 'RightUpLeg' : 'LeftUpLeg'), ramp: [0.2, 0.9], k: 0.035 },
      pf.p((0.13 + 0.02 * fem) * sg * s, -0.03 * s, 0.0),
      v3((0.055 + 0.015 * fem) * g, 0.075 * s, 0.07 * g),
      basis(pf),
    );
  }
  // Lower belly.
  sc.ellipsoid({ layer: L, bone: hips, bone1: spine, ramp: [0.3, 0.9], k: 0.04 }, pf.p(0, 0.08 * s, 0.045 * s + 0.02 * b * s), v3(0.125 * g, 0.085 * s, (0.075 + 0.03 * b) * g), basis(pf));
  // Waist (narrower on a feminine shape) and lower ribs.
  const waist = j.Spine.clone().lerp(j.Spine1, 0.4);
  sc.ellipsoid({ layer: L, bone: spine, k: 0.05 }, waist.clone().addScaledVector(cf.z, 0.018 * s), v3((0.132 - 0.02 * fem + 0.03 * b) * s, 0.09 * s, (0.095 + 0.028 * b) * s), basis(cf));
  sc.ellipsoid({ layer: L, bone: spine1, k: 0.05 }, j.Spine1.clone().addScaledVector(cf.y, 0.04 * s).addScaledVector(cf.z, 0.022 * s), v3((0.14 - 0.014 * fem + 0.022 * b) * s, 0.1 * s, (0.1 + 0.018 * b) * s), basis(cf));
  // Ribcage: centred in front of the spine.
  sc.ellipsoid(
    { layer: L, bone: spine2, k: 0.05 },
    cf.p(0, 0.085 * s, 0.028 * s),
    v3((0.148 + 0.014 * P.shape + 0.014 * b) * s, 0.138 * s, (0.108 + 0.012 * b) * s),
    basis(cf),
  );
  for (const sg of [1, -1]) {
    // Pectorals (masculine) / breasts (feminine).
    sc.ellipsoid({ layer: L, bone: spine2, k: 0.035 }, cf.p(0.062 * sg * s, 0.145 * s, 0.098 * s), v3(0.068 * s, 0.05 * s, (0.02 + 0.02 * P.shape + 0.01 * b) * s), basis(cf));
    if (fem > 0.15) {
      const bs = (0.025 + 0.03 * fem + 0.015 * b) * s;
      sc.ellipsoid({ layer: L, bone: spine2, k: 0.04 }, cf.p(0.068 * sg * s, 0.1 * s, 0.1 * s), v3(bs * 1.15, bs * 1.05, bs * 0.95), basis(cf));
    }
    // Latissimus.
    sc.ellipsoid({ layer: L, bone: spine1, bone1: spine2, ramp: [0.3, 0.8], k: 0.05 }, cf.p(0.112 * sg * s, 0.02 * s, -0.02 * s), v3(0.05 * g, 0.12 * s, 0.075 * s), basis(cf));
    // Scapulae.
    sc.ellipsoid({ layer: L, bone: spine2, k: 0.035 }, cf.p(0.078 * sg * s, 0.14 * s, -0.072 * s), v3(0.058 * s, 0.07 * s, 0.028 * s), basis(cf));
    // Trapezius: from the neck down to the acromion.
    const side: RSide = sg > 0 ? 'Right' : 'Left';
    const acromion = j[`${side}Arm`].clone().addScaledVector(cf.y, 0.03 * s).addScaledVector(cf.x, -0.012 * sg * s);
    sc.cone(
      { layer: L, bone: spine2, bone1: id(`${side}Shoulder`), ramp: [0.3, 1], k: 0.04 },
      j.Neck.clone().addScaledVector(cf.x, 0.02 * sg * s).addScaledVector(cf.y, 0.02 * s).addScaledVector(cf.z, -0.012 * s),
      acromion,
      (0.04 + 0.012 * P.shape) * s,
      0.026 * s,
      { sz: 0.7, hint: cf.z },
    );
    // Clavicle ridge.
    sc.cone({ layer: L, bone: spine2, bone1: id(`${side}Shoulder`), ramp: [0, 1], k: 0.02 }, j[`${side}Shoulder`].clone().addScaledVector(cf.z, 0.012 * s), acromion.clone().addScaledVector(cf.z, 0.018 * s), 0.011 * s, 0.012 * s);
  }
  // Neck: over the cervical spine, forward of the bone line; throat and the sternocleidomastoids.
  const hf = lay.head;
  const hs = P.headScale;
  const neckR = (0.04 + 0.009 * P.shape + 0.006 * b) * s;
  // The neck enters the skull behind the jaw: its top is narrower and further back than its base.
  sc.cone(
    { layer: L, bone: neck, bone1: head, ramp: [0.5, 1.05], k: 0.026 },
    j.Neck.clone().addScaledVector(cf.z, 0.012 * s),
    hf.p(0, 0.01 * hs, -0.022 * hs),
    neckR * 1.08,
    neckR * 0.8,
    { sz: 0.95, hint: cf.z },
  );
  for (const sg of [1, -1]) {
    sc.cone({ layer: L, bone: neck, bone1: head, ramp: [0.4, 1], k: 0.014 }, hf.p(0.045 * sg * hs, 0.02 * hs, -0.005 * hs), j.Neck.clone().addScaledVector(cf.x, 0.016 * sg * s).addScaledVector(cf.z, 0.06 * s), 0.011 * s, 0.01 * s);
  }
  if (P.shape > 0.55) {
    // Laryngeal prominence.
    sc.ellipsoid({ layer: L, bone: neck, k: 0.012 }, hf.p(0, -0.05 * hs, 0.052 * hs), v3(0.01, 0.013, 0.01).multiplyScalar(s * (P.shape - 0.4)), basis(hf));
  }
}

function sculptArm(c: SculptContext, side: RSide): void {
  const { sc, lay, P, id } = c;
  const L = c.L.skin;
  const s = P.s;
  const b = P.build;
  const fem = 1 - P.shape;
  const g = (0.88 + 0.26 * b) * (1 - 0.08 * fem) * s;
  const sg = rsign(side);
  const sh = lay.j[`${side}Arm`];
  const el = lay.j[`${side}ForeArm`];
  const wr = lay.j[`${side}Hand`];
  const arm = id(`${side}Arm`);
  const fore = id(`${side}ForeArm`);
  const twist = id(`${side}ForeArmTwist`);
  const hand = id(`${side}Hand`);
  const clav = id(`${side}Shoulder`);
  // Upper arm frame: y along, z anterior (roughly forward), x lateral.
  const uf = limbFrame(sh, el, v3(0, 0.25, -1));
  const lateral = v3(sg, 0, 0);
  // Humerus core.
  sc.cone({ layer: L, bone: arm, bone1: fore, ramp: [0.82, 1.02], k: 0.03 }, sh, el, 0.046 * g, 0.034 * g, { sz: 0.95, hint: uf.z });
  // Deltoid cap: over the joint, wrapping front, side and back.
  sc.ellipsoid(
    { layer: L, bone: clav, bone1: arm, ramp: [0.55, 0.85], k: 0.03 },
    sh.clone().addScaledVector(lateral, 0.016 * s).addScaledVector(uf.y, 0.03 * s),
    v3(0.05 * g, 0.075 * g, 0.052 * g),
    basis(uf),
  );
  const mus = 0.6 + 0.4 * P.shape + 0.3 * b;
  // Biceps (front) and triceps (back).
  sc.ellipsoid({ layer: L, bone: arm, k: 0.025 }, uf.p(0, 0.17 * s, 0.018 * s), v3(0.027 * g * mus, 0.075 * s, 0.026 * g * mus), basis(uf));
  sc.ellipsoid({ layer: L, bone: arm, k: 0.025 }, uf.p(0, 0.13 * s, -0.02 * s), v3(0.03 * g * mus, 0.09 * s, 0.026 * g * mus), basis(uf));
  // Elbow: olecranon behind, epicondyles.
  const ff = limbFrame(el, wr, v3(0, 1, 0));
  sc.sphere({ layer: L, bone: fore, bone1: arm, ramp: [0.4, 0.7], k: 0.02 }, el.clone().addScaledVector(uf.z, -0.018 * s), 0.024 * s);
  // Forearm: wider across the radial (thumb-up) axis near the elbow, flatter to the wrist.
  sc.cone({ layer: L, bone: fore, bone1: twist, ramp: [0.25, 0.85], k: 0.025 }, el, wr, 0.041 * g, 0.024 * s, { sx: 0.82, sz: 1.12, hint: ff.z });
  // Flexor / extensor mass and brachioradialis bulging near the elbow.
  sc.ellipsoid({ layer: L, bone: fore, k: 0.03 }, ff.p(0.0, 0.08 * s, 0.012 * s), v3(0.034 * g, 0.075 * s, 0.036 * g * mus), basis(ff));
  sc.ellipsoid({ layer: L, bone: fore, bone1: arm, ramp: [0.1, 0.6], k: 0.025 }, ff.p(0.01 * sg * s, 0.03 * s, 0.03 * s), v3(0.02 * g, 0.06 * s, 0.022 * g), basis(ff));
  // Wrist: flattened, dorsal-palmar thin.
  const hfr = lay.hands[side].frame;
  sc.ellipsoid({ layer: L, bone: twist, bone1: hand, ramp: [0.35, 0.75], k: 0.012 }, wr.clone().addScaledVector(ff.y, -0.012 * s), v3(0.018 * s, 0.028 * s, 0.026 * s), basis(hfr));
}

function sculptHand(c: SculptContext, side: RSide): void {
  const { sc, lay, P, id } = c;
  const L = c.L.skin;
  const hand = id(`${side}Hand`);
  const layout = lay.hands[side];
  const f = layout.frame;
  const hs = P.handScale;
  const g = 0.94 + 0.12 * P.build;
  // Hand-local point: (dorsal, distal, radial).
  const Lp = (d: number, di: number, r: number): THREE.Vector3 => f.p(d * hs, di * hs, r * hs);
  const B = basis(f);
  // Palm: a rounded slab, thicker at the heel of the hand; knuckle ridge.
  sc.box({ layer: L, bone: hand, k: 0.008 }, Lp(-0.001, 0.05, 0.0), v3(0.0125 * hs * g, 0.04 * hs, 0.037 * hs), 0.011 * hs, B);
  sc.ellipsoid({ layer: L, bone: hand, k: 0.012 }, Lp(-0.004, 0.02, -0.002), v3(0.016 * hs * g, 0.022 * hs, 0.03 * hs), B);
  // Thenar (thumb ball) and hypothenar pads on the palm side.
  sc.ellipsoid({ layer: L, bone: hand, bone1: id(`${side}HandThumb1`), ramp: [0.2, 0.9], k: 0.012 }, Lp(-0.012, 0.035, 0.02), v3(0.014 * hs * g, 0.028 * hs, 0.016 * hs), B);
  sc.ellipsoid({ layer: L, bone: hand, k: 0.012 }, Lp(-0.011, 0.055, -0.026), v3(0.011 * hs * g, 0.032 * hs, 0.011 * hs), B);
  for (const fname of FINGERS) {
    const pts = layout.chains[fname];
    const r = layout.radii[fname];
    for (let k = 0; k < 3; k++) {
      const bone = id(`${side}Hand${fname}${k + 1}`);
      const parent = k === 0 ? hand : id(`${side}Hand${fname}${k}`);
      // Segment: blends with the parent bone across the joint.
      sc.cone({ layer: L, bone: parent, bone1: bone, ramp: [-0.25, 0.28], k: k === 0 ? (fname === 'Thumb' ? 0.014 : 0.008) : 0.003 }, pts[k], pts[k + 1], r[k], r[k + 1], { sx: 1.06, sz: 0.94, hint: f.x });
    }
    // Knuckle bumps on the back of the hand (MCP), fingertip pad.
    if (fname !== 'Thumb') {
      sc.sphere({ layer: L, bone: hand, bone1: id(`${side}Hand${fname}1`), ramp: [0.3, 0.7], k: 0.006 }, pts[0].clone().addScaledVector(f.x, r[0] * 0.35), r[0] * 0.95);
    }
    const tip = pts[3];
    const dir = pts[3].clone().sub(pts[2]).normalize();
    sc.sphere({ layer: L, bone: id(`${side}Hand${fname}3`), k: 0.004 }, tip.clone().addScaledVector(dir, -r[3] * 0.25), r[3] * 1.02);
    // Nail: paint on the back of the last segment.
    const nailC = tip.clone().addScaledVector(dir, -r[3] * 0.9).addScaledVector(f.x, r[3] * 0.9);
    sc.ellipsoid({ layer: L, op: PrimOp.Paint, bone: 0, paintMat: RM.nail, feather: 0.0012 }, nailC, v3(r[3] * 0.6, r[3] * 1.3, r[3] * 0.75), basis(limbFrame(pts[2], pts[3], f.x)));
  }
}

function sculptLeg(c: SculptContext, side: RSide): void {
  const { sc, lay, P, id } = c;
  const L = c.L.skin;
  const s = P.s;
  const b = P.build;
  const fem = 1 - P.shape;
  const g = (0.88 + 0.26 * b) * s;
  const sg = rsign(side);
  const hip = lay.j[`${side}UpLeg`];
  const knee = lay.j[`${side}Leg`];
  const ankle = lay.j[`${side}Foot`];
  const ball = lay.j[`${side}ToeBase`];
  const up = id(`${side}UpLeg`);
  const leg = id(`${side}Leg`);
  const foot = id(`${side}Foot`);
  const toe = id(`${side}ToeBase`);
  const hips = id('Hips');
  // Thigh frame: z toward the front of the thigh (up and forward when seated).
  const tf = limbFrame(hip, knee, v3(0, 1, -0.3));
  const mus = 0.7 + 0.3 * P.shape + 0.25 * b;
  sc.cone({ layer: L, bone: up, bone1: leg, ramp: [0.84, 1.04], k: 0.04 }, hip.clone().addScaledVector(tf.y, -0.02 * s), knee, (0.082 + 0.012 * fem) * g, 0.052 * g, { sx: 1.05, sz: 0.95, hint: tf.z });
  // Quadriceps (front), vastus medialis teardrop above the knee, hamstrings, adductors.
  sc.ellipsoid({ layer: L, bone: up, k: 0.04 }, tf.p(0.005 * sg * s, 0.2 * s, 0.03 * s), v3(0.05 * g * mus, 0.17 * s, 0.04 * g * mus), basis(tf));
  sc.ellipsoid({ layer: L, bone: up, bone1: leg, ramp: [0.7, 1.0], k: 0.03 }, tf.p(-0.03 * sg * s, 0.34 * s, 0.022 * s), v3(0.03 * g, 0.05 * s, 0.028 * g), basis(tf));
  sc.ellipsoid({ layer: L, bone: up, k: 0.04 }, tf.p(0, 0.2 * s, -0.035 * s), v3(0.052 * g, 0.16 * s, 0.038 * g), basis(tf));
  sc.ellipsoid({ layer: L, bone: hips, bone1: up, ramp: [0.3, 0.9], k: 0.04 }, tf.p(-0.035 * sg * s, 0.08 * s, -0.005 * s), v3(0.04 * g, 0.12 * s, 0.045 * g), basis(tf));
  // Knee: joint mass and patella.
  const sf = limbFrame(knee, ankle, v3(0, 0, -1));
  sc.sphere({ layer: L, bone: leg, bone1: up, ramp: [0.45, 0.6], k: 0.025 }, knee, 0.047 * g);
  sc.ellipsoid({ layer: L, bone: leg, bone1: up, ramp: [0.3, 0.7], k: 0.012 }, knee.clone().addScaledVector(tf.y, 0.012 * s).addScaledVector(sf.z, 0.034 * s).addScaledVector(tf.z, 0.01 * s), v3(0.024 * s, 0.028 * s, 0.014 * s), basis(tf));
  // Shin and calf (gastrocnemius behind the upper shin), ankle bones.
  sc.cone({ layer: L, bone: leg, bone1: foot, ramp: [0.9, 1.05], k: 0.03 }, knee, ankle, 0.047 * g, 0.03 * s, { hint: sf.z });
  sc.ellipsoid({ layer: L, bone: leg, k: 0.035 }, sf.p(0, 0.13 * s, -0.03 * s), v3(0.043 * g * mus, 0.1 * s, 0.038 * g * mus), basis(sf));
  for (const m of [1, -1]) {
    sc.sphere({ layer: L, bone: leg, bone1: foot, ramp: [0.3, 0.7], k: 0.01 }, ankle.clone().addScaledVector(sf.x, 0.022 * m * s), 0.017 * s);
  }
  // Foot: heel, arch, ball and toes (always in boots or wraps).
  const fwd = ball.clone().sub(ankle).setY(0).normalize();
  const ff = limbFrame(ankle, ball, v3(0, 1, 0));
  sc.sphere({ layer: L, bone: foot, k: 0.02 }, ankle.clone().addScaledVector(fwd, -0.035 * s).add(v3(0, -0.045 * s, 0)), 0.03 * s);
  sc.cone({ layer: L, bone: foot, k: 0.025 }, ankle.clone().add(v3(0, -0.035 * s, 0)), ball, 0.034 * s, 0.028 * s, { sx: 1.35, sz: 0.8, hint: ff.z });
  const toeEnd = ball.clone().addScaledVector(fwd, 0.06 * s).add(v3(0, -0.006 * s, 0));
  sc.cone({ layer: L, bone: toe, k: 0.015 }, ball, toeEnd, 0.024 * s, 0.018 * s, { sx: 1.5, sz: 0.7, hint: ff.z });
}

export { lerp };
