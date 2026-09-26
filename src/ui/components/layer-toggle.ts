import '../styles/components.css';
import { el } from '../dom';
import { interactive } from './interaction';

/** How the row's swatch is drawn: a filled dot, a hollow ring, or a dot with a soft halo. */
export type LayerMark = 'fill' | 'ring' | 'halo';

export interface LayerToggle {
  readonly root: HTMLButtonElement;
  readonly on: boolean;
  set(on: boolean): void;
  setCount(text: string): void;
}

export interface LayerToggleOptions {
  /** Swatch colour (any CSS colour); the swatch mirrors how the layer's markers look. */
  color: string;
  mark?: LayerMark;
  count?: string;
  on?: boolean;
  onToggle?: (on: boolean) => void;
}

/**
 * One layer of a map or chart legend that can be shown or hidden: swatch, name and a count on the right. The whole
 * row is the switch; a hidden layer dims its swatch. Group rows with `layerGroup`.
 */
export function layerToggle(label: string, options: LayerToggleOptions): LayerToggle {
  const count = el('span', 'ui-layer-count ejd-num', options.count ?? '');
  const root = interactive(
    el(
      'button',
      `ui-layer ui-layer-${options.mark ?? 'fill'}`,
      [el('i', 'ui-layer-swatch', undefined, { 'aria-hidden': 'true' }), el('span', 'ui-layer-label', label), count],
      { type: 'button', role: 'switch' },
    ),
    'surface',
  );
  root.style.setProperty('--layer-color', options.color);
  let value = options.on ?? true;
  const paint = (): void => {
    root.setAttribute('aria-checked', String(value));
    root.classList.toggle('is-on', value);
  };
  root.addEventListener('click', (e) => {
    e.stopPropagation();
    value = !value;
    paint();
    options.onToggle?.(value);
  });
  paint();
  return {
    root,
    get on() {
      return value;
    },
    set: (v) => {
      value = v;
      paint();
    },
    setCount: (text) => {
      count.textContent = text;
    },
  };
}

/** A small dark panel holding layer rows, labelled for assistive tech (`label` is not shown). */
export function layerGroup(label: string, toggles: readonly LayerToggle[]): HTMLElement {
  return el(
    'div',
    'ui-layer-group',
    toggles.map((t) => t.root),
    { role: 'group', 'aria-label': label },
  );
}
