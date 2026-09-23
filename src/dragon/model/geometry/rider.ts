import * as THREE from 'three';
import { RIDER, SIDES, mirror, sideSign, type Side } from '../anatomy';
import type { RigSkeleton } from '../skeleton';
import { MeshBuilder, SkinAccumulator } from './buffers';
import { RIDER_MAT } from './materials-ids';
import { smoothstep } from './path';
import { buildFist } from './rider-hands';
import { buildRiderHead } from './rider-head';
import { blendSkin, buildSheet, buildTube, tubeSurfacePoint, type TubeSpec } from './rider-parts';

const FWD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

/** Bind-space point inside the rider's neck where first-person-hidden vertices collapse. */
export const RIDER_HIDE_POINT = new THREE.Vector3(0, 1.68, -2.65);

const gaussian = (x: number, mu: number, sigma: number): number => Math.exp(-Math.pow((x - mu) / sigma, 2));

/** The rider: seated, leaning forward, hooded riding cloak, leather armour, gloved fists on the reins. */
export function buildRider(builder: MeshBuilder, rig: RigSkeleton): void {
  buildTorso(builder, rig);
  for (const side of SIDES) {
    buildArm(builder, rig, side);
    buildLeg(builder, rig, side);
  }
  buildRiderHead(builder, rig);
  buildCloak(builder, rig);
}

function buildTorso(builder: MeshBuilder, rig: RigSkeleton): void {
  const pelvis = rig.id('riderPelvis');
  const spine = rig.id('riderSpine');
  const chest = rig.id('riderChest');
  const head = rig.id('riderHead');
  // Seat -> hips -> waist -> chest -> shoulders -> neck. theta = 0 is the front of the body.
  buildTube(builder, {
    points: [
      new THREE.Vector3(0, 1.14, -2.5),
      new THREE.Vector3(0, 1.28, -2.525),
      new THREE.Vector3(0, 1.5, -2.6),
      new THREE.Vector3(0, 1.69, -2.648),
      new THREE.Vector3(0, 1.79, -2.675),
    ],
    up: FWD,
    // V-shaped trunk: narrow waist, broad ribcage and shoulders, trapezius sloping into the neck.
    keys: [
      [0, 0.15, 0.1, 0.125],
      [0.08, 0.172, 0.118, 0.13],
      [0.3, 0.138, 0.098, 0.096],
      [0.55, 0.17, 0.12, 0.108],
      [0.72, 0.198, 0.132, 0.116],
      [0.83, 0.21, 0.11, 0.114],
      [0.9, 0.134, 0.078, 0.078],
      [0.95, 0.068, 0.06, 0.06],
      [1, 0.058, 0.056, 0.056],
    ],
    segments: 24,
    spacing: 0.017,
    material: (t) => (t < 0.22 ? RIDER_MAT.wool : t < 0.28 ? RIDER_MAT.darkLeather : t < 0.86 ? RIDER_MAT.leather : RIDER_MAT.wool),
    bump: (t, theta) => {
      const front = Math.cos(theta);
      const side = Math.abs(Math.sin(theta));
      const belt = gaussian(t, 0.25, 0.022) * 0.009;
      const buckle = gaussian(t, 0.25, 0.018) * gaussian(theta, 0, 0.12) * 0.01;
      // Cuirass: moulded pectorals, overlapping abdominal lames, shoulder blades.
      const pecs = gaussian(t, 0.7, 0.07) * Math.exp(-Math.pow((Math.abs(theta) - 0.5) / 0.35, 2)) * 0.012;
      const lames = t > 0.3 && t < 0.58 ? 0.005 * Math.pow(Math.max(0, Math.sin((t - 0.3) * 38)), 5) * Math.max(0, front) : 0;
      const blades = gaussian(t, 0.74, 0.08) * Math.exp(-Math.pow((Math.abs(theta) - 2.55) / 0.35, 2)) * 0.012;
      const spineGroove = -gaussian(t, 0.6, 0.2) * gaussian(Math.abs(theta), Math.PI, 0.15) * 0.006;
      const skirtFolds = t < 0.22 ? 0.006 * Math.sin(theta * 8 + t * 6) * smoothstep(0.2, 0.0, t) : 0;
      const collar = gaussian(t, 0.89, 0.025) * 0.006;
      return belt + buckle + pecs + lames + blades + spineGroove + skirtFolds + collar + 0.002 * side * gaussian(t, 0.5, 0.2);
    },
    wear: (t, theta) => {
      // Worn leather at the lame edges, belt and around the arm holes.
      const lameEdge = t > 0.3 && t < 0.58 ? Math.pow(Math.max(0, Math.sin((t - 0.3) * 38 + 0.6)), 8) : 0;
      return Math.min(1, lameEdge + gaussian(t, 0.25, 0.02) * 0.7 + gaussian(t, 0.84, 0.03) * Math.abs(Math.sin(theta)));
    },
    skin: (t, acc) => {
      if (t < 0.25) {
        blendSkin(acc, pelvis, spine, smoothstep(0.05, 0.25, t));
      } else if (t < 0.6) {
        blendSkin(acc, spine, chest, smoothstep(0.35, 0.6, t));
      } else {
        blendSkin(acc, chest, head, smoothstep(0.9, 1.0, t));
      }
    },
    hide: (t) => t > 0.9,
    capStart: true,
  });
  // Baldric strap across the chest (right shoulder to left hip).
  const strap: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const t = 0.55 + 0.3 * (0.5 + 0.5 * Math.cos(a));
    const y = THREE.MathUtils.lerp(1.14, 1.79, t);
    const lean = THREE.MathUtils.lerp(-2.5, -2.675, t);
    const tilt = 0.12 * Math.sin(a);
    strap.push(new THREE.Vector3(Math.sin(a) * 0.2, y + tilt, lean - Math.cos(a) * (Math.cos(a) > 0 ? 0.142 : 0.128)));
  }
  buildTube(builder, {
    points: strap,
    up: UP,
    keys: [
      [0, 0.024, 0.004, 0.004],
      [1, 0.024, 0.004, 0.004],
    ],
    segments: 6,
    spacing: 0.03,
    material: () => RIDER_MAT.darkLeather,
    wear: () => 0.5,
    skin: (_t, acc) => acc.add(chest, 1),
  });
}

