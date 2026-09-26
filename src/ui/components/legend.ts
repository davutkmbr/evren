import { el } from '../dom';

/** Swatch shapes: a filled dot, an outlined ring, a small square (bars). */
export type LegendSwatch = 'dot' | 'ring' | 'square';

export interface LegendItem {
  label: string;
  /** CSS colour. */
  color: string;
  swatch?: LegendSwatch;
}

/** A row of colour keys for a chart or a map: swatch + label, in reading order. */
export function legend(items: readonly LegendItem[], className?: string): HTMLElement {
  return el(
    'span',
    `ui-legend${className ? ` ${className}` : ''}`,
    items.map((it) => {
      const sw = el('i', `ui-legend-swatch ui-legend-${it.swatch ?? 'dot'}`);
      sw.style.setProperty('--legend-color', it.color);
      return el('span', 'ui-legend-item', [sw, it.label]);
    }),
  );
}
