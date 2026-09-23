import * as THREE from 'three';
import { RIDER, SADDLE_LIFT, SIDES, mirror, sideSign, type Side } from '../anatomy';
import type { RigSkeleton } from '../skeleton';
import type { BodySurface } from './body';
import { MeshBuilder, SkinAccumulator } from './buffers';
import { RIDER_MAT } from './materials-ids';
import { PathSampler, smoothstep } from './path';
import { buildTube } from './rider-parts';
import { fistFrame } from './rider-hands';

/**
 * Shell glued onto the body surface over a (z, theta) rectangle, offset outward by thickness(z, theta).
 * uv = meters along/around for procedural leather/wool detail.
 */
function buildShell(
  builder: MeshBuilder,
  body: BodySurface,
  opts: {
    zFront: number;
    zBack: number;
    thetaMax: number;
    thickness: (u: number, v: number) => number;
    material: (u: number, v: number) => number;
    skin: (s: number, theta: number, acc: SkinAccumulator) => void;
    rows: number;
    cols: number;
  },
): void {
  const { rows, cols } = opts;
  const grid: THREE.Vector3[] = [];
  const nrm = new THREE.Vector3();
  const params: Array<{ s: number; theta: number; u: number; v: number }> = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const z = THREE.MathUtils.lerp(opts.zFront, opts.zBack, v);
    const s = body.sAtZ(z);
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const theta = THREE.MathUtils.lerp(-opts.thetaMax, opts.thetaMax, u);
      const p = body.surfacePoint(s, theta);
      body.surfaceNormal(s, theta, nrm);
      p.addScaledVector(nrm, opts.thickness(u, v));
      grid.push(p);
      params.push({ s, theta, u, v });
    }
  }
  const W = cols + 1;
  const base = builder.vertexCount;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const n = new THREE.Vector3();
  const skin = new SkinAccumulator();
  const data = new THREE.Vector4();
  const uv = new THREE.Vector2();
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const i = r * W + c;
      a.subVectors(grid[r * W + Math.min(c + 1, cols)], grid[r * W + Math.max(c - 1, 0)]);
      b.subVectors(grid[Math.min(r + 1, rows) * W + c], grid[Math.max(r - 1, 0) * W + c]);
      n.crossVectors(a, b).normalize();
      const pr = params[i];
      body.surfaceNormal(pr.s, pr.theta, nrm);
      if (n.dot(nrm) < 0) {
        n.negate();
      }
      skin.clear();
      opts.skin(pr.s, pr.theta, skin);
      // Wear: rubbed rolled edges all around the shell.
      const edgeDist = Math.min(Math.min(pr.u, 1 - pr.u) * 10, Math.min(pr.v, 1 - pr.v) * 14);
      data.set(opts.material(pr.u, pr.v), Math.max(0, 1 - edgeDist), 0, 0);
      uv.set(pr.u * opts.thetaMax * 2 * 0.6, pr.v * Math.abs(opts.zBack - opts.zFront));
      builder.addVertex({ position: grid[i], normal: n, uv, skin, data });
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = base + r * W + c;
      const i1 = i0 + 1;
      const i2 = i0 + W;
      const i3 = i2 + 1;
      // Orient triangles so their face normal agrees with the outward vertex normal.
      a.subVectors(grid[r * W + c + 1], grid[r * W + c]);
      b.subVectors(grid[(r + 1) * W + c], grid[r * W + c]);
      n.crossVectors(a, b);
      const pr = params[r * W + c];
      body.surfaceNormal(pr.s, pr.theta, nrm);
      if (n.dot(nrm) >= 0) {
        builder.addTriangle(i0, i1, i2);
        builder.addTriangle(i1, i3, i2);
      } else {
        builder.addTriangle(i0, i2, i1);
        builder.addTriangle(i1, i2, i3);
      }
    }
  }
}

