import * as THREE from 'three';
import { SIDES, sideSign } from '../anatomy';
import type { RigSkeleton } from '../skeleton';
import { SkinAccumulator, type MeshBuilder } from './buffers';
import { RIDER_MAT } from './materials-ids';
import { PathSampler, createFrame, smoothstep } from './path';
import { blendSkin, buildSheet, buildTube, type TubeKey } from './rider-parts';

const FWD = new THREE.Vector3(0, 0, -1);

/** Head axis (chin to crown). The eyes sit at t = 0.52. */
const HEAD_PTS = [new THREE.Vector3(0, 1.822, -2.722), new THREE.Vector3(0, 1.945, -2.716), new THREE.Vector3(0, 2.062, -2.7)];
const HEAD_KEYS: TubeKey[] = [
  [0, 0.028, 0.03, 0.04],
  [0.08, 0.05, 0.068, 0.06],
  [0.25, 0.064, 0.09, 0.075],
  [0.45, 0.071, 0.097, 0.09],
  [0.55, 0.074, 0.096, 0.1],
  [0.72, 0.076, 0.091, 0.104],
  [0.88, 0.067, 0.07, 0.094],
  [0.97, 0.04, 0.035, 0.05],
  [1, 0.01, 0.01, 0.012],
];

function lerpKeys(keys: TubeKey[], t: number): [number, number, number] {
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t <= b[0]) {
      const u = THREE.MathUtils.clamp((t - a[0]) / Math.max(b[0] - a[0], 1e-6), 0, 1);
      const s = u * u * (3 - 2 * u);
      return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s];
    }
  }
  const l = keys[keys.length - 1];
  return [l[1], l[2], l[3]];
}

/** Head, wool scarf wrapped over nose and mouth, riding goggles and the open hood with a rolled brim (all hidden in first person). */
export function buildRiderHead(builder: MeshBuilder, rig: RigSkeleton): void {
  const head = rig.id('riderHead');
  const chest = rig.id('riderChest');
  const headSkin = (_t: number, acc: SkinAccumulator): void => {
    acc.add(head, 1);
  };

  // Skull and face (only the brow and cheekbones show between goggles, scarf and hood).
  buildTube(builder, {
    points: HEAD_PTS,
    up: FWD,
    keys: HEAD_KEYS,
    segments: 22,
    spacing: 0.012,
    material: () => RIDER_MAT.skin,
    bump: (t, theta) => {
      const front = Math.cos(theta);
      const nose = 0.01 * Math.exp(-Math.pow((t - 0.4) / 0.08, 2)) * Math.exp(-Math.pow(theta / 0.22, 2));
      const brow = 0.006 * Math.exp(-Math.pow((t - 0.62) / 0.04, 2)) * smoothstep(0.3, 0.8, front);
      const cheek = 0.006 * Math.exp(-Math.pow((t - 0.44) / 0.07, 2)) * Math.exp(-Math.pow((Math.abs(theta) - 0.95) / 0.3, 2));
      return nose + brow + cheek;
    },
    skin: headSkin,
    hide: true,
    capEnd: true,
  });

  // Scarf: several wraps of heavy wool around the neck, pulled up over the mouth and nose.
  buildTube(builder, {
    points: [new THREE.Vector3(0, 1.705, -2.66), new THREE.Vector3(0, 1.82, -2.706), new THREE.Vector3(0, 1.93, -2.712)],
    up: FWD,
    keys: [
      [0, 0.088, 0.085, 0.088],
      [0.25, 0.084, 0.092, 0.086],
      [0.5, 0.082, 0.108, 0.088],
      [0.8, 0.083, 0.126, 0.098],
      [1, 0.081, 0.127, 0.1],
    ],
    segments: 30,
    spacing: 0.01,
    material: () => RIDER_MAT.linen,
    bump: (t, theta) => {
      const wraps = 0.006 * Math.pow(Math.abs(Math.sin(t * Math.PI * 3.5 + theta * 0.35)), 3);
      const folds = 0.004 * Math.sin(theta * 7 + t * 9) + 0.003 * Math.sin(theta * 13 - t * 5);
      const lip = 0.004 * smoothstep(0.9, 1, t);
      return wraps + folds + lip;
    },
    skin: (t, acc) => blendSkin(acc, chest, head, smoothstep(0.1, 0.55, t)),
    hide: true,
    capStart: true,
  });

  // Goggles: leather-framed cups with brass rims and dark lenses, strap around the head.
  const tEye = 0.52;
  const eyePath = new PathSampler(HEAD_PTS, { type: 'centripetal', up: FWD });
  const f = eyePath.frameAt(tEye * eyePath.length, createFrame());
  const [hwE, frE] = lerpKeys(HEAD_KEYS, tEye);
  for (const side of SIDES) {
    const sgn = sideSign(side);
    const dir = new THREE.Vector3(0.2 * sgn, 0.02, -1).normalize();
    const center = f.point.clone().addScaledVector(f.right, 0.037 * sgn).addScaledVector(FWD, frE - 0.014).add(new THREE.Vector3(0, 0.004, 0));
    buildTube(builder, {
      points: [center.clone().addScaledVector(dir, -0.012), center.clone().addScaledVector(dir, 0.004), center.clone().addScaledVector(dir, 0.019)],
      up: new THREE.Vector3(0, 1, 0),
      keys: [
        [0, 0.03, 0.029, 0.029],
        [0.6, 0.029, 0.028, 0.028],
        [1, 0.027, 0.026, 0.026],
      ],
      segments: 18,
      spacing: 0.006,
      material: () => RIDER_MAT.darkLeather,
      skin: headSkin,
      hide: true,
      wear: () => 0.6,
    });
    const lensC = center.clone().addScaledVector(dir, 0.016);
    const rx = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const ry = new THREE.Vector3().crossVectors(dir, rx).normalize();
    buildLens(builder, lensC, dir, rx, ry, 0.026, head);
    const rim: THREE.Vector3[] = [];
    for (let i = 0; i <= 26; i++) {
      const a = (i / 24) * Math.PI * 2;
      rim.push(lensC.clone().addScaledVector(rx, Math.cos(a) * 0.0255).addScaledVector(ry, Math.sin(a) * 0.0245).addScaledVector(dir, 0.002));
    }
    buildTube(builder, {
      points: rim,
      up: dir,
      keys: [
        [0, 0.0032, 0.0032, 0.0032],
        [1, 0.0032, 0.0032, 0.0032],
      ],
      segments: 6,
      spacing: 0.006,
      material: () => RIDER_MAT.brass,
      skin: headSkin,
      hide: true,
    });
  }
  // Strap: a leather band around the head at eye level (reads as the bridge between the lenses at the front).
  buildTube(builder, {
    points: [f.point.clone().addScaledVector(f.up, 0).add(new THREE.Vector3(0, -0.011, 0)), f.point.clone().add(new THREE.Vector3(0, 0.011, 0))],
    up: FWD,
    keys: [
      [0, hwE + 0.005, frE + 0.004, lerpKeys(HEAD_KEYS, tEye)[2] + 0.005],
      [1, hwE + 0.005, frE + 0.004, lerpKeys(HEAD_KEYS, tEye)[2] + 0.005],
    ],
    segments: 24,
    spacing: 0.01,
    material: () => RIDER_MAT.darkLeather,
    skin: headSkin,
    hide: true,
  });

  buildHood(builder, rig);
}

