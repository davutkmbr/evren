import type { LifeService, VesselPose } from '../../core/contracts';
import type { Flocks } from './birds/flocks';
import type { Vessel } from './vessels/agents';
import type { Fleet } from './vessels/fleet';

/** What the service reads from the life system (the fleet and the flocks are rebuilt on quality changes). */
export interface LifeServiceSource {
  readonly fleet: Fleet | null;
  readonly flocks: Flocks | null;
}

/** Writes a vessel's render pose (the floating body) into `out`. */
export function writeVesselPose(v: Vessel, out: VesselPose): VesselPose {
  const st = v.state;
  out.id = v.id;
  out.kind = v.model.kind;
  out.x = v.x;
  out.z = v.z;
  out.yaw = v.yaw;
  out.heave = v.heave;
  out.speed = st.astern ? -st.speed : st.speed;
  out.underway = st.mode === 'underway' && !v.stationary;
  out.length = v.model.length;
  out.beam = v.model.beam;
  out.draft = v.model.draft;
  out.airDraft = v.model.airDraft;
  return out;
}

export function blankVesselPose(): VesselPose {
  return { id: -1, kind: '', x: 0, z: 0, yaw: 0, heave: 0, speed: 0, underway: false, length: 1, beam: 1, draft: 0, airDraft: 1 };
}

/**
 * The 'life' service: vessel poses for systems that anchor to moving boats (src/moments) and the hand-over of a
 * ferry's ambient gulls to a moment's own flock (and back), so no bird pops in or out. Borrowed flocks stay dormant
 * across a flock rebuild (quality change).
 */
export function createLifeService(src: LifeServiceSource): LifeService {
  const borrowed = new Set<number>();
  let flocksSeen: Flocks | null = null;
  const scratch = new Float32Array(6 * 64);
  const syncBorrowed = (): Flocks | null => {
    const f = src.flocks;
    if (f && f !== flocksSeen) {
      flocksSeen = f;
      for (const id of borrowed) f.borrowVesselFlock(id, scratch);
    }
    return f;
  };
  const find = (id: number): Vessel | undefined => {
    const vessels = src.fleet?.vessels;
    if (!vessels) return undefined;
    const v = vessels[id];
    return v && v.id === id ? v : vessels.find((x) => x.id === id);
  };
  return {
    vessels(kinds, out) {
      let n = 0;
      for (const v of src.fleet?.vessels ?? []) {
        if (!kinds.includes(v.model.kind)) continue;
        out[n] ??= blankVesselPose();
        writeVesselPose(v, out[n++]);
      }
      out.length = n;
      return out;
    },
    vessel(id, out) {
      const v = find(id);
      return v ? writeVesselPose(v, out) : null;
    },
    borrowGulls(id, out) {
      const f = syncBorrowed();
      borrowed.add(id);
      return f ? f.borrowVesselFlock(id, out) : 0;
    },
    returnGulls(id, states, count) {
      const f = syncBorrowed();
      borrowed.delete(id);
      f?.returnVesselFlock(id, states, count);
    },
  };
}
