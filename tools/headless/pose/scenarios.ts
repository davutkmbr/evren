/**
 * Scripted pose-strip scenarios: pilot commands and presses delivered through the same path as the game's input
 * (the flight system's frame command + edge latch), on flat open land GROUND_Y m high.
 */
import { DEG } from '../../../src/dragon/flight/params';
import type { FlightSim } from '../../../src/dragon/flight/sim';
import type { View } from './raster';
import type { FrameRecord, FrameScript, PoseRuntime } from './runtime';

export const GROUND_Y = 20;

export interface Scenario {
  name: string;
  description: string;
  /** Places the dragon (runtime freshly built for every scenario). */
  setup(rt: PoseRuntime): void;
  /** Simulated length (s). */
  seconds: number;
  /** Returns a fresh frame script (scripts may keep one-shot state). */
  script(): FrameScript;
  frames: number;
  fps: number;
  /** Start of the sampled window (s since the scenario start), chosen from the recorded run. */
  window(records: readonly FrameRecord[]): number;
  view: View;
  /** fixed: camera heading of the window's first frame; follow: the dragon's heading every frame. */
  camera: 'fixed' | 'follow';
  /** Metres across a frame (default 30; closer for the ground gaits). */
  span?: number;
  /** Open sea with the seabed this deep (m) instead of flat land (the surface at y = 0, flat calm). */
  sea?: number;
}

/** Time of the first record matching `pred`, or `fallback`. */
function firstTime(records: readonly FrameRecord[], pred: (r: FrameRecord) => boolean, fallback: number): number {
  const r = records.find(pred);
  return r ? r.time : fallback;
}

/** Script helper: presses `edge` once at `at` s, and holds whatever `hold` sets. */
function pressAt(at: number, edge: Parameters<Parameters<FrameScript>[2]['press']>[0], hold?: FrameScript): () => FrameScript {
  return () => {
    let done = false;
    return (t, sim, input) => {
      if (!done && t >= at) {
        done = true;
        input.press(edge);
      }
      hold?.(t, sim, input);
    };
  };
}

const neutral: () => FrameScript = () => () => undefined;

function stand(rt: PoseRuntime): void {
  rt.stand(0, 0, 0);
}

function fly(height: number, speed: number, prep?: (sim: FlightSim) => void): (rt: PoseRuntime) => void {
  return (rt) => {
    rt.teleport(0, GROUND_Y + height, 0, 0, speed);
    prep?.(rt.sim);
  };
}

/** Sea scenarios: a folded dive at `pathDeg` (Shift held) starting `height` m above the water. */
function plungeFrom(height: number, speed: number, pathDeg: number): (rt: PoseRuntime) => void {
  return (rt) => {
    rt.teleport(0, height, 0, 0, speed, pathDeg);
    const path = pathDeg * DEG;
    rt.sim.body.velocity.set(0, Math.sin(path) * speed, -Math.cos(path) * speed);
    rt.sim.spread = 0.08;
    rt.sim.sweep = 1;
  };
}

/** The dive path held with Shift until the entry, then `after` (seconds since the entry). */
function plungeScript(pathDeg: number, after: (under: number, sim: FlightSim, input: Parameters<FrameScript>[2]) => void): () => FrameScript {
  return () => {
    let entered = -1;
    return (t, sim, input) => {
      if (entered < 0 && sim.mode === 'underwater') {
        entered = t;
      }
      if (entered < 0) {
        input.cmd.dive = true;
        input.pathDeg = pathDeg;
        return;
      }
      after(t - entered, sim, input);
    };
  };
}

