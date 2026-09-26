/**
 * Phase 06 bond check, headless (no browser, no GPU): the pure bond core (src/dragon/model/behavior/bond) driven by
 * scripted situations, and the real rig for the petting contact.
 *
 *   npx tsx tools/headless/bond-check.ts            # table of numbers, exits 1 when one fails
 *   npx tsx tools/headless/bond-check.ts --json f   # also write the numbers to f
 *
 * 1. Gaze limits: with every look-back trigger active (petting, the rider's POV resting on the neck, perched, a glance
 *    after a trick) the dragon never looks back when the ground is close, an obstacle is ahead, it flies fast, it is in
 *    a trick, a race or a landing, or it runs; the POV trigger turns the head within 2 s after 3 s of looking; an
 *    obstacle appearing drops a running look within a second; the obstacle test has hysteresis.
 * 2. Mood: long flight makes it tired, rest brings it back to content (decay), discoveries make it curious or excited
 *    and fade, petting makes it fond, flow excites it; a short spike does not switch the mood (hysteresis), noisy input
 *    does not flap between moods, and a mood holds its minimum time.
 * 3. Behaviours: a varied 10-minute autopilot run (three seeds) shows at least 6 different behaviours, they are rare
 *    (gap between chance draws), none starts in a race, a landing or another critical moment and a running one fades
 *    out within its abort time, variants never repeat back to back, the same behaviour never plays twice in a row.
 * 4. Petting IK: the rider's palm stays on the neck surface (reach error and palm gap within ±3 cm) across neck poses,
 *    the gaze, flapping and standing on the ground.
 * 5. No NaNs: fuzzed inputs through the core and its offsets through the rig keep every output and bone finite.
 * 6. Cost: the core's update time per frame (budget 0.2 ms with the engine adapter).
 */
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import type { DragonMood, DragonPose, FlightMode } from '../../src/core/contracts';
import { BEHAVIORS } from '../../src/dragon/model/behavior/bond/behaviors';
import { BondCore } from '../../src/dragon/model/behavior/bond/core';
import { BOND, createInputs, estimateAirTemp, type AttentionCandidate, type BondInputs, type BondOutputs } from '../../src/dragon/model/behavior/bond/types';
import { buildRig } from './pose/runtime';

const failures: string[] = [];
const results: Record<string, unknown> = {};
const DT = 1 / 60;

function check(ok: boolean, label: string): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
  if (!ok) {
    failures.push(label);
  }
}

const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : String(x));

function finiteOutputs(o: BondOutputs): boolean {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      console.log(`    non-finite output ${k} = ${v}`);
      return false;
    }
  }
  return true;
}

/** Runs `seconds` of frames, `setup` edits the input each frame; returns per-frame gaze levels and the last output. */
function run(core: BondCore, seconds: number, setup: (inp: BondInputs, t: number) => void, each?: (o: BondOutputs, t: number, inp: BondInputs) => void): void {
  const inp = createInputs();
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    const keep = inp.attention;
    Object.assign(inp, createInputs());
    inp.attention = keep;
    (inp.attention as AttentionCandidate[]).length = 0;
    setup(inp, t);
    const o = core.update(inp);
    each?.(o, t, inp);
  }
}

/* ------------------------------------------------------------------ */
/* 1. Gaze                                                              */
/* ------------------------------------------------------------------ */

function allTriggers(inp: BondInputs, t: number): void {
  inp.pov = true;
  inp.povLookAtNeck = true;
  inp.petting = 1;
  inp.petActive = true;
  inp.maneuverGlance = Math.abs(t % 5) < DT;
}

