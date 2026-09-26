/**
 * Flow ("Akış", phase 20 stage D): a value 0..1 built by motions that harmonise with each other, paid back as a small,
 * capped, physical advantage (less drag, stronger beats, a stronger power stroke).
 *
 * There is no combo table and no per-move score. Every finished motion (named move or unnamed manoeuvring, see
 * segmenter.ts) is compared with the one before it through the generic harmony terms of harmony.ts; the flow value
 * integrates the result (gain above FLOW.threshold, scaled by novelty and gated by energy stewardship), decays slowly
 * in steady flight and drops on a stall, on contact and on sustained energy waste. When a harmony term peaks the
 * transition is a "Kusursuz" moment: a small extra flow step and a short caption on the maneuver event.
 *
 * Chain bursts (burst.ts): a different move started within a short window after a move ended cleanly (and a speed ring
 * or a tight gate taken while the chain is open) is a chain link: an instant push forward that grows with the chain.
 * One visible rule, fed by the move events; harmony still builds flow.
 *
 * Adding a move: emit the usual `maneuver` start event (and the `ended` event when the move knows when it ends, with
 * its `clean` verdict). Nothing else — the flow system measures the rest from the state. A move that emits nothing is
 * still a motion as soon as it rotates, loads or dives enough for the automatic segmentation.
 */
import { clamp } from '../../../core/math/noise';
import type { FlightSim } from '../sim';
import { BURST, CHAIN_IGNORED, ChainBurst, linkDv, type LinkSource } from './burst';
import { flowDelta, signature, transitionHarmony, type SignatureEntry } from './harmony';
import { DART, POWER_STROKE, SLIP } from '../params';
import { FLOW } from './params';

/** The everyday race moves the next-move hint may suggest, in its order. */
const NEXT_MOVES = ['dart', 'power', 'roll', 'slip'] as const;
import { MotionSegmenter } from './segmenter';
import { createTerms, type HarmonyTerms, type MotionDescriptor } from './types';

/** Caption of a "Kusursuz" moment by the term that peaked (Turkish, player-facing). */
export const FLOW_MOMENT_LABELS = {
  rhythm: 'Kusursuz ritim',
  energy: 'Kusursuz enerji',
  handover: 'Kusursuz geçiş',
  world: 'Kusursuz çizgi',
} as const;

export type FlowMoment = keyof typeof FLOW_MOMENT_LABELS;

/** One evaluated transition (kept for the debug overlay and headless checks). */
export interface FlowTransition {
  motion: MotionDescriptor;
  terms: HarmonyTerms;
  /** Flow change it caused (moment step included) and the flow after it. */
  delta: number;
  flow: number;
  moment: FlowMoment | null;
}

const LOG_SIZE = 32;

export class FlowSystem {
  /** Off: nothing is measured and the value stays 0 (baseline comparisons in headless checks). */
  enabled = true;
  /** Flow 0..1. */
  value = 0;
  /** Off: flow is measured but pays nothing back, no chain bursts either (headless checks isolating the moves' own cost). */
  payback = true;
  /** Chain links and their speed bursts. */
  readonly burst = new ChainBurst();
  /** Size of the chain bursts (1 in races; the game scales them down in free flight). */
  burstScale = 1;
  /** Terms of the last transition. */
  readonly terms: HarmonyTerms = createTerms();
  /** Recent transitions, newest last. */
  readonly log: FlowTransition[] = [];
  /** Number of transitions evaluated and of moments since the reset. */
  transitions = 0;
  moments = 0;
  /** Sim time of the last moment. */
  lastMoment = -Infinity;
  readonly segmenter: MotionSegmenter;
  private readonly history: SignatureEntry[] = [];
  private last: MotionDescriptor | null = null;
  private sim: FlightSim | null = null;
  private stalled = false;
  private touching = false;
  private idleFor = 0;

  constructor() {
    this.segmenter = new MotionSegmenter((d) => this.onMotion(d));
  }

  /** Drag multiplier (all aerodynamic drag): exactly 1 without flow. */
  get dragScale(): number {
    return this.payback ? 1 - FLOW.dragCut * this.value : 1;
  }

  /** Flap force multiplier: exactly 1 without flow. */
  get thrustScale(): number {
    return this.payback ? 1 + FLOW.thrustGain * this.value : 1;
  }

