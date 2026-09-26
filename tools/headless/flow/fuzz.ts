/**
 * Random chain search for the flow system: a scripted pilot that plays random gestures on the real keys (double taps,
 * holds, holds followed by double taps, taps) with random timing through the real FlightSim, and records flow, energy
 * and sanity numbers per run. Also the repeated-pattern runs (one gesture macro over and over at its best timing).
 */
import { FlightSim } from '../../../src/dragon/flight/sim';
import { fly, KeyPilot, type Key } from './key-pilot';

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DOUBLE_KEYS: Key[] = ['A', 'D', 'S', 'Shift', 'Space', 'Q', 'E'];
const HOLD_KEYS: Key[] = ['W', 'S', 'A', 'D', 'Q', 'E', 'Space', 'Shift'];
const PRE_KEYS: Key[] = ['W', 'A', 'D', 'Shift', 'S'];

/** One gesture macro: schedules its keys from `t` and returns its length (s). */
export type Macro = { name: string; play: (p: KeyPilot, t: number) => number };

export function macroDouble(k: Key): Macro {
  return { name: `${k}×2`, play: (p, t) => (p.double(k, t), 0.25) };
}

export function macroHold(k: Key, d: number): Macro {
  return { name: `${k}~${d.toFixed(1)}`, play: (p, t) => (p.hold(k, t, t + d), d) };
}

export function macroHoldDouble(hold: Key, d: number, k: Key): Macro {
  return {
    name: `${hold}~${d.toFixed(1)}+${k}×2`,
    play: (p, t) => {
      p.hold(hold, t, t + d);
      p.double(k, t + Math.max(0, d - 0.3));
      return d + 0.1;
    },
  };
}

export function randomMacro(r: () => number): Macro {
  const pick = <T>(a: T[]): T => a[Math.floor(r() * a.length)];
  const u = r();
  if (u < 0.4) {
    return macroDouble(pick(DOUBLE_KEYS));
  }
  if (u < 0.75) {
    return macroHold(pick(HOLD_KEYS), 0.2 + r() * 2.8);
  }
  if (u < 0.93) {
    return macroHoldDouble(pick(PRE_KEYS), 0.4 + r() * 2, pick(DOUBLE_KEYS));
  }
  return u < 0.97 ? { name: 'Space', play: (p, t) => (p.tap('Space', t), 0.1) } : { name: 'V', play: (p, t) => (p.tap('V', t), 0.1) };
}

export interface FuzzRun {
  seed: number;
  flowMax: number;
  flowMean: number;
  /** Share of the run spent at flow ≥ 0.8. */
  flowHigh: number;
  transitions: number;
  moments: number;
  nan: boolean;
  /** Largest rise (J/kg) of the muscle-free energy over any 3 s window without contact (> 0 would be free energy). */
  freeEnergy: number;
  /** Net loss over the run relative to plain gliding over the same time (1: as plain gliding; > 1 wasteful). */
  lossRatio: number;
  maxSpeed: number;
  /** Most frequent macro's share of the flow gained. */
  topMacroShare: number;
  /** Chain links (flow/burst.ts), the longest chain and the total burst push (m/s). */
  links: number;
  bestChain: number;
  burstDv: number;
}

export function createSim(alt: number, speed: number, heading = 0): FlightSim {
  const sim = new FlightSim();
  sim.options.turbulence = false;
  sim.options.thermals = false;
  sim.options.wind = false;
  sim.teleport(0, alt, 0, heading, 0, speed);
  sim.queueEvents = false;
  return sim;
}

function isBusy(sim: FlightSim): boolean {
  const m = sim.maneuvers;
  return m.active || m.powerActive;
}

/**
 * One random run of `seconds`: random macros, after each a random wait (half the time "chained": the next macro as
 * soon as the move ends, plus up to 0.4 s). Below 120 m the pilot climbs out (S + Space) first.
 */
