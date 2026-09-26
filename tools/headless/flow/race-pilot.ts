/**
 * Scripted race pilot for the flow balance (tools/headless/race-balance.ts): flies a compiled course through the real
 * FlightSim over the real terrain, with the race session's own gate logic and the speed rings' boost envelope.
 *
 *   plain    steers gate to gate (bank and path targets like a stick), takes the speed rings on the way and beats the
 *            wings with Space while stamina allows (hysteresis); no moves.
 *   chained  the same, plus a skilled line and chained moves: on water legs without a speed ring it dives to a low line
 *            over the sea and zooms back to the gate, it takes the gates on the inside of the turn, and strings moves
 *            along the legs (the least recently used move that fits: a dart at the top of a descent, a power stroke, a
 *            side-slip onto the racing line or a barrel roll when enabled), started on the beat when the wings are
 *            beating. Flow then pays back as less drag and stronger beats.
 */
import { clamp, smoothstep } from '../../../src/core/math/noise';
import { type CompiledCourse, type SpeedRing } from '../../../src/activities/courses';
import { passTightness, RaceSession, type Vec3 } from '../../../src/activities/race';
import { BoostEnvelope } from '../../../src/activities/speed-boost';
import { headingToYaw } from '../../../src/core/geo-coords';
import { DEG, FLAP } from '../../../src/dragon/flight/params';
import type { FlightSim } from '../../../src/dragon/flight/sim';
import { fly, KeyPilot, type Key } from './key-pilot';

export type PilotStyle = 'plain' | 'chained';

export interface RaceRun {
  course: string;
  style: PilotStyle;
  finished: boolean;
  time: number;
  splits: number[];
  meanFlow: number;
  maxFlow: number;
  moves: Record<string, number>;
  rings: number;
  moments: number;
  /** Gates flown past without crossing (the pilot came round again). */
  misses: number;
  /** Chain links (flow/burst.ts), the longest chain and the total burst push (m/s). */
  links: number;
  bestChain: number;
  burstDv: number;
  meanSpeed: number;
  staminaMin: number;
  /** Per motion id ('~' unnamed): count, mean harmony, mean novelty, total flow change. */
  motions: Record<string, { n: number; h: number; novelty: number; delta: number }>;
}

export type MoveName = 'power' | 'dart' | 'slipL' | 'slipR' | 'roll';

const TWO_PI = Math.PI * 2;

/** The maneuver id (flow's kind of motion) each pilot move starts. */
const MOVE_KIND: Record<MoveName, string> = { power: 'power', dart: 'dart', slipL: 'slip', slipR: 'slip', roll: 'roll' };


function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function busy(sim: FlightSim): boolean {
  const m = sim.maneuvers;
  return m.active || m.powerActive;
}

export interface PilotOptions {
  /** Moves the chained pilot may use. */
  moves: MoveName[];
  /** Plain flight between two moves (s): min + random × spread. */
  pauseMin: number;
  pauseSpread: number;
  /** Hold flow payback off (flow still measured): isolates what the moves themselves cost. */
  noPayback: boolean;
  /** Dart only where the line descends (a skim descent, a lower gate ahead). */
  dartDescentOnly: boolean;
  /** Side-slip only this far (m) off the racing line. */
  slipOffset: number;
  /** Wing beats (Space held) resume above this stamina (they stop below 0.3). */
  flapResume: number;
  /** Chained pilot: chain on every leg (1) or only on every n-th leg, flying the others plainly (some chaining). */
  chainEvery: number;
  /** Chained pilot: barrel rolls only this far (m) or more before the next gate. */
  rollGateDistance: number;
  /** Chained pilot: stamina kept in reserve for the wing beats (no power stroke below it). */
  moveStamina: number;
  /** Chained pilot: moves only this far (m) or more before the next gate and with the target at most moveTurn off. */
  moveGateDistance: number;
  moveTurn: number;
  /** Chained pilot: aim this fraction of the gate radius toward the inside of the turn (the racing line). */
  apex: number;
  /** Headless experiments: print a timeline line every this many seconds (0: off). */
  trace?: number;
  /** Headless experiments: hold the flow value here every step (NaN: off). */
  forceFlow?: number;
  /** Chained pilot: on water legs without a speed ring, dive to a skim just over the sea and zoom back to the gate. */
  skimLine: boolean;
}

