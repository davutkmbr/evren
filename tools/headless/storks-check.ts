/**
 * Headless check of the stork migration flock (src/moments/storks): the model, the flock simulation and the per-frame
 * budget. No browser, no GPU.
 *
 *   npx tsx tools/headless/storks-check.ts
 *
 * 1. Model: real size (wingspan ~2 m, bill to tail ~1.1 m, legs trailing past the tail), LOD triangle budgets, the
 *    pose mirror (wings up at the top of the stroke, fingers fanned when soaring and closed when gliding) and the
 *    instance matrix against three.js.
 * 2. Kettle: all birds turn the same way around the axis with a plausible period, climb 1–3 m/s, bank into the turn,
 *    hardly flap; they leave from the top into a stream along the course that sinks with a glide ratio of ~8–16.
 * 3. Spacing: no two storks ever closer than the minimum distance (no intersections), no NaNs.
 * 4. The dragon: flying through the kettle, hovering in it and chasing: no stork inside the exclusion radius, birds
 *    within ~60 m spread away, and calm down and return to their circles afterwards.
 * 5. dt robustness: 144 / 60 / 24 / 10 / 4 fps and jittery frames give the same flock (heights, kettle count).
 * 6. Budget: 400 birds, simulation + instance buffers ≤ 0.3 ms per frame (median).
 *
 * Exits non-zero on any failure.
 */
import * as THREE from 'three';
import { STORK, StorkFlockSim, StorkState, type DragonProbe, type StorkFlockOptions } from '../../src/moments/storks/flock-sim';
import { fillStorkInstances, writeMatrix, type StorkInstanceStats, type StorkInstanceTarget } from '../../src/moments/storks/stork-instances';
import { buildStorkMesh, deformStorkVertex, REGION, storkColor, storkJoints, type StorkJoints, type StorkMesh, type StorkPose } from '../../src/moments/storks/stork-model';

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.log(`  FAIL ${msg}`);
  } else if (process.env.VERBOSE) {
    console.log(`  ok   ${msg}`);
  }
}
const f1 = (x: number): string => x.toFixed(1);
const f2 = (x: number): string => x.toFixed(2);

const BASE: StorkFlockOptions = { count: 400, seed: 7, x: 0, z: 0, baseY: 380, topY: 680, courseX: -0.45, courseZ: 0.89, turn: 1 };
const WIND = { x: 2.5, z: 1.5 };

function makeSim(over: Partial<StorkFlockOptions> = {}): StorkFlockSim {
  const s = new StorkFlockSim({ ...BASE, ...over });
  s.windX = WIND.x;
  s.windZ = WIND.z;
  s.updraft = 3.0;
  return s;
}

function finiteSim(s: StorkFlockSim): boolean {
  for (let i = 0; i < s.count; i++) {
    if (!Number.isFinite(s.px[i] + s.py[i] + s.pz[i] + s.vx[i] + s.vy[i] + s.vz[i] + s.phase[i] + s.amp[i] + s.flex[i] + s.bank[i])) return false;
  }
  return true;
}

function minPairDistance(s: StorkFlockSim): number {
  let m = Infinity;
  for (let i = 0; i < s.count; i++) {
    for (let j = i + 1; j < s.count; j++) {
      const dx = s.px[i] - s.px[j];
      const dy = s.py[i] - s.py[j];
      const dz = s.pz[i] - s.pz[j];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < m) m = d2;
    }
  }
  return Math.sqrt(m);
}

