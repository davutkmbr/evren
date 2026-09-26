/**
 * Phase 20 stage B and C air-moves check, headless (no browser, no GPU): the real rig driven by the real FlightSim and
 * PoseDriver (tools/headless/pose/runtime.ts) through scripted inputs, delivered like the game's input (frame command
 * and edge latch).
 *
 *   npx tsx tools/headless/air-moves-check.ts            # table of numbers, exits 1 when one fails
 *   npx tsx tools/headless/air-moves-check.ts --json f   # also write the numbers to f
 *
 * 1. Gestures: the double-tap recogniser (300 ms window, a third tap starts a new pair, keys independent) and the
 *    pilot mapping of every double tap (Space, Shift, Q / E, A / D, S).
 * 2. Collisions in the flight model: a single Space tap stays one beat; Space still catches a free fall; Shift ×2 is
 *    the free fall when slow and the dart when fast; Shift held through a dart does not fold the wings after it; A / D
 *    ×2 rolls and S ×2 loops; a Space double tap under water still breaches; a dart low over water never plunges.
 * 3. Güç vuruşu: +4–6 m/s over ~0.8 s, two downstrokes, stamina cost; refused when stamina is low.
 * 4. Dart: the wings half folded for ~1 s and open again on their own, the drag drops, the speed builds (above the
 *    entry and well above plain gliding over the same time).
 * 5. Kayış: 1–2 body lengths sideways, heading (body and track) within ±5°; refused beside a wall, over a roof, slow.
 * 6. Sıyırma: drag area measurably lower than the plain ground effect at the same height (land and water), never
 *    touching (feet, wings and tail over land; feet and wings over water), the assist clearance still holding, no
 *    skim when slow.
 * 7. Stage C reversals: the wingover (entries 28–66 m/s) exits on the reverse heading ±15° with ≥ 90 % of the entry's specific energy (from 40 m/s down to 72 % at 62 m/s)
 *    (½V² + g·Δh, height from the entry), slow over the top and past knife-edge; the Immelmann ends upright on the
 *    reverse heading ±15°, higher (early, middle and late presses in the loop's top window); the Split-S ends upright on
 *    the reverse heading ±15°, lower and faster (also from a folded Shift dive); the key held through its half roll spins
 *    on as the diving barrel roll; collisions with the loop and the barrel roll; refusals near the ground, beside a
 *    wall and under a deck; no stall, no contact.
 * Every move's end is checked on the flight-internal maneuver event (`ended`, `clean`).
 */
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { AxisPress, DoubleTapRecognizer, DOUBLE_TAP_MS, inImmelmannWindow, resolvePitchUpDoubleTap, resolveRollDoubleTap } from '../../src/core/gestures';
import type { Input } from '../../src/core/input';
import { airDensity } from '../../src/dragon/flight/aero';
import { slipDistance, wingoverCleanEnergy } from '../../src/dragon/flight/maneuvers';
import { DART, FLAP, IMMELMANN, POWER_STROKE, SKIM, SPLIT_S, WINGOVER } from '../../src/dragon/flight/params';
import { readPilotInput } from '../../src/dragon/flight/pilot';
import type { FlightSim } from '../../src/dragon/flight/sim';
import { createPilotCommand, type MoveRecord, type SimEvent } from '../../src/dragon/flight/types';
import { lowestParts } from './pose/parts';
import { collectMeshes } from './pose/raster';
import { buildRig, PoseRuntime, type FrameInput, type FrameRecord, type Terrain } from './pose/runtime';
import { GROUND_Y } from './pose/scenarios';

const DEG = 180 / Math.PI;
const failures: string[] = [];
const results: Record<string, number | string | boolean> = {};
const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : 'n/a');
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : 'n/a');
const table: string[][] = [];

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
/* Runs                                                                 */
/* ------------------------------------------------------------------ */

interface TimedEvent {
  t: number;
  e: SimEvent;
}

interface Run {
  rt: PoseRuntime;
  records: FrameRecord[];
  events: TimedEvent[];
  /** Per-frame samples the script asked for. */
  samples: Array<Record<string, number>>;
}

type Script = (t: number, sim: FlightSim, input: FrameInput, sample: (s: Record<string, number>) => void) => void;

interface Setup {
  sea?: boolean;
  terrain?: Terrain;
  /** Height (m) above the ground (land) or the water (sea). */
  height: number;
  speed: number;
  prep?: (rt: PoseRuntime) => void;
}

async function simulate(setup: Setup, seconds: number, script: Script, fps = 60): Promise<Run> {
  // A fresh rig per run keeps the animator state independent.
  const rig = await buildRig();
  const rt = new PoseRuntime(rig, setup.sea ? -30 : GROUND_Y, setup.sea ?? false, setup.terrain);
  rt.teleport(0, (setup.sea ? 0 : GROUND_Y) + setup.height, 0, 0, setup.speed);
  setup.prep?.(rt);
  rt.sim.queueEvents = true;
  const events: TimedEvent[] = [];
  const samples: Array<Record<string, number>> = [];
  const drain = (t: number): void => {
    for (const e of rt.sim.events) {
      events.push({ t, e });
    }
    rt.sim.events.length = 0;
  };
  const records = rt.run({
    seconds,
    renderFps: fps,
    script: (t, sim, input) => {
      drain(t);
      script(t, sim, input, (s) => samples.push({ t, ...s }));
    },
  });
  drain(seconds);
  return { rt, records, events, samples };
}

/** Script helper: presses the edges once at `at` s (a double tap's second press carries the plain press too). */
function pressOnce(): (t: number, at: number, input: FrameInput, ...edges: Parameters<FrameInput['press']>[0][]) => void {
  const done = new Set<number>();
  return (t, at, input, ...edges) => {
    if (t >= at && !done.has(at)) {
      done.add(at);
      for (const e of edges) {
        input.press(e);
      }
    }
  };
}

function moveEvents(run: Run, id: string): Array<{ t: number; ended: boolean; clean?: boolean }> {
  const out: Array<{ t: number; ended: boolean; clean?: boolean }> = [];
  for (const { t, e } of run.events) {
    if (e.type === 'maneuver' && e.id === id) {
      out.push({ t, ended: !!e.ended, clean: e.clean });
    }
  }
  return out;
}

function hints(run: Run): string[] {
  return run.events.filter(({ e }) => e.type === 'maneuver' && e.id === 'hint').map(({ e }) => (e as { label: string }).label);
}

function lastMove(run: Run, id: string): MoveRecord | undefined {
  return [...run.rt.sim.maneuvers.log].reverse().find((m) => m.id === id);
}

function recordAt(run: Run, t: number): FrameRecord {
  return run.records.find((r) => r.time >= t - 1e-6) ?? run.records[run.records.length - 1];
}

function meshRun(run: Run): Parameters<typeof lowestParts>[0] {
  const boneNames = run.rt.rig.skel.bones.map((b) => b.name);
  const meshes = collectMeshes(run.rt.rig.root, boneNames);
  const sea = run.rt.sea;
  const geo = run.rt.sim.world.geo!;
  return { records: run.records, meshes, boneNames, ground: sea ? () => 0 : (x, z) => geo.heightAt(x, z) };
}