function gazeChecks(): void {
  console.log('\n1. Gaze limits');
  const unsafe: Array<[string, (inp: BondInputs) => void]> = [
    ['ground close (12 m, 20 m/s)', (i) => ((i.agl = 12), (i.airspeed = 20), (i.mode = 'flying'))],
    ['ground close gliding (25 m, 30 m/s)', (i) => ((i.agl = 25), (i.airspeed = 30))],
    ['obstacle 3 s ahead', (i) => (i.obstacleTime = 3)],
    ['obstacle 6.5 s ahead', (i) => (i.obstacleTime = 6.5)],
    ['fast (48 m/s)', (i) => (i.airspeed = 48)],
    ['diving (70 m/s)', (i) => ((i.mode = 'diving'), (i.airspeed = 70))],
    ['trick / hard bank', (i) => (i.maneuvering = true)],
    ['race running', (i) => (i.racing = true)],
    ['landing', (i) => ((i.mode = 'landing'), (i.airspeed = 15), (i.agl = 20))],
    ['take-off', (i) => ((i.mode = 'takeoff'), (i.agl = 4))],
    ['perch approach', (i) => (i.perchBusy = true)],
    ['running on the ground (8 m/s)', (i) => ((i.mode = 'grounded'), (i.groundSpeed = 8), (i.airspeed = 8), (i.agl = 0))],
    ['breathing fire', (i) => (i.firing = true)],
  ];
  const unsafeMax: Record<string, number> = {};
  for (const [label, apply] of unsafe) {
    const core = new BondCore(11);
    let max = 0;
    run(
      core,
      20,
      (inp, t) => {
        allTriggers(inp, t);
        apply(inp);
      },
      (o) => (max = Math.max(max, o.gazeRider)),
    );
    unsafeMax[label] = max;
    check(max === 0, `never looks back: ${label} (max gaze ${f2(max)})`);
  }
  results.gazeUnsafeMax = unsafeMax;

  // POV acceptance: 3 s of looking at the neck, the head comes round within 2 s after that.
  {
    const core = new BondCore(3);
    let reached = Infinity;
    run(
      core,
      8,
      (inp) => {
        inp.pov = true;
        inp.povLookAtNeck = true;
      },
      (o, t) => {
        if (o.gazeRider > 0.6 && reached === Infinity) {
          reached = t;
        }
      },
    );
    results.povGazeAt = reached;
    check(reached >= BOND.gaze.povDwell && reached <= BOND.gaze.povDwell + 1.2, `POV look at the neck: gaze > 0.6 at ${f2(reached)} s (dwell ${BOND.gaze.povDwell} s, head round within 2 s incl. the rig spring)`);
  }
  // A running look drops quickly when an obstacle appears, and the obstacle release has hysteresis.
  {
    const core = new BondCore(4);
    let atObstacle = 0;
    let after1s = 1;
    let reenabled = false;
    run(
      core,
      16,
      (inp, t) => {
        inp.pov = true;
        inp.povLookAtNeck = true;
        if (t >= 6 && t < 10) {
          inp.obstacleTime = 5;
        } else if (t >= 10) {
          // Hovering around the block threshold (never past the release): must stay blocked.
          inp.obstacleTime = 7.5 + 1.5 * Math.sin(t * 3);
        }
      },
      (o, t) => {
        if (Math.abs(t - 6) < DT / 2) {
          atObstacle = o.gazeRider;
        }
        if (Math.abs(t - 7) < DT / 2) {
          after1s = o.gazeRider;
        }
        if (t > 10.5 && o.gazeRider > 0.05) {
          reenabled = true;
        }
      },
    );
    results.obstacleDrop = { atObstacle, after1s };
    check(atObstacle > 0.6 && after1s < 0.05, `obstacle appears: gaze ${f2(atObstacle)} → ${f2(after1s)} within 1 s`);
    check(!reenabled, 'obstacle between block (7 s) and release (10 s): stays blocked (hysteresis)');
  }
  // Speed ramp: looking back while gliding, then speeding up past the limit.
  {
    const core = new BondCore(5);
    let maxFast = 0;
    run(
      core,
      12,
      (inp, t) => {
        inp.petting = 1;
        inp.petActive = true;
        inp.airspeed = t < 5 ? 28 : 28 + (t - 5) * 6;
      },
      (o, t, inp) => {
        if (inp.airspeed > BOND.gaze.maxAirspeed + 4) {
          maxFast = Math.max(maxFast, o.gazeRider);
        }
        void t;
      },
    );
    check(maxFast < 0.05, `speeding up past ${BOND.gaze.maxAirspeed} m/s drops the look (max ${f2(maxFast)} 4 m/s past it)`);
  }
  // Perched: idle glances happen; gliding: idle glances happen within their interval.
  for (const [label, perched] of [
    ['perched', true],
    ['gliding', false],
  ] as const) {
    const core = new BondCore(6);
    let glances = 0;
    let was = false;
    run(
      core,
      180,
      (inp) => {
        if (perched) {
          inp.perched = true;
          inp.mode = 'grounded';
          inp.airspeed = 0;
          inp.groundSpeed = 0;
          inp.agl = 0;
        }
      },
      (o) => {
        const on = o.gazeRider > 0.5;
        if (on && !was) {
          glances++;
        }
        was = on;
      },
    );
    const every = perched ? BOND.gaze.perchEvery : BOND.gaze.glideEvery;
    check(glances >= Math.floor(180 / (every[1] * 1.7)) && glances <= Math.ceil(180 / (every[0] * 0.6)), `${label}: ${glances} idle looks back in 3 min (every ${every[0]}–${every[1]} s)`);
  }
}