/** Skim plan of one leg (distances along the leg from its start gate, m), or null. */
interface LegPlan {
  from: Vec3;
  to: Vec3;
  length: number;
  /** Descent from the start gate's height ends at a, the skim runs to b, the zoom to the gate's height ends at c. */
  a: number;
  b: number;
  c: number;
  waterStart: number;
}

/** The low line: foot clearance over the sea (m), water needed either side of the leg (m), descent and zoom angles. */
const SKIM_CLEARANCE = 5;
const SKIM_MARGIN = 25;
const DESCENT = 11 * DEG;
const ZOOM = 13 * DEG;
/** Lag (s) of the flight path behind the pilot's path target, led near a gate so a fast zoom does not overshoot. */
const PATH_LAG = 0.8;
/** The zoom reaches the gate's height this far (m) before the gate, so a fast zoom settles before the ring. */
const ZOOM_FINISH = 150;

/** Plans a low line on a leg: the longest stretch that is water on the line and SKIM_MARGIN either side, with room to descend and zoom. */
function planLeg(geo: FlightSim['world']['geo'], from: Vec3, to: Vec3, skimY: number): LegPlan | null {
  if (!geo) {
    return null;
  }
  const lx = to.x - from.x;
  const lz = to.z - from.z;
  const length = Math.hypot(lx, lz);
  const ux = lx / length;
  const uz = lz / length;
  const step = 30;
  let best = [0, 0];
  let runStart = -1;
  let lowGap = 0;
  for (let d = 0; d <= length; d += step) {
    let water = true;
    for (const side of [-SKIM_MARGIN, 0, SKIM_MARGIN]) {
      const x = from.x + ux * d - uz * side;
      const z = from.z + uz * d + ux * side;
      water &&= geo.isWater(x, z) && geo.heightAt(x, z) < 0.5;
    }
    // A lone low sample (a pier, a quay corner) does not break a water stretch.
    if (!water && runStart >= 0 && lowGap < 1 && geo.heightAt(from.x + ux * d, from.z + uz * d) < 3) {
      lowGap++;
      water = true;
    } else if (water) {
      lowGap = 0;
    }
    if (water && runStart < 0) {
      runStart = d;
    }
    if ((!water || d + step > length) && runStart >= 0) {
      const end = water ? d : d - step;
      if (end - runStart > best[1] - best[0]) {
        best = [runStart, end];
      }
      runStart = -1;
    }
  }
  // The shallow profile first; a short leg gets a steeper one (up to 1.4 times the angles).
  for (const k of [1, 1.2, 1.4]) {
    const descLen = (from.y - skimY) / Math.tan(DESCENT * k);
    const zoomLen = (to.y - skimY) / Math.tan(ZOOM * k);
    const a = Math.max(best[0] + descLen, 150 + descLen);
    const b = Math.min(best[1], length - ZOOM_FINISH) - zoomLen;
    if (b - a >= 120) {
      return { from, to, length, a, b, c: b + zoomLen, waterStart: a - descLen };
    }
  }
  return null;
}

/** Target height along a planned leg at distance u. */
function legHeight(plan: LegPlan, u: number, skimY: number): number {
  const { from, to, a, b, c, waterStart } = plan;
  if (u <= waterStart) {
    return from.y;
  }
  if (u <= a) {
    return from.y + ((skimY - from.y) * (u - waterStart)) / (a - waterStart);
  }
  if (u <= b) {
    return skimY;
  }
  if (u <= c) {
    return skimY + ((to.y - skimY) * (u - b)) / (c - b);
  }
  return to.y;
}

/**
 * Balance pilot (race-balance.ts): strings power strokes, darts and barrel rolls (variety by kind; side-slips onto the
 * racing line are available but made the scripted line miss gates at burst speeds), dives to the low line over the water legs and takes the gates on the inside once the turn settles.
 */
export const DEFAULT_PILOT: PilotOptions = {
  moves: ['power', 'dart', 'roll'],
  pauseMin: 0.1,
  pauseSpread: 1,
  noPayback: false,
  skimLine: true,
  dartDescentOnly: false,
  slipOffset: 15,
  flapResume: 0.55,
  apex: 0.7,
  moveGateDistance: 260,
  moveTurn: 40 * DEG,
  moveStamina: 0.25,
  rollGateDistance: 500,
  chainEvery: 1,
};

