import type * as THREE from 'three';

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/**
 * First-person walker for the street sandbox: WASD / arrow keys move, Shift runs, the mouse looks around (pointer
 * lock on click, or drag with a button held when pointer lock is unavailable). Position is on the ground; the eye
 * sits `eyeHeight` above it. No collisions in format 0 (colliders arrive with physics in S3).
 */
export class FirstPersonController {
  x = 0;
  z = 0;
  /** Ground height under the walker (smoothed). */
  groundY = 0;
  /** Compass-style yaw: 0 looks north (-Z), +π/2 looks east. */
  heading = 0;
  pitch = 0;
  eyeHeight = 1.7;
  walkSpeed = 1.4;
  runSpeed = 4.2;
  sensitivity = 0.0022;
  private readonly keys = new Set<string>();
  private dragging = false;
  private lastUserInput = -Infinity;
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly dom: HTMLElement) {
    const onKeyDown = (e: KeyboardEvent) => {
      this.keys.add(e.code);
      if (e.code in MOVE_KEYS) {
        this.lastUserInput = performance.now();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const onBlur = () => this.keys.clear();
    const onPointerDown = (e: PointerEvent) => {
      this.dragging = true;
      if (document.pointerLockElement !== dom && e.button === 0) {
        dom.requestPointerLock?.()?.catch?.(() => undefined);
      }
    };
    const onPointerUp = () => {
      this.dragging = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== dom && !this.dragging) {
        return;
      }
      this.heading += e.movementX * this.sensitivity;
      this.pitch = Math.min(1.35, Math.max(-1.35, this.pitch - e.movementY * this.sensitivity));
      this.lastUserInput = performance.now();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('mousemove', onMouseMove);
    this.cleanups.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
      () => dom.removeEventListener('pointerdown', onPointerDown),
      () => window.removeEventListener('pointerup', onPointerUp),
      () => window.removeEventListener('mousemove', onMouseMove),
    );
  }

  /** Milliseconds (performance.now) of the last movement key or mouse look. */
  get lastInputAt(): number {
    return this.lastUserInput;
  }

  get moving(): boolean {
    for (const k of this.keys) {
      if (k in MOVE_KEYS) {
        return true;
      }
    }
    return false;
  }

  /**
   * Moves by the held keys and follows the ground. `groundAt` returns the walkable height at (x, z) no higher than
   * `maxY`, or null (the last height is kept).
   */
  update(dt: number, groundAt: (x: number, z: number, maxY: number) => number | null): void {
    let fx = 0;
    let fz = 0;
    for (const k of this.keys) {
      const m = MOVE_KEYS[k];
      if (m) {
        fx += m[0];
        fz += m[1];
      }
    }
    const len = Math.hypot(fx, fz);
    if (len > 0) {
      const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? this.runSpeed : this.walkSpeed;
      const step = (speed * dt) / len;
      const sin = Math.sin(this.heading);
      const cos = Math.cos(this.heading);
      this.x += (fz * sin + fx * cos) * step;
      this.z += (-fz * cos + fx * sin) * step;
    }
    this.followGround(dt, groundAt);
  }

  /** Eases the ground height toward the surface under (x, z); steps up to 0.6 m (kerbs, thresholds, stairs). */
  followGround(dt: number, groundAt: (x: number, z: number, maxY: number) => number | null, fallbackY?: number): void {
    const g = groundAt(this.x, this.z, this.groundY + 0.6) ?? fallbackY ?? null;
    if (g === null) {
      return;
    }
    const k = 1 - Math.exp(-dt / 0.08);
    this.groundY += (g - this.groundY) * (dt > 0 ? k : 1);
  }

  snapGround(y: number): void {
    this.groundY = y;
  }

  apply(camera: THREE.PerspectiveCamera): void {
    camera.position.set(this.x, this.groundY + this.eyeHeight, this.z);
    camera.rotation.set(this.pitch, -this.heading, 0, 'YXZ');
    camera.updateMatrixWorld();
  }

  dispose(): void {
    for (const c of this.cleanups) {
      c();
    }
  }
}
