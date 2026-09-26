/**
 * Flow ("Akış", phase 20 stage D) check, headless (no browser, no GPU): the harmony terms on synthetic descriptors,
 * the unchanged baseline, the payback, scripted chains through the real sim against the same moves spaced out or off
 * the beat, and a random chain search (fuzz) with the real key gestures.
 *
 *   npx tsx tools/headless/flow-check.ts            # everything (fuzz: 2000 random runs of 60 s)
 *   npx tsx tools/headless/flow-check.ts --quick    # fuzz: 300 runs
 *   npx tsx tools/headless/flow-check.ts --json f   # also write the numbers to f
 *
 * 1. Harmony terms (unit tests): energy stewardship, continuity, rate agreement, alignment, rhythm, proximity and use
 *    of the world, novelty (repeats and short cycles wear out), chain factor, the transition total and the flow delta.
 * 2. Baseline: plain flight with the flow system on is bit-identical to flight with it off (flow stays 0); the payback
 *    scales are exactly 1 without flow; at full flow the drag is 8 % lower, the top cruise ~5 m/s higher, a glide still
 *    loses energy, the power stroke surges harder.
 * 3. Chains through the real sim (key gestures): Split-S → dart → power stroke, wingover → power stroke, skim →
 *    landing → run-out → touch-and-go, loop → Immelmann → dive → dart, dart → power → slip → roll → power: chained
 *    harmony and flow above the same moves spaced out by steady flight; a move started on the beat vs off it.
 * 4. Fuzz: random gestures with random timing. (a) no repeated pattern dominates (every macro repeated back to back
 *    stays low, no macro brings most of a run's flow), (b) no full flow without energy-efficient flying, (c) no free
 *    energy (the muscle-free energy never rises without contact, also with full flow forced), (d) no NaN.
 */
import { writeFileSync } from 'node:fs';
import { CollisionWorld } from '../../src/core/collision';
import {
  alignment,
  chainFactor,
  continuity,
  energyStewardship,
  flowDelta,
  novelty,
  proximity,
  rateAgreement,
  rhythm,
  rhythmOffset,
  signature,
  transitionHarmony,
  worldUse,
  type SignatureEntry,
} from '../../src/dragon/flight/flow/harmony';
import { FLOW } from '../../src/dragon/flight/flow/params';
import { FLOW_MOMENT_LABELS } from '../../src/dragon/flight/flow/flow';
import { createSnapshot, createTerms, type MotionDescriptor } from '../../src/dragon/flight/flow/types';
import { MANEUVER_LABELS } from '../../src/dragon/flight/maneuvers';
import { FLAP } from '../../src/dragon/flight/params';
import { FlightSim } from '../../src/dragon/flight/sim';
import { flyChain, meanHarmony, STEP, type ChainResult, type ChainStep } from './flow/chains';
import { fuzzRun, macroDouble, macroHold, macroHoldDouble, repeatRun, createSim, type FuzzRun } from './flow/fuzz';
import { fly, KeyPilot } from './flow/key-pilot';
import { flatGeo } from './pose/runtime';

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const jsonArg = args.indexOf('--json');
const failures: string[] = [];
const results: Record<string, number | string | boolean> = {};
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : 'n/a');
const f3 = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : 'n/a');

function check(ok: boolean, label: string): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (!ok) {
    failures.push(label);
  }
}

function note(key: string, value: number | string | boolean): void {
  results[key] = typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;
}

/* ------------------------------------------------------------------ */
/* 1. Harmony terms                                                     */
/* ------------------------------------------------------------------ */

function descriptor(over: Partial<MotionDescriptor> = {}): MotionDescriptor {
  const entry = createSnapshot();
  entry.speed = 36;
  entry.t = 10;
  const exit = createSnapshot();
  exit.speed = 36;
  exit.t = 11.5;
  return {
    id: 'test',
    entry,
    exit,
    duration: 1.5,
    energyNet: -120,
    gapEnergyNet: -40,
    energyRef: -120,
    gapEnergyRef: -40,
    muscleWork: 0,
    gap: 0.3,
    rotX: 0.5,
    rotY: 0.1,
    rotZ: 1,
    headingChange: 0.2,
    meanLoad: 1.3,
    jerkLoad: 2,
    jerkRate: 5,
    entryRates: [0.3, 0, 0.5],
    exitRates: [0.3, 0, 0.4],
    earlyPath: [0, 0, -1],
    prePeakSpeed: 36,
    worldPeak: 0,
    worldMean: 0,
    minClearance: Infinity,
    passTightness: 0,
    contact: false,
    stalled: false,
    clean: true,
    ...over,
  };
}

