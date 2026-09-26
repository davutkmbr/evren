/**
 * HUD zone director (pure TS, no DOM): the one place that decides which transient HUD message is on screen.
 *
 * Every message asks for a zone with a priority and a duration (HudZoneRequest). Per zone the highest priority item
 * that is not deferred by an active context is shown; the rest wait. An item that waited longer than its `maxWait`
 * (queued, displaced or deferred) is dropped as stale. Between two items the zone stays empty for a short gap so the
 * old one fades out before the new one fades in. One item per zone, with a single exception: the lowerCenter hint
 * line, where `joinable` hints ride along on the showing hint line (one row, one component).
 *
 * The DOM side reacts through the items' onShow / onHide callbacks and the change listeners (src/ui/zones/view.ts).
 * Timing only advances in update(dt), so the logic is deterministic and checked headless (tools/headless).
 */
import type { HudZoneId, HudZoneRequest, HudZonesService } from '../../core/contracts';

/** Priorities, highest first (the table in .docs/design/README.md, section 3). */
export const HUD_PRIORITY = {
  /** Race countdown / "Başla!" / course intro, the running race readout and the race's own hint line. */
  raceCountdown: 100,
  /** Race warnings (missed gate, wrong way, straying, landing, abort reason). */
  raceWarning: 90,
  /** Brief race callouts ("+10 m/s" from a speed ring). */
  raceCallout: 85,
  discovery: 70,
  areaTitle: 60,
  maneuver: 50,
  /** A moment's subtitle line (src/moments): yields to maneuver captions, outranks flight and start hints. */
  momentLine: 45,
  /** Perching (phase 03): the "[L] Kon" prompt, the approach and viewing-mode hint lines. */
  perch: 45,
  /** Contextual flight hints (hover controls, the cinematic shot caption). */
  flightHint: 40,
  /** "[I] Kaynağa bak" for a few seconds after a moment (src/moments/source-prompt.ts): quiet, joinable. */
  momentSource: 35,
  /** Start-of-game key hints and the compass landmark label. */
  startHint: 30,
  toast: 10,
} as const;

/** Seconds a zone stays empty between two items (the fade out of the old one). */
export const ZONE_FADE_GAP_S = 0.26;

export const HUD_ZONES: readonly HudZoneId[] = ['top', 'title', 'lowerCenter', 'corner', 'toast'];

export type HintItem = readonly [keys: string, label: string];

/** What the shared hint line shows right now. */
export interface HintLineState {
  /** Id of the item that owns the line. */
  id: string;
  caption: string;
  hints: HintItem[];
}

interface Item {
  req: HudZoneRequest;
  seq: number;
  /** Seconds left on screen. */
  remaining: number;
  /** Seconds waited unshown since the request or the last time it was on screen. */
  waited: number;
  shown: boolean;
  /** Riding along on another item's hint line. */
  riding: boolean;
}

interface ZoneState {
  current: Item | null;
  riders: Item[];
  gap: number;
}

export class HudDirector implements HudZonesService {
  private readonly items = new Map<string, Item>();
  private readonly zones = new Map<HudZoneId, ZoneState>();
  private readonly contexts = new Set<string>();
  private readonly listeners = new Set<(zone: HudZoneId) => void>();
  private seq = 0;

  constructor() {
    for (const z of HUD_ZONES) {
      this.zones.set(z, { current: null, riders: [], gap: 0 });
    }
  }

  request(req: HudZoneRequest): void {
    const existing = this.items.get(req.id);
    if (existing && existing.req.zone !== req.zone) {
      this.release(req.id);
    }
    const live = this.items.get(req.id);
    const duration = req.duration ?? Infinity;
    if (live) {
      live.req = req;
      live.seq = ++this.seq;
      live.remaining = duration;
      live.waited = 0;
      if (live.shown) {
        // Updated in place while on screen: the owner refreshes its content.
        req.onShow?.();
        this.emit(req.zone);
      }
      return;
    }
    this.items.set(req.id, { req, seq: ++this.seq, remaining: duration, waited: 0, shown: false, riding: false });
  }

  release(id: string): void {
    const item = this.items.get(id);
    if (!item) {
      return;
    }
    this.items.delete(id);
    const zone = this.zones.get(item.req.zone)!;
    if (zone.current === item) {
      this.hideCurrent(zone, item.req.zone);
    } else if (item.riding) {
      zone.riders = zone.riders.filter((r) => r !== item);
      this.hideItem(item);
      this.emit(item.req.zone);
    }
  }

  setContext(name: string, on: boolean): void {
    if (on) {
      this.contexts.add(name);
    } else {
      this.contexts.delete(name);
    }
  }

