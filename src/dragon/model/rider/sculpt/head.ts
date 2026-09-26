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
export const EYE_RADIUS = 0.0138;

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
export const FACE_Y = { eyes: 0.062, nose: 0.03, mouth: 0.004, chin: -0.042, crown: 0.185 } as const;

/**
 * Cartoon face: an egg (cranium + lower-face volume), big eyes set low under a clear brow, a small rounded nose, a
 * short upper lip, round cheeks and a round chin. Face shape moves the jaw and cheeks, the nose shape the nose,
 * `jaw` widens the jaw corners, the body shape sharpens (angular) or softens (round) the whole.
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
  const len = fp.len * 0.6;
  const jawW = fp.jawW + (a.jaw - 0.5) * 0.012 + 0.004 * masc;
  const soft = 0.003 * fem + 0.003 * P.build;

  // The egg: cranium and the lower face.
  sc.ellipsoid({ layer: L, bone: head }, p(0, 0.098, -0.008), R(0.074, 0.087, 0.09), B);
  sc.ellipsoid({ layer: L, bone: head, k: 0.035 }, p(0, 0.03 - len * 0.5, 0.022), R(0.056 + (jawW - 0.041) * 0.8 + fp.cheek * 0.5, 0.07 + len * 0.5, 0.066), B);
  // Jaw corners (square / strong jaws) and the chin (on the Jaw bone).
  const corner = Math.max(0, jawW - 0.038) * 0.9;
  if (corner > 0.002) {
    for (const side of RSIDES) {
      sc.sphere({ layer: L, bone: head, bone1: jaw, ramp: [0.3, 0.9], k: 0.03 }, p((jawW - 0.004) * rsign(side), -0.014 - len, 0.008 - fp.gonionDrop), (0.012 + corner) * hs);
    }
  }
  const chinY = -0.029 - len;
  sc.ellipsoid({ layer: L, bone: jaw, k: 0.022 }, p(0, chinY, 0.066 + fp.chinZ), R(0.018 + fp.chinW * 0.4 + 0.003 * masc, 0.016, 0.018), B);
  // Brow: a soft ridge, heavier on an angular face; the eyes sit under it.
  sc.ellipsoid({ layer: L, bone: head, k: 0.02 }, p(0, 0.09, 0.075), R(0.054 + fp.forehead, 0.011 + 0.002 * masc, 0.014 + 0.004 * masc), B);
  for (const side of RSIDES) {
    const sg = rsign(side);
    // Round cheeks (fuller on a round face or a soft shape) and cheekbones.
    sc.ellipsoid({ layer: L, bone: head, k: 0.03 }, p(0.035 * sg, 0.026 - len * 0.3, 0.058), R(0.023 + fp.cheek + soft, 0.023, 0.023 + fp.cheek * 0.5), B);
    sc.ellipsoid({ layer: L, bone: head, k: 0.025 }, p((0.05 + fp.cheekbone) * sg, 0.055, 0.045), R(0.018, 0.013, 0.02), basis(rotated(hf, 0, 0.5 * sg, 0)));
  }

  // Mouth: lips (upper on the head, lower on the jaw), the slit, dark interior; corner and jaw weight regions.
  const my = FACE_Y.mouth - len * 0.6;
  sc.ellipsoid({ layer: L, bone: head, k: 0.007 }, p(0, my + 0.0065, 0.087), R(0.019, 0.0058 + 0.0016 * fem, 0.008), basis(rotated(hf, -0.3, 0, 0)));
  sc.ellipsoid({ layer: L, bone: jaw, k: 0.007 }, p(0, my - 0.0075, 0.085), R(0.017, 0.0068 + 0.0018 * fem, 0.0085), basis(rotated(hf, 0.25, 0, 0)));
  sc.ellipsoid({ layer: L, op: PrimOp.Subtract, bone: head, k: 0.0014 }, p(0, my - 0.0005, 0.092), R(0.022, 0.001, 0.012), B);
  sc.ellipsoid({ layer: L, op: PrimOp.Paint, bone: head, channels: [undefined, 1], feather: 0.002 }, p(0, my - 0.0005, 0.09), R(0.021, 0.0115 + 0.002 * fem, 0.012), B);
  sc.ellipsoid({ layer: L, op: PrimOp.Paint, bone: head, paintMat: RM.teeth, feather: 0.001 }, p(0, my - 0.0005, 0.083), R(0.018, 0.0035, 0.008), B);
  for (const side of RSIDES) {
    sc.sphere({ layer: L, op: PrimOp.WeightPaint, bone: id(`${side}Mouth`), feather: 0.007 }, p(0.022 * rsign(side), my, 0.084), 0.005 * hs);
  }
  sc.ellipsoid({ layer: L, op: PrimOp.WeightPaint, bone: jaw, feather: 0.004 }, p(0, my - 0.018, 0.078), R(0.02, 0.013, 0.02), B);

  // Nose: small and rounded, a soft bridge.
  const tip = p(0, 0.033 + np.tipUp, 0.093 + np.proj * 0.55);
  sc.cone({ layer: L, bone: head, k: 0.01 }, p(0, 0.064, 0.085), p(0, 0.038 + np.tipUp, 0.09 + np.proj * 0.5), np.bridgeR * 0.55 * hs, np.bridgeR * 1.05 * hs, { sx: 1.3, hint: hf.z });
  if (np.bump > 0) {
    sc.ellipsoid({ layer: L, bone: head, k: 0.008 }, p(0, 0.053, 0.093 + np.proj * 0.25), R(0.0058, 0.009, 0.005), B);
  }
  sc.sphere({ layer: L, bone: head, k: 0.009 }, tip, np.tipR * hs);
  for (const side of RSIDES) {
    const sg = rsign(side);
    sc.sphere({ layer: L, bone: head, k: 0.008 }, p(np.alaW * 0.8 * sg, 0.028 + np.tipUp * 0.5, 0.088 + np.proj * 0.2), 0.0064 * hs);
    sc.ellipsoid({ layer: L, op: PrimOp.Subtract, bone: head, k: 0.0012 }, p(0.0068 * sg, 0.0245 + np.tipUp * 0.6, 0.094 + np.proj * 0.3), R(0.003, 0.0018, 0.0042), basis(rotated(hf, 0.4, 0.3 * sg, 0)));
    if (a.age > 0.45) {
      sc.cone({ layer: L, op: PrimOp.Subtract, bone: head, k: 0.005 }, p((np.alaW + 0.004) * sg, 0.028, 0.088), p(0.027 * sg, my - 0.005, 0.08), 0.0008 * hs * a.age, 0.0005 * hs);
    }
  }

  // Orbits, lids and openings (eyeballs are separate meshes behind them).
  for (const side of RSIDES) {
    const sg = rsign(side);
    const eye = lay.j[`${side}Eye`];
    sc.ellipsoid({ layer: L, op: PrimOp.Subtract, bone: head, k: 0.008 }, p(0.032 * sg, FACE_Y.eyes + 0.004, 0.09), R(0.019, 0.014, 0.014), B);
    sc.sphere({ layer: L, bone: head, k: 0.005 }, eye, (EYE_RADIUS + 0.0018) * hs);
    const ap = rotated(hf, 0, 0.14 * sg, -0.06 * sg);
    // The opening sits a little low: the upper lid rests on the top of the iris (calm, confident).
    sc.ellipsoid({ layer: L, op: PrimOp.Subtract, bone: head, k: 0.0012 }, eye.clone().addScaledVector(hf.z, 0.0145 * hs).addScaledVector(hf.y, -0.0016 * hs), R(0.0168, 0.0072 + 0.0008 * fem, 0.012), basis(ap));
    sc.ellipsoid({ layer: L, op: PrimOp.Subtract, bone: head, k: 0.003 }, eye.clone().addScaledVector(hf.y, 0.0128 * hs).addScaledVector(hf.z, 0.0105 * hs), R(0.0145, 0.0016, 0.004), basis(ap));
    sc.ellipsoid({ layer: L, op: PrimOp.WeightPaint, bone: id(`${side}Eyelid`), feather: 0.0025 }, eye.clone().addScaledVector(hf.y, 0.0085 * hs).addScaledVector(hf.z, 0.011 * hs), R(0.019, 0.007, 0.01), basis(ap));
    // Eyebrows (paint): bold strokes along the brow, straighter and thicker on an angular face.
    for (let k = 0; k < 3; k++) {
      const u = k / 2;
      const x = (0.014 + 0.02 * u) * sg;
      const y = FACE_Y.eyes + 0.024 + 0.004 * Math.sin(u * Math.PI) * (1 - 0.4 * masc) - 0.002 * u;
      sc.ellipsoid(
        { layer: L, op: PrimOp.Paint, bone: head, channels: [undefined, undefined, 1], feather: 0.0018 },
        p(x, y, 0.088 - 0.009 * u * u),
        R(0.011, 0.0045 + 0.0016 * masc - 0.001 * u, 0.014),
        basis(rotated(hf, 0, 0.25 * sg * u, -0.12 * sg * (u - 0.3))),
      );
    }
    // Ear.
    const ef = rotated(hf, 0, 0.12 * sg, 0.12 * sg, p(0.071 * sg, 0.064, -0.008));
    sc.ellipsoid({ layer: L, bone: head, k: 0.006 }, ef.p(0.004 * sg * hs, 0.004 * hs, -0.004 * hs), R(0.008, 0.025, 0.016), basis(ef));
    sc.ellipsoid({ layer: L, op: PrimOp.Subtract, bone: head, k: 0.003 }, ef.p(0.011 * sg * hs, 0.004 * hs, -0.001 * hs), R(0.006, 0.016, 0.01), basis(ef));
    sc.sphere({ layer: L, bone: head, k: 0.004 }, ef.p(0.004 * sg * hs, -0.021 * hs, 0.002 * hs), 0.0062 * hs);
  }
  // Warmth (ch0 on skin): cheeks, nose tip, ears.
  const warm = { channels: [0.9] as [number], feather: 0.012, op: PrimOp.Paint, layer: L, bone: head };
  for (const side of RSIDES) {
    const sg = rsign(side);
    sc.sphere(warm, p(0.04 * sg, 0.03, 0.066), 0.012 * hs);
    sc.sphere({ ...warm, feather: 0.006 }, p(0.073 * sg, 0.062, -0.008), 0.018 * hs);
  }
  sc.sphere({ ...warm, feather: 0.008 }, tip, 0.008 * hs);
  void CH;
}