function unitTests(): void {
  console.log('\n1. Harmony terms (synthetic descriptors)');
  // Energy stewardship.
  const same = energyStewardship(-100, -100, 1);
  const saved = energyStewardship(-20, -100, 1);
  const gained = energyStewardship(+50, -100, 1);
  const wasted = energyStewardship(-250, -100, 1);
  check(Math.abs(same.excess) < 1e-9 && same.score > 0.75 && same.score < 0.9, `energy: as plain gliding x = 0 → ${f2(same.score)}`);
  check(saved.score > same.score && gained.score > saved.score && gained.score > 0.95, `energy: saving / gaining energy scores higher (${f2(saved.score)}, ${f2(gained.score)})`);
  check(wasted.score < 0.1, `energy: 2.5× the plain loss scores low (${f2(wasted.score)})`);
  // Continuity.
  const smooth = continuity(0, 0, 0.5);
  const jerky = continuity(24, 50, 0.5);
  const jerkyEfficient = continuity(24, 50, 1);
  check(smooth > 0.99 && jerky < 0.05, `continuity: no jerk ${f2(smooth)}, a jerk spike ${f2(jerky)}`);
  check(jerkyEfficient > jerky, `continuity: an energy-efficient reversal is partly forgiven (${f2(jerkyEfficient)} > ${f2(jerky)})`);
  // Rates.
  const agree = rateAgreement([0, 0, 2], [0, 0, 2]);
  const oppose = rateAgreement([0, 0, 2], [0, 0, -2]);
  const idle = rateAgreement([0, 0, 0.02], [0, 0, 2]);
  check(agree > 0.99 && oppose < 0.01 && Math.abs(idle - FLOW.rateNeutral) < 0.01, `rate agreement: same ${f2(agree)}, reversed ${f2(oppose)}, none ${f2(idle)}`);
  // Alignment.
  const h = createSnapshot();
  const aligned = alignment(h, [0, 0, -1], [0, 0, 1], [0, 0, 1], 40, 40);
  const turned = alignment(h, [Math.sin(1), 0, -Math.cos(1)], [0, 0, 1], [0, 0, -1], 40, 40);
  const late = alignment(h, [0, 0, -1], [0, 0, 1], [0, 0, 1], 34, 40);
  check(aligned.score > 0.99 && turned.score < 0.35 && late.score < aligned.score, `alignment: carried ${f2(aligned.score)}, fought (57°, reversed rates) ${f2(turned.score)}, speed let go (34 of 40) ${f2(late.score)}`);
  // Rhythm.
  const onBeat = createSnapshot();
  onBeat.rhythmAmount = 0.8;
  onBeat.rhythmFreq = 1.5;
  onBeat.rhythmPhase = 0.02;
  const offBeat = { ...onBeat, rhythmPhase: Math.PI * FLAP.downstrokeFraction };
  const glide = { ...onBeat, rhythmAmount: 0 };
  check(rhythm(rhythmOffset(onBeat)) > 0.98, `rhythm: on the top of the stroke ${f2(rhythm(rhythmOffset(onBeat)))}`);
  check(rhythm(rhythmOffset(offBeat)) < 0.3, `rhythm: between the breaks (${Math.round(rhythmOffset(offBeat) * 1000)} ms off) ${f2(rhythm(rhythmOffset(offBeat)))}`);
  check(Number.isNaN(rhythmOffset(glide)) && rhythm(NaN) === FLOW.rhythmNeutral, 'rhythm: gliding (no beat) is neutral');
  // Proximity and the world.
  const low = proximity(2.5, Infinity, 0, 40);
  const high = proximity(40, Infinity, 0, 40);
  const touching = proximity(0.3, Infinity, 0, 40);
  const slow = proximity(2.5, Infinity, 0, 8);
  const under = proximity(40, 4, 0, 40);
  const thermal = proximity(200, Infinity, 3.5, 30);
  check(low > 0.95 && high === 0 && touching === 0 && slow === 0, `proximity: 2.5 m ${f2(low)}, 40 m ${f2(high)}, touching ${f2(touching)}, slow ${f2(slow)}`);
  check(under > 0.95 && thermal > 0.95, `proximity: under a deck ${f2(under)}, riding a 3.5 m/s updraft ${f2(thermal)}`);
  check(worldUse(1, 1, 1, true) === 0 && worldUse(1, 0.6, 0, false) === 0.8 && worldUse(0, 0, 0.9, false) === 0.9, 'use of the world: contact → 0, peak/mean blend, tight pass');
  // Novelty.
  const d = descriptor();
  const sig = signature(d);
  const fresh = novelty(sig, [], 100);
  const repeated = novelty(sig, [{ sig, t: 99 }], 100);
  const old = novelty(sig, [{ sig, t: 40 }], 100);
  const other = novelty(signature(descriptor({ rotX: 3, rotZ: 0, meanLoad: 3, duration: 5 })), [{ sig, t: 99 }], 100);
  const cycle: SignatureEntry[] = [];
  const a = signature(descriptor({ rotZ: 6.3 }));
  const b = signature(descriptor({ rotX: 3, rotZ: 0, meanLoad: 2.5 }));
  const c = signature(descriptor({ rotZ: 0.1, rotX: 0.1, duration: 0.8, meanLoad: 1 }));
  for (let i = 0; i < 9; i++) {
    cycle.push({ sig: [a, b, c][i % 3], t: 80 + i * 2 });
  }
  const inCycle = novelty(a, cycle, 98);
  check(fresh === 1 && repeated < 0.15 && old > 0.95 && other > 0.9, `novelty: new ${f2(fresh)}, repeated at once ${f2(repeated)}, repeated after 60 s ${f2(old)}, a different motion ${f2(other)}`);
  check(inCycle < 0.05, `novelty: a 3-motion cycle repeated for 18 s wears out (${f2(inCycle)})`);
  // Chain factor.
  check(chainFactor(0) === 1 && Math.abs(chainFactor(FLOW.chainGap) - Math.exp(-1)) < 1e-9 && chainFactor(FLOW.maxGap + 0.1) === 0 && chainFactor(Infinity) === 0, 'chain factor: back to back 1, e⁻¹ at chainGap, 0 past maxGap');
  // Transition totals.
  const prev = descriptor({ id: 'a' });
  const tChained = transitionHarmony(prev, descriptor({ gap: 0.2 }), [], createTerms());
  const chainedTotal = tChained.total;
  const tSpaced = transitionHarmony(prev, descriptor({ gap: 5 }), [], createTerms());
  check(chainedTotal > tSpaced.total + 0.15, `transition: the same motion chained ${f2(chainedTotal)} vs after 5 s of steady flight ${f2(tSpaced.total)}`);
  const tWorld = transitionHarmony(prev, descriptor({ gap: 0.2, worldPeak: 1, worldMean: 0.9 }), [], createTerms());
  check(tWorld.total > chainedTotal, `transition: low and clean over the sea adds harmony (${f2(tWorld.total)})`);
  // Flow delta gates.
  const good = { ...createTerms(), total: 0.8, novelty: 1, energy: 0.9, chain: 1 };
  check(flowDelta(good) > 0.1, `flow delta: a harmonious new transition +${f3(flowDelta(good))}`);
  check(flowDelta({ ...good, novelty: 0.1 }) === 0, 'flow delta: a repeated motion adds nothing');
  check(flowDelta({ ...good, energy: 0.2 }) === 0, 'flow delta: an energy-wasting motion adds nothing');
  check(flowDelta({ ...good, total: 0.3, chain: 1 }) < 0 && flowDelta({ ...good, total: 0.3, chain: 0 }) === 0, 'flow delta: a clumsy handover costs, a lone motion out of steady flight does not');
  check(Object.values(FLOW_MOMENT_LABELS).every((l) => l.startsWith('Kusursuz')) && MANEUVER_LABELS.flow === 'Kusursuz', 'moment captions are Turkish ("Kusursuz …")');
}

