import { el } from '../dom';

const MAX_TOASTS = 3;
const TOAST_MS = 3600;

/** Stacked transient messages (top centre) fed by the 'toast' event. */
export class Toasts {
  readonly root = el('div', 'hud-toasts', undefined, { role: 'status', 'aria-live': 'polite' });
  private lastText = '';
  private lastAt = 0;

  push(text: string, kind: 'info' | 'warn' = 'info'): void {
    const now = performance.now();
    if (text === this.lastText && now - this.lastAt < 1200) {
      return;
    }
    this.lastText = text;
    this.lastAt = now;
    const toast = el('div', `toast ejd-glass is-${kind}`, [el('i', 'toast-dot'), el('span', 'toast-text', text)]);
    this.root.append(toast);
    while (this.root.childElementCount > MAX_TOASTS) {
      this.root.firstElementChild?.remove();
    }
    requestAnimationFrame(() => toast.classList.add('is-in'));
    window.setTimeout(() => {
      toast.classList.remove('is-in');
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 320);
    }, TOAST_MS);
  }
}
