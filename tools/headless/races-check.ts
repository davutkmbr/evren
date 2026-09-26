/**
 * Headless check of the ring race courses and race logic (no browser, no GPU):
 *
 *   npx tsx tools/headless/races-check.ts
 *
 * Courses (against the real GeoQuery): every gate clears the terrain by radius + 15 m (more over land, for
 * buildings), stays out of landmark volumes (bridge decks and towers as capsules along the anchor line, other
 * landmarks as cylinders), consecutive gates are 250–2500 m apart and legs turn at most 100°. Legs (and the lead-in)
 * are sampled for terrain clearance and landmark volumes too.
 * Logic: synthetic trajectories through the state machine (straight run finishes, a skipped gate does not count, a
 * backwards pass does not count, stray and landing abort) plus the ghost path codec and records without storage.
 * Races v2: medal targets (data vs the default paces, thresholds, best medal in records), split delta sign and
 * format, ghost interpolation (time → position) and the ghost gap sign (progress along the course).
 *
 * Exits non-zero on any failure.
 */
import { buildHeadlessGeo } from './geo';
import {
  COURSES,
  compileCourse,
  RACE_PACE,
  COUNTDOWN_SECONDS,
  LEAD_IN,
  betterMedal,
  defaultMedalTimes,
  medalFor,
  timedDistance,
  type CompiledCourse,
  type Gate,
} from '../../src/activities/courses';
import { GhostTrack, ghostGap } from '../../src/activities/ghost';
import { RaceSession, courseProgress, gateCrossing, type RaceEvent, type Vec3 } from '../../src/activities/race';
import { decodeGhost, encodeGhost, getRecord, submitRun, GhostRecorder, GHOST_HZ } from '../../src/activities/records';
import { deltaTone, formatGateDistance, formatRaceTime, formatSplitDelta, formatTargetTime, formatTime } from '../../src/activities/text';
import type { GeoQuery, LandmarkDef } from '../../src/core/contracts';

const GATE_TERRAIN_MARGIN = 15;
/** Extra clearance over land for buildings the terrain height does not include. */
const LAND_BUILDING_ALLOWANCE = 35;
const LEG_WATER_CLEARANCE = 20;
const LEG_LAND_CLEARANCE = 45;
const MIN_SPACING = 250;
const MAX_SPACING = 2500;
const MAX_TURN_DEG = 100;
const BRIDGE_HALF_WIDTH = 60;
const LANDMARK_H_MARGIN = 20;
const LANDMARK_V_MARGIN = 15;

let failures = 0;
const fail = (msg: string): void => {
  failures++;
  console.log(`  FAIL ${msg}`);
};
const ok = (msg: string): void => console.log(`  ok   ${msg}`);

/* ------------------------------------------------------------------ */
/* Landmark volumes                                                    */
/* ------------------------------------------------------------------ */

interface Volume {
  id: string;
  /** Segment (a == b for a cylinder). */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  radius: number;
  top: number;
}

function landmarkVolumes(landmarks: readonly LandmarkDef[]): Volume[] {
  const out: Volume[] = [];
  for (const l of landmarks) {
    const top = l.y + l.height;
    const anchors = l.anchors ?? [];
    if (l.kind === 'bridge' && anchors.length >= 2) {
      let best = [anchors[0], anchors[1]];
      let bestD = -1;
      for (let i = 0; i < anchors.length; i++) {
        for (let j = i + 1; j < anchors.length; j++) {
          const d = Math.hypot(anchors[i].x - anchors[j].x, anchors[i].z - anchors[j].z);
          if (d > bestD) {
            bestD = d;
            best = [anchors[i], anchors[j]];
          }
        }
      }
      out.push({ id: l.id, ax: best[0].x, az: best[0].z, bx: best[1].x, bz: best[1].z, radius: BRIDGE_HALF_WIDTH, top });
      continue;
    }
    const r = l.kind === 'bridge' ? BRIDGE_HALF_WIDTH : l.extent ?? l.radius;
    out.push({ id: l.id, ax: l.x, az: l.z, bx: l.x, bz: l.z, radius: r, top });
    for (const a of anchors) {
      out.push({ id: `${l.id}@anchor`, ax: a.x, az: a.z, bx: a.x, bz: a.z, radius: Math.max(40, Math.min(l.radius, 80)), top });
    }
  }
  return out;
}

