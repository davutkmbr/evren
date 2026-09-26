/**
 * Motion segmentation of the flow system: turns the continuous flight state into motions (MotionDescriptor).
 *
 * - Named motions start on the sim's `maneuver` event (any id except hints and the flow's own captions) and end on the
 *   move's `ended` event, on the next named start, or once the maneuver system is idle and the manoeuvring has settled.
 * - Unnamed motions are found from the state alone: an activity signal (rotation rate, load factor away from 1 g,
 *   a steep path) above 1 for FLOW.startHold opens one, below FLOW.endLevel for FLOW.endHold closes it. A hand-flown
 *   carve, zoom or dive is a motion just like a named move.
 *
 * Every substep it integrates the specific energy net of the dragon's own muscle work against the reference loss of
 * plain gliding (the sim's own drag model: lift = weight, the cruise wing, no ground effect), so drag cuts, the ground
 * effect and rising air show up as saved energy and wasteful manoeuvring as lost energy.
 */
import { clamp } from '../../../core/math/noise';
import { evaluateWingShape, airDensity, ceilingFactor, createWingShape } from '../aero';
import { FLAP, GRAVITY, MASS, PROXIMITY } from '../params';
import type { FlightSim } from '../sim';
import { proximity } from './harmony';
import { FLOW } from './params';
import { copySnapshot, createSnapshot, type MotionDescriptor, type MotionSnapshot } from './types';

const TWO_PI = Math.PI * 2;
/** Ring buffer of recent samples (s) for the handover windows. */
const RING_SECONDS = 3.5;
const RING_STRIDE = 6;
/** Spacing of the finite differences for jerk (s). */
const JERK_SPACING = 0.05;
/** A named motion without an end event closes this long after the maneuver system went idle (s). */
const NAMED_IDLE = 0.15;
/** ... and at the latest this long after, even while the manoeuvring goes on (s). */
const NAMED_SETTLE = 1.5;
/** Maneuver ids that are not motions (a refused move's hint, the plain take-off, the flow's own captions). */
const NOT_MOTIONS: ReadonlySet<string> = new Set(['hint', 'takeoff', 'flow']);

const _shape = createWingShape();

/**
 * Specific energy rate of plain gliding (J/kg/s, ≤ 0) at airspeed V and height y: lift = weight with the cruise wing
 * the normal law picks for that speed (FlightController.normalLaw), no ground effect, no brake.
 */
export function referenceGlideRate(V: number, y: number): number {
  if (V < 8) {
    return 0;
  }
  const rho = airDensity(y) * ceilingFactor(y);
  const qbar = 0.5 * rho * V * V;
  const W = MASS * GRAVITY;
  const areaNeeded = W / (qbar * 0.32 + 1);
  const spread = clamp((areaNeeded - 20) / 70, 0.6, 1);
  const shape = evaluateWingShape(spread, (1 - spread) * 1.3, 0, _shape);
  const cl = Math.min(W / (qbar * shape.area), 1.5);
  const drag = qbar * (shape.area * shape.inducedFactor * cl * cl + shape.parasiteArea);
  return (-drag * V) / MASS;
}

interface OpenMotion {
  id: string | null;
  entry: MotionSnapshot;
  startNet: number;
  startRef: number;
  startMuscle: number;
  gap: number;
  gapNet: number;
  gapRef: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  headingStart: number;
  headingTurned: number;
  prevHeading: number;
  loadSum: number;
  time: number;
  worldPeak: number;
  worldSum: number;
  minClearance: number;
  passTightness: number;
  contact: boolean;
  stalled: boolean;
  entryRates: [number, number, number];
  entryCount: number;
  earlyPath: [number, number, number];
  jerkDone: boolean;
  jerkLoad: number;
  jerkRate: number;
  prePeakSpeed: number;
  verdict: boolean | null;
  idle: number;
}