export function fuzzRun(seed: number, seconds: number, forceFlow?: number): FuzzRun {
  const r = rng(seed);
  const sim = createSim(250 + r() * 500, 26 + r() * 18, r() * 360);
  const p = new KeyPilot();
  let t = 0;
  let flowSum = 0;
  let high = 0;
  let samples = 0;
  let nan = false;
  let maxSpeed = 0;
  const netAt: number[] = [];
  const contactAt: boolean[] = [];
  let sampleTimer = 0;
  let contactWindow = false;
  const startNet = sim.flow.segmenter.cumNet;
  const startRef = sim.flow.segmenter.cumRef;
  const gains = new Map<string, number>();
  let current = '';
  let lastFlow = 0;
  const each = (): void => {
    if (forceFlow !== undefined) {
      sim.flow.setValue(forceFlow);
    }
    const f = sim.flow.value;
    if (!Number.isFinite(f) || !sim.body.isFinite() || !Number.isFinite(sim.airspeed)) {
      nan = true;
    }
    if (f > lastFlow) {
      gains.set(current, (gains.get(current) ?? 0) + (f - lastFlow));
    }
    lastFlow = f;
    flowSum += f;
    high += f >= 0.8 ? 1 : 0;
    samples++;
    maxSpeed = Math.max(maxSpeed, sim.airspeed);
    if (!sim.airborne || sim.touchingWater || sim.impact.touched) {
      contactWindow = true;
    }
    sampleTimer++;
    if (sampleTimer >= 60) {
      sampleTimer = 0;
      netAt.push(sim.flow.segmenter.cumNet);
      contactAt.push(contactWindow);
      contactWindow = false;
    }
  };
  while (t < seconds) {
    if (sim.mode === 'swimming' || sim.mode === 'grounded') {
      current = 'recover';
      p.tap('Space', t);
      p.hold('Space', t + 0.4, t + 3);
      t = fly(sim, p, 3, t, each);
      continue;
    }
    if (sim.body.position.y < 120) {
      current = 'recover';
      p.hold('S', t, t + 1.5);
      p.hold('Space', t, t + 3);
      t = fly(sim, p, 3, t, each);
      continue;
    }
    const m = randomMacro(r);
    current = m.name;
    const len = m.play(p, t);
    const chained = r() < 0.5;
    let started = false;
    const until = t + len + 0.2;
    t = fly(sim, p, len + 12, t, () => {
      each();
      const tt = sim.time;
      if (isBusy(sim)) {
        started = true;
      }
      return tt > until && (!isBusy(sim) || tt > until + 10) && (started || tt > until);
    });
    const wait = chained ? r() * 0.4 : 0.3 + r() * 3.5;
    t = fly(sim, p, wait, t, each);
  }
  let freeEnergy = -Infinity;
  for (let i = 0; i + 6 < netAt.length; i++) {
    let clean = true;
    for (let k = i; k <= i + 6; k++) {
      clean &&= !contactAt[k];
    }
    if (clean) {
      freeEnergy = Math.max(freeEnergy, netAt[i + 6] - netAt[i]);
    }
  }
  const seg = sim.flow.segmenter;
  const ref = seg.cumRef - startRef;
  const total = [...gains.values()].reduce((a, b) => a + b, 0);
  const top = total > 0 ? Math.max(...[...gains.entries()].filter(([k]) => k !== 'recover').map(([, v]) => v), 0) / total : 0;
  return {
    seed,
    flowMax: forceFlow !== undefined ? forceFlow : sim.flow.log.reduce((m, l) => Math.max(m, l.flow), 0),
    flowMean: flowSum / Math.max(samples, 1),
    flowHigh: high / Math.max(samples, 1),
    transitions: sim.flow.transitions,
    moments: sim.flow.moments,
    nan,
    freeEnergy,
    lossRatio: ref < -1 ? (seg.cumNet - startNet) / ref : 1,
    maxSpeed,
    topMacroShare: top,
    links: sim.flow.burst.totalLinks,
    bestChain: sim.flow.burst.bestChain,
    burstDv: sim.flow.burst.totalDv,
  };
}

/**
 * One macro repeated back to back for `seconds` at the best timing (the next as soon as the move ends); the pilot
 * climbs out below 120 m. Returns the mean and the highest flow and the chain links and bursts it earned.
 */
export function repeatRun(macro: Macro, seconds: number, seed = 1): { mean: number; max: number; transitions: number; links: number; bestChain: number; burstDv: number } {
  const sim = createSim(600, 34);
  const p = new KeyPilot();
  let t = 0;
  let sum = 0;
  let n = 0;
  const each = (): void => {
    sum += sim.flow.value;
    n++;
  };
  void seed;
  while (t < seconds) {
    if (sim.mode === 'swimming' || sim.mode === 'grounded') {
      p.tap('Space', t);
      p.hold('Space', t + 0.4, t + 3);
      t = fly(sim, p, 3, t, each);
      continue;
    }
    if (sim.body.position.y < 120) {
      p.hold('S', t, t + 1.5);
      p.hold('Space', t, t + 3);
      t = fly(sim, p, 3, t, each);
      continue;
    }
    const len = macro.play(p, t);
    let started = false;
    const until = t + len + 0.2;
    t = fly(sim, p, len + 12, t, () => {
      each();
      if (isBusy(sim)) {
        started = true;
      }
      return sim.time > until && (!isBusy(sim) || sim.time > until + 10) && (started || sim.time > until);
    });
    t = fly(sim, p, 0.1, t, each);
  }
  const b = sim.flow.burst;
  return { mean: sum / Math.max(n, 1), max: sim.flow.log.reduce((m, l) => Math.max(m, l.flow), 0), transitions: sim.flow.transitions, links: b.totalLinks, bestChain: b.bestChain, burstDv: b.totalDv };
}
