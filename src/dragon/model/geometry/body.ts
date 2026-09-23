import * as THREE from 'three';
import { LANDMARKS, NECK_JOINTS, TAIL_JOINTS, NECK_BONES, TAIL_BONES, JAW_HINGE_H } from '../anatomy';
import type { RigSkeleton } from '../skeleton';
import type { MeshBuilder, SkinAccumulator } from './buffers';
import { ChainSkinner } from './chain-skin';
import { Loft } from './loft';
import { PathSampler, sampleRings, smoothstep, gauss } from './path';
import { SectionProfile, type Bump, type SectionKey } from './profile';
import { MAT } from './materials-ids';

/**
 * The main body surface: one continuous loft from the snout tip through head, neck, torso and tail.
 * Other parts (spikes, eyes, horns, tack) are placed on it through its query helpers.
 */
export class BodySurface {
  readonly path: PathSampler;
  readonly loft: Loft;
  readonly profile: SectionProfile;
  readonly skinner: ChainSkinner;
  /** Arc length of the skull base (end of the head region). */
  readonly sSkull: number;
  readonly sNeckBase: number;
  readonly sPelvis: number;
  readonly sTailStart: number;
  private readonly zLut: Float32Array;
  private readonly lutN = 512;
  private readonly jawBone: number;

  constructor(private readonly rig: RigSkeleton) {
    const neckRev = [...NECK_JOINTS].reverse();
    const points = [LANDMARKS.snoutTip, ...neckRev, LANDMARKS.chest, LANDMARKS.midBack, LANDMARKS.lumbar, LANDMARKS.pelvis, ...TAIL_JOINTS];
    this.path = new PathSampler(points, { type: 'centripetal', samples: 4000 });
    const knots = this.path.knotLengths;
    this.sSkull = knots[1];
    this.sNeckBase = knots[1 + NECK_BONES];
    this.sPelvis = knots[1 + NECK_BONES + 4];
    this.sTailStart = knots[1 + NECK_BONES + 5];

    const owners: number[] = [rig.id('head')];
    for (let i = NECK_BONES - 1; i >= 0; i--) {
      owners.push(rig.id(`neck${i}`));
    }
    owners.push(rig.id('chest'), rig.id('root'), rig.id('root'), rig.id('lumbar'), rig.id('pelvis'));
    for (let i = 0; i < TAIL_BONES; i++) {
      owners.push(rig.id(`tail${i}`));
    }
    this.skinner = new ChainSkinner(knots, owners, (k) => (k === 1 ? 0.14 : k <= NECK_BONES + 1 ? 0.3 : 0.7));
    this.jawBone = rig.id('jaw');

    this.zLut = new Float32Array(this.lutN + 1);
    const p = new THREE.Vector3();
    for (let i = 0; i <= this.lutN; i++) {
      this.path.pointAt((i / this.lutN) * this.path.length, p);
      this.zLut[i] = p.z;
    }

    this.profile = new SectionProfile(this.buildKeys(), this.buildBumps());
    const L = this.path.length;
    const rings = sampleRings(0, L, (s) => {
      if (s < this.sSkull) {
        return 0.03;
      }
      if (s < this.sNeckBase) {
        return 0.055;
      }
      if (s < this.sTailStart) {
        return 0.07;
      }
      const t = (s - this.sTailStart) / (L - this.sTailStart);
      return THREE.MathUtils.lerp(0.075, 0.045, t);
    });
    // Snout: start slightly inside the tip so the cap closes neatly.
    rings[0] = 0.004;
    rings[rings.length - 1] = L - 0.004;
    this.loft = new Loft({
      path: this.path,
      rings,
      segments: 72,
      section: (s, theta, out) => this.profile.evaluate(s, theta, out),
      skin: (s, theta, pos, acc) => this.skinAt(s, theta, acc),
      data: (s, theta, pos, out) => this.dataAt(s, theta, out),
      color: (s, theta, pos, out) => this.colorAt(s, theta, out),
      minCircumference: 1.4,
      vScale: 1,
      capStart: 0.012,
      capEnd: 0.01,
    });
  }