function distToVolume(v: Volume, x: number, z: number): number {
  const abx = v.bx - v.ax;
  const abz = v.bz - v.az;
  const len2 = abx * abx + abz * abz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - v.ax) * abx + (z - v.az) * abz) / len2)) : 0;
  return Math.hypot(x - (v.ax + abx * t), z - (v.az + abz * t)) - v.radius;
}

/* ------------------------------------------------------------------ */
/* Course checks                                                       */
/* ------------------------------------------------------------------ */

function surfaceAt(geo: GeoQuery, x: number, z: number): { h: number; land: boolean } {
  const h = geo.heightAt(x, z);
  const land = !geo.isWater(x, z);
  return { h: Math.max(0, h), land };
}

function checkCourse(geo: GeoQuery, course: CompiledCourse, volumes: Volume[]): void {
  const gates = course.gates;
  console.log(`\n${course.def.name} (${course.def.id}): ${gates.length} gates`);
  let before = failures;

  // Gates: terrain clearance and landmark volumes.
  for (const g of gates) {
    const s = surfaceAt(geo, g.x, g.z);
    const need = g.radius + GATE_TERRAIN_MARGIN + (s.land ? LAND_BUILDING_ALLOWANCE : 0);
    const clearance = g.y - s.h;
    if (clearance < need) {
      fail(`gate ${g.index} clearance ${clearance.toFixed(0)} m < ${need} m (${s.land ? 'land' : 'water'}, ground ${s.h.toFixed(0)} m)`);
    }
    // The ring's horizontal footprint: radius times the horizontal part of its plane.
    for (const v of volumes) {
      const d = distToVolume(v, g.x, g.z);
      if (d < g.radius + LANDMARK_H_MARGIN && g.y - g.radius < v.top + LANDMARK_V_MARGIN) {
        fail(`gate ${g.index} cuts ${v.id}: ${d.toFixed(0)} m from its volume, ring bottom ${(g.y - g.radius).toFixed(0)} m < top ${v.top.toFixed(0)} + ${LANDMARK_V_MARGIN} m`);
      }
    }
  }
  if (failures === before) {
    ok('gate clearance above terrain and landmark volumes');
  }

  // Spacing and turn angles.
  before = failures;
  const spacing: number[] = [];
  for (let i = 1; i < gates.length; i++) {
    const a = gates[i - 1];
    const b = gates[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    spacing.push(d);
    if (d < MIN_SPACING || d > MAX_SPACING) {
      fail(`gates ${i - 1}→${i} spacing ${d.toFixed(0)} m outside ${MIN_SPACING}–${MAX_SPACING} m`);
    }
  }
  let maxTurn = 0;
  for (let i = 1; i < gates.length - 1; i++) {
    const a = gates[i - 1];
    const b = gates[i];
    const c = gates[i + 1];
    const u = [b.x - a.x, b.y - a.y, b.z - a.z];
    const w = [c.x - b.x, c.y - b.y, c.z - b.z];
    const cos = (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (Math.hypot(u[0], u[1], u[2]) * Math.hypot(w[0], w[1], w[2]));
    const turn = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    maxTurn = Math.max(maxTurn, turn);
    if (turn > MAX_TURN_DEG) {
      fail(`turn at gate ${i} is ${turn.toFixed(0)}° > ${MAX_TURN_DEG}°`);
    }
  }
  if (failures === before) {
    ok(`spacing ${Math.min(...spacing).toFixed(0)}–${Math.max(...spacing).toFixed(0)} m, max turn ${maxTurn.toFixed(0)}°`);
  }

  // Legs (lead-in included): terrain clearance and landmark volumes along the straight line.
  before = failures;
  const pts: Vec3[] = [course.start, ...gates];
  let minLegClear = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / 10));
    const hits = new Set<string>();
    let worst: { clear: number; need: number; t: number } | null = null;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const z = a.z + (b.z - a.z) * t;
      const s = surfaceAt(geo, x, z);
      const need = s.land ? LEG_LAND_CLEARANCE : LEG_WATER_CLEARANCE;
      const clear = y - s.h;
      minLegClear = Math.min(minLegClear, clear);
      if (clear < need && (!worst || clear - need < worst.clear - worst.need)) {
        worst = { clear, need, t };
      }
      for (const v of volumes) {
        if (distToVolume(v, x, z) < 10 && y < v.top + 10) {
          hits.add(v.id);
        }
      }
    }
    const name = i === 1 ? 'lead-in→0' : `${i - 2}→${i - 1}`;
    if (worst) {
      fail(`leg ${name}: clearance ${worst.clear.toFixed(0)} m < ${worst.need} m at ${(worst.t * 100).toFixed(0)}%`);
    }
    for (const id of hits) {
      fail(`leg ${name} passes through ${id}`);
    }
  }
  if (failures === before) {
    ok(`legs clear (min clearance ${minLegClear.toFixed(0)} m)`);
  }

  // Start gate reachable at the end of the countdown.
  const leadTime = LEAD_IN / RACE_PACE;
  if (leadTime <= COUNTDOWN_SECONDS) {
    fail(`lead-in ${LEAD_IN} m reaches the start gate before GO`);
  }
}

