import { el } from '../dom';
import type { DiscoveryCard } from '../discovery/discovery-card';
import type { Minimap } from '../map/minimap';
import type { FlightHints, HoverHints, ShotCaption } from '../overlays/hints';
import type { FlightSnapshot } from '../types';
import { AreaTitle } from './area-title';
import { CompassTape } from './compass-tape';
import { AltitudeReadout, SpeedReadout } from './flight-readout';
import { Hotbar } from './hotbar';
import { ManeuverCaption } from './maneuver-caption';
import { StaminaWings } from './stamina-wings';

const TEXT_INTERVAL_S = 1 / 12;

/**
 * In-flight HUD: compass tape (top centre), area title (upper third), the bottom-centre cluster (speed · stamina
 * wings + hotbar · altitude), the minimap (bottom right), plus the discovery card, key hints and captions. Readouts
 * are plain text with a soft shadow; nothing sits in a box.
 */
export class Hud {
  readonly root: HTMLElement;
  readonly compass = new CompassTape();
  readonly area = new AreaTitle();
  readonly speed = new SpeedReadout();
  readonly altitude = new AltitudeReadout();
  readonly stamina = new StaminaWings();
  readonly hotbar = new Hotbar();
  readonly maneuver = new ManeuverCaption();
  private textTimer = 0;

  constructor(
    readonly minimap: Minimap,
    card: DiscoveryCard,
    hints: FlightHints,
    hoverHints: HoverHints,
    shotCaption: ShotCaption,
  ) {
    this.compass.focus = () => card.showing;
    this.root = el('div', 'ejd-hud', [
      this.compass.root,
      this.area.root,
      el('div', 'hud-cluster', [
        this.speed.root,
        el('div', 'hud-cluster-mid', [this.stamina.root, this.hotbar.root]),
        this.altitude.root,
      ]),
      this.minimap.root,
      card.root,
      hints.root,
      hoverHints.root,
      this.maneuver.root,
      shotCaption.root,
    ]);
  }

  measure(): void {
    this.compass.measure();
    this.minimap.measure();
  }

  /** Every frame: transforms, the minimap canvas and the hotbar's dirty slots; text at 12 Hz. */
  update(s: FlightSnapshot, realDt: number): void {
    this.compass.update(s, realDt);
    this.minimap.update(s, realDt);
    this.stamina.update(s.stamina, realDt);
    this.hotbar.render();
    this.area.update(s, realDt);
    this.textTimer -= realDt;
    if (this.textTimer > 0) {
      return;
    }
    this.textTimer = TEXT_INTERVAL_S;
    this.speed.update(s);
    this.altitude.update(s);
  }

  dispose(): void {
    this.hotbar.dispose();
    this.area.dispose();
  }
}
