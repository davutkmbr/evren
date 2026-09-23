import * as THREE from 'three';
import { HEAD_FWD, HEAD_UP, headPoint, sideSign, SIDES, type Side } from '../anatomy';
import type { RigSkeleton } from '../skeleton';
import type { BodySurface } from './body';
import { MeshBuilder, SkinAccumulator } from './buffers';
import { Loft } from './loft';
import { MAT, mouthField } from './materials-ids';
import { PathSampler, gauss, smoothstep } from './path';
import { SectionProfile, type SectionKey } from './profile';
import { buildThorn } from './thorn';
import { createRng } from '../../../core/math/noise';

const X = new THREE.Vector3(1, 0, 0);

export interface HeadParts {
  /** Mouth anchor position (rig space) at the front of the mouth. */
  mouthPoint: THREE.Vector3;
  eyeCenters: THREE.Vector3[];
  /** Jaw frill spike tips/bases per side for the frill membrane: [base, tip] pairs ordered front to back. */
  frillSpikes: Record<Side, Array<{ base: THREE.Vector3; tip: THREE.Vector3 }>>;
}

/** Upper-head section values at head parameter h (head frame, meters). */
function upperSection(body: BodySurface, h: number): { cy: number; hw: number; top: number; bottom: number; palate: number } {
  const p = body.profile.paramsAt(body.sAtHead(h));
  const hw = p.halfWidth;
  const out = { cy: p.cy, hw, top: p.top, bottom: p.bottom, palate: 0 };
  out.palate = mouthLine(body, h);
  return out;
}

const HINGE_H = 0.21;

/** Height of the mouth line (palate / jaw top) in the head frame; behind the hinge it rises gently. */
function mouthLine(body: BodySurface, h: number): number {
  const hh = Math.max(h, HINGE_H);
  const p = body.profile.paramsAt(body.sAtHead(hh));
  const base = p.cy - p.bottom;
  return h >= HINGE_H ? base : base + (HINGE_H - h) * 0.35;
}

function jawDepth(h: number): number {
  const keys: Array<[number, number]> = [
    [-0.03, 0.24],
    [0.08, 0.33],
    [0.17, 0.33],
    [0.35, 0.27],
    [0.55, 0.215],
    [0.75, 0.18],
    [0.9, 0.15],
    [0.985, 0.095],
  ];
  if (h <= keys[0][0]) {
    return keys[0][1];
  }
  for (let i = 0; i < keys.length - 1; i++) {
    const [h0, d0] = keys[i];
    const [h1, d1] = keys[i + 1];
    if (h <= h1) {
      const t = (h - h0) / (h1 - h0);
      const s = t * t * (3 - 2 * t);
      return d0 + (d1 - d0) * s;
    }
  }
  return keys[keys.length - 1][1];
}

const JAW_TOP = 0.055;
/** Half-width of the mouth floor around the top of the jaw section (rad from straight up). */
const JAW_MOUTH_ANGLE = Math.acos(0.965);
const JAW_WIDTH_RATIO = 0.74;

