/**
 * Placeholder animals of the soul lane (procedural props, .docs/street/kadikoy-soul.md items 1, 3, 4, 25, 26, 28):
 * static stand-ins with realistic proportions and coats, built from ellipsoids, capsules and tapered tubes. They
 * mark the spots that S5 fills with animated models (the `animals` records of the soul step), so every instance is a
 * placeholder: the ids end in `_placeholder` and the records say so.
 *
 * - soul_cat_placeholder: adult domestic cat (body 0.46 m, shoulder 0.25 m), poses sit / loaf / curl, coats tabby,
 *   greytabby, black, tuxedo, ginger, calico, white; variant `<coat>_<pose>`. Kittens are instances at scale 0.65.
 * - soul_dog_placeholder: large Anatolian street dog (Karabaş type, 0.95 m nose to rump) asleep on its side or lying
 *   up like a sphinx, with a yellow ear tag; coats tan (black mask) and blond; variant `<coat>_<pose>`.
 * - soul_gull_placeholder: yellow-legged gull (0.55 m), standing or sitting, adult or juvenile.
 * - soul_pigeon: feral pigeon (0.32 m) standing, pecking or walking in three colour morphs, from the approved GAMICO
 *   model baked into static poses (pigeon.ts); this procedural stand-in only where the cached source is missing.
 *
 * Prop convention: metres, foot at the origin, the animal's head towards +Z.
 */
import { capsule, type PropDef } from '../props';
import type { TileMesh, Vec3 } from '../mesh';
import { ellipsoid } from '../street/shapes';
import { cone, taperTube } from './geom';
import { modelPigeon, type PigeonPose } from './pigeon';
import { CAT_COATS, type CatCoat, DOG_COATS, type DogCoat } from './materials';

export type CatPose = 'sit' | 'loaf' | 'curl';
export type DogPose = 'side' | 'sphinx';
export const CAT_POSES: CatPose[] = ['sit', 'loaf', 'curl'];
export const CAT_COAT_IDS = Object.keys(CAT_COATS) as CatCoat[];

const E = (mesh: TileMesh, m: string, c: Vec3, r: Vec3, seg = 10, rings = 6): void => ellipsoid(mesh, m, c, r[0], r[1], r[2], seg, rings);

/* ------------------------------------------------------------------------------------------------------------- */
/* Cat                                                                                                             */
/* ------------------------------------------------------------------------------------------------------------- */

interface CatHead {
  c: Vec3;
  /** Direction the face looks (unit, in x/z mostly). */
  fwd: Vec3;
  /** Ears tilt back by this much (m). */
  earBack: number;
}

function catHead(mesh: TileMesh, main: string, bib: string, h: CatHead, closedEyes: boolean): void {
  const [cx, cy, cz] = h.c;
  const [fx, , fz] = h.fwd;
  const side: Vec3 = [fz, 0, -fx];
  E(mesh, main, h.c, [0.048, 0.043, 0.047], 12, 7);
  // Muzzle and cheeks, the nose and the eyes (dark slits when asleep).
  E(mesh, bib, [cx + fx * 0.036, cy - 0.014, cz + fz * 0.036], [0.026, 0.02, 0.02], 8, 5);
  E(mesh, 'soul_cat_nose', [cx + fx * 0.056, cy - 0.004, cz + fz * 0.056], [0.007, 0.005, 0.005], 6, 3);
  for (const s of [-1, 1]) {
    const ex = cx + fx * 0.04 + side[0] * s * 0.019;
    const ez = cz + fz * 0.04 + side[2] * s * 0.019;
    E(mesh, 'soul_eye', [ex, cy + 0.008, ez], closedEyes ? [0.008, 0.0025, 0.004] : [0.007, 0.006, 0.004], 6, 3);
    const bx = cx - fx * 0.004 + side[0] * s * 0.027;
    const bz = cz - fz * 0.004 + side[2] * s * 0.027;
    cone(mesh, main, [bx, cy + 0.03, bz], [bx + side[0] * s * 0.008 - fx * h.earBack, cy + 0.072, bz + side[2] * s * 0.008 - fz * h.earBack], 0.019, 4, 0.5);
  }
}