/* ------------------------------------------------------------------ */
/* 1. Model                                                             */
/* ------------------------------------------------------------------ */
console.log('storks-check');
console.log('1. model');
{
  const near = buildStorkMesh('near');
  const far = buildStorkMesh('far');
  check(near.triangleCount >= 350 && near.triangleCount <= 800, `near LOD ${near.triangleCount} triangles (350–800)`);
  check(far.triangleCount >= 50 && far.triangleCount <= 160, `far LOD ${far.triangleCount} triangles (50–160)`);
  const j: StorkJoints = { th1: 0, th2: 0, sweepArm: 0, sweepHand: 0, spread: 0, curl: 0, bob: 0 };
  const P = [0, 0, 0];
  const N = [0, 0, 0];
  const bounds = (m: StorkMesh, pose: StorkPose, filter?: (region: number) => boolean) => {
    storkJoints(pose, 0, j);
    const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (let i = 0; i < m.vertexCount; i++) {
      if (filter && !filter(Math.round(m.wing[i * 4 + 2]))) continue;
      deformStorkVertex(m, i, j, P, N);
      if (!Number.isFinite(P[0] + P[1] + P[2] + N[0] + N[1] + N[2])) b.minX = NaN;
      b.minX = Math.min(b.minX, P[0]);
      b.maxX = Math.max(b.maxX, P[0]);
      b.minY = Math.min(b.minY, P[1]);
      b.maxY = Math.max(b.maxY, P[1]);
      b.minZ = Math.min(b.minZ, P[2]);
      b.maxZ = Math.max(b.maxZ, P[2]);
    }
    return b;
  };
  const soar: StorkPose = { phase: 0, amp: 0, flex: 0, tint: 0.6 };
  const glide: StorkPose = { phase: 0, amp: 0, flex: 1, tint: 0.6 };
  const b = bounds(near, soar);
  const span = b.maxX - b.minX;
  check(Number.isFinite(b.minX), 'posed vertices are finite');
  check(span > 1.9 && span < 2.15, `wingspan soaring ${f2(span)} m (1.9–2.15; Ciconia ciconia 1.95–2.15 m)`);
  const body = bounds(near, soar, (r) => r <= REGION.tail && r !== REGION.legs);
  check(body.maxZ - body.minZ > 0.95 && body.maxZ - body.minZ < 1.2, `bill tip to tail ${f2(body.maxZ - body.minZ)} m (0.95–1.2)`);
  const bill = bounds(near, soar, (r) => r === REGION.bill);
  check(bill.maxZ - bill.minZ > 0.15 && bill.maxZ - bill.minZ < 0.24, `bill length ${f2(bill.maxZ - bill.minZ)} m (long red bill 0.15–0.24)`);
  const legs = bounds(near, soar, (r) => r === REGION.legs);
  const tail = bounds(near, soar, (r) => r === REGION.tail);
  check(legs.maxZ > tail.maxZ + 0.1, `legs trail ${f2(legs.maxZ - tail.maxZ)} m past the tail`);
  check(bill.minZ < -0.6, 'neck extended: the bill tip is > 0.6 m ahead of the body centre');
  const g = bounds(near, glide);
  check(g.maxX - g.minX < span - 0.1, `gliding sweeps the hands back (span ${f2(g.maxX - g.minX)} m < soaring ${f2(span)} m)`);
  const topStroke = bounds(near, { phase: Math.PI / 2, amp: 1, flex: 0.3, tint: 0.6 }, (r) => r >= REGION.arm);
  const bottom = bounds(near, { phase: -Math.PI / 2, amp: 1, flex: 0.3, tint: 0.6 }, (r) => r >= REGION.arm);
  check(topStroke.maxY > 0.5 && bottom.minY < -0.35, `flap: tips up ${f2(topStroke.maxY)} m at the top, down ${f2(bottom.minY)} m at the bottom of the stroke`);
  // Fingers: fanned when soaring (tip spread along z), bunched when gliding.
  const fingerSpread = (pose: StorkPose) => {
    // Fan angle of the right hand's fingers: direction base → tip of each finger in the wing plane (x/z).
    storkJoints(pose, 0, j);
    const base = new Map<number, number[]>();
    const tip = new Map<number, number[]>();
    for (let i = 0; i < near.vertexCount; i++) {
      if (Math.round(near.wing[i * 4 + 2]) !== REGION.finger || near.wing[i * 4] < 0) continue;
      const key = near.finger[i * 4];
      const d = near.finger[i * 4 + 3];
      deformStorkVertex(near, i, j, P, N);
      if (d === 0) base.set(key, [...P]);
      if (!tip.has(key) || d >= (tip.get(key)![3] ?? 0)) tip.set(key, [P[0], P[1], P[2], d]);
    }
    const angles = [...base.keys()].map((k) => Math.atan2(tip.get(k)![2] - base.get(k)![2], tip.get(k)![0] - base.get(k)![0]));
    return Math.max(...angles) - Math.min(...angles);
  };
  check(fingerSpread(soar) > 0.45 && fingerSpread(glide) < fingerSpread(soar) * 0.5, `fingers fanned when soaring (${f2(fingerSpread(soar))} rad) and closed when gliding (${f2(fingerSpread(glide))} rad)`);
  // Plumage: white body, black flight feathers, red bill and legs.
  const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  check(lum(storkColor(REGION.body, 0, 0, 0.6, true)) > 0.6, 'adult body is white');
  check(lum(storkColor(REGION.arm, 0.2, 0.9, 0.6, false)) < 0.05 && lum(storkColor(REGION.arm, 0.2, 0.2, 0.6, false)) > 0.6, 'underwing: white coverts, black secondaries');
  check(lum(storkColor(REGION.finger, 0.8, 0.5, 0.6, true)) < 0.05, 'primaries are black');
  const red = storkColor(REGION.bill, 0, 0, 0.6, true);
  check(red[0] > 4 * red[1] && red[0] > 0.4, 'adult bill is red');
  const juv = storkColor(REGION.bill, 0, 0, 0.1, true);
  check(juv[0] < red[0] * 0.6, 'juvenile bill is darker');
  // Instance matrix vs three.js compose with an 'YXZ' Euler.
  const m = new Float32Array(16);
  writeMatrix(m, 0, 3, 4, 5, 0.7, -0.2, 0.4, 1.05);
  const ref = new THREE.Matrix4().compose(new THREE.Vector3(3, 4, 5), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.7, 0.4, 'YXZ')), new THREE.Vector3(1.05, 1.05, 1.05));
  check(ref.elements.every((v, i) => Math.abs(v - m[i]) < 1e-5), 'instance matrix matches three.js compose (Euler YXZ)');
}

