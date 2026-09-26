import { el } from '../dom';

const MAX_TOASTS = 3;
const TOAST_MS = 3600;

interface KeyedToast {
  node: HTMLElement;
  text: HTMLElement;
  timer: number;
}

/**
 * Stacked transient messages (top centre) fed by the 'toast' event. Plain text with a soft shadow on a faint pill.
 * A toast pushed with a `key` replaces the live toast with the same key (camera, clock) instead of stacking.
 */
export class Toasts {
  readonly root = el('div', 'hud-toasts', undefined, { role: 'status', 'aria-live': 'polite' });
  private lastText = '';
  private lastAt = 0;
  private readonly keyed = new Map<string, KeyedToast>();

  push(text: string, kind: 'info' | 'warn' = 'info', key?: string): void {
    const now = performance.now();
    if (text === this.lastText && now - this.lastAt < 1200) {
      return;
    }
    this.lastText = text;
    this.lastAt = now;
    const live = key ? this.keyed.get(key) : undefined;
    if (live && live.node.isConnected && !live.node.classList.contains('is-leaving')) {
      live.text.textContent = text;
      live.node.className = `toast is-${kind} is-in`;
      window.clearTimeout(live.timer);
      live.timer = this.scheduleLeave(live.node, key);
      return;
    }
    const textNode = el('span', 'toast-text', text);
    const toast = el('div', `toast is-${kind}`, [el('i', 'toast-dot'), textNode]);
    this.root.append(toast);
    while (this.root.childElementCount > MAX_TOASTS) {
      this.root.firstElementChild?.remove();
    }
    requestAnimationFrame(() => toast.classList.add('is-in'));
    const timer = this.scheduleLeave(toast, key);
    if (key) {
      this.keyed.set(key, { node: toast, text: textNode, timer });
    }
  }

  private scheduleLeave(toast: HTMLElement, key: string | undefined): number {
    return window.setTimeout(() => {
      toast.classList.remove('is-in');
      toast.classList.add('is-leaving');
      window.setTimeout(() => {
        toast.remove();
        if (key && this.keyed.get(key)?.node === toast) {
          this.keyed.delete(key);
        }
      }, 320);
    }, TOAST_MS);
  }
}