function row(move: string, entry: number, exit: number, dh: number, lateral: string, stamina: number, time: number, clean: boolean | undefined, extra: string): void {
  table.push([move, f1(entry), f1(exit), f1(exit - entry), f1(dh), lateral, f2(stamina), f2(time), String(clean), extra]);
}

/* ------------------------------------------------------------------ */
/* 1. Gestures                                                          */
/* ------------------------------------------------------------------ */

type Button = 'flap' | 'dive' | 'yawLeft' | 'yawRight' | 'rollLeft' | 'rollRight' | 'pitchUp' | 'pitchDown';

/** Input stand-in fed with key presses per frame through the same recogniser as core/input.ts. */
class FakeInput {
  private readonly taps = new DoubleTapRecognizer<Button>(DOUBLE_TAP_MS);
  private pressed = new Set<string>();
  private doubles = new Set<string>();

  frame(presses: Button[], timeMs: number): void {
    this.pressed = new Set(presses);
    this.doubles = new Set(presses.filter((b) => this.taps.press(b, timeMs)));
  }

  axis(): number {
    return 0;
  }

  isHeld(): boolean {
    return false;
  }

  wasPressed(name: string): boolean {
    return this.pressed.has(name);
  }

  wasDoubleTapped(name: string): boolean {
    return this.doubles.has(name);
  }
}

function gestures(): void {
  console.log('\n1. Gestures (double-tap window 300 ms)');
  const r = new DoubleTapRecognizer<string>();
  const seq = [r.press('flap', 0), r.press('flap', 250), r.press('flap', 400), r.press('flap', 600)];
  check(!seq[0] && seq[1] && !seq[2] && seq[3], `recogniser: tap-tap within 300 ms is one double tap, a third tap starts a new pair (${seq.join(', ')})`);
  const slow = [r.press('dive', 1000), r.press('dive', 1310)];
  check(!slow[0] && !slow[1], 'recogniser: presses 310 ms apart are two single taps');
  const mixed = [r.press('rollLeft', 2000), r.press('rollRight', 2100), r.press('rollLeft', 2200)];
  check(!mixed[0] && !mixed[1] && mixed[2], 'recogniser: keys are independent (A, D, A → the second A is a double tap of A only)');

  // Stage C: the flight state picks the move of a shared gesture.
  const R = Math.PI / 180;
  const pitchUp = [0, 30, 45, 46, 65, -65].map((b) => resolvePitchUpDoubleTap(b * R, WINGOVER.minBank));
  check(pitchUp.join(',') === 'loop,loop,loop,wingover,wingover,wingover', `resolver: S ×2 at bank 0 / 30 / 45 / 46 / 65 / −65° → ${pitchUp.join(', ')}`);
  const rollTap = [0, 10, -20, -30, -31, -80].map((g) => resolveRollDoubleTap(g * R, SPLIT_S.maxPath));
  check(rollTap.join(',') === 'roll,roll,roll,roll,splits,splits', `resolver: A / D ×2 at path 0 / 10 / −20 / −30 / −31 / −80° → ${rollTap.join(', ')}`);
  const win = [90, 100, 150, 190, 200].map((a) => inImmelmannWindow(a * R, IMMELMANN.windowStart, IMMELMANN.windowEnd));
  check(win.join(',') === 'false,true,true,true,false', `resolver: A / D in the loop at 90 / 100 / 150 / 190 / 200° → Immelmann ${win.join(', ')}`);
  const axis = new AxisPress(0.5, 0.2);
  const axisSeq = [0, 0.3, 0.6, 0.9, 0.4, 0.6, 0.1, -0.55, -1, 0, 1].map((v) => axis.update(v));
  check(axisSeq.join(',') === '0,0,1,0,0,0,0,-1,0,0,1', `axis press: fresh presses past 0.5 after a release below 0.2 (${axisSeq.join(', ')})`);

  const cases: Array<{ name: string; keys: Button[]; want: string[] }> = [
    { name: 'Space', keys: ['flap'], want: ['flapPressed'] },
    { name: 'Space ×2', keys: ['flap', 'flap'], want: ['flapPressed', 'powerPressed'] },
    { name: 'Shift ×2', keys: ['dive', 'dive'], want: ['dropPressed'] },
    { name: 'Q ×2', keys: ['yawLeft', 'yawLeft'], want: ['slipLeftPressed'] },
    { name: 'E ×2', keys: ['yawRight', 'yawRight'], want: ['slipRightPressed'] },
    { name: 'A ×2', keys: ['rollLeft', 'rollLeft'], want: ['rollLeftPressed'] },
    { name: 'D ×2', keys: ['rollRight', 'rollRight'], want: ['rollRightPressed'] },
    { name: 'S ×2', keys: ['pitchUp', 'pitchUp'], want: ['loopPressed'] },
    { name: 'Q, E', keys: ['yawLeft', 'yawRight'], want: [] },
  ];
  const edges = ['flapPressed', 'powerPressed', 'dropPressed', 'slipLeftPressed', 'slipRightPressed', 'rollLeftPressed', 'rollRightPressed', 'loopPressed'] as const;
  for (const c of cases) {
    const input = new FakeInput();
    const cmd = createPilotCommand();
    // Taps 180 ms apart, one per frame; the edges of the last frame are what the last press produced.
    c.keys.forEach((k, i) => {
      input.frame([k], 1000 + 180 * i);
      readPilotInput(input as unknown as Input, cmd);
    });
    const got = edges.filter((e) => cmd[e]);
    // Plain presses of Space / Shift are edges only for Space (flapPressed); a single key press has no double tap.
    const ok = got.length === c.want.length && c.want.every((w) => got.includes(w as (typeof edges)[number]));
    check(ok, `pilot: ${c.name} → ${c.want.length ? c.want.join(' + ') : 'no move edge'} (got ${got.join(' + ') || 'none'})`);
  }
}

/* ------------------------------------------------------------------ */
/* 2. Collisions in the flight model                                    */
/* ------------------------------------------------------------------ */

