import { el } from '../dom';
import type { DiscoveryCard } from '../discovery/discovery-card';
import type { Minimap } from '../map/minimap';
import type { HoverHints, ShotCaption } from '../overlays/hints';
import type { FlightSnapshot } from '../types';
import { HintLineView, HUD_PRIORITY, type HudDirector } from '../zones';
import { AreaTitle } from './area-title';
import { CompassTape } from './compass-tape';
import { AltitudeReadout, SpeedReadout } from './flight-readout';
import { Hotbar } from './hotbar';
import { ManeuverCaption } from './maneuver-caption';
import { StaminaWings } from './stamina-wings';

const TEXT_INTERVAL_S = 1 / 12;
/** The compass landmark label: a persistent low-priority item of the top zone, deferred while racing. */
const COMPASS_LABEL_ID = 'compass.landmark';

/**
 * In-flight HUD, composed by screen zones (src/ui/zones): compass tape and its second line (top), area title (title),
 * the shared hint line, hover hints and captions (lowerCenter), the static bottom-centre cluster (speed · stamina
 * wings + hotbar · altitude), the minimap (bottom right) and the discovery card (corner). Every transient piece asks
 * the zone director for its zone; nothing positions itself. Readouts are plain text with a soft shadow.
 */
export class Hud {
  readonly root: HTMLElement;
  readonly compass = new CompassTape();
  readonly area = new AreaTitle();
  readonly speed = new SpeedReadout();
  readonly altitude = new AltitudeReadout();
  readonly stamina = new StaminaWings();
  readonly hotbar = new Hotbar();
  readonly maneuver: ManeuverCaption;
  private readonly hintLine: HintLineView;
  private textTimer = 0;

  constructor(
    readonly minimap: Minimap,
    card: DiscoveryCard,
    hoverHints: HoverHints,
    shotCaption: ShotCaption,
    private readonly zones: HudDirector,
  ) {
    this.maneuver = new ManeuverCaption(zones);
    this.hintLine = new HintLineView(zones);
    card.setZones(zones);
    this.compass.focus = () => card.showing;
    zones.request({ id: COMPASS_LABEL_ID, zone: 'top', priority: HUD_PRIORITY.startHint, deferIn: ['race'] });
    this.compass.labelAllowed = () => zones.isShown(COMPASS_LABEL_ID);
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
      this.hintLine.root,
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
    this.area.update(s, realDt, this.zones);
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
    this.hintLine.dispose();
    this.zones.release(COMPASS_LABEL_ID);
  }
}
