import { el } from '../dom';
import { keyCap, type KeyCapTone } from './keycap';

export type PromptVariant = 'primary' | 'secondary' | 'danger';

const TONE: Record<PromptVariant, KeyCapTone> = { primary: 'gold', secondary: 'ink', danger: 'warn' };

export interface Prompt {
  readonly root: HTMLButtonElement;
  setLabel(label: string): void;
  setDisabled(disabled: boolean): void;
}

/**
 * An action prompt the way games show them: the key first, then the verb. No pill and no fill: the key cap carries
 * the emphasis (gold for the main action), the label stays text. Every action button in menus and overlays uses it.
 * An action without a key of its own (pointer only, e.g. "Oraya kon ve izle") passes `key` '' and shows the verb alone.
 */
export function prompt(label: string, key: string, variant: PromptVariant = 'secondary', onPress?: () => void): Prompt {
  const text = el('span', 'ui-prompt-label', label);
  const root = el('button', key ? `ui-prompt ui-prompt-${variant}` : `ui-prompt ui-prompt-${variant} ui-prompt-keyless`, [key ? keyCap(key, TONE[variant]) : null, text], {
    type: 'button',
  });
  if (onPress) {
    root.addEventListener('click', (e) => {
      e.stopPropagation();
      onPress();
    });
  }
  return {
    root,
    setLabel: (l) => {
      text.textContent = l;
    },
    setDisabled: (d) => {
      root.disabled = d;
    },
  };
}
