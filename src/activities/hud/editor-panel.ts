/**
 * Course editor overlay (race UI v2), plain text over the scene: at the top centre "Parkur editörü · <course>", the
 * current placement big ("Kapı · orta" / "Hız halkası"), counts and length and one warning line; on the left a key
 * strip (key cap + action); number labels over the placed rings (invalid ones red with the reason; screen positions
 * come from the activity system, which projects them); and the save dialog with one name field.
 */
import { keyHint, prompt, textField } from '../../ui/components';
import { MIN_GATES, NAME_MAX, type GateSize } from '../custom-courses';
import type { EditorKind } from '../editor';
import { RACE_TEXT, formatCourseLength } from '../text';
import { Text, Transform, h, noFocus, show, toggle } from './dom';

export interface EditorPanelState {
  sourceName?: string;
  gates: number;
  rings: number;
  /** Invalid gates and speed rings (red; skipped on save). */
  invalid: number;
  validGates: number;
  kind: EditorKind;
  size: GateSize;
  /** Gate-to-gate length so far (m). */
  lengthM: number;
}

export interface EditorLabel {
  x: number;
  y: number;
  text: string;
  ring: boolean;
  /** Why the ring is invalid (shown after the number), undefined when valid. */
  reason?: string;
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
  private readonly title = new Text(h('span', 'race-editor-title'));
  private readonly placing = new Text(h('span', 'race-editor-placing'));
  private readonly counts = new Text(h('span', 'race-editor-counts ejd-num'));
  private readonly warn = new Text(h('span', 'race-editor-warn'));
  private readonly dialog = h('div', 'race-editor-save');
  private readonly field = textField(RACE_TEXT.editor.namePrompt, { size: 'l', maxLength: NAME_MAX });
  private readonly saveWarn = h('span', 'race-editor-save-warn');
  private readonly labelLayer = h('div', 'race-editor-labels');
  private readonly labels: Array<{ node: HTMLElement; text: Text; transform: Transform; on: boolean }> = [];
  private onSubmit: ((name: string) => void) | null = null;
  private onCancel: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly onTyping: (typing: boolean) => void,
  ) {
    const t = RACE_TEXT.editor;
    const k = EDITOR_KEYS;
    this.root.setAttribute('lang', 'tr');
    const keys = h(
      'div',
      'race-editor-keys',
      [
        keyHint(k.place.cap, t.keys.place),
        keyHint(k.kind.cap, t.keys.kind),
        keyHint(k.size.cap, t.keys.size),
        keyHint(k.undo.cap, t.keys.undo),
        keyHint(k.save.cap, t.keys.save),
        keyHint(k.exit.cap, t.keys.exit),
      ].map((x) => x.root),
    );
    const input = this.field.input;
    input.addEventListener('focus', () => this.onTyping(true));
    input.addEventListener('blur', () => {
      this.onTyping(false);
      // Focus lost some other way (a click elsewhere, a menu): the question is withdrawn.
      if (this.naming) {
        this.finishName(false);
      }
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        this.finishName(true);
      } else if (e.code === 'Escape') {
        e.preventDefault();
        this.finishName(false);
      }
    });
    // The prompts never take focus, so clicking them keeps the field focused until the answer is handled.
    const cancel = noFocus(prompt(t.cancel, 'Esc', 'secondary', () => this.finishName(false)).root);
    const save = noFocus(prompt(t.save, 'Enter', 'primary', () => this.finishName(true)).root);
    const box = h('div', 'race-editor-save-box ejd-interactive', [
      h('span', 'race-editor-save-title', t.saveTitle),
      this.field.root,
      this.saveWarn,
      h('div', 'race-editor-save-actions', [cancel, save]),
    ]);
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', t.saveTitle);
    this.dialog.append(h('div', 'race-editor-save-shade'), box);
    this.dialog.hidden = true;
    const head = h('div', 'race-editor-head', [this.title.node, this.placing.node, this.counts.node, this.warn.node]);
    this.root.append(this.labelLayer, head, keys, this.dialog);
    this.root.hidden = true;
    parent.append(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  get naming(): boolean {
    return !this.dialog.hidden;
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
    this.title.set(t.title(s.sourceName));
    this.placing.set(s.kind === 'ring' ? t.placingRing : t.placing(t.size[s.size]));
    toggle(this.placing.node, 'is-ring', s.kind === 'ring');
    this.counts.set(t.counts(s.gates, s.rings, formatCourseLength(s.lengthM)));
    const warn = s.invalid > 0 ? t.invalidCount(s.invalid) : s.validGates < MIN_GATES ? t.minGates(MIN_GATES) : '';
    this.warn.set(warn);
    show(this.warn.node, warn !== '');
  }

  /** Opens the save dialog; `warning` names what saving will skip. Exactly one of the callbacks runs. */
  askName(initial: string, warning: string, onSubmit: (name: string) => void, onCancel: () => void): void {
    this.onSubmit = onSubmit;
    this.onCancel = onCancel;
    this.saveWarn.textContent = warning;
    show(this.saveWarn, warning !== '');
    this.field.input.value = initial;
    show(this.dialog, true);
    this.field.input.focus({ preventScroll: true });
    this.field.input.select();
  }

  /** Withdraws the name question (the cancel callback runs). */
  cancelName(): void {
    this.finishName(false);
  }

  private finishName(submit: boolean): void {
    if (!this.naming) {
      return;
    }
    const submitFn = this.onSubmit;
    const cancelFn = this.onCancel;
    this.onSubmit = null;
    this.onCancel = null;
    show(this.dialog, false);
    const value = this.field.input.value;
    if (document.activeElement === this.field.input) {
      this.field.input.blur();
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
      l.text.set(it.reason ? `${it.text} · ${it.reason}` : it.text);
      l.transform.set(`translate(${Math.round(it.x)}px, ${Math.round(it.y)}px) translate(-50%, -50%)`);
      toggle(l.node, 'is-ring', it.ring);
      toggle(l.node, 'is-invalid', !!it.reason);
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