function buildArm(builder: MeshBuilder, rig: RigSkeleton, side: Side): void {
  const sgn = sideSign(side);
  const chest = rig.id('riderChest');
  const upper = rig.id(`riderUpperArm${side}`);
  const fore = rig.id(`riderForearm${side}`);
  const hand = rig.id(`riderHand${side}`);
  const sh = mirror(RIDER.shoulder, side);
  const el = mirror(RIDER.elbow, side);
  const wr = mirror(RIDER.wrist, side);
  const lateral = new THREE.Vector3(sgn, 0, 0);

  // Upper arm: deltoid cap, biceps / triceps mass tapering to the elbow (wool sleeve under the pauldron).
  buildTube(builder, {
    points: [sh.clone().add(new THREE.Vector3(-0.04 * sgn, 0.025, 0.004)), sh.clone().lerp(el, 0.5), el.clone().add(new THREE.Vector3(0, 0, 0.005))],
    up: lateral,
    keys: [
      [0, 0.056, 0.06, 0.056],
      [0.2, 0.06, 0.064, 0.058],
      [0.5, 0.052, 0.054, 0.056],
      [0.85, 0.046, 0.047, 0.048],
      [1, 0.046, 0.046, 0.046],
    ],
    segments: 16,
    spacing: 0.018,
    material: () => RIDER_MAT.wool,
    bump: (t, theta) => 0.003 * Math.sin(theta * 5 + t * 12) * smoothstep(0.4, 0.9, t),
    skin: (t, acc) => blendSkin(acc, upper, fore, smoothstep(0.85, 1.0, t)),
    capStart: true,
  });
  // Pauldron: three overlapping leather lames over the shoulder cap.
  const armDir = el.clone().sub(sh).normalize();
  const px = new THREE.Vector3().crossVectors(armDir, UP).normalize();
  const pUp = new THREE.Vector3().crossVectors(px, armDir).normalize();
  const center = sh.clone().add(new THREE.Vector3(-0.02 * sgn, 0.012, 0));
  buildSheet(builder, {
    rows: 12,
    cols: 20,
    point: (u, v, out) => {
      // Arc over the top/outside of the arm, from front to back; v runs down the arm.
      const a = THREE.MathUtils.lerp(-1.7, 1.7, u);
      const lame = Math.floor(v * 3 - 1e-6);
      const inLame = v * 3 - lame;
      const r = 0.066 + 0.005 * lame + 0.006 * inLame - 0.006 * v;
      const dir = pUp.clone().multiplyScalar(Math.cos(a)).addScaledVector(px, Math.sin(a) * -sgn);
      dir.addScaledVector(lateral, 0.15 * Math.cos(a)).normalize();
      out.copy(center).addScaledVector(armDir, -0.01 + v * 0.12).addScaledVector(dir, r);
    },
    material: () => RIDER_MAT.darkLeather,
    wear: (u, v) => {
      const inLame = v * 3 - Math.floor(v * 3 - 1e-6);
      return Math.max(smoothstep(0.75, 1, inLame), smoothstep(0.85, 1, Math.abs(u - 0.5) * 2));
    },
    skin: (u, v, acc) => blendSkin(acc, chest, upper, smoothstep(0.0, 0.5, v)),
  });
  // Forearm: muscular below the elbow, laced leather bracer to the wrist.
  const forearmSpec: TubeSpec = {
    points: [el, el.clone().lerp(wr, 0.5), wr],
    up: lateral,
    keys: [
      [0, 0.046, 0.046, 0.046],
      [0.22, 0.05, 0.051, 0.048],
      [0.34, 0.051, 0.052, 0.049],
      [0.7, 0.043, 0.044, 0.042],
      [1, 0.037, 0.037, 0.036],
    ],
    segments: 16,
    spacing: 0.018,
    material: (t) => (t > 0.33 ? RIDER_MAT.leather : RIDER_MAT.wool),
    bump: (t, theta) => (t > 0.34 ? 0.004 + 0.0018 * Math.pow(Math.max(0, Math.cos(t * 44)), 10) * gaussian(theta, 0, 0.35) : 0),
    wear: (t) => (t > 0.33 && t < 0.4 ? 1 : t > 0.93 ? 0.8 : 0.25),
    skin: (t, acc) => blendSkin(acc, fore, hand, smoothstep(0.9, 1.0, t)),
  };
  buildTube(builder, forearmSpec);
  // Bracer lacing: a cord zig-zagging over the top of the forearm (the side the rider sees in first person).
  const lace: THREE.Vector3[] = [];
  const top = (Math.PI / 2) * sgn;
  const crossings = 9;
  for (let i = 0; i <= crossings * 2; i++) {
    const t = THREE.MathUtils.lerp(0.4, 0.9, i / (crossings * 2));
    const off = (i % 2 === 0 ? 1 : -1) * 0.32;
    lace.push(tubeSurfacePoint(forearmSpec, t, top + off, 0.0025, new THREE.Vector3()));
  }
  buildTube(builder, {
    points: lace,
    up: lateral,
    keys: [
      [0, 0.0022, 0.0018, 0.0018],
      [1, 0.0022, 0.0018, 0.0018],
    ],
    segments: 5,
    spacing: 0.006,
    material: () => RIDER_MAT.linen,
    skin: (t, acc) => blendSkin(acc, fore, hand, smoothstep(0.9, 1.0, 0.4 + 0.5 * t)),
  });
  buildFist(builder, side, hand);
}

