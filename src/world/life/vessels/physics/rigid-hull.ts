/**
 * A vessel as a floating rigid body (phase 21 stage 7b).
 *
 * Six degrees of freedom split the way seakeeping and manoeuvring models split them: heave, roll and pitch from the
 * buoyancy columns on the real water height (hydrostatics with the centre of gravity above the centre of buoyancy,
 * added mass and hydrodynamic damping), surge, sway and yaw from thrust, rudder / thruster moments and hull drag
 * through the water (current included), coupled through the turning heel and the planing lift and trim.
 *
 * The navigation behaviours keep choosing where the vessel should be (a moving reference pose on its route, speed,
 * astern or not, alongside a berth or not); `steer` turns that into thrust, rudder moment and thruster force, and
 * alongside or at anchor into a soft mooring spring. The body integrates the forces with a fixed step.
 */
import type { HullBody, HullColumn } from './hull-data';
import { columnVolume, GRAVITY, RHO_SEA } from './hull-data';

/** Physics level of detail. */
export const enum HullLod {
  /** Full rigid body: every buoyancy column, heave / roll / pitch, forces in the plane. */
  Full = 0,
  /** Heave from three samples (roll and pitch settle), forces in the plane. */
  Mid = 1,
  /** Kinematic: the body is placed on the navigation pose. */
  Far = 2,
}

/** Navigation reference the controller follows (the behaviour's state, read once per frame). */
export interface HullReference {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  astern: boolean;
  /** Alongside / at anchor / drifting: hold the pose on a soft spring instead of steering. */
  held: boolean;
  /** Yaw rate of the reference (rad/s), a feed-forward for the steering. */
  yawRate: number;
}

const MAX_ROLL = 0.8;
/** Largest crab angle into a current / toward the reference point (rad). */
const CRAB_MAX = 1.0;
/** Largest drift angle the course control compensates (rad). */
const DRIFT_MAX = 0.5;
const MAX_PITCH = 0.35;