/* ------------------------------------------------------------------ */
/* 2–3. Kettle, stream, spacing                                          */
/* ------------------------------------------------------------------ */
console.log('2. kettle and stream');
const DT = 1 / 24;
{
  const s = makeSim();
  check(s.count === 400 && s.kettleCount === 400, 'spawns 400 storks, all circling');
  check(minPairDistance(s) >= STORK.minSep, `spawn has no overlaps (min ${f2(minPairDistance(s))} m)`);
  let minPair = Infinity;
  let finite = true;
  const axis = { x: 0, z: 0 };
  let angSum = 0;
  let angN = 0;
  let angSameSense = 0;
  let climbSum = 0;
  let climbN = 0;
  let bankInto = 0;
  let bankN = 0;
  let flapSum = 0;
  let flapN = 0;
  let glideH = 0;
  let glideV = 0;
  let glideAlong = 0;
  let glideN = 0;
  let ampHigh = 0;
  const prevAng = new Float32Array(s.count);
  for (let i = 0; i < s.count; i++) {
    s.axisAt(s.py[i], axis);
    prevAng[i] = Math.atan2(s.pz[i] - axis.z, s.px[i] - axis.x);
  }
  const firstLeave: number[] = [];
  for (let f = 0; f < 240 * 24; f++) {
    const before = s.kettleCount;
    s.update(DT, null);
    if (s.kettleCount < before && firstLeave.length === 0) firstLeave.push(s.time);
    for (let i = 0; i < s.count; i++) {
      if (s.amp[i] > 0.3) ampHigh++;
      if (s.state[i] === StorkState.Kettle) {
        s.axisAt(s.py[i], axis);
        const a = Math.atan2(s.pz[i] - axis.z, s.px[i] - axis.x);
        let da = a - prevAng[i];
        if (da > Math.PI) da -= 2 * Math.PI;
        if (da < -Math.PI) da += 2 * Math.PI;
        prevAng[i] = a;
        if (f > 48 && s.alarm[i] === 0 && s.py[i] < s.topY - 30 && s.py[i] > s.baseY + 15) {
          angSum += da / DT;
          angN++;
          if (Math.sign(da) === s.turn) angSameSense++;
          climbSum += s.vy[i];
          climbN++;
          // Bank into the turn: turn = 1 turns right (roll right = negative Euler z).
          bankN++;
          if (-s.bank[i] * s.turn > 0.1) bankInto++;
          flapSum += s.amp[i];
          flapN++;
        }
      } else if (s.alarm[i] === 0 && s.amp[i] < 0.05) {
        const hx = s.vx[i] - s.windX;
        const hz = s.vz[i] - s.windZ;
        const hs = Math.hypot(hx, hz);
        glideH += hs;
        glideV += s.vy[i];
        glideAlong += (hx * s.courseX + hz * s.courseZ) / (hs || 1);
        glideN++;
      }
    }
    if (f % 24 === 0) {
      minPair = Math.min(minPair, minPairDistance(s));
      finite &&= finiteSim(s);
    }
  }
  const omega = angSum / Math.max(1, angN);
  const period = (2 * Math.PI) / Math.abs(omega);
  check(angSameSense / angN > 0.97, `kettle turns one way (${f1((100 * angSameSense) / angN)} % of samples)`);
  check(period > 12 && period < 60, `kettle rotation period ${f1(period)} s (12–60 s: ${STORK.soarSpeed} m/s on ${STORK.orbitMin}–${STORK.orbitMax} m circles)`);
  const climb = climbSum / Math.max(1, climbN);
  check(climb >= 1 && climb <= 3, `kettle climb ${f2(climb)} m/s (1–3)`);
  check(bankInto / bankN > 0.9, `circling storks bank into the turn (${f1((100 * bankInto) / bankN)} %)`);
  check(flapSum / flapN < 0.08, `soaring storks hardly flap (mean amplitude ${f2(flapSum / flapN)})`);
  check(firstLeave.length === 1 && firstLeave[0] < 30, `the first storks leave the top within 30 s (${f1(firstLeave[0] ?? NaN)} s)`);
  check(s.kettleCount < 40, `after 4 minutes the kettle has emptied into the stream (${s.kettleCount} left)`);
  const gh = glideH / Math.max(1, glideN);
  const gv = glideV / Math.max(1, glideN);
  const ratio = gh / -gv;
  check(glideN > 1000, `glide samples (${glideN})`);
  check(gv < -0.8 && gv > -1.8, `stream sinks ${f2(-gv)} m/s`);
  check(ratio > 8 && ratio < 16, `glide ratio in the stream ${f1(ratio)} (8–16)`);
  check(glideAlong / glideN > 0.94, `stream heads along the course (mean cos ${f2(glideAlong / glideN)})`);
  const flapShare = ampHigh / (240 * 24 * s.count);
  check(flapShare < 0.05, `flapping is occasional: ${f2(100 * flapShare)} % of bird-frames`);
  check(finite, 'no NaNs in 4 minutes');
  check(minPair >= STORK.minSep - 0.05, `no intersections: min distance ${f2(minPair)} m (≥ ${STORK.minSep})`);
  // The stream drifts with the wind: its ground track is the course plus the wind.
  let cx = 0;
  let cz = 0;
  let cn = 0;
  for (let i = 0; i < s.count; i++) {
    if (s.state[i] === StorkState.Glide) {
      cx += s.px[i];
      cz += s.pz[i];
      cn++;
    }
  }
  check(cn > 0 && (cx / cn) * s.courseX + (cz / cn) * s.courseZ > 800, `the stream has glided ${f1(((cx / cn) * s.courseX + (cz / cn) * s.courseZ) / 1000)} km along the course`);
}