/** Closed band (strap) around the body at arc length s. */
function buildBand(builder: MeshBuilder, body: BodySurface, s: number, width: number, lift: number, material: number, skinFn: (s: number, theta: number, acc: SkinAccumulator) => void, segments = 64): void {
  const offsets: Array<[number, number]> = [
    [-width / 2, lift * 0.3],
    [-width / 2 + 0.008, lift],
    [width / 2 - 0.008, lift],
    [width / 2, lift * 0.3],
  ];
  const base = builder.vertexCount;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const skin = new SkinAccumulator();
  const data = new THREE.Vector4(material, 0, 0, 0);
  const uv = new THREE.Vector2();
  for (let j = 0; j <= segments; j++) {
    const theta = (j / segments) * Math.PI * 2;
    for (let k = 0; k < offsets.length; k++) {
      const [ds, off] = offsets[k];
      body.surfacePoint(s + ds, theta, p);
      body.surfaceNormal(s + ds, theta, n);
      p.addScaledVector(n, off);
      skin.clear();
      skinFn(s, theta, skin);
      uv.set(j / segments * 6, k / 3);
      builder.addVertex({ position: p, normal: n, uv, skin, data });
    }
  }
  const W = offsets.length;
  for (let j = 0; j < segments; j++) {
    for (let k = 0; k < W - 1; k++) {
      const a = base + j * W + k;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      builder.addTriangle(a, c, b);
      builder.addTriangle(b, c, d);
    }
  }
}

export interface TackParts {
  /** Saddle seat height (rig y) at the rider. */
  seatY: number;
}