function buildLeg(builder: MeshBuilder, rig: RigSkeleton, side: Side): void {
  const sgn = sideSign(side);
  const pelvis = rig.id('riderPelvis');
  const hip = mirror(RIDER.hip, side);
  const knee = mirror(RIDER.knee, side);
  const ankle = mirror(RIDER.ankle, side);
  const toe = mirror(RIDER.toe, side);
  const skin = (_t: number, acc: SkinAccumulator): void => {
    acc.add(pelvis, 1);
  };
  // Thigh: breeches over quadriceps / hamstrings, reinforced leather riding patch on the inside.
  buildTube(builder, {
    points: [hip.clone().add(new THREE.Vector3(-0.04 * sgn, 0.02, 0.02)), hip.clone().lerp(knee, 0.5), knee],
    up: UP,
    keys: [
      [0, 0.088, 0.088, 0.092],
      [0.35, 0.082, 0.088, 0.08],
      [0.75, 0.066, 0.068, 0.064],
      [1, 0.058, 0.058, 0.056],
    ],
    segments: 16,
    spacing: 0.02,
    material: (t, theta) => (Math.sin(theta) * sgn < -0.45 && t > 0.3 ? RIDER_MAT.leather : RIDER_MAT.wool),
    bump: (t, theta) => 0.004 * Math.sin(theta * 6 + t * 10) * smoothstep(0.5, 1, t),
    skin,
    capStart: true,
  });
  // Tall riding boot: cuff below the knee, shaft, ankle.
  buildTube(builder, {
    points: [knee.clone().add(new THREE.Vector3(0, 0.02, 0)), knee.clone().lerp(ankle, 0.5), ankle],
    up: FWD,
    keys: [
      [0, 0.06, 0.066, 0.06],
      [0.1, 0.062, 0.068, 0.062],
      [0.16, 0.056, 0.058, 0.056],
      [0.6, 0.05, 0.052, 0.052],
      [1, 0.045, 0.048, 0.05],
    ],
    segments: 16,
    spacing: 0.02,
    material: (t) => (t < 0.03 ? RIDER_MAT.wool : RIDER_MAT.darkLeather),
    bump: (t) => (t > 0.08 && t < 0.14 ? 0.004 : 0) + 0.002 * Math.pow(Math.max(0, Math.sin(t * 40)), 12) * smoothstep(0.7, 0.95, t),
    wear: (t) => (t > 0.08 && t < 0.15 ? 1 : 0.3 + 0.4 * smoothstep(0.7, 1, t)),
    skin,
  });
  // Boot foot in the stirrup: heel, instep and a rounded toe.
  buildTube(builder, {
    points: [ankle.clone().add(new THREE.Vector3(0, 0.01, 0.06)), ankle.clone().lerp(toe, 0.45), toe.clone().add(new THREE.Vector3(0, 0.0, -0.03))],
    up: UP,
    keys: [
      [0, 0.04, 0.035, 0.04],
      [0.3, 0.046, 0.05, 0.034],
      [0.8, 0.042, 0.03, 0.026],
      [1, 0.028, 0.02, 0.02],
    ],
    segments: 14,
    spacing: 0.015,
    material: () => RIDER_MAT.darkLeather,
    wear: (t) => 0.3 + 0.7 * smoothstep(0.75, 1, t),
    skin,
    capStart: true,
    capEnd: true,
  });
}