/* ------------------------------------------------------------------ */
/* 4. The dragon                                                         */
/* ------------------------------------------------------------------ */
console.log('3. dragon avoidance');
{
  const scenarios: { name: string; path: (t: number, d: DragonProbe) => void; seconds: number }[] = [
    {
      name: 'fly through the kettle at 30 m/s',
      seconds: 30,
      path: (t, d) => {
        d.x = -450 + 30 * t;
        d.y = 480;
        d.z = 10;
        d.vx = 30;
        d.vy = 0;
        d.vz = 0;
      },
    },
    {
      name: 'dive through at 55 m/s',
      seconds: 16,
      path: (t, d) => {
        d.x = -300 + 45 * t;
        d.y = 700 - 30 * t;
        d.z = -20;
        d.vx = 45;
        d.vy = -30;
        d.vz = 0;
      },
    },
    {
      name: 'circle inside the kettle (joining the thermal)',
      seconds: 60,
      path: (t, d) => {
        const a = t * 0.25;
        d.x = Math.cos(a) * 45 + WIND.x * 0.85 * t;
        d.z = Math.sin(a) * 45 + WIND.z * 0.85 * t;
        d.y = 420 + 2 * t;
        d.vx = -Math.sin(a) * 11 + WIND.x * 0.85;
        d.vz = Math.cos(a) * 11 + WIND.z * 0.85;
        d.vy = 2;
      },
    },
    {
      name: 'hover in the middle',
      seconds: 25,
      path: (t, d) => {
        d.x = WIND.x * 0.85 * t;
        d.z = WIND.z * 0.85 * t;
        d.y = 520;
        d.vx = 0;
        d.vy = 0;
        d.vz = 0;
      },
    },
  ];
  for (const sc of scenarios) {
    const s = makeSim();
    const d: DragonProbe = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    let minD = Infinity;
    let spread = 0;
    let within = 0;
    let hard = 0;
    const steps = sc.seconds * 24;
    let prevNear = 0;
    for (let f = 0; f < steps; f++) {
      sc.path(f * DT, d);
      s.update(DT, d);
      let near = 0;
      for (let i = 0; i < s.count; i++) {
        const dd = Math.hypot(s.px[i] - d.x, s.py[i] - d.y, s.pz[i] - d.z);
        minD = Math.min(minD, dd);
        if (dd < STORK.dragonHard + 0.5) hard++;
        if (dd < STORK.avoidRadius * 0.5) near++;
        if (dd < STORK.avoidRadius * 0.66) {
          within++;
          // Moving away from the dragon (relative velocity outward) or already alarmed.
          const rv = ((s.vx[i] - d.vx) * (s.px[i] - d.x) + (s.vy[i] - d.vy) * (s.py[i] - d.y) + (s.vz[i] - d.vz) * (s.pz[i] - d.z)) / (dd || 1);
          if (rv > 0 || s.alarm[i] > 0.3) spread++;
        }
      }
      prevNear = near;
    }
    check(minD >= STORK.dragonHard - 0.01, `${sc.name}: closest stork ${f1(minD)} m (≥ ${STORK.dragonHard} m, never a collision)`);
    check(within === 0 || spread / within > 0.85, `${sc.name}: storks within ${f1(STORK.avoidRadius * 0.66)} m spread away (${f1((100 * spread) / Math.max(1, within))} %)`);
    void prevNear;
    check(hard <= Math.max(3, within * 0.02), `${sc.name}: the soft dodge does the work (${hard} bird-frames at the hard limit of ${within} close ones)`);
    // Calm down: the dragon leaves; 25 s later nobody is alarmed and the kettle keeps turning.
    const kettleBefore = s.kettleCount;
    for (let f = 0; f < 25 * 24; f++) s.update(DT, null);
    let alarmed = 0;
    for (let i = 0; i < s.count; i++) if (s.alarm[i] > 0.05) alarmed++;
    check(alarmed === 0, `${sc.name}: calm again 25 s after the dragon left (${alarmed} still alarmed)`);
    check(finiteSim(s) && minPairDistance(s) >= STORK.minSep - 0.05, `${sc.name}: no NaNs, no intersections`);
    check(kettleBefore === 0 || s.kettleCount > 0 || s.time > 150, `${sc.name}: the kettle survives the visit`);
  }
  // Calm-down detail: after a pass, kettle birds return to their circles (radial error back to the undisturbed level).
  {
    const ref = makeSim();
    const s = makeSim();
    const d: DragonProbe = { x: 0, y: 500, z: 0, vx: 0, vy: 0, vz: 0 };
    for (let f = 0; f < 10 * 24; f++) {
      d.x = WIND.x * 0.85 * f * DT;
      d.z = WIND.z * 0.85 * f * DT;
      s.update(DT, d);
      ref.update(DT, null);
    }
    for (let f = 0; f < 30 * 24; f++) {
      s.update(DT, null);
      ref.update(DT, null);
    }
    const radialErr = (x: StorkFlockSim): number => {
      const axis = { x: 0, z: 0 };
      let e = 0;
      let n = 0;
      for (let i = 0; i < x.count; i++) {
        if (x.state[i] !== StorkState.Kettle) continue;
        x.axisAt(x.py[i], axis);
        const r = Math.hypot(x.px[i] - axis.x, x.pz[i] - axis.z);
        e += Math.max(0, r - STORK.orbitMax);
        n++;
      }
      return e / Math.max(1, n);
    };
    check(radialErr(s) < radialErr(ref) + 3, `back in the column 30 s after a hover (outside-rim error ${f1(radialErr(s))} m vs ${f1(radialErr(ref))} m undisturbed)`);
  }
}