/** Saddle, blanket, girth straps, stirrups, bridle and reins. */
export function buildTack(builder: MeshBuilder, body: BodySurface, rig: RigSkeleton): TackParts {
  const chestBone = rig.id('chest');
  const chestSkin = (_s: number, _t: number, acc: SkinAccumulator): void => {
    acc.add(chestBone, 1);
  };
  const bodySkin = (s: number, theta: number, acc: SkinAccumulator): void => {
    const tmp = new SkinAccumulator();
    body.skinForSurface(s, theta, tmp);
    acc.addScaled(tmp, 1);
  };

  // Saddle blanket (wool with a woven border) under the saddle.
  buildShell(builder, body, {
    zFront: -3.2,
    zBack: -1.98,
    thetaMax: 1.28,
    rows: 22,
    cols: 30,
    thickness: (u, v) => {
      const edge = Math.min(u, 1 - u, v * 1.5, (1 - v) * 1.5);
      return 0.004 + 0.016 * smoothstep(0.0, 0.04, edge);
    },
    material: () => RIDER_MAT.fur,
    skin: chestSkin,
  });

  // Saddle: high cantle behind, pommel in front, leather skirts down the sides.
  buildShell(builder, body, {
    zFront: -3.06,
    zBack: -2.1,
    thetaMax: 1.05,
    rows: 34,
    cols: 30,
    thickness: (u, v) => {
      const lat = Math.abs(u - 0.5) * 2;
      const seatZone = 1 - smoothstep(0.22, 0.62, lat);
      const cantle = smoothstep(0.62, 0.97, v) * (1 - smoothstep(0.97, 1.0, v)) * 0.17 * (1 - smoothstep(0.2, 0.45, lat));
      const pommel = smoothstep(0.3, 0.05, v) * (1 - smoothstep(0.0, 0.03, 0.03 - v)) * 0.12 * (1 - smoothstep(0.12, 0.34, lat));
      const seat = 0.02 + (0.075 + SADDLE_LIFT) * seatZone;
      const edge = Math.min(u, 1 - u) * 8;
      const edgeV = Math.min(v, 1 - v) * 14;
      return (seat + cantle + pommel) * Math.min(1, edgeV) * (0.35 + 0.65 * Math.min(1, edge)) + 0.004;
    },
    material: (u) => (Math.abs(u - 0.5) * 2 < 0.4 ? RIDER_MAT.leather : RIDER_MAT.darkLeather),
    skin: chestSkin,
  });

  // Girth straps around the neck base with buckles.
  for (const z of [-2.2, -2.95]) {
    const s = body.sAtZ(z);
    buildBand(builder, body, s, 0.085, 0.022, RIDER_MAT.darkLeather, bodySkin);
    for (const side of SIDES) {
      const theta = 1.45 * sideSign(side);
      const p = body.surfacePoint(s, theta);
      const n = body.surfaceNormal(s, theta);
      p.addScaledVector(n, 0.03);
      const along = body.loft.frameAt(s).tangent;
      buildTube(builder, {
        points: [p.clone().addScaledVector(along, -0.05), p.clone().addScaledVector(along, 0.05)],
        up: n,
        keys: [
          [0, 0.035, 0.012, 0.01],
          [1, 0.035, 0.012, 0.01],
        ],
        segments: 8,
        material: () => RIDER_MAT.metal,
        skin: (t, acc) => bodySkin(s, theta, acc),
        capStart: true,
        capEnd: true,
      });
    }
  }

  // Stirrup leathers and irons.
  for (const side of SIDES) {
    const sgn = sideSign(side);
    const s = body.sAtZ(-2.62);
    const top = body.surfacePoint(s, 0.95 * sgn);
    top.addScaledVector(body.surfaceNormal(s, 0.95 * sgn), 0.03);
    const ankle = mirror(RIDER.ankle, side);
    const iron = ankle.clone().add(new THREE.Vector3(0.0, -0.075, -0.1));
    buildTube(builder, {
      points: [top, top.clone().lerp(iron, 0.5).add(new THREE.Vector3(0.05 * sgn, 0, 0)), iron],
      up: new THREE.Vector3(0, 0, -1),
      keys: [
        [0, 0.02, 0.006, 0.006],
        [1, 0.02, 0.006, 0.006],
      ],
      segments: 6,
      material: () => RIDER_MAT.darkLeather,
      skin: (t, acc) => acc.add(chestBone, 1),
    });
    // Stirrup iron: a flattened loop under the boot.
    const loop: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      loop.push(iron.clone().add(new THREE.Vector3(Math.cos(a) * 0.055, Math.sin(a) * 0.035 - 0.02, Math.sin(a) * 0.02)));
    }
    buildTube(builder, {
      points: loop,
      up: new THREE.Vector3(0, 0, 1),
      keys: [
        [0, 0.008, 0.008, 0.008],
        [1, 0.008, 0.008, 0.008],
      ],
      segments: 6,
      spacing: 0.02,
      material: () => RIDER_MAT.metal,
      skin: (t, acc) => acc.add(chestBone, 1),
    });
  }

  // Bridle: headstall behind the eyes, noseband on the upper snout, cheek straps, rein rings.
  const headSkin = (s: number, theta: number, acc: SkinAccumulator): void => bodySkin(s, theta, acc);
  const sHead = body.sAtHead(0.14);
  const sNose = body.sAtHead(0.64);
  buildBand(builder, body, sHead, 0.055, 0.014, RIDER_MAT.darkLeather, headSkin, 56);
  buildBand(builder, body, sNose, 0.05, 0.014, RIDER_MAT.darkLeather, headSkin, 48);
  const headBone = rig.id('head');
  const handBones = { R: rig.id('riderHandR'), L: rig.id('riderHandL') };
  const reinExits: Record<Side, THREE.Vector3> = { R: new THREE.Vector3(), L: new THREE.Vector3() };
  for (const side of SIDES) {
    const sgn = sideSign(side);
    const cheek: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const s = THREE.MathUtils.lerp(sHead, sNose, t);
      const theta = THREE.MathUtils.lerp(1.45, 1.62, t) * sgn;
      const p = body.surfacePoint(s, theta).addScaledVector(body.surfaceNormal(s, theta), 0.012);
      cheek.push(p);
    }
    buildTube(builder, {
      points: cheek,
      up: new THREE.Vector3(sgn, 0, 0),
      keys: [
        [0, 0.022, 0.006, 0.006],
        [1, 0.022, 0.006, 0.006],
      ],
      segments: 6,
      material: () => RIDER_MAT.darkLeather,
      skin: (t, acc) => acc.add(headBone, 1),
    });
    // Ring at the noseband side.
    const ringS = sNose;
    const ringTheta = 1.7 * sgn;
    const ringC = body.surfacePoint(ringS, ringTheta).addScaledVector(body.surfaceNormal(ringS, ringTheta), 0.03);
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      ring.push(ringC.clone().add(new THREE.Vector3(0, Math.cos(a) * 0.05, Math.sin(a) * 0.05)));
    }
    buildTube(builder, {
      points: ring,
      up: new THREE.Vector3(1, 0, 0),
      keys: [
        [0, 0.009, 0.009, 0.009],
        [1, 0.009, 0.009, 0.009],
      ],
      segments: 6,
      spacing: 0.02,
      material: () => RIDER_MAT.metal,
      skin: (t, acc) => acc.add(headBone, 1),
    });

    // Rein: from the ring back along the neck (riding over its dorsal flank) to the rider's fist.
    const pts: THREE.Vector3[] = [ringC.clone().add(new THREE.Vector3(0.0, 0.0, 0.03))];
    const hs = [0.45, 0.2, 0.0];
    for (const h of hs) {
      const s = body.sAtHead(h);
      const th = THREE.MathUtils.lerp(1.2, 0.9, 1 - h / 0.45) * sgn;
      pts.push(body.surfacePoint(s, th).addScaledVector(body.surfaceNormal(s, th), 0.05));
    }
    const neckZ = [-5.6, -4.7, -3.9, -3.3];
    for (const z of neckZ) {
      const s = body.sAtZ(z);
      const th = THREE.MathUtils.lerp(0.85, 0.5, (z + 5.6) / 2.3) * sgn;
      pts.push(body.surfacePoint(s, th).addScaledVector(body.surfaceNormal(s, th), 0.06 + (z + 5.6) * 0.03));
    }
    // Into the fist: under the little finger, up through the grip, out between index and thumb.
    const fist = fistFrame(side);
    const lastBody = pts.length - 1;
    pts.push(
      fist.channel.clone().addScaledVector(fist.up, -0.1).addScaledVector(fist.fwd, 0.035),
      fist.channel.clone().addScaledVector(fist.up, -0.045),
      fist.channel.clone(),
      fist.channel.clone().addScaledVector(fist.up, 0.04),
      fist.channel.clone().addScaledVector(fist.up, 0.062).addScaledVector(fist.fwd, -0.012),
    );
    reinExits[side] = pts[pts.length - 1].clone();
    const reinPath = new PathSampler(pts, { type: 'centripetal', samples: 600 });
    const L = reinPath.length;
    const knots = reinPath.knotLengths;
    const sBody = knots[lastBody];
    const sHand = knots[lastBody + 1];
    const tmp = new SkinAccumulator();
    const pos = new THREE.Vector3();
    buildTube(builder, {
      points: pts,
      up: new THREE.Vector3(0, 1, 0),
      keys: [
        [0, 0.013, 0.006, 0.006],
        [1, 0.013, 0.006, 0.006],
      ],
      segments: 6,
      spacing: 0.06,
      material: () => RIDER_MAT.darkLeather,
      wear: (t) => (t * L > sHand ? 0.6 : 0.25),
      skin: (t, acc) => {
        const sArc = t * L;
        reinPath.pointAt(sArc, pos);
        if (sArc >= sHand) {
          acc.add(handBones[side], 1);
          return;
        }
        if (sArc > sBody) {
          const k = smoothstep(sBody, sHand, sArc);
          tmp.clear();
          body.skinForSurface(body.sAtZ(pos.z), 0.5 * sgn, tmp);
          acc.addScaled(tmp, 1 - k).add(handBones[side], k);
          return;
        }
        if (knots.length > 2 && sArc < knots[3]) {
          acc.add(headBone, 1);
          return;
        }
        body.skinForSurface(body.sAtZ(pos.z), 0.7 * sgn, tmp);
        acc.addScaled(tmp, 1);
      },
    });
  }
  // The rein ends are buckled together: a slack bight hangs between the fists.
  const eR = reinExits.R;
  const eL = reinExits.L;
  const fR = fistFrame('R');
  const fL = fistFrame('L');
  const mid = eR.clone().lerp(eL, 0.5).add(new THREE.Vector3(0, -0.17, 0.07));
  const bight = [
    eR,
    eR.clone().addScaledVector(fR.medial, 0.03).addScaledVector(fR.up, 0.012).addScaledVector(fR.fwd, -0.02),
    mid,
    eL.clone().addScaledVector(fL.medial, 0.03).addScaledVector(fL.up, 0.012).addScaledVector(fL.fwd, -0.02),
    eL,
  ];
  buildTube(builder, {
    points: bight,
    up: new THREE.Vector3(0, 0, -1),
    keys: [
      [0, 0.013, 0.006, 0.006],
      [1, 0.013, 0.006, 0.006],
    ],
    segments: 6,
    spacing: 0.025,
    material: () => RIDER_MAT.darkLeather,
    wear: () => 0.4,
    skin: (t, acc) => {
      const k = smoothstep(0.2, 0.8, t);
      acc.add(handBones.R, 1 - k).add(handBones.L, k);
    },
  });

  const seat = body.surfacePoint(body.sAtZ(-2.55), 0);
  return { seatY: seat.y + 0.095 + SADDLE_LIFT };
}