function buildJaw(builder: MeshBuilder, body: BodySurface, rig: RigSkeleton): void {
  const hs = [-0.03, 0.06, 0.15, 0.25, 0.4, 0.58, 0.76, 0.9, 0.99];
  const pts = hs.map((h) => {
    const u = upperSection(body, h);
    return headPoint(h, u.palate - JAW_TOP);
  });
  const path = new PathSampler(pts, { type: 'centripetal', up: HEAD_UP, samples: 800 });
  const L = path.length;
  const hAt = (s: number): number => THREE.MathUtils.lerp(hs[0], hs[hs.length - 1], s / L);
  const keys: SectionKey[] = [];
  for (let i = 0; i <= 24; i++) {
    const s = (i / 24) * L;
    const h = hAt(s);
    const u = upperSection(body, h);
    const tipClose = smoothstep(0.955, 0.995, h);
    const backClose = 1 - smoothstep(-0.03, 0.06, h);
    const hw = u.hw * JAW_WIDTH_RATIO * (1 - 0.55 * tipClose) * (1 - 0.35 * backClose);
    const depth = jawDepth(h) - JAW_TOP;
    keys.push({ s, cy: 0, halfWidth: hw, top: JAW_TOP * (1 - 0.4 * tipClose), bottom: depth * (1 - 0.4 * tipClose), nTop: 4.5, nBottom: 2.3 });
  }
  const profile = new SectionProfile(keys, [
    { s: L * 0.93, sigmaS: 0.06, theta: Math.PI, sigmaTheta: 0.35, amp: 0.025, single: true }, // chin
    { s: L * 0.12, sigmaS: 0.12, theta: 2.2, sigmaTheta: 0.35, amp: 0.035 }, // jaw muscle
    { s: L * 0.5, sigmaS: 0.35, theta: 1.35, sigmaTheta: 0.12, amp: 0.01 }, // labial ridge
  ]);
  const jawBone = rig.id('jaw');
  const rings: number[] = [];
  const n = 64;
  for (let i = 0; i <= n; i++) {
    rings.push(0.003 + (i / n) * (L - 0.006));
  }
  const segments = 48;
  const dh = (hs[hs.length - 1] - hs[0]) / n;
  const loft = new Loft({
    path,
    rings,
    segments,
    section: (s, theta, out) => profile.evaluate(s, theta, out),
    skin: (s, theta, pos, acc) => {
      acc.add(jawBone, 1);
    },
    data: (s, theta, pos, out) => {
      // Mouth floor along the top of the jaw (within JAW_MOUTH_ANGLE of straight up), as a continuous field.
      const h = hAt(s);
      const fromTop = Math.acos(THREE.MathUtils.clamp(Math.cos(theta), -1, 1));
      const mouth = mouthField((JAW_MOUTH_ANGLE - fromTop) / ((Math.PI * 2) / segments), (h - (HINGE_H - 0.04)) / dh, (0.975 - h) / dh);
      out.set(MAT.skin, h, 0, -mouth);
    },
    color: (s, theta, pos, out) => {
      const under = smoothstep(0.2, 0.9, -Math.cos(theta));
      const lip = smoothstep(0.55, 0.85, Math.cos(theta)) * (1 - smoothstep(0.93, 0.98, Math.cos(theta)));
      const v = (1.0 + 0.05 * under) * (1 - 0.45 * lip);
      out.setRGB(v, v, v);
    },
    minCircumference: 0.9,
    vScale: 1,
    vOffset: 0.37,
    capStart: 0.02,
    capEnd: 0.01,
  });
  loft.build(builder);
}

function buildEye(builder: MeshBuilder, center: THREE.Vector3, axis: THREE.Vector3, radius: number, skin: SkinAccumulator): void {
  const z = axis.clone().normalize();
  const x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const rings = 14;
  const segs = 20;
  const base = builder.vertexCount;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const uv = new THREE.Vector2();
  const t = new THREE.Vector4();
  const data = new THREE.Vector4();
  const color = new THREE.Color(1, 1, 1);
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI * 0.62;
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      n.copy(z).multiplyScalar(Math.cos(phi)).addScaledVector(x, Math.sin(phi) * Math.cos(a)).addScaledVector(y, Math.sin(phi) * Math.sin(a));
      p.copy(center).addScaledVector(n, radius);
      uv.set(Math.sin(phi) * Math.cos(a), Math.sin(phi) * Math.sin(a));
      const tangent = new THREE.Vector3().crossVectors(y, n).normalize();
      t.set(tangent.x, tangent.y, tangent.z, 1);
      data.set(MAT.eye, 0, 0, 0);
      builder.addVertex({ position: p, normal: n, uv, tangent: t, color, skin, data });
    }
  }
  const W = segs + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = base + i * W + j;
      const b = base + (i + 1) * W + j;
      builder.addTriangle(a, b, a + 1);
      builder.addTriangle(b, b + 1, a + 1);
    }
  }
}

