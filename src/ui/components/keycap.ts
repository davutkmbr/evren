import { el } from '../dom';

export type KeyCapTone = 'gold' | 'ink' | 'quiet' | 'warn';

/** Cap sizes: `s` inline in a sentence or a small slot, `m` the default, `l` a key of a keyboard drawing. */
export type KeyCapSize = 's' | 'm' | 'l';

/**
 * Highlight state for caps that light up (the keyboard drawing): `dim` an unused key, `lit` part of the current
 * group, `hot` the keys of the hovered row. A cap without a state looks as its tone says.
 */
export type KeyCapState = 'dim' | 'lit' | 'hot';

export interface KeyCapOptions {
  size?: KeyCapSize;
  state?: KeyCapState;
}

const STATES: readonly KeyCapState[] = ['dim', 'lit', 'hot'];

/** A physical key: a raised cap with a heavier bottom edge. Used wherever the game names a key. */
export function keyCap(label: string, tone: KeyCapTone = 'ink', options: KeyCapOptions = {}): HTMLElement {
  const size = options.size && options.size !== 'm' ? ` ui-keycap-${options.size}` : '';
  const cap = el('kbd', `ui-keycap ui-keycap-${tone}${size}`, label);
  if (options.state) {
    setKeyCapState(cap, options.state);
  }
  return cap;
}

/** Changes a cap's highlight state (null: back to its tone); only touches classes that change. */
export function setKeyCapState(cap: HTMLElement, state: KeyCapState | null): void {
  for (const s of STATES) {
    const on = s === state;
    if (cap.classList.contains(`is-${s}`) !== on) {
      cap.classList.toggle(`is-${s}`, on);
    }
  }
}

/** Key caps for "A / B" (alternatives), "Ctrl + W" (held together) and a trailing "×2" (double tap). */
export function keyCombo(keys: string, tone: KeyCapTone = 'ink', options: KeyCapOptions = {}): HTMLElement {
  const nodes: Array<Node | string> = [];
  // A trailing "×2" is a double tap: a separator mark after the caps, not part of the last cap ("Q / E ×2").
  const double = /\s*×2$/.exec(keys);
  const caps = double ? keys.slice(0, double.index) : keys;
  caps.split('+').forEach((combo, c) => {
    if (c > 0) {
      nodes.push(el('span', 'ui-keysep', '+'));
    }
    combo
      .split('/')
      .map((k) => k.trim())
      .forEach((part, i) => {
        if (i > 0) {
          nodes.push(el('span', 'ui-keysep', '/'));
        }
        nodes.push(keyCap(part, tone, options));
      });
  });
  if (double) {
    nodes.push(el('span', 'ui-keysep', '×2', { title: 'Çift dokun' }));
  }
  return el('span', options.size === 's' ? 'ui-keycombo ui-keycombo-s' : 'ui-keycombo', nodes);
}
