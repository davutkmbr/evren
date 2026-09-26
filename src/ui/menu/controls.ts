/** Small form controls for the settings panel (segmented control, slider with readout, switch). */
import { el } from '../dom';

export interface Control<T> {
  readonly root: HTMLElement;
  set(value: T): void;
}

let uid = 0;
const nextId = (prefix: string): string => `${prefix}-${++uid}`;

export function segmented<T extends string | number>(
  label: string,
  options: ReadonlyArray<{ value: T; label: string }>,
  current: T,
  onChange: (value: T) => void,
): Control<T> {
  const buttons = options.map((option) => {
    const button = el('button', 'seg-btn', option.label, { type: 'button', role: 'radio', 'aria-checked': 'false' });
    button.addEventListener('click', () => {
      set(option.value);
      onChange(option.value);
    });
    return button;
  });
  const root = el('div', 'seg', buttons, { role: 'radiogroup', 'aria-label': label });
  root.style.setProperty('--seg-count', String(options.length));
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

export function slider(opts: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  onInput: (value: number) => void;
}): Control<number> {
  const input = el('input', 'rng', undefined, {
    type: 'range',
    min: opts.min,
    max: opts.max,
    step: opts.step,
    'aria-label': opts.label,
  });
  const readout = el('output', 'rng-val ejd-num');
  const root = el('div', 'rng-wrap', [input, readout]);
  const paint = (value: number): void => {
    const t = (value - opts.min) / (opts.max - opts.min);
    input.style.setProperty('--fill', `${(Math.min(1, Math.max(0, t)) * 100).toFixed(2)}%`);
    readout.textContent = opts.format(value);
    input.setAttribute('aria-valuetext', opts.format(value));
  };
  input.addEventListener('input', () => {
    const value = Number(input.value);
    paint(value);
    opts.onInput(value);
  });
  const set = (value: number): void => {
    input.value = String(value);
    paint(value);
  };
  set(opts.value);
  return { root, set };
}

export function toggle(label: string, value: boolean, onChange: (value: boolean) => void): Control<boolean> {
  const button = el('button', 'tgl', [el('i', 'tgl-knob')], { type: 'button', role: 'switch', 'aria-label': label });
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

/**
 * One setting: title, optional description, the control on the right. `keys` shows the keyboard shortcut as key caps
 * next to the title ("N", "[ / ]"); `sub` indents the row under the one above (a dependent option).
 */
export function settingRow(
  title: string,
  description: string | undefined,
  control: HTMLElement,
  opts: { keys?: string; sub?: boolean } = {},
): HTMLElement {
  const id = nextId('set');
  const keys = opts.keys
    ? el(
        'span',
        'set-keys',
        opts.keys.split('/').flatMap((k, i) => (i > 0 ? [el('span', 'kc-sep', '/'), el('kbd', undefined, k.trim())] : [el('kbd', undefined, k.trim())])),
        { 'aria-label': `Kısayol: ${opts.keys}` },
      )
    : null;
  const text = el('div', 'set-text', [
    el('span', 'set-title-line', [el('span', 'set-title', title, { id }), keys]),
    description ? el('span', 'set-desc', description) : null,
  ]);
  control.setAttribute('aria-labelledby', id);
  return el('div', opts.sub ? 'set-row set-row-sub' : 'set-row', [text, el('div', 'set-control', [control])]);
}

export function settingSection(title: string, rows: HTMLElement[], lede?: string): HTMLElement {
  return el('section', 'set-section', [
    el('h3', 'menu-heading', title),
    lede ? el('p', 'set-lede', lede) : null,
    el('div', 'set-rows', rows),
  ]);
}

/**
 * A collapsed group of rows under a "show more" button (advanced options). The rows stay in the DOM, hidden, so their
 * controls keep their live values.
 */
export function settingDisclosure(label: string, rows: HTMLElement[]): HTMLElement {
  const id = nextId('more');
  const body = el('div', 'set-more-body', rows, { id });
  body.hidden = true;
  const button = el('button', 'set-more', [el('span', undefined, label), el('i', 'set-more-chev')], {
    type: 'button',
    'aria-expanded': 'false',
    'aria-controls': id,
  });
  button.addEventListener('click', () => {
    body.hidden = !body.hidden;
    button.setAttribute('aria-expanded', String(!body.hidden));
  });
  return el('div', 'set-more-wrap', [button, body]);
}

/** Enables or greys out rows whose option depends on another switch. */
export function setRowsEnabled(rows: readonly HTMLElement[], enabled: boolean): void {
  for (const row of rows) {
    row.classList.toggle('is-disabled', !enabled);
    row.querySelectorAll('button, input').forEach((c) => ((c as HTMLButtonElement | HTMLInputElement).disabled = !enabled));
  }
}
