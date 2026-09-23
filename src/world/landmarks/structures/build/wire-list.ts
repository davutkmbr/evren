/**
 * Accumulates thin cylindrical elements (cables, hangers, stays, railings, antennas) rendered by the
 * anti-aliased wire renderer (render/wires.ts). Layout: see WIRE_STRIDE in types.ts.
 */
import type * as THREE from 'three';
import { WIRE_STRIDE } from '../types';
import type { Rgb } from './surfaces';

export interface WireLed {
  group: number;
  /** LED coordinate (0..1 along the structure) at the wire's start and end. */
  u0: number;
  u1: number;
  strength: number;
}

export interface WireOptions {
  led?: WireLed;
  /** Camera distance range (m) over which the wire fades out (small details). Default: never. */
  fade?: readonly [number, number];
}

export class WireList {
  private data = new Float32Array(WIRE_STRIDE * 1024);
  private count = 0;

  get length(): number {
    return this.count;
  }

  add(a: THREE.Vector3, b: THREE.Vector3, radius: number, color: Rgb, opts: WireOptions = {}): void {
    if (a.distanceToSquared(b) < 1e-8) {
      return;
    }
    this.addRaw(a.x, a.y, a.z, b.x, b.y, b.z, radius, color, opts);
  }

  addRaw(ax: number, ay: number, az: number, bx: number, by: number, bz: number, radius: number, color: Rgb, opts: WireOptions = {}): void {
    if ((this.count + 1) * WIRE_STRIDE > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const o = this.count * WIRE_STRIDE;
    const d = this.data;
    const led = opts.led;
    d[o] = ax;
    d[o + 1] = ay;
    d[o + 2] = az;
    d[o + 3] = bx;
    d[o + 4] = by;
    d[o + 5] = bz;
    d[o + 6] = radius;
    d[o + 7] = color[0];
    d[o + 8] = color[1];
    d[o + 9] = color[2];
    d[o + 10] = led ? led.group : 0;
    d[o + 11] = led ? led.u0 : 0;
    d[o + 12] = led ? led.u1 : 0;
    d[o + 13] = led ? led.strength : 0;
    d[o + 14] = opts.fade ? opts.fade[0] : 1e9;
    d[o + 15] = opts.fade ? opts.fade[1] : 2e9;
    this.count++;
  }

  /** Polyline; the LED coordinate is interpolated linearly along it. */
  polyline(points: readonly THREE.Vector3[], radius: number, color: Rgb, opts: WireOptions = {}): void {
    const n = points.length;
    const led = opts.led;
    for (let i = 0; i < n - 1; i++) {
      const sub = led
        ? { ...led, u0: led.u0 + ((led.u1 - led.u0) * i) / (n - 1), u1: led.u0 + ((led.u1 - led.u0) * (i + 1)) / (n - 1) }
        : undefined;
      this.add(points[i], points[i + 1], radius, color, { led: sub, fade: opts.fade });
    }
  }

  build(): Float32Array {
    return this.data.slice(0, this.count * WIRE_STRIDE);
  }
}
