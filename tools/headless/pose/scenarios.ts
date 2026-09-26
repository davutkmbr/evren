/**
 * Scripted pose-strip scenarios: pilot commands and presses delivered through the same path as the game's input
 * (the flight system's frame command + edge latch), on flat open land GROUND_Y m high.
 */
import { DEG } from '../../../src/dragon/flight/params';
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
  /** Open sea with the seabed this deep (m) instead of flat land (the surface at y = 0, flat calm). */
  sea?: number;
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

/** Sea scenarios: floating at rest at the origin, heading north. */
export function floatAt(rt: PoseRuntime): void {
  rt.teleport(0, 0, 0, 0, 0);
  rt.sim.placeOnGround();
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
    description: 'L pressed at 22 m/s, 30 m up: approach, flare, touchdown, standing (the seeded variant)',
    setup: fly(30, 22),
    seconds: 18,
    script: pressAt(0.3, 'land'),
    frames: 32,
    fps: 4,
    window: (r) => Math.max(0, firstTime(r, (x) => x.mode === 'grounded', 10) - 6.5),
    view: 'side',
    camera: 'fixed',
    span: 40,
  },
  {
    name: 'land-drop',
    description: 'L at 22 m/s, 45 m up, steep drop-in variant: a steep middle drop with a final turn, a big flare from higher up, backstrokes',
    setup: fly(45, 22, (sim) => {
      sim.controller.landingStyle.forceNext = 'drop';
    }),
    seconds: 18,
    script: pressAt(0.3, 'land'),
    frames: 36,
    fps: 4,
    window: (r) => Math.max(0, firstTime(r, (x) => x.mode === 'grounded', 10) - 7.5),
    view: 'side',
    camera: 'fixed',
    span: 44,
  },
  {
    name: 'land-shallow',
    description: 'L at 20 m/s, 28 m up, low shallow approach variant: weaving, a check, a lower flare',
    setup: fly(28, 20, (sim) => {
      sim.controller.landingStyle.forceNext = 'shallow';
    }),
    seconds: 18,
    script: pressAt(0.3, 'land'),
    frames: 32,
    fps: 4,
    window: (r) => Math.max(0, firstTime(r, (x) => x.mode === 'grounded', 10) - 7),
    view: 'side',
    camera: 'fixed',
    span: 44,
  },
  {
    name: 'land-tired',
    description: 'L at 20 m/s, 30 m up with 20 % stamina: the tired landing, sloppier beats and weave',
    setup: fly(30, 20, (sim) => {
      sim.stamina = 0.2;
    }),
    seconds: 18,
    script: pressAt(0.3, 'land'),
    frames: 32,
    fps: 4,
    window: (r) => Math.max(0, firstTime(r, (x) => x.mode === 'grounded', 10) - 7),
    view: 'side',
    camera: 'fixed',
    span: 44,
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
    name: 'runout-glide',
    description: 'L at 30 m/s, 8 m up, flat-glide run-out variant: a shallow flare, one backstroke, touchdown fast',
    setup: fly(8, 30, (sim) => {
      sim.controller.landingStyle.forceNext = 'glide';
    }),
    seconds: 10,
    script: pressAt(0.2, 'land'),
    frames: 30,
    fps: 8,
    window: (r) => Math.max(0, groundedAt(r) - 2.5),
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'runout-swoop',
    description: 'L at 30 m/s, 8 m up, swoop run-out variant: a steeper final path, a deeper flare with two backstrokes',
    setup: fly(8, 30, (sim) => {
      sim.controller.landingStyle.forceNext = 'swoop';
    }),
    seconds: 10,
    script: pressAt(0.2, 'land'),
    frames: 30,
    fps: 8,
    window: (r) => Math.max(0, groundedAt(r) - 2.5),
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
    terrain: cliff(125),
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
  ...(['front', 'side', 'belly'] as const).map(
    (variant): Scenario => ({
      name: `hardland-${variant}`,
      description: `Nose down into the ground at 26 m/s sinking 9 m/s, legs tucked: the hard landing (${variant} variant), get-up and head shake`,
      setup: (rt) => {
        rt.teleport(0, GROUND_Y + 2.3, 0, 0, 26, -19);
        rt.sim.body.velocity.set(0, -9, -26);
        rt.sim.legsOut = 0;
        rt.sim.spread = 0.4;
        rt.sim.hard.forceNext = variant;
      },
      seconds: 6,
      script: () => (_t, _sim, input) => {
        input.cmd.pitch = 1;
      },
      frames: 30,
      fps: 8,
      window: () => 0,
      view: 'side',
      camera: 'fixed',
      span: 34,
    }),
  ),
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
    name: 'swim-idle',
    description: 'floating at rest on a calm sea: breathing bob, lazy wing sculls, the tail drifting, the head looking around',
    sea: 30,
    setup: floatAt,
    seconds: 14,
    script: neutral,
    frames: 12,
    fps: 1.5,
    window: () => 5,
    view: 'side',
    camera: 'fixed',
    span: 24,
  },
  {
    name: 'swim',
    description: 'W held from floating (swim, 2.6 m/s): body and tail wave, alternating wing paddles, surge and kicks',
    sea: 30,
    setup: floatAt,
    seconds: 12,
    script: () => (t, _sim, input) => {
      input.cmd.pitch = t >= 1 ? 1 : 0;
    },
    frames: 16,
    fps: 6,
    window: (r) => firstTime(r, (x) => x.time > 1 && x.groundSpeed > 2.45, 7) + 1,
    view: 'side',
    camera: 'fixed',
    span: 24,
  },
  {
    name: 'swim-fast',
    description: 'W + Shift held from floating (fast swim, 4.5 m/s): full wing strokes, stronger wave, surge and kicks',
    sea: 30,
    setup: floatAt,
    seconds: 12,
    script: () => (t, _sim, input) => {
      input.cmd.pitch = t >= 1 ? 1 : 0;
      input.cmd.dive = t >= 1;
    },
    frames: 16,
    fps: 8,
    window: (r) => firstTime(r, (x) => x.time > 1 && x.groundSpeed > 4.3, 8) + 1,
    view: 'side',
    camera: 'fixed',
    span: 24,
  },
  {
    name: 'swim-turn',
    description: 'W held from floating, D held from 5 s (swimming right turn): the body curves into it, the outer (left) wing strokes harder',
    sea: 30,
    setup: floatAt,
    seconds: 12,
    script: () => (t, _sim, input) => {
      input.cmd.pitch = t >= 1 ? 1 : 0;
      input.cmd.roll = t >= 5 ? 1 : 0;
    },
    frames: 16,
    fps: 6,
    window: () => 7,
    view: 'top',
    camera: 'follow',
    span: 26,
  },
  {
    name: 'land-on-water',
    description: 'L at 16 m/s, 12 m over the sea: approach, settle onto the water and into the float (no walking step)',
    sea: 30,
    setup: (rt) => rt.teleport(0, 12, 0, 0, 16),
    seconds: 16,
    script: pressAt(0.3, 'land'),
    frames: 24,
    fps: 5,
    window: (r) => Math.max(0, firstTime(r, (x) => x.mode === 'swimming', 8) - 2),
    view: 'side',
    camera: 'fixed',
    span: 30,
  },
  {
    name: 'water-takeoff',
    description: 'Space tapped while floating: the take-off run (wings beating the water), the leap and the first strokes',
    sea: 30,
    setup: floatAt,
    seconds: 7,
    script: pressAt(2, 'flap'),
    frames: 24,
    fps: 10,
    window: () => 1.9,
    view: 'side',
    camera: 'fixed',
    span: 40,
  },
  {
    name: 'wade',
    description: 'W held swimming toward a shore: the feet reach the seabed and the dragon wades out walking',
    sea: 30,
    terrain: (_x, z) => Math.min(2, -5 - z * 0.12),
    setup: floatAt,
    seconds: 16,
    script: () => (t, _sim, input) => {
      input.cmd.pitch = t >= 1 ? 1 : 0;
    },
    frames: 24,
    fps: 4,
    window: (r) => Math.max(0, firstTime(r, (x) => x.time > 1 && x.mode === 'grounded', 8) - 2.5),
    view: 'side',
    camera: 'fixed',
    span: 30,
  },
  {
    name: 'power',
    description: 'Space double tap at 28 m/s (taps at 0.5 and 0.68 s): güç vuruşu, two deep full-amplitude downstrokes',
    setup: fly(200, 28),
    seconds: 3,
    script: () => {
      const first = pressAt(0.5, 'flap')();
      let second = false;
      return (t, sim, input) => {
        first(t, sim, input);
        if (!second && t >= 0.68) {
          second = true;
          input.press('flap');
          input.press('power');
        }
      };
    },
    frames: 18,
    fps: 15,
    window: () => 0.45,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'dart',
    description: 'Shift double tap at 36 m/s: dart, wings half folded and streamlined for ~1 s, then open on their own',
    setup: fly(200, 36),
    seconds: 3.5,
    script: pressAt(0.5, 'drop'),
    frames: 24,
    fps: 12,
    window: () => 0.35,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'slip',
    description: 'E double tap at 34 m/s: kayış, a sideways shift of ~1 body length with the heading kept (wing and tail flick)',
    setup: fly(150, 34),
    seconds: 3.5,
    script: pressAt(0.5, 'slipRight'),
    frames: 18,
    fps: 10,
    window: () => 0.4,
    view: 'front',
    camera: 'fixed',
    span: 44,
  },
  {
    name: 'skim',
    description: 'held 3 m over flat ground at 32 m/s (altitude hold): sıyırma, tail lowered, wingtips kissing the ground',
    setup: fly(5, 32),
    seconds: 6,
    script: () => (_t, sim, input) => {
      input.pathDeg = Math.max(-4, Math.min(4, (3 - sim.footClearance) * 2.5));
    },
    frames: 16,
    fps: 8,
    window: () => 3,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'skim-water',
    description: 'held 3 m over the sea at 32 m/s (altitude hold): sıyırma over water, the tail tip in the spray',
    sea: 30,
    setup: (rt) => rt.teleport(0, 5, 0, 0, 32),
    seconds: 6,
    script: () => (_t, sim, input) => {
      input.pathDeg = Math.max(-4, Math.min(4, (3 - sim.footClearance) * 2.5));
    },
    frames: 16,
    fps: 8,
    window: () => 3,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'wingover',
    description: 'D held to bank at 32 m/s, S double tap at 1.5 s: wingover (climb, pivot over the high wing, dive out reversed)',
    setup: fly(250, 32),
    seconds: 11,
    script: () => {
      let pressed = false;
      return (t, _sim, input) => {
        input.cmd.roll = t < 1.6 ? 1 : 0;
        if (!pressed && t >= 1.5) {
          pressed = true;
          input.press('loop');
        }
      };
    },
    frames: 24,
    fps: 3,
    window: (records) => firstTime(records, (r) => r.trick === 'wingover', 1.5) - 0.2,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'immelmann',
    description: 'S double tap at 40 m/s, D pressed at the top of the loop: Immelmann (half loop, half roll out upright)',
    setup: fly(300, 40),
    seconds: 7,
    script: () => {
      let pressed = false;
      let rollAt = -1;
      return (t, sim, input) => {
        if (!pressed && t >= 0.5) {
          pressed = true;
          input.press('loop');
        }
        if (rollAt < 0 && sim.maneuvers.kind === 'loop' && sim.maneuvers.describe().loopDeg > 150) {
          rollAt = t;
        }
        input.cmd.roll = rollAt >= 0 && t < rollAt + 0.3 ? 1 : 0;
      };
    },
    frames: 24,
    fps: 5,
    window: () => 0.5,
    view: 'side',
    camera: 'fixed',
  },
  {
    name: 'splits',
    description: 'D double tap in a 50° dive at 38 m/s: Split-S (half roll onto the back, pull through to level, reversed)',
    setup: (rt) => {
      rt.teleport(0, GROUND_Y + 400, 0, 0, 38, -50);
      const path = -50 * DEG;
      rt.sim.body.velocity.set(0, Math.sin(path) * 38, -Math.cos(path) * 38);
    },
    seconds: 7,
    script: () => {
      let pressed = false;
      return (t, _sim, input) => {
        if (t < 0.5) {
          input.pathDeg = -50;
        }
        if (!pressed && t >= 0.5) {
          pressed = true;
          input.press('rollRight');
        }
      };
    },
    frames: 24,
    fps: 5,
    window: () => 0.4,
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