/* ------------------------------------------------------------------ */
/* 5. dt robustness                                                      */
/* ------------------------------------------------------------------ */
console.log('4. dt robustness');
{
  const stats = (s: StorkFlockSim) => {
    let y = 0;
    for (let i = 0; i < s.count; i++) y += s.py[i];
    return { y: y / s.count, kettle: s.kettleCount };
  };
  const ref = makeSim();
  for (let f = 0; f < 90 * 60; f++) ref.update(1 / 60, null);
  const r = stats(ref);
  const rates: [string, () => number][] = [
    ['144 fps', () => 1 / 144],
    ['24 fps', () => 1 / 24],
    ['10 fps', () => 0.1],
    ['4 fps', () => 0.25],
    ['jitter 5–120 fps', (() => {
      let k = 0;
      return () => [1 / 120, 1 / 30, 0.2, 1 / 60, 0.05, 1 / 90][k++ % 6];
    })()],
  ];
  for (const [name, dtf] of rates) {
    const s = makeSim();
    let t = 0;
    let minPair = Infinity;
    let frames = 0;
    while (t < 90 - 1e-6) {
      const dt = Math.min(dtf(), 90 - t);
      s.update(dt, null);
      t += dt;
      if (++frames % 30 === 0) minPair = Math.min(minPair, minPairDistance(s));
    }
    const q = stats(s);
    check(finiteSim(s), `${name}: no NaNs`);
    check(Math.abs(q.y - r.y) < 12, `${name}: mean height ${f1(q.y)} m vs ${f1(r.y)} m at 60 fps`);
    check(Math.abs(q.kettle - r.kettle) < 40, `${name}: ${q.kettle} still circling vs ${r.kettle} at 60 fps`);
    check(minPair >= STORK.minSep - 0.05, `${name}: no intersections (min ${f2(minPair)} m)`);
  }
  // A huge hitch is clamped; zero or negative dt does nothing.
  const s = makeSim();
  const x0 = s.px[0];
  s.update(0, null);
  s.update(-1, null);
  s.update(Number.NaN, null);
  check(s.px[0] === x0 && s.time === 0, 'dt ≤ 0 or NaN changes nothing (paused)');
  s.update(10, null);
  check(Math.abs(s.time - STORK.maxFrame) < 1e-9 && finiteSim(s), `a 10 s hitch is clamped to ${STORK.maxFrame} s`);
  const empty = new StorkFlockSim({ ...BASE, count: 0 });
  empty.update(DT, null);
  check(empty.kettleCount === 0, 'an empty flock is fine');
}