  /** Arc length where the path reaches rig-space z. */
  sAtZ(z: number): number {
    const lut = this.zLut;
    const n = this.lutN;
    if (z <= lut[0]) {
      return 0;
    }
    if (z >= lut[n]) {
      return this.path.length;
    }
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lut[mid] < z) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const t = (z - lut[lo]) / Math.max(lut[hi] - lut[lo], 1e-6);
    return ((lo + t) / n) * this.path.length;
  }

  /** Arc length for head parameter h (0 = skull base, 1 = snout tip). */
  sAtHead(h: number): number {
    return (1 - h) * this.sSkull;
  }

  headParam(s: number): number {
    return 1 - s / this.sSkull;
  }

  private buildKeys(): SectionKey[] {
    const k = (s: number, cy: number, halfWidth: number, top: number, bottom: number, nTop = 2.2, nBottom = 2.2): SectionKey => ({
      s,
      cy,
      halfWidth,
      top,
      bottom,
      nTop,
      nBottom,
    });
    const H = (h: number): number => this.sAtHead(h);
    const Z = (z: number): number => this.sAtZ(z);
    return [
      // Head (h: 0 skull base .. 1 snout tip). Flat palate (high nBottom), domed skull.
      k(H(1.0), -0.02, 0.045, 0.04, 0.035, 2.2, 2.4),
      k(H(0.992), -0.025, 0.11, 0.1, 0.072, 2.3, 3.0),
      k(H(0.95), -0.03, 0.17, 0.16, 0.105, 2.5, 3.6),
      k(H(0.86), -0.03, 0.2, 0.2, 0.115, 2.6, 3.8),
      k(H(0.72), -0.03, 0.228, 0.228, 0.125, 2.6, 3.8),
      k(H(0.56), -0.025, 0.268, 0.262, 0.135, 2.5, 3.8),
      k(H(0.42), -0.015, 0.318, 0.305, 0.15, 2.4, 3.6),
      k(H(0.3), 0.0, 0.378, 0.36, 0.17, 2.3, 3.2),
      k(H(0.2), 0.01, 0.43, 0.39, 0.21, 2.3, 2.6),
      k(H(0.1), 0.0, 0.43, 0.38, 0.4, 2.2, 2.2),
      k(H(0.0), -0.02, 0.39, 0.34, 0.44, 2.1, 2.0),
      // Neck (by rig z).
      k(Z(-6.1), -0.03, 0.37, 0.32, 0.45, 2.1, 2.0),
      k(Z(-5.4), -0.04, 0.39, 0.33, 0.46, 2.1, 2.0),
      k(Z(-4.5), -0.05, 0.44, 0.36, 0.5, 2.1, 2.0),
      k(Z(-3.5), -0.08, 0.5, 0.4, 0.58, 2.1, 2.0),
      k(Z(-2.6), -0.14, 0.58, 0.44, 0.68, 2.1, 2.0),
      // Torso.
      k(Z(-1.9), -0.26, 0.84, 0.55, 0.95, 2.15, 2.0),
      k(Z(-1.2), -0.34, 1.0, 0.64, 1.13, 2.25, 2.0),
      k(Z(-0.3), -0.35, 0.95, 0.58, 1.08, 2.2, 2.1),
      k(Z(0.6), -0.3, 0.82, 0.5, 0.93, 2.2, 2.1),
      k(Z(1.45), -0.22, 0.7, 0.45, 0.74, 2.2, 2.1),
      k(Z(2.05), -0.16, 0.68, 0.43, 0.64, 2.2, 2.1),
      // Tail.
      k(Z(2.8), -0.1, 0.56, 0.42, 0.52, 2.2, 2.1),
      k(Z(3.8), -0.07, 0.48, 0.38, 0.44, 2.3, 2.1),
      k(Z(5.1), -0.04, 0.37, 0.31, 0.34, 2.3, 2.1),
      k(Z(6.6), -0.02, 0.25, 0.225, 0.235, 2.3, 2.1),
      k(Z(7.9), 0.0, 0.155, 0.145, 0.145, 2.3, 2.1),
      k(Z(8.85), 0.0, 0.085, 0.08, 0.078, 2.2, 2.1),
      k(Z(9.4), 0.0, 0.03, 0.03, 0.028, 2.0, 2.0),
      k(Z(9.5), 0.0, 0.01, 0.01, 0.01, 2.0, 2.0),
    ];
  }

  private buildBumps(): Bump[] {
    const H = (h: number): number => this.sAtHead(h);
    const Z = (z: number): number => this.sAtZ(z);
    const L = this.path.length;
    const bumps: Bump[] = [
      // --- Head ---
      { s: H(0.3), sigmaS: 0.14, theta: 0.86, sigmaTheta: 0.2, amp: 0.075 }, // brow ridge over the eye
      { s: H(0.16), sigmaS: 0.14, theta: 0.72, sigmaTheta: 0.2, amp: 0.05 }, // brow ridge sweeping back to horn
      { s: H(0.3), sigmaS: 0.075, theta: 1.28, sigmaTheta: 0.2, amp: -0.05 }, // eye socket
      { s: H(0.18), sigmaS: 0.12, theta: 1.85, sigmaTheta: 0.28, amp: 0.06 }, // cheekbone (jugal)
      { s: H(0.08), sigmaS: 0.1, theta: 2.25, sigmaTheta: 0.35, amp: 0.045 }, // jaw muscle
      { s: H(0.06), sigmaS: 0.09, theta: 0, sigmaTheta: 0.16, amp: 0.045, single: true }, // occipital crest
      { s: H(0.62), sigmaS: 0.34, theta: 0, sigmaTheta: 0.14, amp: 0.022, single: true }, // nasal crest
      { s: H(0.62), sigmaS: 0.3, theta: 0.5, sigmaTheta: 0.14, amp: -0.012 }, // nasal groove
      { s: H(0.905), sigmaS: 0.05, theta: 0.6, sigmaTheta: 0.2, amp: 0.035 }, // nostril rims
      { s: H(0.91), sigmaS: 0.022, theta: 0.63, sigmaTheta: 0.1, amp: -0.05 }, // nostril opening
      { s: H(0.5), sigmaS: 0.3, theta: 2.55, sigmaTheta: 0.14, amp: 0.012 }, // lip line ridge
      { s: H(0.26), sigmaS: 0.07, theta: 0.3, sigmaTheta: 0.16, amp: -0.018 }, // frontal dip between brows
      // --- Neck ---
      { s: Z(-4.4), sigmaS: 2.2, theta: 0, sigmaTheta: 0.1, amp: 0.035, single: true }, // dorsal ridge
      { s: Z(-2.9), sigmaS: 0.6, theta: 1.35, sigmaTheta: 0.45, amp: 0.045 }, // neck base muscles
      { s: Z(-5.6), sigmaS: 0.45, theta: 1.25, sigmaTheta: 0.4, amp: 0.025 }, // upper neck muscles
      // --- Torso ---
      { s: Z(-1.05), sigmaS: 0.55, theta: Math.PI, sigmaTheta: 0.3, amp: 0.13, single: true }, // sternum keel
      { s: Z(-1.3), sigmaS: 0.5, theta: 2.1, sigmaTheta: 0.45, amp: 0.15 }, // pectorals (flight muscles)
      { s: Z(-1.3), sigmaS: 0.34, theta: 0.92, sigmaTheta: 0.3, amp: 0.16 }, // scapula / wing root
      { s: Z(-1.35), sigmaS: 0.42, theta: 1.2, sigmaTheta: 0.34, amp: 0.2 }, // deltoid mass around the wing root
      { s: Z(-0.95), sigmaS: 0.55, theta: 0.7, sigmaTheta: 0.3, amp: 0.08 }, // supracoracoid / upper back muscle
      { s: Z(-0.7), sigmaS: 0.5, theta: 0.55, sigmaTheta: 0.25, amp: 0.05 }, // back muscles
      { s: Z(0.1), sigmaS: 0.9, theta: 1.75, sigmaTheta: 0.5, amp: 0.022, ripple: 0.3 }, // ribs
      { s: Z(1.95), sigmaS: 0.38, theta: 1.95, sigmaTheta: 0.42, amp: 0.15 }, // haunch (thigh muscles)
      { s: Z(1.8), sigmaS: 0.3, theta: 0.62, sigmaTheta: 0.2, amp: 0.05 }, // iliac crest
      { s: Z(0.4), sigmaS: 3.2, theta: 0, sigmaTheta: 0.09, amp: 0.03, single: true }, // spine ridge
      { s: Z(1.2), sigmaS: 0.5, theta: 2.7, sigmaTheta: 0.3, amp: -0.03 }, // belly tuck
      // --- Tail ---
      { s: (Z(3.0) + L) * 0.5, sigmaS: (L - Z(3.0)) * 0.45, theta: 0, sigmaTheta: 0.09, amp: 0.028, single: true }, // tail dorsal ridge
      { s: Z(4.8), sigmaS: 1.6, theta: Math.PI / 2, sigmaTheta: 0.1, amp: 0.018 }, // tail lateral keel
    ];
    return bumps;
  }

  private skinAt(s: number, theta: number, acc: SkinAccumulator): void {
    const h = this.headParam(s);
    // Throat and lower back of the head follow the jaw a little.
    const bottom = smoothstep(-0.35, -0.85, Math.cos(theta));
    const along = smoothstep(-0.22, -0.02, h) * (1 - smoothstep(0.12, 0.2, h));
    const jawW = bottom * along * 0.55;
    if (jawW > 0.01) {
      this.skinner.apply(s, acc, 1 - jawW);
      acc.add(this.jawBone, jawW);
      return;
    }
    this.skinner.apply(s, acc);
  }

  private dataAt(s: number, theta: number, out: THREE.Vector4): void {
    const h = this.headParam(s);
    const bottomness = -Math.cos(theta);
    // Mouth interior: the flat palate under the upper jaw, forward of the hinge.
    const inMouth = h > JAW_HINGE_H - 0.01 && h < 0.975 && bottomness > 0.975 ? 1 : 0;
    // Breathing mask: ribcage and belly.
    const z = this.path.pointAt(s, new THREE.Vector3()).z;
    const breath = gauss(z + 0.4, 0.9) * (0.4 + 0.6 * smoothstep(-0.2, 0.8, bottomness));
    out.set(inMouth ? MAT.mouth : MAT.skin, THREE.MathUtils.clamp(h, 0, 1), breath, 0);
  }

  private colorAt(s: number, theta: number, out: THREE.Color): void {
    const h = this.headParam(s);
    const L = this.path.length;
    const tail = smoothstep(this.sTailStart, L, s);
    let v = 1;
    v *= 1 - 0.18 * tail;
    // Head is a little darker on top, lighter along the lips.
    if (h > 0) {
      v *= 0.94;
    }
    const lateral = Math.abs(Math.sin(theta));
    out.setRGB(v, v * (0.99 + 0.02 * lateral), v);
  }

  /** Point on the body surface (rig space rest). */
  surfacePoint(s: number, theta: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.loft.pointAt(s, theta, out);
  }

  surfaceNormal(s: number, theta: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.loft.normalAt(s, theta, out);
  }

  /** Skin influences of the surface at (s, theta), for attaching rigid props (spikes, straps). */
  skinForSurface(s: number, theta: number, acc: SkinAccumulator): SkinAccumulator {
    acc.clear();
    this.skinAt(s, theta, acc);
    return acc;
  }

  build(builder: MeshBuilder): void {
    this.loft.build(builder);
  }
}
