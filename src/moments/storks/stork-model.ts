/**
 * White stork (Ciconia ciconia) built in code, real size: wingspan ~2.0 m, bill tip to tail ~1.1 m, legs trailing
 * ~0.2 m past the tail. Forward is -Z, up +Y, right +X (like the life birds). Pure TS (no three.js), so the headless
 * pose sheet (tools/headless/storks-sheet.ts) renders exactly the vertices the game draws.
 *
 * The wing is a panel grid (arm: shoulder → wrist; hand: wrist → the base of the fingers) plus six separated primaries
 * ("fingers"). Every wing vertex carries its rest position in the unfolded, flat wing and its joint data; the pose is
 * applied in the vertex shader (stork-material.ts) and mirrored by `deformStorkVertex` below. The two must stay in sync.
 *
 * Plumage (fragment shader, mirrored by `storkColor`): white body, neck, head, tail and wing coverts; black flight
 * feathers (secondaries on the arm's rear half, the whole hand and the fingers); long red bill and red legs. About a
 * third of autumn migrants are juveniles: duller, brownish-black flight feathers, a darker bill and paler legs.
 */

/** Regions (aWing.z). */
export const REGION = {
  body: 0,
  head: 1,
  bill: 2,
  legs: 3,
  tail: 4,
  arm: 5,
  hand: 6,
  finger: 7,
} as const;

/** Wing layout (m, body-local, per side; `s` is the distance outward from the shoulder along the unfolded wing). */
export const WING = {
  /** Shoulder x (inside the body). */
  shoulderX: 0.075,
  /** Shoulder pivot z (leading edge at the root). */
  shoulderZ: -0.1,
  /** Wrist span position and pivot z (leading edge at the wrist). */
  wristS: 0.42,
  wristZ: -0.125,
  /** Half width of the arm → hand blend around the wrist (linear blend of the two joint transforms). */
  wristBlend: 0.07,
  /** Span position where the fingers leave the hand. */
  fingerS: 0.66,
} as const;

/** Leading / trailing edge z of the arm and hand panel at span stations. */
const PLANFORM: readonly (readonly [s: number, le: number, te: number])[] = [
  [0, -0.1, 0.24],
  [0.1, -0.113, 0.278],
  [0.2, -0.118, 0.287],
  [0.3, -0.121, 0.286],
  [0.42, -0.125, 0.272],
  [0.54, -0.116, 0.238],
  [0.66, -0.1, 0.19],
];
const CHORD_STEPS = [0, 0.22, 0.45, 0.62, 0.8, 1];

/** Primaries from the leading edge back: fan angle (rad, + swept back), length (m), base width (m). */
export const FINGERS: readonly (readonly [angle: number, length: number, width: number])[] = [
  [-0.12, 0.2, 0.036],
  [0.0, 0.255, 0.044],
  [0.11, 0.275, 0.046],
  [0.22, 0.265, 0.046],
  [0.34, 0.225, 0.044],
  [0.47, 0.17, 0.042],
];
/** Fan angle the fingers close toward when the hand is swept back. */
export const FINGER_MID = 0.16;

export interface StorkMesh {
  /** Rest positions, 3 per vertex. */
  position: Float32Array;
  /** Rest normals, 3 per vertex. */
  normal: Float32Array;
  /** (side -1/0/1, span s, region, chord fraction 0 leading → 1 trailing). */
  wing: Float32Array;
  /** Fingers: (fan angle, base s, base z, distance along the finger m); zero elsewhere. */
  finger: Float32Array;
  index: Uint16Array;
  vertexCount: number;
  triangleCount: number;
}

class Builder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly wing: number[] = [];
  readonly finger: number[] = [];
  readonly idx: number[] = [];

  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, side: number, s: number, region: number, c: number, f?: readonly [number, number, number, number]): number {
    this.pos.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    this.nrm.push(nx / l, ny / l, nz / l);
    this.wing.push(side, s, region, c);
    this.finger.push(...(f ?? [0, 0, 0, 0]));
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  build(): StorkMesh {
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nrm),
      wing: new Float32Array(this.wing),
      finger: new Float32Array(this.finger),
      index: new Uint16Array(this.idx),
      vertexCount: this.pos.length / 3,
      triangleCount: this.idx.length / 3,
    };
  }
}

