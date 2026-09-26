import type { EngineContext, GeoQuery, LandmarkDef } from '../../core/contracts';
import { wrapDeg } from '../format';
import { loadDiscovered, saveDiscovered } from '../prefs';
import { bearingTo, type DiscoveryState, type FlightSnapshot } from '../types';
import { DiscoveryCard } from './discovery-card';

const CHECK_INTERVAL_S = 0.25;
const BASE_RANGE_M = 800;
const FACING_HALF_ANGLE_DEG = 55;
/** A card stays at least this long before another landmark may replace it. */
const MIN_CARD_MS = 5000;

/**
 * Detects when the rider is near (≈800 m) and roughly facing a landmark not yet discovered, records the discovery
 * (event + sound + localStorage) and shows its card once. Landmarks already discovered never show a card again.
 */
export class DiscoveryTracker implements DiscoveryState {
  readonly card = new DiscoveryCard();
  readonly discovered: Set<string> = loadDiscovered();
  total = 0;
  private landmarks: readonly LandmarkDef[] = [];
  private timer = 0;
  private readonly lastShown = new Map<string, number>();
  private readonly scratch = { horizontal: 0, total: 0 };
  private readonly listeners: Array<(isNew: boolean) => void> = [];

  constructor(private readonly ctx: EngineContext) {}

  setGeo(geo: GeoQuery): void {
    this.landmarks = geo.landmarks;
    const valid = new Set(geo.landmarks.map((l) => l.id));
    for (const id of [...this.discovered]) {
      if (!valid.has(id)) {
        this.discovered.delete(id);
      }
    }
    this.total = geo.landmarks.length;
    this.emitChange(false);
  }

  onChange(fn: (isNew: boolean) => void): void {
    this.listeners.push(fn);
  }

  get count(): number {
    return this.discovered.size;
  }

  /** Test/debug: shows the card for a landmark as if the rider reached it. */
  force(id: string, distance = 600): boolean {
    const landmark = this.landmarks.find((l) => l.id === id);
    if (!landmark) {
      return false;
    }
    this.present(landmark, distance);
    return true;
  }

  /**
   * Records a landmark as discovered without its card (perching on it: the perch's own title says it). Emits
   * 'landmark-discovered' like a regular discovery; returns false when it was known already or does not exist.
   */
  markDiscovered(id: string): boolean {
    if (this.discovered.has(id) || !this.landmarks.some((l) => l.id === id)) {
      return false;
    }
    this.discovered.add(id);
    saveDiscovered(this.discovered);
    this.ctx.events.emit('landmark-discovered', { id });
    this.emitChange(true);
    return true;
  }

  reset(): void {
    this.discovered.clear();
    saveDiscovered(this.discovered);
    this.lastShown.clear();
    this.emitChange(false);
  }

  update(s: FlightSnapshot, realDt: number, active: boolean): void {
    this.timer -= realDt;
    if (this.timer > 0 || !s.valid) {
      return;
    }
    this.timer = CHECK_INTERVAL_S;
    const showing = this.card.showing;
    if (showing) {
      const d = this.distanceTo(s, showing);
      this.card.setDistance(Math.max(0, d.horizontal - showing.radius * 0.3));
      if (d.total > this.rangeFor(showing) * 2.2) {
        this.card.hide();
      }
    }
    const shownFor = showing ? performance.now() - (this.lastShown.get(showing.id) ?? 0) : Infinity;
    if (!active || shownFor < MIN_CARD_MS) {
      return;
    }
    let best: LandmarkDef | null = null;
    let bestDistance = Infinity;
    for (const landmark of this.landmarks) {
      if (this.discovered.has(landmark.id)) {
        continue;
      }
      const d = this.distanceTo(s, landmark);
      const range = this.rangeFor(landmark);
      if (d.total > range || d.total >= bestDistance) {
        continue;
      }
      const facing = Math.abs(wrapDeg(bearingTo(s.x, s.z, landmark) - s.viewHeadingDeg)) < FACING_HALF_ANGLE_DEG;
      const onTop = d.horizontal < Math.max(220, landmark.radius * 0.9);
      if (facing || onTop) {
        best = landmark;
        bestDistance = d.total;
      }
    }
    if (!best || best === showing) {
      return;
    }
    this.present(best, Math.max(0, bestDistance - best.radius * 0.3));
  }

  private present(landmark: LandmarkDef, distance: number): void {
    const isNew = !this.discovered.has(landmark.id);
    this.lastShown.set(landmark.id, performance.now());
    if (isNew) {
      this.discovered.add(landmark.id);
      saveDiscovered(this.discovered);
      this.ctx.events.emit('landmark-discovered', { id: landmark.id });
      this.ctx.services.tryGet('audio')?.play('discover');
    }
    this.ctx.events.emit('landmark-near', { id: landmark.id, distance });
    this.card.show(landmark, isNew, distance);
    this.emitChange(isNew);
  }

  private rangeFor(landmark: LandmarkDef): number {
    return BASE_RANGE_M + Math.min(landmark.radius, 500) * 0.6;
  }

  private distanceTo(s: FlightSnapshot, landmark: LandmarkDef): { horizontal: number; total: number } {
    const dx = landmark.x - s.x;
    const dz = landmark.z - s.z;
    const dy = s.y - (landmark.y + landmark.height * 0.5);
    const horizontal = Math.sqrt(dx * dx + dz * dz);
    this.scratch.horizontal = horizontal;
    this.scratch.total = Math.sqrt(horizontal * horizontal + dy * dy);
    return this.scratch;
  }

  private emitChange(isNew: boolean): void {
    for (const fn of this.listeners) {
      fn(isNew);
    }
  }

  dispose(): void {
    this.card.dispose();
  }
}