async function collisions(): Promise<void> {
  console.log('\n2. Gesture collisions in the flight model');
  {
    const press = pressOnce();
    let effort = 0;
    const run = await simulate({ height: 200, speed: 30 }, 3, (t, sim, input) => {
      press(t, 1, input, 'flap');
      if (t > 1) {
        effort = Math.max(effort, sim.beat.effort);
      }
    });
    check(moveEvents(run, 'power').length === 0 && effort > 0.8, `a single Space tap is one beat, no power stroke (beat effort ${f2(effort)})`);
  }
  {
    const press = pressOnce();
    let catchAt = -1;
    const run = await simulate({ height: 500, speed: 26 }, 4, (t, sim, input) => {
      press(t, 0.5, input, 'drop');
      press(t, 1.6, input, 'flap');
      press(t, 1.8, input, 'flap', 'power');
      if (catchAt < 0 && sim.maneuvers.kind === 'catch') {
        catchAt = t;
      }
    });
    const drop = run.records.some((r) => r.trick === 'drop');
    check(drop && catchAt >= 1.6 && catchAt < 1.7 && moveEvents(run, 'power').length === 0, `Space (and a Space double tap) still catches a free fall (drop ${drop}, catch at ${f2(catchAt)} s, no power stroke)`);
  }
  for (const [speed, want] of [
    [26, 'drop'],
    [36, 'dart'],
  ] as const) {
    const press = pressOnce();
    const run = await simulate({ height: 400, speed }, 2, (t, _sim, input) => {
      press(t, 0.5, input, 'drop');
    });
    const tricks = new Set(run.records.map((r) => r.trick));
    check(tricks.has(want) && !tricks.has(want === 'drop' ? 'dart' : 'drop'), `Shift ×2 at ${speed} m/s → ${want === 'drop' ? 'free fall' : 'dart'}`);
  }
  {
    // Shift pressed twice and held on: the dart runs, reopens on its own, and the held Shift stays ignored after it.
    const press = pressOnce();
    const run = await simulate({ height: 300, speed: 36 }, 4, (t, _sim, input) => {
      press(t, 0.5, input, 'drop');
      input.cmd.dive = t >= 0.5 && t < 3.5;
    });
    const end = moveEvents(run, 'dart').find((e) => e.ended);
    const after = end ? recordAt(run, end.t + 0.4) : null;
    check(!!after && after.pose.wingSpread > 0.5 && after.mode !== 'diving' && after.trick === 'none', `Shift held through the dart: the wings stay open after it (spread ${after ? f2(after.pose.wingSpread) : 'n/a'}, ${after?.mode} 0.4 s after the end)`);
  }
  for (const [edge, trick, speed] of [
    ['rollRight', 'roll', 34],
    ['loop', 'loop', 40],
  ] as const) {
    const press = pressOnce();
    const run = await simulate({ height: 300, speed }, 1.5, (t, _sim, input) => {
      press(t, 0.5, input, edge);
    });
    check(run.records.some((r) => r.trick === trick), `${edge === 'loop' ? 'S' : 'D'} ×2 still starts the ${trick}`);
  }
  {
    // Under water: S held brings the nose up; a Space double tap near the surface breaches (no power stroke).
    let tapped = -1;
    const run = await simulate(
      {
        sea: true,
        height: 22,
        speed: 45,
        prep: (rt) => {
          const path = -60 / DEG;
          rt.teleport(0, 22, 0, 0, 45, -60);
          rt.sim.body.velocity.set(0, Math.sin(path) * 45, -Math.cos(path) * 45);
          rt.sim.spread = 0.08;
          rt.sim.sweep = 1;
        },
      },
      8,
      (t, sim, input) => {
        if (sim.mode !== 'underwater' && tapped < 0 && t < 2) {
          input.cmd.dive = true;
          input.pathDeg = -60;
          return;
        }
        if (sim.mode === 'underwater') {
          input.cmd.pitch = sim.dive.pitch < 40 / DEG ? -1 : 0;
          const depth = sim.waterY - sim.body.position.y;
          if (tapped < 0 && sim.dive.time > 0.8 && depth < 2.5 && sim.body.velocity.y > 0) {
            tapped = t;
            input.press('flap');
          }
        }
        if (tapped >= 0 && t >= tapped + 0.15 && t < tapped + 0.15 + 1 / 60) {
          input.press('flap');
          input.press('power');
        }
      },
    );
    const breach = run.events.some(({ e }) => e.type === 'maneuver' && e.id === 'breach');
    check(breach && moveEvents(run, 'power').length === 0, `a Space double tap under water still breaches (breach ${breach}, tapped at ${f2(tapped)} s, no power stroke)`);
  }
  {
    const press = pressOnce();
    let under = false;
    const run = await simulate({ sea: true, height: 12, speed: 36 }, 4, (t, sim, input) => {
      press(t, 0.5, input, 'drop');
      input.cmd.dive = t >= 0.5 && t < 2;
      under ||= sim.mode === 'underwater' || sim.mode === 'swimming';
    });
    const rec = lastMove(run, 'dart');
    check(!!rec && !under, `a dart 12 m over the sea never plunges (clean ${rec?.clean}, lowest foot clearance ${f2(Math.min(...run.records.map((r) => r.footClearance)))} m)`);
  }
}

/* ------------------------------------------------------------------ */
/* 3. Power stroke                                                      */
/* ------------------------------------------------------------------ */

async function powerStroke(): Promise<void> {
  console.log('\n3. Güç vuruşu (Space ×2: the first tap at 1.0 s, the second at 1.18 s)');
  for (const speed of [26, 32]) {
    const press = pressOnce();
    const run = await simulate({ height: 200, speed }, 4, (t, sim, input, sample) => {
      press(t, 1, input, 'flap');
      press(t, 1.18, input, 'flap', 'power');
      sample({ stamina: sim.stamina });
    });
    const rec = lastMove(run, 'power');
    const ev = moveEvents(run, 'power');
    if (!rec) {
      check(false, `power stroke at ${speed} m/s: runs`);
      continue;
    }
    const gain = rec.exitSpeed - rec.entrySpeed;
    // Downstrokes while it ran: the one under way at the start (the first tap's) plus the wraps of the beat phase.
    const startRec = recordAt(run, rec.start);
    let strokes = startRec.pose.flapPhase < 2 * Math.PI * FLAP.downstrokeFraction && startRec.pose.flapAmplitude > 0.25 ? 1 : 0;
    for (let k = 1; k < run.records.length; k++) {
      const r = run.records[k];
      if (r.time > rec.start && r.time <= rec.start + rec.duration && r.pose.flapPhase < run.records[k - 1].pose.flapPhase - 1) {
        strokes++;
      }
    }
    const peakAmp = Math.max(...run.records.filter((r) => r.time > rec.start && r.time < rec.start + rec.duration).map((r) => r.pose.flapAmplitude));
    // Stamina from just before the second tap to the end of the move (the strokes' up-front cost plus their effort).
    const st = (t: number): number => (run.samples.find((x) => x.t >= t) ?? run.samples[run.samples.length - 1]).stamina;
    const staminaCost = st(rec.start - 0.02) - st(rec.start + rec.duration);
    console.log(
      `  ${speed} m/s: ${f1(rec.entrySpeed)} → ${f1(rec.exitSpeed)} m/s (+${f2(gain)}) in ${f2(rec.duration)} s, ${strokes} downstrokes, peak amplitude ${f2(peakAmp)}, height ${f2(rec.heightChange)} m, stamina −${f2(staminaCost)}`,
    );
    note(`power.${speed}.gain`, gain);
    note(`power.${speed}.time`, rec.duration);
    row(`power ${speed}`, rec.entrySpeed, rec.exitSpeed, rec.heightChange, '-', staminaCost, rec.duration, ev.find((e) => e.ended)?.clean, `${strokes} downstrokes`);
    check(strokes === POWER_STROKE.beats && peakAmp > 0.95 && staminaCost >= POWER_STROKE.stamina, `power stroke at ${speed} m/s: ${POWER_STROKE.beats} full downstrokes (${strokes}, peak amplitude ${f2(peakAmp)}), costs stamina (${f2(staminaCost)})`);
    check(gain >= 4 && gain <= 6, `power stroke at ${speed} m/s: +4–6 m/s (+${f2(gain)})`);
    check(rec.duration >= 0.6 && rec.duration <= 1.1, `power stroke at ${speed} m/s: ~0.8 s (${f2(rec.duration)} s)`);
    check(ev.length === 2 && ev[1].ended && ev[1].clean === true, `power stroke at ${speed} m/s: announced, ends clean on the maneuver event`);
  }
  {
    const press = pressOnce();
    const run = await simulate({ height: 200, speed: 30 }, 2, (t, sim, input) => {
      if (t < 0.9) {
        sim.stamina = 0.08;
      }
      press(t, 1, input, 'flap');
      press(t, 1.18, input, 'flap', 'power');
    });
    const h = hints(run);
    check(moveEvents(run, 'power').length === 0 && h.some((x) => x.includes('yorgun')), `refused with low stamina (0.08): hint "${h.join(' / ')}"`);
  }
}

