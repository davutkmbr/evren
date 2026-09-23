import * as THREE from 'three';
import { FINGERS, LANDMARKS, fingerJoints, mirror, sideSign, thumbTip, type Side } from '../anatomy';
import type { RigSkeleton } from '../skeleton';
import type { BodySurface } from './body';
import { MeshBuilder, SkinAccumulator } from './buffers';
import { ChainSkinner } from './chain-skin';
import { Loft } from './loft';
import { MAT } from './materials-ids';
import { PathSampler, gauss, smoothstep } from './path';
import { buildThorn } from './thorn';

/** Wing-plane texture mapping (right-wing rest coordinates, mirrored for the left). */
export const WING_UV = { x0: 0.0, width: 12.6, z0: -2.6, depth: 7.2 };

export function wingUv(p: THREE.Vector3, out: THREE.Vector2): THREE.Vector2 {
  return out.set((Math.abs(p.x) - WING_UV.x0) / WING_UV.width, (p.z - WING_UV.z0) / WING_UV.depth);
}

/** A polyline edge with a skinning function along its arc length. */
class Edge {
  readonly path: PathSampler;
  constructor(
    points: THREE.Vector3[],
    private readonly skinFn: (s: number, acc: SkinAccumulator, scale: number) => void,
  ) {
    this.path = new PathSampler(points, { type: 'centripetal', samples: 600 });
  }
  point(t: number, out: THREE.Vector3): THREE.Vector3 {
    return this.path.pointAt(t * this.path.length, out);
  }
  skin(t: number, acc: SkinAccumulator, scale: number): void {
    this.skinFn(t * this.path.length, acc, scale);
  }
}

interface PanelSpec {
  a: Edge;
  b: Edge;
  /** Trailing edge scallop depth as a fraction of the tip distance (0 for lens panels). */
  scallop: number;
  /** Scallop direction: points from the trailing edge midpoint into the panel. */
  inward?: THREE.Vector3;
  across: number;
  along: number;
  side: Side;
  /** Membrane thickness bias (0 = thin chiropatagium, 1 = thick body membrane). */
  thickness: number;
}

/** Coons-style patch between two edges sharing their root, closed by a scalloped trailing edge. */
function buildPanel(builder: MeshBuilder, spec: PanelSpec): void {
  const { a, b, across: nS, along: nT } = spec;
  const a1 = a.point(1, new THREE.Vector3());
  const b1 = b.point(1, new THREE.Vector3());
  const span = a1.distanceTo(b1);
  const inward = spec.inward ? spec.inward.clone().normalize() : new THREE.Vector3();
  const grid: THREE.Vector3[] = [];
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const lin = new THREE.Vector3();
  for (let j = 0; j <= nT; j++) {
    const t = j / nT;
    a.point(t, pa);
    b.point(t, pb);
    for (let i = 0; i <= nS; i++) {
      const s = i / nS;
      lin.copy(pa).lerp(pb, s);
      const sc = spec.scallop * span * 4 * s * (1 - s) * Math.pow(t, 2.2);
      grid.push(lin.clone().addScaledVector(inward, sc));
    }
  }
  const W = nS + 1;
  const base = builder.vertexCount;
  const n = new THREE.Vector3();
  // One orientation for the whole panel: dorsal side (+Y at the panel centre) is "up".
  const cS = Math.floor(nS / 2);
  const cT = Math.floor(nT * 0.6);
  const refN = new THREE.Vector3()
    .subVectors(grid[cT * W + cS + 1], grid[cT * W + cS - 1])
    .cross(new THREE.Vector3().subVectors(grid[(cT + 1) * W + cS], grid[(cT - 1) * W + cS]));
  const flip = refN.y < 0 ? -1 : 1;
  const d1 = new THREE.Vector3();
  const d2 = new THREE.Vector3();
  const uv = new THREE.Vector2();
  const data = new THREE.Vector4();
  const tangent = new THREE.Vector4();
  const skin = new SkinAccumulator();
  const color = new THREE.Color(1, 1, 1);
  const sgn = sideSign(spec.side);
  for (let j = 0; j <= nT; j++) {
    for (let i = 0; i <= nS; i++) {
      const p = grid[j * W + i];
      const iL = Math.max(i - 1, 0);
      const iR = Math.min(i + 1, nS);
      const jD = Math.max(j - 1, 0);
      const jU = Math.min(j + 1, nT);
      d1.subVectors(grid[j * W + iR], grid[j * W + iL]);
      d2.subVectors(grid[jU * W + i], grid[jD * W + i]);
      n.crossVectors(d1, d2);
      if (n.lengthSq() < 1e-12) {
        // Degenerate root row: use the next row's normal direction.
        d2.subVectors(grid[Math.min(j + 1, nT) * W + i], grid[j * W + i]);
        d1.subVectors(grid[Math.min(j + 1, nT) * W + iR], grid[Math.min(j + 1, nT) * W + iL]);
        n.crossVectors(d1, d2);
      }
      n.multiplyScalar(flip).normalize();
      const s = i / nS;
      const t = j / nT;
      skin.clear();
      const w = s * s * (3 - 2 * s);
      a.skin(t, skin, 1 - w);
      b.skin(t, skin, w);
      wingUv(p, uv);
      const slack = Math.sin(Math.PI * s) * Math.pow(Math.sin(Math.PI * Math.min(t * 0.85 + 0.1, 1)), 0.6) * Math.min(span / 3, 1);
      const boneProx = Math.max(1 - smoothstep(0, 0.12, s), smoothstep(0.88, 1, s));
      data.set(slack, t, Math.max(boneProx, spec.thickness * 0.6), sgn);
      tangent.set(1, 0, 0, 1);
      builder.addVertex({ position: p, normal: n, uv, tangent, color, skin, data });
    }
  }
  const tri = (ia: number, ib: number, ic: number): void => {
    const A = grid[ia];
    const B = grid[ib];
    const C = grid[ic];
    d1.subVectors(B, A);
    d2.subVectors(C, A);
    n.crossVectors(d1, d2);
    if (n.lengthSq() < 1e-14) {
      return;
    }
    if (flip > 0) {
      builder.addTriangle(base + ia, base + ib, base + ic);
    } else {
      builder.addTriangle(base + ia, base + ic, base + ib);
    }
  };
  for (let j = 0; j < nT; j++) {
    for (let i = 0; i < nS; i++) {
      const v00 = j * W + i;
      const v10 = j * W + i + 1;
      const v01 = (j + 1) * W + i;
      const v11 = (j + 1) * W + i + 1;
      tri(v00, v10, v01);
      tri(v10, v11, v01);
    }
  }
}

