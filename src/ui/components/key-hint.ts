import { el } from '../dom';
import { keyCombo, type KeyCapTone } from './keycap';

export interface KeyHint {
  readonly root: HTMLElement;
  setLabel(label: string): void;
}

/**
 * A key and what it does, as plain text (not a button): key strips ("B  Buraya koy") and inline hints ("Y iptal").
 * `keys` accepts keyCombo syntax ("A / B", "Ctrl + W").
 */
export function keyHint(keys: string, label: string, tone: KeyCapTone = 'ink'): KeyHint {
  const text = el('span', 'ui-keyhint-label', label);
  return {
    root: el('span', 'ui-keyhint', [keyCombo(keys, tone), text]),
    setLabel: (l) => {
      text.textContent = l;
    },
  };
}