/* ------------------------------------------------------------------ */
/* 4. Dart                                                              */
/* ------------------------------------------------------------------ */

async function dart(): Promise<void> {
  console.log('\n4. Dart (Shift ×2 at 1.0 s, hands-off)');
  for (const speed of [34, 42]) {
    const press = pressOnce();
    const run = await simulate({ height: 200, speed }, 4, (t, sim, input, sample) => {
      press(t, 1, input, 'drop');
      sample({ drag: sim.drag, q: 0.5 * airDensity(sim.body.position.y) * sim.airspeed * sim.airspeed });
    });
    const rec = lastMove(run, 'dart');
    const ev = moveEvents(run, 'dart');
    if (!rec) {
      check(false, `dart at ${speed} m/s: runs`);
      continue;
    }
    const baseRun = await simulate({ height: 200, speed }, 4, (_t, sim, _input, sample) => {
      sample({ drag: sim.drag, q: 0.5 * airDensity(sim.body.position.y) * sim.airspeed * sim.airspeed });
    });
    const baseExit = recordAt(baseRun, rec.start + rec.duration).airspeed;
    const baseEntry = recordAt(baseRun, rec.start).airspeed;
    // Folded time: spread below 0.6; reopened when back above 0.9.
    const folded = run.records.filter((r) => r.time >= rec.start && r.pose.wingSpread < 0.6);
    const foldTime = folded.length ? folded[folded.length - 1].time - folded[0].time : 0;
    const reopen = run.records.find((r) => r.time > rec.start + 0.3 && r.pose.wingSpread > 0.9);
    const reopenAt = reopen ? reopen.time - rec.start : NaN;
    // Drag area in the middle of the dart against plain gliding at the same moment.
    const cda = (s: Array<Record<string, number>>, t0: number, t1: number): number => {
      const w = s.filter((x) => x.t >= t0 && x.t <= t1);
      return w.reduce((a, x) => a + x.drag / x.q, 0) / Math.max(w.length, 1);
    };
    const mid0 = rec.start + 0.3;
    const mid1 = rec.start + 0.9;
    const dartCda = cda(run.samples, mid0, mid1);
    const glideCda = cda(baseRun.samples, mid0, mid1);
    const gain = rec.exitSpeed - rec.entrySpeed;
    console.log(
      `  ${speed} m/s: ${f1(rec.entrySpeed)} → ${f1(rec.exitSpeed)} m/s (${gain >= 0 ? '+' : ''}${f2(gain)}) in ${f2(rec.duration)} s; plain glide ${f1(baseEntry)} → ${f1(baseExit)}; folded ${f2(foldTime)} s, open again at ${f2(reopenAt)} s; drag area ${f2(dartCda)} m² vs ${f2(glideCda)} m² gliding; height ${f2(rec.heightChange)} m`,
    );
    note(`dart.${speed}.gain`, gain);
    note(`dart.${speed}.vsGlide`, rec.exitSpeed - baseExit);
    note(`dart.${speed}.cdaRatio`, dartCda / glideCda);
    row(`dart ${speed}`, rec.entrySpeed, rec.exitSpeed, rec.heightChange, '-', 0, rec.duration, ev.find((e) => e.ended)?.clean, `vs glide +${f1(rec.exitSpeed - baseExit)}, CdA ×${f2(dartCda / glideCda)}`);
    check(gain > 0.3 && rec.exitSpeed - baseExit > 1.5, `dart at ${speed} m/s: speed builds (+${f2(gain)} over the entry, +${f2(rec.exitSpeed - baseExit)} over plain gliding)`);
    check(dartCda < 0.7 * glideCda, `dart at ${speed} m/s: drag drops (drag area ×${f2(dartCda / glideCda)} < 0.7)`);
    check(foldTime >= 0.85 && foldTime <= 1.2 && reopenAt <= DART.time + DART.open + 0.1, `dart at ${speed} m/s: ~1 s folded (${f2(foldTime)} s), opens on its own (${f2(reopenAt)} s)`);
    check(rec.heightChange > -15, `dart at ${speed} m/s: a shallow dive (${f2(rec.heightChange)} m)`);
    check(ev.length === 2 && ev[1].ended && ev[1].clean === true, `dart at ${speed} m/s: announced, ends clean on the maneuver event`);
  }
}

/* ------------------------------------------------------------------ */
/* 5. Side-slip                                                         */
/* ------------------------------------------------------------------ */

function trackHeading(r: FrameRecord): number {
  return Math.atan2(-r.velocity[0], -r.velocity[2]);
}