export interface WingParts {
  /** Wing tip rest positions per side (tip of the leading finger). */
  tips: Record<Side, THREE.Vector3>;
}

/** Arm and finger tubes go into the body builder, membranes into the membrane builder. */
export function buildWings(body: BodySurface, bodyBuilder: MeshBuilder, membraneBuilder: MeshBuilder, rig: RigSkeleton): WingParts {
  const tips = {} as Record<Side, THREE.Vector3>;
  for (const side of ['R', 'L'] as Side[]) {
    const sgn = sideSign(side);
    const shoulder = mirror(LANDMARKS.shoulder, side);
    const elbow = mirror(LANDMARKS.elbow, side);
    const wrist = mirror(LANDMARKS.wrist, side);
    const fingers = fingerJoints(side);
    const inside = shoulder.clone().add(new THREE.Vector3(-0.5 * sgn, -0.2, 0.05));
    const chest = rig.id('chest');
    const humerus = rig.id(`humerus${side}`);
    const forearm = rig.id(`forearm${side}`);
    const hand = rig.id(`hand${side}`);
    const fa = FINGERS.map((_, f) => rig.id(`finger${f}a${side}`));
    const fb = FINGERS.map((_, f) => rig.id(`finger${f}b${side}`));

    // --- Arm tube (shoulder muscle mass -> humerus -> forearm -> wrist knuckle) ---
    const wristEnd = wrist.clone().add(new THREE.Vector3(0.14 * sgn, 0.0, -0.03));
    const armPts = [inside, shoulder, elbow, wrist, wristEnd];
    const armPath = new PathSampler(armPts, { type: 'centripetal', samples: 1200 });
    const ak = armPath.knotLengths;
    const armSkin = new ChainSkinner(ak, [chest, humerus, forearm, hand], (k) => (k === 1 ? 0.3 : k === 2 ? 0.16 : 0.08));
    const armLen = armPath.length;
    const radiusAt = (s: number): number => {
      const sh = ak[1];
      const el = ak[2];
      const wr = ak[3];
      let r: number;
      if (s < sh) {
        r = THREE.MathUtils.lerp(0.42, 0.4, s / sh);
      } else if (s < el) {
        // Deltoid / biceps mass on the proximal humerus, tapering to the elbow.
        const t = (s - sh) / (el - sh);
        r = THREE.MathUtils.lerp(0.4, 0.14, smoothstep(0, 1, t)) + 0.07 * gauss(t - 0.25, 0.2);
      } else if (s < wr) {
        const t = (s - el) / (wr - el);
        r = THREE.MathUtils.lerp(0.13, 0.095, t) + 0.02 * gauss(t - 0.2, 0.18);
      } else {
        const t = (s - wr) / (armLen - wr);
        r = THREE.MathUtils.lerp(0.11, 0.05, t);
      }
      r += 0.045 * gauss(s - el, 0.1) + 0.04 * gauss(s - wr, 0.07);
      return r;
    };
    const armRings: number[] = [];
    for (let s = 0; s < armLen; s += s < ak[1] + 0.3 ? 0.05 : 0.07) {
      armRings.push(s);
    }
    armRings.push(armLen - 0.002);
    new Loft({
      path: armPath,
      rings: armRings,
      segments: 24,
      section: (s, theta, out) => {
        const r = radiusAt(s);
        // Flattened: thinner vertically, with a ridge on the leading (front) side.
        const lead = Math.max(0, -Math.sin(theta) * sgn);
        out.set(Math.sin(theta) * r * (1 + 0.1 * lead), Math.cos(theta) * r * 0.78);
      },
      skin: (s, theta, pos, acc) => armSkin.apply(s, acc),
      data: (s, theta, pos, out) => out.set(MAT.skin, 0, 0, 1),
      color: (s, theta, pos, out) => out.setRGB(0.92, 0.92, 0.92),
      minCircumference: 0.6,
      vScale: 1,
      capEnd: 0.03,
    }).build(bodyBuilder);

    // --- Finger tubes with claw-less rounded tips ---
    fingers.forEach((joints, f) => {
      const pts = [joints[0], joints[1], joints[2]];
      const path = new PathSampler(pts, { type: 'centripetal', samples: 800 });
      const k = path.knotLengths;
      const skinner = new ChainSkinner([0, 0.12, k[1], k[2]], [hand, fa[f], fb[f]], 0.08);
      const L = path.length;
      const r0 = 0.085 - f * 0.008;
      const rings: number[] = [];
      for (let s = 0.02; s < L; s += 0.09) {
        rings.push(s);
      }
      rings.push(L - 0.003);
      new Loft({
        path,
        rings,
        segments: 10,
        section: (s, theta, out) => {
          const t = s / L;
          let r = THREE.MathUtils.lerp(r0, 0.014, Math.pow(t, 0.9));
          r += 0.018 * gauss(s - k[1], 0.08) + 0.02 * gauss(s, 0.12);
          out.set(Math.sin(theta) * r, Math.cos(theta) * r * 0.85);
        },
        skin: (s, theta, pos, acc) => skinner.apply(s, acc),
        data: (s, theta, pos, out) => out.set(MAT.skin, 0, 0, 1),
        color: (s, theta, pos, out) => out.setRGB(0.85, 0.85, 0.85),
        minCircumference: 0.35,
        vScale: 1,
        capEnd: 0.01,
      }).build(bodyBuilder);
    });

    // --- Thumb with a hooked claw (used for walking on the wrists) ---
    const thumbSkin = new SkinAccumulator().add(rig.id(`thumb${side}`), 1);
    const tTip = thumbTip(side);
    const thumbDir = tTip.clone().sub(wrist).normalize();
    buildThorn(bodyBuilder, {
      base: wrist.clone().addScaledVector(thumbDir, 0.05),
      dir: thumbDir,
      bendToward: new THREE.Vector3(0, -1, 0),
      bend: 0.3,
      length: wrist.distanceTo(tTip) * 0.8,
      radius: 0.075,
      tipRadius: 0.035,
      taperPower: 1,
      segments: 10,
      rings: 8,
      materialId: MAT.skin,
      dataW: 1,
      skin: thumbSkin,
      color: new THREE.Color(0.9, 0.9, 0.9),
    });
    buildThorn(bodyBuilder, {
      base: wrist.clone().addScaledVector(thumbDir, wrist.distanceTo(tTip) * 0.78),
      dir: thumbDir.clone().add(new THREE.Vector3(0, -0.3, 0)).normalize(),
      bendToward: new THREE.Vector3(0, -1, 0),
      bend: 1.1,
      length: 0.26,
      radius: 0.04,
      tipRadius: 0.002,
      flatten: 0.6,
      keel: 0.5,
      sink: 0.03,
      segments: 8,
      rings: 9,
      materialId: MAT.claw,
      skin: thumbSkin,
    });

    // --- Membranes ---
    const armEdgeSkin = (s: number, acc: SkinAccumulator, scale: number): void => {
      armSkin.apply(s + ak[1], acc, scale);
    };
    const armEdge = new Edge([shoulder, elbow, wrist], armEdgeSkin);
    const fingerEdges = fingers.map((joints, f) => {
      const k1 = joints[0].distanceTo(joints[1]);
      const sk = new ChainSkinner([0, 0.25, k1, k1 + joints[1].distanceTo(joints[2])], [hand, fa[f], fb[f]], 0.12);
      return new Edge(joints, (s, acc, scale) => sk.apply(s, acc, scale));
    });

    // Propatagium: leading-edge membrane in front of the arm (shoulder -> wrist).
    const leadMid = shoulder.clone().lerp(wrist, 0.45).add(new THREE.Vector3(0, 0.05, -0.28));
    const leadEdge = new Edge([shoulder.clone().add(new THREE.Vector3(0.05 * sgn, 0.08, -0.2)), leadMid, wrist], armEdgeSkin);
    buildPanel(membraneBuilder, { a: leadEdge, b: armEdge, scallop: 0, across: 5, along: 26, side, thickness: 0.6 });

    // Chiropatagium panels between consecutive fingers.
    for (let f = 0; f < FINGERS.length - 1; f++) {
      const tipA = fingers[f][2];
      const tipB = fingers[f + 1][2];
      const inward = wrist.clone().sub(tipA.clone().lerp(tipB, 0.5));
      buildPanel(membraneBuilder, {
        a: fingerEdges[f],
        b: fingerEdges[f + 1],
        scallop: 0.17,
        inward,
        across: 12,
        along: 22,
        side,
        thickness: 0,
      });
    }

    // Plagiopatagium: between the body flank (shoulder -> hip) and arm + last finger.
    const flankPts: THREE.Vector3[] = [];
    const flankZ = [-1.3, -0.7, 0.0, 0.7, 1.35, 1.9];
    const bodySkinAt: Array<{ s: number; theta: number }> = [];
    for (const z of flankZ) {
      const s = body.sAtZ(z);
      const theta = 1.05 * sgn;
      const p = body.surfacePoint(s, theta);
      const nrm = body.surfaceNormal(s, theta);
      p.addScaledVector(nrm, -0.05);
      flankPts.push(p);
      bodySkinAt.push({ s, theta });
    }
    flankPts[0] = shoulder.clone().add(new THREE.Vector3(-0.05 * sgn, -0.05, 0.05));
    const flankEdge = new Edge(flankPts, (s, acc, scale) => {
      // Map arc length back to a body arc length through z.
      const t = s / flankEdgePath.length;
      const z = THREE.MathUtils.lerp(flankZ[0], flankZ[flankZ.length - 1], t);
      const sb = body.sAtZ(z);
      body.skinForSurface(sb, 1.05 * sgn, tmpBody);
      acc.addScaled(tmpBody, scale);
    });
    const flankEdgePath = flankEdge.path;
    const tmpBody = new SkinAccumulator();
    const last = FINGERS.length - 1;
    const lastJoints = fingers[last];
    const armLenEdge = armEdge.path.length;
    const k1 = lastJoints[0].distanceTo(lastJoints[1]);
    const lastSk = new ChainSkinner([0, 0.25, k1, k1 + lastJoints[1].distanceTo(lastJoints[2])], [hand, fa[last], fb[last]], 0.12);
    const outerEdge = new Edge([shoulder, elbow, wrist, lastJoints[1], lastJoints[2]], (s, acc, scale) => {
      if (s < armLenEdge) {
        armSkin.apply(s + ak[1], acc, scale);
      } else {
        lastSk.apply(s - armLenEdge, acc, scale);
      }
    });
    const hip = flankPts[flankPts.length - 1];
    const inwardPlagio = shoulder.clone().sub(hip.clone().lerp(lastJoints[2], 0.5));
    buildPanel(membraneBuilder, {
      a: flankEdge,
      b: outerEdge,
      scallop: 0.12,
      inward: inwardPlagio,
      across: 18,
      along: 30,
      side,
      thickness: 0.5,
    });

    tips[side] = fingers[0][2].clone();
  }
  return { tips };
}
