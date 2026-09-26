import type { LandmarkDef } from '../../core/contracts';
import { el, svg, TextSlot, toggleClass, TransformSlot } from '../dom';
import { formatDistance, formatHeading, wrapDeg } from '../format';
import { shortLandmarkName } from '../labels';
import { bearingTo, type FlightSnapshot } from '../types';

/** 135° across the 500 px tape. */
const PX_PER_DEG = 500 / 135;
const STRIP_FROM_DEG = -90;
const STRIP_TO_DEG = 450;
/** Minor tick every 5.625° (eight per 45°), major tick every 22.5°. */
const TICK_DEG = 45 / 8;
const STRIP_H = 26;
/** y of the tape line inside the strip (the strip sits 8 px above the compass box so letters fit over the line). */
const LINE_Y = 26;
const MARKER_RANGE_M = 7000;
const MARKER_REFRESH_S = 0.25;
/** A new pick must be this much closer than the current one to replace it (no flicker between two landmarks). */
const SWITCH_RATIO = 0.8;
/** Within this many px of the caret the label moves below the heading number instead of beside the diamond. */
const LABEL_CLEAR_PX = 34;
const LABEL_SHIFT = { right: 'translateX(8px)', left: 'translateX(calc(-100% - 8px))', below: 'translateX(-50%)' } as const;
const CARDINAL_NAMES: Record<number, string> = { 0: 'K', 45: 'KD', 90: 'D', 135: 'GD', 180: 'G', 225: 'GB', 270: 'B', 315: 'KB' };

function buildStripSvg(): string {
  const width = (STRIP_TO_DEG - STRIP_FROM_DEG) * PX_PER_DEG;
  const parts: string[] = [];
  const steps = Math.round((STRIP_TO_DEG - STRIP_FROM_DEG) / TICK_DEG);
  for (let i = 0; i <= steps; i++) {
    const d = STRIP_FROM_DEG + i * TICK_DEG;
    const n = ((d % 360) + 360) % 360;
    const x = ((d - STRIP_FROM_DEG) * PX_PER_DEG).toFixed(1);
    const cardinal = Math.abs(n % 45) < 1e-6;
    const major = cardinal || Math.abs(n % 22.5) < 1e-6;
    if (cardinal) {
      const name = CARDINAL_NAMES[Math.round(n) % 360];
      const fill = n === 0 ? '#e8b872' : 'rgba(246,241,231,0.75)';
      parts.push(`<text x="${x}" y="12" text-anchor="middle" fill="${fill}" font-size="12" font-weight="700">${name}</text>`);
    } else {
      const len = major ? 8 : 4;
      parts.push(`<line x1="${x}" x2="${x}" y1="${LINE_Y}" y2="${LINE_Y - len}" stroke="rgba(246,241,231,0.7)" stroke-width="1"/>`);
    }
  }
  return `<svg class="cmp-strip-svg" viewBox="0 0 ${width.toFixed(1)} ${STRIP_H}" width="${width.toFixed(1)}" height="${STRIP_H}" font-family="system-ui, -apple-system, sans-serif" aria-hidden="true">${parts.join('')}</svg>`;
}

/**
 * Bare heading tape at the top centre: a thin line, ticks fading to the ends, Turkish cardinal letters, a gold caret
 * and the heading under it. The targeted landmark (the discovery card's, else the nearest one ahead) shows as a gold
 * diamond on the tape with one line "Name · 1,2 km". The label is the top zone's second line: it shows only while the
 * zone director grants it (`labelAllowed`); a race takes that line for its readout and hides marker and label.
 */
export class CompassTape {
  readonly root: HTMLElement;
  /** The landmark the player is aiming for right now, when there is one (the discovery card's). */
  focus: (() => LandmarkDef | null) | null = null;
  /** The top zone's second line is ours right now (the zone director shows the 'compass.landmark' item). */
  labelAllowed: () => boolean = () => true;
  private readonly strip: TransformSlot;
  private readonly readout: TextSlot;
  private readonly marker: HTMLElement;
  private readonly markerMove: TransformSlot;
  private readonly label: HTMLElement;
  private readonly labelText: TextSlot;
  private readonly labelMove: TransformSlot;
  private width = 500;
  private refreshTimer = 0;
  private landmarks: readonly LandmarkDef[] = [];
  private discovered: ReadonlySet<string> = new Set();
  private target: LandmarkDef | null = null;
  private targetDistance = 0;
  private markerShown = false;
  private labelSide: keyof typeof LABEL_SHIFT | '' = '';

  constructor() {
    const stripNode = el('div', 'cmp-strip');
    stripNode.append(svg(buildStripSvg()));
    this.strip = new TransformSlot(stripNode);
    const readoutNode = el('span', 'cmp-heading ejd-num', '000°');
    this.readout = new TextSlot(readoutNode);
    this.marker = el('i', 'cmp-mk');
    this.marker.hidden = true;
    this.markerMove = new TransformSlot(this.marker);
    this.label = el('span', 'cmp-mk-label ejd-num');
    this.label.hidden = true;
    this.labelText = new TextSlot(this.label);
    this.labelMove = new TransformSlot(this.label);
    this.root = el('div', 'hud-compass', [
      el('i', 'cmp-line'),
      el('div', 'cmp-window', [stripNode]),
      el('i', 'cmp-caret'),
      readoutNode,
      el('div', 'cmp-anchor', [this.marker, this.label]),
    ]);
  }