export function flyRace(sim: FlightSim, course: CompiledCourse, style: PilotStyle, seed = 1, maxSeconds = 600, opts: PilotOptions = DEFAULT_PILOT): RaceRun {
  const s = course.start;
  sim.teleport(s.x, s.y, s.z, headingToYaw(s.headingDeg), 0, s.speed);
  sim.queueEvents = false;
  sim.flow.payback = !opts.noPayback;
  const session = new RaceSession(course, { strayAbort: 4000, strayWarn: 3000 });
  session.start();
  const pilot = new KeyPilot();
  const boost = new BoostEnvelope();
  const used = new Set<number>();
  let flowSum = 0;
  let flowN = 0;
  let maxFlow = 0;
  let speedSum = 0;
  let staminaMin = 1;
  let flapping = false;
  const moves: Record<string, number> = {};
  const lastUsed: Record<MoveName, number> = { power: -99, dart: -99, slipL: -99, slipR: -99, roll: -99 };
  let rng = seed >>> 0;
  const random = (): number => {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  let lastMoveEnd = -99;
  let wasBusy = false;
  let lastGateT = 0;
  let pending: { move: MoveName; since: number } | null = null;
  let t = 0;
  const frameDt = 1 / 60;
  const plans = new Map<number, LegPlan | null>();
  // Each seed flies its own line: the skim height varies a little (a practising player tries lines).
  const skimClearance = SKIM_CLEARANCE + (seed > 1 ? (random() - 0.5) * 4 : 0);
  const skimY = () => skimClearance + sim.footDepth();

  const decide = (tt: number): void => {
    const p = sim.body.position;
    const v = sim.body.velocity;
    // Race session and speed rings (frame positions).
    const pos: Vec3 = { x: p.x, y: p.y, z: p.z };
    const events = session.update(frameDt, pos, !sim.airborne);
    for (const e of events) {
      if (e.type === 'gate') {
        lastGateT = tt;
        const g = course.gates[e.index];
        sim.flow.notePass(sim, passTightness(g.radius, Math.hypot(p.x - g.x, p.y - g.y, p.z - g.z)));
      } else if (e.type === 'boost') {
        const r = course.speedRings[e.index];
        used.add(e.index);
        boost.start(sim.airspeed);
        sim.flow.notePass(sim, passTightness(r.radius, Math.hypot(p.x - r.x, p.y - r.y, p.z - r.z)), 'ring');
      }
    }
    const dv = boost.step(frameDt, sim.airspeed);
    const len = v.length();
    if (dv > 0 && len > 1) {
      v.addScaledVector(v.clone().divideScalar(len), dv);
      sim.flow.noteExternal(sim);
    }
    if (!session.active) {
      return;
    }
    if (opts.trace && Math.floor(tt / opts.trace) !== Math.floor((tt - frameDt) / opts.trace)) {
      const o = sim.flow.segmenter.open;
      console.log(
        `    t ${tt.toFixed(0).padStart(3)} gate ${session.next} flow ${sim.flow.value.toFixed(2)} V ${sim.airspeed.toFixed(1)} y ${p.y.toFixed(0)} clr ${sim.footClearance.toFixed(1)} st ${sim.stamina.toFixed(2)} ${sim.mode} skim ${sim.skim.amount.toFixed(2)} open ${o ? (o.id ?? '~') : '-'}`,
      );
    }
    // Target: the next gate, or a speed ring still ahead on the current leg.
    const gi = Math.min(session.next, course.gates.length - 1);
    // Some chaining: only every chainEvery-th leg is flown with the skilled line and moves, the others plainly.
    const legChained = style === 'chained' && gi % opts.chainEvery === 0;
    const gate = course.gates[gi];
    let target: Vec3 & { r: number } = { x: gate.x, y: gate.y, z: gate.z, r: gate.radius };
    if (legChained && opts.apex > 0 && gi + 1 < course.gates.length && missed !== gi) {
      // Racing line: pass the gate on the inside of the turn toward the next one (horizontally, within the ring).
      const nx = course.gates[gi + 1];
      const ax = nx.x - gate.x;
      const az = nx.z - gate.z;
      const al = Math.hypot(ax, az) || 1;
      // Component of the next leg's direction across the gate's normal: the inside of the turn.
      const n = Math.hypot(gate.nx, gate.nz) || 1;
      const sx = -gate.nz / n;
      const sz = gate.nx / n;
      const side = (ax / al) * sx + (az / al) * sz;
      // Inside the ring: the lateral offset leaves room for the height still to be corrected.
      const vErr = Math.min(Math.abs(gate.y - p.y), gate.radius);
      // Still turning onto the gate (hard bank): less of the inside line, the arc is not settled yet.
      const settled = clamp(1.5 - Math.abs(sim.bank) / (40 * DEG), 0, 1);
      const off = Math.sqrt(Math.max(0, (opts.apex * gate.radius) ** 2 - vErr * vErr)) * clamp(side * 3, -1, 1) * settled;
      target = { x: gate.x + sx * off, y: gate.y, z: gate.z + sz * off, r: gate.radius };
    }
    // Go-around after a miss: a gate only counts crossed in its direction, so first fly back out to a point in front
    // of it, then take it again through the centre.
    if (missed === gi && goAround) {
      const turnR = (sim.airspeed * sim.airspeed) / (9.81 * Math.tan(62 * DEG));
      const back = Math.max(300, 3 * turnR);
      const bx = gate.x - gate.nx * back;
      const bz = gate.z - gate.nz * back;
      if (Math.hypot(bx - p.x, bz - p.z) < turnR) {
        // Out far enough: turn in and take the gate (latched until it is passed or missed again).
        goAround = false;
      } else {
        target = { x: bx, y: gate.y, z: bz, r: gate.radius };
      }
    }
    const from: Vec3 = gi > 0 ? course.gates[gi - 1] : course.start;
    let ringLeg = false;
    for (let k = 0; k < course.speedRings.length && !goAround; k++) {
      const ring: SpeedRing = course.speedRings[k];
      if (used.has(k)) {
        continue;
      }
      // Ring on this leg (between from and gate) and still ahead of the dragon.
      const lx = gate.x - from.x;
      const lz = gate.z - from.z;
      const l2 = lx * lx + lz * lz;
      const f = ((ring.x - from.x) * lx + (ring.z - from.z) * lz) / Math.max(l2, 1);
      const me = ((p.x - from.x) * lx + (p.z - from.z) * lz) / Math.max(l2, 1);
      const off = Math.abs((ring.x - from.x) * lz - (ring.z - from.z) * lx) / Math.sqrt(Math.max(l2, 1));
      if (f > 0.02 && f < 0.98 && off < 40 && me < f - 0.01) {
        target = { x: ring.x, y: ring.y, z: ring.z, r: ring.radius };
        ringLeg = true;
        break;
      }
    }
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const horiz = Math.hypot(dx, dz);
    const want = Math.atan2(dx, -dz);
    const track = Math.atan2(v.x, -v.z);
    const err = wrap(want - track);
    // Flew past the gate without crossing it: take it through the centre on the next try.
    const beyond = (p.x - gate.x) * gate.nx + (p.y - gate.y) * gate.ny + (p.z - gate.z) * gate.nz;
    if (!ringLeg && beyond > 5 && Math.hypot(gate.x - p.x, gate.z - p.z) < 60 && !goAround && (missed !== gi || tt - missedT > 5)) {
      missed = gi;
      missedT = tt;
      goAround = true;
      misses++;
    }
    if (opts.trace && Math.floor(tt / opts.trace) !== Math.floor((tt - frameDt) / opts.trace)) {
      console.log(`      target d ${horiz.toFixed(0)} dy ${(target.y - p.y).toFixed(0)} err ${(err / DEG).toFixed(0)}° ${extending ? 'extend' : ''}${ringLeg ? ' ring' : ''}`);
    }
    const ov = sim.overrides;
    // A target inside the turn circle and well off the nose cannot be reached by turning harder (the pursuit orbits
    // it): extend straight out to two turn radii, then turn back in.
    const turnR = (sim.airspeed * sim.airspeed) / (9.81 * Math.tan(62 * DEG));
    if (!extending && Math.abs(err) > 70 * DEG && horiz < 1.6 * turnR) {
      extending = true;
    } else if (extending && (horiz > 2.4 * turnR || Math.abs(err) < 30 * DEG)) {
      extending = false;
    }
    ov.bankTarget = extending ? 0 : clamp(err * 2.2, -62 * DEG, 62 * DEG);
    let dy = target.y - p.y;
    let run = Math.max(horiz, 1);
    if (legChained && opts.skimLine && !ringLeg && !goAround) {
      if (!plans.has(gi)) {
        plans.set(gi, planLeg(sim.world.geo, from, gate, skimY()));
      }
      const plan = plans.get(gi);
      if (plan) {
        // Follow the planned height a little ahead along the leg.
        const u = ((p.x - from.x) * (gate.x - from.x) + (p.z - from.z) * (gate.z - from.z)) / plan.length;
        const look = Math.max(sim.airspeed, 20) * 1.2;
        dy = legHeight(plan, u + look, skimY()) - p.y;
        run = look;
      }
    }
    descending = dy < -8 && run < horiz - 1;
    if (!(legChained && opts.skimLine && !ringLeg)) {
      descending = gate.y < p.y - 15;
    }
    const tau = clamp(run / Math.max(sim.airspeed, 10), 0.5, 30);
    // The path follows its target with a lag: lead the height error by the climb (or sink) still to come.
    dy -= v.y * PATH_LAG * smoothstep(3 * sim.airspeed, sim.airspeed, run);
    ov.pathTarget = clamp(Math.atan2(dy, run) + (dy / Math.max(tau, 1)) * 0.01, -0.35, 0.3);
    // Never let a fast low line touch the surface: level off (and climb a little) below the floor.
    const floor = SKIM_CLEARANCE * 0.5;
    if (sim.footClearance < floor) {
      ov.pathTarget = Math.max(ov.pathTarget, 0.04 * (floor - sim.footClearance));
    }
    ov.airspeedTarget = null;
    // Stamina-managed wing beats.
    const st = sim.stamina;
    staminaMin = Math.min(staminaMin, st);
    if (flapping && st < 0.3) {
      flapping = false;
    } else if (!flapping && st > opts.flapResume) {
      flapping = true;
    }
    const wantFlap = flapping && !busy(sim);
    if (wantFlap && !pilot.isHeld('Space')) {
      pilot.down('Space', tt);
    } else if (!wantFlap && pilot.isHeld('Space') && !pendingSpace(tt)) {
      pilot.up('Space', tt);
    }
    const toGate = Math.hypot(gate.x - p.x, gate.z - p.z);
    const legOk = toGate > opts.moveGateDistance && tt - lastGateT > 1 && Math.abs(err) < opts.moveTurn && sim.mode !== 'landing';
    if (!legChained) {
      return;
    }
    // Chained: string moves together on the legs.
    const b = busy(sim);
    if (wasBusy && !b) {
      lastMoveEnd = tt;
    }
    wasBusy = b;
    if (b || !legOk) {
      pending = null;
      return;
    }
    if (!pending) {
      const pick = choose(sim, tt, gate, from, toGate);
      if (!pick) {
        return;
      }
      pending = { move: pick, since: tt };
    }
    // On the beat when the wings are beating (up to 0.35 s of waiting), at once otherwise.
    const beat = sim.beat;
    const split = TWO_PI * FLAP.downstrokeFraction;
    const near = Math.min(Math.abs(wrap(beat.phase)), Math.abs(wrap(beat.phase - split)));
    const onBeat = beat.amplitude < 0.2 || near < 0.25 || tt - pending.since > 0.35;
    if (!onBeat || tt - lastMoveEnd < pause) {
      return;
    }
    const m = pending.move;
    pending = null;
    pause = opts.pauseMin + random() * opts.pauseSpread;
    lastUsed[m] = tt;
    moves[m] = (moves[m] ?? 0) + 1;
    started.push(MOVE_KIND[m]);
    const key: Key = m === 'power' ? 'Space' : m === 'dart' ? 'Shift' : m === 'slipL' ? 'Q' : m === 'slipR' ? 'E' : random() < 0.5 ? 'A' : 'D';
    if (key === 'Space') {
      // Release a held Space first, so both taps are fresh presses.
      pilot.up('Space', tt);
      pilot.double('Space', tt + 0.02);
      spaceUntil = tt + 0.4;
    } else {
      pilot.double(key, tt);
    }
  };

  let spaceUntil = -1;
  let extending = false;
  let missed = -1;
  let goAround = false;
  let missedT = -99;
  /** Kinds of the moves this pilot started, oldest first (flow only learns a motion's kind once it has settled). */
  const started: string[] = [];
  let misses = 0;
  let descending = false;
  let pause = opts.pauseMin;
  const pendingSpace = (tt: number): boolean => tt < spaceUntil;

  /** Least recently used move that fits the moment. */
  const choose = (sim_: FlightSim, tt: number, gate: Vec3, from: Vec3, toGate: number): MoveName | null => {
    const p = sim_.body.position;
    const V = sim_.airspeed;
    const fits: MoveName[] = [];
    const clearance = p.y - sim_.surfaceY;
    const dartLine = opts.dartDescentOnly ? descending : p.y > gate.y - 5;
    if (V > 31 && Math.abs(sim_.gamma) < 18 * DEG && Math.abs(sim_.bank) < 20 * DEG && clearance > 40 && dartLine && toGate > 350) {
      fits.push('dart');
    }
    if (sim_.stamina > opts.moveStamina && !sim_.tired && V < 62) {
      fits.push('power');
    }
    // Side of the racing line (the straight leg to the gate).
    const lx = gate.x - from.x;
    const lz = gate.z - from.z;
    const l = Math.max(Math.hypot(lx, lz), 1);
    const side = ((p.x - from.x) * lz - (p.z - from.z) * lx) / l;
    if (V > 18 && sim_.stamina > 0.15 && Math.abs(side) > opts.slipOffset && clearance > 25) {
      // side > 0: the dragon is left of the line (x right of travel is (-lz, lx)); slip right.
      fits.push(side > 0 ? 'slipR' : 'slipL');
    }
    // Never roll on the way down to the low line (a roll costs height the dive does not have).
    if (V > 26 && clearance > 40 && !descending && Math.abs(sim_.bank) < 25 * DEG && toGate > opts.rollGateDistance) {
      fits.push('roll');
    }
    // Variety: never one of the chain's last two kinds of motion (a repeat keeps the chain but pays nothing); flow only
    // learns a motion's kind once it settles, so the pilot also remembers the move it started last.
    const recent = [...sim_.flow.burst.kinds.slice(-2), ...started.slice(-1)];
    for (let i = fits.length - 1; i >= 0; i--) {
      if (!opts.moves.includes(fits[i]) || recent.includes(MOVE_KIND[fits[i]])) {
        fits.splice(i, 1);
      }
    }
    if (!fits.length) {
      return null;
    }
    fits.sort((a, b2) => lastUsed[a] - lastUsed[b2]);
    // A little spontaneity: sometimes the second least recent.
    const pick = fits.length > 1 && random() < 0.25 ? fits[1] : fits[0];
    return tt - lastUsed[pick] < 2 && fits.length === 1 ? null : pick;
  };

  const motions: RaceRun['motions'] = {};
  let seenTransitions = 0;
  const collect = (): void => {
    const f = sim.flow;
    const fresh = Math.min(f.transitions - seenTransitions, f.log.length);
    for (const l of f.log.slice(f.log.length - fresh)) {
      const k = l.motion.id ?? '~';
      const m = (motions[k] ??= { n: 0, h: 0, novelty: 0, delta: 0 });
      m.n++;
      m.h += l.terms.total;
      m.novelty += l.terms.novelty;
      m.delta += l.delta;
    }
    seenTransitions = f.transitions;
  };
  while (t < maxSeconds && session.phase !== 'finished' && session.phase !== 'aborted') {
    t = fly(sim, pilot, 1, t, () => {
      if (opts.forceFlow !== undefined && !Number.isNaN(opts.forceFlow)) {
        sim.flow.setValue(opts.forceFlow);
      }
      if (session.phase === 'running') {
        flowSum += sim.flow.value;
        flowN++;
        speedSum += sim.airspeed;
        maxFlow = Math.max(maxFlow, sim.flow.value);
      }
      if (sim.flow.transitions !== seenTransitions) {
        collect();
      }
      return session.phase === 'finished' || session.phase === 'aborted';
    }, decide);
  }
  return {
    course: course.def.id,
    style,
    finished: session.phase === 'finished',
    time: session.phase === 'finished' ? session.elapsed : Infinity,
    splits: session.splits.slice(),
    meanFlow: flowSum / Math.max(flowN, 1),
    maxFlow,
    moves,
    rings: used.size,
    moments: sim.flow.moments,
    misses,
    links: sim.flow.burst.totalLinks,
    bestChain: sim.flow.burst.bestChain,
    burstDv: sim.flow.burst.totalDv,
    meanSpeed: speedSum / Math.max(flowN, 1),
    staminaMin,
    motions: Object.fromEntries(Object.entries(motions).map(([k, m]) => [k, { n: m.n, h: m.h / m.n, novelty: m.novelty / m.n, delta: m.delta }])),
  };
}

/**
 * Some chaining: the middle racer of the balance (silver). It flies every other leg like the chained racer (the skilled
 * line and chained moves) and the legs in between plainly, so flow and chains have to be rebuilt leg after leg.
 */
export const SOME_PILOT: PilotOptions = { ...DEFAULT_PILOT, chainEvery: 2 };
