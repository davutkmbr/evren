/**
 * Course picker (Y): the built-in courses, the player's own courses and a "+ Yeni parkur" row, with length, best
 * time, best medal and medal targets. Arrow keys or the mouse choose, Enter or a click starts (or opens the editor on
 * the new-course row), Y / Esc close. On a custom course E edits, Delete / Backspace deletes (press twice), K copies
 * its share code; I opens the paste field for a code (Enter imports, Esc cancels).
 *
 * It pauses nothing; the activity system routes only the picker's keys to it (and only while it is open). The paste
 * field reports focus through onTyping so game input is disabled while typing. Rows are rebuilt on every open.
 */
import type { Medal, MedalTimes } from '../courses';
import { MEDAL_ORDER } from '../courses';
import { MEDAL_NAME, RACE_TEXT, formatCourseLength, formatRaceTime, formatTargetTime } from '../text';
import { h, show, toggle } from './dom';

export interface PickerEntry {
  id: string;
  name: string;
  description: string;
  lengthM: number;
  gates: number;
  best?: number;
  medal?: Medal | null;
  medals: MedalTimes;
  custom?: boolean;
}

export interface PickerHandlers {
  onStart: (id: string) => void;
  onClose: () => void;
  onMove: () => void;
  onNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string) => void;
  /** Returns an error text to show, or null when the code was imported (the caller reopens the list). */
  onImport: (code: string) => string | null;
  /** The paste field gained (true) or lost (false) keyboard focus. */
  onTyping: (typing: boolean) => void;
}

/** Id of the synthetic "new course" row. */
const NEW_ROW = '\u0000new';

export class CoursePicker {
  readonly root = h('div', 'race-picker ejd-glass ejd-interactive');
  private readonly list = h('div', 'race-picker-list');
  private readonly importRow = h('div', 'race-picker-import');
  private readonly importInput = h('input', 'race-picker-import-input');
  private readonly importMsg = h('div', 'race-picker-import-msg');
  private rows: HTMLElement[] = [];
  private entries: PickerEntry[] = [];
  private selected = 0;
  private opened = false;
  private armedDelete: string | null = null;