/** Thick scaly lid rim around the eye, heavier above (hooded, menacing look). */
function buildEyelid(builder: MeshBuilder, center: THREE.Vector3, axis: THREE.Vector3, radius: number, skin: SkinAccumulator): void {
  const z = axis.clone().normalize();
  const x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const ringR = radius * 0.86;
  const rings = 40;
  const segs = 8;
  const base = builder.vertexCount;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const uv = new THREE.Vector2();
  const t4 = new THREE.Vector4();
  const data = new THREE.Vector4(MAT.skin, 0, 0, 0);
  const color = new THREE.Color(0.85, 0.85, 0.85);
  for (let i = 0; i <= rings; i++) {
    const a = (i / rings) * Math.PI * 2;
    radial.copy(x).multiplyScalar(Math.cos(a)).addScaledVector(y, Math.sin(a));
    // Upper lid (sin a > 0) is thicker and overhangs.
    const upper = Math.max(0, Math.sin(a));
    const tube = radius * (0.2 + 0.2 * upper);
    c.copy(center).addScaledVector(radial, ringR + tube * 0.3).addScaledVector(z, radius * (0.52 + 0.1 * upper));
    for (let j = 0; j <= segs; j++) {
      const b = (j / segs) * Math.PI * 2;
      n.copy(radial).multiplyScalar(Math.cos(b)).addScaledVector(z, Math.sin(b));
      p.copy(c).addScaledVector(n, tube);
      uv.set(0.25 + j / segs * 0.02, i / rings * 0.1);
      t4.set(-radial.y, radial.x, 0, 1);
      builder.addVertex({ position: p, normal: n, uv, tangent: t4, color, skin, data });
    }
  }
  const W = segs + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = base + i * W + j;
      const b = a + W;
      builder.addTriangle(a, b, a + 1);
      builder.addTriangle(b, b + 1, a + 1);
    }
  }
}

/** Tongue lying on the floor of the lower jaw (hidden inside the head while the mouth is closed). */
function buildTongue(builder: MeshBuilder, body: BodySurface, rig: RigSkeleton): void {
  const hs = [0.19, 0.3, 0.44, 0.58, 0.7, 0.78];
  const pts = hs.map((h) => headPoint(h, upperSection(body, h).palate + 0.002));
  const path = new PathSampler(pts, { type: 'centripetal', up: HEAD_UP, samples: 400 });
  const L = path.length;
  const jaw = rig.id('jaw');
  const rings: number[] = [];
  for (let i = 0; i <= 28; i++) {
    rings.push(0.002 + (i / 28) * (L - 0.004));
  }
  new Loft({
    path,
    rings,
    segments: 20,
    section: (s, theta, out) => {
      const t = s / L;
      const h = THREE.MathUtils.lerp(hs[0], hs[hs.length - 1], t);
      const hw = upperSection(body, h).hw * JAW_WIDTH_RATIO * 0.52 * (1 - 0.55 * smoothstep(0.75, 1, t));
      const c = Math.cos(theta);
      const top = 0.034 * (1 - 0.4 * smoothstep(0.8, 1, t));
      const groove = 1 - 0.3 * Math.exp(-Math.pow(theta / 0.28, 2)) * (1 - smoothstep(0.7, 1, t));
      out.set(Math.sin(theta) * hw, c >= 0 ? c * top * groove : c * 0.03);
    },
    skin: (s, theta, pos, acc) => {
      acc.add(jaw, 1);
    },
    data: (s, theta, pos, out) => out.set(MAT.tongue, s / L, 0, 0),
    color: (s, theta, pos, out) => out.setRGB(1, 1, 1),
    minCircumference: 0.3,
    vScale: 1,
    capEnd: 0.03,
  }).build(builder);
}

