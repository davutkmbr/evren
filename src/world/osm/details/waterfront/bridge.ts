/**
 * Galata Bridge life. The structures module models the bridge (world/landmarks/structures, golden-horn.ts): its deck
 * frame comes from the landmark anchors (origin between the bascule piers, axis towards pier B) and its upper deck
 * has raised walkways from 11.4 m to 21 m off the axis with the railing at 20.85 m. GalataDeck mirrors that frame,
 * samples the walkway heights once from the rendered deck (downward rays, like traffic/decks.ts) and places the row
 * of anglers along both railings (rods, lines, buckets, stools); the walk graph's deck lanes (crowd/graph.ts) are
 * lifted onto the same profile.
 */
import * as THREE from 'three';
import type { GeoQuery } from '../../../../core/contracts';
import { hash } from '../../shared/geometry';
import { Pose, STANDER_STRIDE, type DeckFrame } from '../protocol';

/** Walkway band (m off the axis) and railing offset of GALATA_SECTION. */
export const WALK_INNER = 11.4;
export const WALK_OUTER = 21;
const RAILING = 20.85;
/** Walkway profile sample spacing (m) and the lateral offset of the sampling rays. */
const STEP = 3;
const SAMPLE_X = 16;

export class GalataDeck {
  readonly frame: DeckFrame;
  private readonly rx: number;
  private readonly rz: number;
  /** Walkway height per STEP from frame.s0 - 20, per side (index 0: +x, 1: -x); NaN where no deck was hit. */
  private profile: [Float32Array, Float32Array] | null = null;
  private sStart = 0;

  private constructor(frame: DeckFrame) {
    this.frame = frame;
    this.rx = -frame.az;
    this.rz = frame.ax;
  }

  /** The deck of the 'galata-koprusu' landmark, or null when the landmark (or its anchors) is missing. */
  static fromGeo(geo: GeoQuery): GalataDeck | null {
    const a = geo.landmark('galata-koprusu')?.anchors;
    if (!a || a.length < 4) {
      return null;
    }
    const ox = (a[0].x + a[1].x) / 2;
    const oz = (a[0].z + a[1].z) / 2;
    const len = Math.hypot(a[1].x - ox, a[1].z - oz) || 1;
    const ax = (a[1].x - ox) / len;
    const az = (a[1].z - oz) / len;
    const sOf = (p: { x: number; z: number }): number => (p.x - ox) * ax + (p.z - oz) * az;
    const sEnd = [sOf(a[2]), sOf(a[3])];
    return new GalataDeck({ ox, oz, ax, az, s0: Math.min(...sEnd), s1: Math.max(...sEnd), piers: [sOf(a[0]), sOf(a[1])] });
  }

  get resolved(): boolean {
    return this.profile !== null;
  }

  /** World (x, z) of deck coordinates (s along the axis, x to the right). */
  point(s: number, x: number): [number, number] {
    const f = this.frame;
    return [f.ox + f.ax * s + this.rx * x, f.oz + f.az * s + this.rz * x];
  }

  /**
   * Samples the walkway heights from the structures batch; returns false while the bridge is not loaded yet. Parts
   * beyond the structures' draw distance are skipped by BatchedMesh.raycast, so every instance counts as visible
   * while sampling (internal flags, restored right away).
   */
  resolve(scene: THREE.Scene): boolean {
    if (this.profile) {
      return true;
    }
    const target = scene.getObjectByName('structures.opaque');
    if (!target) {
      return false;
    }
    const info = (target as unknown as { _instanceInfo?: { visible: boolean }[] })._instanceInfo ?? [];
    const saved = info.map((i) => i.visible);
    for (const i of info) {
      i.visible = true;
    }
    try {
      return this.sample(target);
    } finally {
      info.forEach((i, k) => {
        i.visible = saved[k];
      });
    }
  }