/** Body section: z, half width, half height, centre y, region. */
type Ring = readonly [z: number, rx: number, ry: number, yc: number, region: number];

const BODY_RINGS: readonly Ring[] = [
  // bill (red), drooping slightly with the head
  [-0.6, 0.009, 0.011, -0.05, REGION.bill],
  [-0.555, 0.012, 0.016, -0.045, REGION.bill],
  [-0.515, 0.015, 0.02, -0.04, REGION.bill],
  // head
  [-0.505, 0.022, 0.026, -0.037, REGION.head],
  [-0.475, 0.03, 0.034, -0.033, REGION.head],
  [-0.44, 0.031, 0.034, -0.031, REGION.head],
  // long neck, held out and a little low
  [-0.4, 0.024, 0.027, -0.03, REGION.head],
  [-0.33, 0.026, 0.03, -0.025, REGION.head],
  [-0.25, 0.033, 0.038, -0.016, REGION.head],
  [-0.17, 0.048, 0.056, -0.007, REGION.body],
  [-0.09, 0.07, 0.078, 0, REGION.body],
  [0.0, 0.086, 0.088, 0.002, REGION.body],
  [0.09, 0.083, 0.082, 0.003, REGION.body],
  [0.18, 0.067, 0.063, 0.007, REGION.body],
  [0.26, 0.044, 0.037, 0.011, REGION.tail],
  [0.31, 0.028, 0.017, 0.014, REGION.tail],
];
const BILL_TIP: readonly [number, number, number] = [-0.69, -0.056, 0];

function addBody(b: Builder, segments: number, rings: readonly Ring[]): void {
  const ringIdx: number[][] = [];
  for (const [z, rx, ry, yc, region] of rings) {
    const r: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // Slightly flat belly: the lower half is a little narrower.
      const k = s < 0 ? 0.92 : 1;
      r.push(b.v(c * rx * k, yc + s * ry, z, c / rx, s / ry, 0, 0, 0, region, 0));
    }
    ringIdx.push(r);
  }
  const tip = b.v(BILL_TIP[2], BILL_TIP[1], BILL_TIP[0], 0, -0.3, -1, 0, 0, REGION.bill, 0);
  const first = ringIdx[0];
  for (let i = 0; i < segments; i++) {
    b.tri(tip, first[(i + 1) % segments], first[i]);
  }
  for (let k = 0; k < ringIdx.length - 1; k++) {
    const a = ringIdx[k];
    const c = ringIdx[k + 1];
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      b.tri(a[i], a[j], c[j]);
      b.tri(a[i], c[j], c[i]);
    }
  }
  const last = ringIdx[ringIdx.length - 1];
  const lz = rings[rings.length - 1][0];
  const end = b.v(0, rings[rings.length - 1][3], lz + 0.03, 0, 0, 1, 0, 0, REGION.tail, 0);
  for (let i = 0; i < segments; i++) {
    b.tri(last[i], last[(i + 1) % segments], end);
  }
}

/** Short white tail, a rounded fan (flat, drawn from both sides). */
function addTail(b: Builder, detail: boolean): void {
  const y = 0.013;
  const root = b.v(0, y, 0.22, 0, 1, 0, 0, 0, REGION.tail, 0);
  const pts: number[] = [];
  const n = detail ? 7 : 3;
  for (let i = 0; i < n; i++) {
    const a = -0.95 + (1.9 * i) / (n - 1);
    const r = 0.235 - 0.02 * Math.abs(a);
    pts.push(b.v(Math.sin(a) * r * 0.48, y, 0.22 + Math.cos(a) * r, 0, 1, 0, 0, 0, REGION.tail, 0));
  }
  for (let i = 0; i < n - 1; i++) {
    b.tri(root, pts[i + 1], pts[i]);
  }
}