async function sideSlip(): Promise<void> {
  console.log('\n5. Kayış (Q / E ×2 at 1.0 s, hands-off)');
  for (const [edge, dir] of [
    ['slipRight', 1],
    ['slipLeft', -1],
  ] as const) {
    const press = pressOnce();
    const run = await simulate({ height: 120, speed: 34 }, 4, (t, sim, input, sample) => {
      press(t, 1, input, edge);
      sample({ stamina: sim.stamina });
    });
    const rec = lastMove(run, 'slip');
    const ev = moveEvents(run, 'slip');
    if (!rec) {
      check(false, `side-slip ${edge}: runs`);
      continue;
    }
    const length = run.rt.sim.rigLength;
    const r0 = recordAt(run, rec.start);
    const r1 = recordAt(run, rec.start + rec.duration);
    const lateral = (r1.position[0] - r0.position[0]) * dir;
    let worstHeading = 0;
    let worstBank = 0;
    for (const r of run.records) {
      if (r.time >= rec.start && r.time <= rec.start + rec.duration) {
        worstHeading = Math.max(worstHeading, Math.abs(((r.headingDeg - r0.headingDeg + 540) % 360) - 180));
        worstBank = Math.max(worstBank, Math.abs(r.bankDeg));
      }
    }
    const trackChange = Math.abs(Math.atan2(Math.sin(trackHeading(r1) - trackHeading(r0)), Math.cos(trackHeading(r1) - trackHeading(r0)))) * DEG;
    const headingEnd = Math.abs(rec.headingChange * DEG);
    const lengths = lateral / length;
    const st = (t: number): number => (run.samples.find((x) => x.t >= t) ?? run.samples[run.samples.length - 1]).stamina;
    const stamina = st(rec.start - 0.02) - st(rec.start + rec.duration);
    console.log(
      `  ${edge.padEnd(9)}: ${f2(lateral)} m sideways (${f2(lengths)} body lengths of ${f1(length)} m) in ${f2(rec.duration)} s; heading at the end ${f2(headingEnd)}°, largest ${f2(worstHeading)}°, track ${f2(trackChange)}°; bank up to ${f1(worstBank)}°; ${f1(rec.entrySpeed)} → ${f1(rec.exitSpeed)} m/s, height ${f2(rec.heightChange)} m, stamina −${f2(stamina)}`,
    );
    note(`slip.${dir}.lateral`, lateral);
    note(`slip.${dir}.heading`, worstHeading);
    row(`slip ${dir > 0 ? 'E' : 'Q'}`, rec.entrySpeed, rec.exitSpeed, rec.heightChange, `${f1(lateral)} m (${f2(lengths)} L)`, stamina, rec.duration, ev.find((e) => e.ended)?.clean, `hdg ≤ ${f1(worstHeading)}°, track ${f1(trackChange)}°`);
    check(lengths >= 1 && lengths <= 2, `side-slip ${edge}: 1–2 body lengths (${f2(lengths)})`);
    check(worstHeading <= 5 && trackChange <= 5, `side-slip ${edge}: heading kept within ±5° (body ${f2(worstHeading)}°, track ${f2(trackChange)}°)`);
    check(ev.length === 2 && ev[1].ended && ev[1].clean === true, `side-slip ${edge}: announced, ends clean on the maneuver event`);
  }
  // Refusals: a wall along the right side, a roof under the destination, too slow.
  const wall = (rt: PoseRuntime): void => {
    rt.sim.world.collision!.add({ kind: 'box', center: new THREE.Vector3(22, GROUND_Y + 100, -80), halfSize: new THREE.Vector3(2, 100, 120), yaw: 0 }, 'structure', 'test-wall');
  };
  const roof = (rt: PoseRuntime): void => {
    const feet = rt.sim.body.position.y - rt.sim.footDepth();
    const top = feet - 1;
    rt.sim.world.collision!.add(
      { kind: 'box', center: new THREE.Vector3(slipDistance(rt.sim), (top + GROUND_Y) / 2, -60), halfSize: new THREE.Vector3(12, (top - GROUND_Y) / 2, 90), yaw: 0 },
      'structure',
      'test-roof',
    );
  };
  for (const [label, setup, edge, want] of [
    ['wall 22 m to the right', { height: 60, speed: 34, prep: wall }, 'slipRight', false],
    ['wall 22 m to the right, slipping left', { height: 60, speed: 34, prep: wall }, 'slipLeft', true],
    ['a roof 1 m below the feet at the destination', { height: 12, speed: 34, prep: roof }, 'slipRight', false],
    ['at 14 m/s', { height: 120, speed: 14 }, 'slipRight', false],
  ] as const) {
    const press = pressOnce();
    const run = await simulate(setup, 2.5, (t, _sim, input) => {
      press(t, 0.5, input, edge);
    });
    const started = moveEvents(run, 'slip').length > 0;
    const touched = run.records.some((r) => r.footClearance < 0);
    const h = hints(run);
    check(started === want && !touched, `side-slip ${label}: ${want ? 'allowed' : `refused (hint "${h.join(' / ')}")`}`);
  }
}

/* ------------------------------------------------------------------ */
/* 6. Surface skim                                                      */
/* ------------------------------------------------------------------ */

/** Altitude-hold pilot: flight path toward `height` m of foot clearance (assist override, like __flightTest). */
function holdHeight(height: number): (sim: FlightSim, input: FrameInput) => void {
  return (sim, input) => {
    input.pathDeg = Math.max(-4, Math.min(4, (height - sim.footClearance) * 2.5));
  };
}