/**
 * Riding cloak: two cloth layers (the inner one mirrors the outer) joined by a hem strip along the free edges.
 * Rest shape streams back (flight); aExtra = offset to the draped shape. aData.w = 1 outer, 2 inner (the shader
 * flips the inner normal for the flutter so both layers move together).
 */
function buildCloak(builder: MeshBuilder, rig: RigSkeleton): void {
  const chest = rig.id('riderChest');
  const spine = rig.id('riderSpine');
  const cols = 22;
  const rows = 18;
  const length = 1.2;
  const THICK = 0.007;
  const center = new THREE.Vector3(0, 1.715, -2.628);
  const W = cols + 1;
  const grid: THREE.Vector3[] = [];
  const drape: THREE.Vector3[] = [];
  for (let r = 0; r <= rows; r++) {
    const d = (r / rows) * length;
    const k = d / length;
    for (let c = 0; c <= cols; c++) {
      const phi = THREE.MathUtils.lerp(-1.95, 1.95, c / cols);
      const sx = Math.sin(phi);
      const cz = Math.cos(phi);
      const attach = new THREE.Vector3(sx * 0.215, 0.02 * (1 - cz), cz * 0.14 + 0.01).add(center);
      const side = Math.abs(sx);
      const streamDir = new THREE.Vector3(sx * (0.28 + 0.25 * side), -0.3 - 0.1 * side, 1).normalize();
      const p = attach.clone().addScaledVector(streamDir, d);
      p.y -= 0.06 * Math.sin(k * Math.PI) * (1 - side);
      // Irregular vertical folds from the shoulders, deepening toward the hem, and a small hem ripple.
      const fold =
        0.05 * Math.sin(phi * 6.5 + 0.4 + 0.8 * Math.sin(phi * 2.3)) * smoothstep(0.0, 0.5, k) +
        0.012 * Math.sin(phi * 13 + 1.3 + d * 3) * k +
        0.008 * Math.sin(phi * 23 + 0.5) * smoothstep(0.85, 1, k);
      p.y += fold * (1 - 0.5 * side);
      p.x += fold * sx * 0.5;
      const down = Math.min(d, 0.5);
      const rest = Math.max(d - 0.5, 0);
      const dfold = 0.04 * Math.sin(phi * 6.5 + 0.4 + 0.8 * Math.sin(phi * 2.3)) * smoothstep(0.0, 0.4, k);
      const draped = attach
        .clone()
        .add(new THREE.Vector3(sx * (0.08 * d + 0.05 * side), -down * 0.92, 0.12 * down + 0.05 + dfold))
        .add(new THREE.Vector3(sx * 0.2 * rest, -0.15 * rest, rest * 0.9));
      grid.push(p);
      drape.push(draped.sub(p));
    }
  }
  // Consistent outward normals (away from the rider's back).
  const normals: THREE.Vector3[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const refIdx = Math.floor(rows / 2) * W + Math.floor(cols / 2);
  let orient = 1;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      a.subVectors(grid[r * W + Math.min(c + 1, cols)], grid[r * W + Math.max(c - 1, 0)]);
      b.subVectors(grid[Math.min(r + 1, rows) * W + c], grid[Math.max(r - 1, 0) * W + c]);
      normals.push(new THREE.Vector3().crossVectors(b, a).normalize());
    }
  }
  if (normals[refIdx].y < 0) {
    orient = -1;
  }
  for (const n of normals) {
    n.multiplyScalar(orient);
  }
  const skin = new SkinAccumulator();
  const data = new THREE.Vector4();
  const uv = new THREE.Vector2();
  const pos = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  /** layer 0 = outer, 1 = inner; `offsetInner` places an outer-layer (w = 1) vertex at the inner surface (hem strip). */
  const addVertex = (i: number, layer: number, offsetInner = false): number => {
    const r = Math.floor(i / W);
    const t = r / rows;
    skin.clear().add(chest, 1 - 0.35 * t).add(spine, 0.35 * t);
    data.set(RIDER_MAT.cloak, t, 0, layer === 0 ? 1 : 2);
    uv.set((i % W) / cols, t);
    pos.copy(grid[i]).addScaledVector(normals[i], layer === 1 || offsetInner ? -THICK : 0);
    nrm.copy(normals[i]).multiplyScalar(layer === 0 ? 1 : -1);
    return builder.addVertex({ position: pos, normal: nrm, uv, skin, data, extra: drape[i] });
  };
  for (const layer of [0, 1]) {
    const base = builder.vertexCount;
    for (let i = 0; i < grid.length; i++) {
      addVertex(i, layer);
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i0 = base + r * W + c;
        const i1 = i0 + 1;
        const i2 = i0 + W;
        const i3 = i2 + 1;
        if ((layer === 0) === orient > 0) {
          builder.addTriangle(i0, i2, i1);
          builder.addTriangle(i1, i2, i3);
        } else {
          builder.addTriangle(i0, i1, i2);
          builder.addTriangle(i1, i3, i2);
        }
      }
    }
  }
  // Hem strip joining both layers along the sides and the bottom edge (outer-layer normals: same displacement).
  const edgeIdx: number[] = [];
  for (let r = 0; r <= rows; r++) {
    edgeIdx.push(r * W);
  }
  for (let c = 1; c <= cols; c++) {
    edgeIdx.push(rows * W + c);
  }
  for (let r = rows - 1; r >= 0; r--) {
    edgeIdx.push(r * W + cols);
  }
  const stripBase = builder.vertexCount;
  for (const i of edgeIdx) {
    addVertex(i, 0);
    addVertex(i, 0, true);
  }
  for (let k = 0; k < edgeIdx.length - 1; k++) {
    const o0 = stripBase + k * 2;
    builder.addTriangle(o0, o0 + 1, o0 + 2);
    builder.addTriangle(o0 + 1, o0 + 3, o0 + 2);
  }
}

export { buildTube };
