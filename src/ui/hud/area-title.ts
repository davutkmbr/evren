import type { District, GameEvents, GeoQuery } from '../../core/contracts';
import type { EventBus } from '../../core/events';
import { el, TextSlot } from '../dom';
import type { FlightSnapshot } from '../types';

const CHECK_INTERVAL_S = 0.5;
/** The dragon must stay in a new area this long before its title shows (no flicker along coasts and borders). */
const SETTLE_S = 1.5;
/** The same area does not announce itself again within this window (ms). */
const REPEAT_MS = 60_000;
/** Visible time before the fade out starts (ms); the fades add ~1.2 s. */
const HOLD_MS = 2800;

const SIDE_LABELS: Record<District['side'], string> = { europe: 'Avrupa Yakası', asia: 'Anadolu Yakası', island: 'Adalar' };

/** Subtitles for the water bodies geo.waterNameAt returns. */
const WATER_SUBTITLES: Record<string, string> = {
  'İstanbul Boğazı': 'Karadeniz ile Marmara arasında, 31 km',
  Haliç: 'Tarihî Yarımada ile Beyoğlu arasında',
  'Marmara Denizi': 'Avrupa ile Asya arasında bir iç deniz',
  Karadeniz: 'Boğaz’ın kuzey ağzı',
};

/**
 * Large light title in the upper third when the dragon enters a new named area: a district (geo.districtAt) over
 * land, the water body (geo.waterNameAt) over water. Fades in and out over ~4 s; never while racing.
 */
export class AreaTitle {
  private readonly title: TextSlot;
  private readonly subtitle: TextSlot;
  private readonly subtitleNode: HTMLElement;
  readonly root: HTMLElement;
  private geo: GeoQuery | null = null;
  private timer = 0;
  private current = '';
  private candidate = '';
  private candidateSub = '';
  private candidateFor = 0;
  private racing = false;
  private hideTimer = 0;
  private readonly lastShown = new Map<string, number>();

  constructor() {
    const titleNode = el('span', 'at-title');
    this.subtitleNode = el('span', 'at-sub');
    this.title = new TextSlot(titleNode);
    this.subtitle = new TextSlot(this.subtitleNode);
    this.root = el('div', 'hud-area ejd-fade is-out', [titleNode, el('i', 'at-rule'), this.subtitleNode], { role: 'status', 'aria-live': 'polite' });
  }

  setGeo(geo: GeoQuery): void {
    this.geo = geo;
  }

  /** Races start/stop through 'activity' events; a race hides the title at once. */
  connect(events: EventBus<GameEvents>): () => void {
    return events.on('activity', ({ state }) => {
      this.racing = state === 'started' || state === 'checkpoint';
      if (this.racing) {
        this.hide();
      }
    });
  }

  /** Called while the HUD is visible (so never in menus or photo mode). */
  update(s: FlightSnapshot, realDt: number): void {
    this.timer -= realDt;
    if (this.timer > 0 || !this.geo) {
      return;
    }
    this.timer = CHECK_INTERVAL_S;
    const geo = this.geo;
    let name: string;
    let sub: string;
    const district = geo.isWater(s.x, s.z) ? null : geo.districtAt(s.x, s.z);
    if (district) {
      name = district.name;
      sub = SIDE_LABELS[district.side];
    } else {
      name = geo.waterNameAt?.(s.x, s.z) ?? '';
      sub = WATER_SUBTITLES[name] ?? '';
    }
    if (name !== this.candidate) {
      this.candidate = name;
      this.candidateSub = sub === name ? '' : sub;
      this.candidateFor = 0;
      return;
    }
    this.candidateFor += CHECK_INTERVAL_S;
    if (!name || name === this.current || this.candidateFor < SETTLE_S) {
      return;
    }
    this.current = name;
    const now = performance.now();
    if (this.racing || now - (this.lastShown.get(name) ?? -Infinity) < REPEAT_MS) {
      return;
    }
    this.lastShown.set(name, now);
    this.show(name, this.candidateSub);
  }

  private show(name: string, sub: string): void {
    this.title.set(name);
    this.subtitle.set(sub);
    this.subtitleNode.hidden = !sub;
    this.root.classList.remove('is-out');
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), HOLD_MS);
  }

  hide(): void {
    window.clearTimeout(this.hideTimer);
    this.root.classList.add('is-out');
  }

  dispose(): void {
    window.clearTimeout(this.hideTimer);
  }
}
