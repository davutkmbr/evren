import type { GameEvents } from '../../core/contracts';
import type { EventBus } from '../../core/events';
import { el } from '../dom';

/** How long a caption holds before it fades (ms); hints (a refused trick) stay a little longer. */
const HOLD_MS = 1400;
const HINT_HOLD_MS = 2200;

/**
 * Bottom-centre caption for the dragon's maneuvers and the rider's actions ('maneuver' events: "Takla",
 * "Serbest düşüş", "Kanatlar açıldı", "Dehh!"...). Fades in, holds ~1.4 s and fades out; a new maneuver replaces the
 * text in place with a small pop. Absolutely positioned, so nothing else moves.
 */
export class ManeuverCaption {
  private readonly label = el('span', 'mnv-label');
  readonly root = el('div', 'hud-maneuver ejd-fade is-out', [this.label, el('i', 'mnv-rule')], { role: 'status', 'aria-live': 'polite' });
  private timer = 0;

  show(label: string, hint = false): void {
    if (!label) {
      return;
    }
    const visible = !this.root.classList.contains('is-out');
    this.label.textContent = label;
    this.root.classList.toggle('is-hint', hint);
    if (visible) {
      // Already up: restart the pop so the new maneuver reads as new.
      this.label.classList.remove('is-pop');
      void this.label.offsetWidth;
      this.label.classList.add('is-pop');
    }
    this.root.classList.remove('is-out');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), hint ? HINT_HOLD_MS : HOLD_MS);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.root.classList.add('is-out');
    this.label.classList.remove('is-pop');
  }

  /** Shows every 'maneuver' event (flight tricks, take-off and landing, the rider's pet / stand / sit). */
  connect(events: EventBus<GameEvents>): () => void {
    return events.on('maneuver', ({ id, label }) => this.show(label, id === 'hint'));
  }
}