/** Flat glass disc (flat normals, unlike a capped tube) facing `dir`. */
function buildLens(builder: MeshBuilder, center: THREE.Vector3, dir: THREE.Vector3, rx: THREE.Vector3, ry: THREE.Vector3, radius: number, bone: number): void {
  const skin = new SkinAccumulator().add(bone, 1);
  const data = new THREE.Vector4(RIDER_MAT.glass, 0, 1, 0);
  const uv = new THREE.Vector2();
  const base = builder.addVertex({ position: center, normal: dir, uv, skin, data });
  const segs = 20;
  const p = new THREE.Vector3();
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    p.copy(center).addScaledVector(rx, Math.cos(a) * radius).addScaledVector(ry, Math.sin(a) * radius * 0.96);
    builder.addVertex({ position: p, normal: dir, uv, skin, data });
  }
  for (let i = 0; i < segs; i++) {
    builder.addTriangle(base, base + 1 + i, base + 1 + ((i + 1) % segs));
  }
}

/** Opening half-angle (rad) of the hood around the face at hood parameter t (0 = cowl, 1 = crown). */
const OPEN_CENTER = 0.57;
const OPEN_HALF = 0.2;

function hoodOpening(t: number): number {
  // Elliptical face opening: rounded arch over the brow, rounded under the chin.
  const k = (t - OPEN_CENTER) / OPEN_HALF;
  return 1.2 * Math.sqrt(Math.max(0, 1 - k * k));
}

