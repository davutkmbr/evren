/**
 * Accumulates emissive light sprites (street lamps, aviation lights, LED points, lanterns) rendered in a single
 * additive instanced draw (render/lights.ts). Layout: see LIGHT_STRIDE in types.ts.
 */
import type * as THREE from 'three';
import { LIGHT_STRIDE } from '../types';
import { LightMode } from './surfaces';

export type Vec4 = readonly [number, number, number, number];

export class LightList {
  private data = new Float32Array(LIGHT_STRIDE * 512);
  private count = 0;

  get length(): number {
    return this.count;
  }

  /**
   * @param color linear radiance (already multiplied by intensity)
   * @param size physical radius of the glowing element (m)
   * @param params mode parameters p0..p3 (see LightMode)
   * @param aux a0..a3 (traffic lane vector + bulge)
   */
  add(p: THREE.Vector3, color: readonly [number, number, number], size: number, mode: number = LightMode.Night, params: Vec4 = [0, 0, 0, 0], aux: Vec4 = [0, 0, 0, 0]): void {
    if ((this.count + 1) * LIGHT_STRIDE > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const o = this.count * LIGHT_STRIDE;
    const d = this.data;
    d[o] = p.x;
    d[o + 1] = p.y;
    d[o + 2] = p.z;
    d[o + 3] = color[0];
    d[o + 4] = color[1];
    d[o + 5] = color[2];
    d[o + 6] = size;
    d[o + 7] = mode;
    d[o + 8] = params[0];
    d[o + 9] = params[1];
    d[o + 10] = params[2];
    d[o + 11] = params[3];
    d[o + 12] = aux[0];
    d[o + 13] = aux[1];
    d[o + 14] = aux[2];
    d[o + 15] = aux[3];
    this.count++;
  }

  /** Red medium-intensity obstruction light (ICAO type B, 20-60 flashes/min). */
  aviation(p: THREE.Vector3, phase: number, period = 1.5, strength = 1): void {
    this.add(p, [140 * strength, 4 * strength, 2 * strength], 0.3, LightMode.Blink, [period, phase, 0.28, 0]);
  }

  /** Steady red low-intensity obstruction light (ICAO type A). */
  obstruction(p: THREE.Vector3, strength = 1): void {
    this.add(p, [40 * strength, 1.2 * strength, 0.6 * strength], 0.18, LightMode.Night);
  }

  build(): Float32Array {
    return this.data.slice(0, this.count * LIGHT_STRIDE);
  }
}
