import { el } from '../dom';

export interface Stat {
  readonly root: HTMLElement;
  set(value: string): void;
}

/** A number with its name above it; tabular figures so columns of stats line up. `size` 'l' for headline values. */
export function stat(label: string, value: string, size: 'm' | 'l' = 'm'): Stat {
  const v = el('span', 'ui-stat-value ejd-num', value);
  return {
    root: el('div', `ui-stat ui-stat-${size}`, [el('span', 'ui-stat-label', label), v]),
    set: (text) => {
      v.textContent = text;
    },
  };
}
