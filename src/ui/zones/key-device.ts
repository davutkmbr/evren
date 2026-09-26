/**
 * Which device the key hints name: while the player flies with a gamepad (`Input.lastDevice`, set by the UI system
 * every frame), the hint rows show the pad's buttons (core/pad-keys.ts) and fall back to the keyboard keys where a key
 * has no pad binding.
 */
import { padKeys } from '../../core/pad-keys';

let pad = false;
const listeners = new Set<() => void>();

/** The UI system, every frame; listeners run only when the device changes. */
export function setPadHints(on: boolean): void {
  if (on === pad) {
    return;
  }
  pad = on;
  for (const l of listeners) {
    l();
  }
}

export function padHints(): boolean {
  return pad;
}

export function onPadHints(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The keys a hint shows now (keyCombo syntax). */
export function hintKeys(keys: string): string {
  return (pad && padKeys(keys)) || keys;
}
