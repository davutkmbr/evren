/**
 * Underwater hull boxes of the vessels near the dragon (phase 21 stage 3): a plunging or swimming dragon bumps into
 * hulls instead of passing through them, and a plunge next to a ship is refused.
 *
 * One yawed box per vessel from its hull data: the design draft below the vessel's waterline (heave and ballast lift
 * included), the beam and the length shrunk a little for the tapered bow and stern. The top stays just below the sea
 * surface, so the boxes never become a floor to land on, change the surface under anything flying or swimming, or
 * block the camera; everything above the water is untouched. Registered in the collision world with the tag 'vessel'
 * and re-placed every frame with CollisionWorld.move() while the vessel is within `range` of the focus point, following
 * the floating body's pose (position, heading, heave, and the roll / pitch through the keel depth; stage 7b).
 */
import * as THREE from 'three';
import type { Collider, CollisionWorld } from '../../../core/collision';

type BoxCollider = Extract<Collider, { kind: 'box' }>;

/** Hull dimensions (VesselModel subset). */
export interface HullSize {
  length: number;
  beam: number;
  draft: number;
}

/** Share of the length and beam the box keeps (the hull tapers toward bow and stern and at the bilge). */
const LENGTH_SHARE = 0.92;
const BEAM_SHARE = 0.9;
/** The box top stays this far below the calm sea surface. */
const TOP_BELOW = 0.05;
/** Hulls whose submerged part is thinner than this are skipped (m). */
const MIN_DEPTH = 0.3;

/**
 * Writes the underwater box of a hull at (x, z) with heading `yaw` (Object3D.rotation.y) whose design waterline
 * rides at `waterline` m (heave, ballast lift included) into `out`. `roll` / `pitch` (the floating body's, rad) tilt
 * the hull: the box stays yawed only (the collision world's boxes turn about +Y), but its bottom follows the lowest
 * keel corner of the tilted hull and its centre the tilted hull's underwater middle. Returns false when too little of
 * the hull is submerged.
 */
export function hullBox(size: HullSize, x: number, z: number, yaw: number, waterline: number, out: BoxCollider, roll = 0, pitch = 0): boolean {
  const halfBeam = 0.5 * size.beam * BEAM_SHARE;
  const halfLength = 0.5 * size.length * LENGTH_SHARE;
  const sr = Math.sin(roll);
  const sp = Math.sin(pitch);
  const bottom = waterline - size.draft * Math.cos(roll) * Math.cos(pitch) - halfBeam * Math.abs(sr) - halfLength * Math.abs(sp);
  const top = Math.min(waterline, 0) - TOP_BELOW;
  if (top - bottom < MIN_DEPTH) {
    return false;
  }
  // The middle of the submerged hull swings sideways / fore and aft with the tilt (half draft below the waterline).
  const lat = 0.5 * size.draft * sr;
  const lon = -0.5 * size.draft * sp;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  out.center.set(x + lat * cy + lon * sy, 0.5 * (top + bottom), z - lat * sy + lon * cy);
  out.halfSize.set(halfBeam, 0.5 * (top - bottom), halfLength);
  out.yaw = yaw;
  return true;
}

export function createHullBox(): BoxCollider {
  return { kind: 'box', center: new THREE.Vector3(), halfSize: new THREE.Vector3(), yaw: 0 };
}

/** What the registry needs of a vessel: its hull and the floating body's pose. */
export interface HullSource {
  readonly id: number;
  readonly model: HullSize;
  x: number;
  z: number;
  yaw: number;
  /** Heave of the design waterline (ballast lift included), roll, pitch. */
  heave: number;
  roll: number;
  pitch: number;
}

interface Slot {
  id: number;
  box: BoxCollider;
}

/** Keeps the hull boxes of the vessels within `range` of a focus point registered and in place. */
export class HullColliders {
  private readonly slots = new Map<number, Slot>();
  private readonly seen = new Set<number>();
  private readonly scratch = createHullBox();

  constructor(
    private readonly world: CollisionWorld,
    private readonly range = 900,
  ) {}

  get count(): number {
    return this.slots.size;
  }

  update(vessels: readonly HullSource[], focus: THREE.Vector3): void {
    const seen = this.seen;
    seen.clear();
    for (const v of vessels) {
      const reach = this.range + 0.5 * v.model.length;
      const dx = v.x - focus.x;
      const dz = v.z - focus.z;
      if (dx * dx + dz * dz > reach * reach) {
        continue;
      }
      const slot = this.slots.get(v.id);
      const box = slot ? slot.box : this.scratch;
      if (!hullBox(v.model, v.x, v.z, v.yaw, v.heave, box, v.roll, v.pitch)) {
        continue;
      }
      seen.add(v.id);
      if (slot) {
        this.world.move(slot.id, box);
      } else {
        const own = createHullBox();
        own.center.copy(box.center);
        own.halfSize.copy(box.halfSize);
        own.yaw = box.yaw;
        this.slots.set(v.id, { id: this.world.add(own, 'vessel', `life:vessel:${v.id}`), box: own });
      }
    }
    for (const [key, slot] of this.slots) {
      if (!seen.has(key)) {
        this.world.remove(slot.id);
        this.slots.delete(key);
      }
    }
  }

  dispose(): void {
    for (const slot of this.slots.values()) {
      this.world.remove(slot.id);
    }
    this.slots.clear();
  }
}
