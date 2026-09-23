/** Worker-side collectors for instanced street props and a simple "keep things apart" spatial check. */
import { FloatBuf } from '../shared/buffers';
import { BoxGrid } from '../shared/geometry';
import { PROP_KINDS, type PropKind } from './kinds';

/** INSTANCE_STRIDE records per prop kind plus a light type per instance (kinds.ts Light). */
export class PropSink {
  readonly records = {} as Record<PropKind, FloatBuf>;
  readonly lights = {} as Record<PropKind, FloatBuf>;

  constructor() {
    for (const k of PROP_KINDS) {
      this.records[k] = new FloatBuf(256);
      this.lights[k] = new FloatBuf(64);
    }
  }

  /** Adds an instance; `yaw` turns local +X towards the prop's front. */
  add(kind: PropKind, x: number, y: number, z: number, yaw: number, scale = 1, scaleY = 1, light = 0, tint: [number, number, number] = [1, 1, 1]): void {
    this.records[kind].push(x, y, z, yaw, scale, scaleY, tint[0], tint[1], tint[2]);
    this.lights[kind].push(light);
  }

  count(kind: PropKind): number {
    return this.lights[kind].length;
  }

  take(): { instances: Record<PropKind, Float32Array>; lights: Record<PropKind, Float32Array> } {
    const instances = {} as Record<PropKind, Float32Array>;
    const lights = {} as Record<PropKind, Float32Array>;
    for (const k of PROP_KINDS) {
      instances[k] = this.records[k].take();
      lights[k] = this.lights[k].take();
    }
    return { instances, lights };
  }
}

/** Yaw that turns local +X towards the direction (dx, dz). */
export function yawTowards(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

/** Points kept apart by a minimum distance (per query). */
export class Spacing {
  private readonly grid: BoxGrid;
  private readonly pts: number[] = [];

  constructor(private readonly reach = 16) {
    this.grid = new BoxGrid(reach);
  }

  /** True when no stored point is closer than `min` (m) to (x, z); `min` must not exceed the reach. */
  free(x: number, z: number, min: number): boolean {
    for (const id of this.grid.at(x, z)) {
      if ((this.pts[id * 2] - x) ** 2 + (this.pts[id * 2 + 1] - z) ** 2 < min * min) {
        return false;
      }
    }
    return true;
  }

  add(x: number, z: number): void {
    const id = this.pts.push(x, z) / 2 - 1;
    const r = this.reach;
    this.grid.add(id, x - r, z - r, x + r, z + r);
  }

  /** free() then add(); returns whether the point was taken. */
  claim(x: number, z: number, min: number): boolean {
    if (!this.free(x, z, min)) {
      return false;
    }
    this.add(x, z);
    return true;
  }
}

/** Calls fn(x, z, tx, tz, along) every `spacing` metres along a polyline, starting at `start`. */
export function walkLine(pts: readonly number[], spacing: number, start: number, fn: (x: number, z: number, tx: number, tz: number, along: number) => void): void {
  let carry = start;
  let along = 0;
  for (let k = 2; k < pts.length; k += 2) {
    const ax = pts[k - 2];
    const az = pts[k - 1];
    const len = Math.hypot(pts[k] - ax, pts[k + 1] - az);
    if (len < 1e-3) {
      continue;
    }
    const tx = (pts[k] - ax) / len;
    const tz = (pts[k + 1] - az) / len;
    let f = carry;
    while (f <= len) {
      fn(ax + tx * f, az + tz * f, tx, tz, along + f);
      f += spacing;
    }
    carry = f - len;
    along += len;
  }
}

/** Total length (m) of a polyline. */
export function lineLength(pts: readonly number[]): number {
  let l = 0;
  for (let k = 2; k < pts.length; k += 2) {
    l += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]);
  }
  return l;
}
