import type { HotbarService, HotbarSlot, HotbarSlotState } from '../../core/contracts';
import { HOTBAR_BUTTONS, type Input } from '../../core/input';
import { el, TextSlot, toggleClass, TransformSlot } from '../dom';
import { HOTBAR_ICONS } from './hotbar-icons';

const SIZE = HOTBAR_BUTTONS.length;
/** How long the caption under the hotbar stays after a slot was used or selected (ms). */
const CAPTION_MS = 2600;

interface SlotView {
  root: HTMLElement;
  icon: HTMLElement;
  count: TextSlot;
  countNode: HTMLElement;
  cooldown: TransformSlot;
  cooldownNode: HTMLElement;
  /** Last drawn state (only changed parts touch the DOM). */
  drawnIcon: string;
  dirty: boolean;
}

/**
 * Hotbar service ('hotbar') and its bottom-centre view: five 54 px slots on the number keys 1..5 with a one-line
 * caption ("Ateş püskür · F") under them. Abilities and items register through the service; the owner of a slot
 * keeps its live state (active, cooldown, count, enabled) current with `update`, which only marks the slot dirty —
 * the DOM is written once per frame in `render`.
 */
export class Hotbar implements HotbarService {
  readonly size = SIZE;
  readonly slots: (HotbarSlot | null)[] = new Array<HotbarSlot | null>(SIZE).fill(null);
  readonly root: HTMLElement;
  private readonly views: SlotView[] = [];
  private readonly captionNode = el('span', 'hb-caption ejd-fade is-out', '');
  private captionTimer = 0;
  private readonly wasActive: boolean[] = new Array<boolean>(SIZE).fill(false);
  private readonly wasCooling: boolean[] = new Array<boolean>(SIZE).fill(false);

  constructor() {
    const row = el('div', 'hb-row');
    for (let i = 0; i < SIZE; i++) {
      const icon = el('span', 'hb-icon');
      const countNode = el('span', 'hb-count ejd-num');
      const cooldownNode = el('i', 'hb-cooldown');
      const root = el('div', 'hb-slot is-empty', [el('span', 'hb-key', String(i + 1)), icon, countNode, cooldownNode]);
      root.addEventListener('click', () => this.trigger(i));
      row.append(root);
      this.views.push({
        root,
        icon,
        count: new TextSlot(countNode),
        countNode,
        cooldown: new TransformSlot(cooldownNode),
        cooldownNode,
        drawnIcon: '',
        dirty: true,
      });
    }
    this.root = el('div', 'hud-hotbar', [row, this.captionNode], { 'aria-label': 'Hotbar' });
  }

  /* ---------------- HotbarService ---------------- */

  set(index: number, slot: HotbarSlot | null): void {
    if (index < 0 || index >= SIZE) {
      return;
    }
    if (slot) {
      // A slot id lives in one place only.
      const existing = this.indexOf(slot.id);
      if (existing >= 0 && existing !== index) {
        this.clear(existing);
      }
    }
    this.slots[index] = slot ? { ...slot } : null;
    this.wasActive[index] = !!slot?.active;
    this.wasCooling[index] = (slot?.cooldown ?? 0) > 0;
    this.views[index].dirty = true;
  }

  firstFree(): number {
    return this.slots.indexOf(null);
  }

  update(id: string, state: HotbarSlotState): void {
    const index = this.indexOf(id);
    if (index < 0) {
      return;
    }
    const slot = this.slots[index]!;
    let changed = false;
    for (const key of Object.keys(state) as Array<keyof HotbarSlotState>) {
      const value = state[key];
      if (slot[key] !== value) {
        (slot as unknown as Record<string, unknown>)[key] = value;
        changed = true;
      }
    }
    if (changed) {
      this.views[index].dirty = true;
    }
  }

  remove(id: string): void {
    const index = this.indexOf(id);
    if (index >= 0) {
      this.clear(index);
    }
  }

  /* ---------------- input + view ---------------- */

  /** Number keys 1..5 (call only while flight input is live: no menu, no photo mode). */
  poll(input: Input): void {
    for (let i = 0; i < SIZE; i++) {
      if (input.wasPressed(HOTBAR_BUTTONS[i])) {
        this.trigger(i);
      }
    }
  }

  /** Writes dirty slots to the DOM; a slot that starts being active or cooling down shows its caption. */
  render(): void {
    for (let i = 0; i < SIZE; i++) {
      const view = this.views[i];
      if (!view.dirty) {
        continue;
      }
      view.dirty = false;
      const slot = this.slots[i];
      const active = !!slot?.active;
      const cooling = (slot?.cooldown ?? 0) > 0.001;
      if (slot && ((active && !this.wasActive[i]) || (cooling && !this.wasCooling[i]))) {
        this.showCaption(slot);
      }
      this.wasActive[i] = active;
      this.wasCooling[i] = cooling;
      this.draw(view, slot);
    }
  }

  private draw(view: SlotView, slot: HotbarSlot | null): void {
    const icon = slot?.icon ?? '';
    if (icon !== view.drawnIcon) {
      view.drawnIcon = icon;
      view.icon.innerHTML = slot ? HOTBAR_ICONS[slot.icon] ?? HOTBAR_ICONS.unknown : '';
    }
    const cooldown = slot ? Math.min(1, Math.max(0, slot.cooldown ?? 0)) : 0;
    toggleClass(view.root, 'is-empty', !slot);
    toggleClass(view.root, 'is-filled', !!slot);
    toggleClass(view.root, 'is-active', !!slot?.active);
    toggleClass(view.root, 'is-disabled', !!slot && slot.enabled === false);
    toggleClass(view.root, 'is-cooling', cooldown > 0.001);
    view.cooldown.set(`scaleY(${cooldown.toFixed(3)})`);
    const count = slot?.count;
    view.countNode.hidden = count === undefined;
    view.count.set(count === undefined ? '' : String(count));
    view.root.title = slot ? (slot.hotkey ? `${slot.label} · ${slot.hotkey}` : slot.label) : '';
  }

  private trigger(index: number): void {
    const slot = this.slots[index];
    if (!slot) {
      return;
    }
    this.showCaption(slot);
    if (slot.enabled === false || (slot.cooldown ?? 0) > 0.001) {
      this.views[index].root.classList.remove('is-denied');
      void this.views[index].root.offsetWidth;
      this.views[index].root.classList.add('is-denied');
      return;
    }
    slot.activate?.();
  }

  private showCaption(slot: HotbarSlot): void {
    this.captionNode.textContent = slot.hotkey ? `${slot.label} · ${slot.hotkey}` : slot.label;
    this.captionNode.classList.remove('is-out');
    window.clearTimeout(this.captionTimer);
    this.captionTimer = window.setTimeout(() => this.captionNode.classList.add('is-out'), CAPTION_MS);
  }

  private clear(index: number): void {
    this.slots[index] = null;
    this.wasActive[index] = false;
    this.wasCooling[index] = false;
    this.views[index].dirty = true;
  }

  private indexOf(id: string): number {
    return this.slots.findIndex((s) => s?.id === id);
  }

  dispose(): void {
    window.clearTimeout(this.captionTimer);
  }
}
