/** Minimal mutable 3-vector for the (worker side) tree generators. */
export class V3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  static of(x: number, y: number, z: number): V3 {
    return new V3(x, y, z);
  }

  clone(): V3 {
    return new V3(this.x, this.y, this.z);
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: V3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  add(v: V3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v: V3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  addScaled(v: V3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  dot(v: V3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  distanceTo(v: V3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  normalize(): this {
    const l = this.length();
    if (l > 1e-9) {
      this.x /= l;
      this.y /= l;
      this.z /= l;
    } else {
      this.set(0, 1, 0);
    }
    return this;
  }

  cross(v: V3): this {
    const x = this.y * v.z - this.z * v.y;
    const y = this.z * v.x - this.x * v.z;
    const z = this.x * v.y - this.y * v.x;
    return this.set(x, y, z);
  }

  lerp(v: V3, t: number): this {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }

  /** Rotates around the unit axis `a` by `angle` (Rodrigues). */
  rotateAround(a: V3, angle: number): this {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const d = this.dot(a) * (1 - c);
    const x = this.x * c + (a.y * this.z - a.z * this.y) * s + a.x * d;
    const y = this.y * c + (a.z * this.x - a.x * this.z) * s + a.y * d;
    const z = this.z * c + (a.x * this.y - a.y * this.x) * s + a.z * d;
    return this.set(x, y, z);
  }
}

/** Any unit vector perpendicular to the unit vector `d`. */
export function perpendicular(d: V3): V3 {
  const ref = Math.abs(d.y) < 0.95 ? V3.of(0, 1, 0) : V3.of(1, 0, 0);
  return ref.cross(d).normalize();
}

/** Direction from azimuth (around +Y, 0 = +X) and elevation above the horizontal plane. */
export function dirFromAngles(azimuth: number, elevation: number): V3 {
  const c = Math.cos(elevation);
  return V3.of(Math.cos(azimuth) * c, Math.sin(elevation), Math.sin(azimuth) * c);
}

export type Rng = () => number;

export function range(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

/** Approximately normal random value (mean 0, sd 1). */
export function gauss(rng: Rng): number {
  return (rng() + rng() + rng() + rng() - 2) * 1.7320508;
}
