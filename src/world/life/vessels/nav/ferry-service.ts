import type { Berth } from '../routes';
import { aheadStraight, approachSpeed, Reverser, setPose, yawFromDir, type Behaviour, type Sidestep, type VesselState } from '../agents';
import { SEPARATION_RAMP, type ServicePlan } from './ferry-plan';
import type { TrackSample } from './track';

/**
 * One vessel per berth: arriving ferries claim the berth when they near the pier (first come, first served) and wait
 * off it while it is taken; a departing ferry keeps its berth until it is well clear of the run-in corridor, so a sister
 * ship never starts its approach head-on into the departing one.
 */
export class BerthBook {
  private readonly owner = new Map<Berth, number>();

  claim(b: Berth, id: number): boolean {
    const o = this.owner.get(b);
    if (o === undefined || o === id) {
      this.owner.set(b, id);
      return true;
    }
    return false;
  }

  release(b: Berth, id: number): void {
    if (this.owner.get(b) === id) this.owner.delete(b);
  }

  ownerOf(b: Berth): number | undefined {
    return this.owner.get(b);
  }
}

type Phase = 'dwell' | 'undock' | 'pause' | 'route';

/** Pause between backing out and going ahead (engine reversal, s). */
const REVERSAL = 5;
/** Arriving ferries claim their berth this far (m of track) before the hold point. */
const CLAIM_AHEAD = 350;

/**
 * Scheduled ferry: alongside for the dwell time, backs out stern first (or, as a double-ender, simply leaves with the
 * other end leading), turns and runs to the next pier on a precomputed track, slowing for bends and coming to rest
 * alongside the next berth. Speed follows the leg's profile, further capped by the traffic rules and berth holds.
 */
export class FerryService implements Behaviour {
  private phase: Phase = 'route';
  private leg = 0;
  private s = 0;
  private v = 0;
  private timer = 0;
  private hint = 0;
  private claimed = false;
  /** Berth left behind but not yet released (until clear of its run-in corridor). */
  private leaving: Berth | null = null;
  private readonly reverser = new Reverser();
  private stuck = 0;
  private readonly smp: TrackSample = { x: 0, z: 0, tx: 0, tz: -1 };
  private readonly look: TrackSample = { x: 0, z: 0, tx: 0, tz: -1 };

  constructor(
    readonly plan: ServicePlan,
    readonly id: number,
    private readonly book: BerthBook,
    startLeg: number,
    startFraction: number,
    private readonly side: Sidestep | null = null,
  ) {
    const legs = plan.legs;
    this.leg = ((startLeg % legs.length) + legs.length) % legs.length;
    const leg = legs[this.leg];
    if (startFraction < 0) {
      // Start alongside the departure berth of this leg.
      const berth = plan.visits[leg.from].dock.berth;
      if (book.claim(berth, id)) {
        this.phase = 'dwell';
        this.timer = plan.line.dwell * (0.2 + 0.8 * -startFraction);
        return;
      }
      startFraction = 0.3;
    }
    this.phase = 'route';
    this.s = leg.route.length * Math.min(Math.max(startFraction, 0), 0.97);
    if (this.s > leg.holdS - CLAIM_AHEAD) {
      if (book.claim(this.nextBerth(), id)) this.claimed = true;
      else this.s = Math.max(0, leg.holdS - CLAIM_AHEAD * 1.5);
    }
    this.v = leg.routeProfile.at(this.s);
  }

  private nextBerth(): Berth {
    const leg = this.plan.legs[this.leg];
    return this.plan.visits[leg.to].dock.berth;
  }

  private fromBerth(): Berth {
    const leg = this.plan.legs[this.leg];
    return this.plan.visits[leg.from].dock.berth;
  }

  /** Releases the berth left behind once the hull is clear of its run-in corridor (or long held up on the way out). */
  private checkLeft(dt: number, st: VesselState): void {
    const b = this.leaving;
    if (!b) return;
    const visit = this.plan.visits.find((v) => v.dock.berth === b);
    const dock = visit?.dock;
    this.stuck = st.cap < 0.3 ? this.stuck + dt : 0;
    const far = dock ? Math.hypot(st.x - dock.x, st.z - dock.z) > (visit?.approachLength ?? 0) + this.plan.dims.length * (SEPARATION_RAMP + 0.5) : true;
    if (far || this.stuck > 20) {
      this.book.release(b, this.id);
      this.leaving = null;
    }
  }

  /** Current phase (debug / lights). */
  get state(): Phase {
    return this.phase;
  }

