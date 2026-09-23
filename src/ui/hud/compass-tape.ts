import type { LandmarkDef } from '../../core/contracts';
import { el, svg, TextSlot, toggleClass, TransformSlot } from '../dom';
import { cardinal, formatDistance, wrapDeg } from '../format';
import { shortLandmarkName } from '../labels';
import { bearingTo, type FlightSnapshot } from '../types';

const PX_PER_DEG = 4.4;
const STRIP_FROM_DEG = -90;
const STRIP_TO_DEG = 450;
const MARKER_POOL = 6;
const MARKER_RANGE_M = 7000;
const MARKER_REFRESH_S = 0.25;
const LABEL_GAP_PX = 10;
const CARDINAL_NAMES: Record<number, string> = { 0: 'K', 45: 'KD', 90: 'D', 135: 'GD', 180: 'G', 225: 'GB', 270: 'B', 315: 'KB' };

interface Marker {
  root: HTMLElement;
  label: HTMLElement;
  name: TextSlot;
  dist: TextSlot;
  transform: TransformSlot;
  landmark: LandmarkDef | null;
  bearing: number;
  distance: number;
  labelWidth: number;
  visible: boolean;
}

function buildStripSvg(): string {
  const width = (STRIP_TO_DEG - STRIP_FROM_DEG) * PX_PER_DEG;
  const height = 34;
  const parts: string[] = [];
  for (let d = STRIP_FROM_DEG; d <= STRIP_TO_DEG; d += 5) {
    const n = ((d % 360) + 360) % 360;
    const x = ((d - STRIP_FROM_DEG) * PX_PER_DEG).toFixed(1);
    const major = n % 45 === 0;
    const mid = n % 15 === 0;
    const tick = major ? 9 : mid ? 7 : 4;
    const opacity = major ? 0.8 : mid ? 0.55 : 0.34;
    parts.push(`<line x1="${x}" x2="${x}" y1="${height}" y2="${height - tick}" stroke="#f3eee5" stroke-opacity="${opacity}" stroke-width="${major ? 1.4 : 1}"/>`);
    if (major) {
      const name = CARDINAL_NAMES[n];
      const primary = n % 90 === 0;
      const fill = n === 0 ? '#e8b872' : '#f3eee5';
      parts.push(
        `<text x="${x}" y="17" text-anchor="middle" fill="${fill}" fill-opacity="${primary ? 0.96 : 0.72}" font-size="${primary ? 12.5 : 10.5}" font-weight="${primary ? 650 : 600}" letter-spacing="0.04em">${name}</text>`,
      );
    } else if (mid) {
      parts.push(`<text x="${x}" y="16.5" text-anchor="middle" fill="#f3eee5" fill-opacity="0.62" font-size="10" font-weight="500">${n}</text>`);
    }
  }
  return `<svg class="cmp-strip-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, -apple-system, sans-serif" aria-hidden="true">${parts.join('')}</svg>`;
}

/** Heading tape at the top of the screen with markers for nearby landmarks. */
export class CompassTape {
  readonly root: HTMLElement;
  private readonly strip: TransformSlot;
  private readonly readout: TextSlot;
  private readonly readoutCardinal: TextSlot;
  private readonly markers: Marker[] = [];
  private width = 520;
  private refreshTimer = 0;
  private landmarks: readonly LandmarkDef[] = [];
  private discovered: ReadonlySet<string> = new Set();
  private readonly candidates: Array<{ landmark: LandmarkDef; distance: number }> = [];

