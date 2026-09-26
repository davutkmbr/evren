/**
 * Underwater hull boxes of the vessels near the dragon (phase 21 stage 3): a plunging or swimming dragon bumps into
 * hulls instead of passing through them, and a plunge next to a ship is refused.
 *
 * One yawed box per vessel from its hull data: the design draft below the vessel's waterline (heave and ballast lift
 * included), the beam and the length shrunk a little for the tapered bow and stern. The top stays just below the sea
 * surface, so the boxes never become a floor to land on, change the surface under anything flying or swimming, or
 * block the camera; everything above the water is untouched. Registered in the collision world with the tag 'vessel'
 * and re-placed every frame with CollisionWorld.move() while the vessel is within `range` of the focus point.
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
 * rides at `waterline` m (heave + ballast lift) into `out`. Returns false when too little of the hull is submerged.
 */
export function hullBox(size: HullSize, x: number, z: number, yaw: number, waterline: number, out: BoxCollider): boolean {
  const bottom = waterline - size.draft;
  const top = Math.min(waterline, 0) - TOP_BELOW;
  if (top - bottom < MIN_DEPTH) {
    return false;
  }
  out.center.set(x, 0.5 * (top + bottom), z);
  out.halfSize.set(0.5 * size.beam * BEAM_SHARE, 0.5 * (top - bottom), 0.5 * size.length * LENGTH_SHARE);
  out.yaw = yaw;
  return true;
}

export function createHullBox(): BoxCollider {
  return { kind: 'box', center: new THREE.Vector3(), halfSize: new THREE.Vector3(), yaw: 0 };
}

/** What the registry needs of a vessel. */
export interface HullSource {
  readonly id: number;
  readonly model: HullSize;
  readonly state: { x: number; z: number; yaw: number };
  heave: number;
  lift: number;
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
      const st = v.state;
      const reach = this.range + 0.5 * v.model.length;
      const dx = st.x - focus.x;
      const dz = st.z - focus.z;
      if (dx * dx + dz * dz > reach * reach) {
        continue;
      }
      const slot = this.slots.get(v.id);
      const box = slot ? slot.box : this.scratch;
      if (!hullBox(v.model, st.x, st.z, st.yaw, v.heave + v.lift, box)) {
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
