import '../styles/components.css';
import { el } from '../dom';

/** A form control that holds a value: `root` goes into the page, `set` shows a value changed elsewhere. */
export interface Control<T> {
  readonly root: HTMLElement;
  set(value: T): void;
}

/**
 * A segmented control: one of a few options (quality, weather, camera), laid out as equal segments. It is a radio
 * group: ArrowLeft / ArrowRight move the choice, only the chosen segment is in the tab order.
 */
export function segmented<T extends string | number>(
  label: string,
  options: ReadonlyArray<{ value: T; label: string }>,
  current: T,
  onChange: (value: T) => void,
): Control<T> {
  const buttons = options.map((option) => {
    const button = el('button', 'ui-seg-btn', option.label, { type: 'button', role: 'radio', 'aria-checked': 'false' });
    button.addEventListener('click', () => {
      set(option.value);
      onChange(option.value);
    });
    return button;
  });
  const root = el('div', 'ui-seg', buttons, { role: 'radiogroup', 'aria-label': label });
  const set = (value: T): void => {
    options.forEach((option, i) => {
      const on = option.value === value;
      buttons[i].classList.toggle('is-on', on);
      buttons[i].setAttribute('aria-checked', String(on));
      buttons[i].tabIndex = on ? 0 : -1;
    });
  };
  root.addEventListener('keydown', (e) => {
    if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const index = buttons.findIndex((b) => b.classList.contains('is-on'));
    const next = Math.min(options.length - 1, Math.max(0, index + (e.code === 'ArrowRight' ? 1 : -1)));
    if (next !== index) {
      set(options[next].value);
      onChange(options[next].value);
      buttons[next].focus();
    }
  });
  set(current);
  return { root, set };
}
