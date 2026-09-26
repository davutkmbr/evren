/**
 * Ferry escort ("Vapur eşliği", phase 13 activities), pure logic: no three.js, no DOM, no clock. The escort system
 * (./system.ts) feeds it the dragon and the scheduled ferries of the living world every frame; the headless check
 * (tools/headless/escort-check.ts) drives it with the real fleet and with scripted ferries.
 *
 * A chill activity: no timer on screen, no fail state, no medals.
 * - Offer: a ferry in service (underway, going ahead) within `startRadius` of the flying dragon whose direction of
 *   travel is within `startHeadingDeg` of the dragon's heading, while no race runs. The nearest such ferry is the offer.
 * - Escorting: staying within `keepRadius` of the ferry keeps it going. Further away the tracker counts the seconds
 *   away (the HUD shows a gentle note after `noteAfter`); back within the radius the count resets; after `grace`
 *   seconds away the escort ends quietly.
 * - Arrival: the ferry comes alongside its next pier (its leg turns to 'dwell' at that pier). The leg counts from the
 *   pier it left (or from where the escort began) to this one; the tracker reports it once and waits alongside.
 * - Next leg: while the player stays near, the escort carries on when the ferry leaves the pier again.
 * - A race (or the player, or the ferry leaving the world) ends it at once.
 */
import type { FerryLegInfo, VesselPose } from '../../core/contracts';
import { inService, vesselAxes } from '../../moments/anchors';

export const ESCORT_TUNING = {
  /** An offer needs the ferry this close (m, horizontal)... */
  startRadius: 120,
  /** ...and its direction of travel within this many degrees of the dragon's heading. */
  startHeadingDeg: 50,
  /** Staying this close keeps the escort going (m, horizontal). */
  keepRadius: 200,
  /** Seconds away (beyond keepRadius) before the "Vapurdan uzaklaşıyorsun" note shows. */
  noteAfter: 1.5,
  /** Seconds away after which the escort ends quietly. */
  grace: 30,
};

/** A ferry of the living world this frame: its pose and, for scheduled ferries, its line and leg. */
export interface EscortFerry {
  pose: VesselPose;
  leg: FerryLegInfo | null;
}

export interface EscortInput {
  /** The dragon (null while it does not exist). */
  dragon: { x: number; z: number; headingDeg: number } | null;
  /** A race is prepared, running or its result is open. */
  racing: boolean;
  /** False while the dragon sits, walks, swims or perches: no new offer then (a running escort goes on). */
  airborne?: boolean;
  /** The vapurs and city ferries, in service or not. */
  ferries: readonly EscortFerry[];
}

export type EscortPhase = 'idle' | 'escorting' | 'docked';
export type EscortEndReason = 'player' | 'drifted' | 'race' | 'lost' | 'teleport';

/** One leg of a line: pier ids and display names. */
export interface EscortLeg {
  line: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
}

export type EscortEvent =
  | { type: 'started'; ferryId: number; leg: EscortLeg }
  /** The ferry left the pier again with the dragon still along: the next leg. */
  | { type: 'leg'; leg: EscortLeg }
  | { type: 'away' }
  | { type: 'back' }
  /** The ferry came alongside `leg.to`; `duration` s since the leg (or the escort) began. */
  | { type: 'arrived'; leg: EscortLeg; duration: number; routeKey: string }
  | { type: 'ended'; reason: EscortEndReason };

/** Record key of a directed leg ("eminonu>kadikoy"). */
export function routeKey(from: string, to: string): string {
  return `${from}>${to}`;
}

/** Heading of a vessel's direction of travel in degrees (0 = north / -Z, 90 = east), astern included. */
export function vesselHeadingDeg(p: Pick<VesselPose, 'yaw' | 'speed'>): number {
  const { fx, fz } = vesselAxes(p);
  const k = p.speed < 0 ? -1 : 1;
  return ((Math.atan2(fx * k, -fz * k) * 180) / Math.PI + 360) % 360;
}

/** Smallest angle between two headings (degrees, 0..180). */
export function headingGap(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
}

/** Can this ferry be offered to a dragon at (x, z) heading `headingDeg`? Returns the distance, or -1. */
export function offerDistance(f: EscortFerry, x: number, z: number, headingDeg: number): number {
  if (!f.leg || f.leg.phase !== 'route' || !inService(f.pose)) {
    return -1;
  }
  const d = Math.hypot(f.pose.x - x, f.pose.z - z);
  if (d > ESCORT_TUNING.startRadius) {
    return -1;
  }
  return headingGap(vesselHeadingDeg(f.pose), headingDeg) <= ESCORT_TUNING.startHeadingDeg ? d : -1;
}

function legOf(info: FerryLegInfo): EscortLeg {
  return { line: info.line, from: info.from, to: info.to, fromName: info.fromName, toName: info.toName };
}

