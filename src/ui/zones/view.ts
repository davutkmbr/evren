/**
 * DOM side of the HUD zones: fade bindings for owner-rendered nodes and the shared hint line (lowerCenter), which
 * renders whichever hint item the director shows as one row of key hints.
 */
import { keyHint } from '../components/key-hint';
import { el } from '../dom';
import type { HudDirector, HintItem } from './director';
import { hintKeys, onPadHints, padHints } from './key-device';
import './zones.css';

/** Zone classes: position a node in its band (zones.css). */
export const ZONE_CLASS = {
  topLine: 'hud-zone hud-zone-top-line',
  topReadout: 'hud-zone hud-zone-top-readout',
  title: 'hud-zone hud-zone-title',
  lowerCenter: 'hud-zone hud-zone-lower',
  corner: 'hud-zone hud-zone-corner',
  toast: 'hud-zone hud-zone-toast',
} as const;

/**
 * onShow / onHide callbacks that fade `node` in and out (.ejd-fade / .is-out); `onShow` runs before the fade in, so it
 * can fill in content. Spread into a HudZoneRequest.
 */
export function fadeBinding(node: HTMLElement, hooks: { onShow?: () => void; onHide?: () => void } = {}): { onShow: () => void; onHide: () => void } {
  node.classList.add('ejd-fade');
  if (!node.classList.contains('is-out')) {
    node.classList.add('is-out');
  }
  return {
    onShow: () => {
      hooks.onShow?.();
      node.classList.remove('is-out');
    },
    onHide: () => {
      node.classList.add('is-out');
      hooks.onHide?.();
    },
  };
}

/**
 * A row of key hints; `keys` in keyCombo syntax ("Ctrl + W / S"). An optional caption leads the row. The keys follow
 * the device (key-device.ts): the row refills itself when the player switches between the keyboard and a gamepad.
 */
export function hintRow(items: readonly HintItem[], caption = ''): HTMLElement {
  const row = el('ul', 'hint-row');
  fillHintRow(row, items, caption);
  // Static rows (hover, photo mode) live as long as the UI: the listener is never removed.
  onPadHints(() => fillHintRow(row, items, caption));
  return row;
}

function fillHintRow(row: HTMLElement, items: readonly HintItem[], caption: string): void {
  row.replaceChildren(
    ...(caption ? [el('li', 'hint-item hint-caption', caption)] : []),
    ...items.map(([keys, label]) => el('li', 'hint-item', [keyHint(hintKeys(keys), label).root])),
  );
}

/**
 * The one hint line of the HUD (lowerCenter, right above the bottom cluster). The start-of-game key hints and the
 * race's "[Y] iptal" are items of this line; they never share it unless an item is `joinable`.
 */
export class HintLineView {
  private readonly row = el('ul', 'hint-row');
  readonly root = el('div', `${ZONE_CLASS.lowerCenter} hud-hints hud-hintline ejd-fade is-out`, [this.row], { role: 'status', 'aria-live': 'polite' });
  private key = '';
  private readonly off: () => void;

  private readonly offPad: () => void;

  constructor(private readonly director: HudDirector) {
    this.off = director.onChange((zone) => {
      if (zone === 'lowerCenter') {
        this.render();
      }
    });
    this.offPad = onPadHints(() => this.render());
  }

  private render(): void {
    const line = this.director.hintLine();
    if (!line) {
      this.root.classList.add('is-out');
      return;
    }
    const key = `${padHints() ? 'pad' : 'kb'}\u0001${line.caption}\u0001${line.hints.map((h) => h.join('\u0002')).join('\u0003')}`;
    if (key !== this.key) {
      this.key = key;
      fillHintRow(this.row, line.hints, line.caption);
    }
    this.root.classList.remove('is-out');
  }

  dispose(): void {
    this.off();
    this.offPad();
  }
}
