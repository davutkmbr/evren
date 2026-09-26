import type { LandmarkDef } from '../../core/contracts';
import { el, TextSlot } from '../dom';
import { formatDistance, formatYear } from '../format';
import { LANDMARK_KIND_LABELS } from '../labels';
import { fadeBinding, HUD_PRIORITY, ZONE_CLASS, type HudDirector } from '../zones';

export const CARD_DURATION_MS = 9000;
/** A card that cannot show within this many seconds is dropped (the landmark stays discovered). */
const MAX_WAIT_S = 6;

/**
 * Discovery note in the corner zone (top right; plain text with a soft shadow, no box), shown once when a landmark is
 * discovered. The zone director decides when it appears and ends it after CARD_DURATION_MS.
 */
export class DiscoveryCard {
  static readonly ID = 'discovery.card';
  readonly root: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly meta: TextSlot;
  private readonly title: TextSlot;
  private readonly info: TextSlot;
  private readonly distance: TextSlot;
  private readonly timer: HTMLElement;
  private readonly binding: { onShow: () => void; onHide: () => void };
  private current: LandmarkDef | null = null;
  private zones: HudDirector | null = null;

  constructor() {
    this.badge = el('span', 'dcard-badge', 'Yeni keşif');
    const metaNode = el('span', 'dcard-meta');
    const titleNode = el('h3', 'dcard-title');
    const infoNode = el('p', 'dcard-info');
    const distNode = el('span', 'dcard-dist ejd-num');
    this.meta = new TextSlot(metaNode);
    this.title = new TextSlot(titleNode);
    this.info = new TextSlot(infoNode);
    this.distance = new TextSlot(distNode);
    this.timer = el('i', 'dcard-timer');
    this.root = el('aside', `${ZONE_CLASS.corner} hud-dcard`, [
      el('div', 'dcard-top', [this.badge, metaNode, distNode]),
      titleNode,
      infoNode,
      this.timer,
    ], { 'aria-live': 'polite' });
    this.binding = fadeBinding(this.root);
  }

  /** The zone director (set by the UI before the first card). */
  setZones(zones: HudDirector): void {
    this.zones = zones;
  }

  get showing(): LandmarkDef | null {
    // A card dropped as stale by the director is no longer showing.
    return this.zones && !this.zones.has(DiscoveryCard.ID) ? null : this.current;
  }

  show(landmark: LandmarkDef, isNew: boolean, distance: number): void {
    this.current = landmark;
    this.badge.hidden = !isNew;
    const kind = LANDMARK_KIND_LABELS[landmark.kind];
    this.meta.set(landmark.year !== undefined ? `${kind} · ${formatYear(landmark.year)}` : kind);
    this.title.set(landmark.name);
    this.info.set(landmark.info);
    this.setDistance(distance);
    this.root.classList.toggle('is-new', isNew);
    const onShow = (): void => {
      this.timer.classList.remove('is-running');
      void this.timer.offsetWidth;
      this.timer.classList.add('is-running');
      this.binding.onShow();
    };
    if (!this.zones) {
      onShow();
      return;
    }
    this.zones.request({
      id: DiscoveryCard.ID,
      zone: 'corner',
      priority: HUD_PRIORITY.discovery,
      duration: CARD_DURATION_MS / 1000,
      maxWait: MAX_WAIT_S,
      onShow,
      onHide: () => {
        this.binding.onHide();
        if (!this.zones?.has(DiscoveryCard.ID)) {
          this.current = null;
        }
      },
    });
  }

  setDistance(meters: number): void {
    this.distance.set(formatDistance(meters));
  }

  hide(): void {
    this.current = null;
    if (this.zones) {
      this.zones.release(DiscoveryCard.ID);
    } else {
      this.binding.onHide();
    }
  }

  dispose(): void {
    this.zones?.release(DiscoveryCard.ID);
  }
}
