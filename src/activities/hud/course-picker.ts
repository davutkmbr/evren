/**
 * Course picker (Y), race UI v2: a sheet like the pause menu. Header "Halka yarışları" with the course and medal
 * counts and Kapat [Y]; on the left the course list (selection = gold bar), Yeni parkur [N] and the share code field
 * [I]; on the right the selected course: name and description, Düzenle [E] / Kodu kopyala [K] / Sil [Del] on custom
 * courses, the route on a mini map, four stats, the medal ladder, and Yarışa başla [Enter] with the Hayalet [H] switch.
 *
 * Arrow keys or a click choose, Enter or a double click starts, Y / Esc close. Delete needs a second press. It pauses
 * nothing; the activity system routes only the picker's keys to it (capture listener, only while it is open), which is
 * how N (weather) and H (help) are borrowed here. The code field reports focus through onTyping so game input is off
 * while typing. Rows are rebuilt on every open.
 */
import {
  listRow,
  medalDot,
  medalLadder,
  optionSwitch,
  prompt,
  routeMap,
  stat,
  textField,
  type ListRow,
  type Prompt,
  type RoutePoint,
  type WaterSampler,
} from '../../ui/components';
import type { Medal, MedalTimes } from '../courses';
import { RACE_TEXT, formatCourseLength, formatRaceTime, formatTargetTime } from '../text';
import { h, noFocus, show } from './dom';

export interface PickerEntry {
  id: string;
  name: string;
  description: string;
  lengthM: number;
  gates: number;
  rings: number;
  best?: number;
  medal?: Medal | null;
  medals: MedalTimes;
  runs: number;
  custom?: boolean;
  /** A ghost of the best run exists. */
  hasGhost: boolean;
  /** Map-plane route (world x, z): the gates in order and the speed rings. */
  route: { gates: RoutePoint[]; rings: RoutePoint[] };
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
  /** The code field gained (true) or lost (false) keyboard focus. */
  onTyping: (typing: boolean) => void;
  /** The ghost switch changed (remembered per player by the caller). */
  onGhost: (on: boolean) => void;
}

/** Smallest map span (m), so a short course is not blown up. */
const MAP_MIN_SPAN = 2400;

/** Ladder labels: whole seconds as targets ("4:08"), a best time with hundredths. */
function ladderTime(s: number): string {
  return Number.isInteger(s) ? formatTargetTime(s) : formatRaceTime(s);
}

export class CoursePicker {
  readonly root = h('div', 'race-picker');
  private readonly sheet = h('section', 'race-sheet ejd-interactive');
  private readonly counts = h('span', 'race-sheet-counts');
  private readonly list = h('div', 'race-list-rows');
  private readonly field = textField(RACE_TEXT.picker.importCode, { key: 'I', placeholder: RACE_TEXT.picker.importPlaceholder });
  private readonly name = h('span', 'race-detail-name');
  private readonly desc = h('span', 'race-detail-desc');
  private readonly customActions = h('div', 'race-detail-actions');
  private readonly removePrompt: Prompt;
  private readonly map = routeMap({
    legend: [
      { label: RACE_TEXT.picker.legendGate, color: '#e8b872' },
      { label: RACE_TEXT.picker.legendRing, color: '#7fd1c0', swatch: 'ring' },
      { label: RACE_TEXT.picker.legendStart, color: '#f3eee5' },
    ],
    minSpan: MAP_MIN_SPAN,
  });
  private readonly lengthStat = stat(RACE_TEXT.picker.length, '');
  private readonly gatesStat = stat(RACE_TEXT.picker.gatesRings, '');
  private readonly bestStat = stat(RACE_TEXT.picker.best, '');
  private readonly runsStat = stat(RACE_TEXT.picker.runs, '');
  private readonly ladder = medalLadder(ladderTime);
  private readonly ghostSwitch: ReturnType<typeof optionSwitch>;
  private rows: ListRow[] = [];
  private entries: PickerEntry[] = [];
  private selected = 0;
  private opened = false;
  private armedDelete: string | null = null;
  private ghostOn = true;