async function skim(): Promise<void> {
  console.log('\n6. Sıyırma (automatic; altitude-hold pilot, cruise flapping off for the drag numbers)');
  const cda = async (sea: boolean, height: number, enabled: boolean): Promise<{ cda: number; amount: number; decel: number }> => {
    const hold = holdHeight(height);
    const run = await simulate(
      {
        sea,
        height: height + 1.8,
        speed: 32,
        prep: (rt) => {
          rt.sim.options.autoFlap = false;
          rt.sim.skim.enabled = enabled;
        },
      },
      4,
      (_t, sim, input, sample) => {
        hold(sim, input);
        sample({ cda: sim.drag / (0.5 * airDensity(sim.body.position.y) * sim.airspeed * sim.airspeed), amount: sim.skim.amount, v: sim.airspeed });
      },
    );
    const w = run.samples.filter((s) => s.t >= 2 && s.t <= 3.5);
    const mean = (k: string): number => w.reduce((a, s) => a + s[k], 0) / Math.max(w.length, 1);
    return { cda: mean('cda'), amount: mean('amount'), decel: (w[0].v - w[w.length - 1].v) / (w[w.length - 1].t - w[0].t) };
  };
  for (const sea of [false, true]) {
    const where = sea ? 'water' : 'land';
    const on = await cda(sea, 3.2, true);
    const off = await cda(sea, 3.2, false);
    const high = await cda(sea, 40, true);
    console.log(
      `  over ${where}, 3.2 m, 32 m/s gliding: drag area ${f2(on.cda)} m² with the skim (strength ${f2(on.amount)}), ${f2(off.cda)} m² plain ground effect, ${f2(high.cda)} m² at 40 m; deceleration ${f2(on.decel)} / ${f2(off.decel)} / ${f2(high.decel)} m/s²`,
    );
    note(`skim.${where}.cdaRatio`, on.cda / off.cda);
    check(on.amount > 0.8 && on.cda < 0.9 * off.cda && on.cda < high.cda, `skim over ${where}: drag area measurably lower (×${f2(on.cda / off.cda)} of the plain ground effect, ×${f2(on.cda / high.cda)} of 40 m)`);
    table.push([`skim ${where}`, '32', '-', '-', '-', '-', '0', '-', '-', `CdA ×${f2(on.cda / off.cda)} (plain GE), ×${f2(on.cda / high.cda)} (40 m)`]);
  }

  // A skim run over land and over water with cruise flapping: never touching; wings, tail and feet above the surface.
  for (const sea of [false, true]) {
    const where = sea ? 'water' : 'land';
    const hold = holdHeight(3);
    let touched = false;
    let minFoot = Infinity;
    let splashes = 0;
    let dust = 0;
    const run = await simulate({ sea, height: 5, speed: 32 }, 9, (t, sim, input) => {
      if (t < 6) {
        hold(sim, input);
      } else {
        input.pathDeg = 8;
      }
      touched ||= sim.impact.touched || sim.touchingWater;
      minFoot = Math.min(minFoot, sim.footClearance);
    });
    for (const { e } of run.events) {
      splashes += e.type === 'splash' ? 1 : 0;
      dust += e.type === 'dust' ? 1 : 0;
    }
    const ev = moveEvents(run, 'skim');
    const rec = lastMove(run, 'skim');
    const low = lowestParts(meshRun(run), 1, 6, 2);
    console.log(
      `  over ${where}, held at 3 m for 6 s: lowest foot clearance ${f2(minFoot)} m, wing ${f2(low.wing)} m, tail ${f2(low.tail)} m above the surface; ${sea ? `${splashes} spray kisses` : `${dust} dust kisses`}; skim ${rec ? `${f1(rec.entrySpeed)} → ${f1(rec.exitSpeed)} m/s over ${f2(rec.duration)} s` : 'not recorded'}`,
    );
    note(`skim.${where}.minFoot`, minFoot);
    note(`skim.${where}.wing`, low.wing);
    note(`skim.${where}.tail`, low.tail);
    if (rec) {
      row(`skim ${where} run`, rec.entrySpeed, rec.exitSpeed, rec.heightChange, '-', 0, rec.duration, ev.find((e) => e.ended)?.clean, `wing ${f2(low.wing)} m, tail ${f2(low.tail)} m`);
    }
    check(!touched && minFoot > 0, `skim over ${where}: the body never touches (lowest foot clearance ${f2(minFoot)} m)`);
    check(low.wing > -0.02 && (sea ? low.tail > -0.3 : low.tail > -0.02), `skim over ${where}: wings${sea ? '' : ' and tail'} stay above the surface (wing ${f2(low.wing)}, tail ${f2(low.tail)} m${sea ? ', the tail tip may dip into the water' : ''})`);
    check((sea ? splashes : dust) > 0, `skim over ${where}: wingtips / tail kiss the surface (${sea ? splashes : dust} ${sea ? 'spray' : 'dust'} events)`);
    check(ev.length >= 2 && ev[0].ended === false && ev.some((e) => e.ended && e.clean === true), `skim over ${where}: announced once, ends clean on the maneuver event`);
  }

  // W held low over land: the assist floor keeps the feet clear while skimming.
  for (const enabled of [true, false]) {
    let touched = false;
    let minFoot = Infinity;
    let skimMax = 0;
    const run = await simulate({ height: 5, speed: 32, prep: (rt) => (rt.sim.skim.enabled = enabled) }, 6, (_t, sim, input) => {
      input.cmd.pitch = 1;
      touched ||= sim.impact.touched;
      minFoot = Math.min(minFoot, sim.footClearance);
      skimMax = Math.max(skimMax, sim.skim.amount);
    });
    const low = lowestParts(meshRun(run), 0.5, 6, 2);
    const at = recordAt(run, low.frameWing);
    console.log(
      `  W held from 5 m over land${enabled ? '' : ' (skim off)'}: lowest foot clearance ${f2(minFoot)} m, wing ${f2(low.wing)} m (at ${f2(low.frameWing)} s: bank ${f1(at.bankDeg)}°, pitch ${f1(at.pitchDeg)}°, amplitude ${f2(at.pose.flapAmplitude)}, phase ${f2(at.pose.flapPhase)}, fc ${f2(at.footClearance)}), tail ${f2(low.tail)} m, skim up to ${f2(skimMax)}`,
    );
    if (enabled) {
      check(!touched && minFoot > 0.5 && low.wing > -0.02 && low.tail > -0.02, `W held low over land: the assist floor still holds (feet ${f2(minFoot)} m, wing ${f2(low.wing)}, tail ${f2(low.tail)} m)`);
    }
  }
  // Hands-off low over land: the assist climbs back to its clearance (the skim is a deliberate low line).
  {
    let minFoot = Infinity;
    const run = await simulate({ height: 4, speed: 30 }, 8, (_t, sim) => {
      minFoot = Math.min(minFoot, sim.footClearance);
    });
    const end = run.records[run.records.length - 1];
    console.log(`  hands-off from 4 m over land: lowest foot clearance ${f2(minFoot)} m, ${f1(end.footClearance)} m after 8 s`);
    check(minFoot > 0 && end.footClearance > 12, `hands-off low over land: never touches, climbs back out (${f1(end.footClearance)} m)`);
  }
  // Too slow: no skim.
  {
    const hold = holdHeight(3.2);
    let skimMax = 0;
    let slowest = Infinity;
    await simulate({ sea: true, height: 5, speed: 19, prep: (rt) => (rt.sim.options.autoFlap = false) }, 4, (_t, sim, input) => {
      hold(sim, input);
      if (sim.airspeed < SKIM.minSpeed) {
        skimMax = Math.max(skimMax, sim.skim.amount);
        slowest = Math.min(slowest, sim.airspeed);
      }
    });
    check(skimMax < 0.05, `no skim below ${SKIM.minSpeed} m/s (strength up to ${f2(skimMax)} down to ${f1(slowest)} m/s)`);
  }
}

/* ------------------------------------------------------------------ */
/* 7. Stage C reversals                                                 */
/* ------------------------------------------------------------------ */

/** Track heading change from `a` to `b` (deg, wrapped to ±180). */
function trackTurn(a: FrameRecord, b: FrameRecord): number {
  const d = trackHeading(b) - trackHeading(a);
  return Math.atan2(Math.sin(d), Math.cos(d)) * DEG;
}

/** How far a heading change (deg) is from a full reversal (deg). */
function offReverse(turnDeg: number): number {
  return Math.abs(180 - Math.abs(turnDeg));
}

/** Script helper for a banked entry: the roll key held (D = +1) until `release` s, S ×2 at `at` s. */
function bankedS(dir: number, at: number, release: number): Script {
  const press = pressOnce();
  return (t, _sim, input) => {
    input.cmd.roll = t < release ? dir : 0;
    press(t, at, input, 'loop');
  };
}

/** A dive at `pathDeg` held by the assist override until `at` s, then A / D ×2 (`edge`); `hold` s of the key after it. */
function diveThenTap(pathDeg: number, at: number, edge: 'rollLeft' | 'rollRight', hold = 0, shift = false): Script {
  const press = pressOnce();
  return (t, _sim, input) => {
    if (t < at) {
      input.pathDeg = pathDeg;
    }
    input.cmd.dive = shift && t < at + 3;
    press(t, at, input, edge);
    if (hold > 0 && t >= at && t < at + hold) {
      input.cmd.roll = edge === 'rollRight' ? 1 : -1;
    }
  };
}

function diveSetup(height: number, speed: number, pathDeg: number, folded = false): Setup {
  return {
    height,
    speed,
    prep: (rt) => {
      rt.teleport(0, GROUND_Y + height, 0, 0, speed, pathDeg);
      const path = pathDeg / DEG;
      rt.sim.body.velocity.set(0, Math.sin(path) * speed, -Math.cos(path) * speed);
      if (folded) {
        rt.sim.spread = 0.2;
        rt.sim.sweep = 0.9;
      }
    },
  };
}

/** Upright a moment after the end: |bank| below 30°, flying level-ish, no trick running. */
function settled(run: Run, end: number): { rec: FrameRecord; upright: boolean } {
  const rec = recordAt(run, end + 0.6);
  return { rec, upright: Math.abs(rec.bankDeg) < 30 && rec.trick === 'none' };
}