/* ------------------------------------------------------------------ */
/* 6. Budget                                                             */
/* ------------------------------------------------------------------ */
console.log('5. budget');
{
  const s = makeSim();
  const cap = s.count;
  const target = (): StorkInstanceTarget => ({ matrices: new Float32Array(cap * 16), poses: new Float32Array(cap * 4), capacity: cap, count: 0 });
  const near = target();
  const far = target();
  const st: StorkInstanceStats = { near: 0, far: 0, hidden: 0, nearest: 0 };
  const d: DragonProbe = { x: -300, y: 500, z: 0, vx: 25, vy: 0, vz: 0 };
  const times: number[] = [];
  for (let f = 0; f < 60 * 40; f++) {
    d.x += d.vx / 60;
    const t0 = performance.now();
    s.update(1 / 60, d);
    fillStorkInstances(s, d.x + 10, d.y + 4, d.z + 25, 1, near, far, st);
    const t1 = performance.now();
    if (f > 300) times.push(t1 - t0);
  }
  times.sort((a, b) => a - b);
  const med = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  console.log(`  400 storks: median ${med.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms per frame (simulation + instance buffers)`);
  check(med <= 0.3, `median frame cost ${med.toFixed(3)} ms ≤ 0.3 ms`);
  check(st.near + st.far + st.hidden === cap, `every bird is drawn or hidden (${st.near} near, ${st.far} far, ${st.hidden} hidden)`);
  // Far away and faded: nothing drawn.
  fillStorkInstances(s, 1e5, 0, 0, 1, near, far, st);
  check(st.near === 0 && st.far === 0, 'a flock beyond the fade band draws nothing');
  fillStorkInstances(s, 0, 500, 0, 0, near, far, st);
  check(st.near === 0 && st.far === 0, 'a fully faded flock draws nothing');
}

console.log(`storks-check: ${checks} checks, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
