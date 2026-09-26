/**
 * Head and face: cranium, brow, orbits with lids around separate eyeballs, cheekbones, jaw (on the Jaw bone), lips
 * with a mouth slit, nose, ears; paint for lips and brows; face-rig weight regions (eyelids, mouth corners).
 * Proportions from face shape, nose shape, jaw width and the body shape (softer / more angular).
 */
import * as THREE from 'three';
import type { FaceShape, NoseShape } from '../appearance';
import { PrimOp } from '../sdf/field';
import { CH, RM } from '../materials-ids';
import { RSIDES, rsign } from '../skeleton';
import { basis, rotated, v3, type SculptContext } from './context';

/** Eyeball radius (m, before the head scale). */
export const EYE_RADIUS = 0.012;

interface FaceParams {
  jawW: number;
  gonionDrop: number;
  chinW: number;
  chinZ: number;
  cheek: number;
  cheekbone: number;
  len: number;
  forehead: number;
}

const FACE: Record<FaceShape, FaceParams> = {
  oval: { jawW: 0.041, gonionDrop: 0, chinW: 0.016, chinZ: 0, cheek: 0, cheekbone: 0, len: 0, forehead: 0 },
  square: { jawW: 0.047, gonionDrop: 0.006, chinW: 0.022, chinZ: 0.002, cheek: -0.001, cheekbone: 0.001, len: 0, forehead: 0.002 },
  round: { jawW: 0.044, gonionDrop: -0.004, chinW: 0.017, chinZ: -0.003, cheek: 0.006, cheekbone: -0.001, len: -0.006, forehead: 0 },
  long: { jawW: 0.039, gonionDrop: 0.002, chinW: 0.016, chinZ: 0.002, cheek: -0.002, cheekbone: -0.002, len: 0.01, forehead: -0.002 },
  heart: { jawW: 0.036, gonionDrop: -0.002, chinW: 0.011, chinZ: 0.002, cheek: 0.001, cheekbone: 0.004, len: 0.003, forehead: 0.004 },
};

interface NoseParams {
  proj: number;
  tipR: number;
  tipUp: number;
  alaW: number;
  bridgeR: number;
  bump: number;
}

const NOSE: Record<NoseShape, NoseParams> = {
  straight: { proj: 0.018, tipR: 0.0108, tipUp: 0.001, alaW: 0.0135, bridgeR: 0.0074, bump: 0 },
  aquiline: { proj: 0.025, tipR: 0.0094, tipUp: -0.003, alaW: 0.0135, bridgeR: 0.007, bump: 1 },
  button: { proj: 0.017, tipR: 0.0092, tipUp: 0.004, alaW: 0.013, bridgeR: 0.0056, bump: 0 },
  broad: { proj: 0.02, tipR: 0.0112, tipUp: 0, alaW: 0.017, bridgeR: 0.0082, bump: 0 },
};

/** Face landmarks (head frame, before the head scale) shared with hair, beard and gear. */
export const FACE_Y = { eyes: 0.066, nose: 0.03, mouth: 0.008, chin: -0.048, crown: 0.183 } as const;

/**
 * Heroic face: a structured skull with planes rather than an egg: a strong brow over deep-set eyes, high
 * cheekbones with a soft hollow under them, a straight nose, a defined jaw line and a firm chin. Face shape moves the
 * jaw, chin and cheeks, the nose shape the nose, `jaw` widens the jaw, the body shape sharpens or softens the whole.
 */
