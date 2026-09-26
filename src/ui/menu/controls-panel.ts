import { CONTROL_HELP, type ControlGroup } from '../../core/input';
import { el } from '../dom';

/** Group order and titles (the hover block right after flight: it is how the brake key is used). */
const GROUPS: ReadonlyArray<{ id: ControlGroup; title: string }> = [
  { id: 'flight', title: 'Uçuş' },
  { id: 'hover', title: 'Havada asılı kalma' },
  { id: 'tricks', title: 'Hız ve figürler' },
  { id: 'dragon', title: 'Ejderha ve binici' },
  { id: 'camera', title: 'Kamera ve dünya' },
  { id: 'game', title: 'Oyun ve arayüz' },
];

/** Key cap text for the names used in CONTROL_HELP. */
const KEY_NAMES: Record<string, string> = { Space: 'Boşluk' };

/**
 * The keyboard drawing: rows of [key id, width in key units, label]. Only the keys the game uses; the ids match
 * `keyId` below.
 */
const KEYBOARD: ReadonlyArray<{ indent: number; keys: ReadonlyArray<readonly [string, number?, string?]> }> = [
  { indent: 0, keys: [['Esc', 1.4], ['Q'], ['W'], ['E'], ['R'], ['T'], ['Y'], ['U'], ['I'], ['O'], ['P'], ['['], [']']] },
  { indent: 1.75, keys: [['A'], ['S'], ['D'], ['F'], ['G'], ['H'], ['J'], ['K'], ['L']] },
  { indent: 0, keys: [['Shift', 2.5], ['Z'], ['X'], ['C'], ['V'], ['B'], ['N'], ['M']] },
  { indent: 0, keys: [['Ctrl', 1.9], ['Space', 7.5, 'Boşluk']] },
];

type CapPart = { text: string; sep?: boolean; title?: string };

interface ParsedKeys {
  parts: CapPart[];
  /** Keyboard / mouse ids to light up (see KEYBOARD, plus LMB and RMB). */
  ids: string[];
}

/** Keyboard id of one key name: "Shift bırak" → Shift, "Sol tık" → LMB, "w" → W. */
function keyId(name: string): string {
  const lower = name.toLocaleLowerCase('tr-TR');
  if (lower.startsWith('sol tık')) {
    return 'LMB';
  }
  if (lower.startsWith('sağ tık')) {
    return 'RMB';
  }
  const first = name.split(/\s+/)[0];
  if (first === 'Boşluk') {
    return 'Space';
  }
  return first.length === 1 ? first.toLocaleUpperCase('en-US') : first;
}

/** "A / B" alternatives, "Ctrl + W" held together, a trailing "×2" double tap. */
function parseKeys(keys: string): ParsedKeys {
  const parts: CapPart[] = [];
  const ids: string[] = [];
  let text = keys.trim();
  const double = /\s*×2$/.exec(text);
  if (double) {
    text = text.slice(0, double.index);
  }
  text.split('+').forEach((combo, c) => {
    if (c > 0) {
      parts.push({ text: '+', sep: true });
    }
    combo
      .split('/')
      .map((k) => k.trim())
      .filter(Boolean)
      .forEach((name, i) => {
        if (i > 0) {
          parts.push({ text: '/', sep: true });
        }
        parts.push({ text: KEY_NAMES[name] ?? name });
        ids.push(keyId(name));
      });
  });
  if (double) {
    parts.push({ text: '×2', sep: true, title: 'Çift dokun' });
  }
  return { parts, ids };
}

function keycaps(parsed: ParsedKeys): HTMLElement {
  return el(
    'span',
    'kc',
    parsed.parts.map((p) => (p.sep ? el('span', 'kc-sep', p.text, { title: p.title }) : el('kbd', undefined, p.text))),
  );
}

type Entry = { keys: string; action: string; parsed: ParsedKeys };

const entriesOf = (group: ControlGroup): Entry[] =>
  CONTROL_HELP.filter((e) => e.group === group).map((e) => ({ keys: e.keys, action: e.action, parsed: parseKeys(e.keys) }));

const bindRow = (entry: Entry): HTMLElement =>
  el('div', 'ctl-row', [keycaps(entry.parsed), el('span', 'ctl-action', entry.action)]);

/**
 * Kontroller: the groups on the left, a keyboard (and mouse) drawing with the selected group's keys lit, and the
 * group's rows below; hovering a row lights its keys fully. `compact` (the H overlay) lists every group's rows
 * without the drawing: the overlay opens mid-flight, often with the pointer locked, so it must not need clicks.
 */
export class ControlsView {
  readonly root: HTMLElement;
  private readonly navButtons = new Map<ControlGroup, HTMLButtonElement>();
  private readonly keyNodes = new Map<string, HTMLElement[]>();
  private readonly title: HTMLElement | null = null;
  private readonly rows: HTMLElement | null = null;
  private group: ControlGroup = 'flight';
  private groupKeys = new Set<string>();