/* ------------------------------------------------------------------ */
/* 2. Baseline and payback                                              */
/* ------------------------------------------------------------------ */

function plainScript(kind: number): KeyPilot {
  const p = new KeyPilot();
  switch (kind) {
    case 0:
      return p;
    case 1:
      return p.hold('D', 1, 4).hold('A', 6, 8);
    case 2:
      return p.hold('Space', 0.5, 6).hold('S', 2, 3);
    case 3:
      return p.hold('W', 1, 2.5).hold('Space', 4, 9);
    default:
      return p.hold('Q', 1, 3).tap('Space', 5).tap('Space', 6);
  }
}

function baseline(): void {
  console.log('\n2. Baseline and payback');
  let identical = true;
  let flowZero = true;
  for (let k = 0; k < 5; k++) {
    const a = createSim(300, 34, 30);
    const b = createSim(300, 34, 30);
    b.flow.enabled = false;
    fly(a, plainScript(k), 12);
    fly(b, plainScript(k), 12);
    const same =
      a.body.position.equals(b.body.position) && a.body.velocity.equals(b.body.velocity) && a.body.quaternion.equals(b.body.quaternion) && a.stamina === b.stamina;
    identical &&= same;
    flowZero &&= a.flow.value === 0;
  }
  check(identical, 'plain flight (level, turns, climb, dive, rudder and taps): bit-identical with the flow system on and off');
  check(flowZero, 'plain flight at altitude builds no flow');
  const s = new FlightSim();
  check(s.flow.dragScale === 1 && s.flow.thrustScale === 1 && s.flow.powerGainScale === 1 && s.flow.powerThrustScale === 1, 'payback scales are exactly 1 without flow');
  s.flow.setValue(1);
  check(Math.abs(s.flow.dragScale - (1 - FLOW.dragCut)) < 1e-12 && FLOW.dragCut <= 0.08, `full flow: drag × ${f2(s.flow.dragScale)} (cap −8 %)`);

  // Top cruise: Space held in level flight (path and bank held), stamina kept full.
  const top = (flow: number): number => {
    const sim = createSim(150, 35);
    fly(sim, new KeyPilot().hold('Space', 0, 200), 60, 0, () => {
      sim.flow.setValue(flow);
      sim.stamina = 1;
      sim.overrides.pathTarget = 0;
      sim.overrides.bankTarget = 0;
    });
    return sim.airspeed;
  };
  const v0 = top(0);
  const v1 = top(1);
  note('payback.topCruise0', v0);
  note('payback.topCruise1', v1);
  check(v1 - v0 > 4 && v1 - v0 < 5.6, `top cruise ${f2(v0)} → ${f2(v1)} m/s at full flow (+${f2(v1 - v0)}, target ~+5)`);
  // A glide at full flow still loses energy (no perpetual acceleration).
  const glide = (flow: number): number => {
    const sim = createSim(400, 45);
    sim.options.autoFlap = false;
    const e0 = 0.5 * 45 * 45 + 9.81 * 400;
    fly(sim, new KeyPilot(), 20, 0, () => {
      sim.flow.setValue(flow);
      sim.overrides.pathTarget = -0.05;
      sim.overrides.bankTarget = 0;
    });
    return 0.5 * sim.airspeed * sim.airspeed + 9.81 * sim.body.position.y - e0;
  };
  const g0 = glide(0);
  const g1 = glide(1);
  note('payback.glideLoss0', g0);
  note('payback.glideLoss1', g1);
  check(g1 < 0 && g1 > g0, `a 20 s glide loses energy at full flow too (${f2(g1)} vs ${f2(g0)} J/kg): less drag, no free energy`);
  // Power stroke surge.
  const surge = (flow: number): number => {
    const sim = createSim(300, 32);
    let vmax = 0;
    fly(sim, new KeyPilot().double('Space', 1), 3.5, 0, () => {
      sim.flow.setValue(flow);
      vmax = Math.max(vmax, sim.airspeed);
    });
    return vmax - 32;
  };
  const p0 = surge(0);
  const p1 = surge(1);
  note('payback.power0', p0);
  note('payback.power1', p1);
  check(p1 > p0 + 1, `power stroke surge +${f2(p0)} → +${f2(p1)} m/s at full flow`);
}