/* ------------------------------------------------------------------ */
/* Logic tests                                                         */
/* ------------------------------------------------------------------ */

const DT = 1 / 24;

/** Runs a polyline trajectory at `speed` through a session; returns every event. */
function fly(session: RaceSession, path: Vec3[], speed = RACE_PACE, grounded = false): RaceEvent[] {
  const events: RaceEvent[] = [];
  const step = speed * DT;
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    let s = carry;
    while (s <= len) {
      const t = len > 0 ? s / len : 1;
      events.push(...session.update(DT, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }, grounded));
      if (!session.active) {
        return events;
      }
      s += step;
    }
    carry = s - len;
  }
  return events;
}

const along = (g: Gate, d: number, side = 0): Vec3 => {
  // Point `d` meters along the gate normal, shifted `side` meters sideways (horizontal perpendicular).
  const h = Math.hypot(g.nx, g.nz) || 1;
  return { x: g.x + g.nx * d + (-g.nz / h) * side, y: g.y + g.ny * d, z: g.z + g.nz * d + (g.nx / h) * side };
};

function logicTests(course: CompiledCourse): void {
  console.log(`\nRace logic (synthetic trajectories on ${course.def.id})`);
  const gates = course.gates;
  const straight: Vec3[] = [course.start, ...gates, along(gates[gates.length - 1], 200)];

  // 1. Straight run finishes with a split per gate.
  {
    const s = new RaceSession(course);
    const ev = [...s.start(), ...fly(s, straight)];
    const gateEvents = ev.filter((e) => e.type === 'gate').length;
    const expected = (LEAD_IN - RACE_PACE * COUNTDOWN_SECONDS + course.length) / RACE_PACE;
    if (s.phase === 'finished' && gateEvents === gates.length && s.splits.length === gates.length && Math.abs(s.elapsed - expected) < 0.2) {
      ok(`straight run finishes: ${gateEvents} gates, ${s.elapsed.toFixed(2)} s (expected ${expected.toFixed(2)} s)`);
    } else {
      fail(`straight run: phase ${s.phase}, gates ${gateEvents}/${gates.length}, time ${s.elapsed.toFixed(2)} vs ${expected.toFixed(2)}`);
    }
    const countdowns = ev.filter((e) => e.type === 'countdown').length;
    if (countdowns !== COUNTDOWN_SECONDS || !ev.some((e) => e.type === 'go')) {
      fail(`countdown emitted ${countdowns} ticks, go ${ev.some((e) => e.type === 'go')}`);
    } else {
      ok(`countdown ${COUNTDOWN_SECONDS}-2-1 then go`);
    }
    if (s.splits.some((v, i) => i > 0 && v <= s.splits[i - 1])) {
      fail('splits are not increasing');
    }
  }

  // 2. Skipping gate 2 (passing beside it) does not count it; the next gate reports it missed. (The stray limit is
  //    raised so the run reaches gate 3 instead of aborting for flying away from the unfinished leg.)
  {
    const s = new RaceSession(course, { strayAbort: 1e6, strayWarn: 1e6 });
    const skip = gates[2];
    const path: Vec3[] = [course.start, gates[0], gates[1], along(skip, -60, skip.radius * 3), along(skip, 60, skip.radius * 3), ...gates.slice(3)];
    const ev = [...s.start(), ...fly(s, path)];
    const missed = ev.find((e) => e.type === 'missed');
    const counted = ev.filter((e) => e.type === 'gate').map((e) => (e as { index: number }).index);
    if (s.phase !== 'finished' && s.next === 2 && counted.join(',') === '0,1' && missed && missed.type === 'missed' && missed.expected === 2 && missed.crossed === 3) {
      ok(`skipped gate: counted [${counted.join(',')}], next stays 2, missed event at gate 3`);
    } else {
      fail(`skipped gate: phase ${s.phase}, next ${s.next}, counted [${counted.join(',')}], missed ${JSON.stringify(missed)}`);
    }
  }

  // 3. Crossing gate 1 backwards does not count; crossing it forwards afterwards does.
  {
    const s = new RaceSession(course);
    const g1 = gates[1];
    const path: Vec3[] = [course.start, gates[0], along(g1, -150, g1.radius * 4), along(g1, 150, g1.radius * 4), along(g1, 150), along(g1, -150)];
    const ev = [...s.start(), ...fly(s, path)];
    const wrong = ev.filter((e) => e.type === 'wrongWay').length;
    const nextAfterBack = s.next;
    const ev2 = fly(s, [along(g1, -150), along(g1, 100)]);
    const countedAfter = ev2.some((e) => e.type === 'gate' && e.index === 1);
    if (wrong === 1 && nextAfterBack === 1 && countedAfter && s.next === 2) {
      ok('backwards pass through gate 1 ignored (wrong-way event), forward pass then counts');
    } else {
      fail(`backwards pass: wrongWay ${wrong}, next after ${nextAfterBack}, forward counted ${countedAfter}, next ${s.next}`);
    }
  }

  // 4. Straying far from the course aborts.
  {
    const s = new RaceSession(course);
    const g0 = gates[0];
    const ev = [...s.start(), ...fly(s, [course.start, along(g0, -100), along(g0, -100, 2500)], 60)];
    if (s.phase === 'aborted' && s.abortReason === 'stray' && ev.some((e) => e.type === 'strayWarning')) {
      ok('straying 1.5 km off the leg warns, then aborts');
    } else {
      fail(`stray: phase ${s.phase}, reason ${s.abortReason}`);
    }
  }

  // 5. Landing aborts after the grace time, a short touch does not.
  {
    const s = new RaceSession(course);
    s.start();
    fly(s, [course.start, along(gates[0], -100)]);
    const p = along(gates[0], -100);
    for (let t = 0; t < 1; t += DT) {
      s.update(DT, p, true);
    }
    const afterTouch = s.phase;
    s.update(DT, p, false);
    for (let t = 0; t < 3; t += DT) {
      s.update(DT, p, true);
    }
    if (afterTouch === 'running' && s.phase === 'aborted' && s.abortReason === 'landed') {
      ok('1 s water touch keeps racing, 3 s on the ground aborts');
    } else {
      fail(`landing: after touch ${afterTouch}, phase ${s.phase}, reason ${s.abortReason}`);
    }
  }

  // 6. Paused frames (dt = 0) change nothing.
  {
    const s = new RaceSession(course);
    s.start();
    for (let i = 0; i < 100; i++) {
      s.update(0, course.start, true);
    }
    if (s.phase === 'countdown') {
      ok('dt = 0 keeps the countdown frozen');
    } else {
      fail(`dt = 0 changed the phase to ${s.phase}`);
    }
  }
}

