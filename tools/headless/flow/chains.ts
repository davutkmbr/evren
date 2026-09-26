/**
 * Scripted move chains through the real FlightSim (key-level gestures), flown back to back ("chained") or spaced out
 * by steady flight / started off the beat ("unchained"), for the flow checks.
 */
import { CollisionWorld } from '../../../src/core/collision';
import { FlightSim } from '../../../src/dragon/flight/sim';
import type { FlowTransition } from '../../../src/dragon/flight/flow/flow';
import { flatGeo } from '../pose/runtime';
import { fly, KeyPilot, type Key } from './key-pilot';

export interface ChainStep {
  /** Keys held before the gesture (seconds), e.g. a bank before a wingover or a dive before a Split-S. */
  pre?: Array<{ key: Key; dur: number; at?: number }>;
  gesture: { key: Key; kind: 'double' | 'tap' | 'hold'; dur?: number };
  /** Further motions the gesture produces, in order (the loop's Immelmann: ['immelmann']). */
  also?: string[];
  /** Gesture this long after the pre-keys end (s; default: 0.25 s before they end). */
  gestureDelay?: number;
  /** Keys pressed after the gesture (s after it), e.g. A / D at the top of a loop for the Immelmann. */
  after?: Array<{ key: Key; at: number; dur: number }>;
  /** The move id this step should start (for the report). */
  id: string;
}

export interface ChainSetup {
  alt: number;
  speed: number;
  /** Flat land at y = 0 (a collision world) instead of the open sea. */
  land?: boolean;
}

export interface ChainResult {
  sim: FlightSim;
  /** Transitions into each step's move (null when the move never ran). */
  steps: Array<FlowTransition | null>;
  flow: number;
  started: string[];
}

export function chainSim(setup: ChainSetup): FlightSim {
  const sim = new FlightSim();
  sim.options.turbulence = false;
  sim.options.thermals = false;
  sim.options.wind = false;
  if (setup.land) {
    const col = new CollisionWorld();
    col.setGeo(flatGeo(0));
    sim.world.collision = col;
    sim.world.geo = col.geo ?? undefined;
  }
  sim.teleport(0, setup.alt, 0, 0, 0, setup.speed);
  sim.queueEvents = false;
  return sim;
}

function busy(sim: FlightSim): boolean {
  const m = sim.maneuvers;
  return m.active || m.powerActive || sim.skim.active || sim.mode === 'grounded' || sim.mode === 'takeoff' || sim.mode === 'landing';
}

/**
 * Flies the steps. `delay(i)`: seconds of plain flight between the end of step i − 1 and the pre-keys of step i.
 */
export function flyChain(setup: ChainSetup, steps: ChainStep[], delay: (i: number) => number, prepare?: (sim: FlightSim) => void): ChainResult {
  const sim = chainSim(setup);
  prepare?.(sim);
  const p = new KeyPilot();
  let t = fly(sim, p, 1, 0);
  const gestureAt: number[] = [];
  steps.forEach((s, i) => {
    t = fly(sim, p, delay(i), t);
    let at = t;
    for (const pre of s.pre ?? []) {
      p.hold(pre.key, at + (pre.at ?? 0), at + (pre.at ?? 0) + pre.dur);
    }
    const preLen = Math.max(0, ...(s.pre ?? []).map((q) => (q.at ?? 0) + q.dur));
    at += s.gestureDelay !== undefined ? preLen + s.gestureDelay : Math.max(0, preLen - 0.25);
    const g = s.gesture;
    if (g.kind === 'double') {
      p.double(g.key, at);
    } else if (g.kind === 'tap') {
      p.tap(g.key, at);
    } else {
      p.hold(g.key, at, at + (g.dur ?? 1));
    }
    for (const a of s.after ?? []) {
      p.hold(a.key, at + a.at, at + a.at + a.dur);
    }
    gestureAt.push(at);
    let seen = false;
    t = fly(sim, p, 25, t, () => {
      if (busy(sim)) {
        seen = true;
      }
      if (seen && !busy(sim) && sim.time > at + 0.3) {
        return true;
      }
      return sim.time > at + 4 && !seen;
    });
  });
  fly(sim, p, 2, t);
  // The transition into each step: the first logged motion with its id at or after its gesture, in order.
  const out: Array<FlowTransition | null> = [];
  const started: string[] = [];
  const log = sim.flow.log;
  let cursor = 0;
  steps.forEach((s, i) => {
    for (const id of [s.id, ...(s.also ?? [])]) {
      let found: FlowTransition | null = null;
      for (let k = cursor; k < log.length; k++) {
        if (log[k].motion.id === id && log[k].motion.entry.t >= gestureAt[i] - 0.5) {
          found = log[k];
          cursor = k + 1;
          break;
        }
      }
      out.push(found);
      if (found) {
        started.push(id);
      }
    }
  });
  return { sim, steps: out, flow: sim.flow.value, started };
}

/** Mean harmony of the transitions into steps 1.. (the first step has no chained predecessor). */
export function meanHarmony(r: ChainResult): number {
  const hs = r.steps.slice(1).filter((s): s is FlowTransition => s !== null).map((s) => s.terms.total);
  return hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : NaN;
}

/* Common steps. */
export const STEP = {
  splitS: { id: 'splits', pre: [{ key: 'W', dur: 2.2 }], gesture: { key: 'A', kind: 'double' } } as ChainStep,
  dart: { id: 'dart', gesture: { key: 'Shift', kind: 'double' } } as ChainStep,
  power: { id: 'power', gesture: { key: 'Space', kind: 'double' } } as ChainStep,
  wingover: { id: 'wingover', pre: [{ key: 'D', dur: 1.4 }], gesture: { key: 'S', kind: 'double' } } as ChainStep,
  loop: { id: 'loop', gesture: { key: 'S', kind: 'double' } } as ChainStep,
  slip: { id: 'slip', gesture: { key: 'E', kind: 'double' } } as ChainStep,
  roll: { id: 'roll', gesture: { key: 'D', kind: 'double' } } as ChainStep,
  /** Loop with D pressed near its top: the Immelmann (the loop and the Immelmann are two motions). */
  immelmann: { id: 'loop', also: ['immelmann'], gesture: { key: 'S', kind: 'double' }, after: [{ key: 'D', at: 2.6, dur: 0.4 }] } as ChainStep,
};