  /** Power stroke surge gain and thrust multipliers: exactly 1 without flow. */
  get powerGainScale(): number {
    return this.payback ? 1 + FLOW.powerGain * this.value : 1;
  }

  get powerThrustScale(): number {
    return this.payback ? 1 + FLOW.powerThrust * this.value : 1;
  }

  reset(): void {
    this.value = 0;
    this.log.length = 0;
    this.history.length = 0;
    this.last = null;
    this.transitions = 0;
    this.moments = 0;
    this.lastMoment = -Infinity;
    this.stalled = false;
    this.touching = false;
    Object.assign(this.terms, createTerms());
    this.segmenter.reset();
    this.burst.reset();
  }

  /** Sets the flow value directly (headless checks). */
  setValue(v: number): void {
    this.value = clamp(v, 0, 1);
  }

  /** A `maneuver` sim event (FlightSim.emit). */
  onManeuver(id: string, ended: boolean | undefined, clean: boolean | undefined): void {
    if (!this.enabled) {
      return;
    }
    this.segmenter.maneuver(id, !!ended, clean ?? true);
    const sim = this.sim;
    if (!sim || CHAIN_IGNORED.has(id)) {
      return;
    }
    if (ended) {
      this.burst.end(id, clean ?? true, sim.time);
    } else if (this.burst.start(id, sim.time) === 'link') {
      this.addLink(sim, 1, 'motion', id);
    }
  }

  /**
   * Marks a named motion for a move that announces nothing on the maneuver event (the event does the same). `end` with
   * the move's own verdict when it knows one; without an end the motion closes once the manoeuvring settles.
   */
  beginMotion(id: string): void {
    this.onManeuver(id, false, undefined);
  }

  endMotion(id: string, clean = true): void {
    this.onManeuver(id, true, clean);
  }

  /** An external velocity change (speed ring push): not the dragon's energy management. */
  noteExternal(sim: FlightSim): void {
    if (this.enabled) {
      this.segmenter.rebase(sim);
    }
  }

  /**
   * A gate or speed ring passed (tightness 0..1: how snug the ring is for the dragon). While a chain is alive a speed
   * ring, or a gate taken tight, is a chain link of its own.
   */
  notePass(sim: FlightSim, tightness: number, kind: 'gate' | 'ring' = 'gate'): void {
    if (!this.enabled) {
      return;
    }
    const tight = clamp(tightness, 0, 1);
    this.segmenter.notePass(tight, sim.time);
    if (this.burst.open(sim.time) && (kind === 'ring' || tight >= BURST.passTightness)) {
      this.addLink(sim, BURST.passShare, kind, null);
    }
  }

  /**
   * A hard landing (hard-landing.ts): the same drop as any airborne contact (the dragon is already on the ground when
   * the step sees it, so it is told).
   */
  hardContact(): void {
    if (!this.enabled) {
      return;
    }
    this.value *= FLOW.contactKeep;
    this.burst.spoil();
    this.burst.cancel();
  }

  /** Every substep, after the physics. */
  step(sim: FlightSim, h: number): void {
    if (!this.enabled) {
      return;
    }
    this.sim = sim;
    const seg = this.segmenter;
    seg.sample(sim, h);
    // Drops: the start of a stall, the start of a contact while airborne.
    const stalled = sim.airborne && (sim.mode === 'stalling' || sim.controller.upset);
    if (stalled && !this.stalled) {
      this.value *= FLOW.stallKeep;
      this.burst.spoil();
      this.burst.cancel();
    }
    this.stalled = stalled;
    const touching = sim.airborne && (sim.impact.touched || sim.touchingWater);
    if (touching && !this.touching) {
      this.value *= FLOW.contactKeep;
      this.burst.spoil();
      this.burst.cancel();
    }
    this.touching = touching;
    this.stepBurst(sim, h);
    // Sustained waste (braking, mushing, fighting the air).
    if (seg.wasteRate > FLOW.wasteFactor * Math.max(-seg.refRate, FLOW.energyRefFloor)) {
      this.value -= FLOW.wasteDrain * h;
    }
    // A small leak always (flow is kept alive by new motions), a slow decay in steady flight, faster on the ground.
    if (sim.airborne) {
      this.value -= FLOW.leak * h;
    }
    if (!seg.open && sim.time - seg.lastEnd > FLOW.grace) {
      this.value -= (sim.airborne ? FLOW.decay : FLOW.decayGround) * h;
    }
    this.value = clamp(this.value, 0, 1);
  }

