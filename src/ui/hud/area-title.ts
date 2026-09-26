import type { District, GeoQuery } from '../../core/contracts';
import { el, TextSlot } from '../dom';
import type { FlightSnapshot } from '../types';
import { fadeBinding, HUD_PRIORITY, ZONE_CLASS, type HudDirector } from '../zones';

const CHECK_INTERVAL_S = 0.5;
/** The dragon must stay in a new area this long before its title shows (no flicker along coasts and borders). */
const SETTLE_S = 1.5;
/** The same area does not announce itself again within this window (ms). */
const REPEAT_MS = 60_000;
/** Visible time before the fade out starts (s); the fades add ~1.2 s. */
const HOLD_S = 2.8;
/** A title that could not show within this many seconds (a race, a discovery) is stale and dropped. */
const MAX_WAIT_S = 8;

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
 * land, the water body (geo.waterNameAt) over water. Fades in and out over ~4 s. It asks the zone director for the
 * title zone: a race (context 'race') defers it until the race ends, and it is dropped when it gets stale.
 */
export class AreaTitle {
  static readonly ID = 'area.title';
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
  private readonly binding: { onShow: () => void; onHide: () => void };
  private readonly lastShown = new Map<string, number>();

  constructor() {
    const titleNode = el('span', 'at-title');
    this.subtitleNode = el('span', 'at-sub');
    this.title = new TextSlot(titleNode);
    this.subtitle = new TextSlot(this.subtitleNode);
    this.root = el('div', `${ZONE_CLASS.title} hud-area`, [titleNode, el('i', 'at-rule'), this.subtitleNode], { role: 'status', 'aria-live': 'polite' });
    this.binding = fadeBinding(this.root);
  }

  setGeo(geo: GeoQuery): void {
    this.geo = geo;
  }

  /** Called while the HUD is visible (so never in menus or photo mode). */
  update(s: FlightSnapshot, realDt: number, zones: HudDirector): void {
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
    if (now - (this.lastShown.get(name) ?? -Infinity) < REPEAT_MS) {
      return;
    }
    this.lastShown.set(name, now);
    const subtitle = this.candidateSub;
    zones.request({
      id: AreaTitle.ID,
      zone: 'title',
      priority: HUD_PRIORITY.areaTitle,
      duration: HOLD_S,
      maxWait: MAX_WAIT_S,
      deferIn: ['race'],
      onShow: () => {
        // Filled when it appears (a newer area may have replaced a deferred one).
        this.title.set(name);
        this.subtitle.set(subtitle);
        this.subtitleNode.hidden = !subtitle;
        this.binding.onShow();
      },
      onHide: this.binding.onHide,
    });
  }
}
