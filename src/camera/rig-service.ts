import type { CameraMode, CameraRigState } from '../core/contracts';

export interface CameraRigHost {
  readonly currentMode: CameraMode;
  requestMode(mode: CameraMode): void;
  addShake(amount: number): void;
  readonly currentFov: number;
  readonly debugInfo: CameraDebugInfo;
}

export interface CameraDebugInfo {
  mode: CameraMode;
  blending: boolean;
  shot: string;
  shotLabel: string;
  cuts: number;
  zoom: number;
  /** Chase orbit offset from behind (deg). */
  orbitYawDeg: number;
  fov: number;
  near: number;
  distanceToDragon: number;
  speedEffect: number;
}

/** The public 'cameraRig' service. `mode` is writable (assigning it switches modes like setMode). */
export class CameraRigService implements CameraRigState {
  constructor(private readonly host: CameraRigHost) {}

  get mode(): CameraMode {
    return this.host.currentMode;
  }

  set mode(mode: CameraMode) {
    this.host.requestMode(mode);
  }

  setMode(mode: CameraMode): void {
    this.host.requestMode(mode);
  }

  shake(amount: number): void {
    this.host.addShake(amount);
  }

  get fovDeg(): number {
    return this.host.currentFov;
  }

  /** Non-contract diagnostics used by the camera sandbox and screenshot tooling. */
  get debug(): CameraDebugInfo {
    return this.host.debugInfo;
  }
}
