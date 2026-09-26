import * as THREE from 'three';
import type { UnderwaterView } from '../../../core/contracts';

/**
 * Tunables of the camera-under-water state (phase 21 stage 4). Depths are the camera's height below the local wave
 * surface (the CPU wave height at the camera x/z, the same surface the shader draws).
 */
export const UNDERWATER_STATE = {
  /** The camera counts as under once it is this far below the surface (m) ... */
  enterDepth: 0.04,
  /** ... and as above again once it is this far above it (m): the hysteresis band. */
  exitDepth: 0.04,
  /**
   * A switch holds at least this long (s) unless the camera is decisively past the surface (`decisiveDepth`): a lens
   * bobbing on the waterline does not flicker the mix; a real plunge or breach switches in the frame it happens.
   */
  minDwell: 0.3,
  decisiveDepth: 0.35,
  /** Lens effects (waterline split, wet band) run while the camera is within this height above the surface (m). */
  lensBand: 0.9,
  /** Droplets on the lens after a breach: full at the breach, gone after this many seconds. */
  dropletSeconds: 1.1,
  /** Only a real submersion leaves droplets (s under water before the breach). */
  dropletMinUnder: 0.35,
  /** Smoothing rate of `amount` (1/s). */
  amountRate: 7,
} as const;

/**
 * Pure state machine behind the `underwater` service: fed once per frame with the camera height and the local
 * surface, it keeps the hysteresis flag, the smoothed amount for mixes and the droplet timer. No allocation, no
 * GPU: the headless check drives it directly.
 */
export class UnderwaterState implements UnderwaterView {
  under = false;
  depth = -1e3;
  amount = 0;
  surfaceY = 0;
  readonly surfaceNormal = new THREE.Vector3(0, 1, 0);
  droplets = 0;
  lensActive = false;
  /** Seconds since the last switch. */
  timeInState = 1e3;
  /** Number of under/above switches so far (checks count flicker with it). */
  switches = 0;

  reset(): void {
    this.under = false;
    this.depth = -1e3;
    this.amount = 0;
    this.droplets = 0;
    this.lensActive = false;
    this.timeInState = 1e3;
  }

  /**
   * `camY` = camera height, `surfaceY` / `normal` = the local wave surface at the camera x/z, `overWater` = there is a
   * water column under the camera (false over land: a camera below sea level there is only inside low terrain).
   */
  update(camY: number, surfaceY: number, normal: THREE.Vector3 | null, overWater: boolean, dt: number): void {
    const S = UNDERWATER_STATE;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    const valid = overWater && Number.isFinite(camY) && Number.isFinite(surfaceY);
    this.surfaceY = valid ? surfaceY : 0;
    if (valid && normal && Number.isFinite(normal.x + normal.y + normal.z) && normal.y > 0.2) {
      this.surfaceNormal.copy(normal);
    } else {
      this.surfaceNormal.set(0, 1, 0);
    }
    this.depth = valid ? surfaceY - camY : -1e3;
    this.timeInState += step;

    if (this.droplets > 0) {
      this.droplets = Math.max(0, this.droplets - step / S.dropletSeconds);
    }
    const d = this.depth;
    const settled = this.timeInState >= S.minDwell;
    if (!this.under && d > S.enterDepth && (settled || d > S.decisiveDepth)) {
      this.under = true;
      this.timeInState = 0;
      this.switches++;
    } else if (this.under && d < -S.exitDepth && (settled || d < -S.decisiveDepth)) {
      const underFor = this.timeInState;
      this.under = false;
      this.timeInState = 0;
      this.switches++;
      if (underFor >= S.dropletMinUnder) {
        this.droplets = 1;
      }
    }
    if (this.under) {
      this.droplets = 0;
    }
    this.lensActive = this.under || (valid && d > -S.lensBand);
    const target = this.under ? 1 : 0;
    this.amount += (target - this.amount) * (1 - Math.exp(-S.amountRate * step));
    if (Math.abs(this.amount - target) < 1e-4) {
      this.amount = target;
    }
  }
}