/* ------------------------------------------------------------------ */
/* 2. Mood                                                              */
/* ------------------------------------------------------------------ */

function moodChecks(): void {
  console.log('\n2. Mood state machine');
  const core = new BondCore(21);
  const timeline: Array<{ t: number; mood: DragonMood }> = [];
  let last: DragonMood = 'content';
  const note = (o: BondOutputs, t: number): void => {
    if (o.mood !== last) {
      timeline.push({ t: Math.round(t), mood: o.mood });
      last = o.mood;
    }
  };
  // Long flight: 25 minutes cruising with stamina slowly dropping.
  let tiredAt = Infinity;
  run(
    core,
    25 * 60,
    (inp, t) => {
      inp.mode = t % 40 < 25 ? 'flying' : 'gliding';
      inp.stamina = Math.max(0.25, 1 - t / 1500);
      inp.flapEffort = inp.mode === 'flying' ? 0.5 : 0.05;
    },
    (o, t) => {
      note(o, t);
      if (o.mood === 'tired' && tiredAt === Infinity) {
        tiredAt = t;
      }
    },
  );
  check(tiredAt < 25 * 60, `long flight makes it tired (after ${(tiredAt / 60).toFixed(1)} min)`);
  // Rest on the ground: back to content.
  let contentAt = Infinity;
  run(
    core,
    10 * 60,
    (inp) => {
      inp.mode = 'grounded';
      inp.airspeed = 0;
      inp.groundSpeed = 0;
      inp.agl = 0;
    },
    (o, t) => {
      note(o, t + 1500);
      if (o.mood !== 'tired' && contentAt === Infinity) {
        contentAt = t;
      }
    },
  );
  check(contentAt < 8 * 60 && core.out.mood !== 'tired', `resting brings it back (${core.out.mood} after ${(contentAt / 60).toFixed(1)} min on the ground)`);

  // Discoveries: curious / excited, then decays back.
  {
    const c = new BondCore(22);
    run(c, 60, () => undefined);
    const landmark: AttentionCandidate = { kind: 'landmark', key: 'galata', yaw: 0.4, pitch: -0.3, distance: 600, strength: 1 };
    let peak: DragonMood = 'content';
    let backAt = Infinity;
    run(
      c,
      300,
      (inp, t) => {
        if (t < 40 && Math.abs(t % 12) < DT) {
          inp.discovery = { ...landmark, key: `l${Math.round(t)}` };
        }
      },
      (o, t) => {
        if (t < 60 && (o.mood === 'curious' || o.mood === 'excited')) {
          peak = o.mood;
        }
        if (t > 60 && o.mood === 'content' && backAt === Infinity) {
          backAt = t;
        }
      },
    );
    check(peak === 'curious' || peak === 'excited', `discoveries make it ${peak}`);
    check(backAt < 300, `and it settles back to content (${f2(backAt)} s after the first)`);
  }
  // Petting: fond (content or playful), with a rising affection.
  {
    const c = new BondCore(23);
    run(c, 30, (inp) => {
      inp.petting = 1;
      inp.petActive = true;
    });
    const aff = c.mood.drives.affection;
    check(aff > 0.85 && (c.out.mood === 'content' || c.out.mood === 'playful'), `30 s of petting: affection ${f2(aff)}, mood ${c.out.mood}`);
    run(c, 600, () => undefined);
    check(c.mood.drives.affection < aff - 0.3, `affection decays without petting (${f2(c.mood.drives.affection)} after 10 min)`);
  }
  // Flow: excited, then decays.
  {
    const c = new BondCore(24);
    run(c, 30, () => undefined);
    let excitedAt = Infinity;
    run(
      c,
      25,
      (inp) => {
        inp.flow = 0.9;
        inp.mode = 'flying';
        inp.airspeed = 38;
      },
      (o, t) => {
        if (o.mood === 'excited' && excitedAt === Infinity) {
          excitedAt = t;
        }
      },
    );
    check(excitedAt < 12, `high flow excites it (after ${f2(excitedAt)} s)`);
    run(c, 180, () => undefined);
    check(c.out.mood !== 'excited', `excitement fades (${c.out.mood} 3 min later)`);
  }
  // Hysteresis: a short spike below the dwell time does not switch; noisy input does not flap.
  {
    const c = new BondCore(25);
    run(c, 60, () => undefined);
    const before = c.mood.switches;
    run(c, 1.0, (inp) => {
      inp.flow = 1;
      inp.airspeed = 30;
    });
    run(c, 30, () => undefined);
    check(c.mood.switches === before, `a 1 s flow spike does not switch the mood (${c.out.mood})`);
    const noisy = new BondCore(26);
    const switchTimes: number[] = [];
    let prev = noisy.mood.switches;
    run(
      noisy,
      600,
      (inp, t) => {
        // Hovering around the thresholds: flow and speed jitter, petting on and off every few seconds.
        inp.flow = 0.35 + 0.3 * Math.sin(t * 1.7) * Math.sin(t * 0.13);
        inp.airspeed = 36 + 8 * Math.sin(t * 0.9);
        inp.petting = Math.sin(t * 0.4) > 0.6 ? 1 : 0;
        inp.petActive = inp.petting > 0;
      },
      (_o, t) => {
        if (noisy.mood.switches !== prev) {
          prev = noisy.mood.switches;
          switchTimes.push(t);
        }
      },
    );
    let minGap = Infinity;
    for (let i = 1; i < switchTimes.length; i++) {
      minGap = Math.min(minGap, switchTimes[i] - switchTimes[i - 1]);
    }
    results.noisyMood = { switches: switchTimes.length, minGap };
    check(switchTimes.length <= 20 && minGap >= BOND.mood.minHold - 1e-6, `noisy input: ${switchTimes.length} switches in 10 min, shortest hold ${f2(minGap)} s (≥ ${BOND.mood.minHold} s)`);
  }
  results.moodTimeline = timeline;
  console.log(`  timeline (long flight, then rest): ${timeline.map((e) => `${e.t}s ${e.mood}`).join(' → ') || 'content'}`);
}

