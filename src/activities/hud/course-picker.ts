/**
 * Course picker (Y): a small list of the courses with length, best time, best medal and medal targets. Arrow keys or
 * the mouse choose, Enter or a click starts, Y / Esc close. It pauses nothing; the activity system routes only the
 * picker's keys to it (and only while it is open). Rows are rebuilt on every open (three courses, cheap).
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
}

export class CoursePicker {
  readonly root = h('div', 'race-picker ejd-glass ejd-interactive');
  private readonly list = h('div', 'race-picker-list');
  private rows: HTMLElement[] = [];
  private entries: PickerEntry[] = [];
  private selected = 0;
  private opened = false;

  constructor(
    parent: HTMLElement,
    private readonly handlers: { onStart: (id: string) => void; onClose: () => void; onMove: () => void },
  ) {
    const t = RACE_TEXT.picker;
    this.root.setAttribute('role', 'dialog');
    this.root.append(
      h('div', 'race-picker-head', [h('div', 'race-picker-title', t.title), h('div', 'race-picker-sub ejd-caps', t.subtitle)]),
      this.list,
      h('div', 'race-picker-foot', [
        h('span', undefined, [h('kbd', undefined, '↑'), h('kbd', undefined, '↓'), ` ${t.choose}`]),
        h('span', undefined, [h('kbd', undefined, 'Enter'), ` ${t.start}`]),
        h('span', undefined, [h('kbd', undefined, 'Y'), h('kbd', undefined, 'Esc'), ` ${t.close}`]),
      ]),
    );
    this.root.hidden = true;
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(entries: PickerEntry[], selected: number): void {
    this.entries = entries;
    this.selected = Math.max(0, Math.min(entries.length - 1, selected));
    this.rows = entries.map((e, i) => this.buildRow(e, i));
    this.list.replaceChildren(...this.rows);
    this.opened = true;
    show(this.root, true);
    this.highlight();
  }

  close(): void {
    if (!this.opened) {
      return;
    }
    this.opened = false;
    show(this.root, false);
  }

  /** Keyboard while open. Returns true when the key was the picker's (the caller swallows it). */
  handleKey(code: string): boolean {
    if (!this.opened) {
      return false;
    }
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
      default:
        return false;
    }
  }

  private move(step: number): void {
    const n = this.entries.length;
    if (n === 0) {
      return;
    }
    this.selected = (this.selected + step + n) % n;
    this.highlight();
    this.handlers.onMove();
  }

  private choose(i: number): void {
    const e = this.entries[i];
    if (e) {
      this.handlers.onStart(e.id);
    }
  }

  private highlight(): void {
    this.rows.forEach((r, i) => {
      toggle(r, 'is-on', i === this.selected);
      r.setAttribute('aria-selected', String(i === this.selected));
    });
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
    const row = h('button', 'race-picker-row', [
      h('span', 'race-picker-row-top', [h('span', 'race-picker-name', e.name), h('span', 'race-picker-len ejd-num', `${formatCourseLength(e.lengthM)} · ${t.gates(e.gates)}`)]),
      h('span', 'race-picker-desc', e.description),
      h('span', 'race-picker-row-bottom', [best, targets]),
    ]);
    row.type = 'button';
    row.tabIndex = -1;
    row.setAttribute('role', 'option');
    row.addEventListener('mouseenter', () => {
      if (this.selected !== i) {
        this.selected = i;
        this.highlight();
      }
    });
    // No focus on click: a focused button would be "clicked" again by Space (flap) after the picker closes.
    row.addEventListener('mousedown', (ev) => ev.preventDefault());
    row.addEventListener('click', (ev) => {
      ev.preventDefault();
      this.choose(i);
    });
    return row;
  }

  dispose(): void {
    this.root.remove();
  }
}
