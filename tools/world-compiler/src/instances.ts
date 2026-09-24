/**
 * Prop instances of a tile (format 1): asset id (index.props), transform and variant. No glTF instancing extension:
 * runtimes build their own instanced draws from the manifest (one per prop, variant and primitive).
 */
import type { InstanceRec, XYZ } from './format';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const r5 = (v: number): number => Math.round(v * 100000) / 100000;

/** Quaternion [x, y, z, w] of a rotation by `theta` radians about +Y (counter-clockwise seen from above). */
export function yawQuat(theta: number): [number, number, number, number] {
  return [0, r5(Math.sin(theta / 2)), 0, r5(Math.cos(theta / 2))];
}

/**
 * Yaw (radians about +Y) that turns a model's forward axis to a compass heading (degrees, 0 = north = -Z, 90 = east).
 * `forward` is the model axis that should point along the heading.
 */
export function headingYaw(headingDeg: number, forward: '+Z' | '-Z' | '+X' | '-X' = '+Z'): number {
  const h = (headingDeg * Math.PI) / 180;
  // Direction of the heading: (sin h, -cos h). A yaw t turns +Z into (sin t, cos t) and +X into (cos t, -sin t).
  const base = { '+Z': Math.PI - h, '-Z': -h, '+X': Math.PI / 2 - h, '-X': -Math.PI / 2 - h }[forward];
  return Math.atan2(Math.sin(base), Math.cos(base));
}

/** Rotates a prop-local offset by a yaw (radians about +Y). */
export function rotateYaw(v: XYZ, theta: number): XYZ {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

export class InstanceSink {
  readonly list: InstanceRec[] = [];

  add(asset: string, position: XYZ, rotation: [number, number, number, number] = [0, 0, 0, 1], opts: { variant?: string; scale?: number | XYZ; ref?: string; seed?: number } = {}): InstanceRec {
    const rec: InstanceRec = { asset, position: [r3(position[0]), r3(position[1]), r3(position[2])], rotation };
    if (opts.variant) {
      rec.variant = opts.variant;
    }
    if (opts.scale !== undefined && opts.scale !== 1) {
      rec.scale = typeof opts.scale === 'number' ? r3(opts.scale) : (opts.scale.map(r3) as XYZ);
    }
    if (opts.ref) {
      rec.ref = opts.ref;
    }
    if (opts.seed !== undefined) {
      rec.seed = opts.seed;
    }
    this.list.push(rec);
    return rec;
  }
}