/** Builds jaw, eyes, horns, teeth and head spikes into the body builder. */
export function buildHead(builder: MeshBuilder, body: BodySurface, rig: RigSkeleton): HeadParts {
  const headSkin = new SkinAccumulator().add(rig.id('head'), 1);
  const jawSkin = new SkinAccumulator().add(rig.id('jaw'), 1);
  buildJaw(builder, body, rig);
  buildTongue(builder, body, rig);

  const hornColor = new THREE.Color(1, 1, 1);
  const eyeCenters: THREE.Vector3[] = [];
  const frillSpikes: HeadParts['frillSpikes'] = { L: [], R: [] };

  for (const side of SIDES) {
    const sgn = sideSign(side);
    const th = (a: number): number => a * sgn;
    const lateral = X.clone().multiplyScalar(sgn);

    // Eye.
    const sEye = body.sAtHead(0.305);
    const pEye = body.surfacePoint(sEye, th(1.28));
    const nEye = body.surfaceNormal(sEye, th(1.28));
    const eyeR = 0.062;
    const center = pEye.clone().addScaledVector(nEye, -0.038);
    eyeCenters.push(center);
    const axis = nEye.clone().addScaledVector(HEAD_FWD, 0.55).addScaledVector(HEAD_UP, 0.05).normalize();
    buildEye(builder, center, axis, eyeR, headSkin);
    buildEyelid(builder, center, axis, eyeR, headSkin);

    // Main horns: from the back of the skull, sweeping back along the neck, tips curling up and out.
    const sHorn = body.sAtHead(0.1);
    const pHorn = body.surfacePoint(sHorn, th(0.58));
    buildThorn(builder, {
      base: pHorn,
      dir: HEAD_FWD.clone().multiplyScalar(-1).addScaledVector(HEAD_UP, 0.1).addScaledVector(lateral, 0.2).normalize(),
      bendToward: HEAD_UP.clone().addScaledVector(HEAD_FWD, 0.2),
      bend: 0.42,
      bendToward2: lateral,
      bend2: 0.18,
      length: 1.25,
      radius: 0.12,
      tipRadius: 0.006,
      flatten: 0.8,
      taperPower: 1.35,
      ridgeAmp: 0.07,
      ridgeCount: 12,
      baseFlare: 0.35,
      sink: 0.1,
      segments: 14,
      rings: 28,
      materialId: MAT.horn,
      skin: headSkin,
      color: hornColor,
      vScale: 1,
    });

    // Crown spikes between/behind the main horns.
    for (const [a, len] of [
      [0.22, 0.32],
      [0.36, 0.42],
    ] as Array<[number, number]>) {
      const pc = body.surfacePoint(body.sAtHead(0.045), th(a));
      buildThorn(builder, {
        base: pc,
        dir: HEAD_FWD.clone().multiplyScalar(-1).addScaledVector(HEAD_UP, 0.28).addScaledVector(lateral, 0.12).normalize(),
        bendToward: HEAD_UP,
        bend: 0.3,
        length: len,
        radius: 0.05,
        flatten: 0.75,
        taperPower: 1.1,
        ridgeAmp: 0.05,
        ridgeCount: 5,
        baseFlare: 0.35,
        sink: 0.04,
        segments: 9,
        rings: 10,
        materialId: MAT.horn,
        skin: headSkin,
        color: hornColor,
      });
    }

    // Secondary horns from the squamosal/cheek, pointing back and slightly down.
    const pHorn2 = body.surfacePoint(body.sAtHead(0.11), th(1.62));
    buildThorn(builder, {
      base: pHorn2,
      dir: HEAD_FWD.clone().multiplyScalar(-1).addScaledVector(HEAD_UP, -0.05).addScaledVector(lateral, 0.38).normalize(),
      bendToward: HEAD_UP,
      bend: 0.3,
      length: 0.5,
      radius: 0.07,
      flatten: 0.8,
      taperPower: 1.2,
      ridgeAmp: 0.05,
      ridgeCount: 6,
      baseFlare: 0.35,
      sink: 0.06,
      segments: 10,
      rings: 14,
      materialId: MAT.horn,
      skin: headSkin,
      color: hornColor,
    });

    // Brow spikes along the ridge above the eye.
    const brow: Array<[number, number]> = [
      [0.36, 0.1],
      [0.29, 0.14],
      [0.22, 0.19],
    ];
    for (const [h, len] of brow) {
      const s = body.sAtHead(h);
      const pb = body.surfacePoint(s, th(0.86));
      const nb = body.surfaceNormal(s, th(0.86));
      buildThorn(builder, {
        base: pb,
        dir: nb.clone().multiplyScalar(0.55).addScaledVector(HEAD_FWD, -0.8).normalize(),
        bendToward: HEAD_UP,
        bend: 0.25,
        length: len,
        radius: len * 0.3,
        flatten: 0.7,
        baseFlare: 0.35,
        sink: 0.02,
        segments: 8,
        rings: 8,
        materialId: MAT.horn,
        skin: headSkin,
        color: hornColor,
      });
    }

    // Upper teeth along the lip line (hang down, visible outside the lower jaw like a crocodile).
    const rng = createRng(side === 'R' ? 71 : 113);
    const upperTeeth = [0.35, 0.41, 0.47, 0.525, 0.58, 0.635, 0.69, 0.745, 0.8, 0.852, 0.9, 0.94, 0.968];
    for (const h0 of upperTeeth) {
      const h = h0 + (rng() - 0.5) * 0.012;
      const u = upperSection(body, h);
      const fang = gauss(h - 0.852, 0.02);
      const front = smoothstep(0.93, 0.97, h);
      const len = (THREE.MathUtils.lerp(0.05, 0.085, smoothstep(0.35, 0.8, h)) * (1 - 0.35 * front) + fang * 0.075) * (0.8 + rng() * 0.4);
      const r = (0.016 + fang * 0.012) * (0.9 + rng() * 0.2);
      const root = headPoint(h, u.palate + 0.025, 0).addScaledVector(lateral, u.hw * 0.72);
      buildThorn(builder, {
        base: root,
        dir: HEAD_UP.clone().multiplyScalar(-1).addScaledVector(lateral, 0.1 + (rng() - 0.5) * 0.12).addScaledVector(HEAD_FWD, -0.1 + (rng() - 0.5) * 0.15).normalize(),
        bendToward: HEAD_FWD.clone().multiplyScalar(-1),
        bend: 0.25,
        length: len + 0.025,
        radius: r,
        tipRadius: 0.0015,
        flatten: 0.72,
        keel: 0.6,
        segments: 7,
        rings: 6,
        materialId: MAT.tooth,
        skin: headSkin,
      });
    }
    // Lower teeth on the jaw's top edge (point up into the upper jaw).
    const lowerTeeth = [0.37, 0.44, 0.51, 0.58, 0.65, 0.72, 0.79, 0.85, 0.9, 0.945];
    for (const h0 of lowerTeeth) {
      const h = h0 + (rng() - 0.5) * 0.012;
      const u = upperSection(body, h);
      const fang = gauss(h - 0.9, 0.018);
      const len = (0.04 + 0.03 * smoothstep(0.36, 0.8, h) + fang * 0.055) * (0.8 + rng() * 0.4);
      const root = headPoint(h, u.palate - 0.015, 0).addScaledVector(lateral, u.hw * JAW_WIDTH_RATIO * 0.8);
      buildThorn(builder, {
        base: root,
        dir: HEAD_UP.clone().addScaledVector(lateral, -0.05 + (rng() - 0.5) * 0.1).addScaledVector(HEAD_FWD, -0.1).normalize(),
        bendToward: HEAD_FWD.clone().multiplyScalar(-1),
        bend: 0.15,
        length: len + 0.015,
        radius: 0.014 + fang * 0.009,
        tipRadius: 0.0015,
        flatten: 0.72,
        keel: 0.6,
        segments: 7,
        rings: 6,
        materialId: MAT.tooth,
        skin: jawSkin,
      });
    }

    // Jaw frill spikes along the back of the lower jaw (membrane stretched between them separately).
    const frill: Array<[number, number, number]> = [
      [0.3, 0.13, 0.1],
      [0.22, 0.2, 0.3],
      [0.14, 0.27, 0.5],
      [0.06, 0.32, 0.7],
    ];
    for (const [h, len, down] of frill) {
      const u = upperSection(body, h);
      const depth = jawDepth(h);
      const base = headPoint(h, u.palate - depth * 0.62, 0).addScaledVector(lateral, u.hw * JAW_WIDTH_RATIO * 0.92);
      const dir = HEAD_FWD.clone().multiplyScalar(-0.85).addScaledVector(lateral, 0.55).addScaledVector(HEAD_UP, -0.25 * down).normalize();
      buildThorn(builder, {
        base,
        dir,
        bendToward: HEAD_FWD.clone().multiplyScalar(-1),
        bend: 0.25,
        length: len,
        radius: len * 0.16,
        flatten: 0.7,
        baseFlare: 0.3,
        sink: 0.02,
        segments: 8,
        rings: 9,
        materialId: MAT.horn,
        skin: h < 0.12 ? headSkin : jawSkin,
        color: hornColor,
      });
      const tip = base.clone().addScaledVector(dir, len * 0.95);
      frillSpikes[side].push({ base, tip });
    }
  }

  // Nose horn and a small ridge of nasal bumps.
  const nasal: Array<[number, number, number]> = [
    [0.845, 0.14, 0.036],
    [0.77, 0.075, 0.024],
    [0.7, 0.05, 0.018],
  ];
  for (const [h, len, r] of nasal) {
    const s = body.sAtHead(h);
    const p = body.surfacePoint(s, 0);
    buildThorn(builder, {
      base: p,
      dir: HEAD_UP.clone().addScaledVector(HEAD_FWD, -0.35).normalize(),
      bendToward: HEAD_FWD.clone().multiplyScalar(-1),
      bend: 0.35,
      length: len,
      radius: r,
      flatten: 0.6,
      baseFlare: 0.4,
      sink: 0.015,
      segments: 8,
      rings: 8,
      materialId: MAT.horn,
      skin: headSkin,
    });
  }

  const front = upperSection(body, 0.985);
  const mouthPoint = headPoint(0.985, front.palate - 0.01);
  return { mouthPoint, eyeCenters, frillSpikes };
}

