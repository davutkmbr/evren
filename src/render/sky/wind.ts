import * as THREE from 'three';
import { hash2i } from '../../core/math/noise';

/**
 * Istanbul wind at ~100 m: mostly the north-easterly "poyraz" funnelled down the Bosphorus, occasionally the warm,
 * humid south-westerly "lodos". Slowly varying (minutes) with gusts (seconds). Speeds 3-12 m/s.
 * The regime also drives haze: poyraz brings clean Black Sea air, lodos brings hazy humid air.
 */
function smoothNoise(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return THREE.MathUtils.lerp(hash2i(i, seed), hash2i(i + 1, seed), u) * 2 - 1;
}

const POYRAZ_FROM_DEG = 32;
const LODOS_FROM_DEG = 218;

export class WindModel {
  /** World wind vector (m/s) at 100 m; points where the air moves to. */
  readonly vector = new THREE.Vector3();
  /** 0 = poyraz, 1 = lodos. */
  lodos = 0;
  private readonly poyrazVec = new THREE.Vector3();
  private readonly lodosVec = new THREE.Vector3();

  constructor(private readonly forced: 'poyraz' | 'lodos' | null = null) {}

  update(elapsed: number): void {
    const regimeNoise = smoothNoise(elapsed / 420 + 3.1, 11) * 0.6 + smoothNoise(elapsed / 150, 12) * 0.4;
    const target = this.forced === 'lodos' ? 1 : this.forced === 'poyraz' ? 0 : THREE.MathUtils.smoothstep(regimeNoise, 0.45, 0.75);
    this.lodos = target;

    const veer = smoothNoise(elapsed / 90, 21) * 18 + smoothNoise(elapsed / 17, 22) * 6;
    const base = 6.5 + smoothNoise(elapsed / 120, 31) * 2.5;
    const gust = smoothNoise(elapsed / 6, 32) * 1.2 + smoothNoise(elapsed / 2.3, 33) * 0.6;
    const speedP = base + gust;
    const speedL = base + 2 + gust * 1.3;
    setFrom(this.poyrazVec, POYRAZ_FROM_DEG + veer, speedP);
    setFrom(this.lodosVec, LODOS_FROM_DEG + veer * 0.8, speedL);
    this.vector.lerpVectors(this.poyrazVec, this.lodosVec, target);
    const speed = this.vector.length();
    const clamped = THREE.MathUtils.clamp(speed, 3, 12);
    if (speed > 1e-4) {
      this.vector.multiplyScalar(clamped / speed);
    } else {
      setFrom(this.vector, POYRAZ_FROM_DEG, 3);
    }
  }
}

/** Wind blowing FROM compass `fromDeg` (0 = north, clockwise) -> vector toward where the air moves. */
function setFrom(out: THREE.Vector3, fromDeg: number, speed: number): void {
  const toRad = THREE.MathUtils.degToRad(fromDeg + 180);
  out.set(Math.sin(toRad) * speed, 0, -Math.cos(toRad) * speed);
}
