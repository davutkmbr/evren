import { el } from '../dom';

export interface DivergingRow {
  label: string;
  /** Signed value: negative bars grow left of the zero line, positive ones right. */
  value: number;
  /** The value as shown beside the bar. */
  valueText: string;
  /** Hover card: a title and detail lines. */
  tip?: { title: string; lines: readonly string[] };
}

export interface DivergingBarsOptions {
  /** CSS colours of negative and positive bars. */
  negativeColor: string;
  positiveColor: string;
  /** Accessible name of the chart. */
  label?: string;
  /** Tallest the rows get together (px); rows shrink (to 16 px) past that. Default 352. */
  maxHeight?: number;
}

export interface DivergingBars {
  readonly root: HTMLElement;
  set(rows: readonly DivergingRow[]): void;
}

/** Share of each half kept free for the value label at the bar's end. */
export const DIVERGING_LABEL_ROOM = 0.3;

/**
 * Scale extent for a set of values (the magnitude a full-length bar stands for): the largest magnitude rounded up
 * to a whole number (to tenths below 1), never 0. Pure.
 */
export function divergingExtent(values: readonly number[]): number {
  let m = 0;
  for (const v of values) {
    if (Number.isFinite(v)) {
      m = Math.max(m, Math.abs(v));
    }
  }
  if (m <= 0) {
    return 1;
  }
  return m < 1 ? Math.ceil(m * 10 - 1e-9) / 10 : Math.ceil(m - 1e-9);
}

export type DivergingSide = 'negative' | 'positive' | 'zero';

/**
 * A bar's geometry as fractions of the plot width (zero line at 0.5): where it starts, how wide it is, and its side.
 * Each half keeps DIVERGING_LABEL_ROOM free for the label. Pure.
 */
export function divergingBar(value: number, extent: number, labelRoom = DIVERGING_LABEL_ROOM): { side: DivergingSide; start: number; width: number } {
  const usable = 0.5 * (1 - labelRoom);
  const len = extent > 0 && Number.isFinite(value) ? Math.min(usable, (Math.abs(value) / extent) * usable) : 0;
  if (len <= 0) {
    return { side: 'zero', start: 0.5, width: 0 };
  }
  return value < 0 ? { side: 'negative', start: 0.5 - len, width: len } : { side: 'positive', start: 0.5, width: len };
}

/** Row height (px) for `n` rows within `maxHeight`: 32 px, shrinking to 16 px for long lists. Pure. */
export function divergingRowHeight(n: number, maxHeight = 352): number {
  if (n <= 0) {
    return 32;
  }
  return Math.max(16, Math.min(32, Math.floor(maxHeight / n)));
}

const pct = (f: number): string => `${(f * 100).toFixed(2)}%`;

/**
 * A diverging bar chart: one row per item, a label column, bars left (negative) or right (positive) of a neutral
 * zero line, the value in ink text beside each bar, and a hover card per row (on the side away from the bar).
 */
export function divergingBars(opts: DivergingBarsOptions): DivergingBars {
  const body = el('div', 'ui-bars-body', [el('i', 'ui-bars-zero')]);
  const root = el('div', 'ui-bars', [body], { role: 'img', 'aria-label': opts.label });
  root.style.setProperty('--bars-neg', opts.negativeColor);
  root.style.setProperty('--bars-pos', opts.positiveColor);
  return {
    root,
    set: (rows) => {
      const extent = divergingExtent(rows.map((r) => r.value));
      root.style.setProperty('--bars-row', `${divergingRowHeight(rows.length, opts.maxHeight)}px`);
      const nodes = rows.map((r) => {
        const g = divergingBar(r.value, extent);
        const bar = el('i', `ui-bars-bar is-${g.side}`);
        bar.style.left = pct(g.start);
        bar.style.width = pct(g.width);
        const value = el('span', 'ui-bars-value ejd-num', r.valueText);
        if (g.side === 'negative') {
          value.style.right = `calc(${pct(1 - g.start)} + 6px)`;
        } else {
          value.style.left = `calc(${pct(g.start + g.width)} + 6px)`;
        }
        const tip = r.tip
          ? el('span', `ui-bars-tip ${g.side === 'negative' ? 'is-right' : 'is-left'}`, [
              el('span', 'ui-bars-tip-title', r.tip.title),
              ...r.tip.lines.map((l) => el('span', 'ui-bars-tip-line ejd-num', l)),
            ])
          : null;
        return el('div', 'ui-bars-row', [el('span', 'ui-bars-label', r.label), el('span', 'ui-bars-plot', [bar, value, tip])]);
      });
      body.replaceChildren(el('i', 'ui-bars-zero'), ...nodes);
    },
  };
}