/** Red legs trailing under and past the tail, toes slightly spread. */
function addLegs(b: Builder, detail: boolean): void {
  const path: readonly (readonly [number, number, number, number])[] = detail
    ? [
        [0.1, -0.058, 0.0085, 0],
        [0.3, -0.045, 0.0075, 0],
        [0.52, -0.028, 0.0062, 0],
        [0.6, -0.022, 0.0058, 1],
        [0.665, -0.02, 0.003, 1],
      ]
    : [
        [0.1, -0.058, 0.012, 0],
        [0.64, -0.022, 0.008, 1],
      ];
  const sides = detail ? 4 : 3;
  for (const sx of [-1, 1]) {
    const rings: number[][] = [];
    for (const [z, y, r, toe] of path) {
      const ring: number[] = [];
      const x = sx * (0.024 - 0.006 * (z - 0.1)) + sx * toe * 0.006;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 + 0.3;
        const w = toe ? 1.6 : 1;
        ring.push(b.v(x + Math.cos(a) * r * w, y + Math.sin(a) * r, z, Math.cos(a), Math.sin(a), 0, 0, 0, REGION.legs, 0));
      }
      rings.push(ring);
    }
    for (let k = 0; k < rings.length - 1; k++) {
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        b.quad(rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]);
      }
    }
  }
}

function planform(s: number): [number, number] {
  for (let i = 1; i < PLANFORM.length; i++) {
    const [s1, le1, te1] = PLANFORM[i];
    const [s0, le0, te0] = PLANFORM[i - 1];
    if (s <= s1 + 1e-9) {
      const k = (s - s0) / (s1 - s0);
      return [le0 + (le1 - le0) * k, te0 + (te1 - te0) * k];
    }
  }
  const last = PLANFORM[PLANFORM.length - 1];
  return [last[1], last[2]];
}

/** Slight airfoil camber of the panel (thicker leading third, thinning toward the hand). */
function camber(s: number, c: number): number {
  return 0.02 * Math.sin(Math.PI * Math.pow(c, 0.8)) * (1 - 0.65 * Math.min(1, s / WING.fingerS));
}

function addWings(b: Builder, detail: boolean): void {
  const spans = detail ? [0, 0.1, 0.2, 0.3, 0.37, 0.42, 0.47, 0.54, 0.6, 0.66] : [0, 0.42, 0.66];
  const chords = detail ? CHORD_STEPS : [0, 0.5, 1];
  for (const side of [-1, 1]) {
    const grid: number[][] = [];
    for (const s of spans) {
      const [le, te] = planform(s);
      const row: number[] = [];
      for (const c of chords) {
        const z = le + (te - le) * c;
        const region = s > WING.wristS + 1e-6 ? REGION.hand : REGION.arm;
        row.push(b.v(side * (WING.shoulderX + s), camber(s, c), z, 0, 1, 0, side, s, region, c));
      }
      grid.push(row);
    }
    for (let i = 0; i < spans.length - 1; i++) {
      for (let j = 0; j < chords.length - 1; j++) {
        const a = grid[i][j];
        const bb = grid[i + 1][j];
        const c = grid[i + 1][j + 1];
        const d = grid[i][j + 1];
        if (side > 0) {
          b.quad(a, d, c, bb);
        } else {
          b.quad(a, bb, c, d);
        }
      }
    }
    // Fingers: separated primaries leaving the hand's outer edge, fanned (soaring rest pose), tapering to rounded tips.
    const [le, te] = planform(WING.fingerS);
    const n = FINGERS.length;
    const steps = detail ? [0, 0.3, 0.62, 0.86, 1] : [0, 1];
    FINGERS.forEach(([angle, length, width], k) => {
      if (!detail && k % 2 === 1) {
        return;
      }
      const baseZ = le + 0.012 + ((te - le - 0.03) * (k + 0.5)) / n;
      const w0 = detail ? width : width * 1.8;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const rows: [number, number][] = [];
      for (const t of steps) {
        const d = t * length;
        // Emarginated primary: a narrower outer vane, a rounded tip.
        const w = w0 * (t < 0.86 ? 1 - 0.3 * t : (1 - 0.3 * 0.86) * Math.sqrt(Math.max(0, (1 - t) / 0.14)) * 0.9 + 0.08);
        const cs = WING.fingerS + d * ca;
        const cz = baseZ + d * sa;
        const f: [number, number, number, number] = [angle, WING.fingerS, baseZ, d];
        const p0 = b.v(side * (WING.shoulderX + cs + sa * w * 0.5), 0.004, cz - ca * w * 0.5, 0, 1, 0, side, cs, REGION.finger, 0.5 - 0.5 * t, f);
        const p1 = b.v(side * (WING.shoulderX + cs - sa * w * 0.5), 0.004, cz + ca * w * 0.5, 0, 1, 0, side, cs, REGION.finger, 0.5 + 0.5 * t, f);
        rows.push([p0, p1]);
      }
      for (let i = 0; i < rows.length - 1; i++) {
        const [a, d] = rows[i];
        const [bb, c] = rows[i + 1];
        if (side > 0) {
          b.quad(a, d, c, bb);
        } else {
          b.quad(a, bb, c, d);
        }
      }
    });
  }
}