export class EscortTracker {
  phase: EscortPhase = 'idle';
  /** Id of the escorted ferry (-1 when idle). */
  ferryId = -1;
  /** Ferry on offer while idle (-1: none). */
  offer = -1;
  /** The leg being escorted (while docked: the leg that departs next). */
  leg: EscortLeg | null = null;
  /** Seconds since the current leg (or the escort) began. */
  legTime = 0;
  /** Seconds the dragon has been beyond keepRadius (0 while close). */
  away = 0;
  /** Horizontal distance to the escorted ferry (m). */
  distance = 0;
  /** Straight-line distance from the ferry to where it will lie at the next pier (m). */
  pierDistance = 0;
  /** Legs completed in this escort. */
  legsDone = 0;
  /** Events queued since the last update (start / stop between frames, this frame's own). */
  private readonly events: EscortEvent[] = [];
  private readonly frameEvents: EscortEvent[] = [];
  private offerLeg: EscortLeg | null = null;

  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** The drift note is due (away long enough, not yet over). */
  get drifting(): boolean {
    return this.active && this.away >= ESCORT_TUNING.noteAfter;
  }

  /** Seconds left before a drifting escort ends. */
  get graceLeft(): number {
    return Math.max(0, ESCORT_TUNING.grace - this.away);
  }

  /** Starts escorting the ferry on offer; false when there is none. Events come with the next update(). */
  start(): boolean {
    if (this.active || this.offer < 0 || !this.offerLeg) {
      return false;
    }
    this.phase = 'escorting';
    this.ferryId = this.offer;
    this.leg = this.offerLeg;
    this.legTime = 0;
    this.away = 0;
    this.legsDone = 0;
    this.offer = -1;
    this.offerLeg = null;
    this.events.push({ type: 'started', ferryId: this.ferryId, leg: this.leg });
    return true;
  }

  /** Ends the escort (no-op while idle). */
  stop(reason: EscortEndReason): void {
    if (!this.active) {
      return;
    }
    this.phase = 'idle';
    this.ferryId = -1;
    this.leg = null;
    this.away = 0;
    this.events.push({ type: 'ended', reason });
  }

  /** Advances by `dt` seconds (dt > 0: the running game) and returns this frame's events (array reused). */
  update(dt: number, input: EscortInput): readonly EscortEvent[] {
    this.step(dt, input);
    const out = this.frameEvents;
    out.length = 0;
    out.push(...this.events);
    this.events.length = 0;
    return out;
  }

  private step(dt: number, input: EscortInput): void {
    if (input.racing) {
      this.offer = -1;
      this.offerLeg = null;
      this.stop('race');
      return;
    }
    if (!this.active) {
      this.findOffer(input);
      return;
    }
    const f = input.ferries.find((x) => x.pose.id === this.ferryId);
    if (!f || !f.leg || !input.dragon) {
      this.stop('lost');
      return;
    }
    this.legTime += dt;
    this.distance = Math.hypot(f.pose.x - input.dragon.x, f.pose.z - input.dragon.z);
    this.pierDistance = Math.hypot(f.pose.x - f.leg.dockX, f.pose.z - f.leg.dockZ);
    if (this.distance <= ESCORT_TUNING.keepRadius) {
      if (this.away >= ESCORT_TUNING.noteAfter) {
        this.events.push({ type: 'back' });
      }
      this.away = 0;
    } else {
      const was = this.away;
      this.away += dt;
      if (was < ESCORT_TUNING.noteAfter && this.away >= ESCORT_TUNING.noteAfter) {
        this.events.push({ type: 'away' });
      }
      if (this.away >= ESCORT_TUNING.grace) {
        this.stop('drifted');
        return;
      }
    }
    const leg = this.leg!;
    const info = f.leg;
    if (this.phase === 'escorting') {
      if (info.phase === 'dwell' && info.from === leg.to) {
        this.events.push({ type: 'arrived', leg, duration: this.legTime, routeKey: routeKey(leg.from, leg.to) });
        this.legsDone++;
        this.phase = 'docked';
        this.leg = legOf(info);
        this.legTime = 0;
      } else if (info.to !== leg.to && info.from !== leg.from) {
        // The ferry moved on without us seeing it dock (a long frame): follow its current leg.
        this.leg = legOf(info);
        this.legTime = 0;
      }
    } else if (info.phase !== 'dwell') {
      // Leaving the pier: the next leg.
      this.phase = 'escorting';
      this.leg = legOf(info);
      this.legTime = 0;
      this.events.push({ type: 'leg', leg: this.leg });
    }
  }

  private findOffer(input: EscortInput): void {
    this.offer = -1;
    this.offerLeg = null;
    const d = input.dragon;
    if (!d || input.airborne === false) {
      return;
    }
    let best = Infinity;
    for (const f of input.ferries) {
      const dist = offerDistance(f, d.x, d.z, d.headingDeg);
      if (dist >= 0 && dist < best) {
        best = dist;
        this.offer = f.pose.id;
        this.offerLeg = legOf(f.leg!);
      }
    }
  }
}
