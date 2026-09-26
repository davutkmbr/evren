import { el } from '../dom';
import { bindKeyPress, interactive } from './interaction';
import { keyCap, type KeyCapTone } from './keycap';

export type PromptVariant = 'primary' | 'secondary' | 'danger';

const TONE: Record<PromptVariant, KeyCapTone> = { primary: 'gold', secondary: 'ink', danger: 'warn' };

export interface Prompt {
  readonly root: HTMLButtonElement;
  setLabel(label: string): void;
  /** Disables the prompt; `reason` (optional) says why, as a tooltip and for assistive tech. */
  setDisabled(disabled: boolean, reason?: string): void;
}

/**
 * An action prompt the way games show them: the key first, then the verb. No pill and no fill: the key cap carries
 * the emphasis (gold for the main action), the label stays text. Every action button in menus and overlays uses it.
 * An action without a key of its own (pointer only, e.g. "Oraya kon ve izle") passes `key` '' and shows the verb alone.
 * States come from the shared interaction system (cap family): hover lifts the key, pressing it (pointer, or the key
 * itself on the keyboard while the prompt is shown) sinks it.
 */
export function prompt(label: string, key: string, variant: PromptVariant = 'secondary', onPress?: () => void): Prompt {
  const text = el('span', 'ui-prompt-label', label);
  const root = interactive(
    el('button', key ? `ui-prompt ui-prompt-${variant}` : `ui-prompt ui-prompt-${variant} ui-prompt-keyless`, [key ? keyCap(key, TONE[variant]) : null, text], {
      type: 'button',
    }),
    'cap',
  );
  bindKeyPress(root, key);
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
    setDisabled: (d, reason) => {
      root.disabled = d;
      if (d && reason) {
        root.title = reason;
        root.setAttribute('aria-description', reason);
      } else {
        root.removeAttribute('title');
        root.removeAttribute('aria-description');
      }
    },
  };
}
