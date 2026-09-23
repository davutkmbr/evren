import { el } from '../dom';
import type { DiscoveryCard } from '../discovery/discovery-card';
import type { Minimap } from '../map/minimap';
import type { FlightHints, HoverHints, ShotCaption } from '../overlays/hints';
import type { FlightSnapshot } from '../types';
import { CompassTape } from './compass-tape';
import { Instruments } from './instruments';
import { ClockChip, DiscoveryCounter } from './status';

const TEXT_INTERVAL_S = 1 / 12;

/** In-flight HUD: compass, clock, discovery counter, instruments, minimap, discovery card and key hints. */
export class Hud {
  readonly root: HTMLElement;
  readonly compass = new CompassTape();
  readonly clock = new ClockChip();
  readonly counter = new DiscoveryCounter();
  readonly instruments = new Instruments();
  private textTimer = 0;

  constructor(
    readonly minimap: Minimap,
    card: DiscoveryCard,
    hints: FlightHints,
    hoverHints: HoverHints,
    shotCaption: ShotCaption,
  ) {
    this.root = el('div', 'ejd-hud', [
      this.compass.root,
      this.clock.root,
      this.counter.root,
      this.instruments.root,
      this.minimap.root,
      card.root,
      hints.root,
      hoverHints.root,
      shotCaption.root,
    ]);
  }

  measure(): void {
    this.compass.measure();
    this.minimap.measure();
  }

  /** Every frame: transforms and the minimap canvas; text at 12 Hz. */
  update(s: FlightSnapshot, realDt: number, hours: number, sunElevationDeg: number): void {
    this.compass.update(s, realDt);
    this.minimap.update(s, realDt);
    this.textTimer -= realDt;
    if (this.textTimer > 0) {
      return;
    }
    this.textTimer = TEXT_INTERVAL_S;
    this.instruments.update(s);
    this.clock.update(hours, sunElevationDeg);
  }
}