/* ------------------------------------------------------------------ */
/* 3. Chains                                                            */
/* ------------------------------------------------------------------ */

function chainLine(r: ChainResult, steps: ChainStep[]): string {
  const ids = steps.flatMap((s) => [s.id, ...(s.also ?? [])]);
  return r.steps.map((s, i) => (s ? `${s.motion.id} H${f2(s.terms.total)}` : `${ids[i]} –`)).join(' → ');
}

function chains(): void {
  console.log('\n3. Chains through the real sim (key gestures)');
  // After the Immelmann: push over into a dive (W), pull out of it (S), then the dart.
  const dartAfterDive: ChainStep = {
    id: 'dart',
    pre: [
      { key: 'W', dur: 1.3 },
      { key: 'S', at: 1.4, dur: 0.9 },
    ],
    gestureDelay: 0.2,
    gesture: { key: 'Shift', kind: 'double' },
  };
  const cases: Array<{ name: string; steps: ChainStep[]; spacedSteps?: ChainStep[]; chainDelay?: number; spacedDelay?: number; alt: number; speed: number }> = [
    { name: 'Split-S → dart → power stroke', steps: [STEP.splitS, STEP.dart, STEP.power], alt: 600, speed: 36 },
    { name: 'wingover → power stroke', steps: [STEP.wingover, STEP.power], alt: 400, speed: 32 },
    {
      // The loop and its Immelmann are one gesture (A / D at the top of the loop); spaced: a full loop, then later a
      // separate loop → Immelmann, then the dive and the dart.
      name: 'loop → Immelmann → dive → dart',
      steps: [STEP.immelmann, dartAfterDive],
      spacedSteps: [STEP.loop, { ...STEP.immelmann, id: 'immelmann', also: [] }, STEP.dart],
      spacedDelay: 7,
      // The dive starts once the Immelmann's roll-out has settled (a hand-flown dive right into it is part of it).
      chainDelay: 0.8,
      alt: 500,
      speed: 38,
    },
    { name: 'dart → power → slip → roll → power', steps: [STEP.dart, STEP.power, STEP.slip, STEP.roll, STEP.power], alt: 400, speed: 36 },
  ];
  for (const c of cases) {
    const chained = flyChain({ alt: c.alt, speed: c.speed }, c.steps, (i) => (i === 0 ? 0 : (c.chainDelay ?? 0.1)));
    const spaced = flyChain({ alt: c.alt, speed: c.speed }, c.spacedSteps ?? c.steps, (i) => (i === 0 ? 0 : (c.spacedDelay ?? 4)));
    const hc = meanHarmony(chained);
    const hs = meanHarmony(spaced);
    console.log(`      chained ${chainLine(chained, c.steps)}  flow ${f3(chained.flow)}`);
    console.log(`      spaced  ${chainLine(spaced, c.spacedSteps ?? c.steps)}  flow ${f3(spaced.flow)}`);
    note(`chain.${c.name}.chained`, hc);
    note(`chain.${c.name}.spaced`, hs);
    note(`chain.${c.name}.flowChained`, chained.flow);
    note(`chain.${c.name}.flowSpaced`, spaced.flow);
    const ran = chained.steps.every((s) => s !== null);
    check(ran && hc > hs + 0.15 && chained.flow > spaced.flow, `${c.name}: chained H ${f2(hc)} > spaced ${f2(hs)}, flow ${f3(chained.flow)} > ${f3(spaced.flow)}${ran ? '' : ` (moves run: ${chained.started.join(', ')})`}`);
  }
  // Skim → touch-and-go over flat land, against a touch-and-go from a plain approach.
  const touchGo = (skim: boolean): { h: number; id: string | null; flow: number } => {
    const sim = new FlightSim();
    sim.options.turbulence = false;
    sim.options.thermals = false;
    sim.options.wind = false;
    const col = new CollisionWorld();
    col.setGeo(flatGeo(0));
    sim.world.collision = col;
    sim.teleport(0, skim ? 5 : 12, 0, 0, 0, 30);
    sim.queueEvents = false;
    const p = new KeyPilot().tap('L', skim ? 3 : 2);
    let grounded = -1;
    fly(sim, p, 14, 0, (t) => {
      // Skimming: held low (feet ~3 m over the ground) until the landing call.
      sim.overrides.pathTarget = skim && t < 3 ? Math.max(-0.1, Math.min(0.1, (3 - sim.footClearance) * 0.04)) : null;
      if (grounded < 0 && sim.mode === 'grounded') {
        grounded = t;
        p.tap('Space', t + 0.6);
      }
    });
    // The landing chain: the approach, the run-out and the touch-and-go.
    const ts = sim.flow.log.filter((l) => l.motion.id === 'land' || l.motion.id === 'touchgo' || l.motion.id === 'runout');
    const h = ts.length ? ts.reduce((a, l) => a + l.terms.total, 0) / ts.length : NaN;
    return { h: ts.some((l) => l.motion.id === 'touchgo') ? h : NaN, id: ts.length ? 'touchgo' : null, flow: sim.flow.value };
  };
  // Rhythm: a side-slip started while beating, on the top of the stroke or half-way down it.
  const slipOn = (onBeat: boolean): number => {
    const sim = createSim(300, 36);
    const p = new KeyPilot().hold('Space', 0, 12);
    let first = -1;
    let rest = 0;
    let done = false;
    const split = 2 * Math.PI * FLAP.downstrokeFraction;
    fly(sim, p, 8, 0, undefined, (t) => {
      const ph = sim.beat.phase;
      if (t < 3 || done || t < rest) {
        return;
      }
      if (first < 0) {
        first = t;
        p.tap('E', t);
        return;
      }
      const window = onBeat ? ph > 2 * Math.PI - 0.25 || ph < 0.02 : Math.abs(ph - split / 2) < 0.12;
      if (window && t - first < 0.28) {
        p.tap('E', t);
        done = true;
      } else if (t - first >= 0.28) {
        // Missed the window: wait out the double-tap window before a new first tap.
        first = -1;
        rest = t + 0.4;
      }
    });
    const slip = sim.flow.log.find((l) => l.motion.id === 'slip');
    return slip ? slip.terms.rhythm : NaN;
  };
  const rOn = slipOn(true);
  const rOff = slipOn(false);
  note('chain.rhythmOnBeat', rOn);
  note('chain.rhythmOffBeat', rOff);
  check(rOn > 0.7 && rOff < 0.35, `rhythm: a side-slip started on the beat ${f2(rOn)}, half-way down the stroke ${f2(rOff)}`);
  const tgSkim = touchGo(true);
  const tgPlain = touchGo(false);
  note('chain.skimTouchGo.chained', tgSkim.h);
  note('chain.skimTouchGo.plain', tgPlain.h);
  note('chain.skimTouchGo.flowChained', tgSkim.flow);
  note('chain.skimTouchGo.flowPlain', tgPlain.flow);
  check(
    Number.isFinite(tgSkim.h) && Number.isFinite(tgPlain.h) && tgSkim.h > tgPlain.h + 0.05 && tgSkim.flow > tgPlain.flow,
    `skim → landing → run-out → touch-and-go: H ${f2(tgSkim.h)}, flow ${f3(tgSkim.flow)} vs from a plain approach H ${f2(tgPlain.h)}, flow ${f3(tgPlain.flow)}`,
  );
}

