import '../styles/components.css';
import { el } from '../dom';
import { interactive } from './interaction';
import type { Control } from './segmented';

/**
 * An on/off switch for a setting row (a knob that slides, gold when on). For an option with its own key and a written
 * state ("açık" / "kapalı"), use `optionSwitch` instead.
 */
export function toggle(label: string, value: boolean, onChange: (value: boolean) => void): Control<boolean> {
  const button = interactive(el('button', 'ui-toggle', [el('i', 'ui-toggle-knob')], { type: 'button', role: 'switch', 'aria-label': label }), 'control');
  let state = value;
  const set = (v: boolean): void => {
    state = v;
    button.setAttribute('aria-checked', String(v));
    button.classList.toggle('is-on', v);
  };
  button.addEventListener('click', () => {
    set(!state);
    onChange(state);
  });
  set(value);
  return { root: button, set };
}