/** Near LOD (~560 triangles) or far LOD (~110 triangles; three fingers per hand, a simple body). */
export function buildStorkMesh(lod: 'near' | 'far'): StorkMesh {
  const b = new Builder();
  const detail = lod === 'near';
  const rings: readonly Ring[] = detail ? BODY_RINGS : BODY_RINGS.filter((_, i) => i % 3 === 0 || i === BODY_RINGS.length - 1 || i === 11);
  addBody(b, detail ? 8 : 5, rings);
  addTail(b, detail);
  addLegs(b, detail);
  addWings(b, detail);
  return b.build();
}

/* ------------------------------------------------------------------ */
/* Pose (mirrors the vertex shader)                                    */
/* ------------------------------------------------------------------ */

/** Per-instance pose: flap phase (rad), flap amplitude 0..1, glide flex 0 (soaring) .. 1 (gliding), tint 0..1. */
export interface StorkPose {
  phase: number;
  amp: number;
  flex: number;
  tint: number;
}

/** Joint angles from a pose (same formulas as the GLSL in stork-material.ts). */
export interface StorkJoints {
  /** Shoulder dihedral (rad, + wings up). */
  th1: number;
  /** Extra wrist dihedral of the hand. */
  th2: number;
  /** In-plane sweep of the arm and (added) of the hand (rad, + tips back). */
  sweepArm: number;
  sweepHand: number;
  /** Finger fan 1 = fully spread (soaring) .. 0 closed. */
  spread: number;
  /** Upward bend of the finger tips (load). */
  curl: number;
  /** Body bob (m). */
  bob: number;
}