/**
 * Mouth-corner skin (rictus): a web between the upper lip and the lower jaw at the back of the mouth.
 * Collapsed when the mouth is closed, it stretches when the jaw opens. Two layers: scaled skin outside,
 * mouth flesh inside (the body material is single-sided).
 */
export function buildRictus(builder: MeshBuilder, body: BodySurface, rig: RigSkeleton): void {
  const head = rig.id('head');
  const jaw = rig.id('jaw');
  const cols = 10;
  const rows = 5;
  const skin = new SkinAccumulator();
  const data = new THREE.Vector4();
  const uv = new THREE.Vector2();
  const tangent = new THREE.Vector4(0, 0, 1, 1);
  const color = new THREE.Color(0.9, 0.9, 0.9);
  for (const side of SIDES) {
    const sgn = sideSign(side);
    const lateral = X.clone().multiplyScalar(sgn);
    for (const layer of [0, 1]) {
      const base = builder.vertexCount;
      for (let c = 0; c <= cols; c++) {
        const t = c / cols;
        const hTop = THREE.MathUtils.lerp(HINGE_H - 0.02, 0.4, t);
        const hBot = THREE.MathUtils.lerp(HINGE_H - 0.02, 0.31, t);
        const uT = upperSection(body, hTop);
        const uB = upperSection(body, hBot);
        const top = headPoint(hTop, uT.palate + 0.012, 0).addScaledVector(lateral, uT.hw * 0.8);
        const bot = headPoint(hBot, uB.palate - 0.012, 0).addScaledVector(lateral, uB.hw * JAW_WIDTH_RATIO * 0.93);
        for (let r = 0; r <= rows; r++) {
          const k = r / rows;
          const p = top.clone().lerp(bot, k);
          // Slight outward bulge so the fold reads as skin, inner layer sits a few mm inside.
          p.addScaledVector(lateral, (layer === 0 ? 0.012 : 0.004) * Math.sin(k * Math.PI));
          const w = k * k * (3 - 2 * k);
          skin.clear().add(head, 1 - w).add(jaw, w);
          data.set(layer === 0 ? MAT.skin : MAT.mouth, 0.3, 0, 0);
          // Metric UVs matching the head's scale size (one v tile = one head circumference, about 2.3 m).
          uv.set(0.24 + t * 0.1, 0.4 + k * 0.12);
          const n = lateral.clone().multiplyScalar(layer === 0 ? 1 : -1);
          builder.addVertex({ position: p, normal: n, uv, tangent, color, skin, data });
        }
      }
      const W = rows + 1;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const a = base + c * W + r;
          const b = a + 1;
          const d = a + W;
          const e = d + 1;
          // Columns run forward (-Z), rows run down (-Y): (a, b, d) faces +X. Layer 0 faces laterally outward,
          // layer 1 (mouth flesh) faces the mouth cavity.
          const facesPlusX = (layer === 0) === (sgn > 0);
          if (facesPlusX) {
            builder.addTriangle(a, b, d);
            builder.addTriangle(b, e, d);
          } else {
            builder.addTriangle(a, d, b);
            builder.addTriangle(b, d, e);
          }
        }
      }
    }
  }
}

