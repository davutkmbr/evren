/**
 * Which device the key hints name: while the player flies with a gamepad (`Input.lastDevice`, set by the UI system
 * every frame), the hint rows show the pad's buttons (core/pad-keys.ts) and fall back to the keyboard keys where a key
 * has no pad binding.
 */
import { padKeys, type PadLayout } from '../../core/pad-keys';

let pad = false;
let layout: PadLayout = 'xbox';
const listeners = new Set<() => void>();

/** The UI system, every frame; listeners run only when the device or the pad's layout changes. */
export function setPadHints(on: boolean, padLayout: PadLayout = layout): void {
  if (on === pad && padLayout === layout) {
    return;
  }
  pad = on;
  layout = padLayout;
  for (const l of listeners) {
    l();
  }
}

export function padHints(): boolean {
  return pad;
}

/** The button names of the last pad used (Xbox until a PlayStation pad shows up). */
export function padLayout(): PadLayout {
  return layout;
}

export function onPadHints(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The keys a hint shows now (keyCombo syntax). */
export function hintKeys(keys: string): string {
  return (pad && padKeys(keys, layout)) || keys;
}
