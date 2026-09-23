import { el, TextSlot } from '../dom';
import { formatClock } from '../format';
import { ICONS } from '../icons';
import { dayPhase } from '../labels';

type SkyIcon = 'sun' | 'sunset' | 'moon';

/** Top-left clock chip (time + day phase). */
export class ClockChip {
  readonly root: HTMLElement;
  private readonly time: TextSlot;
  private readonly phase: TextSlot;
  private readonly icon: HTMLElement;
  private iconKind: SkyIcon | null = null;

  constructor() {
    const timeNode = el('span', 'clk-time ejd-num', '00:00');
    const phaseNode = el('span', 'clk-phase', '');
    this.icon = el('span', 'clk-icon');
    this.time = new TextSlot(timeNode);
    this.phase = new TextSlot(phaseNode);
    this.root = el('div', 'hud-clock ejd-glass', [this.icon, timeNode, el('i', 'clk-sep'), phaseNode]);
  }

  update(hours: number, sunElevationDeg: number): void {
    this.time.set(formatClock(hours));
    this.phase.set(dayPhase(sunElevationDeg, hours));
    const kind: SkyIcon = sunElevationDeg < -4 ? 'moon' : sunElevationDeg < 9 ? 'sunset' : 'sun';
    if (kind !== this.iconKind) {
      this.iconKind = kind;
      this.icon.innerHTML = ICONS[kind];
      this.icon.dataset.kind = kind;
    }
  }
}

/** Top-right "Keşfedilen n/N" counter. */
export class DiscoveryCounter {
  readonly root: HTMLElement;
  private readonly value: TextSlot;
  private pulseTimer = 0;

  constructor() {
    const valueNode = el('span', 'dc-val ejd-num', '0/0');
    this.value = new TextSlot(valueNode);
    const icon = el('span', 'dc-icon');
    icon.innerHTML = ICONS.sparkle;
    this.root = el('div', 'hud-discovery ejd-glass', [icon, el('span', 'dc-label', 'Keşfedilen'), valueNode], {
      'aria-live': 'polite',
    });
  }

  set(count: number, total: number, pulse: boolean): void {
    this.value.set(`${count}/${total}`);
    if (pulse) {
      this.root.classList.remove('is-pulse');
      void this.root.offsetWidth;
      this.root.classList.add('is-pulse');
      window.clearTimeout(this.pulseTimer);
      this.pulseTimer = window.setTimeout(() => this.root.classList.remove('is-pulse'), 1600);
    }
  }
}
