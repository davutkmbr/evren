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

function keycaps(keys: string): HTMLElement {
  const parts = keys.split('/').map((k) => k.trim());
  const nodes: Array<Node | string> = [];
  parts.forEach((part, i) => {
    if (i > 0) {
      nodes.push(el('span', 'kc-sep', '/'));
    }
    nodes.push(el('kbd', undefined, KEY_NAMES[part] ?? part));
  });
  return el('span', 'kc', nodes);
}

/** Grouped key bindings (used by the pause menu and the H overlay). */
export function buildControlsList(): HTMLElement {
  const buckets = GROUPS.map(() => [] as HTMLElement[]);
  for (const entry of CONTROL_HELP) {
    const index = GROUPS.findIndex((g) => g.match.test(entry.keys));
    buckets[index].push(el('li', 'ctl-row', [keycaps(entry.keys), el('span', 'ctl-action', entry.action)]));
  }
  return el(
    'div',
    'ctl-groups',
    GROUPS.map((group, i) => (buckets[i].length ? el('section', 'ctl-group', [el('h3', 'ejd-caps ctl-heading', group.title), el('ul', 'ctl-list', buckets[i])]) : null)),
  );
}
