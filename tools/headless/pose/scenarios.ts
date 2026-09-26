/**
 * Scripted pose-strip scenarios: pilot commands and presses delivered through the same path as the game's input
 * (the flight system's frame command + edge latch), on flat open land GROUND_Y m high.
 */
import type { FlightSim } from '../../../src/dragon/flight/sim';
import type { View } from './raster';
import type { FrameRecord, FrameScript, PoseRuntime, Terrain } from './runtime';

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
  /** Shaped ground (default: flat at GROUND_Y). */
  terrain?: Terrain;
  /** Mean wind (m/s at 100 m, world x / z); default still air. */
  wind?: readonly [number, number];
}

/** Time of the first record matching `pred`, or `fallback`. */
export function firstTime(records: readonly FrameRecord[], pred: (r: FrameRecord) => boolean, fallback: number): number {
  const r = records.find(pred);
  return r ? r.time : fallback;
}

/** Script helper: presses `edge` once at `at` s, and holds whatever `hold` sets. */
export function pressAt(at: number, edge: Parameters<Parameters<FrameScript>[2]['press']>[0], hold?: FrameScript): () => FrameScript {
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

export const neutral: () => FrameScript = () => () => undefined;

/** A cliff across the heading (flying / standing north = -z): the ground drops EDGE_DROP m at z = -edgeZ. */
export const EDGE_DROP = 18;
export function cliff(edgeZ: number): Terrain {
  return (_x, z) => (z < -edgeZ ? GROUND_Y - EDGE_DROP : GROUND_Y);
}

/** Time of the first grounded record after `after` s (or `fallback`). */
export function groundedAt(records: readonly FrameRecord[], after = 0, fallback = 3): number {
  return firstTime(records, (x) => x.time > after && x.mode === 'grounded', fallback);
}

/**
 * Script helper for the run-out scenarios: L at `land` s, then `then` gets the seconds since the touchdown (null
 * before it) to press or hold whatever it wants.
 */
export function landThen(land: number, then: (since: number | null, sim: FlightSim, input: Parameters<FrameScript>[2]) => void): () => FrameScript {
  return () => {
    let pressed = false;
    let touchdown: number | null = null;
    return (t, sim, input) => {
      if (!pressed && t >= land) {
        pressed = true;
        input.press('land');
      }
      if (touchdown === null && pressed && sim.mode === 'grounded') {
        touchdown = t;
      }
      then(touchdown === null ? null : t - touchdown, sim, input);
    };
  };
}

export function stand(rt: PoseRuntime): void {
  rt.stand(0, 0, 0);
}

export function fly(height: number, speed: number, prep?: (sim: FlightSim) => void): (rt: PoseRuntime) => void {
  return (rt) => {
    rt.teleport(0, GROUND_Y + height, 0, 0, speed);
    prep?.(rt.sim);
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
    name: 'trot',
    description: 'W at 60 % + Shift from standing (trot, ~5.4 m/s)',
    setup: stand,
    seconds: 7,
    script: () => (t, _sim, input) => {
      if (t >= 1) {
        input.cmd.pitch = 0.6;
        input.cmd.dive = true;
      }
    },
    frames: 16,
    fps: 15,
    window: (r) => firstTime(r, (x) => x.time > 1 && x.groundSpeed > 5.2, 4) + 0.5,
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
    description: 'L pressed at 34 m/s, 12 m over flat ground: floating approach, run-out',
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
    name: 'runout',
    description: 'L at 30 m/s, 8 m over flat ground: shallow approach, run-out, Ctrl held from 1.5 s after touchdown (skid to a stop)',
    setup: fly(8, 30),
    seconds: 12,
    script: landThen(0.2, (since, _sim, input) => {
      input.cmd.brake = since !== null && since >= 1.5;
    }),
    frames: 30,
    fps: 6,
    window: (r) => Math.max(0, groundedAt(r) - 1.5),
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'touchgo',
    description: 'L at 30 m/s, 8 m up: run-out, Space 0.8 s after touchdown (touch-and-go)',
    setup: fly(8, 30),
    seconds: 10,
    script: landThen(0.2, (since, _sim, input) => {
      if (since !== null && since >= 0.8 && since < 0.8 + 1 / 60) {
        input.press('flap');
      }
    }),
    frames: 24,
    fps: 8,
    window: (r) => Math.max(0, groundedAt(r) - 0.6),
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'runout-edge',
    description: 'L at 28 m/s, 8 m up, running out towards an 18 m drop: the dragon leaps on its own',
    setup: fly(8, 28),
    terrain: cliff(100),
    seconds: 10,
    script: landThen(0.2, () => undefined),
    frames: 24,
    fps: 8,
    window: (r) => Math.max(0, groundedAt(r) - 0.5),
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'leap',
    description: 'Space tapped while standing: crouch, push-off, first strokes, legs tucked',
    setup: stand,
    seconds: 5,
    script: pressAt(1, 'flap'),
    frames: 24,
    fps: 16,
    window: () => 0.95,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'leap-run',
    description: 'W + Shift held (run), Space at 4 s: the leap blends into the stride',
    setup: stand,
    seconds: 8,
    script: pressAt(4, 'flap', (t, _sim, input) => {
      input.cmd.pitch = t >= 1 ? 1 : 0;
      input.cmd.dive = t >= 1;
    }),
    frames: 24,
    fps: 16,
    window: () => 3.8,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'leap-drop',
    description: 'Space while standing 5 m from an 18 m drop: hop, wings snap open, dive away',
    setup: stand,
    terrain: cliff(5),
    seconds: 5,
    script: pressAt(1, 'flap'),
    frames: 24,
    fps: 12,
    window: () => 0.95,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'leap-tired',
    description: 'Space while standing, stamina exhausted: slower crouch and push, an extra stroke',
    setup: stand,
    seconds: 6,
    script: pressAt(1, 'flap', (t, sim) => {
      if (t < 1.02) {
        sim.stamina = 0.02;
        sim.tired = true;
      }
    }),
    frames: 24,
    fps: 12,
    window: () => 0.95,
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
