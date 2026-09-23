import type { CameraMode, FlightMode } from '../../core/contracts';
import { el, TextSlot, toggleClass, TransformSlot } from '../dom';
import { formatDistance, formatInt, formatSigned } from '../format';
import { CAMERA_MODE_SHORT, FLIGHT_MODE_LABELS } from '../labels';
import type { FlightSnapshot } from '../types';

const percentFormat = new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: 0 });
const MODE_TONE: Partial<Record<FlightMode, string>> = {
  stalling: 'is-warn',
  diving: 'is-accent',
  hovering: 'is-accent',
  grounded: 'is-muted',
  swimming: 'is-muted',
};

interface Cell {
  root: HTMLElement;
  value: TextSlot;
  sub: TextSlot | null;
}

function cell(label: string, unit: string, withSub: boolean, extraClass = ''): Cell & { subNode: HTMLElement | null } {
  const valueNode = el('span', 'inst-val ejd-num', '0');
  const subNode = withSub ? el('span', 'inst-sub ejd-num', '') : null;
  const root = el('div', `inst-cell ${extraClass}`.trim(), [
    el('span', 'ejd-caps inst-caps', label),
    el('span', 'inst-read', [valueNode, unit ? el('span', 'inst-unit', unit) : null]),
    subNode,
  ]);
  return { root, value: new TextSlot(valueNode), sub: subNode ? new TextSlot(subNode) : null, subNode };
}

/** Bottom-left flight instruments: stamina, airspeed, altitude (MSL + AGL), vertical speed, flight and camera mode. */
export class Instruments {
  readonly root: HTMLElement;
  private readonly speed = cell('Hız', 'km/sa', false, 'inst-speed');
  private readonly altitude = cell('İrtifa', 'm', true, 'inst-alt');
  private readonly vario = cell('Dikey', 'm/sn', false, 'inst-vario');
  private readonly staminaValue: TextSlot;
  private readonly staminaFill: TransformSlot;
  private readonly staminaCell: HTMLElement;
  private readonly modeChip: HTMLElement;
  private readonly modeText: TextSlot;
  private readonly cameraText: TextSlot;
  private readonly varioArrow: HTMLElement;
  private lastMode: FlightMode | null = null;
  private lastStaminaPct = -1;

  constructor() {
    const staminaValueNode = el('span', 'inst-val ejd-num', '%100');
    const fill = el('div', 'inst-bar-fill');
    this.staminaValue = new TextSlot(staminaValueNode);
    this.staminaFill = new TransformSlot(fill);
    this.staminaCell = el('div', 'inst-cell inst-stamina', [
      el('span', 'ejd-caps inst-caps', 'Güç'),
      el('span', 'inst-read', [staminaValueNode]),
      el('div', 'inst-bar', [fill]),
    ]);
    this.varioArrow = el('i', 'inst-vario-arrow');
    this.vario.root.querySelector('.inst-read')?.prepend(this.varioArrow);

    const modeTextNode = el('span', undefined, FLIGHT_MODE_LABELS.flying);
    this.modeText = new TextSlot(modeTextNode);
    this.modeChip = el('span', 'hud-chip chip-mode', [el('i', 'chip-dot'), modeTextNode]);
    const cameraNode = el('span', undefined, CAMERA_MODE_SHORT.third);
    this.cameraText = new TextSlot(cameraNode);
    const cameraChip = el('span', 'hud-chip chip-camera', [el('span', 'chip-caps', 'Kamera'), cameraNode, el('kbd', undefined, 'C')]);

    this.root = el('div', 'hud-inst', [
      el('div', 'hud-chips', [this.modeChip, cameraChip]),
      el('div', 'inst-panel ejd-glass', [this.speed.root, this.altitude.root, this.vario.root, this.staminaCell]),
    ]);
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraText.set(CAMERA_MODE_SHORT[mode] ?? mode);
  }

  /** Text refresh (throttled by the caller). */
  update(s: FlightSnapshot): void {
    this.speed.value.set(formatInt(s.speedKmh));
    this.altitude.value.set(formatInt(Math.max(0, s.altitude)));
    this.altitude.sub?.set(`Yerden ${formatDistance(Math.max(0, s.agl))}`);
    const vs = Math.abs(s.verticalSpeed) < 0.05 ? 0 : s.verticalSpeed;
    this.vario.value.set(formatSigned(vs));
    toggleClass(this.varioArrow, 'is-up', vs > 0.4);
    toggleClass(this.varioArrow, 'is-down', vs < -0.4);

    const pct = Math.round(Math.min(1, Math.max(0, s.stamina)) * 100);
    if (pct !== this.lastStaminaPct) {
      this.lastStaminaPct = pct;
      this.staminaValue.set(percentFormat.format(pct / 100));
      this.staminaFill.set(`scaleX(${(pct / 100).toFixed(2)})`);
      toggleClass(this.staminaCell, 'is-low', pct < 25);
      toggleClass(this.staminaCell, 'is-critical', pct < 10);
    }

    if (s.mode !== this.lastMode) {
      const previous = this.lastMode ? MODE_TONE[this.lastMode] : undefined;
      if (previous) {
        this.modeChip.classList.remove(previous);
      }
      const tone = MODE_TONE[s.mode];
      if (tone) {
        this.modeChip.classList.add(tone);
      }
      this.lastMode = s.mode;
      this.modeText.set(FLIGHT_MODE_LABELS[s.mode] ?? s.mode);
    }
  }
}
