import { el, TextSlot } from '../dom';
import { formatDecimal, formatDistance, formatInt } from '../format';
import { FLIGHT_MODE_LABELS } from '../labels';
import type { FlightSnapshot } from '../types';

/** Below this vertical speed (m/s) the altitude line leaves the climb/sink part out. */
const VARIO_DEADBAND = 0.3;

/** Speed (left of the bottom-centre cluster): "133" + "km/sa · süzülme". Plain text, no box. */
export class SpeedReadout {
  private readonly value: TextSlot;
  private readonly sub: TextSlot;
  readonly root: HTMLElement;

  constructor() {
    const valueNode = el('span', 'fr-val ejd-num', '0');
    const subNode = el('span', 'fr-sub', 'km/sa');
    this.value = new TextSlot(valueNode);
    this.sub = new TextSlot(subNode);
    this.root = el('div', 'hud-readout is-speed', [valueNode, subNode]);
  }

  update(s: FlightSnapshot): void {
    this.value.set(formatInt(s.speedKmh));
    const mode = FLIGHT_MODE_LABELS[s.mode] ?? s.mode;
    this.sub.set(`km/sa · ${mode.toLocaleLowerCase('tr-TR')}`);
  }
}

/** Altitude (right of the bottom-centre cluster): "18 m" + "▾ 2,2 m/sn · yerden 20 m". */
export class AltitudeReadout {
  private readonly value: TextSlot;
  private readonly sub: TextSlot;
  readonly root: HTMLElement;

  constructor() {
    const valueNode = el('span', 'fr-val ejd-num', '0');
    const subNode = el('span', 'fr-sub ejd-num', '');
    this.value = new TextSlot(valueNode);
    this.sub = new TextSlot(subNode);
    this.root = el('div', 'hud-readout is-alt', [el('span', 'fr-line', [valueNode, el('span', 'fr-unit', 'm')]), subNode]);
  }

  update(s: FlightSnapshot): void {
    this.value.set(formatInt(Math.max(0, s.altitude)));
    const ground = `yerden ${formatDistance(Math.max(0, s.agl))}`;
    const vs = s.verticalSpeed;
    if (Math.abs(vs) < VARIO_DEADBAND) {
      this.sub.set(ground);
    } else {
      this.sub.set(`${vs > 0 ? '▴' : '▾'} ${formatDecimal(Math.abs(vs))} m/sn · ${ground}`);
    }
  }
}
