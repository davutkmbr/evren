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
 *
 * Exits non-zero on any failure.
 */
import { buildHeadlessGeo } from './geo';
import { COURSES, compileCourse, RACE_PACE, COUNTDOWN_SECONDS, LEAD_IN, type CompiledCourse, type Gate } from '../../src/activities/courses';
import { RaceSession, gateCrossing, type RaceEvent, type Vec3 } from '../../src/activities/race';
import { decodeGhost, encodeGhost, getRecord, submitRun, GhostRecorder, GHOST_HZ } from '../../src/activities/records';
import { formatTime } from '../../src/activities/text';
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

console.log('\nCourse            gates   length   est. @35 m/s');
for (const c of compiled) {
  console.log(`${c.def.name.padEnd(16)} ${String(c.gates.length).padStart(6)} ${(c.length / 1000).toFixed(2).padStart(6)} km   ${formatTime(c.length / RACE_PACE)}`);
}
console.log(failures === 0 ? '\nAll race checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
