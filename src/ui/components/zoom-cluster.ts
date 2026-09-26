import '../styles/components.css';
import { el } from '../dom';
import { ICONS } from '../icons';
import { interactive } from './interaction';

export interface ZoomCluster {
  readonly root: HTMLElement;
}

export interface ZoomClusterOptions {
  onZoomIn(): void;
  onZoomOut(): void;
  /** Optional third button: back to the player's position ("Konumuma dön"). */
  onRecenter?: () => void;
}

/** Stacked square buttons for a zoomable view: +, − and (optionally) back to my position. */
export function zoomCluster(options: ZoomClusterOptions): ZoomCluster {
  const button = (icon: string, label: string, fn: () => void): HTMLButtonElement => {
    const b = interactive(el('button', 'ui-zoom-btn', undefined, { type: 'button', 'aria-label': label, title: label }), 'surface');
    b.innerHTML = icon;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  };
  const buttons = [button(ICONS.plus, 'Yakınlaştır', options.onZoomIn), button(ICONS.minus, 'Uzaklaştır', options.onZoomOut)];
  if (options.onRecenter) {
    buttons.push(button(ICONS.locate, 'Konumuma dön', options.onRecenter));
  }
  return { root: el('div', 'ui-zoom', buttons, { role: 'group', 'aria-label': 'Yakınlaştırma' }) };
}
