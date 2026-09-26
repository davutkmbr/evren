import '../styles/components.css';
import { el } from '../dom';

export interface ScaleBar {
  readonly root: HTMLElement;
  /** Picks the largest round distance that fits `maxPx` at `pxPerMeter` and sizes the bar to it. */
  set(pxPerMeter: number, maxPx?: number): void;
}

const STEPS_M = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

/** A map scale bar (round distance, "2 km" / "500 m") with an optional small attribution line under it. */
export function scaleBar(attribution?: string): ScaleBar {
  const bar = el('i', 'ui-scale-bar');
  const label = el('span', 'ui-scale-label ejd-num');
  const root = el('div', 'ui-scale', [
    el('div', 'ui-scale-row', [bar, label]),
    attribution ? el('span', 'ui-scale-attrib', attribution) : null,
  ]);
  return {
    root,
    set(pxPerMeter, maxPx = 120) {
      let meters = STEPS_M[0];
      for (const step of STEPS_M) {
        if (step * pxPerMeter <= maxPx) {
          meters = step;
        }
      }
      bar.style.width = `${Math.round(meters * pxPerMeter)}px`;
      label.textContent = meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
    },
  };
}