function unitTests(course: CompiledCourse): void {
  console.log('\nGate disc, ghost codec, records');
  const g = course.gates[1];
  const cases: Array<[string, Vec3, Vec3, number]> = [
    ['centre forward', along(g, -5), along(g, 5), 1],
    ['centre backward', along(g, 5), along(g, -5), -1],
    ['inside rim', along(g, -5, g.radius * 0.95), along(g, 5, g.radius * 0.95), 1],
    ['outside rim', along(g, -5, g.radius * 1.05), along(g, 5, g.radius * 1.05), 0],
    ['stops short', along(g, -5), along(g, -0.5), 0],
    ['touches plane', along(g, -5), along(g, 0), 1],
  ];
  const bad = cases.filter(([, a, b, want]) => gateCrossing(g, a, b) !== want);
  if (bad.length === 0) {
    ok(`gateCrossing: ${cases.length} cases`);
  } else {
    for (const [name, a, b, want] of bad) {
      fail(`gateCrossing ${name}: got ${gateCrossing(g, a, b)}, want ${want}`);
    }
  }

  // Ghost: a 4 minute synthetic path through the course, 5 Hz.
  const rec = new GhostRecorder();
  const pts = [course.start, ...course.gates];
  const src: number[] = [];
  let t = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    for (let s = 0; s < len; s += RACE_PACE * DT) {
      const k = s / len;
      const x = a.x + (b.x - a.x) * k;
      const y = a.y + (b.y - a.y) * k + Math.sin(t) * 8;
      const z = a.z + (b.z - a.z) * k;
      rec.push(DT, x, y, z);
      if (rec.count * 3 > src.length) {
        src.push(x, y, z);
      }
      t += DT;
    }
  }
  const encoded = rec.encode();
  const decoded = decodeGhost(encoded);
  let maxErr = 0;
  for (let i = 0; i < Math.min(src.length, decoded.length); i++) {
    maxErr = Math.max(maxErr, Math.abs(src[i] - decoded[i]));
  }
  const seconds = rec.count / GHOST_HZ;
  if (decoded.length === src.length && maxErr <= 0.75) {
    ok(`ghost: ${rec.count} samples (${seconds.toFixed(0)} s) → ${encoded.length} chars, max error ${maxErr.toFixed(2)} m`);
  } else {
    fail(`ghost: ${decoded.length / 3} of ${src.length / 3} samples, max error ${maxErr.toFixed(2)} m`);
  }
  if (decodeGhost(encodeGhost([])).length !== 0) {
    fail('ghost: empty path');
  }

  // Records without localStorage (Node): in memory.
  const id = `test-${course.def.id}`;
  const r1 = submitRun(id, 100, [10, 50, 100]);
  const r2 = submitRun(id, 110, [11, 55, 110]);
  const r3 = submitRun(id, 95, [9, 48, 95], encoded);
  const stored = getRecord(id);
  if (r1.newRecord && r1.previousBest === undefined && !r2.newRecord && r2.previousBest === 100 && r3.newRecord && r3.previousBest === 100 && stored?.best === 95 && stored.ghost === encoded) {
    ok('records: first finish, slower run kept out, faster run replaces (no storage)');
  } else {
    fail(`records: ${JSON.stringify({ r1, r2, r3, best: stored?.best })}`);
  }
}