function headingOf(s: MotionSnapshot): number {
  return Math.atan2(s.pathX, -s.pathZ);
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class MotionSegmenter {
  /** Current state (updated every substep). */
  readonly now = createSnapshot();
  /** State of the previous substep (a move's entry: before the move changed anything). */
  readonly before = createSnapshot();
  /** Cumulative net / reference energy change and muscle work since the reset (J/kg). */
  cumNet = 0;
  cumRef = 0;
  cumMuscle = 0;
  /** Low-passed activity (≥ 1: manoeuvring). */
  activity = 0;
  /** Reference glide rate and the low-passed excess loss rate (J/kg/s). */
  refRate = 0;
  wasteRate = 0;
  /** Proximity 0..1 now. */
  proximityNow = 0;
  /** Open motion (null: steady flight). */
  open: OpenMotion | null = null;
  /** Sim time and cumulative energies at the end of the last motion. */
  lastEnd = -Infinity;
  private lastEndNet = 0;
  private lastEndRef = 0;
  private above = 0;
  private below = 0;
  /** After a named motion, the activity must settle before an unnamed one can start. */
  private armed = true;
  private started = false;
  private energy = 0;
  private load = 1;
  private rx = 0;
  private ry = 0;
  private rz = 0;
  private prevGait = 0;
  private readonly ring: Float64Array;
  private ringHead = 0;
  private ringCount = 0;
  private passT = -Infinity;
  private passTight = 0;
  private pendingNamed: { id: string } | null = null;
  private pendingEnd: { id: string; clean: boolean } | null = null;

  constructor(private readonly onMotion: (d: MotionDescriptor) => void) {
    this.ring = new Float64Array(Math.ceil(RING_SECONDS * 120) * RING_STRIDE);
  }

  reset(): void {
    this.cumNet = 0;
    this.cumRef = 0;
    this.cumMuscle = 0;
    this.activity = 0;
    this.refRate = 0;
    this.wasteRate = 0;
    this.open = null;
    this.lastEnd = -Infinity;
    this.lastEndNet = 0;
    this.lastEndRef = 0;
    this.above = 0;
    this.below = 0;
    this.armed = true;
    this.started = false;
    this.ringHead = 0;
    this.ringCount = 0;
    this.passT = -Infinity;
    this.passTight = 0;
    this.pendingNamed = null;
    this.pendingEnd = null;
  }

  /** Re-bases the energy integration after an external velocity change (speed ring push, teleport). */
  rebase(sim: FlightSim): void {
    const v = sim.body.velocity;
    const w = sim.wind.velocity;
    const V2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2 + (v.z - w.z) ** 2;
    this.energy = 0.5 * V2 + GRAVITY * sim.body.position.y;
  }

  /**
   * Books a known outside push (J/kg of kinetic energy, a chain burst) as not the dragon's: the energy integration is
   * offset by exactly that amount, keeping its one-substep lag (the airspeed is sampled at the start of a substep), so
   * the physics' own losses over the push stay in the books.
   */
  external(dE: number): void {
    this.energy += dE;
  }

  /** A gate or speed ring pass (tightness 0..1) at the current time. */
  notePass(tightness: number, t: number): void {
    this.passTight = Math.max(tightness, t - this.passT < FLOW.passHold ? this.passTight : 0);
    this.passT = t;
    if (this.open) {
      this.open.passTightness = Math.max(this.open.passTightness, tightness);
    }
  }

  /** A `maneuver` event (called from FlightSim.emit, mid-substep: handled on the next sample). */
  maneuver(id: string, ended: boolean, clean: boolean): void {
    if (NOT_MOTIONS.has(id)) {
      return;
    }
    if (ended) {
      this.pendingEnd = { id, clean };
    } else {
      this.pendingNamed = { id };
    }
  }

  /** True while the maneuver system or a ground / water move is running something. */
  private busy(sim: FlightSim): boolean {
    const m = sim.maneuvers;
    return (
      m.active ||
      m.powerActive ||
      m.urging ||
      sim.skim.active ||
      sim.mode === 'takeoff' ||
      sim.mode === 'landing' ||
      sim.mode === 'underwater' ||
      (sim.mode === 'grounded' && (sim.moves.runOut || sim.moves.leap !== null))
    );
  }

  /** Every substep, after the physics. */
  sample(sim: FlightSim, h: number): void {
    const t = sim.time;
    copySnapshot(this.now, this.before);
    const airborne = sim.airborne;
    const V = sim.airspeed;
    const y = sim.body.position.y;
    const E = 0.5 * V * V + GRAVITY * y;
    if (!this.started) {
      this.started = true;
      this.energy = E;
      this.load = sim.lift / (MASS * GRAVITY);
      const w = sim.body.angularVelocity;
      this.rx = w.x;
      this.ry = w.y;
      this.rz = w.z;
    }
    const dE = E - this.energy;
    this.energy = E;
    // Energy bookkeeping: net of muscle work against plain gliding. Neutral on the ground, in the water and in the
    // deliberately slow modes (a landing approach or a hover sheds energy on purpose).
    const judged = airborne && sim.mode !== 'landing' && sim.mode !== 'hovering';
    this.refRate = judged ? referenceGlideRate(V, y) : 0;
    if (judged && V >= 8) {
      const muscle = sim.musclePower * h;
      this.cumMuscle += muscle;
      this.cumNet += dE - muscle;
      this.cumRef += this.refRate * h;
      const excess = Math.max(0, this.refRate - (dE - muscle) / h);
      this.wasteRate += (excess - this.wasteRate) * (1 - Math.exp(-h / FLOW.wasteTau));
    } else {
      this.cumNet += dE;
      this.cumRef += dE;
      this.wasteRate *= Math.exp(-h / FLOW.wasteTau);
    }
    // Filtered load (lift only: the wing beat's own force does not count) and body rates.
    const w = sim.body.angularVelocity;
    const nLift = airborne ? sim.lift / (MASS * GRAVITY) : 1;
    this.load += (nLift - this.load) * (1 - Math.exp(-h / FLOW.loadTau));
    const kr = 1 - Math.exp(-h / FLOW.rateTau);
    this.rx += (w.x - this.rx) * kr;
    this.ry += (w.y - this.ry) * kr;
    this.rz += (w.z - this.rz) * kr;
    this.capture(sim, h, E);
    this.push(t);
    // Activity (cruising flight only).
    const cruising = sim.mode === 'flying' || sim.mode === 'gliding' || sim.mode === 'diving' || sim.mode === 'stalling';
    const raw = cruising
      ? Math.max(Math.hypot(this.rx, this.ry, this.rz) / FLOW.rotationScale, Math.abs(this.load - 1) / FLOW.loadScale, Math.abs(sim.gamma) / FLOW.pathScale)
      : 0;
    this.activity += (raw - this.activity) * (1 - Math.exp(-h / FLOW.activityTau));
    this.proximityNow = airborne ? proximity(this.now.clearance, this.now.ceilingGap, this.now.updraft, V) : 0;

    // Named starts and ends reported during this substep.
    if (this.pendingNamed) {
      const id = this.pendingNamed.id;
      this.pendingNamed = null;
      // A new named start always closes what runs (the same move again is a new motion).
      if (this.open) {
        this.close(sim, t);
      }
      this.begin(sim, id, t);
    }
    const o = this.open;
    if (o) {
      this.accumulate(sim, o, h, t);
    }
    if (this.pendingEnd) {
      const end = this.pendingEnd;
      this.pendingEnd = null;
      if (this.open && this.open.id === end.id) {
        this.open.verdict = end.clean;
        this.close(sim, t);
      }
    }
    const cur = this.open;
    if (cur) {
      if (cur.id !== null) {
        cur.idle = this.busy(sim) ? 0 : cur.idle + h;
        if ((cur.idle >= NAMED_IDLE && this.activity < FLOW.endLevel) || cur.idle >= NAMED_SETTLE || cur.time >= FLOW.maxDuration) {
          this.close(sim, t, cur.time >= FLOW.maxDuration);
        }
      } else {
        this.below = this.activity < FLOW.endLevel ? this.below + h : 0;
        if (this.below >= FLOW.endHold || !cruising || cur.time >= FLOW.maxDuration) {
          this.close(sim, t, cur.time >= FLOW.maxDuration);
        }
      }
      return;
    }
    // Unnamed motions.
    if (!this.armed) {
      this.armed = this.activity < FLOW.endLevel;
      this.above = 0;
      return;
    }
    this.above = cruising && this.activity > 1 ? this.above + h : 0;
    if (this.above >= FLOW.startHold) {
      this.begin(sim, null, t - this.above);
      this.above = 0;
      this.below = 0;
    }
  }

  private capture(sim: FlightSim, h: number, E: number): void {
    const s = this.now;
    const V = sim.airspeed;
    s.t = sim.time;
    s.speed = V;
    if (V > 0.5) {
      s.pathX = sim.airVelocity.x / V;
      s.pathY = sim.airVelocity.y / V;
      s.pathZ = sim.airVelocity.z / V;
    } else {
      const f = sim.axes.forward;
      s.pathX = f.x;
      s.pathY = f.y;
      s.pathZ = f.z;
    }
    s.height = sim.body.position.y;
    s.energy = E;
    s.bank = sim.bank;
    s.pitch = sim.pitch;
    s.gamma = sim.gamma;
    s.rateX = this.rx;
    s.rateY = this.ry;
    s.rateZ = this.rz;
    s.load = this.load;
    // The active natural rhythm: wing beat in the air, swim stroke in the water, gait on the ground.
    if (sim.mode === 'swimming' || sim.mode === 'underwater') {
      s.rhythmPhase = sim.swimPhase;
      s.rhythmAmount = sim.swimStroke;
      s.rhythmFreq = sim.swimFreq;
      s.rhythmBreakA = 0;
      s.rhythmBreakB = Math.PI;
    } else if (sim.mode === 'grounded') {
      const d = (((sim.walkPhase - this.prevGait) % TWO_PI) + TWO_PI) % TWO_PI;
      s.rhythmPhase = sim.walkPhase;
      s.rhythmAmount = sim.walkAmount;
      s.rhythmFreq = d < Math.PI ? d / (TWO_PI * h) : 0;
      s.rhythmBreakA = 0;
      s.rhythmBreakB = Math.PI;
    } else {
      s.rhythmPhase = sim.beat.phase;
      s.rhythmAmount = sim.beat.amplitude;
      s.rhythmFreq = sim.beat.frequency;
      s.rhythmBreakA = 0;
      s.rhythmBreakB = TWO_PI * FLAP.downstrokeFraction;
    }
    this.prevGait = sim.walkPhase;
    s.clearance = sim.footClearance;
    s.ceilingGap = Number.isFinite(sim.ceilingY) ? sim.ceilingY - s.height - PROXIMITY.headroom : Infinity;
    s.updraft = sim.airborne ? sim.wind.updraft : 0;
    s.airborne = sim.airborne;
    s.stamina = sim.stamina;
  }

  private push(t: number): void {
    const n = this.ring.length / RING_STRIDE;
    const i = this.ringHead * RING_STRIDE;
    this.ring[i] = t;
    this.ring[i + 1] = this.load;
    this.ring[i + 2] = this.rx;
    this.ring[i + 3] = this.ry;
    this.ring[i + 4] = this.rz;
    this.ring[i + 5] = this.now.speed;
    this.ringHead = (this.ringHead + 1) % n;
    this.ringCount = Math.min(this.ringCount + 1, n);
  }

  /** Visits the ring samples with t in [t0, t1], oldest first. */
  private visit(t0: number, t1: number, fn: (base: number) => void): void {
    const n = this.ring.length / RING_STRIDE;
    for (let k = this.ringCount; k >= 1; k--) {
      const base = ((this.ringHead - k + n) % n) * RING_STRIDE;
      const tt = this.ring[base];
      if (tt >= t0 && tt <= t1) {
        fn(base);
      }
    }
  }

  private jerkWindow(t0: number, t1: number): { load: number; rate: number } {
    let jl = 0;
    let jr = 0;
    const n = this.ring.length / RING_STRIDE;
    const r = this.ring;
    for (let k = this.ringCount; k >= 1; k--) {
      const idx = (this.ringHead - k + n) % n;
      const base = idx * RING_STRIDE;
      const tt = r[base];
      if (tt < t0 || tt > t1) {
        continue;
      }
      // Sample JERK_SPACING earlier.
      let j = k + 1;
      let prevBase = -1;
      while (j <= this.ringCount) {
        const b = ((this.ringHead - j + n) % n) * RING_STRIDE;
        if (tt - r[b] >= JERK_SPACING - 1e-9) {
          prevBase = b;
          break;
        }
        j++;
      }
      if (prevBase < 0) {
        continue;
      }
      const dt = tt - r[prevBase];
      jl = Math.max(jl, Math.abs(r[base + 1] - r[prevBase + 1]) / dt);
      jr = Math.max(jr, Math.hypot(r[base + 2] - r[prevBase + 2], r[base + 3] - r[prevBase + 3], r[base + 4] - r[prevBase + 4]) / dt);
    }
    return { load: jl, rate: jr };
  }

  private begin(sim: FlightSim, id: string | null, t: number): void {
    const entry = copySnapshot(id !== null ? this.before : this.now, createSnapshot());
    entry.t = t;
    let peak = entry.speed;
    this.visit(t - FLOW.speedPeakWindow, t, (b) => {
      peak = Math.max(peak, this.ring[b + 5]);
    });
    const gap = Number.isFinite(this.lastEnd) ? Math.max(0, t - this.lastEnd) : Infinity;
    this.open = {
      id,
      entry,
      startNet: this.cumNet,
      startRef: this.cumRef,
      startMuscle: this.cumMuscle,
      gap,
      gapNet: Number.isFinite(gap) ? this.cumNet - this.lastEndNet : 0,
      gapRef: Number.isFinite(gap) ? this.cumRef - this.lastEndRef : 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      headingStart: headingOf(entry),
      headingTurned: 0,
      prevHeading: headingOf(entry),
      loadSum: 0,
      time: 0,
      worldPeak: 0,
      worldSum: 0,
      minClearance: Infinity,
      passTightness: sim.time - this.passT < FLOW.passHold ? this.passTight : 0,
      contact: false,
      stalled: false,
      entryRates: [0, 0, 0],
      entryCount: 0,
      earlyPath: [0, 0, 0],
      jerkDone: false,
      jerkLoad: 0,
      jerkRate: 0,
      prePeakSpeed: peak,
      verdict: null,
      idle: 0,
    };
    if (id !== null) {
      this.armed = false;
    }
  }

  private accumulate(sim: FlightSim, o: OpenMotion, h: number, t: number): void {
    const s = this.now;
    o.time += h;
    o.rotX += Math.abs(s.rateX) * h;
    o.rotY += Math.abs(s.rateY) * h;
    o.rotZ += Math.abs(s.rateZ) * h;
    const heading = headingOf(s);
    if (s.speed > 3 && Math.abs(s.pathY) < 0.97) {
      o.headingTurned += wrap(heading - o.prevHeading);
    }
    o.prevHeading = heading;
    o.loadSum += s.load * h;
    o.worldPeak = Math.max(o.worldPeak, this.proximityNow);
    o.worldSum += this.proximityNow * h;
    if (sim.airborne && s.clearance > FLOW.contactClearance && s.speed > FLOW.flyingSpeed) {
      o.minClearance = Math.min(o.minClearance, s.clearance);
    }
    if (sim.airborne && (sim.impact.touched || sim.touchingWater)) {
      o.contact = true;
    }
    if (sim.airborne && (sim.mode === 'stalling' || sim.controller.upset)) {
      o.stalled = true;
    }
    if (o.time <= FLOW.rateWindow) {
      o.entryRates[0] += s.rateX;
      o.entryRates[1] += s.rateY;
      o.entryRates[2] += s.rateZ;
      o.entryCount++;
    }
    if (o.time <= FLOW.earlyPath) {
      o.earlyPath[0] += s.pathX;
      o.earlyPath[1] += s.pathY;
      o.earlyPath[2] += s.pathZ;
    }
    if (!o.jerkDone && o.time >= FLOW.handoverWindow) {
      this.finishJerk(o, t);
    }
  }

  private finishJerk(o: OpenMotion, t: number): void {
    const j = this.jerkWindow(o.entry.t - FLOW.handoverWindow, Math.min(t, o.entry.t + FLOW.handoverWindow));
    o.jerkLoad = j.load;
    o.jerkRate = j.rate;
    o.jerkDone = true;
  }

  /**
   * Closes the open motion at time t and reports it (unless it was too small to be a motion). `timeout`: closed only
   * because it ran FLOW.maxDuration; what follows is its continuation, not a new transition.
   */
  close(sim: FlightSim, t: number, timeout = false): void {
    const o = this.open;
    if (!o) {
      return;
    }
    this.open = null;
    this.below = 0;
    if (!o.jerkDone) {
      this.finishJerk(o, t);
    }
    const duration = Math.max(o.time, 1e-3);
    const exit = copySnapshot(this.now, createSnapshot());
    const rotation = o.rotX + o.rotY + o.rotZ;
    const kinetic = Math.abs(exit.speed - o.entry.speed);
    const small = o.id === null && (duration < FLOW.minDuration || (rotation < FLOW.minRotation && Math.abs(exit.height - o.entry.height) < 8 && kinetic < 3));
    if (small) {
      return;
    }
    const exitRates: [number, number, number] = [0, 0, 0];
    let count = 0;
    this.visit(t - FLOW.rateWindow, t, (b) => {
      exitRates[0] += this.ring[b + 2];
      exitRates[1] += this.ring[b + 3];
      exitRates[2] += this.ring[b + 4];
      count++;
    });
    if (count > 0) {
      exitRates[0] /= count;
      exitRates[1] /= count;
      exitRates[2] /= count;
    }
    const ec = Math.max(o.entryCount, 1);
    const pl = Math.hypot(o.earlyPath[0], o.earlyPath[1], o.earlyPath[2]);
    const earlyPath: [number, number, number] = pl > 1e-6 ? [o.earlyPath[0] / pl, o.earlyPath[1] / pl, o.earlyPath[2] / pl] : [o.entry.pathX, o.entry.pathY, o.entry.pathZ];
    const clean = o.verdict ?? (!o.contact && !o.stalled);
    const d: MotionDescriptor = {
      id: o.id,
      entry: o.entry,
      exit,
      duration,
      energyNet: this.cumNet - o.startNet,
      gapEnergyNet: o.gapNet,
      energyRef: this.cumRef - o.startRef,
      gapEnergyRef: o.gapRef,
      muscleWork: this.cumMuscle - o.startMuscle,
      gap: o.gap,
      rotX: o.rotX,
      rotY: o.rotY,
      rotZ: o.rotZ,
      headingChange: o.headingTurned,
      meanLoad: o.loadSum / duration,
      jerkLoad: o.jerkLoad,
      jerkRate: o.jerkRate,
      entryRates: [o.entryRates[0] / ec, o.entryRates[1] / ec, o.entryRates[2] / ec],
      exitRates,
      earlyPath,
      prePeakSpeed: o.prePeakSpeed,
      worldPeak: o.worldPeak,
      worldMean: o.worldSum / duration,
      minClearance: o.minClearance,
      passTightness: o.passTightness,
      contact: o.contact,
      stalled: o.stalled,
      clean: clean && !o.contact,
    };
    this.lastEnd = timeout ? -Infinity : t;
    this.lastEndNet = this.cumNet;
    this.lastEndRef = this.cumRef;
    this.onMotion(d);
  }
}
