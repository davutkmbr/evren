import { el } from '../dom';
import { bindKeyPress, interactive } from './interaction';
import { keyCap } from './keycap';

export interface OptionSwitch {
  readonly root: HTMLButtonElement;
  set(on: boolean): void;
  setDisabled(disabled: boolean, reason?: string): void;
}

/**
 * An option that is on or off: its key, its name and its state written out ("açık" / "kapalı") with a dot in the
 * option's colour (`accent`, a CSS colour).
 */
export function optionSwitch(label: string, key: string, on: boolean, accent: string, onToggle?: (on: boolean) => void): OptionSwitch {
  const dot = el('i', 'ui-switch-dot');
  const stateText = el('span', 'ui-switch-state-text');
  const state = el('span', 'ui-switch-state', [dot, stateText]);
  const root = interactive(el('button', 'ui-switch', [keyCap(key, 'ink'), el('span', 'ui-switch-label', label), state], { type: 'button', role: 'switch' }), 'cap');
  bindKeyPress(root, key);
  root.style.setProperty('--accent-switch', accent);
  let value = on;
  let disabledReason = '';
  const paint = (): void => {
    root.setAttribute('aria-checked', String(value && !root.disabled));
    root.classList.toggle('is-on', value && !root.disabled);
    stateText.textContent = root.disabled ? disabledReason || 'yok' : value ? 'açık' : 'kapalı';
  };
  root.addEventListener('click', (e) => {
    e.stopPropagation();
    if (root.disabled) {
      return;
    }
    value = !value;
    paint();
    onToggle?.(value);
  });
  paint();
  return {
    root,
    set: (v) => {
      value = v;
      paint();
    },
    setDisabled: (d, reason) => {
      root.disabled = d;
      disabledReason = reason ?? '';
      if (d && reason) {
        root.title = reason;
      } else {
        root.removeAttribute('title');
      }
      paint();
    },
  };
}
