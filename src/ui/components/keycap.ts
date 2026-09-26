import { el } from '../dom';

export type KeyCapTone = 'gold' | 'ink' | 'quiet' | 'warn';

/** A physical key: a raised cap with a heavier bottom edge. Used wherever the game names a key. */
export function keyCap(label: string, tone: KeyCapTone = 'ink'): HTMLElement {
  return el('kbd', `ui-keycap ui-keycap-${tone}`, label);
}

/** Key caps for "A / B" (alternatives) and "Ctrl + W" (held together). */
export function keyCombo(keys: string, tone: KeyCapTone = 'ink'): HTMLElement {
  const nodes: Array<Node | string> = [];
  keys.split('+').forEach((combo, c) => {
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
        nodes.push(keyCap(part, tone));
      });
  });
  return el('span', 'ui-keycombo', nodes);
}