  private sample(target: THREE.Object3D): boolean {
    const f = this.frame;
    const ray = new THREE.Raycaster();
    ray.layers.enableAll();
    ray.far = 80;
    const down = new THREE.Vector3(0, -1, 0);
    const origin = new THREE.Vector3();
    const hits: THREE.Intersection[] = [];
    this.sStart = f.s0 - 20;
    const n = Math.ceil((f.s1 + 20 - this.sStart) / STEP) + 1;
    const sides: [Float32Array, Float32Array] = [new Float32Array(n).fill(NaN), new Float32Array(n).fill(NaN)];
    let found = 0;
    sides.forEach((h, side) => {
      for (let i = 0; i < n; i++) {
        const [x, z] = this.point(this.sStart + i * STEP, side ? -SAMPLE_X : SAMPLE_X);
        origin.set(x, 60, z);
        ray.set(origin, down);
        hits.length = 0;
        target.raycast(ray, hits);
        hits.sort((p, q) => p.distance - q.distance);
        for (const hit of hits) {
          const ny = hit.face ? Math.abs(hit.face.normal.y) : 1;
          if (ny > 0.8 && hit.point.y > 1 && hit.point.y < 30) {
            h[i] = hit.point.y;
            found++;
            break;
          }
        }
      }
    });
    if (found < n * 0.5) {
      return false;
    }
    this.profile = sides;
    return true;
  }

  /** Walkway height (m) at world (x, z) when it lies on the walkway band of the deck, else null. */
  walkwayAt(x: number, z: number): number | null {
    const f = this.frame;
    const dx = x - f.ox;
    const dz = z - f.oz;
    const across = dx * this.rx + dz * this.rz;
    if (!this.profile || Math.abs(across) < WALK_INNER - 0.3 || Math.abs(across) > WALK_OUTER) {
      return null;
    }
    return this.walkway(dx * f.ax + dz * f.az, across > 0 ? 1 : -1);
  }

  /** Walkway height at station s on side +1 / -1, or null off the deck. */
  walkway(s: number, side: number): number | null {
    const h = this.profile?.[side > 0 ? 0 : 1];
    if (!h) {
      return null;
    }
    const t = (s - this.sStart) / STEP;
    const i = Math.floor(t);
    if (i < 0 || i + 1 >= h.length) {
      return null;
    }
    const a = h[i];
    const b = h[i + 1];
    if (Number.isNaN(a) || Number.isNaN(b) || Math.abs(a - b) > 0.6) {
      return null;
    }
    return a + (b - a) * (t - i);
  }
}

export interface Anglers {
  standers: number[];
  mesh: THREE.BufferGeometry | null;
  count: number;
}

