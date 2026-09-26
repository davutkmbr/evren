import { el } from '../dom';

export interface ListRowContent {
  label: string;
  /** Second line (quieter). */
  sub?: string;
  /** Trailing value (tabular), e.g. a time. */
  value?: string;
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
 * hovering calls `onHover`. Rows take no keyboard focus (the screen drives its list with its own keys).
 */
export function listRow(content: ListRowContent, onPick?: () => void, onHover?: () => void): ListRow {
  const label = el('span', 'ui-row-label');
  const sub = el('span', 'ui-row-sub');
  const value = el('span', 'ui-row-value ejd-num');
  const markerSlot = el('span', 'ui-row-marker');
  const root = el(
    'button',
    'ui-row',
    [el('i', 'ui-row-bar'), el('span', 'ui-row-text', [label, sub]), el('span', 'ui-row-end', [value, markerSlot])],
    { type: 'button', tabindex: -1, 'aria-pressed': 'false' },
  );
  // No focus on click: a focused button would be "clicked" again by Space (flap) later.
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
