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
 * Races v3: bridges are built with their real structures builders (colliders, like perches-check); a gate, speed
 * ring or leg point under a deck is valid only when the deck underside is at least 25 m above the ring top (above the
 * path point for legs) and the ring stays 20 m from every pier / tower collider. Speed rings get the gate clearance
 * checks plus spacing from the gates. Unit tests: ring pass detection and the boost envelope, custom course share
 * codes (round trip, malformed codes rejected), storage limits, and the editor's placement validation.
 *
 * Exits non-zero on any failure.
 */
import { buildHeadlessGeo } from './geo';
import { StructureBuild } from '../../src/world/landmarks/structures/build/context';
import { builderFor } from '../../src/world/landmarks/structures/builders/registry';
import { prepareSite } from '../../src/world/landmarks/structures/system/site-planner';
import type { ColliderData } from '../../src/world/landmarks/structures/types';
import {
  COURSES,
  compileCourse,
  RACE_PACE,
  COUNTDOWN_SECONDS,
  LEAD_IN,
  SPEED_RING_RADIUS,
  betterMedal,
  defaultMedalTimes,
  facing,
  medalFor,
  timedDistance,
  type CompiledCourse,
  type Gate,
} from '../../src/activities/courses';
import {
  CUSTOM_LIMIT,
  GATE_SIZES,
  compileCustomCourse,
  customCourseId,
  decodeCourseCode,
  deleteCustomCourse,
  encodeCourseCode,
  loadCustomCourses,
  saveCustomCourse,
  validateRingPlacement,
  type CustomCourse,
  type PlacementProbe,
} from '../../src/activities/custom-courses';
import { CourseEditor, poseFacing, type EditorPose } from '../../src/activities/editor';
import { BOOST_DV, BOOST_SPEED_CAP, BOOST_TIME, BoostEnvelope, boostDeltaV } from '../../src/activities/speed-boost';
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
  /** Landmark id (without the @anchor suffix). */
  landmark: string;
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
      out.push({ id: l.id, landmark: l.id, ax: best[0].x, az: best[0].z, bx: best[1].x, bz: best[1].z, radius: BRIDGE_HALF_WIDTH, top });
      continue;
    }
    const r = l.kind === 'bridge' ? BRIDGE_HALF_WIDTH : l.extent ?? l.radius;
    out.push({ id: l.id, landmark: l.id, ax: l.x, az: l.z, bx: l.x, bz: l.z, radius: r, top });
    for (const a of anchors) {
      out.push({ id: `${l.id}@anchor`, landmark: l.id, ax: a.x, az: a.z, bx: a.x, bz: a.z, radius: Math.max(40, Math.min(l.radius, 80)), top });
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
/* Bridges: real structure colliders                                   */
/* ------------------------------------------------------------------ */

/** Deck underside above a ring top (m) required to pass under a bridge. */
const UNDER_DECK_CLEARANCE = 25;
/** Horizontal distance (m) a ring keeps from piers and towers under a bridge. */
const PIER_LATERAL_CLEARANCE = 20;
/** Colliders this far (m) beyond the ring's reach still count as overhead (the deck band, like the capsule). */
const OVERHEAD_REACH = BRIDGE_HALF_WIDTH;
/** Smallest gate radius (m) a course would use under a bridge. */
const MIN_UNDER_GATE_RADIUS = 8;

/** Builds every structures-built bridge and returns its colliders by landmark id. */
function buildBridgeColliders(geo: GeoQuery): Map<string, ColliderData[]> {
  const out = new Map<string, ColliderData[]>();
  for (const def of geo.landmarks) {
    if (def.kind !== 'bridge' || def.builder !== 'structures') {
      continue;
    }
    const b = new StructureBuild(prepareSite(def, geo));
    builderFor(b.def)(b);
    const colliders = b.result(0).colliders;
    if (colliders.length) {
      out.set(def.id, colliders);
    }
  }
  return out;
}

/** Horizontal distance from (x, z) to a collider's footprint (0 inside) and its vertical span. */
function colliderReach(c: ColliderData, x: number, z: number): { d: number; bottom: number; top: number } {
  if (c.kind === 'box') {
    // Box yaw follows Object3D.rotation.y (same convention as perches-check colliderTop).
    const dx = x - c.center[0];
    const dz = z - c.center[2];
    const cs = Math.cos(c.yaw);
    const sn = Math.sin(c.yaw);
    const lx = dx * cs - dz * sn;
    const lz = dx * sn + dz * cs;
    const ox = Math.max(0, Math.abs(lx) - c.halfSize[0]);
    const oz = Math.max(0, Math.abs(lz) - c.halfSize[2]);
    return { d: Math.hypot(ox, oz), bottom: c.center[1] - c.halfSize[1], top: c.center[1] + c.halfSize[1] };
  }
  if (c.kind === 'cylinder') {
    return { d: Math.max(0, Math.hypot(x - c.base[0], z - c.base[2]) - c.radius), bottom: c.base[1], top: c.base[1] + c.height };
  }
  return { d: Math.max(0, Math.hypot(x - c.center[0], z - c.center[2]) - c.radius), bottom: c.center[1] - c.radius, top: c.center[1] + c.radius };
}

interface UnderBridge {
  /** Some collider is overhead (within the deck band). */
  under: boolean;
  /** Lowest collider bottom overhead (m), Infinity when none. */
  underside: number;
  /** Underside minus the ring top (m). */
  margin: number;
  /** Horizontal distance from the ring's edge to the nearest pier / tower collider at the ring's height (m). */
  lateral: number;
  ok: boolean;
}

/**
 * Under-bridge test for a ring of radius r centred at (x, y, z) (r = 0 for a path point). Colliders whose bottom is
 * above the ring centre and whose footprint lies within r + OVERHEAD_REACH are overhead (the deck); every other
 * collider reaching the band from 10 m below the ring to UNDER_DECK_CLEARANCE above its top is a pier, tower or
 * approach span the ring must stay PIER_LATERAL_CLEARANCE away from.
 */
function underBridge(colliders: readonly ColliderData[], x: number, y: number, z: number, r: number): UnderBridge {
  let underside = Infinity;
  let lateral = Infinity;
  const bandLow = y - r - 10;
  const bandHigh = y + r + UNDER_DECK_CLEARANCE;
  for (const c of colliders) {
    const k = colliderReach(c, x, z);
    if (k.bottom >= y && k.d <= r + OVERHEAD_REACH) {
      underside = Math.min(underside, k.bottom);
    } else if (k.top > bandLow && k.bottom < bandHigh) {
      lateral = Math.min(lateral, k.d - r);
    }
  }
  const margin = underside - (y + r);
  return { under: underside < Infinity, underside, margin, lateral, ok: margin >= UNDER_DECK_CLEARANCE && lateral >= PIER_LATERAL_CLEARANCE };
}

/** Highest deck underside directly over water along a bridge's axis (m), and where. */
function bestUnderside(geo: GeoQuery, v: Volume, colliders: readonly ColliderData[]): { underside: number; x: number; z: number } {
  let best = { underside: -Infinity, x: v.ax, z: v.az };
  const len = Math.hypot(v.bx - v.ax, v.bz - v.az);
  for (let s = 0; s <= len; s += 5) {
    const x = v.ax + ((v.bx - v.ax) * s) / len;
    const z = v.az + ((v.bz - v.az) * s) / len;
    if (!geo.isWater(x, z)) {
      continue;
    }
    let under = Infinity;
    let blocked = false;
    for (const c of colliders) {
      const k = colliderReach(c, x, z);
      if (k.d > 0) {
        continue;
      }
      if (k.bottom >= 0) {
        under = Math.min(under, k.bottom);
      } else if (k.top > 0) {
        blocked = true;
      }
    }
    if (!blocked && under < Infinity && under > best.underside) {
      best = { underside: under, x, z };
    }
  }
  return best;
}

interface Env {
  geo: GeoQuery;
  volumes: Volume[];
  bridges: Map<string, ColliderData[]>;
}

/* ------------------------------------------------------------------ */
/* Course checks                                                       */
/* ------------------------------------------------------------------ */

function surfaceAt(geo: GeoQuery, x: number, z: number): { h: number; land: boolean } {
  const h = geo.heightAt(x, z);
  const land = !geo.isWater(x, z);
  return { h: Math.max(0, h), land };
}

/** Speed rings keep this far (m) from every gate centre. */
const RING_GATE_GAP = 100;
/** Speed rings on built-in courses sit in this part of their leg. */
const RING_LEG_T = [0.2, 0.8] as const;

/** Clearance of one ring (gate or speed ring): terrain, landmark volumes, under-bridge rule. Returns report lines. */
function checkRing(env: Env, what: string, g: { x: number; y: number; z: number; radius: number }): string[] {
  const report: string[] = [];
  const s = surfaceAt(env.geo, g.x, g.z);
  const need = g.radius + GATE_TERRAIN_MARGIN + (s.land ? LAND_BUILDING_ALLOWANCE : 0);
  const clearance = g.y - s.h;
  if (clearance < need) {
    fail(`${what} clearance ${clearance.toFixed(0)} m < ${need} m (${s.land ? 'land' : 'water'}, ground ${s.h.toFixed(0)} m)`);
  }
  for (const v of env.volumes) {
    const d = distToVolume(v, g.x, g.z);
    if (d < g.radius + LANDMARK_H_MARGIN && g.y - g.radius < v.top + LANDMARK_V_MARGIN) {
      const colliders = v.id === v.landmark ? env.bridges.get(v.landmark) : undefined;
      if (colliders) {
        const u = underBridge(colliders, g.x, g.y, g.z, g.radius);
        if (u.under) {
          const line =
            `${what} under ${v.id}: deck underside ${u.underside.toFixed(1)} m, ring top ${(g.y + g.radius).toFixed(1)} m ` +
            `→ margin ${u.margin.toFixed(1)} m (need ${UNDER_DECK_CLEARANCE}), nearest structure at ring height (piers, towers, low deck ends) ${Number.isFinite(u.lateral) ? `${u.lateral.toFixed(0)} m` : 'none'} (need ${PIER_LATERAL_CLEARANCE})`;
          if (u.ok) {
            report.push(line);
          } else {
            fail(line);
          }
          continue;
        }
      }
      fail(`${what} cuts ${v.id}: ${d.toFixed(0)} m from its volume, ring bottom ${(g.y - g.radius).toFixed(0)} m < top ${v.top.toFixed(0)} + ${LANDMARK_V_MARGIN} m`);
    }
  }
  return report;
}

function checkCourse(env: Env, course: CompiledCourse): { underGates: number } {
  const { geo, volumes } = env;
  const gates = course.gates;
  console.log(`\n${course.def.name} (${course.def.id}): ${gates.length} gates, ${course.speedRings.length} speed rings`);
  let before = failures;
  const under: string[] = [];

  // Gates: terrain clearance, landmark volumes, bridges.
  for (const g of gates) {
    under.push(...checkRing(env, `gate ${g.index}`, g));
  }
  if (failures === before) {
    ok('gate clearance above terrain and landmark volumes');
  }
  const underGates = under.length;
  for (const line of under) {
    ok(line);
  }

  // Speed rings: the same clearance, on the middle of a leg, away from the gates.
  before = failures;
  const ringDefs = course.def.speedRings ?? [];
  if (!course.def.custom && (course.speedRings.length < 2 || course.speedRings.length > 4)) {
    fail(`${course.speedRings.length} speed rings (want 2–4 per course)`);
  }
  if (ringDefs.length !== course.speedRings.length) {
    fail(`${ringDefs.length - course.speedRings.length} speed ring(s) on a leg that does not exist`);
  }
  for (const def of ringDefs) {
    if ('leg' in def && (def.t < RING_LEG_T[0] || def.t > RING_LEG_T[1])) {
      fail(`speed ring on leg ${def.leg} at t = ${def.t} (keep ${RING_LEG_T[0]}–${RING_LEG_T[1]})`);
    }
  }
  let minGap = Infinity;
  for (const r of course.speedRings) {
    for (const line of checkRing(env, `speed ring ${r.index}`, r)) {
      ok(line);
    }
    for (const g of gates) {
      const d = Math.hypot(r.x - g.x, r.y - g.y, r.z - g.z);
      minGap = Math.min(minGap, d);
      if (d < RING_GATE_GAP) {
        fail(`speed ring ${r.index} only ${d.toFixed(0)} m from gate ${g.index} (≥ ${RING_GATE_GAP} m)`);
      }
    }
  }
  if (failures === before && course.speedRings.length) {
    ok(`${course.speedRings.length} speed rings clear, ≥ ${minGap.toFixed(0)} m from any gate`);
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

  // Legs (lead-in included): terrain clearance, landmark volumes and bridges along the straight line.
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
    let underMin: { margin: number; lateral: number; id: string } | null = null;
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
          const colliders = v.id === v.landmark ? env.bridges.get(v.landmark) : undefined;
          const u = colliders ? underBridge(colliders, x, y, z, 0) : null;
          if (u?.under) {
            if (!underMin || u.margin < underMin.margin) {
              underMin = { margin: u.margin, lateral: u.lateral, id: v.id };
            }
            if (!u.ok) {
              hits.add(`${v.id} (under the deck: margin ${u.margin.toFixed(1)} m, pier ${u.lateral.toFixed(0)} m)`);
            }
            continue;
          }
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
    if (underMin && hits.size === 0) {
      ok(`leg ${name} under ${underMin.id}: min deck margin above the path ${underMin.margin.toFixed(1)} m, nearest structure at path height ${Number.isFinite(underMin.lateral) ? `${underMin.lateral.toFixed(0)} m` : 'none'}`);
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
  return { underGates };
}

/** Deck clearance of every built bridge: the largest ring that could pass under it by the course rules. */
function bridgeReport(env: Env): void {
  console.log('\nBridges (built colliders): room under the deck');
  for (const [id, colliders] of env.bridges) {
    const v = env.volumes.find((x) => x.id === id);
    if (!v) {
      continue;
    }
    const b = bestUnderside(env.geo, v, colliders);
    if (!Number.isFinite(b.underside)) {
      ok(`${id}: no deck over open water`);
      continue;
    }
    // Centre ≥ r + GATE_TERRAIN_MARGIN over water and underside ≥ centre + r + UNDER_DECK_CLEARANCE.
    const rMax = (b.underside - GATE_TERRAIN_MARGIN - UNDER_DECK_CLEARANCE) / 2;
    const verdict = rMax >= MIN_UNDER_GATE_RADIUS ? `a gate up to r = ${Math.floor(rMax)} m fits` : `no gate fits (r ≥ ${MIN_UNDER_GATE_RADIUS} m needs ≥ ${2 * MIN_UNDER_GATE_RADIUS + GATE_TERRAIN_MARGIN + UNDER_DECK_CLEARANCE} m)`;
    ok(`${id}: highest deck underside over water ${b.underside.toFixed(1)} m → ${verdict}`);
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

/* ------------------------------------------------------------------ */
/* Races v3: speed rings, custom courses, editor                       */
/* ------------------------------------------------------------------ */

function speedRingTests(course: CompiledCourse): void {
  console.log(`\nSpeed rings and boost (${course.def.id})`);
  const rings = course.speedRings;
  const gates = course.gates;
  // A straight run through the gates crosses every ring (they sit on the legs) exactly once, in order.
  {
    const s = new RaceSession(course);
    const ev = [...s.start(), ...fly(s, [course.start, ...gates, along(gates[gates.length - 1], 200)])];
    const boosts = ev.filter((e) => e.type === 'boost').map((e) => (e as { index: number }).index);
    const want = rings.map((r) => r.index).join(',');
    if (boosts.join(',') === want && s.phase === 'finished' && s.splits.length === gates.length) {
      ok(`straight run: boost at rings [${boosts.join(',')}], gates and finish unaffected`);
    } else {
      fail(`straight run boosts [${boosts.join(',')}], want [${want}], phase ${s.phase}`);
    }
  }
  // Rings: forward pass once per run, backward and beside-the-ring passes never, none during the countdown.
  {
    const r = rings[0];
    const g = r as unknown as Gate;
    const w = r.radius;
    const s = new RaceSession(course, { strayAbort: 1e6, strayWarn: 1e6 });
    const count = (ev: RaceEvent[]): number => ev.filter((e) => e.type === 'boost').length;
    const cd: RaceEvent[] = [...s.start()];
    for (let t = 0; t < COUNTDOWN_SECONDS - 0.5; t += DT) {
      cd.push(...s.update(DT, t < 1 ? along(g, -5) : along(g, 5), false));
    }
    for (let t = 0; t < 1; t += DT) {
      cd.push(...s.update(DT, along(g, 5), false));
    }
    const duringCountdown = count(cd);
    const running = s.phase === 'running';
    const backwards = count(fly(s, [along(g, 5), along(g, -30)]));
    const beside = count(fly(s, [along(g, -30), along(g, -30, w * 1.3), along(g, 30, w * 1.3), along(g, -30, w * 3)]));
    const forward = count(fly(s, [along(g, -30, w * 3), along(g, -30, w * 0.8), along(g, 30, w * 0.8)]));
    const again = count(fly(s, [along(g, 30, w * 0.8), along(g, 30, w * 3), along(g, -30, w * 3), along(g, -30), along(g, 30)]));
    if (running && duringCountdown === 0 && backwards === 0 && beside === 0 && forward === 1 && again === 0 && s.boostsUsed[r.index]) {
      ok('ring pass: forward inside the rim boosts once per run; backwards, beside the rim and countdown passes do not');
    } else {
      fail(`ring pass: running ${running}, countdown ${duringCountdown}, backwards ${backwards}, beside ${beside}, forward ${forward}, again ${again}`);
    }
  }
  // Boost envelope: total, cap, duration, smoothness.
  {
    const cases: Array<[number, number]> = [
      [35, BOOST_DV],
      [70, BOOST_SPEED_CAP - 70],
      [BOOST_SPEED_CAP, 0],
      [95, 0],
      [Number.NaN, 0],
    ];
    const bad = cases.filter(([v, want]) => Math.abs(boostDeltaV(v) - want) > 1e-9);
    for (const [v, want] of bad) {
      fail(`boostDeltaV(${v}) = ${boostDeltaV(v)}, want ${want}`);
    }
    const env = new BoostEnvelope();
    let speed = 40;
    const total = env.start(speed);
    let sum = 0;
    let t = 0;
    let maxStep = 0;
    let first = -1;
    let lastT = 0;
    while (t < 3) {
      const dv = env.step(DT, speed);
      if (first < 0) {
        first = dv;
      }
      if (dv > 0) {
        lastT = t + DT;
      }
      maxStep = Math.max(maxStep, dv);
      sum += dv;
      speed += dv;
      t += DT;
    }
    // Rate peaks at 2·dv/T (sin² profile).
    const peak = ((2 * BOOST_DV) / BOOST_TIME) * DT;
    const okEnv = Math.abs(sum - total) < 1e-9 && Math.abs(total - BOOST_DV) < 1e-9 && lastT <= BOOST_TIME + DT + 1e-9 && lastT > BOOST_TIME - 2 * DT && maxStep <= peak + 1e-9 && first < maxStep / 4 && !env.active;
    // Near the cap the push never takes the speed over the cap, even when the speed rises by itself meanwhile.
    const nearCap = new BoostEnvelope();
    let v = 72;
    nearCap.start(v);
    let over = 0;
    for (let k = 0; k < 60; k++) {
      const before = v;
      v += nearCap.step(DT, v);
      over = Math.max(over, v - Math.max(BOOST_SPEED_CAP, before));
      v += 0.1; // diving acceleration
    }
    const top = BOOST_SPEED_CAP + over;
    if (okEnv && top <= BOOST_SPEED_CAP + 1e-9 && bad.length === 0) {
      ok(`envelope: +${total} m/s over ${lastT.toFixed(2)} s (peak ${(maxStep / DT).toFixed(1)} m/s², sums exactly), capped at ${BOOST_SPEED_CAP} m/s (below the 80–90 m/s dive envelope)`);
    } else {
      fail(`envelope: sum ${sum} of ${total}, last step at ${lastT.toFixed(2)} s, max step ${maxStep.toFixed(3)} (peak ${peak.toFixed(3)}), first ${first.toFixed(4)}, near-cap top ${top.toFixed(2)}`);
    }
  }
}

/** Synthetic world for placement tests: flat land at 50 m for x < 0, sea (floor -20 m) for x ≥ 0, a 120 m building
 * at 1000 < x < 1100 and a bridge deck from 64 to 68 m over 2000 < x < 2100. */
const testProbe: PlacementProbe = {
  terrainAt: (x) => (x < 0 ? 50 : -20),
  surfaceAt: (x) => (x > 1000 && x < 1100 ? 120 : x > 2000 && x < 2100 ? 68 : x < 0 ? 50 : 0),
  solidAt: (x, y, _z, r) => (x > 1000 && x < 1100 && y - r < 120) || (x > 2000 && x < 2100 && y + r > 64 && y - r < 68),
};

function customCourseTests(env: Env): void {
  console.log('\nCustom courses: share codes, storage, editor validation');
  const mk = (id: string, name: string): CustomCourse => {
    const gates = [
      { x: 2000, y: 80, z: -1000, r: GATE_SIZES.medium, h: 0, p: 0 },
      { x: 2000, y: 90, z: -1600, r: GATE_SIZES.small, h: 10, p: 3 },
      { x: 2150, y: 85, z: -2200, r: GATE_SIZES.large, h: 25, p: -2 },
      { x: 2400, y: 70, z: -2800, r: GATE_SIZES.medium, h: 30, p: -5 },
    ];
    const rings = [
      { x: 2000, y: 85, z: -1300, h: 0, p: 2 },
      { x: 2270, y: 78, z: -2500, h: 27, p: -3 },
    ];
    return { id: id || customCourseId(gates, rings), name, gates, rings };
  };
  // Round trip (Turkish name, UTF-8), id from the geometry.
  const c = mk('', 'Kız Kulesi – Üsküdar şöleni ğ');
  const code = encodeCourseCode(c);
  const back = decodeCourseCode(`  ${code.slice(0, 20)}\n${code.slice(20)}  `);
  if (back.ok && JSON.stringify(back.course) === JSON.stringify(c) && back.course.id === c.id) {
    ok(`share code round trip: ${c.gates.length} gates + ${c.rings.length} rings → ${code.length} chars (${code.slice(0, 18)}…), name and id kept`);
  } else {
    fail(`share code round trip: ${JSON.stringify(back)}`);
  }
  // Malformed codes.
  const b64 = (o: unknown): string => 'EVR1.' + Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
  const payload = { v: 1, n: 'x', g: c.gates.map((g) => [g.x, g.y, g.z, g.r, g.h, g.p]) };
  const gatesWith = (i: number, v: unknown[]): unknown => ({ ...payload, g: payload.g.map((g, k) => (k === i ? v : g)) });
  const malformed: Array<[string, unknown]> = [
    ['empty', ''],
    ['not a string', 42],
    ['null', null],
    ['garbage', 'hello world'],
    ['prefix only', 'EVR1.'],
    ['bad characters', 'EVR1.ab$d'],
    ['other version prefix', code.replace('EVR1.', 'EVR2.')],
    ['truncated', code.slice(0, code.length - 9)],
    ['not JSON', 'EVR1.' + Buffer.from('{not json', 'utf8').toString('base64url')],
    ['invalid UTF-8', 'EVR1.' + Buffer.from([0x7b, 0xff, 0xfe, 0x7d]).toString('base64url')],
    ['top-level array', b64([1, 2, 3])],
    ['version 2', b64({ ...payload, v: 2 })],
    ['extra key', b64({ ...payload, x: 1 })],
    ['name not a string', b64({ ...payload, n: 5 })],
    ['two gates', b64({ ...payload, g: payload.g.slice(0, 2) })],
    ['33 gates', b64({ ...payload, g: Array.from({ length: 33 }, (_, i) => [i * 100, 80, 0, 22, 90, 0]) })],
    ['fractional coordinate', b64(gatesWith(1, [2000.5, 90, -1600, 14, 10, 3]))],
    ['unknown radius', b64(gatesWith(1, [2000, 90, -1600, 17, 10, 3]))],
    ['outside the world', b64(gatesWith(1, [30000, 90, -1600, 14, 10, 3]))],
    ['heading 360', b64(gatesWith(1, [2000, 90, -1600, 14, 360, 3]))],
    ['pitch 80', b64(gatesWith(1, [2000, 90, -1600, 14, 10, 80]))],
    ['string in gate', b64(gatesWith(1, [2000, '90', -1600, 14, 10, 3]))],
    ['gate too short', b64(gatesWith(1, [2000, 90, -1600, 14, 10]))],
    ['gates 20 m apart', b64(gatesWith(1, [2000, 80, -1020, 14, 10, 3]))],
    ['bad speed ring', b64({ ...payload, s: [[1, 2, 3]] })],
    ['17 speed rings', b64({ ...payload, s: Array.from({ length: 17 }, () => [0, 80, 0, 0, 0]) })],
    ['huge', 'EVR1.' + 'A'.repeat(5000)],
  ];
  const accepted = malformed.filter(([, v]) => decodeCourseCode(v).ok);
  if (accepted.length === 0) {
    ok(`${malformed.length} malformed codes rejected`);
  } else {
    for (const [name] of accepted) {
      fail(`malformed code accepted: ${name}`);
    }
  }
  const control = decodeCourseCode(b64({ ...payload, n: 'a\u0000b‮  c   d' }));
  if (!control.ok || control.course.name !== 'ab c d') {
    fail(`name sanitising: ${JSON.stringify(control)}`);
  }

  // Compiled custom course: gates face their stored heading, default medals, a straight run finishes.
  {
    const cc = compileCustomCourse(c, '');
    const g1 = cc.gates[1];
    const d = facing(10, 3);
    const medals = defaultMedalTimes(timedDistance(cc));
    const s = new RaceSession(cc, { strayAbort: 1e6, strayWarn: 1e6 });
    s.start();
    fly(s, [cc.start, ...cc.gates.map((g) => along(g, -40)).flatMap((p, i) => [p, along(cc.gates[i], 40)])]);
    const facingOk = Math.abs(g1.nx - d[0]) < 1e-9 && Math.abs(g1.ny - d[1]) < 1e-9 && Math.abs(g1.nz - d[2]) < 1e-9;
    const posOk = Math.abs(g1.x - 2000) < 1e-6 && Math.abs(g1.z + 1600) < 1e-6;
    if (facingOk && posOk && JSON.stringify(cc.def.medals) === JSON.stringify(medals) && s.phase === 'finished' && cc.speedRings.length === 2 && cc.speedRings[0].radius === SPEED_RING_RADIUS) {
      ok(`compiled custom course: stored facing, exact positions, default medals ${medals.gold}/${medals.silver}/${medals.bronze} s, a run through it finishes`);
    } else {
      fail(`compiled custom course: facing ${facingOk}, position ${posOk}, medals ${JSON.stringify(cc.def.medals)} vs ${JSON.stringify(medals)}, phase ${s.phase}`);
    }
  }

  // Storage (in memory in Node): save, duplicate, replace, limit, delete.
  {
    const first = saveCustomCourse(c);
    const dup = saveCustomCourse({ ...c, name: 'kopya' });
    const moved = { ...c, gates: c.gates.map((g) => ({ ...g, y: g.y + 5 })) };
    moved.id = customCourseId(moved.gates, moved.rings);
    const replaced = saveCustomCourse(moved, c.id);
    const afterReplace = loadCustomCourses().map((x) => x.id);
    let limitHit = false;
    for (let i = 0; i < CUSTOM_LIMIT + 2; i++) {
      const x = { ...c, gates: c.gates.map((g) => ({ ...g, x: g.x + (i + 1) * 3 })) };
      x.id = customCourseId(x.gates, x.rings);
      const r = saveCustomCourse(x);
      if (!r.ok && r.error === 'limit') {
        limitHit = true;
      }
    }
    const count = loadCustomCourses().length;
    const deleted = deleteCustomCourse(moved.id);
    if (
      first.ok && !dup.ok && dup.error === 'duplicate' && replaced.ok && afterReplace.includes(moved.id) && !afterReplace.includes(c.id) &&
      limitHit && count === CUSTOM_LIMIT && deleted && loadCustomCourses().length === CUSTOM_LIMIT - 1
    ) {
      ok(`storage: duplicates refused, edit replaces in place, max ${CUSTOM_LIMIT} courses, delete`);
    } else {
      fail(`storage: ${JSON.stringify({ first: first.ok, dup, replaced: replaced.ok, afterReplace, limitHit, count, deleted })}`);
    }
    for (const x of loadCustomCourses().slice()) {
      deleteCustomCourse(x.id);
    }
  }

  // Placement validation on the synthetic world.
  {
    const cases: Array<[string, [number, number, number, number, number, number], string | null]> = [
      ['over land, high enough', [-500, 80, 0, 22, 0, 0], null],
      ['over land, rim in the ground', [-500, 60, 0, 14, 0, 0], 'terrain'],
      ['low over the sea', [500, 20, 0, 14, 0, 0], null],
      ['rim in the sea', [500, 10, 0, 14, 0, 0], 'terrain'],
      ['pitched ring clears the ground', [-500, 70, 0, 14, 0, 40], null],
      ['inside a building', [1050, 90, 0, 14, 0, 0], 'structure'],
      ['above the building', [1050, 150, 0, 14, 0, 0], null],
      ['under the bridge deck', [2050, 30, 0, 11, 90, 0], null],
      ['touching the deck', [2050, 55, 0, 14, 90, 0], 'structure'],
      ['outside the world', [30000, 80, 0, 14, 0, 0], 'bounds'],
      ['not finite', [Number.NaN, 80, 0, 14, 0, 0], 'bounds'],
    ];
    const bad = cases.filter(([, a, want]) => validateRingPlacement(a[0], a[1], a[2], a[3], a[4], a[5], testProbe) !== want);
    const noSolid = validateRingPlacement(2050, 30, 0, 11, 90, 0, { terrainAt: testProbe.terrainAt, surfaceAt: testProbe.surfaceAt });
    if (bad.length === 0 && noSolid === 'structure') {
      ok(`placement: ${cases.length + 1} synthetic cases (ground, sea, building, under a deck, bounds; no solid test = conservative)`);
    } else {
      for (const [name, a, want] of bad) {
        fail(`placement ${name}: ${validateRingPlacement(a[0], a[1], a[2], a[3], a[4], a[5], testProbe)}, want ${want}`);
      }
      if (noSolid !== 'structure') {
        fail(`placement without solid test under a deck: ${noSolid}`);
      }
    }
    // Real terrain: inside the Çamlıca hill vs high over the Bosphorus.
    const hill = env.geo.landmark('camlica-kulesi');
    const real: PlacementProbe = { terrainAt: (x, z) => env.geo.heightAt(x, z) };
    if (hill) {
      const hy = env.geo.heightAt(hill.x + 150, hill.z);
      const inHill = validateRingPlacement(hill.x + 150, hy - 5, hill.z, 22, 90, 0, real);
      const bridge = env.geo.landmark('bogazici-koprusu')!;
      const overSea = validateRingPlacement(bridge.x, 120, bridge.z + 400, 22, 0, 0, real);
      if (inHill === 'terrain' && overSea === null) {
        ok(`placement on the real terrain: inside Çamlıca hill (ground ${hy.toFixed(0)} m) rejected, 120 m over the Bosphorus accepted`);
      } else {
        fail(`placement on the real terrain: hill ${inHill}, sea ${overSea}`);
      }
    }
  }

  // Editor: facing from the flight direction, spacing, undo, skip invalid, too few, lead-in.
  {
    const pose = (x: number, y: number, z: number, vx = 0, vy = 0, vz = -35): EditorPose => ({ x, y, z, vx, vy, vz, headingDeg: 0 });
    const f1 = poseFacing(pose(0, 0, 0, 30, 30, -30));
    const f2 = poseFacing(pose(0, 0, 0, 0.5, 0, 0.5));
    const facingOk = Math.abs(f1.h - 45) < 1e-9 && Math.abs(f1.p - 35.26) < 0.01 && f2.h === 0 && f2.p === 0;
    const steep = poseFacing(pose(0, 0, 0, 0, -80, -10)).p;

    const ed = new CourseEditor();
    ed.reset();
    const a = ed.place(pose(500, 80, 0), testProbe);
    const tooClose = ed.place(pose(500, 80, -30), testProbe);
    ed.cycleSize(); // large
    const b = ed.place(pose(500, 85, -600), testProbe);
    ed.toggleKind();
    const ring = ed.place(pose(500, 85, -900), testProbe);
    ed.toggleKind();
    const buried = ed.place(pose(-500, 55, -1300), testProbe); // over land: rim in the ground
    const c3 = ed.place(pose(500, 90, -1800), testProbe);
    const built = ed.build('  Deneme\tparkuru  ', testProbe);
    const undone = ed.undo();
    const tooFew = ed.build('x', testProbe);
    const okPlace = a.ok && !a.problem && !tooClose.ok && tooClose.reason === 'spacing' && b.ok && ring.ok && ring.kind === 'ring' && buried.ok && buried.problem === 'terrain' && c3.ok;
    const okBuild = built.ok && built.skippedGates === 1 && built.course.gates.length === 3 && built.course.rings.length === 1 && built.course.name === 'Deneme parkuru' && built.course.gates[1].r === GATE_SIZES.large;
    const okUndo = undone === 'gate' && !tooFew.ok && tooFew.error === 'tooFew' && tooFew.valid === 2;
    // Lead-in: first gate facing away from a wall of land 150 m behind it.
    const cliff: PlacementProbe = { terrainAt: (_x, z) => (z > 150 ? 400 : -20) };
    const ed2 = new CourseEditor();
    ed2.reset();
    ed2.place(pose(0, 60, 0), cliff);
    ed2.place(pose(0, 60, -500), cliff);
    ed2.place(pose(0, 60, -1000), cliff);
    const blocked = ed2.build('x', cliff);
    if (facingOk && steep === -40 && okPlace && okBuild && okUndo && !blocked.ok && blocked.error === 'leadIn') {
      ok('editor: facing from velocity (pitch clamped ±40°), spacing refused, invalid gate shown then skipped on save, undo, min 3 gates, blocked lead-in refused');
    } else {
      fail(`editor: ${JSON.stringify({ facingOk, steep, a, tooClose, b, ring, buried, c3, built: built.ok ? { ...built, course: built.course.name } : built, undone, tooFew, blocked })}`);
    }
  }
}

const t0 = Date.now();
const geo = buildHeadlessGeo();
console.log(`GeoQuery built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const volumes = landmarkVolumes(geo.landmarks);
const t1 = Date.now();
const bridges = buildBridgeColliders(geo);
console.log(`Bridge structures built in ${((Date.now() - t1) / 1000).toFixed(1)} s: ${[...bridges].map(([id, c]) => `${id} (${c.length})`).join(', ')}`);
const env: Env = { geo, volumes, bridges };
const compiled = COURSES.map(compileCourse);
let underGates = 0;
for (const c of compiled) {
  underGates += checkCourse(env, c).underGates;
}
if (underGates === 0) {
  fail('no course has a gate under a bridge');
}
bridgeReport(env);
for (const c of compiled) {
  logicTests(c);
}
unitTests(compiled[0]);
medalTests(compiled);
formatTests();
ghostTests(compiled[0]);
for (const c of compiled) {
  speedRingTests(c);
}
customCourseTests(env);

console.log('\nCourse            gates   length   est. @35 m/s');
for (const c of compiled) {
  console.log(`${c.def.name.padEnd(16)} ${String(c.gates.length).padStart(6)} ${(c.length / 1000).toFixed(2).padStart(6)} km   ${formatTime(c.length / RACE_PACE)}`);
}
console.log(failures === 0 ? '\nAll race checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
