import * as THREE from 'three';
import { MeshBuilder, SkinAccumulator } from './buffers';
import { Loft } from './loft';
import { PathSampler } from './path';

export interface ThornSpec {
  base: THREE.Vector3;
  /** Initial growth direction (unit). */
  dir: THREE.Vector3;
  /** Direction the thorn curves toward (will be orthogonalized). */
  bendToward?: THREE.Vector3;
  /** Total bend angle over the length (rad). */
  bend?: number;
  /** Secondary bend (e.g. outward twist of horns) applied over the second half. */
  bendToward2?: THREE.Vector3;
  bend2?: number;
  length: number;
  radius: number;
  tipRadius?: number;
  /** Section x/y ratio (lateral flattening). 1 = round. */
  flatten?: number;
  /** Axis the flattened section's long side aligns to (defaults to bend direction). */
  sectionUp?: THREE.Vector3;
  segments?: number;
  rings?: number;
  /** Growth-ring ridge amplitude (fraction of radius) and count. */
  ridgeAmp?: number;
  ridgeCount?: number;
  /** Radius profile exponent: >1 thick base that tapers late. */
  taperPower?: number;
  /** Extra flare at the base (fraction of radius) to blend into the skin. */
  baseFlare?: number;
  /** Sink the base below the surface by this distance. */
  sink?: number;
  materialId: number;
  skin: SkinAccumulator;
  color?: THREE.Color;
  /** Texture scale along the thorn. */
  vScale?: number;
  /** Keel (sharp front/back edge) strength 0..1. */
  keel?: number;
  /** Value written to aData.w (1 = limb skin). */
  dataW?: number;
}

/** Curved tapered spike (horn, dorsal spike, tooth, claw) appended to a builder. */
export function buildThorn(builder: MeshBuilder, spec: ThornSpec): void {
  const n = 10;
  const pts: THREE.Vector3[] = [];
  const dir = spec.dir.clone().normalize();
  const bendAxis = new THREE.Vector3();
  const bendDir = (spec.bendToward ?? new THREE.Vector3(0, 1, 0)).clone();
  bendDir.addScaledVector(dir, -bendDir.dot(dir));
  if (bendDir.lengthSq() < 1e-6) {
    bendDir.set(1, 0, 0).addScaledVector(dir, -dir.x);
  }
  bendDir.normalize();
  bendAxis.crossVectors(dir, bendDir).normalize();
  const bend2Dir = spec.bendToward2?.clone();
  const p = spec.base.clone().addScaledVector(dir, -(spec.sink ?? 0));
  const d = dir.clone();
  const step = (spec.length + (spec.sink ?? 0)) / n;
  const q = new THREE.Quaternion();
  const bendStep = (spec.bend ?? 0) / n;
  pts.push(p.clone());
  for (let i = 0; i < n; i++) {
    p.addScaledVector(d, step);
    pts.push(p.clone());
    q.setFromAxisAngle(bendAxis, bendStep);
    d.applyQuaternion(q);
    if (bend2Dir && spec.bend2 && i >= n / 2) {
      const ax = new THREE.Vector3().crossVectors(d, bend2Dir);
      if (ax.lengthSq() > 1e-8) {
        q.setFromAxisAngle(ax.normalize(), spec.bend2 / (n / 2));
        d.applyQuaternion(q);
      }
    }
  }
  const sectionUp = (spec.sectionUp ?? bendDir).clone();
  const path = new PathSampler(pts, { type: 'centripetal', up: sectionUp, samples: 200 });
  const L = path.length;
  const sink = spec.sink ?? 0;
  const ringCount = spec.rings ?? 12;
  const rings: number[] = [];
  for (let i = 0; i < ringCount; i++) {
    const t = i / (ringCount - 1);
    rings.push(Math.pow(t, 0.85) * L * 0.999);
  }
  const rTip = spec.tipRadius ?? spec.radius * 0.04;
  const flatten = spec.flatten ?? 1;
  const taper = spec.taperPower ?? 1;
  const flare = spec.baseFlare ?? 0;
  const ridgeAmp = spec.ridgeAmp ?? 0;
  const ridgeCount = spec.ridgeCount ?? 0;
  const keel = spec.keel ?? 0;
  const color = spec.color ?? new THREE.Color(1, 1, 1);
  const loft = new Loft({
    path,
    rings,
    segments: spec.segments ?? 10,
    section: (s, theta, out) => {
      const t = THREE.MathUtils.clamp((s - sink) / Math.max(L - sink, 1e-4), 0, 1);
      let r = THREE.MathUtils.lerp(spec.radius, rTip, Math.pow(t, taper));
      r *= 1 + flare * Math.exp(-t * 14);
      if (ridgeAmp > 0) {
        r *= 1 + ridgeAmp * Math.pow(Math.abs(Math.sin(t * ridgeCount * Math.PI)), 3) * (1 - t);
      }
      const c = Math.cos(theta);
      const sn = Math.sin(theta);
      const k = 1 + keel * 0.35 * Math.pow(Math.abs(c), 8);
      out.set(sn * r * flatten, c * r * k);
    },
    skin: (s, theta, pos, acc) => {
      acc.copy(spec.skin);
    },
    data: (s, theta, pos, out) => {
      const t = THREE.MathUtils.clamp((s - sink) / Math.max(L - sink, 1e-4), 0, 1);
      out.set(spec.materialId, t, 0, spec.dataW ?? 0);
    },
    color: (s, theta, pos, out) => {
      out.copy(color);
    },
    minCircumference: 0.05,
    vScale: spec.vScale ?? 1,
    capEnd: rTip * 1.5 + 0.002,
  });
  loft.build(builder);
}
