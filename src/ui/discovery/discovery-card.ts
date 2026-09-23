import type { LandmarkDef } from '../../core/contracts';
import { el, TextSlot } from '../dom';
import { formatDistance, formatYear } from '../format';
import { LANDMARK_KIND_LABELS } from '../labels';

export const CARD_DURATION_MS = 9000;

/** Lower-third card shown when approaching a landmark. */
export class DiscoveryCard {
  readonly root: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly meta: TextSlot;
  private readonly title: TextSlot;
  private readonly info: TextSlot;
  private readonly count: TextSlot;
  private readonly distance: TextSlot;
  private readonly timer: HTMLElement;
  private current: LandmarkDef | null = null;
  private hideTimer = 0;

  constructor() {
    this.badge = el('span', 'dcard-badge', 'Yeni keşif');
    const metaNode = el('span', 'dcard-meta ejd-caps');
    const titleNode = el('h3', 'dcard-title');
    const infoNode = el('p', 'dcard-info');
    const countNode = el('span', 'dcard-count ejd-num');
    const distNode = el('span', 'dcard-dist ejd-num');
    this.meta = new TextSlot(metaNode);
    this.title = new TextSlot(titleNode);
    this.info = new TextSlot(infoNode);
    this.count = new TextSlot(countNode);
    this.distance = new TextSlot(distNode);
    this.timer = el('i', 'dcard-timer');
    this.root = el('aside', 'hud-dcard ejd-glass ejd-fade is-out', [
      el('div', 'dcard-top', [this.badge, metaNode]),
      titleNode,
      infoNode,
      el('div', 'dcard-foot', [countNode, distNode]),
      this.timer,
    ], { 'aria-live': 'polite' });
  }

  get showing(): LandmarkDef | null {
    return this.current;
  }

  show(landmark: LandmarkDef, isNew: boolean, discovered: number, total: number, distance: number): void {
    this.current = landmark;
    this.badge.hidden = !isNew;
    const kind = LANDMARK_KIND_LABELS[landmark.kind];
    this.meta.set(landmark.year !== undefined ? `${kind} · ${formatYear(landmark.year)}` : kind);
    this.title.set(landmark.name);
    this.info.set(landmark.info);
    this.count.set(`Keşfedilen ${discovered}/${total}`);
    this.setDistance(distance);
    this.root.classList.toggle('is-new', isNew);
    this.root.classList.remove('is-out');
    this.timer.classList.remove('is-running');
    void this.timer.offsetWidth;
    this.timer.classList.add('is-running');
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), CARD_DURATION_MS);
  }

  setDistance(meters: number): void {
    this.distance.set(formatDistance(meters));
  }

  hide(): void {
    window.clearTimeout(this.hideTimer);
    this.current = null;
    this.root.classList.add('is-out');
  }

  dispose(): void {
    window.clearTimeout(this.hideTimer);
  }
}