  setLandmarks(landmarks: readonly LandmarkDef[], discovered: ReadonlySet<string>): void {
    this.landmarks = landmarks;
    this.discovered = discovered;
    this.refreshTimer = 0;
  }

  measure(): void {
    const w = this.root.clientWidth;
    if (w > 0) {
      this.width = w;
    }
  }

  /** Called every frame: transforms only (compositor-friendly). Text and the landmark pick refresh at 4 Hz. */
  update(snapshot: FlightSnapshot, dt: number): void {
    const heading = ((snapshot.viewHeadingDeg % 360) + 360) % 360;
    const offset = this.width / 2 - (heading - STRIP_FROM_DEG) * PX_PER_DEG;
    this.strip.set(`translate3d(${offset.toFixed(1)}px,0,0)`);

    this.refreshTimer -= dt;
    const refresh = this.refreshTimer <= 0;
    if (refresh) {
      this.refreshTimer = MARKER_REFRESH_S;
      this.readout.set(formatHeading(heading));
      this.pickTarget(snapshot, heading);
    }
    this.placeMarker(snapshot, heading, refresh);
  }

  private halfRangeDeg(): number {
    return this.width / 2 / PX_PER_DEG - 6;
  }

  private visible(snapshot: FlightSnapshot, heading: number, landmark: LandmarkDef): boolean {
    return Math.abs(wrapDeg(bearingTo(snapshot.x, snapshot.z, landmark) - heading)) < this.halfRangeDeg();
  }

  private pickTarget(snapshot: FlightSnapshot, heading: number): void {
    const focused = this.focus?.() ?? null;
    let best: LandmarkDef | null = null;
    let bestDistance = Infinity;
    let bestUnknown = false;
    let currentDistance = Infinity;
    for (const landmark of this.landmarks) {
      const dx = landmark.x - snapshot.x;
      const dz = landmark.z - snapshot.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance > MARKER_RANGE_M || distance < Math.max(60, landmark.radius * 0.6) || !this.visible(snapshot, heading, landmark)) {
        continue;
      }
      if (landmark === this.target) {
        currentDistance = distance;
      }
      if (landmark === focused) {
        best = landmark;
        bestDistance = distance;
        bestUnknown = true;
        break;
      }
      // Undiscovered landmarks win over known ones; otherwise the nearest.
      const unknown = !this.discovered.has(landmark.id);
      if ((unknown && !bestUnknown) || (unknown === bestUnknown && distance < bestDistance)) {
        best = landmark;
        bestDistance = distance;
        bestUnknown = unknown;
      }
    }
    const current = this.target;
    if (current && best !== focused && currentDistance < Infinity) {
      const currentUnknown = !this.discovered.has(current.id);
      if (currentUnknown === bestUnknown && bestDistance > currentDistance * SWITCH_RATIO) {
        best = current;
        bestDistance = currentDistance;
      }
    }
    if (best !== this.target) {
      this.target = best;
      this.labelSide = '';
    }
    this.targetDistance = bestDistance;
    if (best) {
      this.labelText.set(`${shortLandmarkName(best)} · ${formatDistance(bestDistance)}`);
      toggleClass(this.marker, 'is-known', this.discovered.has(best.id));
    }
  }

  private placeMarker(snapshot: FlightSnapshot, heading: number, relayout: boolean): void {
    const target = this.target;
    let shown = false;
    if (target && this.labelAllowed()) {
      const delta = wrapDeg(bearingTo(snapshot.x, snapshot.z, target) - heading);
      if (Math.abs(delta) < this.halfRangeDeg()) {
        shown = true;
        const x = delta * PX_PER_DEG;
        this.markerMove.set(`translate3d(${x.toFixed(1)}px,0,0) rotate(45deg)`);
        if (relayout) {
          // Beside the diamond on the heading row, away from the centre; right under the caret it drops a row.
          const side = Math.abs(x) < LABEL_CLEAR_PX ? 'below' : x > 0 ? 'right' : 'left';
          if (side !== this.labelSide) {
            this.labelSide = side;
            this.label.dataset.side = side;
          }
        }
        this.labelMove.set(`translate3d(${x.toFixed(1)}px,0,0) ${LABEL_SHIFT[this.labelSide || 'right']}`);
        if (relayout) {
          const fade = 1 - Math.max(0, (this.targetDistance - 3000) / (MARKER_RANGE_M - 3000)) * 0.45;
          this.marker.style.opacity = fade.toFixed(2);
        }
      }
    }
    if (shown !== this.markerShown) {
      this.markerShown = shown;
      this.marker.hidden = !shown;
      this.label.hidden = !shown;
    }
  }
}