  constructor() {
    const stripNode = el('div', 'cmp-strip');
    stripNode.append(svg(buildStripSvg()));
    this.strip = new TransformSlot(stripNode);
    const readoutValue = el('span', 'cmp-readout-val ejd-num', '000°');
    const readoutCard = el('span', 'cmp-readout-card', 'K');
    this.readout = new TextSlot(readoutValue);
    this.readoutCardinal = new TextSlot(readoutCard);
    const markerLayer = el('div', 'cmp-markers');
    for (let i = 0; i < MARKER_POOL; i++) {
      const nameNode = el('span', 'cmp-mk-name');
      const distNode = el('span', 'cmp-mk-dist ejd-num');
      const label = el('span', 'cmp-mk-label', [nameNode, distNode]);
      const root = el('div', 'cmp-mk', [el('i', 'cmp-mk-dia'), label]);
      root.hidden = true;
      markerLayer.append(root);
      this.markers.push({
        root,
        label,
        name: new TextSlot(nameNode),
        dist: new TextSlot(distNode),
        transform: new TransformSlot(root),
        landmark: null,
        bearing: 0,
        distance: 0,
        labelWidth: 0,
        visible: false,
      });
    }
    this.root = el('div', 'hud-compass', [
      el('div', 'cmp-tape ejd-glass', [el('div', 'cmp-window', [stripNode]), el('div', 'cmp-readout', [readoutValue, readoutCard])]),
      markerLayer,
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

  /** Called every frame: transforms only (compositor-friendly). Text/marker sets refresh at 4 Hz. */
  update(snapshot: FlightSnapshot, dt: number): void {
    const heading = ((snapshot.viewHeadingDeg % 360) + 360) % 360;
    const offset = this.width / 2 - (heading - STRIP_FROM_DEG) * PX_PER_DEG;
    this.strip.set(`translate3d(${offset.toFixed(1)}px,0,0)`);

    this.refreshTimer -= dt;
    const refresh = this.refreshTimer <= 0;
    if (refresh) {
      this.refreshTimer = MARKER_REFRESH_S;
      const rounded = Math.round(heading) % 360;
      this.readout.set(`${rounded.toString().padStart(3, '0')}°`);
      this.readoutCardinal.set(cardinal(heading));
      this.pickMarkers(snapshot);
    }
    this.positionMarkers(snapshot, heading, refresh);
  }

  private pickMarkers(snapshot: FlightSnapshot): void {
    const candidates = this.candidates;
    candidates.length = 0;
    for (const landmark of this.landmarks) {
      const dx = landmark.x - snapshot.x;
      const dz = landmark.z - snapshot.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance < MARKER_RANGE_M && distance > Math.max(60, landmark.radius * 0.6)) {
        candidates.push({ landmark, distance });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    for (let i = 0; i < this.markers.length; i++) {
      const marker = this.markers[i];
      const candidate = candidates[i];
      if (!candidate) {
        marker.landmark = null;
        continue;
      }
      if (marker.landmark !== candidate.landmark) {
        marker.landmark = candidate.landmark;
        const name = shortLandmarkName(candidate.landmark);
        marker.name.set(name);
        marker.labelWidth = name.length * 6.4 + 52;
      }
      marker.distance = candidate.distance;
      marker.dist.set(formatDistance(candidate.distance));
      toggleClass(marker.root, 'is-known', this.discovered.has(candidate.landmark.id));
    }
  }

  private positionMarkers(snapshot: FlightSnapshot, heading: number, relayout: boolean): void {
    const halfRange = this.width / 2 / PX_PER_DEG - 5;
    const placed: number[] = [];
    for (const marker of this.markers) {
      const landmark = marker.landmark;
      let visible = false;
      if (landmark) {
        marker.bearing = bearingTo(snapshot.x, snapshot.z, landmark);
        const delta = wrapDeg(marker.bearing - heading);
        if (Math.abs(delta) < halfRange) {
          visible = true;
          const x = delta * PX_PER_DEG;
          marker.transform.set(`translate3d(${x.toFixed(1)}px,0,0)`);
          if (relayout) {
            let free = true;
            for (let i = 0; i < placed.length; i += 2) {
              if (Math.abs(placed[i] - x) < (placed[i + 1] + marker.labelWidth) / 2 + LABEL_GAP_PX) {
                free = false;
                break;
              }
            }
            if (free) {
              placed.push(x, marker.labelWidth);
            }
            toggleClass(marker.label, 'is-hidden', !free);
            const fade = 1 - Math.max(0, (marker.distance - 3000) / (MARKER_RANGE_M - 3000)) * 0.55;
            marker.root.style.opacity = fade.toFixed(2);
          }
        }
      }
      if (visible !== marker.visible) {
        marker.visible = visible;
        marker.root.hidden = !visible;
      }
    }
  }
}