  private onMotion(d: MotionDescriptor): void {
    const sim = this.sim;
    const now = d.exit.t;
    while (this.history.length && now - this.history[0].t > 4 * FLOW.historyForget) {
      this.history.shift();
    }
    const prev = this.last && now - this.last.exit.t - d.duration <= FLOW.maxGap ? this.last : null;
    const terms = transitionHarmony(prev, d, this.history, this.terms);
    let delta = 0;
    let moment: FlowMoment | null = null;
    if (d.contact || d.stalled) {
      // Touched or stalled during the motion (the drop at the moment itself came from step()).
      delta = this.value * (FLOW.uncleanKeep - 1);
    } else if (!d.clean) {
      // The move's own verdict (cut short, fell short of its trade): no gain, a poor transition still costs.
      delta = Math.min(0, flowDelta(terms));
    } else {
      delta = flowDelta(terms);
      moment = this.moment(d, terms, now);
      if (moment) {
        delta += FLOW.momentStep;
      }
    }
    const before = this.value;
    this.value = clamp(this.value + delta, 0, 1);
    this.transitions++;
    this.history.push({ sig: signature(d), t: now });
    if (this.history.length > FLOW.historySize) {
      this.history.shift();
    }
    this.last = d;
    this.log.push({ motion: d, terms: { ...terms }, delta: this.value - before, flow: this.value, moment });
    if (this.log.length > LOG_SIZE) {
      this.log.shift();
    }
    if (moment && sim) {
      this.moments++;
      this.lastMoment = now;
      sim.emit({ type: 'maneuver', id: 'flow', label: FLOW_MOMENT_LABELS[moment] });
      sim.emit({ type: 'moment', kind: moment });
    }
  }

  /** Debug and review captures: lands link number `link` now (a move link). */
  debugLink(sim: FlightSim, link: number): void {
    this.burst.links = Math.max(0, link - 1);
    this.addLink(sim, 1, 'motion', null);
  }

  /**
   * Kinds of the everyday race moves that would link if started now (the HUD's next-move hint): only while the chain
   * is open, only kinds that add variety, and only ones the dragon can fly right now.
   */
  linkable(sim: FlightSim, out: string[]): string[] {
    out.length = 0;
    const b = this.burst;
    if (!this.enabled || !sim.airborne || !b.open(sim.time)) {
      return out;
    }
    const V = sim.airspeed;
    const beats = sim.stamina > POWER_STROKE.stamina && !sim.tired;
    const can: Record<string, boolean> = { dart: V >= DART.minSpeed, power: beats, roll: V >= SLIP.minSpeed, slip: V >= SLIP.minSpeed && sim.stamina > SLIP.stamina };
    for (const kind of NEXT_MOVES) {
      if (can[kind] && b.current !== kind && b.fresh(kind)) {
        out.push(kind);
      }
    }
    return out;
  }

  /** A chain link landed: count it, start its burst, tell the game (camera kick, whoosh, HUD counter). */
  private addLink(sim: FlightSim, share: number, source: LinkSource, kind: string | null): void {
    const b = this.burst;
    const scale = this.payback ? this.burstScale : 0;
    const dv = sim.airborne ? linkDv(b.links + 1, sim.airspeed, share) * scale : 0;
    const link = b.link(sim.time, dv, kind);
    sim.emit({ type: 'chain', link, dv, source });
  }