/** Translucent membranes stretched between the jaw frill spikes (membrane mesh). */
export function buildFrillMembranes(builder: MeshBuilder, parts: HeadParts, rig: RigSkeleton): void {
  const head = rig.id('head');
  const jaw = rig.id('jaw');
  const rows = 8;
  const cols = 5;
  const skin = new SkinAccumulator();
  const data = new THREE.Vector4();
  const uv = new THREE.Vector2();
  const normal = new THREE.Vector3();
  for (const side of SIDES) {
    const sgn = sideSign(side);
    const spikes = parts.frillSpikes[side];
    for (let i = 0; i < spikes.length - 1; i++) {
      const A = spikes[i];
      const B = spikes[i + 1];
      const boneA = i === spikes.length - 1 ? head : jaw;
      const boneB = i + 1 === spikes.length - 1 ? head : jaw;
      const base = builder.vertexCount;
      const edgeA = A.tip.clone().sub(A.base);
      const edgeB = B.tip.clone().sub(B.base);
      normal.crossVectors(edgeA, B.base.clone().sub(A.base)).normalize();
      if (normal.x * sgn < 0) {
        normal.negate();
      }
      for (let r = 0; r <= rows; r++) {
        const t = r / rows;
        for (let c = 0; c <= cols; c++) {
          const s = c / cols;
          const pa = A.base.clone().addScaledVector(edgeA, t);
          const pb = B.base.clone().addScaledVector(edgeB, t);
          const p = pa.lerp(pb, s);
          // Scalloped free edge: the membrane stops short of the tips between spikes.
          const sag = 4 * s * (1 - s) * 0.35 * Math.pow(t, 2);
          p.lerp(A.base.clone().lerp(B.base, s), sag);
          skin.clear().add(boneA, 1 - s).add(boneB, s);
          data.set(0.15 * Math.sin(Math.PI * s), t, 0.35, sgn);
          uv.set(0.5 + 0.06 * s, 0.45 + 0.08 * t);
          builder.addVertex({ position: p, normal, uv, skin, data });
        }
      }
      const W = cols + 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const a = base + r * W + c;
          const b = a + 1;
          const d = a + W;
          const e = d + 1;
          builder.addTriangle(a, b, d);
          builder.addTriangle(b, e, d);
        }
      }
    }
  }
}