/* ------------------------------------------------------------------ */
/* Races v2: medals, split deltas, ghost replay and gap                */
/* ------------------------------------------------------------------ */

function medalTests(courses: CompiledCourse[]): void {
  console.log('\nMedals');
  for (const c of courses) {
    const m = c.def.medals;
    const d = defaultMedalTimes(timedDistance(c));
    const whole = [m.gold, m.silver, m.bronze].every((v) => Number.isInteger(v) && v > 0);
    if (!whole || !(m.gold < m.silver && m.silver < m.bronze)) {
      fail(`${c.def.id}: targets must be whole seconds with gold < silver < bronze (${JSON.stringify(m)})`);
      continue;
    }
    const off = Math.max(Math.abs(m.gold - d.gold) / d.gold, Math.abs(m.silver - d.silver) / d.silver, Math.abs(m.bronze - d.bronze) / d.bronze);
    if (off > 0.1) {
      fail(`${c.def.id}: targets ${JSON.stringify(m)} more than 10% off the defaults ${JSON.stringify(d)}`);
    } else {
      const same = m.gold === d.gold && m.silver === d.silver && m.bronze === d.bronze;
      ok(
        `${c.def.id}: gold ${formatTargetTime(m.gold)} · silver ${formatTargetTime(m.silver)} · bronze ${formatTargetTime(m.bronze)} ` +
          `(${same ? 'default paces' : `defaults ${d.gold}/${d.silver}/${d.bronze}`}, ${(timedDistance(c) / 1000).toFixed(2)} km timed)`,
      );
    }
  }
  const m = { gold: 100, silver: 120, bronze: 140 };
  const cases: Array<[number, string | null]> = [
    [80, 'gold'],
    [100, 'gold'],
    [100.01, 'silver'],
    [120, 'silver'],
    [139.99, 'bronze'],
    [140.01, null],
    [Number.NaN, null],
  ];
  const bad = cases.filter(([t, want]) => medalFor(t, m) !== want);
  if (bad.length) {
    for (const [t, want] of bad) {
      fail(`medalFor(${t}) = ${medalFor(t, m)}, want ${want}`);
    }
  } else {
    ok(`medalFor thresholds: ${cases.length} cases`);
  }
  if (betterMedal('bronze', 'gold') !== 'gold' || betterMedal(null, 'silver') !== 'silver' || betterMedal(undefined, null) !== null || betterMedal('silver', 'bronze') !== 'silver') {
    fail('betterMedal ordering');
  }
  // Records keep the best medal: bronze first, a slower medal-less run keeps it, a faster gold run upgrades it.
  const id = 'test-medals';
  const a = submitRun(id, 135, [135], undefined, medalFor(135, m));
  const b = submitRun(id, 150, [150], undefined, medalFor(150, m));
  const c = submitRun(id, 95, [95], undefined, medalFor(95, m));
  if (a.medal === 'bronze' && a.newMedal && b.medal === 'bronze' && !b.newMedal && !b.newRecord && c.medal === 'gold' && c.newMedal && getRecord(id)?.medal === 'gold') {
    ok('records: best medal stored, kept on a slower run, upgraded on a faster one');
  } else {
    fail(`records medal: ${JSON.stringify({ a, b, c, stored: getRecord(id)?.medal })}`);
  }
}

