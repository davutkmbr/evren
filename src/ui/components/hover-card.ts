import '../styles/components.css';
import { el } from '../dom';

export interface HoverCard {
  readonly root: HTMLElement;
  /** Title, one muted meta line and an optional gold action line ("Tıkla: ışınlan"). */
  set(title: string, meta: string, action?: string): void;
  /**
   * Places the card beside an anchor point (px, in the offset parent's space): to the right of it, flipped to the
   * left when it would leave the `width` × `height` area, and kept inside it vertically.
   */
  showAt(x: number, y: number, width: number, height: number): void;
  hide(): void;
}

const GAP_PX = 16;
const MARGIN_PX = 8;

/**
 * A small card next to something under the pointer (a map pin, a chart point): name, details and what a click does.
 * It never takes the pointer; the parent must be positioned.
 */
export function hoverCard(): HoverCard {
  const title = el('span', 'ui-hovercard-title');
  const meta = el('span', 'ui-hovercard-meta');
  const action = el('span', 'ui-hovercard-action');
  const root = el('div', 'ui-hovercard', [title, meta, action], { 'aria-hidden': 'true' });
  root.hidden = true;
  return {
    root,
    set(t, m, a) {
      title.textContent = t;
      meta.textContent = m;
      meta.hidden = !m;
      action.textContent = a ?? '';
      action.hidden = !a;
    },
    showAt(x, y, width, height) {
      root.hidden = false;
      const w = root.offsetWidth;
      const h = root.offsetHeight;
      let left = x + GAP_PX;
      if (left + w > width - MARGIN_PX) {
        left = x - GAP_PX - w;
      }
      left = Math.max(MARGIN_PX, left);
      const top = Math.min(height - h - MARGIN_PX, Math.max(MARGIN_PX, y - h / 2));
      root.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    },
    hide() {
      root.hidden = true;
    },
  };
}
