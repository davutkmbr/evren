import type { GameEvents } from '../../core/contracts';
import type { EventBus } from '../../core/events';
import { el } from '../dom';
import { fadeBinding, HUD_PRIORITY, ZONE_CLASS, type HudDirector } from '../zones';

/** How long a caption holds before it fades (s); hints (a refused trick) stay a little longer. */
const HOLD_S = 1.4;
const HINT_HOLD_S = 2.2;
/** A caption is about the moment: if it cannot show almost at once (a race line is up), it is dropped. */
const MAX_WAIT_S = 0.6;

/**
 * Caption for the dragon's maneuvers and the rider's actions ('maneuver' events: "Takla", "Serbest düşüş",
 * "Kanatlar açıldı", "Güç vuruşu"...) in the lowerCenter zone. Fades in, holds ~1.4 s and fades out; a new maneuver
 * replaces the text in place with a small pop. Outranks the flight and start hints, yields to race lines.
 */
export class ManeuverCaption {
  static readonly ID = 'caption.maneuver';
  private readonly label = el('span', 'mnv-label');
  readonly root = el('div', `${ZONE_CLASS.lowerCenter} hud-maneuver`, [this.label, el('i', 'mnv-rule')], { role: 'status', 'aria-live': 'polite' });
  private readonly binding = fadeBinding(this.root, { onHide: () => this.label.classList.remove('is-pop') });

  constructor(private readonly zones: HudDirector) {}

  show(label: string, hint = false): void {
    if (!label) {
      return;
    }
    const zones = this.zones;
    zones.request({
      id: ManeuverCaption.ID,
      zone: 'lowerCenter',
      priority: HUD_PRIORITY.maneuver,
      duration: hint ? HINT_HOLD_S : HOLD_S,
      maxWait: MAX_WAIT_S,
      onShow: () => {
        const visible = !this.root.classList.contains('is-out');
        this.label.textContent = label;
        this.root.classList.toggle('is-hint', hint);
        if (visible) {
          // Already up: restart the pop so the new maneuver reads as new.
          this.label.classList.remove('is-pop');
          void this.label.offsetWidth;
          this.label.classList.add('is-pop');
        }
        this.binding.onShow();
      },
      onHide: this.binding.onHide,
    });
  }

  hide(): void {
    this.zones.release(ManeuverCaption.ID);
  }

  /** Shows every 'maneuver' event (flight tricks, take-off and landing, the rider's pet / stand / sit). */
  connect(events: EventBus<GameEvents>): () => void {
    return events.on('maneuver', ({ id, label }) => this.show(label, id === 'hint'));
  }
}