/* ------------------------------------------------------------------ */
/* 3. Behaviours                                                        */
/* ------------------------------------------------------------------ */

interface Segment {
  until: number;
  label: string;
  apply(inp: BondInputs, t: number): void;
}

/** A varied 10-minute autopilot session. */
function session(): Segment[] {
  const glide = (inp: BondInputs): void => {
    inp.mode = 'gliding';
    inp.airspeed = 30;
    inp.agl = 260;
  };
  const cruise = (inp: BondInputs, t: number): void => {
    inp.mode = t % 20 < 12 ? 'flying' : 'gliding';
    inp.airspeed = 34;
    inp.agl = 180;
    inp.flapEffort = 0.4;
  };
  const birds = (inp: BondInputs, t: number): void => {
    glide(inp);
    inp.agl = 70;
    (inp.attention as AttentionCandidate[]).push({ kind: 'bird', key: 'bird', yaw: 0.5 * Math.sin(t * 0.3), pitch: 0.05, distance: 30, strength: 0.6 });
  };
  const ground = (inp: BondInputs): void => {
    inp.mode = 'grounded';
    inp.airspeed = 0;
    inp.groundSpeed = 0;
    inp.agl = 0;
  };
  return [
    { until: 150, label: 'cruise', apply: cruise },
    { until: 200, label: 'glide over gulls', apply: birds },
    { until: 206, label: 'landing', apply: (i) => ((i.mode = 'landing'), (i.airspeed = 14), (i.agl = 10)) },
    { until: 290, label: 'rest on the ground', apply: ground },
    { until: 294, label: 'take-off', apply: (i) => ((i.mode = 'takeoff'), (i.airspeed = 12), (i.agl = 3)) },
    { until: 340, label: 'race', apply: (i, t) => (cruise(i, t), (i.racing = true)) },
    { until: 380, label: 'swim', apply: (i) => ((i.mode = 'swimming'), (i.airspeed = 0), (i.groundSpeed = 1), (i.agl = 0)) },
    { until: 385, label: 'take-off from the water', apply: (i) => ((i.mode = 'takeoff'), (i.airspeed = 12), (i.agl = 3)) },
    { until: 470, label: 'glide', apply: glide },
    { until: 540, label: 'perched', apply: (i) => (ground(i), (i.perched = true)) },
    { until: 600, label: 'glide, night falling', apply: (i) => (glide(i), (i.hours = 21), (i.nightFactor = 0.7), (i.light = 0.3)) },
  ];
}

