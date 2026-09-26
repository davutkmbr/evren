import { CONTROL_HELP, type ControlGroup } from '../../core/input';
import { el } from '../dom';

/** Group order and titles; the hover block goes right after flight (it is how the brake key is used). */
const GROUPS: ReadonlyArray<{ id: ControlGroup; title: string }> = [
  { id: 'flight', title: 'Uçuş' },
  { id: 'tricks', title: 'Hız ve figürler' },
  { id: 'dragon', title: 'Ejderha ve binici' },
  { id: 'camera', title: 'Kamera, zaman ve hava' },
  { id: 'game', title: 'Oyun ve arayüz' },
];

const KEY_NAMES: Record<string, string> = {
  Space: 'Boşluk',
  Shift: 'Shift',
  Ctrl: 'Ctrl',
  Esc: 'Esc',
  Fare: 'Fare',
  'Sol tık': 'Sol tık',
};

/**
 * Hovering: brake to a stop and the dragon holds there until it is flown out. The flight list above keeps one line for
 * the brake; this group spells out the hover itself.
 */
const HOVER_HELP: Array<{ keys: string; action: string }> = [
  { keys: 'Ctrl / X', action: 'Yavaşla ve havada asılı kal' },
  { keys: 'Ctrl + W / S', action: 'Yavaşça ileri, geri' },
  { keys: 'A / D', action: 'Olduğun yerde dön' },
  { keys: 'Space / Shift', action: 'Yüksel / alçal' },
  { keys: 'W', action: 'Freni bırakıp uçuşa geç' },
  { keys: 'L', action: 'Olduğun yere kon' },
];

/** Key caps for "A / B" (alternatives) and "Ctrl + W" (held together). */
function keycaps(keys: string): HTMLElement {
  const nodes: Array<Node | string> = [];
  keys.split('+').forEach((combo, c) => {
    if (c > 0) {
      nodes.push(el('span', 'kc-sep', '+'));
    }
    combo
      .split('/')
      .map((k) => k.trim())
      .forEach((part, i) => {
        if (i > 0) {
          nodes.push(el('span', 'kc-sep', '/'));
        }
        nodes.push(el('kbd', undefined, KEY_NAMES[part] ?? part));
      });
  });
  return el('span', 'kc', nodes);
}

const row = (entry: { keys: string; action: string }): HTMLElement => el('li', 'ctl-row', [keycaps(entry.keys), el('span', 'ctl-action', entry.action)]);

/** Grouped key bindings (used by the pause menu and the H overlay). */
export function buildControlsList(): HTMLElement {
  const group = (title: string, rows: HTMLElement[]): HTMLElement | null =>
    rows.length ? el('section', 'ctl-group', [el('h3', 'ejd-caps ctl-heading', title), el('ul', 'ctl-list', rows)]) : null;
  const sections: Array<HTMLElement | null> = [];
  for (const g of GROUPS) {
    sections.push(group(g.title, CONTROL_HELP.filter((entry) => entry.group === g.id).map(row)));
    if (g.id === 'flight') {
      sections.push(group('Havada asılı kalma', HOVER_HELP.map(row)));
    }
  }
  return el('div', 'ctl-groups', sections);
}