function smoothstep(e0: number, e1: number, x: number): number {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Rigid-body state + the per-column water it floats on. */
export class RigidHull {
  /* Pose: horizontal position, heading (Object3D yaw, forward = -Z), heave of the design waterline, roll, pitch. */
  x = 0;
  z = 0;
  yaw = 0;
  heave = 0;
  roll = 0;
  pitch = 0;
  /* Rates: world horizontal velocity, yaw rate, heave, roll and pitch rates. */
  vx = 0;
  vz = 0;
  r = 0;
  vh = 0;
  vr = 0;
  vp = 0;
  /** Water height and its rate at every column (full columns, or the three mid columns). */
  readonly eta: Float64Array;
  readonly etaDot: Float64Array;
  /** Age of the water samples (s): heights are extrapolated with their rate until the next refresh. */
  etaAge = 0;
  /** Seconds until the next water refresh. */
  sampleIn = 0;
  /** Surface current at the hull (m/s). */
  cx = 0;
  cz = 0;
  lod: HullLod = HullLod.Far;
  /** Thrust, rudder / thruster yaw moment and thruster side force of the last step (diagnostics). */
  thrust = 0;
  yawMoment = 0;
  sideForce = 0;
  /** Heave force from the last step's buoyancy (diagnostics). */
  buoyancy = 0;
  /** Planing share of the last step (0..1). */
  planing = 0;
  /* Previous step's pose for interpolation between fixed steps. */
  px = 0;
  pz = 0;
  pyaw = 0;
  pheave = 0;
  proll = 0;
  ppitch = 0;

  constructor(readonly hull: HullBody) {
    const n = Math.max(hull.columns.length, hull.midColumns.length);
    this.eta = new Float64Array(n);
    this.etaDot = new Float64Array(n);
    this.heave = hull.lift;
  }

  /** Columns of the current level of detail. */
  get columns(): readonly HullColumn[] {
    return this.lod === HullLod.Mid ? this.hull.midColumns : this.hull.columns;
  }

  /** Places the body on a reference pose with its velocity (kinematic LOD, teleports, start). */
  place(ref: HullReference): void {
    const k = ref.astern ? -1 : 1;
    this.x = ref.x;
    this.z = ref.z;
    this.yaw = ref.yaw;
    this.vx = -Math.sin(ref.yaw) * ref.speed * k;
    this.vz = -Math.cos(ref.yaw) * ref.speed * k;
    this.r = ref.held ? 0 : ref.yawRate;
  }

  /** Resets the vertical motion to calm equilibrium. */
  settle(): void {
    this.heave = this.hull.lift;
    this.roll = 0;
    this.pitch = 0;
    this.vh = 0;
    this.vr = 0;
    this.vp = 0;
  }

  savePrevious(): void {
    this.px = this.x;
    this.pz = this.z;
    this.pyaw = this.yaw;
    this.pheave = this.heave;
    this.proll = this.roll;
    this.ppitch = this.pitch;
  }

  /** Speed through the water along the hull (m/s, negative astern). */
  get surge(): number {
    return (this.vx - this.cx) * -Math.sin(this.yaw) + (this.vz - this.cz) * -Math.cos(this.yaw);
  }

  /** World position of a model-space point (lx starboard, lz aft) on the waterline plane (yaw only). */
  worldX(lx: number, lz: number): number {
    return this.x + lx * Math.cos(this.yaw) + lz * Math.sin(this.yaw);
  }

  worldZ(lx: number, lz: number): number {
    return this.z - lx * Math.sin(this.yaw) + lz * Math.cos(this.yaw);
  }

  /**
   * Heave, roll and pitch over one step `h` from the buoyancy columns (Full) or the three samples (Mid: heave only,
   * roll and pitch settle). `extraRoll` / `extraPitch` are moments from the manoeuvre (turning heel, planing trim).
   */
  stepVertical(h: number, extraRoll: number, extraPitch: number, extraLift: number): void {
    const b = this.hull;
    const T = b.draft;
    const F = b.freeboard;
    const cvp = b.cvp;
    const ve = b.volExp;
    const mid = this.lod === HullLod.Mid;
    const cols = mid ? b.midColumns : b.columns;
    const sr = Math.sin(this.roll);
    const sp = Math.sin(this.pitch);
    const cr = Math.cos(this.roll);
    const cp = Math.cos(this.pitch);
    const age = this.etaAge;
    let force = 0;
    let mRoll = 0;
    let mPitch = 0;
    let wSum = 0;
    let wArea = 0;
    const rg = RHO_SEA * GRAVITY;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const eta = this.eta[i] + this.etaDot[i] * age;
      const y = mid ? this.heave : this.heave + c.lx * sr - c.lz * sp;
      const d = eta - y + T;
      const f = rg * c.area * columnVolume(d, T, F, cvp, ve);
      force += f;
      if (!mid) {
        mRoll += f * c.lx * cr;
        mPitch -= f * c.lz * cp;
      }
      if (d > 0) {
        wSum += this.etaDot[i] * c.area;
        wArea += c.area;
      }
    }
    const wWater = wArea > 0 ? wSum / wArea : 0;
    this.buoyancy = force;
    const fh = force + extraLift - b.mass * GRAVITY - b.cHeave * (this.vh - wWater);
    this.vh += (fh / b.mHeave) * h;
    this.heave += this.vh * h;
    if (mid) {
      // Roll and pitch settle over a couple of seconds (only the manoeuvre heel / trim remain).
      const kr = b.kRoll;
      const kp = b.kPitch;
      const targetRoll = extraRoll / kr;
      const targetPitch = extraPitch / kp;
      const a = Math.min(1, h * 1.5);
      this.roll += (targetRoll - this.roll) * a;
      this.pitch += (targetPitch - this.pitch) * a;
      this.vr = 0;
      this.vp = 0;
      return;
    }
    // Centre of gravity above the centre of buoyancy: the heeling part of the righting moment.
    const lever = b.mass * GRAVITY * (b.kg - b.kb);
    const mr = mRoll + lever * sr - b.cRoll * this.vr - b.cRoll2 * this.vr * Math.abs(this.vr) + extraRoll;
    const mp = mPitch + lever * sp - b.cPitch * this.vp + extraPitch;
    this.vr += (mr / b.iRoll) * h;
    this.vp += (mp / b.iPitch) * h;
    this.roll += this.vr * h;
    this.pitch += this.vp * h;
    if (Math.abs(this.roll) > MAX_ROLL) {
      this.roll = clamp(this.roll, -MAX_ROLL, MAX_ROLL);
      this.vr = 0;
    }
    if (Math.abs(this.pitch) > MAX_PITCH) {
      this.pitch = clamp(this.pitch, -MAX_PITCH, MAX_PITCH);
      this.vp = 0;
    }
  }

  /**
   * Steering controller + planar dynamics over one step: thrust along the hull, rudder / thruster yaw moment and
   * thruster side force from the reference, hull drag through the water (lateral much higher than longitudinal),
   * the current. Returns nothing; writes the moments the vertical step needs into `heel` / `trim` / `lift`.
   */
  stepPlanar(h: number, ref: HullReference, out: { heel: number; trim: number; lift: number }): void {
    const b = this.hull;
    const d = b.design;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // Hull axes: forward f = (-sin, -cos), starboard s = (cos, -sin).
    const fx = -sy;
    const fz = -cy;
    const sx = cy;
    const sz = -sy;
    const wx = this.vx - this.cx;
    const wz = this.vz - this.cz;
    const ur = wx * fx + wz * fz;
    const vr = wx * sx + wz * sz;
    const L = b.length;
    let thrust = 0;
    let moment = 0;
    let side = 0;
    const lowSpeed = 1 - smoothstep(1, 3, Math.abs(ur));
    const rudder = b.alphaRudder * Math.min(1, (ur * ur) / (b.vRudder * b.vRudder)) + b.alphaThrust * lowSpeed;
    const momentMax = b.iYaw * rudder;
    const ex = ref.x - this.x;
    const ez = ref.z - this.z;
    if (ref.held) {
      // Mooring lines / anchor / station keeping: a soft, well damped spring toward the reference pose.
      const period = clamp(4 + 0.25 * L, 8, 30);
      const w = (2 * Math.PI) / period;
      const k = b.mSurge * w * w;
      const c = 2 * 0.9 * b.mSurge * w;
      // Damped against the ground (the pier / the anchor), not the water.
      let gx = k * ex - c * this.vx;
      let gz = k * ez - c * this.vz;
      const g = Math.hypot(gx, gz);
      const gMax = b.thrustMax;
      if (g > gMax) {
        gx *= gMax / g;
        gz *= gMax / g;
      }
      thrust = gx * fx + gz * fz;
      side = gx * sx + gz * sz;
      const wy = (2 * Math.PI) / (period * 0.8);
      moment = b.iYaw * (wy * wy * wrapPi(ref.yaw - this.yaw) - 2 * 0.9 * wy * this.r);
      const mMax = b.iYaw * Math.max(rudder, 0.3 * d.yawRate);
      moment = clamp(moment, -mMax, mMax);
    } else {
      // Direction of travel of the reference and the wanted velocity over the ground: its speed along the route
      // plus a proportional pull back onto the reference point.
      const k = ref.astern ? -1 : 1;
      const tx = -Math.sin(ref.yaw) * k;
      const tz = -Math.cos(ref.yaw) * k;
      const tau = 6 + 0.08 * L;
      const pull = Math.min(1, (0.35 * d.vmax + 1) / (Math.hypot(ex, ez) / tau + 1e-6));
      const dvx = ref.speed * tx + (ex / tau) * pull;
      const dvz = ref.speed * tz + (ez / tau) * pull;
      // Through the water (crab into the current).
      const dwx = dvx - this.cx;
      const dwz = dvz - this.cz;
      const dws = Math.hypot(dwx, dwz);
      // Heading: the reference's, turned toward the wanted water track when there is way on (course control: the
      // hull's present drift angle is added, so the bow leads the track in a turn by as much as the hull slips).
      let yawTarget = ref.yaw;
      if (dws > 0.4) {
        const dir = ref.astern ? Math.atan2(dwx, dwz) : Math.atan2(-dwx, -dwz);
        const way = smoothstep(0.4, 1.5, dws);
        const speed = Math.hypot(ur, vr);
        const drift = speed > 0.5 ? clamp(Math.atan2(vr, Math.abs(ur)), -DRIFT_MAX, DRIFT_MAX) * (ref.astern ? -1 : 1) * smoothstep(0.5, 1.5, speed) : 0;
        const off = clamp(wrapPi(dir - ref.yaw) + drift, -CRAB_MAX, CRAB_MAX) * way;
        yawTarget = ref.yaw + off;
      }
      const kPsi = clamp(2.2 / Math.sqrt(L), 0.25, 0.9);
      const rff = clamp(ref.yawRate, -d.yawRate, d.yawRate);
      const rWant = clamp(kPsi * wrapPi(yawTarget - this.yaw) + rff, -d.yawRate, d.yawRate);
      moment = clamp(b.iYaw * ((rWant - this.r) / 1.5) + b.nr * rWant, -momentMax, momentMax);
      // Thrust: hold the wanted speed through the water along the hull (drag feed-forward + a proportional term).
      const uWant = dwx * fx + dwz * fz;
      const tauU = 3 + 0.03 * L;
      thrust = b.xuu * uWant * Math.abs(uWant) + b.xu * uWant + (b.mSurge * (uWant - ur)) / tauU;
      thrust = clamp(thrust, -0.6 * b.thrustMax, b.thrustMax);
      // Thrusters at low speed: the lateral part of the wanted water velocity.
      if (b.swayThrust > 0 && lowSpeed > 0) {
        const vWant = dwx * sx + dwz * sz;
        side = clamp((b.mSway * (vWant - vr)) / 4, -b.swayThrust, b.swayThrust) * lowSpeed;
      }
    }
    // Hull forces through the water: surge drag; sway from the hull's lift at a drift angle (slender body,
    // proportional to the speed), cross-flow drag and a little linear damping at rest.
    const X = thrust - b.xuu * ur * Math.abs(ur) - b.xu * ur;
    // The rudder pushes the stern sideways (half of it is taken up by the hull's own lift near the bow).
    const rudderSide = (moment * (1 - lowSpeed)) / L;
    const Yh = -b.yvv * vr * Math.abs(vr) - (b.yv + b.yLift * Math.abs(ur)) * vr + rudderSide;
    const Y = Yh + side;
    const N = moment - b.nr * this.r;
    // Body-frame equations with the added masses (Coriolis / Munk coupling through the yaw rate), then back to the
    // world with the new heading.
    const r = this.r;
    const du = (X + b.mSway * vr * r) / b.mSurge;
    const dv = (Y - b.mSurge * ur * r) / b.mSway;
    const u1 = ur + du * h;
    const v1 = vr + dv * h;
    this.r += (N / b.iYaw) * h;
    this.yaw = wrapPi(this.yaw + this.r * h);
    const sy1 = Math.sin(this.yaw);
    const cy1 = Math.cos(this.yaw);
    this.vx = this.cx - u1 * sy1 + v1 * cy1;
    this.vz = this.cz - u1 * cy1 - v1 * sy1;
    this.x += this.vx * h;
    this.z += this.vz * h;
    this.thrust = thrust;
    this.yawMoment = moment;
    this.sideForce = side;
    // Turning heel: the hull's lateral force acts at half draft, the centrifugal reaction at the centre of gravity
    // (outward for displacement hulls, inward once planing).
    const pl = d.planing ? smoothstep(d.planing.vOn, d.planing.vFull, ur) : 0;
    this.planing = pl;
    // Lateral acceleration of the centre of gravity (inertial): v' + u r.
    const aLat = dv + ur * r;
    out.heel = (b.kg - 0.5 * b.eqDraft) * b.mass * aLat * (1 - 2 * pl);
    // Planing: dynamic lift and bow-up trim; displacement hulls squat a little by the stern at speed.
    const vFrac = ur / d.vmax;
    out.trim = d.planing ? b.kPitch * pl * d.planing.trimDeg * (Math.PI / 180) : b.kPitch * 0.004 * vFrac * Math.abs(vFrac);
    out.lift = d.planing ? pl * d.planing.lift * b.mass * GRAVITY : 0;
  }

  /**
   * Adds an impulse (N s) at a world point on the hull: `jy` vertical (negative = down), (jx, jz) horizontal.
   * Changes the heave, roll and pitch rates (Full LOD), the plane velocity and the yaw rate.
   */
  impulse(px: number, pz: number, jx: number, jy: number, jz: number): void {
    const b = this.hull;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // Point in hull axes: lateral (starboard) and longitudinal (aft) offsets.
    const dx = px - this.x;
    const dz = pz - this.z;
    const lx = dx * cy - dz * sy;
    const lz = dx * sy + dz * cy;
    this.vh += jy / b.mHeave;
    if (this.lod === HullLod.Full) {
      this.vr += (jy * lx) / b.iRoll;
      this.vp -= (jy * lz) / b.iPitch;
    }
    // Horizontal: surge / sway split with their own effective masses; the yaw moment about the vertical axis.
    const fx = -sy;
    const fz = -cy;
    const sx = cy;
    const sz = -sy;
    const ju = jx * fx + jz * fz;
    const jv = jx * sx + jz * sz;
    this.vx += (ju / b.mSurge) * fx + (jv / b.mSway) * sx;
    this.vz += (ju / b.mSurge) * fz + (jv / b.mSway) * sz;
    // N = r_z F_x - r_x F_z in hull axes (x starboard, z aft) with F in the same axes.
    const Fx = jv;
    const Fz = -ju;
    this.r += (lz * Fx - lx * Fz) / b.iYaw;
    // A push low on the side also heels the hull (lateral impulse at half draft below the waterline).
    if (this.lod === HullLod.Full) {
      this.vr += (jv * 0.5 * b.eqDraft) / b.iRoll;
    }
  }

  /** True when every state value is finite. */
  finite(): boolean {
    return (
      Number.isFinite(this.x) &&
      Number.isFinite(this.z) &&
      Number.isFinite(this.yaw) &&
      Number.isFinite(this.heave) &&
      Number.isFinite(this.roll) &&
      Number.isFinite(this.pitch) &&
      Number.isFinite(this.vx) &&
      Number.isFinite(this.vz) &&
      Number.isFinite(this.r) &&
      Number.isFinite(this.vh) &&
      Number.isFinite(this.vr) &&
      Number.isFinite(this.vp)
    );
  }
}
