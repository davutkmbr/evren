/**
 * Course editor overlay: a small plain-text panel (controls, counts, placement mode), the save name field and the
 * number labels over the placed rings (screen positions come from the activity system, which projects them).
 * Plain text with a text shadow over the scene, no glass box, in line with the HUD direction.
 */
import { MIN_GATES, NAME_MAX, type GateSize } from '../custom-courses';
import type { EditorKind } from '../editor';
import { RACE_TEXT } from '../text';
import { Text, Transform, h, show, toggle } from './dom';

export interface EditorPanelState {
  sourceName?: string;
  gates: number;
  rings: number;
  invalid: number;
  kind: EditorKind;
  size: GateSize;
}

export interface EditorLabel {
  x: number;
  y: number;
  text: string;
  ring: boolean;
  invalid: boolean;
}

/** Keys of the editor (event.code) and their key caps. */
export const EDITOR_KEYS = {
  place: { code: 'KeyB', cap: 'B' },
  undo: { code: 'Backspace', cap: '⌫' },
  kind: { code: 'KeyK', cap: 'K' },
  size: { code: 'KeyJ', cap: 'J' },
  save: { code: 'Enter', cap: 'Enter' },
  exit: { code: 'KeyY', cap: 'Y' },
} as const;

const MAX_LABELS = 48;

export class EditorPanel {
  readonly root = h('div', 'race-editor');
  private readonly panel = h('div', 'race-editor-panel');
  private readonly subtitle = new Text(h('div', 'race-editor-sub'));
  private readonly count = new Text(h('div', 'race-editor-count ejd-num'));
  private readonly invalid = new Text(h('div', 'race-editor-invalid'));
  private readonly mode = new Text(h('div', 'race-editor-mode'));
  private readonly min = new Text(h('div', 'race-editor-min'));
  private readonly nameRow = h('div', 'race-editor-name');
  private readonly nameInput = h('input', 'race-editor-name-input');
  private readonly labelLayer = h('div', 'race-editor-labels');
  private readonly labels: Array<{ node: HTMLElement; text: Text; transform: Transform; on: boolean }> = [];
  private onSubmit: ((name: string) => void) | null = null;
  private onCancel: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly onTyping: (typing: boolean) => void,
  ) {
    const t = RACE_TEXT.editor;
    this.root.setAttribute('lang', 'tr');
    const key = (k: { cap: string }, label: string): HTMLElement => h('div', 'race-editor-key', [h('kbd', undefined, k.cap), h('span', undefined, label)]);
    const keys = h('div', 'race-editor-keys', [
      key(EDITOR_KEYS.place, t.keys.place),
      key(EDITOR_KEYS.undo, t.keys.undo),
      key(EDITOR_KEYS.kind, t.keys.kind),
      key(EDITOR_KEYS.size, t.keys.size),
      key(EDITOR_KEYS.save, t.keys.save),
      key(EDITOR_KEYS.exit, t.keys.exit),
    ]);
    this.nameInput.type = 'text';
    this.nameInput.maxLength = NAME_MAX;
    this.nameInput.spellcheck = false;
    this.nameInput.autocomplete = 'off';
    this.nameInput.setAttribute('aria-label', t.namePrompt);
    this.nameInput.addEventListener('focus', () => this.onTyping(true));
    this.nameInput.addEventListener('blur', () => {
      this.onTyping(false);
      // Focus lost some other way (a click elsewhere, a menu): the question is withdrawn.
      if (!this.nameRow.hidden) {
        this.finishName(false);
      }
    });
    this.nameInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        this.finishName(true);
      } else if (e.code === 'Escape') {
        e.preventDefault();
        this.finishName(false);
      }
    });
    this.nameRow.append(h('div', 'race-editor-name-label', t.namePrompt), this.nameInput, h('div', 'race-editor-name-hint', t.nameHint));
    this.nameRow.hidden = true;
    this.panel.append(
      h('div', 'race-editor-title', t.title),
      this.subtitle.node,
      this.count.node,
      this.invalid.node,
      this.mode.node,
      this.min.node,
      keys,
      this.nameRow,
    );
    this.root.append(this.labelLayer, this.panel);
    this.root.hidden = true;
    parent.append(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  get naming(): boolean {
    return !this.nameRow.hidden;
  }

  setOpen(open: boolean): void {
    if (!open) {
      this.finishName(false);
      this.setLabels([]);
    }
    show(this.root, open);
  }

  /** Hides the overlay without closing it (HUD hidden, menu open). */
  setVisible(visible: boolean): void {
    toggle(this.root, 'is-hidden', !visible);
  }

  update(s: EditorPanelState): void {
    const t = RACE_TEXT.editor;
    this.subtitle.set(t.subtitle(s.sourceName));
    this.count.set(t.count(s.gates, s.rings));
    this.invalid.set(s.invalid > 0 ? t.invalidCount(s.invalid) : '');
    show(this.invalid.node, s.invalid > 0);
    this.mode.set(s.kind === 'ring' ? t.placingRing : t.placing(t.kindGate, t.size[s.size]));
    toggle(this.mode.node, 'is-ring', s.kind === 'ring');
    const valid = s.gates - s.invalid;
    this.min.set(valid < MIN_GATES ? t.minGates(MIN_GATES) : '');
    show(this.min.node, valid < MIN_GATES);
  }

  /** Asks for the course name; exactly one of the callbacks runs. */
  askName(initial: string, onSubmit: (name: string) => void, onCancel: () => void): void {
    this.onSubmit = onSubmit;
    this.onCancel = onCancel;
    this.nameInput.value = initial;
    this.nameRow.hidden = false;
    this.nameInput.focus({ preventScroll: true });
    this.nameInput.select();
  }

  /** Withdraws the name question (the cancel callback runs). */
  cancelName(): void {
    this.finishName(false);
  }

  private finishName(submit: boolean): void {
    if (this.nameRow.hidden) {
      return;
    }
    const submitFn = this.onSubmit;
    const cancelFn = this.onCancel;
    this.onSubmit = null;
    this.onCancel = null;
    this.nameRow.hidden = true;
    const value = this.nameInput.value;
    if (document.activeElement === this.nameInput) {
      this.nameInput.blur();
    }
    if (submit) {
      submitFn?.(value);
    } else {
      cancelFn?.();
    }
  }

  /** Number labels over the rings (screen pixels); an empty list hides them all. */
  setLabels(items: readonly EditorLabel[]): void {
    const n = Math.min(MAX_LABELS, items.length);
    while (this.labels.length < n) {
      const node = h('span', 'race-editor-label ejd-num');
      node.hidden = true;
      this.labelLayer.append(node);
      this.labels.push({ node, text: new Text(node), transform: new Transform(node), on: false });
    }
    for (let i = 0; i < this.labels.length; i++) {
      const l = this.labels[i];
      const it = i < n ? items[i] : null;
      if (!it) {
        if (l.on) {
          l.on = false;
          show(l.node, false);
        }
        continue;
      }
      l.text.set(it.text);
      l.transform.set(`translate(${Math.round(it.x)}px, ${Math.round(it.y)}px) translate(-50%, -50%)`);
      toggle(l.node, 'is-ring', it.ring);
      toggle(l.node, 'is-invalid', it.invalid);
      if (!l.on) {
        l.on = true;
        show(l.node, true);
      }
    }
  }

  dispose(): void {
    this.finishName(false);
    this.root.remove();
  }
}