function behaviorChecks(): void {
  console.log('\n3. Behaviour scheduling');
  const perSeed: Array<Record<string, unknown>> = [];
  let allDistinct = true;
  let criticalStarts = 0;
  let lingering = 0;
  let repeatVariant = 0;
  let repeatId = 0;
  let minChanceGap = Infinity;
  for (const seed of [101, 202, 303]) {
    const core = new BondCore(seed);
    const segs = session();
    let criticalSince = -1;
    run(
      core,
      600,
      (inp, t) => {
        const seg = segs.find((s) => t < s.until) ?? segs[segs.length - 1];
        seg.apply(inp, t);
      },
      (o, t, inp) => {
        const critical = core.safety.state.critical;
        if (critical) {
          if (criticalSince < 0) {
            criticalSince = t;
          }
          // A running behaviour must fade out within its abort time.
          if (t - criticalSince > BOND.behavior.abortFade + 2 * DT && core.behaviors.weight > 0) {
            lingering++;
          }
        } else {
          criticalSince = -1;
        }
        void o;
        void inp;
      },
    );
    const log = core.behaviors.log;
    // Mark starts that happened in a critical frame (replay the timeline to find them).
    for (const e of log) {
      const seg = segs.find((s) => e.start < s.until) ?? segs[segs.length - 1];
      if (['landing', 'take-off', 'race', 'take-off from the water'].includes(seg.label)) {
        criticalStarts++;
      }
    }
    for (let i = 1; i < log.length; i++) {
      if (log[i].id === log[i - 1].id) {
        const triggered = BEHAVIORS.find((b) => b.id === log[i].id)?.triggered;
        if (!triggered) {
          repeatId++;
        }
        if (log[i].variant === log[i - 1].variant) {
          repeatVariant++;
        }
      }
    }
    const lastVariant = new Map<string, string>();
    for (const e of log) {
      if (lastVariant.get(e.id) === e.variant) {
        repeatVariant++;
      }
      lastVariant.set(e.id, e.variant);
    }
    const chance = log.filter((e) => !BEHAVIORS.find((b) => b.id === e.id)?.triggered);
    for (let i = 1; i < chance.length; i++) {
      minChanceGap = Math.min(minChanceGap, chance[i].start - chance[i - 1].start);
    }
    const distinct = new Set(log.map((e) => e.id));
    allDistinct &&= distinct.size >= 6;
    perSeed.push({ seed, count: log.length, distinct: distinct.size, log: log.map((e) => `${e.start.toFixed(0)}s ${e.id}:${e.variant} (${e.mode})`) });
    console.log(`  seed ${seed}: ${log.length} behaviours, ${distinct.size} different: ${log.map((e) => `${e.start.toFixed(0)}s ${e.id}:${e.variant}`).join(', ')}`);
  }
  results.behaviors = perSeed;
  check(allDistinct, 'a varied 10-minute autopilot run shows at least 6 different behaviours (every seed)');
  check(minChanceGap >= BOND.behavior.gap[0] * 0.75 - 1e-6, `rare: shortest gap between chance behaviours ${f2(minChanceGap)} s (≥ ${BOND.behavior.gap[0] * 0.75} s)`);
  check(criticalStarts === 0, `none starts in a race, a landing or a take-off (${criticalStarts})`);
  check(lingering === 0, `a running behaviour fades out within ${BOND.behavior.abortFade} s of a critical moment (${lingering} late frames)`);
  check(repeatVariant === 0, `variants never repeat back to back (${repeatVariant})`);
  check(repeatId === 0, `the same behaviour never plays twice in a row (${repeatId})`);

  // Triggered: wing stretch after landing from a long flight, shake-off after a swim.
  {
    const core = new BondCore(9);
    run(core, 200, (inp) => ((inp.mode = 'flying'), (inp.airspeed = 30)));
    run(core, 20, (inp) => ((inp.mode = 'grounded'), (inp.airspeed = 0), (inp.groundSpeed = 0), (inp.agl = 0)));
    run(core, 20, (inp) => ((inp.mode = 'swimming'), (inp.airspeed = 0), (inp.groundSpeed = 1), (inp.agl = 0)));
    run(core, 12, (inp) => ((inp.mode = 'grounded'), (inp.airspeed = 0), (inp.groundSpeed = 0), (inp.agl = 0)));
    const ids = core.behaviors.log.map((e) => e.id);
    check(ids.includes('wing-stretch'), `landing after 200 s of flight: wing stretch (${ids.join(', ')})`);
    check(ids.includes('shake-off'), 'walking out of the water: shake-off');
  }
  // Petting and the V answer hold off self-driven behaviours; the answer depends on the mood.
  {
    const answers: Record<string, string[]> = {};
    for (const mood of ['tired', 'content', 'excited'] as const) {
      const core = new BondCore(31);
      core.mood.mood = mood;
      const sounds: string[] = [];
      run(
        core,
        3,
        (inp, t) => {
          inp.encourage = t < DT;
          // Keep the mood fixed for this test.
          core.mood.mood = mood;
        },
        (o) => o.sounds.forEach((s) => sounds.push(s.cue)),
      );
      answers[mood] = sounds;
    }
    results.encourage = answers;
    check(answers.tired.includes('grumble') && answers.content.includes('chirp') && answers.excited.includes('roar-short') && answers.excited.includes('flap'), `V answers by mood: tired ${answers.tired.join('+')}, content ${answers.content.join('+')}, excited ${answers.excited.join('+')}`);
  }
}