  constructor(opts: { compact?: boolean } = {}) {
    if (opts.compact) {
      this.root = el(
        'div',
        'ctl-compact',
        GROUPS.map((g) =>
          el('section', 'ctl-group', [el('h3', 'menu-heading', g.title), el('div', 'ctl-list', entriesOf(g.id).map(bindRow))]),
        ),
      );
      return;
    }

    const nav = el(
      'nav',
      'menu-cats',
      GROUPS.map((g) => {
        const button = el(
          'button',
          'menu-cat',
          [el('span', undefined, g.title), el('span', 'menu-cat-count ejd-num', String(entriesOf(g.id).length))],
          { type: 'button', 'aria-pressed': 'false' },
        );
        button.addEventListener('click', () => this.show(g.id));
        this.navButtons.set(g.id, button);
        return button;
      }),
      { 'aria-label': 'Kontrol grupları' },
    );
    nav.append(el('p', 'menu-cats-foot', ['Oyun sırasında ', el('kbd', undefined, 'H'), ' ile bu listeyi açabilirsin.']));

    const keyboard = el(
      'div',
      'ctl-kb',
      KEYBOARD.map((row) =>
        el(
          'div',
          'ctl-kb-row',
          row.keys.map(([id, width, label]) => {
            const key = el('span', 'ctl-key', label ?? id);
            if (width) {
              key.style.setProperty('--w', String(width));
            }
            this.addKeyNode(id, key);
            return key;
          }),
          { style: row.indent ? `--indent: ${row.indent}` : undefined },
        ),
      ),
      { 'aria-hidden': 'true' },
    );
    const mouseLeft = el('span', 'ctl-mouse-btn ctl-mouse-l');
    const mouseRight = el('span', 'ctl-mouse-btn ctl-mouse-r');
    this.addKeyNode('LMB', mouseLeft);
    this.addKeyNode('RMB', mouseRight);
    const mouse = el('div', 'ctl-mouse', [el('div', 'ctl-mouse-body', [mouseLeft, mouseRight]), el('span', 'ctl-mouse-label', 'Fare')], {
      'aria-hidden': 'true',
    });

    this.title = el('h2', 'menu-heading ctl-title');
    this.rows = el('div', 'ctl-binds');
    this.rows.addEventListener('pointerleave', () => this.light([]));

    this.root = el('div', 'menu-split menu-controls', [
      nav,
      el('div', 'menu-pane ctl-pane', [el('div', 'ctl-visual', [keyboard, mouse]), el('div', undefined, [this.title, this.rows])]),
    ]);
    this.show('flight');
  }

  /** ArrowUp / ArrowDown step through the groups. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.rows || (e.code !== 'ArrowUp' && e.code !== 'ArrowDown')) {
      return false;
    }
    const i = GROUPS.findIndex((g) => g.id === this.group);
    const next = GROUPS[Math.min(GROUPS.length - 1, Math.max(0, i + (e.code === 'ArrowDown' ? 1 : -1)))].id;
    this.show(next);
    if ((e.target as HTMLElement | null)?.classList.contains('menu-cat')) {
      this.navButtons.get(next)?.focus();
    }
    return true;
  }

  private addKeyNode(id: string, node: HTMLElement): void {
    const list = this.keyNodes.get(id);
    if (list) {
      list.push(node);
    } else {
      this.keyNodes.set(id, [node]);
    }
  }

  private show(group: ControlGroup): void {
    if (!this.title || !this.rows) {
      return;
    }
    this.group = group;
    for (const [id, button] of this.navButtons) {
      button.classList.toggle('is-on', id === group);
      button.setAttribute('aria-pressed', String(id === group));
    }
    const entries = entriesOf(group);
    this.title.textContent = GROUPS.find((g) => g.id === group)?.title ?? '';
    this.groupKeys = new Set(entries.flatMap((e) => e.parsed.ids));
    this.rows.replaceChildren(
      ...entries.map((entry) => {
        const row = bindRow(entry);
        row.addEventListener('pointerenter', () => {
          this.light(entry.parsed.ids);
          row.classList.add('is-hot');
        });
        row.addEventListener('pointerleave', () => row.classList.remove('is-hot'));
        return row;
      }),
    );
    this.light([]);
  }

  /** Group keys soft-lit, `hot` keys (the hovered row) fully lit. */
  private light(hot: readonly string[]): void {
    const strong = new Set(hot);
    for (const [id, nodes] of this.keyNodes) {
      for (const node of nodes) {
        node.classList.toggle('is-on', this.groupKeys.has(id) && !strong.has(id));
        node.classList.toggle('is-hot', strong.has(id));
      }
    }
  }
}
