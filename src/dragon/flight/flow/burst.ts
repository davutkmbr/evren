/**
 * Chain bursts (phase 20 stage D, owner feedback on races): every clean chain link gives a short, felt push forward, the
 * way a mini-turbo or a launch does, on top of the slow flow payback.
 *
 * A link is a finished motion that hands over well from the one before it (chain factor, harmony, novelty and energy
 * stewardship all high: the same harmony terms flow is built from, so a wasteful move never links) and is not the same
 * kind of motion as either of the chain's last two (a move repeated back to back, or two moves alternated, never pay:
 * such a clean handover keeps the chain alive but adds no link; unnamed hand-flown manoeuvring counts as one kind),
 * or a speed ring / a tight gate taken while a chain is alive. Links count up while they keep coming; the push grows
 * with the count (link 1 small, link 3 and on the full size) and with flow (half size without flow, full in sustained
 * flow) and is capped in m/s and by a speed ceiling under the dive envelope. The push is delivered over BURST.time with a smooth sin² rate (no jerk at either end) along the flight
 * path. Pure state: FlowSystem decides when a link lands and applies the speed.
 */
import { clamp, smoothstep } from '../../../core/math/noise';
import type { HarmonyTerms } from './types';

export const BURST = {
  /** A motion links when its transition has at least this chain factor, harmony, novelty and energy score. */
  linkChain: 0.45,
  linkHarmony: 0.6,
  linkNovelty: 0.5,
  linkEnergy: 0.6,
  /** Push × lerp(flowFloor, 1, flow): full size only in sustained flow, half without it. */
  flowFloor: 0.5,
  /**
   * Push as a fraction of the airspeed by link count (index = link − 1, the last entry for every longer chain), before
   * the quality factor: link 1 small, link 3 and on the full size.
   */
  fraction: [0.15, 0.2, 0.25] as readonly number[],
  /** Quality factor lerp(qualityMin, 1, smoothstep(linkHarmony, qualityFull, H)): a better handover pushes harder. */
  qualityMin: 0.75,
  qualityFull: 0.85,
  /** Largest push of one burst (m/s) and the airspeed a burst never pushes past (under the folded-wing dive envelope). */
  maxDv: 12,
  speedCap: 74,
  /** Seconds the push is spread over (sin² rate). */
  time: 1.2,
  /** A chain is alive this long (s) after its last link or motion end: a ring or a tight gate in that time links. */
  alive: 2.6,
  /** A gate counts as a link when passed at least this tight (speed rings always do). */
  passTightness: 0.7,
  /**
   * The chain's recent kinds are remembered this long (s) after it was last fed, across breaks: a pattern of long
   * moves (a wingover and its roll-out, repeated) cannot relink after every pause.
   */
  kindMemory: 20,
  /** A ring or gate link pushes this fraction of a motion link of the same count. */
  passShare: 0.8,
  /** No speed push below this airspeed (m/s): slow flight, hover, the ground. */
  minSpeed: 14,
  /** Size of the bursts in free flight (the game's calm direction; 1 in a race, set by the activity system). */
  freeFlightScale: 0.6,
} as const;

/** Why a link landed. */
export type LinkSource = 'motion' | 'ring' | 'gate';

/** Fraction of the push delivered by time t (0..1): the integral of a sin² rate over [0, duration]. */
export function burstProgress(t: number, duration: number): number {
  if (t <= 0) {
    return 0;
  }
  if (t >= duration) {
    return 1;
  }
  const u = t / duration;
  return u - Math.sin(2 * Math.PI * u) / (2 * Math.PI);
}

/** True when a transition's terms make it a clean chain link. */
export function isLink(t: HarmonyTerms): boolean {
  return t.chain >= BURST.linkChain && t.total >= BURST.linkHarmony && t.novelty >= BURST.linkNovelty && t.energy >= BURST.linkEnergy;
}

/**
 * Push (m/s) of link number `link` at airspeed `speed` with harmony `harmony` and flow `flow` (before the game's scale),
 * capped at BURST.maxDv.
 */
export function linkDv(link: number, speed: number, harmony: number, flow = 1, share = 1): number {
  if (link < 1 || !Number.isFinite(speed) || speed < BURST.minSpeed) {
    return 0;
  }
  const f = BURST.fraction[Math.min(link, BURST.fraction.length) - 1];
  const q = BURST.qualityMin + (1 - BURST.qualityMin) * smoothstep(BURST.linkHarmony, BURST.qualityFull, harmony);
  const w = BURST.flowFloor + (1 - BURST.flowFloor) * clamp(flow, 0, 1);
  return Math.min(BURST.maxDv, speed * f * q * w * share);
}

