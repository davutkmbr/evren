/**
 * Key gestures, kept free of the DOM so they can be unit-tested (tools/headless/air-moves-check.ts).
 *
 * Double taps: two presses of the same button within DOUBLE_TAP_MS count as a double tap. The second press of a pair
 * consumes the first, so a third quick press starts a new pair (tap-tap-tap = one double tap, not two). Key repeat is
 * not a press (the caller filters it). Every double-tap gesture uses this one window:
 *
 *   A / D ×2  barrel roll        S ×2      loop
 *   Space ×2  power stroke       Shift ×2  dart when fast, free fall when slow
 *   Q / E ×2  side-slip
 *
 * Collisions with the held meaning of the same keys are resolved in the flight model, not here: the first tap of a
 * pair always acts as a plain press (one Space beat, a short Shift fold, a short rudder blip), and the move the second
 * tap starts takes over from it. Holding the key after the second tap keeps its held meaning once the move has ended
 * (Space keeps flapping, Shift keeps the wings folded, Q / E keep the rudder).
 *
 * Stage C reversals share keys with the loop and the barrel roll; the flight state picks the move (the pure resolvers
 * below, unit-tested in tools/headless/air-moves-check.ts, thresholds from the flight params):
 *
 *   S ×2       banked more than the wingover bank: wingover; up to it: the loop (unchanged)
 *   A / D ×2   in a dive steeper than the Split-S path: Split-S; shallower (and level): the barrel roll (unchanged)
 *   A / D      pressed (the held key, not a double tap) during the top of a loop: Immelmann; a double tap there counts
 *              as a press too. Elsewhere in the loop A / D do nothing, as before.
 *
 * A Split-S whose key is still held when its half roll ends keeps spinning as the diving barrel roll, so the spinning
 * dive of the held roll stays available.
 */

/** Two presses of the same button within this window count as a double tap (ms). */
export const DOUBLE_TAP_MS = 300;

/** Double-tap recogniser over any set of button names. Times in ms (performance.now() in the game). */
export class DoubleTapRecognizer<K extends string = string> {
  private readonly lastPress = new Map<K, number>();

  constructor(readonly windowMs: number = DOUBLE_TAP_MS) {}

  /** Registers a fresh press (not a key repeat) of `key` at `timeMs`; true when it completes a double tap. */
  press(key: K, timeMs: number): boolean {
    const last = this.lastPress.get(key);
    if (last !== undefined && timeMs - last < this.windowMs && timeMs >= last) {
      this.lastPress.delete(key);
      return true;
    }
    this.lastPress.set(key, timeMs);
    return false;
  }

  /** Forgets pending first taps (all keys, or one). */
  reset(key?: K): void {
    if (key === undefined) {
      this.lastPress.clear();
    } else {
      this.lastPress.delete(key);
    }
  }
}

/** What an S double tap starts: the wingover while banked more than `wingoverBank` (rad), otherwise the loop. */
export function resolvePitchUpDoubleTap(bank: number, wingoverBank: number): 'loop' | 'wingover' {
  return Math.abs(bank) > wingoverBank ? 'wingover' : 'loop';
}

/** What an A / D double tap starts: the Split-S in a dive steeper than `splitPath` (rad, negative), otherwise the roll. */
export function resolveRollDoubleTap(path: number, splitPath: number): 'roll' | 'splits' {
  return path < splitPath ? 'splits' : 'roll';
}

/** An A / D press during a loop starts the Immelmann while the loop angle (rad, from the entry path) is in the window. */
export function inImmelmannWindow(loopAngle: number, start: number, end: number): boolean {
  return loopAngle >= start && loopAngle <= end;
}

/**
 * Fresh presses on an analog axis (the smoothed keyboard axis or a stick): a press is the axis passing `press` in
 * either direction after it was back below `release` (hysteresis, so a held key or a wobbling stick is one press).
 */
export class AxisPress {
  private armed = true;

  constructor(
    readonly press = 0.5,
    readonly release = 0.2,
  ) {}

  /** Feeds the axis value; returns +1 / -1 on a fresh press to that side, otherwise 0. */
  update(value: number): number {
    const a = Math.abs(value);
    if (a < this.release) {
      this.armed = true;
      return 0;
    }
    if (this.armed && a >= this.press) {
      this.armed = false;
      return value > 0 ? 1 : -1;
    }
    return 0;
  }

  /** Treats the axis as held: the next press needs a release first. */
  disarm(): void {
    this.armed = false;
  }
}