  constructor(
    parent: HTMLElement,
    private readonly handlers: PickerHandlers,
  ) {
    const t = RACE_TEXT.picker;
    this.root.setAttribute('role', 'dialog');
    this.importInput.type = 'text';
    this.importInput.spellcheck = false;
    this.importInput.autocomplete = 'off';
    this.importInput.placeholder = t.importPlaceholder;
    this.importInput.setAttribute('aria-label', t.importCode);
    this.importInput.addEventListener('focus', () => this.handlers.onTyping(true));
    this.importInput.addEventListener('blur', () => this.handlers.onTyping(false));
    this.importInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        const err = this.handlers.onImport(this.importInput.value);
        if (err) {
          this.importMsg.textContent = err;
        }
      } else if (e.code === 'Escape') {
        e.preventDefault();
        this.closeImport();
      }
    });
    this.importRow.append(this.importInput, this.importMsg);
    this.importRow.hidden = true;
    const action = (label: string, key: string, fn: () => void): HTMLElement => {
      const b = h('button', 'race-picker-action', [h('kbd', undefined, key), ` ${label}`]);
      b.type = 'button';
      b.tabIndex = -1;
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        fn();
      });
      return b;
    };
    this.root.append(
      h('div', 'race-picker-head', [h('div', 'race-picker-title', t.title), h('div', 'race-picker-sub ejd-caps', t.subtitle)]),
      this.list,
      this.importRow,
      h('div', 'race-picker-foot', [
        h('span', undefined, [h('kbd', undefined, '↑'), h('kbd', undefined, '↓'), ` ${t.choose}`]),
        h('span', undefined, [h('kbd', undefined, 'Enter'), ` ${t.start}`]),
        h('span', undefined, [h('kbd', undefined, 'Y'), h('kbd', undefined, 'Esc'), ` ${t.close}`]),
      ]),
      h('div', 'race-picker-foot race-picker-foot-custom', [action(t.importCode, 'I', () => this.openImport())]),
    );
    this.root.hidden = true;
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** Opens with these entries; `selectId` picks the row (default: the first). */
  open(entries: PickerEntry[], selectId?: string): void {
    this.entries = entries;
    this.armedDelete = null;
    const ids = [...entries.map((e) => e.id), NEW_ROW];
    const at = selectId ? ids.indexOf(selectId) : -1;
    this.selected = at >= 0 ? at : 0;
    this.rows = [...entries.map((e, i) => this.buildRow(e, i)), this.buildNewRow(entries.length)];
    this.list.replaceChildren(...this.rows);
    this.opened = true;
    show(this.root, true);
    this.highlight();
    this.rows[this.selected]?.scrollIntoView?.({ block: 'nearest' });
  }

  close(): void {
    if (!this.opened) {
      return;
    }
    this.closeImport();
    this.opened = false;
    show(this.root, false);
  }

  /** Shows a code in the paste field, selected, so the player can copy it by hand (clipboard unavailable). */
  showCode(code: string): void {
    this.openImport();
    this.importInput.value = code;
    this.importInput.select();
  }

  /** Keyboard while open. Returns true when the key was the picker's (the caller swallows it). */
  handleKey(code: string): boolean {
    if (!this.opened) {
      return false;
    }
    const e = this.entries[this.selected];
    switch (code) {
      case 'ArrowUp':
      case 'ArrowLeft':
        this.move(-1);
        return true;
      case 'ArrowDown':
      case 'ArrowRight':
        this.move(1);
        return true;
      case 'Enter':
      case 'NumpadEnter':
        this.choose(this.selected);
        return true;
      case 'Escape':
      case 'KeyY':
        this.handlers.onClose();
        return true;
      case 'KeyE':
        if (e?.custom) {
          this.handlers.onEdit(e.id);
        }
        return true;
      case 'KeyK':
        if (e?.custom) {
          this.handlers.onCopy(e.id);
        }
        return true;
      case 'KeyI':
        this.openImport();
        return true;
      case 'Delete':
      case 'Backspace':
        if (e?.custom) {
          this.requestDelete(e.id);
        }
        return true;
      default:
        return false;
    }
  }

  private requestDelete(id: string): void {
    if (this.armedDelete === id) {
      this.armedDelete = null;
      this.handlers.onDelete(id);
      return;
    }
    this.armedDelete = id;
    this.highlight();
  }

  private openImport(): void {
    this.importRow.hidden = false;
    this.importMsg.textContent = RACE_TEXT.picker.importHint;
    this.importInput.value = '';
    this.importInput.focus({ preventScroll: true });
  }

  private closeImport(): void {
    if (this.importRow.hidden) {
      return;
    }
    this.importInput.blur();
    this.importRow.hidden = true;
    this.importInput.value = '';
  }

  private move(step: number): void {
    const n = this.rows.length;
    if (n === 0) {
      return;
    }
    this.selected = (this.selected + step + n) % n;
    this.armedDelete = null;
    this.highlight();
    this.rows[this.selected]?.scrollIntoView?.({ block: 'nearest' });
    this.handlers.onMove();
  }

  private choose(i: number): void {
    if (i === this.entries.length) {
      this.handlers.onNew();
      return;
    }
    const e = this.entries[i];
    if (e) {
      this.handlers.onStart(e.id);
    }
  }

  private highlight(): void {
    this.rows.forEach((r, i) => {
      const on = i === this.selected;
      toggle(r, 'is-on', on);
      r.setAttribute('aria-selected', String(on));
      const e = this.entries[i];
      toggle(r, 'is-armed', !!e && e.id === this.armedDelete);
    });
  }

  private hover(row: HTMLElement, i: number): void {
    row.addEventListener('mouseenter', () => {
      if (this.selected !== i) {
        this.selected = i;
        this.armedDelete = null;
        this.highlight();
      }
    });
  }

  private buildNewRow(i: number): HTMLElement {
    const t = RACE_TEXT.picker;
    const row = h('button', 'race-picker-row race-picker-new', [h('span', 'race-picker-name', t.newCourse), h('span', 'race-picker-desc', t.newCourseDesc)]);
    row.type = 'button';
    row.tabIndex = -1;
    row.setAttribute('role', 'option');
    this.hover(row, i);
    row.addEventListener('mousedown', (ev) => ev.preventDefault());
    row.addEventListener('click', (ev) => {
      ev.preventDefault();
      this.choose(i);
    });
    return row;
  }

  private buildRow(e: PickerEntry, i: number): HTMLElement {
    const t = RACE_TEXT.picker;
    const best = e.best !== undefined
      ? h('span', 'race-picker-best ejd-num', [
          e.medal ? h('i', `race-medal-dot is-${e.medal}`) : null,
          `${t.best} ${formatRaceTime(e.best)}`,
          e.medal ? h('span', 'race-picker-medal', ` · ${MEDAL_NAME[e.medal]}`) : null,
        ])
      : h('span', 'race-picker-best is-empty', t.noBest);
    const targets = h(
      'span',
      'race-picker-targets ejd-num',
      MEDAL_ORDER.map((m) => h('span', `race-target is-${m}`, [h('i', 'race-medal-dot'), formatTargetTime(e.medals[m])])),
    );
    const actions = e.custom
      ? h('span', 'race-picker-row-actions', [
          this.rowAction(t.edit, 'E', () => this.handlers.onEdit(e.id)),
          this.rowAction(t.copyCode, 'K', () => this.handlers.onCopy(e.id)),
          h('span', 'race-picker-del', [
            this.rowAction(t.remove, 'Del', () => this.requestDelete(e.id)),
            h('span', 'race-picker-del-confirm', ` · ${t.removeConfirm}`),
          ]),
        ])
      : null;
    const row = h('button', `race-picker-row${e.custom ? ' is-custom' : ''}`, [
      h('span', 'race-picker-row-top', [h('span', 'race-picker-name', e.name), h('span', 'race-picker-len ejd-num', `${formatCourseLength(e.lengthM)} · ${t.gates(e.gates)}`)]),
      h('span', 'race-picker-desc', e.description),
      h('span', 'race-picker-row-bottom', [best, targets]),
      actions,
    ]);
    row.type = 'button';
    row.tabIndex = -1;
    row.setAttribute('role', 'option');
    this.hover(row, i);
    // No focus on click: a focused button would be "clicked" again by Space (flap) after the picker closes.
    row.addEventListener('mousedown', (ev) => ev.preventDefault());
    row.addEventListener('click', (ev) => {
      ev.preventDefault();
      this.choose(i);
    });
    return row;
  }

  private rowAction(label: string, key: string, fn: () => void): HTMLElement {
    const a = h('span', 'race-picker-row-action', [h('kbd', undefined, key), ` ${label}`]);
    a.setAttribute('role', 'button');
    a.addEventListener('mousedown', (ev) => ev.preventDefault());
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      fn();
    });
    return a;
  }

  dispose(): void {
    this.closeImport();
    this.root.remove();
  }
}