/* ------------------------------------------------------------------ */
/* 4. Fuzz                                                              */
/* ------------------------------------------------------------------ */

function fuzz(): void {
  const n = QUICK ? 300 : 2000;
  console.log(`\n4. Random chain search (${n} runs of 60 s, real gestures, random timing)`);
  const t0 = performance.now();
  const runs: FuzzRun[] = [];
  for (let i = 0; i < n; i++) {
    runs.push(fuzzRun(1000 + i, 60));
  }
  const forced: FuzzRun[] = [];
  for (let i = 0; i < Math.round(n / 4); i++) {
    forced.push(fuzzRun(5000 + i, 60, 1));
  }
  console.log(`      ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const q = (v: number[], p: number): number => {
    const s = v.filter(Number.isFinite).sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? NaN;
  };
  const means = runs.map((r) => r.flowMean);
  const maxes = runs.map((r) => r.flowMax);
  console.log(`      flow mean p50 ${f2(q(means, 0.5))} p90 ${f2(q(means, 0.9))} max ${f2(q(means, 1))}; flow max p50 ${f2(q(maxes, 0.5))} p90 ${f2(q(maxes, 0.9))}`);
  note('fuzz.runs', n);
  note('fuzz.flowMeanP50', q(means, 0.5));
  note('fuzz.flowMeanP90', q(means, 0.9));
  note('fuzz.flowMeanMax', q(means, 1));
  note('fuzz.flowMaxP90', q(maxes, 0.9));

  // (a) Repeated patterns.
  const macros = [
    macroDouble('D'),
    macroDouble('S'),
    macroDouble('Shift'),
    macroDouble('Space'),
    macroDouble('E'),
    macroHold('D', 1.5),
    macroHold('W', 1),
    macroHoldDouble('D', 1.5, 'S'),
    macroHoldDouble('W', 2, 'A'),
  ];
  let worstMean = 0;
  let worstMax = 0;
  let worst = '';
  for (const m of macros) {
    const r = repeatRun(m, QUICK ? 60 : 120);
    if (r.mean > worstMean) {
      worstMean = r.mean;
      worst = m.name;
    }
    worstMax = Math.max(worstMax, r.max);
  }
  note('fuzz.repeatWorstMean', worstMean);
  note('fuzz.repeatWorstMax', worstMax);
  check(worstMean < 0.1 && worstMax < 0.4, `(a) every gesture macro repeated back to back stays low (worst mean ${f3(worstMean)} ${worst}, highest ${f2(worstMax)})`);
  const flowRuns = runs.filter((r) => r.flowMax > 0.3);
  const dominated = flowRuns.filter((r) => r.topMacroShare > 0.8).length;
  note('fuzz.dominatedShare', flowRuns.length ? dominated / flowRuns.length : 0);
  check(flowRuns.length === 0 || dominated / flowRuns.length < 0.1, `(a) in runs that built flow, one macro brings > 80 % of it in ${dominated} of ${flowRuns.length}`);

  // (b) Energy-efficient flying only.
  const wasteful = runs.filter((r) => r.lossRatio > 1.3);
  const wasteMean = Math.max(0, ...wasteful.map((r) => r.flowMean));
  const wasteMax = Math.max(0, ...wasteful.map((r) => r.flowMax));
  note('fuzz.wastefulRuns', wasteful.length);
  note('fuzz.wastefulFlowMean', wasteMean);
  note('fuzz.wastefulFlowMax', wasteMax);
  check(wasteMean < 0.25 && wasteMax < 0.5, `(b) ${wasteful.length} wasteful runs (> 1.3× plain gliding's loss): flow mean ≤ ${f3(wasteMean)}, never above ${f2(wasteMax)}`);
  const high = runs.filter((r) => r.flowHigh > 0);
  const highLoss = Math.max(0, ...high.map((r) => r.lossRatio));
  note('fuzz.highFlowRuns', high.length);
  note('fuzz.highFlowWorstLoss', highLoss);
  check(high.every((r) => r.lossRatio < 1.3), `(b) runs reaching flow ≥ 0.8: ${high.length}, worst loss ratio ${f2(highLoss)}`);

  // (c) Energy model.
  const free = Math.max(...runs.map((r) => r.freeEnergy).filter(Number.isFinite));
  const freeForced = Math.max(...forced.map((r) => r.freeEnergy).filter(Number.isFinite));
  const vmax = Math.max(...runs.map((r) => r.maxSpeed), ...forced.map((r) => r.maxSpeed));
  note('fuzz.freeEnergy', free);
  note('fuzz.freeEnergyForcedFlow', freeForced);
  note('fuzz.maxSpeed', vmax);
  check(free < 5 && freeForced < 5, `(c) muscle-free energy never rises over 3 s without contact (max ${f2(free)} J/kg; full flow forced ${f2(freeForced)} J/kg)`);
  check(vmax < 95, `(c) top speed in any run ${f2(vmax)} m/s (under the folded dive envelope)`);

  // (d) Sanity.
  const nan = runs.filter((r) => r.nan).length + forced.filter((r) => r.nan).length;
  check(nan === 0, `(d) no NaN in ${runs.length + forced.length} runs`);
  const momentRate = runs.reduce((a, r) => a + r.moments, 0) / (runs.length * 60);
  note('fuzz.momentsPerMinute', momentRate * 60);
  check(momentRate * 60 < 1.5, `"Kusursuz" moments stay rare in random flying (${f2(momentRate * 60)} per minute)`);
}

unitTests();
baseline();
chains();
fuzz();

if (jsonArg >= 0 && args[jsonArg + 1]) {
  writeFileSync(args[jsonArg + 1], JSON.stringify(results, null, 2));
}
console.log(failures.length ? `\n${failures.length} failure(s):\n  ${failures.join('\n  ')}` : '\nall flow checks passed');
process.exit(failures.length ? 1 : 0);