export function storkJoints(p: StorkPose, time: number, out: StorkJoints): StorkJoints {
  const sn = Math.sin(p.phase);
  const up = 0.5 - 0.5 * sn;
  const idle = 1 - p.amp;
  out.th1 = mix(0.075, 0.02, p.flex) + p.amp * 0.62 * sn + 0.022 * idle * Math.sin(time * 1.7 + p.tint * 37);
  out.th2 = mix(-0.02, -0.13, p.flex) + p.amp * 0.36 * Math.sin(p.phase - 0.75);
  out.sweepArm = 0.1 * p.flex + p.amp * 0.12 * up;
  out.sweepHand = 0.4 * p.flex + p.amp * 0.32 * up;
  out.spread = 1 - 0.72 * Math.max(p.flex, p.amp * 0.55 * up);
  out.curl = mix(1, 0.35, p.flex) + p.amp * 0.7 * sn + 0.14 * Math.sin(time * 2.3 + p.tint * 53);
  out.bob = -0.035 * p.amp * Math.sin(p.phase + 1.2);
  return out;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Posed position and normal of vertex `i` (body-local, before the instance matrix) into outP / outN (3 each).
 * Mirrors VERTEX_BEGIN / VERTEX_NORMAL of the stork material.
 */
export function deformStorkVertex(m: StorkMesh, i: number, j: StorkJoints, outP: number[], outN: number[]): void {
  let x = m.position[i * 3];
  let y = m.position[i * 3 + 1];
  let z = m.position[i * 3 + 2];
  let nx = m.normal[i * 3];
  let ny = m.normal[i * 3 + 1];
  let nz = m.normal[i * 3 + 2];
  const side = m.wing[i * 4];
  const s0 = m.wing[i * 4 + 1];
  const region = Math.round(m.wing[i * 4 + 2]);
  if (region >= REGION.arm) {
    let s = s0;
    let zr = z;
    let yr = y;
    if (region === REGION.finger) {
      const angle = m.finger[i * 4];
      const bs = m.finger[i * 4 + 1];
      const bz = m.finger[i * 4 + 2];
      const d = m.finger[i * 4 + 3];
      const delta = -(1 - j.spread) * (angle - FINGER_MID);
      const du = s - bs;
      const dz = zr - bz;
      const c = Math.cos(delta);
      const sd = Math.sin(delta);
      s = bs + du * c - dz * sd;
      zr = bz + du * sd + dz * c;
      yr += j.curl * d * d * 0.85;
    }
    // Arm transform (about the shoulder).
    const ca = Math.cos(j.sweepArm);
    const sa = Math.sin(j.sweepArm);
    const au = s * ca - (zr - WING.shoulderZ) * sa;
    const az = s * sa + (zr - WING.shoulderZ) * ca;
    const c1 = Math.cos(j.th1);
    const s1 = Math.sin(j.th1);
    const ax = WING.shoulderX + au * c1 - yr * s1;
    const ay = au * s1 + yr * c1;
    const azz = WING.shoulderZ + az;
    // Hand transform (about the wrist, carried by the arm).
    const wu = WING.wristS * ca - (WING.wristZ - WING.shoulderZ) * sa;
    const wz = WING.wristS * sa + (WING.wristZ - WING.shoulderZ) * ca;
    const wx = WING.shoulderX + wu * c1;
    const wy = wu * s1;
    const sh = j.sweepArm + j.sweepHand;
    const ch = Math.cos(sh);
    const shs = Math.sin(sh);
    const hu = (s - WING.wristS) * ch - (zr - WING.wristZ) * shs;
    const hz = (s - WING.wristS) * shs + (zr - WING.wristZ) * ch;
    const t2 = j.th1 + j.th2;
    const c2 = Math.cos(t2);
    const s2 = Math.sin(t2);
    const hx = wx + hu * c2 - yr * s2;
    const hy = wy + hu * s2 + yr * c2;
    const hzz = WING.shoulderZ + wz + hz;
    const w = smooth(WING.wristS - WING.wristBlend, WING.wristS + WING.wristBlend, s0);
    x = side * mix(ax, hx, w);
    y = mix(ay, hy, w);
    z = mix(azz, hzz, w);
    const a = mix(j.th1, t2, w);
    nx = -side * Math.sin(a);
    ny = Math.cos(a);
    nz = 0;
  }
  if (region === REGION.head || region === REGION.bill) {
    y -= j.bob * 0.5;
  }
  y += j.bob;
  outP[0] = x;
  outP[1] = y;
  outP[2] = z;
  outN[0] = nx;
  outN[1] = ny;
  outN[2] = nz;
}

/* ------------------------------------------------------------------ */
/* Plumage (mirrors the fragment shader)                                */
/* ------------------------------------------------------------------ */

/** Where the black flight feathers start on the arm (chord fraction), with a feathered, jagged covert edge. */
export function secondaryEdge(s: number): number {
  const saw = (s * 26) % 1;
  return 0.47 + 0.05 * saw + 0.04 * Math.min(1, s / 0.42);
}

/**
 * Linear albedo of a stork surface point: region, span s, chord fraction c, instance tint 0..1 (< 0.3 juvenile),
 * upper side or underside. Mirrors FRAGMENT_COLOR.
 */
export function storkColor(region: number, s: number, c: number, tint: number, top: boolean): [number, number, number] {
  const juvenile = tint < 0.3;
  const v = 0.94 + 0.12 * ((tint * 7.31) % 1);
  const white: [number, number, number] = juvenile ? [0.68 * v, 0.66 * v, 0.62 * v] : [0.76 * v, 0.75 * v, 0.71 * v];
  const black: [number, number, number] = juvenile ? [0.05, 0.04, 0.034] : [0.022, 0.022, 0.026];
  const bill: [number, number, number] = juvenile ? [0.26, 0.07, 0.04] : [0.62, 0.07, 0.035];
  const legs: [number, number, number] = juvenile ? [0.42, 0.18, 0.11] : [0.66, 0.13, 0.06];
  switch (region) {
    case REGION.bill:
      return bill;
    case REGION.legs:
      return legs;
    case REGION.arm: {
      const edge = secondaryEdge(s);
      // Upper side: the greater coverts are greyish black too, so the black reaches a little further forward.
      const e = top ? edge - 0.06 : edge;
      return c > e ? black : white;
    }
    case REGION.hand:
    case REGION.finger:
      return black;
    default:
      return white;
  }
}