/** Rods, lines, buckets and stools merged into one vertex-coloured geometry (aGlow = 0). */
class GearBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];

  private tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color): void {
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    for (const p of [a, b, c]) {
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(n.x, n.y, n.z);
      this.col.push(color.r, color.g, color.b);
    }
  }

  /** Thin square-section stick from a to b. */
  stick(a: THREE.Vector3, b: THREE.Vector3, r: number, color: THREE.Color): void {
    const d = b.clone().sub(a).normalize();
    const t = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(d).normalize() : new THREE.Vector3(1, 0, 0).cross(d).normalize();
    const s = d.clone().cross(t).normalize();
    const ring = (p: THREE.Vector3): THREE.Vector3[] => [p.clone().addScaledVector(t, r), p.clone().addScaledVector(s, r), p.clone().addScaledVector(t, -r), p.clone().addScaledVector(s, -r)];
    const ra = ring(a);
    const rb = ring(b);
    for (let k = 0; k < 4; k++) {
      const k1 = (k + 1) % 4;
      this.tri(ra[k], ra[k1], rb[k1], color);
      this.tri(ra[k], rb[k1], rb[k], color);
    }
  }

  box(c: THREE.Vector3, sx: number, sy: number, sz: number, yaw: number, color: THREE.Color): void {
    this.geometry(new THREE.BoxGeometry(sx, sy, sz).rotateY(yaw).translate(c.x, c.y, c.z), color);
  }

  /** Upright cylinder (bucket, stool seat) with its base centre at `c`. */
  cylinder(c: THREE.Vector3, r0: number, r1: number, h: number, seg: number, color: THREE.Color): void {
    this.geometry(new THREE.CylinderGeometry(r1, r0, h, seg).translate(c.x, c.y + h / 2, c.z), color);
  }

  private geometry(src: THREE.BufferGeometry, color: THREE.Color): void {
    const g = src.toNonIndexed();
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(color.r, color.g, color.b);
    }
    src.dispose();
    g.dispose();
  }

  build(): THREE.BufferGeometry | null {
    if (!this.pos.length) {
      return null;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(new Float32Array(this.pos.length / 3), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * The row of anglers along both railings of the upper deck (clustered, clear of the bascule control towers and only
 * over water), plus friends and onlookers behind some of them. `coast`: signed coast distance (positive on land).
 */
export function placeAnglers(deck: GalataDeck, coast: (x: number, z: number) => number): Anglers {
  const standers: number[] = [];
  const gear = new GearBuilder();
  const rodCol = new THREE.Color(0x2b2b2b);
  const lineCol = new THREE.Color(0xd8d8d8);
  const bucketCols = [0x2c6fb7, 0xe8e8e8, 0xd9d9d9, 0xd9d9d9, 0x3d8c40, 0xc93a2a].map((c) => new THREE.Color(c));
  const stoolCols = [0x2b5fa8, 0x3a3a3a, 0xc23b2e, 0x2f7a45].map((c) => new THREE.Color(c));
  const legCol = new THREE.Color(0x3a3a3a);
  let count = 0;
  const f = deck.frame;
  for (const side of [1, -1]) {
    for (let s = f.s0 + 8; s < f.s1 - 8; s += 1.6) {
      if (f.piers.some((p) => Math.abs(s - p) < 7)) {
        continue;
      }
      const cluster = Math.sin(s * 0.045 + side * 1.3) * 0.5 + Math.sin(s * 0.13 + side) * 0.3;
      if (hash(s * 3.1 + side * 7) > 0.66 + 0.3 * cluster) {
        continue;
      }
      const y = deck.walkway(s, side);
      const [ox, oz] = deck.point(s, (RAILING + 3) * side);
      if (y === null || coast(ox, oz) > -2) {
        continue;
      }
      const inset = 0.55 + 0.2 * hash(s + side);
      const [x, z] = deck.point(s, (RAILING - inset) * side);
      const yaw = Math.atan2(ox - x, oz - z) + (hash(s * 1.7) - 0.5) * 0.35;
      const seed = Math.round(s * 13 + side * 1000);
      const sit = hash(s * 5.5 + side) < 0.18;
      standers.push(x, y, z, yaw, sit ? Pose.Sit : Pose.Fish, seed);
      count++;
      // Rod from the hands out over the railing, line down to the water.
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const hand = new THREE.Vector3(x + fx * 0.42, y + (sit ? 0.85 : 1.25), z + fz * 0.42);
      const reach = 3.2 + hash(s * 2.3) * 1.8;
      const tip = new THREE.Vector3(hand.x + fx * reach * 0.87, hand.y + reach * 0.5, hand.z + fz * reach * 0.87);
      gear.stick(hand.clone().addScaledVector(new THREE.Vector3(fx, 0.55, fz), -0.6), tip, 0.014, rodCol);
      gear.stick(tip, new THREE.Vector3(tip.x + fx * 0.8, 0.05, tip.z + fz * 0.8), 0.004, lineCol);
      if (sit) {
        // Low plastic stool: seat disc on four splayed legs (a tapered drum reads the same at a distance).
        const c = new THREE.Vector3(x - fx * 0.12, y, z - fz * 0.12);
        gear.cylinder(c, 0.17, 0.13, 0.4, 6, legCol);
        gear.cylinder(c.setY(y + 0.4), 0.16, 0.16, 0.035, 8, stoolCols[Math.floor(hash(s * 2.9) * stoolCols.length)]);
      }
      if (hash(s * 9.1 + side) < 0.6) {
        // Bait bucket beside the angler.
        const bx = x - fx * 0.25 + Math.cos(yaw) * 0.45;
        const bz = z - fz * 0.25 - Math.sin(yaw) * 0.45;
        gear.cylinder(new THREE.Vector3(bx, y, bz), 0.1, 0.13, 0.26, 8, bucketCols[Math.floor(hash(s * 4.4) * bucketCols.length)]);
      }
      // Friends and onlookers behind some anglers.
      if (hash(s * 6.6 + side * 2) < 0.12) {
        const [px, pz] = deck.point(s + 0.6, (RAILING - 2.2) * side);
        standers.push(px, y, pz, yaw + (hash(s) - 0.5) * 0.8, Pose.Stand, seed + 7);
      }
    }
  }
  return { standers, mesh: gear.build(), count };
}

/** Stander records of `placeAnglers` as a typed array (STANDER_STRIDE). */
export function standerArray(a: number[]): Float32Array {
  return Float32Array.from(a.slice(0, Math.floor(a.length / STANDER_STRIDE) * STANDER_STRIDE));
}