function reversalRow(label: string, rec: MoveRecord, run: Run, clean: boolean | undefined): void {
  const a = recordAt(run, rec.start);
  const b = recordAt(run, rec.start + rec.duration);
  table.push([
    label,
    f1(rec.entrySpeed),
    f1(rec.exitSpeed),
    f1(rec.exitSpeed - rec.entrySpeed),
    f1(rec.heightChange),
    '-',
    '-',
    f2(rec.duration),
    String(clean),
    `E ×${f2(rec.energyRatio)}, heading ${f1(Math.abs(trackTurn(a, b)))}°`,
  ]);
}

async function reversals(): Promise<void> {
  console.log('\n7. Stage C reversals (wingover, Immelmann, Split-S)');
  // Wingover: D held (bank 65°), S ×2 at 1.5 s, keys released at 1.6 s.
  for (const [speed, dir] of [
    [28, 1],
    [32, -1],
    [38, 1],
    [44, 1],
    [50, -1],
    [58, 1],
    [66, 1],
  ] as const) {
    const run = await simulate({ height: 250, speed }, 20, bankedS(dir, 1.5, 1.6));
    const rec = lastMove(run, 'wingover');
    const ev = moveEvents(run, 'wingover');
    const loops = run.records.some((r) => r.trick === 'loop');
    if (!rec) {
      check(false, `wingover at ${speed} m/s: runs (hints "${hints(run).join(' / ')}")`);
      continue;
    }
    const a = recordAt(run, rec.start);
    const end = recordAt(run, rec.start + rec.duration);
    const { rec: after, upright } = settled(run, rec.start + rec.duration);
    const turnEnd = trackTurn(a, end);
    const turnAfter = trackTurn(a, after);
    const window = run.records.filter((r) => r.time >= rec.start && r.time <= rec.start + rec.duration);
    const top = window.reduce((m, r) => (r.position[1] > m.position[1] ? r : m), window[0]);
    const maxBank = Math.max(...window.map((r) => Math.abs(r.bankDeg)));
    const contact = window.some((r) => r.footClearance < 0);
    console.log(
      `  ${speed} m/s (${dir > 0 ? 'D' : 'A'}): ${f1(rec.entrySpeed)} → ${f1(rec.exitSpeed)} m/s, height ${f1(rec.heightChange)} m (top +${f1(top.position[1] - a.position[1])} m at ${f1(top.airspeed)} m/s, bank up to ${f1(maxBank)}°), energy ×${f2(rec.energyRatio)}; track turned ${f1(turnEnd)}° at the end, ${f1(turnAfter)}° rolled out; ${f2(rec.duration)} s`,
    );
    note(`wingover.${speed}.energy`, rec.energyRatio);
    note(`wingover.${speed}.heading`, turnAfter);
    reversalRow(`wingover ${speed}`, rec, run, ev.find((e) => e.ended)?.clean);
    check(!loops && ev.length === 2 && !ev[0].ended && ev[1].ended && ev[1].clean === true, `wingover at ${speed} m/s: S ×2 while banked starts the wingover (no loop), announced, ends clean on the maneuver event`);
    check(offReverse(turnEnd) <= 15 && offReverse(turnAfter) <= 15 && upright, `wingover at ${speed} m/s: exits on the reverse heading ±15° (${f1(offReverse(turnEnd))}° off at the end, ${f1(offReverse(turnAfter))}° rolled out), upright`);
    const keep = wingoverCleanEnergy(rec.entrySpeed);
    check(rec.energyRatio >= keep, `wingover at ${speed} m/s: keeps ≥ ${Math.round(keep * 100)} % of the entry energy (×${f2(rec.energyRatio)})`);
    check(!rec.stalled && !rec.contact && !contact && top.airspeed < rec.entrySpeed - 4 && maxBank > 90, `wingover at ${speed} m/s: no stall or contact, slow over the top (${f1(top.airspeed)} m/s), pivots past knife-edge (${f1(maxBank)}°)`);
  }

  // Immelmann: S ×2 at 0.5 s, D (or A) pressed on the axis at a loop angle, held 0.3 s.
  for (const [speed, at, dir] of [
    [40, 150, 1],
    [36, 110, -1],
    [42, 185, 1],
  ] as const) {
    const press = pressOnce();
    let rollAt = -1;
    const run = await simulate({ height: 300, speed }, 9, (t, sim, input) => {
      press(t, 0.5, input, 'loop');
      if (rollAt < 0 && sim.maneuvers.kind === 'loop' && sim.maneuvers.describe().loopDeg >= at) {
        rollAt = t;
      }
      input.cmd.roll = rollAt >= 0 && t < rollAt + 0.3 ? dir : 0;
    });
    const rec = lastMove(run, 'immelmann');
    const ev = moveEvents(run, 'immelmann');
    if (!rec) {
      check(false, `Immelmann at ${speed} m/s (key at ${at}°): runs`);
      continue;
    }
    const a = recordAt(run, rec.start);
    const end = recordAt(run, rec.start + rec.duration);
    const { rec: after, upright } = settled(run, rec.start + rec.duration);
    const turn = trackTurn(a, end);
    const contact = run.records.some((r) => r.footClearance < 0);
    console.log(
      `  ${speed} m/s, ${dir > 0 ? 'D' : 'A'} at ${at}°: ${f1(rec.entrySpeed)} → ${f1(rec.exitSpeed)} m/s, height +${f1(rec.heightChange)} m, energy ×${f2(rec.energyRatio)}; track turned ${f1(turn)}°, bank ${f1(end.bankDeg)}° at the end, ${f1(after.bankDeg)}° after; ${f2(rec.duration)} s from the loop's entry`,
    );
    note(`immelmann.${speed}.height`, rec.heightChange);
    reversalRow(`Immelmann ${speed} (${at}°)`, rec, run, ev.find((e) => e.ended)?.clean);
    check(ev.length === 2 && ev[1].ended && ev[1].clean === true, `Immelmann at ${speed} m/s (key at ${at}°): announced, ends clean on the maneuver event`);
    check(upright && offReverse(turn) <= 15 && rec.heightChange > 20, `Immelmann at ${speed} m/s (key at ${at}°): upright on the reverse heading ±15° (${f1(offReverse(turn))}° off), higher (+${f1(rec.heightChange)} m)`);
    check(!rec.stalled && !contact, `Immelmann at ${speed} m/s (key at ${at}°): no stall or contact`);
  }
  {
    // A / D early in the loop (outside the window): the loop goes on.
    const press = pressOnce();
    let rollAt = -1;
    const run = await simulate({ height: 300, speed: 40 }, 9, (t, sim, input) => {
      press(t, 0.5, input, 'loop');
      if (rollAt < 0 && sim.maneuvers.kind === 'loop' && sim.maneuvers.describe().loopDeg >= 45) {
        rollAt = t;
      }
      input.cmd.roll = rollAt >= 0 && t < rollAt + 0.3 ? 1 : 0;
    });
    const loopEnd = run.records.filter((r) => r.trick === 'loop').pop();
    check(moveEvents(run, 'immelmann').length === 0 && !!loopEnd && loopEnd.time > 3, `D pressed early in the loop (45°): no Immelmann, the loop goes on (loop until ${loopEnd ? f1(loopEnd.time) : 'n/a'} s)`);
  }

  // Split-S: A / D ×2 in a steep dive.
  for (const [label, setup, script] of [
    ['40° dive, 36 m/s, D ×2', diveSetup(400, 36, -40), diveThenTap(-40, 0.5, 'rollRight')],
    ['60° dive, 40 m/s, A ×2', diveSetup(450, 40, -60), diveThenTap(-60, 0.5, 'rollLeft')],
    ['Shift dive (wings folded), 45° at 45 m/s, D ×2', diveSetup(450, 45, -45, true), diveThenTap(-45, 0.5, 'rollRight', 0, true)],
  ] as const) {
    const run = await simulate(setup, 9, script);
    const rec = lastMove(run, 'splits');
    const ev = moveEvents(run, 'splits');
    if (!rec) {
      check(false, `Split-S (${label}): runs (hints "${hints(run).join(' / ')}")`);
      continue;
    }
    const a = recordAt(run, rec.start);
    const end = recordAt(run, rec.start + rec.duration);
    const { rec: after, upright } = settled(run, rec.start + rec.duration);
    const turn = trackTurn(a, end);
    const minFoot = Math.min(...run.records.map((r) => r.footClearance));
    console.log(
      `  ${label}: ${f1(rec.entrySpeed)} → ${f1(rec.exitSpeed)} m/s, height ${f1(rec.heightChange)} m; track turned ${f1(turn)}°, path ${f1(Math.asin(Math.max(-1, Math.min(1, end.velocity[1] / Math.max(Math.hypot(...end.velocity), 1)))) * DEG)}° at the end, bank ${f1(after.bankDeg)}° after; ${f2(rec.duration)} s; lowest foot clearance ${f1(minFoot)} m; ${after.mode} after`,
    );
    reversalRow(`Split-S ${label.split(',')[0]}`, rec, run, ev.find((e) => e.ended)?.clean);
    check(ev.length === 2 && ev[1].ended && ev[1].clean === true, `Split-S (${label}): announced, ends clean on the maneuver event`);
    check(upright && offReverse(turn) <= 15 && rec.heightChange < 0 && rec.exitSpeed > rec.entrySpeed, `Split-S (${label}): upright on the reverse heading ±15° (${f1(offReverse(turn))}° off), lower (${f1(rec.heightChange)} m) and faster (+${f1(rec.exitSpeed - rec.entrySpeed)} m/s)`);
    check(!rec.stalled && !rec.contact && minFoot > 0 && after.mode !== 'diving', `Split-S (${label}): no stall or contact, the wings stay open after it (${after.mode})`);
  }
  {
    // The key held through the half roll: the spinning diving barrel roll instead.
    const run = await simulate(diveSetup(450, 38, -45), 5, diveThenTap(-45, 0.5, 'rollRight', 1.2));
    const tricks = run.records.map((r) => r.trick);
    const rolled = tricks.includes('splits') && tricks.lastIndexOf('roll') > tricks.indexOf('splits');
    const splitEvents = moveEvents(run, 'splits');
    check(rolled && splitEvents.length === 0 && moveEvents(run, 'roll').length > 0, `D ×2 in a dive with D held: the diving barrel roll spins on (roll after the half roll, no Split-S announced)`);
  }
  // Collisions: A / D ×2 in a shallow dive stays the barrel roll; S ×2 up to 45° of bank stays the loop.
  {
    const run = await simulate(diveSetup(400, 36, -20), 3, diveThenTap(-20, 0.5, 'rollRight'));
    const tricks = new Set(run.records.map((r) => r.trick));
    check(tricks.has('roll') && !tricks.has('splits'), `D ×2 in a 20° dive: barrel roll, no Split-S`);
  }
  {
    const press = pressOnce();
    const run = await simulate({ height: 300, speed: 40 }, 3, (t, _sim, input) => {
      input.bankDeg = t < 0.5 ? 35 : null;
      press(t, 0.5, input, 'loop');
    });
    const tricks = new Set(run.records.map((r) => r.trick));
    check(tricks.has('loop') && !tricks.has('wingover'), `S ×2 banked 35°: loop, no wingover`);
  }

  // Refusals near the ground / obstacles (hints in the existing style), never touching.
  const wallRight = (rt: PoseRuntime): void => {
    rt.sim.world.collision!.add({ kind: 'box', center: new THREE.Vector3(60, GROUND_Y + 150, -60), halfSize: new THREE.Vector3(3, 150, 150), yaw: 0 }, 'structure', 'test-wall');
  };
  const deck = (rt: PoseRuntime): void => {
    const y = rt.sim.body.position.y + 25;
    rt.sim.world.collision!.add({ kind: 'box', center: new THREE.Vector3(0, y + 2, -60), halfSize: new THREE.Vector3(200, 2, 200), yaw: 0 }, 'structure', 'test-deck');
  };
  for (const [label, setup, script, id, want] of [
    ['Split-S 120 m over the ground (40° dive, 36 m/s)', diveSetup(120, 36, -40), diveThenTap(-40, 0.5, 'rollRight'), 'splits', 'Split-S için yüksel'],
    ['wingover 18 m over the ground', { height: 18 + 2, speed: 32 }, bankedS(1, 1.2, 1.3), 'wingover', 'Kanat üstü dönüş için yüksel'],
    ['wingover toward a wall 60 m to the right', { height: 150, speed: 32, prep: wallRight }, bankedS(1, 1.2, 1.3), 'wingover', 'Kanat üstü dönüş için yer yok'],
    ['wingover under a deck 25 m overhead', { height: 150, speed: 32, prep: deck }, bankedS(1, 1.2, 1.3), 'wingover', 'Kanat üstü dönüş için yer yok'],
  ] as const) {
    const run = await simulate(setup as Setup, 4, script);
    const started = moveEvents(run, id).length > 0;
    const touched = run.records.some((r) => r.footClearance < 0) || run.rt.sim.impact.touched;
    const h = hints(run);
    check(!started && !touched && h.includes(want), `${label}: refused (hint "${h.join(' / ')}"), no contact`);
  }
  {
    // The wingover toward the open side of the same wall is allowed.
    const run = await simulate({ height: 150, speed: 32, prep: wallRight }, 3, bankedS(-1, 1.2, 1.3));
    check(moveEvents(run, 'wingover').length > 0, `wingover away from a wall 60 m to the right: allowed`);
  }
}

async function main(): Promise<void> {
  const t0 = Date.now();
  gestures();
  await collisions();
  await powerStroke();
  await dart();
  await sideSlip();
  await skim();
  await reversals();
  console.log('\nSummary');
  const head = ['move', 'entry m/s', 'exit m/s', 'Δv', 'Δh m', 'lateral', 'stamina', 'time s', 'clean', 'notes'];
  console.log(`| ${head.join(' | ')} |`);
  console.log(`|${head.map(() => '---').join('|')}|`);
  for (const r of table) {
    console.log(`| ${r.join(' | ')} |`);
  }
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
