import { el } from '../dom';
import { interactive } from './interaction';

export interface ListRowContent {
  label: string;
  /** Second line (quieter). */
  sub?: string;
  /** Trailing value (tabular), e.g. a time. */
  value?: string;
}

export interface ListRowOptions {
  /**
   * Puts the row in the tab order: Enter / Space pick it like a click. Off by default, for screens that drive their
   * list with their own keys while flight keys stay live (a focused row would be "clicked" again by Space, the flap).
   */
  focusable?: boolean;
}

export interface ListRow {
  readonly root: HTMLButtonElement;
  set(content: ListRowContent): void;
  setSelected(selected: boolean): void;
  /** Replaces the trailing marker (e.g. a medalDot); null removes it. */
  setMarker(marker: HTMLElement | null): void;
}

/**
 * One entry of a selectable list: a name and a quieter second line on the left, a value and an optional marker on the
 * right. The selection is a gold bar on the left edge and a faint fill, not a boxed card. A click calls `onPick`,
 * hovering calls `onHover`. Rows take no keyboard focus unless `options.focusable` (the screen drives its list with its
 * own keys). States: the shared surface family (hover lift, pressed inset, inset focus ring).
 */
export function listRow(content: ListRowContent, onPick?: () => void, onHover?: () => void, options: ListRowOptions = {}): ListRow {
  const label = el('span', 'ui-row-label');
  const sub = el('span', 'ui-row-sub');
  const value = el('span', 'ui-row-value ejd-num');
  const markerSlot = el('span', 'ui-row-marker');
  const root = interactive(
    el(
      'button',
      'ui-row',
      [el('i', 'ui-row-bar'), el('span', 'ui-row-text', [label, sub]), el('span', 'ui-row-end', [value, markerSlot])],
      { type: 'button', tabindex: options.focusable ? 0 : -1, 'aria-pressed': 'false' },
    ),
    'surface',
  );
  // No focus on click: a focused button would be "clicked" again by Space (flap) later. A focusable row still takes
  // focus from Tab (and then answers Enter / Space as a native button).
  root.addEventListener('mousedown', (e) => e.preventDefault());
  if (onPick) {
    root.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onPick();
    });
  }
  if (onHover) {
    root.addEventListener('mouseenter', onHover);
  }
  const set = (c: ListRowContent): void => {
    label.textContent = c.label;
    sub.textContent = c.sub ?? '';
    sub.hidden = !c.sub;
    value.textContent = c.value ?? '';
    value.hidden = !c.value;
  };
  set(content);
  return {
    root,
    set,
    setSelected: (s) => {
      root.classList.toggle('is-selected', s);
      root.setAttribute('aria-pressed', String(s));
    },
    setMarker: (m) => {
      markerSlot.replaceChildren(...(m ? [m] : []));
    },
  };
}
