/**
 * Key-level pilot for headless flight checks: scheduled key presses and releases turned into PilotCommands the way the
 * game's Input does it (keyboard axes smoothed at 10 /s, held buttons, first presses, double taps through the real
 * DoubleTapRecognizer of core/gestures.ts, edges latched into the first physics substep of a render frame), then
 * stepped through the real FlightSim. No DOM, no rig.
 */
import { DoubleTapRecognizer, DOUBLE_TAP_MS } from '../../../src/core/gestures';
import { PHYSICS_DT } from '../../../src/dragon/flight/params';
import type { FlightSim } from '../../../src/dragon/flight/sim';
import { clearPilotEdges, createPilotCommand, type PilotCommand } from '../../../src/dragon/flight/types';

export type Key = 'W' | 'S' | 'A' | 'D' | 'Q' | 'E' | 'Space' | 'Shift' | 'Ctrl' | 'L';

type Button = 'flap' | 'dive' | 'brake' | 'land' | 'pitchUp' | 'pitchDown' | 'rollLeft' | 'rollRight' | 'yawLeft' | 'yawRight';

const KEY_BUTTON: Record<Key, Button> = {
  W: 'pitchDown',
  S: 'pitchUp',
  A: 'rollLeft',
  D: 'rollRight',
  Q: 'yawLeft',
  E: 'yawRight',
  Space: 'flap',
  Shift: 'dive',
  Ctrl: 'brake',
  L: 'land',
};

interface KeyEvent {
  t: number;
  key: Key;
  down: boolean;
}

/** Render frame rate of the pilot (the game's frame; physics runs at PHYSICS_DT inside it). */
export const PILOT_FPS = 60;

export class KeyPilot {
  private events: KeyEvent[] = [];
  private cursor = 0;
  private readonly held = new Set<Key>();
  private readonly taps = new DoubleTapRecognizer<Button>(DOUBLE_TAP_MS);
  private readonly axes = { pitch: 0, roll: 0, yaw: 0 };
  private readonly pressed = new Set<Button>();
  private readonly doubled = new Set<Button>();
  readonly cmd: PilotCommand = createPilotCommand();

  /** Key down at t (s), up at t + hold. */
  tap(key: Key, t: number, hold = 0.06): this {
    this.events.push({ t, key, down: true }, { t: t + hold, key, down: false });
    this.sorted = false;
    return this;
  }

  /** Two taps `gap` s apart (inside the double-tap window when gap < 0.3). */
  double(key: Key, t: number, gap = 0.15, hold = 0.06): this {
    return this.tap(key, t, hold).tap(key, t + gap, hold);
  }

  /** Double tap whose second press is held until `until`. */
  doubleHold(key: Key, t: number, until: number, gap = 0.15): this {
    this.tap(key, t, 0.06);
    this.events.push({ t: t + gap, key, down: true }, { t: until, key, down: false });
    this.sorted = false;
    return this;
  }

  /** Key down / up at t (a pilot deciding frame by frame). */
  down(key: Key, t: number): this {
    this.events.push({ t, key, down: true });
    this.sorted = false;
    return this;
  }

  up(key: Key, t: number): this {
    this.events.push({ t, key, down: false });
    this.sorted = false;
    return this;
  }

  isHeld(key: Key): boolean {
    return this.held.has(key);
  }

  hold(key: Key, from: number, to: number): this {
    this.events.push({ t: from, key, down: true }, { t: to, key, down: false });
    this.sorted = false;
    return this;
  }

  private sorted = true;

  /** Builds this frame's command from the key events up to `t` (s). */
  frame(t: number, dt: number): PilotCommand {
    if (!this.sorted) {
      this.events.sort((a, b) => a.t - b.t || (a.down === b.down ? 0 : a.down ? 1 : -1));
      this.sorted = true;
    }
    this.pressed.clear();
    this.doubled.clear();
    while (this.cursor < this.events.length && this.events[this.cursor].t <= t) {
      const e = this.events[this.cursor++];
      if (e.down) {
        if (!this.held.has(e.key)) {
          const b = KEY_BUTTON[e.key];
          this.pressed.add(b);
          if (this.taps.press(b, e.t * 1000)) {
            this.doubled.add(b);
          }
        }
        this.held.add(e.key);
      } else {
        this.held.delete(e.key);
      }
    }
    const h = this.held;
    const target = {
      pitch: (h.has('W') ? 1 : 0) - (h.has('S') ? 1 : 0),
      roll: (h.has('D') ? 1 : 0) - (h.has('A') ? 1 : 0),
      yaw: (h.has('E') ? 1 : 0) - (h.has('Q') ? 1 : 0),
    };
    const rate = 1 - Math.exp(-10 * dt);
    for (const k of ['pitch', 'roll', 'yaw'] as const) {
      this.axes[k] += (target[k] - this.axes[k]) * rate;
      if (Math.abs(this.axes[k]) < 1e-3) {
        this.axes[k] = 0;
      }
    }
    const c = this.cmd;
    c.pitch = this.axes.pitch;
    c.roll = this.axes.roll;
    c.yaw = this.axes.yaw;
    c.flap = h.has('Space');
    c.dive = h.has('Shift');
    c.brake = h.has('Ctrl');
    c.fire = false;
    c.flapPressed = this.pressed.has('flap');
    c.landPressed = this.pressed.has('land');
    c.roarPressed = false;
    c.rollLeftPressed = this.doubled.has('rollLeft');
    c.rollRightPressed = this.doubled.has('rollRight');
    c.loopPressed = this.doubled.has('pitchUp');
    c.dropPressed = this.doubled.has('dive');
    c.powerPressed = this.doubled.has('flap');
    c.slipLeftPressed = this.doubled.has('yawLeft');
    c.slipRightPressed = this.doubled.has('yawRight');
    return c;
  }

  /** Drops the schedule after `t` (a fuzzer re-planning) and keeps the held keys. */
  clearAfter(t: number): void {
    this.events = this.events.filter((e, i) => i < this.cursor || e.t <= t);
  }

  get pending(): number {
    return this.events.length - this.cursor;
  }
}

/**
 * Runs the sim for `seconds` with the pilot: render frames at PILOT_FPS, physics substeps at PHYSICS_DT, the frame's
 * edges seen by its first substep only. `each` runs every substep after the physics.
 */
export function fly(sim: FlightSim, pilot: KeyPilot, seconds: number, start = 0, each?: (t: number) => boolean | void, beforeFrame?: (t: number) => void): number {
  const frameDt = 1 / PILOT_FPS;
  const sub = Math.round(frameDt / PHYSICS_DT);
  let t = start;
  const end = start + seconds;
  while (t < end - 1e-9) {
    beforeFrame?.(t);
    const cmd = pilot.frame(t, frameDt);
    for (let i = 0; i < sub; i++) {
      sim.step(PHYSICS_DT, cmd);
      if (i === 0) {
        clearPilotEdges(cmd);
      }
      if (each?.(t + (i + 1) * PHYSICS_DT) === true) {
        return t;
      }
    }
    t += frameDt;
  }
  return t;
}