function formatTests(): void {
  console.log('\nSplit deltas and time formats');
  const cases: Array<[string, string, string]> = [
    ['formatSplitDelta(-1.237)', formatSplitDelta(-1.237), '−1,24'],
    ['formatSplitDelta(0.8)', formatSplitDelta(0.8), '+0,80'],
    ['formatSplitDelta(0)', formatSplitDelta(0), '±0,00'],
    ['formatSplitDelta(-0.004)', formatSplitDelta(-0.004), '±0,00'],
    ['formatSplitDelta(-75.5)', formatSplitDelta(-75.5), '−1:15,50'],
    ['formatSplitDelta(-2.13, 1)', formatSplitDelta(-2.13, 1), '−2,1'],
    ['formatSplitDelta(3.06, 1)', formatSplitDelta(3.06, 1), '+3,1'],
    ['deltaTone(-1.24)', deltaTone(-1.24), 'faster'],
    ['deltaTone(0.8)', deltaTone(0.8), 'slower'],
    ['deltaTone(0.004)', deltaTone(0.004), 'even'],
    ['formatRaceTime(83.456)', formatRaceTime(83.456), '1:23,46'],
    ['formatRaceTime(59.999)', formatRaceTime(59.999), '1:00,00'],
    ['formatRaceTime(0)', formatRaceTime(0), '0:00,00'],
    ['formatTargetTime(248)', formatTargetTime(248), '4:08'],
    ['formatGateDistance(637)', formatGateDistance(637), '640 m'],
    ['formatGateDistance(1234)', formatGateDistance(1234), '1,2 km'],
  ];
  const bad = cases.filter(([, got, want]) => got !== want);
  if (bad.length) {
    for (const [name, got, want] of bad) {
      fail(`${name} = "${got}", want "${want}"`);
    }
  } else {
    ok(`${cases.length} cases (sign: negative = faster, green)`);
  }
}

/** Point `d` meters along the polyline, and the distance to each vertex. */
function polyline(pts: Vec3[]): { at: (d: number) => Vec3; cum: number[]; length: number } {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z));
  }
  const length = cum[cum.length - 1];
  const at = (d: number): Vec3 => {
    const dd = Math.max(0, Math.min(length, d));
    let i = 1;
    while (i < pts.length - 1 && cum[i] < dd) {
      i++;
    }
    const a = pts[i - 1];
    const b = pts[i];
    const k = cum[i] > cum[i - 1] ? (dd - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0;
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
  };
  return { at, cum, length };
}