/* ------------------------------------------------------------------ */
/* 4. Petting IK and 5. NaN fuzz on the rig                             */
/* ------------------------------------------------------------------ */

async function rigChecks(): Promise<void> {
  console.log('\n4. Petting IK on the neck surface');
  const rig = await buildRig();
  const scenarios: Array<[string, Partial<DragonPose>]> = [
    ['gliding, neck neutral', { legsTuck: 1, wingSpread: 1 }],
    ['neck turned left', { neckYaw: 0.6, neckPitch: 0.1 }],
    ['neck turned right, down', { neckYaw: -0.6, neckPitch: -0.4 }],
    ['neck raised', { neckPitch: 0.5 }],
    ['looking back at the rider', { gazeRider: 0.8 }],
    ['flapping', { flapAmplitude: 1, flapPhase: 0 }],
    ['standing on the ground', { legsTuck: 0, wingSpread: 0, groundY: -2.2 }],
    ['petting with plates, curl, tilt', { neckPlates: 1, tailCurl: 1, headRoll: 0.2 }],
  ];
  const rows: Record<string, { error: number; gap: number; frames: number }> = {};
  let worstErr = 0;
  let worstGap = 0;
  for (const [label, extra] of scenarios) {
    rig.setGazeSide(-1, true);
    let err = 0;
    let gap = 0;
    let gapMin = 0;
    let frames = 0;
    for (let i = 0; i < 240; i++) {
      const phase = extra.flapAmplitude ? (i / 60) * Math.PI * 2 * 1.2 : 0;
      rig.setPose({ ...DEFAULT_FLIGHT, ...extra, riderPet: Math.min(1, i / 30), flapPhase: phase });
      rig.applyPose(DT, undefined, null, null);
      rig.root.updateMatrixWorld(true);
      const c = rig.petContact;
      if (c.active && i > 60) {
        frames++;
        err = Math.max(err, c.error);
        gap = Math.max(gap, Math.abs(c.gap));
        gapMin = Math.min(gapMin, c.gap);
      }
    }
    rows[label] = { error: err, gap, frames };
    worstErr = Math.max(worstErr, err);
    worstGap = Math.max(worstGap, gap);
    check(frames > 100 && err <= 0.03 && gap <= 0.03, `${label}: reach error ${(err * 100).toFixed(1)} cm, palm gap ≤ ${(gap * 100).toFixed(1)} cm (${frames} frames)`);
  }
  results.petting = rows;

  console.log('\n5. No NaNs');
  // Fuzz: random inputs through the core, its offsets through the rig.
  const core = new BondCore(77);
  let seed = 12345;
  const rnd = (): number => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const modes: FlightMode[] = ['flying', 'gliding', 'diving', 'hovering', 'stalling', 'landing', 'grounded', 'takeoff', 'swimming', 'underwater'];
  let finite = true;
  let bonesFinite = true;
  const inp = createInputs();
  for (let i = 0; i < 6000; i++) {
    if (i % 90 === 0) {
      inp.mode = modes[Math.floor(rnd() * modes.length)];
      inp.airspeed = rnd() * 90;
      inp.groundSpeed = rnd() * 60;
      inp.agl = rnd() < 0.1 ? 0 : rnd() * 800;
      inp.stamina = rnd();
      inp.flow = rnd();
      inp.obstacleTime = rnd() < 0.2 ? Infinity : rnd() * 20;
      inp.petting = rnd() < 0.3 ? 1 : 0;
      inp.petActive = inp.petting > 0;
      inp.pov = rnd() < 0.5;
      inp.povLookAtNeck = rnd() < 0.5;
      inp.hours = rnd() * 24;
      inp.nightFactor = rnd();
      inp.light = rnd();
      inp.humidity = rnd();
      inp.rain = rnd();
      inp.airTempC = estimateAirTemp(Math.floor(rnd() * 365) + 1, inp.hours, rnd() * 2000, inp.rain, rnd());
      inp.perched = rnd() < 0.15;
      inp.racing = rnd() < 0.1;
      inp.maneuvering = rnd() < 0.15;
      (inp.attention as AttentionCandidate[]).length = 0;
      if (rnd() < 0.5) {
        (inp.attention as AttentionCandidate[]).push({ kind: 'bird', key: 'b', yaw: (rnd() - 0.5) * 6, pitch: (rnd() - 0.5) * 3, distance: rnd() * 90, strength: rnd() });
      }
    }
    inp.dt = i % 500 === 0 ? 0 : rnd() < 0.01 ? 0.5 : DT;
    inp.encourage = rnd() < 0.005;
    inp.discovery = rnd() < 0.002 ? { kind: 'landmark', key: `l${i}`, yaw: (rnd() - 0.5) * 6, pitch: (rnd() - 0.5) * 2, distance: rnd() * 3000, strength: 1 } : null;
    const o = core.update(inp);
    if (!finiteOutputs(o)) {
      finite = false;
      break;
    }
    if (i % 3 === 0) {
      rig.setPose({
        ...DEFAULT_FLIGHT,
        neckYaw: o.neckYaw,
        neckPitch: o.neckPitch,
        jawOpen: o.jawMin,
        tailYaw: o.tailYaw,
        tailPitch: o.tailPitch,
        gazeRider: o.gazeRider,
        eyeLid: o.eyeLid,
        pupil: o.pupil,
        neckPlates: o.neckPlates,
        headRoll: o.headRoll,
        neckShake: o.neckShake,
        bodyRoll: o.bodyRoll,
        tailCurl: o.tailCurl,
        riderLaugh: o.riderLaugh,
        riderShow: o.riderShow,
        riderShowYaw: o.riderShowYaw,
        riderShowPitch: o.riderShowPitch,
        riderPat: o.riderPat,
        riderPet: o.riderPat > 0 ? 0 : inp.petting,
        wingSpread: 1 + (o.wingSpread - 1) * o.wingWeight,
        wingRaise: o.wingRaise,
        flapAmplitude: o.beatWeight,
        flapPhase: o.beatPhase,
      });
      rig.setGazeSide(o.gazeSide);
      rig.applyPose(DT * 3, undefined, null, null);
      for (const b of rig.skel.bones) {
        const e = b.quaternion;
        if (!Number.isFinite(e.x + e.y + e.z + e.w + b.position.x + b.position.y + b.position.z)) {
          bonesFinite = false;
        }
      }
      if (!bonesFinite) {
        break;
      }
    }
  }
  check(finite, 'fuzzed inputs (6000 frames, dt 0 / 0.5 s spikes, every mode): every core output finite');
  check(bonesFinite, 'the core offsets through the rig: every bone finite');
}