export class ChainBurst {
  /** Links in the current chain (0: no chain). */
  links = 0;
  /** Kinds of motion (maneuver id, '~' unnamed) in the current chain, oldest first: its first motion and each link. */
  readonly kinds: string[] = [];
  /** Sim time the chain was last fed (a link or a motion end). */
  lastFed = -Infinity;
  /** Links and bursts since the reset, and the longest chain (headless checks). */
  totalLinks = 0;
  bestChain = 0;
  /** Sum of the pushes started since the reset (m/s). */
  totalDv = 0;
  /** Push of the running burst (m/s), how much of it is out, its time. */
  total = 0;
  private delivered = 0;
  private t = 0;
  /** Push rate of the last step relative to the burst's mean rate (0..2, sin² peak = 2): the felt surge. */
  rate = 0;

  reset(): void {
    this.links = 0;
    this.kinds.length = 0;
    this.lastFed = -Infinity;
    this.totalLinks = 0;
    this.bestChain = 0;
    this.totalDv = 0;
    this.cancel();
  }

  cancel(): void {
    this.total = 0;
    this.delivered = 0;
    this.t = 0;
    this.rate = 0;
  }

  get active(): boolean {
    return this.delivered < this.total - 1e-9;
  }

  /** 0..1: how far into the running burst (1 when none runs). */
  get progress(): number {
    return this.active ? clamp(this.t / BURST.time, 0, 1) : 1;
  }

  /**
   * The chain breaks (a poor handover, a stall, contact). The recent kinds are kept: a chain restarted right away
   * still cannot link a kind it just had (two moves alternated never pay, broken or not).
   */
  breakChain(): void {
    this.links = 0;
  }

  /** A long pause (BURST.kindMemory): the chain and its recent kinds are forgotten. */
  forget(): void {
    this.links = 0;
    this.kinds.length = 0;
  }

  /** A motion that did not link starts a new chain (the next motion may link to it). */
  begin(kind: string, now: number): void {
    this.breakChain();
    this.pushKind(kind);
    this.lastFed = now;
  }

  /** A clean handover into a kind the chain just had: keeps the chain alive, pays nothing. */
  repeat(kind: string, now: number): void {
    this.pushKind(kind);
    this.lastFed = now;
  }

  /** Records a kind; a repeat of the last one is one entry (the last two kinds are the last two different ones). */
  private pushKind(kind: string): void {
    if (this.kinds[this.kinds.length - 1] === kind) {
      return;
    }
    this.kinds.push(kind);
    if (this.kinds.length > 4) {
      this.kinds.shift();
    }
  }

  /** True when a motion of this kind adds variety to the chain (not one of its last two different kinds). */
  fresh(kind: string): boolean {
    const n = this.kinds.length;
    return this.kinds[n - 1] !== kind && this.kinds[n - 2] !== kind;
  }

  alive(now: number): boolean {
    return this.links > 0 && now - this.lastFed <= BURST.alive;
  }

  /** A link landed: counts it and starts its burst (dv m/s, already scaled). Returns the new link count. */
  link(now: number, dv: number, kind: string | null): number {
    this.links++;
    if (kind !== null) {
      this.pushKind(kind);
    }
    this.totalLinks++;
    this.bestChain = Math.max(this.bestChain, this.links);
    this.lastFed = now;
    // A new burst takes over what is left of the running one (never stacks beyond one push).
    const left = this.total - this.delivered;
    this.total = Math.min(BURST.maxDv, Math.max(dv, left));
    this.totalDv += dv;
    this.delivered = 0;
    this.t = 0;
    return this.links;
  }

  /** Speed to add this step (m/s) at airspeed `speed`: trimmed so the push never takes the dragon above the cap. */
  step(h: number, speed: number): number {
    if (!this.active || h <= 0) {
      this.rate = 0;
      return 0;
    }
    this.t += h;
    const target = this.total * burstProgress(this.t, BURST.time);
    let dv = target - this.delivered;
    this.delivered = this.t >= BURST.time ? this.total : target;
    const mean = this.total / BURST.time;
    this.rate = mean > 0 ? clamp(dv / h / mean, 0, 2) : 0;
    dv = Math.min(dv, Math.max(0, BURST.speedCap - speed));
    return Math.max(0, dv);
  }
}
