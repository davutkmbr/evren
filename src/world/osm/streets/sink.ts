/** Worker-side collectors for instanced street props and a simple "keep things apart" spatial check. */
import { type StandGround, StandLog, type StandRule, standFault } from '../../placement/stand';
import { FloatBuf } from '../shared/buffers';
import { BoxGrid } from '../shared/geometry';
import { PROP_KINDS, type PropKind } from './kinds';

/**
 * Stand rule of each street prop kind (src/world/placement/stand.ts): masts, lanterns and signal poles stand on land,
 * outside buildings and off the carriageway; wall brackets hang on façades; bollards, platform furniture and
 * catenary masts may stand in the roadway (entry bollards, platforms and centre poles are placed there on purpose),
 * and wall brackets may overhang a kerbless lane.
 */
export const STREET_PROP_RULES: Record<PropKind, StandRule> = {
  lampArm: { offRoad: true },
  lampArmLow: { offRoad: true },
  lampDouble: { offRoad: true },
  lampLantern: { offRoad: true },
  lampWall: { building: false },
  signal: { offRoad: true },
  bollard: {},
  tramCanopy: {},
  ticketGate: {},
  catenaryCentre: {},
  catenarySide: {},
};

/** INSTANCE_STRIDE records per prop kind plus a light type per instance (kinds.ts Light). */
export class PropSink {
  readonly records = {} as Record<PropKind, FloatBuf>;
  readonly lights = {} as Record<PropKind, FloatBuf>;
  /** Outcome of every add() and fits() per kind (build stats). */
  readonly log = new StandLog();

  /** `ground`: every instance must stand on it (STREET_PROP_RULES); absent, instances are taken as placed. */
  constructor(private readonly ground?: StandGround) {
    for (const k of PROP_KINDS) {
      this.records[k] = new FloatBuf(256);
      this.lights[k] = new FloatBuf(64);
    }
  }

  /** Whether `kind` may stand at (x, z) (base `y` when given); a refusal is counted as dropped. */
  fits(kind: PropKind, x: number, z: number, y?: number): boolean {
    if (!this.ground) {
      return true;
    }
    const fault = standFault(this.ground, x, z, STREET_PROP_RULES[kind], y);
    if (fault) {
      this.log.note(kind, fault);
    }
    return fault === null;
  }

  /** Adds an instance unless it may not stand there (fits()); `yaw` turns local +X towards the prop's front. */
  add(kind: PropKind, x: number, y: number, z: number, yaw: number, scale = 1, scaleY = 1, light = 0, tint: [number, number, number] = [1, 1, 1]): boolean {
    if (!this.fits(kind, x, z, y)) {
      return false;
    }
    this.log.note(kind, 'kept');
    this.records[kind].push(x, y, z, yaw, scale, scaleY, tint[0], tint[1], tint[2]);
    this.lights[kind].push(light);
    return true;
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
