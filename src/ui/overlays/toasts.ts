import { keyText } from '../components';
import { el } from '../dom';
import { HUD_PRIORITY, ZONE_CLASS, type HudDirector } from '../zones';

const TOAST_S = 3.6;
/** A toast that could not show within this many seconds (another one was up) is dropped. */
const TOAST_WAIT_S = 2.5;

interface ToastContent {
  text: string;
  kind: 'info' | 'warn';
}

/**
 * Transient messages fed by the 'toast' event, one at a time in the toast slot (top left; top centre over a menu).
 * Plain text with a soft shadow on a faint pill; keys named as "[L]" in the text are drawn as key caps.
 * The newest toast replaces the current one in place; a toast pushed with a `key` (camera, clock) updates its own
 * entry instead of queueing a second one. The director (lowest priority, toast zone) decides when each one shows.
 */
export class Toasts {
  private readonly text = el('span', 'toast-text');
  private readonly node = el('div', 'toast', [el('i', 'toast-dot'), this.text]);
  readonly root = el('div', `${ZONE_CLASS.toast} hud-toasts`, [this.node], { role: 'status', 'aria-live': 'polite' });
  private readonly content = new Map<string, ToastContent>();
  private lastText = '';
  private lastAt = 0;
  private seq = 0;

  constructor(private readonly zones: HudDirector) {}

  push(text: string, kind: 'info' | 'warn' = 'info', key?: string): void {
    const now = performance.now();
    if (text === this.lastText && now - this.lastAt < 1200) {
      return;
    }
    this.lastText = text;
    this.lastAt = now;
    const id = `toast.${key ?? ++this.seq}`;
    this.content.set(id, { text, kind });
    this.zones.request({
      id,
      zone: 'toast',
      priority: HUD_PRIORITY.toast,
      duration: TOAST_S,
      maxWait: TOAST_WAIT_S,
      onShow: () => this.render(id),
      onHide: () => this.node.classList.remove('is-in'),
    });
    // Forget toasts that finished or were dropped as stale.
    for (const k of this.content.keys()) {
      if (!this.zones.has(k)) {
        this.content.delete(k);
      }
    }
  }

  private render(id: string): void {
    const c = this.content.get(id);
    if (!c) {
      return;
    }
    this.text.replaceChildren(...keyText(c.text));
    this.node.className = `toast is-${c.kind} is-in`;
  }
}
