import * as THREE from 'three';
import type { DragonRig, DragonState } from '../core/contracts';
import { feelContext, speedAmount } from '../core/speed-feel';
import { clamp01, finiteOr, isFiniteVec, smoothstep } from './dsp/math';
import type { DragonAudioState } from './audio-engine';
import type { ListenerPose } from './spatial';

/** Converts the flight state into the audio engine's per-frame dragon snapshot (no allocations). */
export class DragonProbe {
  private readonly invQ = new THREE.Quaternion();
  private readonly vBody = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly mouthTmp = new THREE.Vector3();
  private diving = 0;
  private stall = 0;

  update(dragon: DragonState | undefined, rig: DragonRig | undefined, dt: number, out: DragonAudioState): void {
    if (!dragon) {
      out.present = false;
      out.firing = false;
      return;
    }
    const q = dragon.quaternion;
    // A glitched flight frame (NaN pose) keeps the last good snapshot instead of poisoning the audio graph.
    if (!isFiniteVec(dragon.position) || !isFiniteVec(dragon.velocity) || !isFiniteVec(dragon.angularVelocity) || !Number.isFinite(q.x + q.y + q.z + q.w)) {
      return;
    }
    out.present = true;
    const p = dragon.position;
    out.position.x = p.x;
    out.position.y = p.y;
    out.position.z = p.z;
    const f = this.tmp.set(0, 0, -1).applyQuaternion(q);
    out.forward.x = f.x;
    out.forward.y = f.y;
    out.forward.z = f.z;

    const vel = dragon.velocity;
    const speed = vel.length();
    this.invQ.copy(q).invert();
    const vb = this.vBody.copy(vel).applyQuaternion(this.invQ);
    const u = Math.max(-vb.z, 0.5);
    out.aoa = speed > 2 ? Math.atan2(-vb.y, u) : 0;
    out.sideslip = speed > 2 ? Math.atan2(vb.x, u) : 0;
    const airspeed = finiteOr(dragon.airspeed, speed);
    const offAir = dragon.mode === 'grounded' || dragon.mode === 'swimming' || dragon.mode === 'underwater';
    out.airspeed = offAir ? Math.min(airspeed, speed) * 0.3 : airspeed;
    out.turnRate = -dragon.angularVelocity.y;
    out.rollRate = -dragon.angularVelocity.z;

    const descent = speed > 1 ? -vel.y / speed : 0;
    const diveTarget = dragon.mode === 'diving' ? 1 : smoothstep(0.45, 0.85, descent) * smoothstep(35, 60, speed);
    const stallTarget = dragon.mode === 'stalling' ? 1 : dragon.mode === 'hovering' ? 0.25 : smoothstep(0.35, 0.6, out.aoa);
    const k = 1 - Math.exp(-finiteOr(dt, 0) * 4);
    this.diving += (diveTarget - this.diving) * k;
    this.stall += (stallTarget - this.stall) * k;
    out.diving = this.diving;
    out.stall = this.stall;
    // Perceived speed (phase 20): race speeds and chain bursts in their context (full in a race and at high flow).
    const context = feelContext(!!dragon.racing, finiteOr(dragon.flow ?? 0, 0));
    out.surge = offAir ? 0 : context * clamp01(0.45 * speedAmount(airspeed) + 0.8 * finiteOr(dragon.burst ?? 0, 0));

    const reach = rig ? rig.dimensions.length * 0.5 : 9;
    let mouthOk = false;
    if (rig) {
      const m = rig.mouth.getWorldPosition(this.mouthTmp);
      // Guard against a rig that is not (yet) parented under the flight object.
      mouthOk = isFiniteVec(m) && m.distanceToSquared(p) < 40 * 40;
      out.wingspan = finiteOr(rig.dimensions.wingspan, 0) || 18;
    } else {
      out.wingspan = 18;
    }
    if (!mouthOk) {
      this.mouthTmp.copy(p).addScaledVector(f, finiteOr(reach, 9));
    }
    out.mouth.x = this.mouthTmp.x;
    out.mouth.y = this.mouthTmp.y;
    out.mouth.z = this.mouthTmp.z;
  }
}

/** Camera world matrix -> listener pose. Returns false (leaving `out` untouched) when the matrix is not finite. */
export function readListener(camera: THREE.Camera, out: ListenerPose): boolean {
  const e = camera.matrixWorld.elements;
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(e[i])) {
      return false;
    }
  }
  const rl = Math.hypot(e[0], e[1], e[2]);
  const fl = Math.hypot(e[8], e[9], e[10]);
  if (rl < 1e-6 || fl < 1e-6) {
    return false;
  }
  out.position.x = e[12];
  out.position.y = e[13];
  out.position.z = e[14];
  out.right.x = e[0] / rl;
  out.right.y = e[1] / rl;
  out.right.z = e[2] / rl;
  out.forward.x = -e[8] / fl;
  out.forward.y = -e[9] / fl;
  out.forward.z = -e[10] / fl;
  return true;
}
