import '../styles/components.css';
import { el } from '../dom';
import type { Control } from './segmented';

export interface SliderOptions {
  /** Accessible name (the visible title usually comes from the setting row). */
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Readout text shown right of the track and read by assistive tech ("%60", "1,20×", "18:30"). */
  format: (value: number) => string;
  onInput: (value: number) => void;
}

/** A range slider with a gold fill up to the thumb and its value written out on the right (tabular). */
export function slider(opts: SliderOptions): Control<number> {
  const input = el('input', 'ui-slider-input', undefined, {
    type: 'range',
    min: opts.min,
    max: opts.max,
    step: opts.step,
    'aria-label': opts.label,
  });
  const readout = el('output', 'ui-slider-value ejd-num');
  const root = el('div', 'ui-slider', [input, readout]);
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