export function sculptHead(c: SculptContext): void {
  const { sc, lay, P, a, id } = c;
  const L = c.L.skin;
  const hf = lay.head;
  const hs = P.headScale;
  const masc = P.shape;
  const fem = 1 - masc;
  const fp = FACE[a.face];
  const np = NOSE[a.nose];
  const p = (x: number, y: number, z: number): THREE.Vector3 => hf.p(x * hs, y * hs, z * hs);
  const R = (x: number, y: number, z: number): THREE.Vector3 => v3(x * hs, y * hs, z * hs);
  const B = basis(hf);
  const head = id('Head');
  const jaw = id('Jaw');
  const len = fp.len * 0.7;
  const jawW = fp.jawW + (a.jaw - 0.5) * 0.012 + 0.006 * masc;
  const soft = 0.004 * fem + 0.003 * P.build;
  const my = FACE_Y.mouth - len * 0.6;
  const chinY = -0.037 - len;

  // Skull and forehead.
  sc.ellipsoid({ layer: L, bone: head }, p(0, 0.1, -0.014), R(0.071, 0.083, 0.092), B);
  sc.ellipsoid({ layer: L, bone: head, k: 0.028 }, p(0, 0.112, 0.036), R(0.061 + fp.forehead, 0.05, 0.05), basis(rotated(hf, 0.15, 0, 0)));
  // Upper face (cheekbone level) wider than the lower face: the face narrows to the chin.
  sc.ellipsoid({ layer: L, bone: head, k: 0.03 }, p(0, 0.056, 0.028), R(0.057 + fp.cheekbone * 0.5, 0.045, 0.052), B);
  sc.ellipsoid({ layer: L, bone: head, k: 0.03 }, p(0, 0.012 - len * 0.5, 0.03), R(0.04 + fp.cheek * 0.6 + (jawW - 0.047) * 0.5 + soft, 0.044 + len * 0.4, 0.056), B);
  // Brow ridge: a firm horizontal shelf the eyes sit under.
  sc.ellipsoid({ layer: L, bone: head, k: 0.018 }, p(0, 0.086, 0.074), R(0.053, 0.011 + 0.002 * masc, 0.016 + 0.005 * masc), B);
  for (const side of RSIDES) {
    const sg = rsign(side);
    sc.ellipsoid({ layer: L, bone: head, k: 0.012 }, p(0.029 * sg, 0.087, 0.08 + 0.003 * masc), R(0.02, 0.008, 0.01), basis(rotated(hf, 0, 0.25 * sg, -0.1 * sg)));
    // High cheekbones, and the soft hollow below them.
    sc.ellipsoid({ layer: L, bone: head, k: 0.02 }, p((0.049 + fp.cheekbone) * sg, 0.056, 0.05), R(0.019, 0.012, 0.02), basis(rotated(hf, 0, 0.55 * sg, 0)));
    sc.ellipsoid({ layer: L, op: PrimOp.Subtract, bone: head, k: 0.025 }, p(0.056 * sg, 0.028 - len * 0.4, 0.044), R(0.008, 0.013, 0.012), B);
    // Jaw line: from under the ear down to the angle, then forward to the chin (on the Jaw bone).
    const gonion = p(jawW * sg, -0.018 - len * 0.7 - fp.gonionDrop, 0.004);
    sc.cone({ layer: L, bone: head, k: 0.016 }, p(0.054 * sg, 0.028, -0.006), gonion, 0.011 * hs, (0.011 + 0.002 * masc) * hs);
    sc.cone({ layer: L, bone: head, bone1: jaw, ramp: [0.3, 0.9], k: 0.016 }, gonion, p((0.016 + fp.chinW * 0.4) * sg, chinY - 0.004, 0.076 + fp.chinZ), (0.011 + 0.002 * masc) * hs, 0.012 * hs);
  }
  // Chin: square-ish on an angular face.
  sc.box({ layer: L, bone: jaw, k: 0.014 }, p(0, chinY, 0.082 + fp.chinZ), R(0.013 + fp.chinW * 0.4 + 0.003 * masc, 0.009, 0.008), 0.008 * hs, B);
  sc.ellipsoid({ layer: L, bone: jaw, bone1: head, ramp: [0.3, 0.8], k: 0.014 }, p(0, chinY - 0.002, 0.05), R(0.024 + fp.chinW * 0.4, 0.008, 0.026), basis(rotated(hf, -0.35, 0, 0)));

  // Mouth: firm lips (upper on the head, lower on the jaw), the slit, dark interior; corner and jaw weights.
  sc.ellipsoid({ layer: L, bone: head, k: 0.016 }, p(0, my + 0.006, 0.08), R(0.024, 0.02, 0.018), B);
  sc.ellipsoid({ layer: L, bone: head, k: 0.006 }, p(0, my + 0.0055, 0.092), R(0.0195, 0.0048 + 0.0016 * fem, 0.0072), basis(rotated(hf, -0.3, 0, 0)));
  sc.ellipsoid({ layer: L, bone: jaw, k: 0.006 }, p(0, my - 0.0065, 0.09), R(0.0175, 0.0058 + 0.0018 * fem, 0.0078), basis(rotated(hf, 0.25, 0, 0)));
  sc.ellipsoid({ layer: L, op: PrimOp.Subtract, bone: head, k: 0.0014 }, p(0, my - 0.0005, 0.097), R(0.022, 0.0009, 0.012), B);
  sc.ellipsoid({ layer: L, op: PrimOp.Paint, bone: head, channels: [undefined, 1], feather: 0.002 }, p(0, my - 0.0005, 0.094), R(0.02, 0.0105 + 0.002 * fem, 0.012), B);
  sc.ellipsoid({ layer: L, op: PrimOp.Paint, bone: head, paintMat: RM.teeth, feather: 0.001 }, p(0, my - 0.0005, 0.087), R(0.018, 0.0032, 0.008), B);
  for (const side of RSIDES) {
    sc.sphere({ layer: L, op: PrimOp.WeightPaint, bone: id(`${side}Mouth`), feather: 0.007 }, p(0.022 * rsign(side), my, 0.088), 0.005 * hs);
  }
  sc.ellipsoid({ layer: L, op: PrimOp.WeightPaint, bone: jaw, feather: 0.004 }, p(0, my - 0.018, 0.08), R(0.02, 0.013, 0.02), B);

  // Nose: straight and strong.
  const tip = p(0, FACE_Y.nose + 0.004 + np.tipUp, 0.092 + np.proj * 0.72);
  sc.cone({ layer: L, bone: head, k: 0.008 }, p(0, 0.072, 0.083), p(0, FACE_Y.nose + 0.008 + np.tipUp, 0.089 + np.proj * 0.68), np.bridgeR * 0.75 * hs, np.bridgeR * 1.1 * hs, { sx: 1.3, hint: hf.z });
  if (np.bump > 0) {
    sc.ellipsoid({ layer: L, bone: head, k: 0.008 }, p(0, 0.056, 0.092 + np.proj * 0.4), R(0.0055, 0.009, 0.005), B);
  }
  sc.sphere({ layer: L, bone: head, k: 0.008 }, tip, np.tipR * 0.95 * hs);
  for (const side of RSIDES) {
    const sg = rsign(side);
    sc.sphere({ layer: L, bone: head, k: 0.007 }, p(np.alaW * 0.9 * sg, FACE_Y.nose - 0.002 + np.tipUp * 0.5, 0.088 + np.proj * 0.3), 0.0062 * hs);
    sc.ellipsoid({ layer: L, op: PrimOp.Subtract, bone: head, k: 0.0012 }, p(0.0066 * sg, FACE_Y.nose - 0.0055 + np.tipUp * 0.6, 0.093 + np.proj * 0.42), R(0.003, 0.0018, 0.0042), basis(rotated(hf, 0.4, 0.3 * sg, 0)));
    if (a.age > 0.35) {
      sc.cone({ layer: L, op: PrimOp.Subtract, bone: head, k: 0.005 }, p((np.alaW + 0.005) * sg, FACE_Y.nose, 0.088), p(0.026 * sg, my - 0.006, 0.083), 0.0009 * hs * a.age, 0.0005 * hs);
    }
  }

  // Orbits, lids and openings (eyeballs are separate meshes behind them): deep-set, almond, slightly hooded.
  for (const side of RSIDES) {
    const sg = rsign(side);
    const eye = lay.j[`${side}Eye`];
    sc.ellipsoid({ layer: L, op: PrimOp.Subtract, bone: head, k: 0.008 }, p(0.031 * sg, FACE_Y.eyes + 0.004, 0.083), R(0.017, 0.012, 0.013), B);
    sc.sphere({ layer: L, bone: head, k: 0.005 }, eye, (EYE_RADIUS + 0.0016) * hs);
    const ap = rotated(hf, 0, 0.16 * sg, -0.07 * sg);
    sc.ellipsoid({ layer: L, op: PrimOp.Subtract, bone: head, k: 0.0012 }, eye.clone().addScaledVector(hf.z, 0.0128 * hs).addScaledVector(hf.y, -0.0012 * hs), R(0.0148, 0.0052 + 0.0008 * fem, 0.0105), basis(ap));
    sc.ellipsoid({ layer: L, op: PrimOp.Subtract, bone: head, k: 0.003 }, eye.clone().addScaledVector(hf.y, 0.0108 * hs).addScaledVector(hf.z, 0.0095 * hs), R(0.013, 0.0014, 0.0035), basis(ap));
    sc.ellipsoid({ layer: L, op: PrimOp.WeightPaint, bone: id(`${side}Eyelid`), feather: 0.0025 }, eye.clone().addScaledVector(hf.y, 0.0072 * hs).addScaledVector(hf.z, 0.0095 * hs), R(0.017, 0.0062, 0.009), basis(ap));
    // Eyebrows (paint): straight, low and strong.
    for (let k = 0; k < 3; k++) {
      const u = k / 2;
      const x = (0.013 + 0.02 * u) * sg;
      const y = FACE_Y.eyes + 0.02 + 0.002 * Math.sin(u * Math.PI) * (1 - 0.5 * masc) - 0.0015 * u;
      sc.ellipsoid(
        { layer: L, op: PrimOp.Paint, bone: head, channels: [undefined, undefined, 1], feather: 0.0016 },
        p(x, y, 0.086 - 0.009 * u * u),
        R(0.011, 0.0036 + 0.0014 * masc - 0.0008 * u, 0.014),
        basis(rotated(hf, 0, 0.25 * sg * u, -0.1 * sg * (u - 0.3))),
      );
    }
    // Ear.
    const ef = rotated(hf, 0, 0.12 * sg, 0.12 * sg, p(0.07 * sg, 0.058, -0.014));
    sc.ellipsoid({ layer: L, bone: head, k: 0.006 }, ef.p(0.004 * sg * hs, 0.004 * hs, -0.004 * hs), R(0.008, 0.026, 0.016), basis(ef));
    sc.ellipsoid({ layer: L, op: PrimOp.Subtract, bone: head, k: 0.003 }, ef.p(0.011 * sg * hs, 0.004 * hs, -0.001 * hs), R(0.006, 0.016, 0.01), basis(ef));
    sc.sphere({ layer: L, bone: head, k: 0.004 }, ef.p(0.004 * sg * hs, -0.022 * hs, 0.002 * hs), 0.006 * hs);
  }
  // Warmth (ch0 on skin): cheeks, nose tip, ears.
  const warm = { channels: [0.7] as [number], feather: 0.012, op: PrimOp.Paint, layer: L, bone: head };
  for (const side of RSIDES) {
    const sg = rsign(side);
    sc.sphere(warm, p(0.043 * sg, 0.04, 0.06), 0.011 * hs);
    sc.sphere({ ...warm, feather: 0.006 }, p(0.072 * sg, 0.056, -0.014), 0.018 * hs);
  }
  sc.sphere({ ...warm, feather: 0.008 }, tip, 0.007 * hs);
  void CH;
}