const HOOD_KEYS: TubeKey[] = [
  [0, 0.205, 0.15, 0.175],
  [0.14, 0.15, 0.12, 0.145],
  [0.3, 0.108, 0.13, 0.122],
  [0.5, 0.1, 0.132, 0.13],
  [0.7, 0.097, 0.124, 0.134],
  [0.84, 0.088, 0.1, 0.126],
  [0.9, 0.08, 0.09, 0.115],
  [0.95, 0.063, 0.07, 0.092],
  [0.98, 0.043, 0.048, 0.062],
  [0.995, 0.022, 0.024, 0.03],
  [1, 0.004, 0.004, 0.005],
];

/**
 * Hood: an open sheet wrapped from one cheek around the back of the head to the other, falling onto the shoulders as
 * a cowl; the face opening is framed by a thick rolled brim.
 */
function buildHood(builder: MeshBuilder, rig: RigSkeleton): void {
  const head = rig.id('riderHead');
  const chest = rig.id('riderChest');
  const path = new PathSampler(
    [
      new THREE.Vector3(0, 1.64, -2.64),
      new THREE.Vector3(0, 1.8, -2.685),
      new THREE.Vector3(0, 1.955, -2.705),
      new THREE.Vector3(0, 2.06, -2.69),
      new THREE.Vector3(0, 2.09, -2.672),
    ],
    { type: 'centripetal', up: FWD, samples: 400 },
  );
  const L = path.length;
  const frame = createFrame();
  const point = (u: number, t: number, out: THREE.Vector3): void => {
    path.frameAt(t * L, frame);
    const th0 = hoodOpening(t);
    const theta = th0 + (Math.PI * 2 - 2 * th0) * u;
    const [hw, fr, bk] = lerpKeys(HOOD_KEYS, t);
    const c = Math.cos(theta);
    const edge = th0 > 0.01 ? Math.max(1 - Math.min(u, 1 - u) / 0.07, 0) : 0;
    const folds = 0.007 * Math.sin(theta * 7 + t * 5) * (1 - smoothstep(0.55, 0.9, t)) + 0.015 * Math.sin(theta * 9 + 0.7) * (1 - smoothstep(0.04, 0.3, t));
    const k = 1 + folds / Math.max(hw, 0.02) - 0.08 * edge;
    out.copy(frame.point).addScaledVector(frame.right, Math.sin(theta) * hw * k).addScaledVector(frame.up, (c >= 0 ? c * fr : c * bk) * k);
  };
  const skinAt = (t: number, acc: SkinAccumulator): void => blendSkin(acc, chest, head, smoothstep(0.12, 0.35, t));
  const rows = 22;
  const cols = 34;
  buildSheet(builder, {
    rows,
    cols,
    point: (u, v, out) => point(u, v, out),
    material: () => RIDER_MAT.cloak,
    skin: (u, v, acc) => skinAt(v, acc),
    hide: true,
    wear: (u, v) => 0.3 + 0.7 * v,
    wrapU: (v) => hoodOpening(v) < 0.01,
    flip: true,
  });
  // Rolled brim around the face opening (a closed loop through both edges of the sheet).
  const loop: THREE.Vector3[] = [];
  const loopT: number[] = [];
  let r0 = -1;
  let r1 = -1;
  for (let r = 0; r <= rows; r++) {
    if (hoodOpening(r / rows) > 0.01) {
      r0 = r0 < 0 ? r : r0;
      r1 = r;
    }
  }
  const push = (u: number, t: number): void => {
    const p = new THREE.Vector3();
    point(u, t, p);
    loop.push(p);
    loopT.push(t);
  };
  const tBottom = OPEN_CENTER - OPEN_HALF;
  const tTop = OPEN_CENTER + OPEN_HALF;
  push(0, tBottom);
  for (let r = r0; r <= r1; r++) {
    push(1, r / rows);
  }
  push(0, tTop);
  for (let r = r1; r >= r0; r--) {
    push(0, r / rows);
  }
  push(0, tBottom);
  const brimPath = new PathSampler(loop, { type: 'centripetal' });
  const knots = brimPath.knotLengths;
  const tAt = (s: number): number => {
    let i = 0;
    while (i < knots.length - 2 && knots[i + 1] < s) {
      i++;
    }
    const k = (s - knots[i]) / Math.max(knots[i + 1] - knots[i], 1e-6);
    return THREE.MathUtils.lerp(loopT[i], loopT[i + 1], THREE.MathUtils.clamp(k, 0, 1));
  };
  buildTube(builder, {
    points: loop,
    up: FWD,
    keys: [
      [0, 0.012, 0.012, 0.012],
      [1, 0.012, 0.012, 0.012],
    ],
    segments: 8,
    spacing: 0.012,
    material: () => RIDER_MAT.cloak,
    skin: (t, acc) => skinAt(tAt(t * brimPath.length), acc),
    hide: true,
    wear: () => 0.8,
  });
}