  hasContext(name: string): boolean {
    return this.contexts.has(name);
  }

  isShown(id: string): boolean {
    return this.items.get(id)?.shown ?? false;
  }

  /** Is the item still requested (shown or waiting)? */
  has(id: string): boolean {
    return this.items.has(id);
  }

  /** Id of the item that owns the zone right now ('' when empty). */
  shownIn(zone: HudZoneId): string {
    return this.zones.get(zone)!.current?.req.id ?? '';
  }

  /** The shared hint line (lowerCenter), or null when the zone shows no hint item. */
  hintLine(): HintLineState | null {
    const zone = this.zones.get('lowerCenter')!;
    const cur = zone.current;
    if (!cur || (!cur.req.hints && !cur.req.caption)) {
      return null;
    }
    const hints: HintItem[] = [...(cur.req.hints ?? [])];
    for (const r of zone.riders) {
      hints.push(...(r.req.hints ?? []));
    }
    return { id: cur.req.id, caption: cur.req.caption ?? '', hints };
  }

  /** Listens for changes of what a zone shows (the hint line view re-renders on 'lowerCenter'). */
  onChange(fn: (zone: HudZoneId) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Advances durations, waits and fade gaps by `dt` seconds and settles every zone. */
  update(dt: number): void {
    // Age: shown items spend their duration, waiting ones their patience.
    for (const item of [...this.items.values()]) {
      if (item.shown) {
        item.remaining -= dt;
        if (item.remaining <= 0) {
          this.release(item.req.id);
        }
      } else {
        item.waited += dt;
        if (item.waited > (item.req.maxWait ?? Infinity)) {
          this.items.delete(item.req.id);
        }
      }
    }
    for (const [id, zone] of this.zones) {
      if (zone.gap > 0) {
        zone.gap = Math.max(0, zone.gap - dt);
      }
      this.settle(id, zone);
    }
  }

  private deferred(item: Item): boolean {
    const d = item.req.deferIn;
    return !!d && d.some((c) => this.contexts.has(c));
  }

  private better(a: Item, b: Item): boolean {
    return a.req.priority !== b.req.priority ? a.req.priority > b.req.priority : a.seq > b.seq;
  }

  private settle(id: HudZoneId, zone: ZoneState): void {
    let winner: Item | null = null;
    for (const item of this.items.values()) {
      if (item.req.zone === id && !this.deferred(item) && (!winner || this.better(item, winner))) {
        winner = item;
      }
    }
    if (winner !== zone.current) {
      if (zone.current) {
        this.hideCurrent(zone, id);
      }
      if (winner && zone.gap <= 0) {
        zone.current = winner;
        winner.riding = false;
        zone.riders = zone.riders.filter((r) => r !== winner);
        winner.shown = true;
        winner.req.onShow?.();
        this.emit(id);
      }
    }
    if (id === 'lowerCenter') {
      this.settleRiders(zone);
    }
  }

  /** Joinable hint items ride along on a showing hint line of higher priority. */
  private settleRiders(zone: ZoneState): void {
    const cur = zone.current;
    const next: Item[] = [];
    if (cur && (cur.req.hints || cur.req.caption)) {
      for (const item of this.items.values()) {
        if (item !== cur && item.req.zone === 'lowerCenter' && item.req.joinable && item.req.hints && !this.deferred(item) && this.better(cur, item)) {
          next.push(item);
        }
      }
      next.sort((a, b) => (this.better(a, b) ? -1 : 1));
    }
    const changed = next.length !== zone.riders.length || next.some((r, i) => zone.riders[i] !== r);
    if (!changed) {
      return;
    }
    for (const r of zone.riders) {
      if (!next.includes(r)) {
        this.hideItem(r);
      }
    }
    for (const r of next) {
      if (!r.riding) {
        r.riding = true;
        r.shown = true;
        r.req.onShow?.();
      }
    }
    zone.riders = next;
    this.emit('lowerCenter');
  }

  private hideItem(item: Item): void {
    item.shown = false;
    item.riding = false;
    item.waited = 0;
    item.req.onHide?.();
  }

  private hideCurrent(zone: ZoneState, id: HudZoneId): void {
    const cur = zone.current;
    if (!cur) {
      return;
    }
    zone.current = null;
    zone.gap = ZONE_FADE_GAP_S;
    this.hideItem(cur);
    for (const r of zone.riders) {
      this.hideItem(r);
    }
    zone.riders = [];
    this.emit(id);
  }

  private emit(zone: HudZoneId): void {
    for (const fn of this.listeners) {
      fn(zone);
    }
  }
}