function ghostTests(course: CompiledCourse): void {
  console.log(`\nGhost replay and gap (${course.def.id})`);
  // Interpolation on a trivial track: x = 10 m per sample.
  {
    const samples = new Float32Array([0, 50, 0, 10, 52, 0, 20, 54, 0, 30, 56, 0]);
    const tr = new GhostTrack(samples, { hz: 5 });
    const p: Vec3 = { x: 0, y: 0, z: 0 };
    const checks: Array<[number, number, number]> = [
      [0, 0, 50],
      [0.3, 15, 53],
      [0.6, 30, 56],
      [-1, 0, 50],
      [9, 30, 56],
    ];
    const bad = checks.filter(([t, x, y]) => !tr.positionAt(t, p) || Math.abs(p.x - x) > 1e-4 || Math.abs(p.y - y) > 1e-4);
    if (bad.length === 0 && Math.abs(tr.duration - 0.6) < 1e-9 && tr.finishTime === tr.duration) {
      ok(`positionAt: ${checks.length} cases (lerp between samples, clamped to the recorded range)`);
    } else {
      fail(`positionAt: t = ${bad.map(([t]) => t).join(', ')} wrong`);
    }
    if (new GhostTrack(new Float32Array(0)).positionAt(1, p)) {
      fail('positionAt on an empty track returned true');
    }
  }

  // A constant-speed run along the course (from the lead-in start), through the recorder and the codec.
  const speed = 40;
  const pts: Vec3[] = [course.start, ...course.gates];
  const line = polyline(pts);
  const rec = new GhostRecorder();
  for (let t = 0; t * speed <= line.length + speed; t += DT) {
    const q = line.at(t * speed);
    rec.push(DT, q.x, q.y, q.z);
  }
  const splits = line.cum.slice(1).map((d) => d / speed);
  const finish = splits[splits.length - 1];
  const encoded = rec.encode();
  const track = new GhostTrack(decodeGhost(encoded), { course, splits, finishTime: finish });
  {
    const p: Vec3 = { x: 0, y: 0, z: 0 };
    let maxErr = 0;
    for (let t = 0.13; t < finish; t += 3.7) {
      track.positionAt(t, p);
      const q = line.at(t * speed);
      maxErr = Math.max(maxErr, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
    }
    if (maxErr < 2.5) {
      ok(`time → position on a recorded ${finish.toFixed(0)} s run: max error ${maxErr.toFixed(2)} m`);
    } else {
      fail(`time → position error ${maxErr.toFixed(2)} m`);
    }
  }
  // Gap: a racer on leg 3 (gate 2 → 3) at the point the ghost reached after tGhost seconds.
  {
    const legMid = (line.cum[3] + line.cum[4]) / 2;
    const pos = line.at(legMid);
    const prog = courseProgress(course, 3, pos);
    const tGhost = legMid / speed;
    const ahead = ghostGap(track, tGhost - 2, prog);
    const behind = ghostGap(track, tGhost + 3, prog);
    const even = ghostGap(track, tGhost, prog);
    if (prog > 3.3 && prog < 3.7 && ahead !== null && behind !== null && even !== null && Math.abs(ahead + 2) < 0.25 && Math.abs(behind - 3) < 0.25 && Math.abs(even) < 0.25) {
      ok(`gap sign: 2 s early → ${formatSplitDelta(ahead, 1)} s (ahead), 3 s late → ${formatSplitDelta(behind, 1)} s (behind), progress ${prog.toFixed(2)}`);
    } else {
      fail(`gap: progress ${prog.toFixed(2)}, ahead ${ahead}, behind ${behind}, even ${even}`);
    }
    // At the finish line the gap is the finish time difference (within a sample).
    const atFinish = ghostGap(track, finish + 5, course.gates.length);
    if (atFinish === null || Math.abs(atFinish - 5) > 1 / GHOST_HZ + 1e-6) {
      fail(`gap at the finish: ${atFinish}`);
    }
    // Progress beyond the ghost's samples (a truncated path): the ghost's finish time is the reference.
    const all = decodeGhost(encoded);
    const cut = new GhostTrack(all.slice(0, Math.floor(all.length * 0.6 / 3) * 3), { course, splits, finishTime: finish });
    const late = ghostGap(cut, finish + 5, course.gates.length - 1.5);
    if (late === null || Math.abs(late - 5) > 1e-6) {
      fail(`gap past the ghost's last sample: ${late}`);
    } else {
      ok('gap at the finish and past a truncated ghost path uses the ghost finish time');
    }
    // No progress data (splits did not match): no gap.
    if (ghostGap(new GhostTrack(decodeGhost(encoded)), 10, 1.5) !== null) {
      fail('gap without course data should be null');
    }
  }
}

/* ------------------------------------------------------------------ */

const t0 = Date.now();
const geo = buildHeadlessGeo();
console.log(`GeoQuery built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const volumes = landmarkVolumes(geo.landmarks);
const compiled = COURSES.map(compileCourse);
for (const c of compiled) {
  checkCourse(geo, c, volumes);
}
for (const c of compiled) {
  logicTests(c);
}
unitTests(compiled[0]);
medalTests(compiled);
formatTests();
ghostTests(compiled[0]);

console.log('\nCourse            gates   length   est. @35 m/s');
for (const c of compiled) {
  console.log(`${c.def.name.padEnd(16)} ${String(c.gates.length).padStart(6)} ${(c.length / 1000).toFixed(2).padStart(6)} km   ${formatTime(c.length / RACE_PACE)}`);
}
console.log(failures === 0 ? '\nAll race checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