  ahead(dist: number, st: VesselState, out: TrackSample): void {
    const leg = this.plan.legs[this.leg];
    if (this.phase === 'route' || this.phase === 'pause') {
      const s0 = this.phase === 'route' ? this.s : 0;
      leg.route.sample(Math.min(s0 + dist, leg.route.length), out, this.phase === 'route' ? this.hint : 0);
      this.side?.offset(out);
    } else if (this.phase === 'undock' && leg.undock) {
      leg.undock.sample(Math.min(this.s + dist, leg.undock.length), out, this.hint);
    } else {
      aheadStraight(0, st, out);
    }
  }

  update(dt: number, st: VesselState): void {
    const plan = this.plan;
    const leg = plan.legs[this.leg];
    const dims = plan.dims;
    switch (this.phase) {
      case 'dwell': {
        const dock = plan.visits[leg.from].dock;
        setPose(st, dock.x, dock.z, yawFromDir(dock.hx, dock.hz), dt);
        st.speed = 0;
        st.astern = false;
        st.mode = 'moored';
        this.timer -= dt;
        if (this.timer <= 0) {
          this.leaving = dock.berth;
          this.stuck = 0;
          this.s = 0;
          this.v = 0;
          this.hint = 0;
          this.claimed = false;
          if (leg.undock) {
            this.phase = 'undock';
          } else {
            // Double-ender: the other end becomes the bow (the hull is symmetric, so the flip is invisible).
            this.phase = 'route';
            st.yaw = yawFromDir(-dock.hx, -dock.hz);
          }
        }
        return;
      }
      case 'undock': {
        const track = leg.undock!;
        const prof = leg.undockProfile!;
        this.v = approachSpeed(this.v, Math.max(prof.at(this.s, this.hint), 0.12), 0.06, 0.12, dt);
        this.s = Math.min(this.s + this.v * dt, track.length);
        this.hint = track.sample(this.s, this.smp, this.hint);
        // Travelling stern first: the bow points against the direction of travel.
        setPose(st, this.smp.x, this.smp.z, yawFromDir(-this.smp.tx, -this.smp.tz), dt);
        st.speed = this.v;
        st.astern = true;
        st.mode = 'underway';
        if (this.s >= track.length - 0.02) {
          this.phase = 'pause';
          this.timer = REVERSAL;
          this.v = 0;
        }
        return;
      }
      case 'pause': {
        st.speed = 0;
        st.astern = false;
        st.yawRate *= 0.9;
        this.timer -= dt;
        if (this.timer <= 0) {
          this.phase = 'route';
          this.s = 0;
          this.hint = 0;
        }
        return;
      }
      case 'route': {
        const track = leg.route;
        const back = this.reverser.step(dt, st, dims.length);
        if (back !== null) {
          this.v = 0;
          this.s = Math.max(0, this.s + back);
          this.hint = track.sample(this.s, this.smp, this.hint);
          this.side?.offset(this.smp);
          setPose(st, this.smp.x, this.smp.z, yawFromDir(this.smp.tx, this.smp.tz) + (this.side?.heading() ?? 0), dt);
          st.mode = 'underway';
          return;
        }
        if (!this.claimed && this.s > leg.holdS - CLAIM_AHEAD && this.book.claim(this.nextBerth(), this.id)) this.claimed = true;
        this.checkLeft(dt, st);
        let target = Math.max(leg.routeProfile.at(this.s, this.hint), 0.3);
        if (!this.claimed) target = Math.min(target, Math.sqrt(2 * dims.decel * Math.max(leg.holdS - this.s - 3, 0)));
        target = Math.min(target, st.cap);
        // Normal speed changes follow the profile; hard braking is reserved for the traffic rules.
        this.v = approachSpeed(this.v, target, dims.accel, dims.decel * 3, dt);
        this.s = Math.min(this.s + this.v * dt, track.length);
        this.hint = track.sample(this.s, this.smp, this.hint);
        // Head-on sidesteps only in open water, clear of both piers' run-in corridors.
        const L = dims.length;
        // (Ending 5 hull lengths before the hold point leaves room to ease back onto the track.)
        const open = this.s > leg.clearS + 2 * L && this.s < leg.holdS - 5 * L;
        let dyaw = 0;
        if (this.side) {
          track.sample(Math.min(this.s + Math.max(150, 2 * L), track.length), this.look, this.hint);
          dyaw = this.side.apply(dt, st, this.smp, open, this.look);
        }
        setPose(st, this.smp.x, this.smp.z, yawFromDir(this.smp.tx, this.smp.tz) + dyaw, dt);
        st.speed = this.v;
        st.astern = false;
        st.mode = 'underway';
        if (this.s >= track.length - 0.03) {
          this.leg = (this.leg + 1) % plan.legs.length;
          this.phase = 'dwell';
          this.timer = plan.line.dwell;
          this.v = 0;
          st.speed = 0;
        }
        return;
      }
    }
  }
}
