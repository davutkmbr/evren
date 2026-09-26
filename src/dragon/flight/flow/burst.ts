/**
 * Chain bursts (phase 20, owner feedback on races and on stage D v2): chaining different moves gives an instant, felt
 * push forward, the way a mini-turbo or a launch does, on top of the slow flow payback.
 *
 * One visible rule (owner feedback 26 Sep: the first version's hidden harmony thresholds made combos hard to read):
 * when a move ends cleanly (no contact, no stall, the move's own verdict), a window of BURST.window seconds opens; a
 * *different* move started inside it is a chain link, and the link lands at once, when that move starts (the push is
 * felt the moment you press). A move started while another one still runs links the same way. A speed ring (and a gate
 * taken tight) while the chain is open is a link too. The window running out, an unclean end, a stall or a contact
 * break the chain.
 *
 * Variety: a move of the same kind as either of the chain's last two different kinds never pays (a move repeated back
 * to back, or two moves alternated): it keeps the chain open but adds no link. The kind history survives a broken chain
 * for BURST.kindMemory seconds.
 *
 * The push grows with the chain (link 1 / 2 / 3+ = +15 / 20 / 25 % of the airspeed), is capped in m/s and by a speed
 * ceiling under the dive envelope, and is delivered over BURST.time with a smooth sin² rate along the flight path.
 * Harmony and flow no longer decide links; they still build flow and its payback. Pure state: FlowSystem feeds the
 * move events and applies the speed.
 */
import { clamp } from '../../../core/math/noise';

export const BURST = {
  /** Seconds after a clean move end in which a different move links (the HUD shows it draining). */
  window: 2.5,
  /**
   * Push as a fraction of the airspeed by link count (index = link − 1, the last entry for every longer chain): link 1
   * small, link 3 and on the full size.
   */
  fraction: [0.15, 0.2, 0.25] as readonly number[],
  /** Largest push of one burst (m/s) and the airspeed a burst never pushes past (under the folded-wing dive envelope). */
  maxDv: 11,
  speedCap: 74,
  /** Seconds the push is spread over (sin² rate). */
  time: 1.2,
  /** A move without an end event of its own ends once the maneuver system has been idle this long (s). */
  idleEnd: 0.15,
  /** A gate counts as a link when passed at least this tight (speed rings always do). */
  passTightness: 0.7,
  /** The chain's recent kinds are remembered this long (s) after the chain was last fed, across breaks. */
  kindMemory: 20,
  /** A ring or gate link pushes this fraction of a move link of the same count. */
  passShare: 0.8,
  /** No speed push below this airspeed (m/s): slow flight, hover, the ground. */
  minSpeed: 14,
  /** Size of the bursts in free flight (the game's calm direction; 1 in a race, set by the activity system). */
  freeFlightScale: 0.6,
} as const;

/** Moves that never take part in chains: hints, the plain take-off, flow's own captions, the automatic wing catch. */
export const CHAIN_IGNORED: ReadonlySet<string> = new Set(['hint', 'takeoff', 'flow', 'catch']);

/** Why a link landed. */
export type LinkSource = 'motion' | 'ring' | 'gate';

/** What a move's start does to the chain. */
export type ChainStart = 'link' | 'repeat' | 'begin';

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

/** Push (m/s) of link number `link` at airspeed `speed` (before the game's scale), capped at BURST.maxDv. */
export function linkDv(link: number, speed: number, share = 1): number {
  if (link < 1 || !Number.isFinite(speed) || speed < BURST.minSpeed) {
    return 0;
  }
  const f = BURST.fraction[Math.min(link, BURST.fraction.length) - 1];
  return Math.min(BURST.maxDv, speed * f * share);
}

export class ChainBurst {
  /** Links in the current chain (0: no chain). */
  links = 0;
  /** Recent different kinds of move in the chain (maneuver ids), oldest first. */
  readonly kinds: string[] = [];
  /** Sim time the chain was last fed (a move start or end). */
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
    this.current = null;
    this.windowStart = -Infinity;
    this.broke = false;
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

  /** The running move (its kind), or null. */
  current: string | null = null;
  /** Sim time the last move ended cleanly (the window runs from here), -Infinity when closed. */
  windowStart = -Infinity;
  /** True for one tick after the chain broke with links in it (the HUD's "koptu"). */
  broke = false;

  /** The chain is open: a move runs, or the window after a clean end is still running. */
  open(now: number): boolean {
    return this.current !== null || now - this.windowStart <= BURST.window;
  }

  /** 0..1 of the window left after a clean move end (1 just after it), -1 while a move runs or no window is open. */
  windowLeft(now: number): number {
    if (this.current !== null || !Number.isFinite(this.windowStart)) {
      return -1;
    }
    const left = 1 - (now - this.windowStart) / BURST.window;
    return left > 0 ? left : -1;
  }

  /** The chain breaks (window over, an unclean end, a stall, contact). The recent kinds are kept (BURST.kindMemory). */
  breakChain(): void {
    if (this.links > 0) {
      this.broke = true;
    }
    this.links = 0;
    this.windowStart = -Infinity;
  }

  /** A long pause (BURST.kindMemory): the recent kinds are forgotten. */
  forget(): void {
    this.kinds.length = 0;
  }

  /** A move starts: what it does to the chain (the caller lands a link with link() on 'link'). */
  start(kind: string, now: number): ChainStart {
    const open = this.open(now);
    const fresh = this.fresh(kind);
    let what: ChainStart;
    if (open && fresh) {
      what = 'link';
    } else if (open) {
      what = 'repeat';
      this.pushKind(kind);
    } else {
      what = 'begin';
      this.links = 0;
      this.pushKind(kind);
    }
    this.current = kind;
    this.windowStart = -Infinity;
    this.lastFed = now;
    return what;
  }

  /** The running move ended (`clean`: its own verdict); returns false when that broke the chain. */
  end(kind: string, clean: boolean, now: number): boolean {
    if (this.current !== kind) {
      return true;
    }
    this.current = null;
    this.lastFed = now;
    if (!clean) {
      this.breakChain();
      return false;
    }
    this.windowStart = now;
    return true;
  }

  /**
   * A stall or a contact: the chain breaks now, and the running move no longer counts (its end opens no window), so the
   * next move starts a new chain.
   */
  spoil(): void {
    this.current = null;
    this.breakChain();
  }

  /** Every step: the window running out breaks the chain; a long pause forgets the kinds. */
  tick(now: number): void {
    this.broke = false;
    if (this.current === null && Number.isFinite(this.windowStart) && now - this.windowStart > BURST.window) {
      this.breakChain();
    }
    if (this.current === null && now - this.lastFed > BURST.kindMemory && this.kinds.length > 0) {
      this.forget();
    }
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

  /** True when a move of this kind adds variety to the chain (not one of its last two different kinds). */
  fresh(kind: string): boolean {
    const n = this.kinds.length;
    return this.kinds[n - 1] !== kind && this.kinds[n - 2] !== kind;
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