  /** Delivers the running burst along the flight path (outside work for the energy bookkeeping). */
  private stepBurst(sim: FlightSim, h: number): void {
    const b = this.burst;
    // A move without an end event of its own (roll, loop, free fall...) ends once the maneuver system is idle.
    if (b.current !== null && !this.segmenter.busy(sim)) {
      this.idleFor += h;
      if (this.idleFor >= BURST.idleEnd) {
        b.end(b.current, true, sim.time);
      }
    } else {
      this.idleFor = 0;
    }
    b.tick(sim.time);
    if (!b.active) {
      b.rate = 0;
      return;
    }
    const cruising = sim.airborne && (sim.mode === 'flying' || sim.mode === 'gliding' || sim.mode === 'diving');
    if (!cruising) {
      b.cancel();
      return;
    }
    const v = sim.body.velocity;
    const w = sim.wind.velocity;
    const ax = v.x - w.x;
    const ay = v.y - w.y;
    const az = v.z - w.z;
    const V = Math.hypot(ax, ay, az);
    const dv = b.step(h, V);
    if (dv <= 0 || V < 1) {
      return;
    }
    v.x += (ax / V) * dv;
    v.y += (ay / V) * dv;
    v.z += (az / V) * dv;
    // Not the dragon's energy management: book the push as outside work.
    this.segmenter.external(0.5 * ((V + dv) ** 2 - V * V));
  }

  /** The term that peaked on this transition, if any (the most exceptional one). */
  private moment(d: MotionDescriptor, t: HarmonyTerms, now: number): FlowMoment | null {
    if (now - this.lastMoment < FLOW.momentCooldown || t.total < FLOW.momentHarmony || t.novelty < FLOW.momentNovelty) {
      return null;
    }
    const candidates: Array<[FlowMoment, number]> = [];
    if (Number.isFinite(t.rhythmOffset) && t.rhythmOffset <= FLOW.momentRhythm && d.entry.rhythmAmount >= FLOW.momentRhythmAmount && t.chain >= FLOW.momentChain) {
      candidates.push(['rhythm', 1 - t.rhythmOffset / FLOW.momentRhythm]);
    }
    if (t.excess <= FLOW.momentEnergy && d.duration >= FLOW.momentEnergyDuration) {
      candidates.push(['energy', (FLOW.momentEnergy - t.excess) / 0.5]);
    }
    if (t.chain >= 0.8 && t.continuity >= FLOW.momentHandover && t.alignment >= FLOW.momentHandover) {
      candidates.push(['handover', Math.min(t.continuity, t.alignment) - FLOW.momentHandover]);
    }
    const tightClear = d.minClearance <= FLOW.momentClearance && !d.contact;
    if (tightClear || d.passTightness >= FLOW.momentTightness) {
      candidates.push(['world', tightClear ? 1 - d.minClearance / FLOW.momentClearance : d.passTightness - FLOW.momentTightness]);
    }
    if (!candidates.length) {
      return null;
    }
    candidates.sort((a, b) => b[1] - a[1]);
    return candidates[0][0];
  }

  /** Lines for the debug overlay (?flowdebug=1). */
  debugLines(): string[] {
    const t = this.terms;
    const seg = this.segmenter;
    const o = seg.open;
    const f = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : '–');
    const last = this.log[this.log.length - 1];
    return [
      `flow ${f(this.value)}  drag ×${f(this.dragScale)}  thrust ×${f(this.thrustScale)}`,
      `chain ${this.burst.links}  burst ${this.burst.active ? `${this.burst.total.toFixed(1)} m/s` : '—'}  links ${this.burst.totalLinks}`,
      `motion ${o ? `${o.id ?? '(unnamed)'} ${o.time.toFixed(1)} s` : '—'}  activity ${f(seg.activity)}  proximity ${f(seg.proximityNow)}`,
      `waste ${f(seg.wasteRate)} / ref ${f(-seg.refRate)} J/kg/s`,
      `last ${last ? `${last.motion.id ?? '(unnamed)'} Δ${last.delta >= 0 ? '+' : ''}${last.delta.toFixed(3)}${last.moment ? ` ${last.moment}` : ''}` : '—'}`,
      `H ${f(t.total)}  chain ${f(t.chain)}  novelty ${f(t.novelty)}`,
      `energy ${f(t.energy)} (x ${f(t.excess)})  continuity ${f(t.continuity)}`,
      `alignment ${f(t.alignment)} (path ${Number.isFinite(t.pathAngle) ? Math.round((t.pathAngle * 180) / Math.PI) : '–'}°, speed ${f(t.speedUse)})`,
      `rhythm ${f(t.rhythm)} (${Number.isFinite(t.rhythmOffset) ? `${Math.round(t.rhythmOffset * 1000)} ms` : 'none'})  world ${f(t.world)}`,
    ];
  }
}
