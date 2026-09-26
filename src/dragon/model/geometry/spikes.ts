import * as THREE from 'three';
import { createRng } from '../../../core/math/noise';
import type { BodySurface } from './body';
import { MeshBuilder, SkinAccumulator } from './buffers';
import { Loft } from './loft';
import { MAT } from './materials-ids';
import { PathSampler, gauss, smoothstep } from './path';
import { buildThorn } from './thorn';

/** Saddle zone (rig z) kept free of dorsal spikes. */
export const SADDLE_Z = { front: -3.35, back: -1.75 };

/** Dorsal spike height (m) as a function of rig-space z; 0 = no spike. */
function spikeHeight(z: number): number {
  if (z > SADDLE_Z.front && z < SADDLE_Z.back) {
    return 0;
  }
  if (z <= SADDLE_Z.front) {
    // Neck: grow from the skull, shrink approaching the saddle so the rider can see.
    // Kept low so the rider sees the head over them.
    const t = smoothstep(-6.3, -3.4, z);
    return THREE.MathUtils.lerp(0.09, 0.11, t) + 0.02 * gauss(z + 4.4, 0.6);
  }
  if (z < 2.4) {
    return 0.24 + 0.14 * smoothstep(-1.75, 0.2, z) - 0.04 * smoothstep(1.2, 2.4, z);
  }
  const t = smoothstep(2.4, 8.9, z);
  return THREE.MathUtils.lerp(0.34, 0.07, Math.pow(t, 0.8));
}

export function buildDorsalSpikes(builder: MeshBuilder, body: BodySurface): void {
  const rng = createRng(4242);
  const skin = new SkinAccumulator();
  const sStart = body.sAtZ(-6.25);
  const sEnd = body.sAtZ(8.8);
  let s = sStart;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  while (s < sEnd) {
    body.path.pointAt(s, p);
    const z = p.z;
    const h = spikeHeight(z);
    const spacing = z < SADDLE_Z.front ? 0.3 : z < 2.4 ? 0.42 : THREE.MathUtils.lerp(0.36, 0.2, smoothstep(2.4, 8.9, z));
    if (h > 0.02) {
      const size = h * (0.85 + rng() * 0.3);
      body.surfacePoint(s, 0, p);
      body.surfaceNormal(s, 0, n);
      tangent.copy(body.loft.frameAt(s).tangent);
      buildThorn(builder, {
        base: p,
        dir: n.clone().addScaledVector(tangent, 0.55).normalize(),
        bendToward: tangent,
        bend: 0.55,
        length: size,
        radius: size * 0.42,
        tipRadius: 0.003,
        flatten: 0.38,
        sectionUp: tangent,
        keel: 0.8,
        baseFlare: 0.5,
        sink: size * 0.18,
        taperPower: 0.9,
        segments: 8,
        rings: 9,
        materialId: MAT.horn,
        // Neck thorns are the plates the bond raises (body material: aData.w = 2).
        dataW: z < SADDLE_Z.front ? 2 : 0,
        skin: body.skinForSurface(s, 0, skin),
      });
    }
    s += spacing;
  }
}

/** Arrowhead-shaped tail spade (thick leathery leaf with a bony rim) at the tail tip. */
export function buildTailSpade(builder: MeshBuilder, body: BodySurface): void {
  const L = body.path.length;
  const sBase = L - 0.95;
  const base = body.path.pointAt(sBase, new THREE.Vector3());
  const tip = body.path.pointAt(L, new THREE.Vector3());
  const dir = tip.clone().sub(base).normalize();
  const end = tip.clone().addScaledVector(dir, 0.55);
  const path = new PathSampler([base, base.clone().lerp(end, 0.5), end], { type: 'centripetal', samples: 300 });
  const len = path.length;
  const skinA = new SkinAccumulator();
  const skinB = new SkinAccumulator();
  body.skinForSurface(sBase, 0, skinA);
  body.skinForSurface(L - 0.05, 0, skinB);
  const rings: number[] = [];
  for (let i = 0; i <= 40; i++) {
    rings.push(0.002 + (i / 40) * (len - 0.004));
  }
  new Loft({
    path,
    rings,
    segments: 28,
    section: (s, theta, out) => {
      const t = s / len;
      // Arrowhead: flares quickly to sharp barbs at t ~ 0.32, then straight edges to the point.
      const rise = Math.pow(smoothstep(0.02, 0.32, t), 0.55);
      const fall = t < 0.32 ? 1 : Math.pow(1 - (t - 0.32) / 0.68, 1.15);
      const barb = rise * fall;
      const hw = 0.035 + 0.5 * barb;
      const th = 0.03 + 0.02 * (1 - t) + 0.012 * barb;
      const sx = Math.sin(theta);
      const cy = Math.cos(theta);
      // Lens section with a raised midrib.
      const x = Math.sign(sx) * Math.pow(Math.abs(sx), 0.7) * hw;
      const rib = 1 + 0.9 * Math.exp(-Math.pow(x / 0.04, 2));
      out.set(x, cy * th * rib * (1 - 0.6 * Math.abs(x) / Math.max(hw, 1e-3)));
    },
    skin: (s, theta, pos, acc) => {
      const t = s / len;
      acc.addScaled(skinA, 1 - smoothstep(0, 0.4, t)).addScaled(skinB, smoothstep(0, 0.4, t));
    },
    data: (s, theta, pos, out) => out.set(MAT.skin, 0, 0, 0),
    color: (s, theta, pos, out) => out.setRGB(0.8, 0.78, 0.76),
    minCircumference: 0.8,
    vScale: 1,
    capEnd: 0.01,
  }).build(builder);
}