function cat(mesh: TileMesh, coat: CatCoat, pose: CatPose): void {
  const main = `soul_cat_${coat}`;
  const bib = coat === 'tuxedo' || coat === 'tabby' || coat === 'ginger' || coat === 'greytabby' ? `soul_cat_${coat}_bib` : main;
  const fwd: Vec3 = [0, 0, 1];
  if (pose === 'sit') {
    E(mesh, main, [0, 0.085, -0.05], [0.085, 0.085, 0.1]);
    for (const s of [-1, 1]) {
      E(mesh, main, [s * 0.052, 0.075, -0.03], [0.035, 0.06, 0.07], 8, 5);
      E(mesh, bib, [s * 0.055, 0.012, 0.01], [0.018, 0.012, 0.04], 6, 4);
      capsule(mesh, main, [s * 0.028, 0.17, 0.052], [s * 0.028, 0.025, 0.07], 0.016);
      E(mesh, bib, [s * 0.028, 0.012, 0.082], [0.017, 0.012, 0.022], 6, 4);
    }
    capsule(mesh, main, [0, 0.1, -0.03], [0, 0.215, 0.035], 0.066, 0.06);
    E(mesh, bib, [0, 0.19, 0.072], [0.045, 0.06, 0.03], 8, 5);
    capsule(mesh, main, [0, 0.23, 0.04], [0, 0.265, 0.06], 0.045);
    catHead(mesh, main, bib, { c: [0, 0.29, 0.072], fwd, earBack: 0.006 }, false);
    taperTube(mesh, main, [[-0.02, 0.03, -0.135], [-0.07, 0.018, -0.085], [-0.088, 0.015, 0.0], [-0.062, 0.014, 0.07], [-0.02, 0.014, 0.1]], 0.017, 0.011, 6);
    if (coat === 'calico') {
      E(mesh, 'soul_cat_patch_orange', [-0.035, 0.12, -0.055], [0.068, 0.07, 0.085], 8, 5);
      E(mesh, 'soul_cat_patch_black', [0.04, 0.16, -0.02], [0.05, 0.06, 0.06], 8, 5);
      E(mesh, 'soul_cat_patch_orange', [0.018, 0.305, 0.062], [0.036, 0.03, 0.036], 8, 5);
    }
  } else if (pose === 'loaf') {
    E(mesh, main, [0, 0.095, -0.02], [0.09, 0.095, 0.175], 12, 7);
    E(mesh, main, [0, 0.15, 0.12], [0.06, 0.06, 0.05], 8, 5);
    E(mesh, bib, [0, 0.1, 0.14], [0.05, 0.05, 0.035], 8, 5);
    for (const s of [-1, 1]) {
      E(mesh, bib, [s * 0.03, 0.018, 0.15], [0.02, 0.017, 0.026], 6, 4);
    }
    catHead(mesh, main, bib, { c: [0, 0.168, 0.172], fwd, earBack: 0.01 }, true);
    taperTube(mesh, main, [[0.02, 0.03, -0.19], [0.08, 0.02, -0.15], [0.1, 0.018, -0.05], [0.095, 0.016, 0.06]], 0.016, 0.011, 6);
    if (coat === 'calico') {
      E(mesh, 'soul_cat_patch_orange', [0.03, 0.14, -0.08], [0.07, 0.06, 0.1], 8, 5);
      E(mesh, 'soul_cat_patch_black', [-0.04, 0.13, 0.03], [0.055, 0.06, 0.07], 8, 5);
      E(mesh, 'soul_cat_patch_black', [-0.012, 0.183, 0.165], [0.035, 0.03, 0.036], 8, 5);
    }
  } else {
    E(mesh, main, [0, 0.07, 0], [0.15, 0.072, 0.13], 12, 7);
    E(mesh, main, [-0.04, 0.088, -0.04], [0.1, 0.07, 0.09], 10, 6);
    const h: Vec3 = [0.08, 0.056, 0.098];
    const hf: Vec3 = [0.6, 0, 0.8];
    catHead(mesh, main, bib, { c: h, fwd: hf, earBack: 0.02 }, true);
    E(mesh, bib, [0.02, 0.02, 0.118], [0.03, 0.016, 0.022], 6, 4);
    taperTube(mesh, main, [[-0.14, 0.03, -0.02], [-0.135, 0.022, 0.08], [-0.06, 0.018, 0.142], [0.035, 0.016, 0.158]], 0.017, 0.012, 6);
    if (coat === 'calico') {
      E(mesh, 'soul_cat_patch_orange', [-0.06, 0.1, -0.03], [0.09, 0.055, 0.08], 8, 5);
      E(mesh, 'soul_cat_patch_black', [0.07, 0.09, -0.05], [0.07, 0.05, 0.06], 8, 5);
    }
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Dog                                                                                                             */
/* ------------------------------------------------------------------------------------------------------------- */

function dog(mesh: TileMesh, coat: DogCoat, pose: DogPose): void {
  const main = `soul_dog_${coat}`;
  const mask = `soul_dog_${coat}_mask`;
  if (pose === 'side') {
    // Asleep on its right side: back towards -X, legs towards +X, head towards +Z.
    E(mesh, main, [-0.02, 0.13, 0], [0.19, 0.13, 0.36], 14, 8);
    E(mesh, main, [0, 0.125, 0.22], [0.18, 0.125, 0.17], 12, 7);
    E(mesh, main, [-0.03, 0.125, -0.24], [0.17, 0.125, 0.15], 12, 7);
    capsule(mesh, main, [0, 0.115, 0.3], [0.02, 0.095, 0.42], 0.09);
    E(mesh, main, [0.02, 0.085, 0.49], [0.1, 0.075, 0.11], 12, 7);
    capsule(mesh, mask, [0.03, 0.07, 0.55], [0.05, 0.062, 0.69], 0.05, 0.045);
    E(mesh, 'soul_cat_patch_black', [0.055, 0.068, 0.742], [0.02, 0.018, 0.012], 6, 3);
    E(mesh, mask, [-0.05, 0.158, 0.47], [0.07, 0.016, 0.065], 10, 5);
    E(mesh, 'soul_ear_tag', [-0.07, 0.176, 0.44], [0.018, 0.005, 0.014], 6, 3);
    for (const [a, b, c, r] of [
      [[0.1, 0.1, 0.22], [0.32, 0.055, 0.3], [0.52, 0.042, 0.33], 0.045],
      [[0.08, 0.17, 0.2], [0.3, 0.13, 0.26], [0.47, 0.105, 0.25], 0.042],
      [[0.05, 0.1, -0.28], [0.28, 0.055, -0.3], [0.47, 0.042, -0.36], 0.05],
      [[0.04, 0.17, -0.25], [0.26, 0.13, -0.23], [0.43, 0.105, -0.29], 0.047],
    ] as [Vec3, Vec3, Vec3, number][]) {
      capsule(mesh, main, a, b, r);
      capsule(mesh, main, b, c, r * 0.72);
      E(mesh, main, [c[0] + 0.03, c[1] - 0.005, c[2]], [0.045, 0.03, 0.04], 8, 4);
    }
    taperTube(mesh, main, [[-0.05, 0.12, -0.38], [-0.02, 0.07, -0.55], [0.08, 0.04, -0.7], [0.17, 0.035, -0.78]], 0.035, 0.016, 7);
  } else {
    E(mesh, main, [0, 0.18, -0.05], [0.15, 0.17, 0.36], 14, 8);
    E(mesh, main, [0, 0.15, -0.3], [0.16, 0.15, 0.16], 12, 7);
    E(mesh, main, [0, 0.2, 0.18], [0.14, 0.18, 0.15], 12, 7);
    capsule(mesh, main, [0, 0.3, 0.22], [0, 0.42, 0.3], 0.085);
    E(mesh, main, [0, 0.46, 0.34], [0.1, 0.09, 0.12], 12, 7);
    capsule(mesh, mask, [0, 0.44, 0.4], [0, 0.425, 0.53], 0.05, 0.045);
    E(mesh, 'soul_cat_patch_black', [0, 0.44, 0.582], [0.02, 0.018, 0.012], 6, 3);
    for (const s of [-1, 1]) {
      E(mesh, mask, [s * 0.09, 0.465, 0.3], [0.02, 0.07, 0.05], 8, 5);
      capsule(mesh, main, [s * 0.08, 0.07, 0.15], [s * 0.08, 0.045, 0.46], 0.04);
      E(mesh, main, [s * 0.08, 0.035, 0.5], [0.04, 0.03, 0.05], 8, 4);
      E(mesh, main, [s * 0.14, 0.09, -0.3], [0.06, 0.09, 0.14], 8, 5);
    }
    E(mesh, 'soul_ear_tag', [-0.112, 0.43, 0.31], [0.005, 0.018, 0.014], 6, 3);
    taperTube(mesh, main, [[0, 0.14, -0.44], [0.05, 0.04, -0.6], [0.15, 0.03, -0.72]], 0.035, 0.016, 7);
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Gull and pigeon                                                                                                 */
/* ------------------------------------------------------------------------------------------------------------- */

function gull(mesh: TileMesh, sitting: boolean, juvenile: boolean): void {
  const white = juvenile ? 'soul_gull_juvenile' : 'soul_gull_white';
  const back = juvenile ? 'soul_gull_juvenile' : 'soul_gull_grey';
  const lift = sitting ? -0.1 : 0;
  const up = (v: Vec3): Vec3 => [v[0], v[1] + lift, v[2]];
  capsule(mesh, white, up([0, 0.17, -0.1]), up([0, 0.212, 0.07]), 0.068, 0.072);
  E(mesh, back, up([0, 0.232, -0.03]), [0.07, 0.036, 0.145], 10, 5);
  taperTube(mesh, 'soul_gull_black', [up([0, 0.222, -0.13]), up([0, 0.205, -0.29])], 0.03, 0.008, 6);
  E(mesh, white, up([0, 0.19, -0.2]), [0.04, 0.018, 0.065], 8, 4);
  capsule(mesh, white, up([0, 0.22, 0.06]), up([0, 0.28, 0.1]), 0.04);
  E(mesh, white, up([0, 0.3, 0.115]), [0.036, 0.036, 0.046], 10, 6);
  cone(mesh, juvenile ? 'soul_gull_black' : 'soul_gull_yellow', up([0, 0.295, 0.152]), up([0, 0.284, 0.212]), 0.011, 5, 0.8);
  if (!juvenile) {
    E(mesh, 'soul_gull_red', up([0, 0.283, 0.195]), [0.004, 0.005, 0.006], 5, 3);
  }
  for (const s of [-1, 1]) {
    E(mesh, 'soul_eye', up([s * 0.023, 0.308, 0.13]), [0.004, 0.004, 0.004], 5, 3);
    if (!sitting) {
      taperTube(mesh, 'soul_gull_yellow', [[s * 0.025, 0.15, 0.0], [s * 0.028, 0.004, 0.012]], 0.007, 0.006, 5);
      E(mesh, 'soul_gull_yellow', [s * 0.028, 0.004, 0.035], [0.02, 0.004, 0.034], 6, 3);
    }
  }
}

const PIGEON_MORPHS = {
  grey: ['soul_pigeon_grey', 'soul_pigeon_wing'],
  dark: ['soul_pigeon_dark', 'soul_pigeon_dark'],
  pale: ['soul_pigeon_pale', 'soul_pigeon_pale'],
  brown: ['soul_pigeon_brown', 'soul_pigeon_brown'],
} as const;
export type PigeonMorph = keyof typeof PIGEON_MORPHS;
/** Morphs of the model pigeon: its texture times a tint (grey = as painted). */
export const PIGEON_MODEL_MORPHS: PigeonMorph[] = ['grey', 'dark', 'brown'];

function pigeon(mesh: TileMesh, morph: PigeonMorph, pecking: boolean): void {
  const [body, wing] = PIGEON_MORPHS[morph];
  capsule(mesh, body, [0, 0.09, -0.07], [0, 0.112, 0.04], 0.052, 0.058);
  E(mesh, wing, [0, 0.118, -0.04], [0.056, 0.032, 0.09], 8, 5);
  E(mesh, 'soul_pigeon_dark', [0, 0.1, -0.155], [0.03, 0.01, 0.06], 6, 3);
  const neckTop: Vec3 = pecking ? [0, 0.065, 0.1] : [0, 0.155, 0.06];
  const head: Vec3 = pecking ? [0, 0.042, 0.125] : [0, 0.172, 0.07];
  capsule(mesh, 'soul_pigeon_neck', [0, 0.115, 0.035], neckTop, 0.029);
  E(mesh, morph === 'pale' ? body : 'soul_pigeon_dark', head, [0.021, 0.021, 0.026], 8, 5);
  const bill0: Vec3 = pecking ? [0, 0.03, 0.146] : [0, 0.17, 0.093];
  const bill1: Vec3 = pecking ? [0, 0.012, 0.158] : [0, 0.166, 0.113];
  cone(mesh, 'soul_pigeon_dark', bill0, bill1, 0.005, 4);
  for (const s of [-1, 1]) {
    taperTube(mesh, 'soul_pigeon_leg', [[s * 0.018, 0.07, 0.0], [s * 0.02, 0.003, 0.01]], 0.005, 0.004, 4);
    E(mesh, 'soul_pigeon_leg', [s * 0.02, 0.003, 0.022], [0.012, 0.003, 0.02], 5, 3);
  }
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Props                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------- */

export const ANIMAL_PROPS: PropDef[] = [
  {
    id: 'soul_cat_placeholder',
    drawDistance: 45,
    castShadow: true,
    build: (b) => {
      for (const coat of CAT_COAT_IDS) {
        for (const pose of CAT_POSES) {
          b.variant(`${coat}_${pose}`, (m) => cat(m, coat, pose));
        }
      }
    },
  },
  {
    id: 'soul_dog_placeholder',
    drawDistance: 70,
    castShadow: true,
    build: (b) => {
      for (const coat of Object.keys(DOG_COATS) as DogCoat[]) {
        for (const pose of ['side', 'sphinx'] as DogPose[]) {
          b.variant(`${coat}_${pose}`, (m) => dog(m, coat, pose));
        }
      }
    },
  },
  {
    id: 'soul_gull_placeholder',
    drawDistance: 90,
    castShadow: true,
    build: (b) => {
      b.variant('adult_standing', (m) => gull(m, false, false));
      b.variant('adult_sitting', (m) => gull(m, true, false));
      b.variant('juvenile_standing', (m) => gull(m, false, true));
    },
  },
  {
    // The approved GAMICO pigeon (pigeon.ts) baked into static poses; the procedural stand-in without the source.
    id: 'soul_pigeon',
    drawDistance: 40,
    castShadow: true,
    vertexAttributes: true,
    build: (b) => {
      for (const morph of PIGEON_MODEL_MORPHS) {
        for (const pose of ['standing', 'pecking', 'walking'] as PigeonPose[]) {
          b.variant(`${morph}_${pose}`, (m) => {
            if (!modelPigeon(m, `soul_pigeon_model_${morph}`, pose)) {
              pigeon(m, morph, pose === 'pecking');
            }
          });
        }
      }
    },
  },
];
