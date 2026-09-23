import { CONTROL_HELP } from '../../core/input';
import { el } from '../dom';

const GROUPS: Array<{ title: string; match: RegExp }> = [
  { title: 'Uçuş', match: /^(W \/ S|A \/ D|Q \/ E|Space|Shift|Ctrl|F|R|L)\b/ },
  { title: 'Kamera ve zaman', match: /^(Fare|C|\[)/ },
  { title: 'Arayüz', match: /.*/ },
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
  const buckets = GROUPS.map(() => [] as HTMLElement[]);
  for (const entry of CONTROL_HELP) {
    const index = GROUPS.findIndex((g) => g.match.test(entry.keys));
    buckets[index].push(row(entry));
  }
  const group = (title: string, rows: HTMLElement[]): HTMLElement | null =>
    rows.length ? el('section', 'ctl-group', [el('h3', 'ejd-caps ctl-heading', title), el('ul', 'ctl-list', rows)]) : null;
  const sections = GROUPS.map((g, i) => group(g.title, buckets[i]));
  // After the camera keys: the two-column layout then balances (flight + camera | hover + interface).
  sections.splice(2, 0, group('Havada asılı kalma', HOVER_HELP.map(row)));
  return el('div', 'ctl-groups', sections);
}