const DEFAULT_FLIGHT: Partial<DragonPose> = {
  flapPhase: 0,
  flapAmplitude: 0,
  wingSpread: 1,
  wingSweep: 0,
  wingTwist: 0,
  neckYaw: 0,
  neckPitch: 0,
  jawOpen: 0,
  tailYaw: 0,
  tailPitch: 0,
  legsTuck: 1,
  walkPhase: 0,
  walkAmount: 0,
  breath: 0.3,
  riderLeanPitch: 0,
  riderLeanRoll: 0,
  gazeRider: 0,
  riderPet: 0,
  groundY: Number.NaN,
};

/* ------------------------------------------------------------------ */
/* 6. Cost                                                              */
/* ------------------------------------------------------------------ */

function costCheck(): void {
  console.log('\n6. Cost');
  const core = new BondCore(1);
  const inp = createInputs();
  (inp.attention as AttentionCandidate[]).push({ kind: 'bird', key: 'bird', yaw: 0.3, pitch: 0, distance: 30, strength: 0.6 });
  for (let i = 0; i < 2000; i++) {
    core.update(inp);
  }
  const n = 20000;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    inp.petting = i % 2000 < 600 ? 1 : 0;
    inp.petActive = inp.petting > 0;
    core.update(inp);
  }
  const ms = (performance.now() - t0) / n;
  results.coreMs = ms;
  check(ms < 0.05, `core update ${(ms * 1000).toFixed(1)} µs per frame (budget 0.2 ms incl. the adapter's queries)`);
}

async function main(): Promise<void> {
  const t0 = Date.now();
  // Air temperature sanity (steam): a January morning shows breath, a July afternoon does not.
  const jan = estimateAirTemp(20, 8, 50, 0, 0);
  const jul = estimateAirTemp(200, 15, 50, 0, 0);
  const high = estimateAirTemp(269, 12, 1600, 0, 0);
  console.log(`air temperature estimate: January 8 h ${f2(jan)} °C, July 15 h ${f2(jul)} °C, late September noon at 1600 m ${f2(high)} °C`);
  gazeChecks();
  moodChecks();
  behaviorChecks();
  await rigChecks();
  costCheck();
  console.log(`\n${failures.length === 0 ? 'ALL PASS' : `${failures.length} FAILED`} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const jsonAt = process.argv.indexOf('--json');
  if (jsonAt >= 0 && process.argv[jsonAt + 1]) {
    writeFileSync(process.argv[jsonAt + 1], JSON.stringify({ results, failures }, null, 1));
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

void THREE;
