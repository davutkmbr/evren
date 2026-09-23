import * as THREE from 'three';
import type { DragonRig, DragonState } from '../../core/contracts';
import { wingTipPosition } from './rig-anchors';

export const TRAIL_POINTS = 128;
const TRAIL_COUNT = 2;
const SEGMENT = 1.4;
const MAX_SAMPLE_INTERVAL = 0.09;
export const TRAIL_LIFE = 3.2;

interface TrailHistory {
  /** Ring of samples: x, y, z, birth, intensity. */
  data: Float32Array;
  head: number;
  count: number;
  lastX: number;
  lastY: number;
  lastZ: number;
  lastTime: number;
  intensity: number;
}

const STRIDE = 5;
const _tip = new THREE.Vector3();

/**
 * Wing-tip vortex condensation: vapour forms in the low-pressure vortex cores at high lift (g) or high speed in
 * humid air. Each tip keeps a distance-sampled history; the newest point is always the live tip so the ribbon
 * stays attached. The whole history (<= 2 × 128 points) is rewritten into a tiny float texture each frame.
 */
export class WingTrails {
  readonly texture: THREE.DataTexture;
  visible = false;
  private readonly texData: Float32Array;
  private readonly trails: TrailHistory[] = [];

  constructor() {
    this.texData = new Float32Array(TRAIL_POINTS * 2 * TRAIL_COUNT * 4);
    this.texture = new THREE.DataTexture(this.texData, TRAIL_POINTS * 2, TRAIL_COUNT, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    for (let i = 0; i < TRAIL_COUNT; i++) {
      this.trails.push({ data: new Float32Array(TRAIL_POINTS * STRIDE), head: 0, count: 0, lastX: 0, lastY: 0, lastZ: 0, lastTime: -1e9, intensity: 0 });
    }
  }

  /** Condensation strength 0..1 from load factor, speed and humidity (low altitude, over water, dawn/dusk). */
  static condensation(dragon: DragonState, humidity: number): number {
    const g = THREE.MathUtils.smoothstep(dragon.gForce, 1.7, 3.4);
    const v = THREE.MathUtils.smoothstep(dragon.airspeed, 42, 85) * 0.6;
    return THREE.MathUtils.clamp((g + v) * humidity, 0, 1);
  }

  update(now: number, dt: number, dragon: DragonState | undefined, rig: DragonRig | undefined, humidity: number): void {
    if (!dragon || !rig) {
      this.visible = false;
      return;
    }
    const target = WingTrails.condensation(dragon, humidity);
    let anyVisible = false;
    for (let i = 0; i < TRAIL_COUNT; i++) {
      const tr = this.trails[i];
      if (dt > 0) {
        tr.intensity += (target - tr.intensity) * (1 - Math.exp(-dt / 0.18));
      }
      wingTipPosition(rig, dragon, i === 0 ? 0 : 1, _tip);
      const dx = _tip.x - tr.lastX;
      const dy = _tip.y - tr.lastY;
      const dz = _tip.z - tr.lastZ;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 90 * 90) {
        tr.count = 0;
        tr.lastTime = -1e9;
      }
      if (dt > 0 && (d2 > SEGMENT * SEGMENT || now - tr.lastTime > MAX_SAMPLE_INTERVAL)) {
        const o = tr.head * STRIDE;
        tr.data[o] = _tip.x;
        tr.data[o + 1] = _tip.y;
        tr.data[o + 2] = _tip.z;
        tr.data[o + 3] = now;
        tr.data[o + 4] = tr.intensity;
        tr.head = (tr.head + 1) % (TRAIL_POINTS - 1);
        tr.count = Math.min(tr.count + 1, TRAIL_POINTS - 1);
        tr.lastX = _tip.x;
        tr.lastY = _tip.y;
        tr.lastZ = _tip.z;
        tr.lastTime = now;
      }
      if (this.writeRow(i, tr, now)) {
        anyVisible = true;
      }
    }
    this.visible = anyVisible;
    if (anyVisible) {
      this.texture.needsUpdate = true;
    }
  }

  /** Newest-first: point 0 = live tip, then samples. Returns true if any point is still visible. */
  private writeRow(row: number, tr: TrailHistory, now: number): boolean {
    const out = this.texData;
    const rowBase = row * TRAIL_POINTS * 2 * 4;
    let px = _tip.x;
    let py = _tip.y;
    let pz = _tip.z;
    let arc = 0;
    let visible = tr.intensity > 0.01;
    out[rowBase] = px;
    out[rowBase + 1] = py;
    out[rowBase + 2] = pz;
    out[rowBase + 3] = 0;
    out[rowBase + 4] = tr.intensity;
    out[rowBase + 5] = 0;
    out[rowBase + 6] = 0.1;
    out[rowBase + 7] = 1;
    let k = 1;
    for (let j = 0; j < tr.count && k < TRAIL_POINTS; j++, k++) {
      const idx = (tr.head - 1 - j + (TRAIL_POINTS - 1) * 2) % (TRAIL_POINTS - 1);
      const o = idx * STRIDE;
      const age = now - tr.data[o + 3];
      if (age > TRAIL_LIFE) {
        break;
      }
      const x = tr.data[o];
      const y = tr.data[o + 1];
      const z = tr.data[o + 2];
      arc += Math.hypot(x - px, y - py, z - pz);
      px = x;
      py = y;
      pz = z;
      const intensity = tr.data[o + 4];
      if (intensity > 0.01) {
        visible = true;
      }
      const b = rowBase + k * 8;
      out[b] = x;
      out[b + 1] = y;
      out[b + 2] = z;
      out[b + 3] = Math.max(age, 0);
      out[b + 4] = intensity;
      out[b + 5] = arc;
      out[b + 6] = 0.1;
      out[b + 7] = 1;
    }
    // Pad with degenerate copies of the last point (zero intensity): every ribbon vertex stays finite and the
    // padding segments have zero area, so no partially clipped triangles with undefined varyings can appear.
    for (; k < TRAIL_POINTS; k++) {
      const b = rowBase + k * 8;
      out[b] = px;
      out[b + 1] = py;
      out[b + 2] = pz;
      out[b + 3] = TRAIL_LIFE;
      out[b + 4] = 0;
      out[b + 5] = arc;
      out[b + 6] = 0.1;
      out[b + 7] = 0;
    }
    return visible;
  }

  rebase(delta: number): void {
    for (const tr of this.trails) {
      for (let j = 0; j < TRAIL_POINTS - 1; j++) {
        tr.data[j * STRIDE + 3] -= delta;
      }
      tr.lastTime -= delta;
    }
  }

  dispose(): void {
    this.texture.dispose();
  }
}
