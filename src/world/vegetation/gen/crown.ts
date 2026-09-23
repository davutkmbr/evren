import { V3 } from './vec3';

/**
 * Crown envelope used for baked ambient occlusion and bent (volumetric) foliage normals.
 * Ellipsoid centred on the trunk axis; `cylinder` makes it a vertical spindle (cypress).
 */
export class CrownVolume {
  constructor(
    readonly centerY: number,
    readonly radiusXZ: number,
    readonly radiusY: number,
    readonly treeHeight: number,
    readonly crownBase: number,
    readonly cylinder = false,
    /** Occlusion at the crown centre (dense crowns are darker inside). */
    readonly innerAO = 0.3,
  ) {}

  /** Normalised radius: 0 at the centre, 1 on the envelope. */
  depth(p: V3): number {
    const dx = p.x / this.radiusXZ;
    const dz = p.z / this.radiusXZ;
    if (this.cylinder) {
      const t = Math.hypot(dx, dz);
      return t;
    }
    const dy = (p.y - this.centerY) / this.radiusY;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** Baked ambient occlusion for a point of the tree. */
  ao(p: V3, isFoliage: boolean): number {
    const t = this.depth(p);
    const s = Math.min(Math.max((t - 0.1) / 0.95, 0), 1);
    let ao = this.innerAO + (1 - this.innerAO) * s * s * (3 - 2 * s);
    // Lower crown and trunk receive less sky light.
    const lo = this.centerY - this.radiusY;
    const hi = this.centerY + this.radiusY;
    const v = Math.min(Math.max((p.y - lo) / (hi - lo), 0), 1);
    ao *= 0.7 + 0.3 * v;
    if (!isFoliage && p.y < this.crownBase) {
      ao = Math.min(ao, 0.62 + 0.28 * Math.min(Math.max(p.y / Math.max(this.crownBase, 0.5), 0), 1));
    }
    return Math.min(Math.max(ao, 0.12), 1);
  }

  /** Outward normal of the envelope through p (ellipsoid gradient). */
  radial(p: V3, out: V3): V3 {
    if (this.cylinder) {
      out.set(p.x, 0.25 * (p.y - this.centerY) / this.radiusY, p.z);
    } else {
      const rx2 = this.radiusXZ * this.radiusXZ;
      const ry2 = this.radiusY * this.radiusY;
      out.set(p.x / rx2, (p.y - this.centerY) / ry2, p.z / rx2);
    }
    if (out.length() < 1e-6) {
      out.set(0, 1, 0);
    }
    return out.normalize();
  }

  /** Trunk bend weight: 0 at the base, 1 at the top. */
  bendWeight(y: number): number {
    const t = Math.min(Math.max(y / this.treeHeight, 0), 1.2);
    return Math.pow(t, 1.7);
  }
}

const _r = new V3();

/** Blends a card/geometric normal toward the crown's radial direction. */
export function bentNormal(crown: CrownVolume, p: V3, n: V3, amount: number, out: V3): V3 {
  crown.radial(p, _r);
  const flip = n.dot(_r) < 0 ? -1 : 1;
  out.set(n.x * flip, n.y * flip, n.z * flip).lerp(_r, amount);
  return out.normalize();
}