  constructor(
    parent: HTMLElement,
    private readonly handlers: PickerHandlers,
  ) {
    const t = RACE_TEXT.picker;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', t.title);
    const input = this.field.input;
    input.addEventListener('focus', () => {
      this.field.setMessage(t.importHint);
      this.handlers.onTyping(true);
    });
    input.addEventListener('blur', () => this.handlers.onTyping(false));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        const err = this.handlers.onImport(input.value);
        if (err) {
          this.field.setMessage(err, 'warn');
        }
      } else if (e.code === 'Escape') {
        e.preventDefault();
        this.closeImport();
      }
    });

    const closePrompt = noFocus(prompt(t.close, 'Y', 'secondary', () => this.handlers.onClose()).root);
    const header = h('header', 'race-sheet-head', [h('div', 'race-sheet-titles', [h('span', 'race-sheet-title', t.title), this.counts]), closePrompt]);

    const newPrompt = noFocus(prompt(t.newCourse, 'N', 'secondary', () => this.handlers.onNew()).root);
    const listCol = h('div', 'race-list', [
      h('span', 'race-list-cap', t.list),
      this.list,
      h('i', 'race-list-rule'),
      h('div', 'race-list-new', [newPrompt]),
      h('div', 'race-list-code', [this.field.root]),
    ]);

    this.removePrompt = prompt(t.remove, 'Del', 'danger', () => this.withSelected((e) => this.requestDelete(e.id)));
    this.customActions.append(
      noFocus(prompt(t.edit, 'E', 'secondary', () => this.withSelected((e) => this.handlers.onEdit(e.id))).root),
      noFocus(prompt(t.copyCode, 'K', 'secondary', () => this.withSelected((e) => this.handlers.onCopy(e.id))).root),
      noFocus(this.removePrompt.root),
    );
    this.ghostSwitch = optionSwitch(t.ghost, 'H', true, '#b39cf0', (on) => this.setGhost(on));
    noFocus(this.ghostSwitch.root);
    const startPrompt = noFocus(prompt(t.start, 'Enter', 'primary', () => this.withSelected((e) => this.handlers.onStart(e.id))).root);
    this.map.root.classList.add('race-detail-map');
    const detail = h('div', 'race-detail', [
      h('div', 'race-detail-head', [h('div', 'race-detail-titles', [this.name, this.desc]), this.customActions]),
      this.map.root,
      h('div', 'race-detail-stats', [this.lengthStat.root, this.gatesStat.root, this.bestStat.root, this.runsStat.root]),
      h('div', 'race-detail-ladder', [this.ladder.root]),
      h('i', 'race-detail-spacer'),
      h('div', 'race-detail-foot', [startPrompt, this.ghostSwitch.root, h('span', 'race-detail-note', t.note)]),
    ]);
    this.sheet.append(header, h('div', 'race-sheet-body', [listCol, detail]));
    this.root.append(h('div', 'race-picker-shade'), this.sheet);
    this.root.hidden = true;
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** Land / water sampler for the route map background (null until the world is loaded). */
  setWater(sampler: WaterSampler | null): void {
    this.map.setWater(sampler);
  }

  /** Opens with these entries; `selectId` picks the row (default: the first). `ghostOn`: the player's ghost choice. */
  open(entries: PickerEntry[], selectId: string | undefined, ghostOn: boolean): void {
    const t = RACE_TEXT.picker;
    this.entries = entries;
    this.armedDelete = null;
    this.ghostOn = ghostOn;
    const at = selectId ? entries.findIndex((e) => e.id === selectId) : -1;
    this.selected = at >= 0 ? at : 0;
    this.rows = entries.map((e, i) => {
      const row = listRow(
        { label: e.name, sub: t.rowSub(!!e.custom, formatCourseLength(e.lengthM), e.gates), value: e.best !== undefined ? formatRaceTime(e.best) : '—' },
        () => this.select(i),
        undefined,
      );
      row.setMarker(medalDot(e.medal ?? null).root);
      // A click selects (the detail shows the course); a double click starts it.
      row.root.addEventListener('dblclick', (ev) => {
        ev.preventDefault();
        this.handlers.onStart(e.id);
      });
      return row;
    });
    this.list.replaceChildren(...this.rows.map((r) => r.root));
    this.counts.textContent = t.counts(entries.length, entries.filter((e) => !!e.medal).length);
    this.field.setMessage('');
    this.opened = true;
    show(this.root, true);
    this.paint();
  }

  close(): void {
    if (!this.opened) {
      return;
    }
    this.closeImport();
    this.opened = false;
    show(this.root, false);
  }

  /** Shows a code in the share field, selected, so the player can copy it by hand (clipboard unavailable). */
  showCode(code: string): void {
    this.openImport();
    this.field.input.value = code;
    this.field.input.select();
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
        if (e) {
          this.handlers.onStart(e.id);
        }
        return true;
      case 'Escape':
      case 'KeyY':
        this.handlers.onClose();
        return true;
      case 'KeyN':
        this.handlers.onNew();
        return true;
      case 'KeyH':
        if (e?.hasGhost) {
          this.setGhost(!this.ghostOn);
        }
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

  private withSelected(fn: (e: PickerEntry) => void): void {
    const e = this.entries[this.selected];
    if (e) {
      fn(e);
    }
  }

  private setGhost(on: boolean): void {
    this.ghostOn = on;
    this.ghostSwitch.set(on);
    this.handlers.onGhost(on);
  }

  private requestDelete(id: string): void {
    if (this.armedDelete === id) {
      this.armedDelete = null;
      this.handlers.onDelete(id);
      return;
    }
    this.armedDelete = id;
    this.removePrompt.setLabel(RACE_TEXT.picker.removeConfirm);
  }

  private openImport(): void {
    this.field.setMessage(RACE_TEXT.picker.importHint);
    this.field.input.value = '';
    this.field.input.focus({ preventScroll: true });
  }

  private closeImport(): void {
    const input = this.field.input;
    if (document.activeElement === input) {
      input.blur();
    }
    input.value = '';
    this.field.setMessage('');
  }

  private select(i: number): void {
    if (i === this.selected || !this.entries[i]) {
      return;
    }
    this.selected = i;
    this.armedDelete = null;
    this.paint();
    this.handlers.onMove();
  }

  private move(step: number): void {
    const n = this.rows.length;
    if (n > 0) {
      this.select((this.selected + step + n) % n);
    }
  }

  /** Selection bar and the detail column for the selected course. */
  private paint(): void {
    const t = RACE_TEXT.picker;
    this.rows.forEach((r, i) => r.setSelected(i === this.selected));
    this.rows[this.selected]?.root.scrollIntoView?.({ block: 'nearest' });
    const e = this.entries[this.selected];
    if (!e) {
      return;
    }
    this.name.textContent = e.name;
    this.desc.textContent = e.description;
    show(this.customActions, !!e.custom);
    this.removePrompt.setLabel(t.remove);
    this.map.root.setAttribute('aria-label', t.mapLabel(e.name));
    this.map.set({ key: e.id, path: e.route.gates, stops: e.route.gates, rings: e.route.rings });
    this.lengthStat.set(formatCourseLength(e.lengthM));
    this.gatesStat.set(`${e.gates} · ${e.rings}`);
    this.bestStat.set(e.best !== undefined ? formatRaceTime(e.best) : '—');
    this.runsStat.set(String(e.runs));
    this.ladder.set([e.medals.gold, e.medals.silver, e.medals.bronze], e.best ?? null);
    this.ghostSwitch.setDisabled(!e.hasGhost, t.ghostNone);
    this.ghostSwitch.set(this.ghostOn);
  }

  dispose(): void {
    this.closeImport();
    this.root.remove();
  }
}
