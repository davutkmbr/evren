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