export const SCENARIOS: Scenario[] = [
  {
    name: 'idle',
    description: 'standing still, breathing',
    setup: stand,
    seconds: 6,
    script: neutral,
    frames: 12,
    fps: 4,
    window: () => 2.5,
    view: 'side',
    camera: 'fixed',
    span: 22,
  },
  {
    name: 'walk',
    description: 'W held from standing (walk, 3.5 m/s)',
    setup: stand,
    seconds: 7,
    script: () => (t, _sim, input) => {
      if (t >= 1) {
        input.cmd.pitch = 1;
      }
    },
    frames: 16,
    fps: 12,
    window: (r) => firstTime(r, (x) => x.time > 1 && x.groundSpeed > 3.3, 4) + 0.5,
    view: 'side',
    camera: 'fixed',
    span: 22,
  },
  {
    name: 'run',
    description: 'W + Shift held from standing (run, 9 m/s)',
    setup: stand,
    seconds: 8,
    script: () => (t, _sim, input) => {
      if (t >= 1) {
        input.cmd.pitch = 1;
        input.cmd.dive = true;
      }
    },
    frames: 16,
    fps: 15,
    window: (r) => firstTime(r, (x) => x.time > 1 && x.groundSpeed > 8.5, 5) + 0.3,
    view: 'side',
    camera: 'fixed',
    span: 22,
  },
  {
    name: 'takeoff',
    description: 'Space tapped while standing: crouch, leap, climb-out',
    setup: stand,
    seconds: 6,
    script: pressAt(1.5, 'flap'),
    frames: 20,
    fps: 8,
    window: () => 1.3,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'land',
    description: 'L pressed at 22 m/s, 30 m up: approach, flare, touchdown, standing',
    setup: fly(30, 22),
    seconds: 18,
    script: pressAt(0.3, 'land'),
    frames: 24,
    fps: 4,
    window: (r) => Math.max(0, firstTime(r, (x) => x.mode === 'grounded', 10) - 4.5),
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'fastland',
    description: 'L pressed at 34 m/s, 12 m over flat ground (current behaviour)',
    setup: fly(12, 34),
    seconds: 16,
    script: pressAt(0.2, 'land'),
    frames: 30,
    fps: 6,
    window: () => 0.1,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'glide',
    description: 'hands-off at 30 m/s with automatic cruise flapping off',
    setup: fly(200, 30, (sim) => {
      sim.options.autoFlap = false;
    }),
    seconds: 6,
    script: neutral,
    frames: 12,
    fps: 4,
    window: () => 2,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'flap',
    description: 'Space + S held: flapping climb',
    setup: fly(150, 24),
    seconds: 6,
    script: () => (_t, _sim, input) => {
      input.cmd.flap = true;
      input.cmd.pitch = -0.5;
    },
    frames: 18,
    fps: 12,
    window: () => 2.5,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'roll',
    description: 'D double tap at 34 m/s: barrel roll',
    setup: fly(300, 34),
    seconds: 5,
    script: pressAt(0.5, 'rollRight'),
    frames: 18,
    fps: 10,
    window: () => 0.4,
    view: 'front',
    camera: 'fixed',
  },
  {
    name: 'loop',
    description: 'S double tap at 40 m/s: loop',
    setup: fly(300, 40),
    seconds: 10,
    script: pressAt(0.5, 'loop'),
    frames: 24,
    fps: 4,
    window: () => 0.3,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'freefall',
    description: 'Shift double tap at 26 m/s, Shift held 2 s: wings folded, then the catch',
    setup: fly(500, 26),
    seconds: 8,
    script: pressAt(0.5, 'drop', (t, _sim, input) => {
      input.cmd.dive = t >= 0.5 && t < 2.5;
    }),
    frames: 24,
    fps: 5,
    window: () => 0.3,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'urge',
    description: 'V at 26 m/s: the rider\'s "dehh" and the surge',
    setup: fly(200, 26),
    seconds: 5,
    script: pressAt(0.5, 'urge'),
    frames: 16,
    fps: 8,
    window: () => 0.3,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'hover',
    description: 'brake held at 18 m/s, 60 m up: hover',
    setup: fly(60, 18),
    seconds: 9,
    script: () => (_t, _sim, input) => {
      input.cmd.brake = true;
    },
    frames: 16,
    fps: 8,
    window: (r) => firstTime(r, (x) => x.mode === 'hovering', 2) + 2,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'plunge',
    description: 'folded dive at -60°, 45 m/s, Shift held into deep water: the entry and the first metres',
    sea: 30,
    setup: plungeFrom(22, 45, -60),
    seconds: 5,
    script: plungeScript(-60, () => undefined),
    frames: 18,
    fps: 12,
    window: (r) => Math.max(0, firstTime(r, (x) => x.mode === 'underwater', 1) - 0.35),
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'underwater',
    description: 'under water after a plunge: S to level out, then Space held (strokes), A held at the end (turn)',
    sea: 30,
    setup: plungeFrom(22, 45, -60),
    seconds: 9,
    script: plungeScript(-60, (under, sim, input) => {
      input.cmd.pitch = sim.dive.pitch < -8 * DEG ? -1 : sim.dive.pitch > 0 ? 0.6 : 0;
      const depth = -sim.body.position.y;
      input.cmd.flap = under > 0.8 && depth > 3.5;
      input.cmd.roll = under > 4 ? -0.6 : 0;
    }),
    frames: 18,
    fps: 4,
    window: (r) => firstTime(r, (x) => x.mode === 'underwater', 1) + 0.5,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'breach',
    description: 'plunge at -50°, 60 m/s, then S held: the J-turn, the breach (wings snap open) and the climb-out',
    sea: 30,
    setup: plungeFrom(22, 60, -50),
    seconds: 7,
    script: plungeScript(-50, (under, sim, input) => {
      input.cmd.pitch = sim.mode === 'underwater' ? -1 : 0;
      void under;
    }),
    frames: 18,
    fps: 10,
    window: (r) => Math.max(0, firstTime(r, (x) => x.mode === 'takeoff' && x.time > 0.5, 2) - 0.8),
    view: 'side',
    camera: 'fixed',
    span: 40,
  },
  {
    name: 'turn',
    description: '60° bank held (assist override) at 32 m/s',
    setup: fly(250, 32),
    seconds: 7,
    script: () => (t, _sim, input) => {
      input.bankDeg = t >= 0.5 ? 60 : null;
    },
    frames: 12,
    fps: 4,
    window: () => 2.5,
    view: 'front',
    camera: 'follow',
  },
];

export function scenarioByName(name: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.name === name);
}
