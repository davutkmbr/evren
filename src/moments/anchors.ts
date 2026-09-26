/**
 * Moving anchors for moments (phase 19): objects of other systems a moment can be placed at, supplied to the pure
 * trigger evaluator every frame as `MomentContext.anchors[name]`. Today: 'ferry', the vapurs and city ferries in
 * service, read from the living world's 'life' service (world/life). Pure TS (no three.js, no DOM), so the headless
 * checks use the same selection.
 */
import type { LifeService, VesselPose } from '../core/contracts';
import type { MomentStartPose } from './runtime';
import type { AnchorPoint } from './triggers';

/** Anchor name → the vessel kinds it stands for. */
export const ANCHOR_KINDS: Readonly<Record<string, readonly string[]>> = {
  ferry: ['vapur', 'ferry'],
};

/** Anchor names the game supplies at runtime (a record anchored to another name still needs 'runtime-anchor'). */
export const RUNTIME_ANCHORS: ReadonlySet<string> = new Set(Object.keys(ANCHOR_KINDS));

/** A ferry counts as in service while underway on its line, going ahead faster than this (m/s). */
export const IN_SERVICE_SPEED = 2;

export function inService(p: VesselPose): boolean {
  return p.underway && p.speed > IN_SERVICE_SPEED;
}

/** Collects the anchor points every frame (entries and arrays reused). */
export class AnchorFeed {
  readonly points: Record<string, AnchorPoint[]> = {};
  private readonly poses: Record<string, VesselPose[]> = {};

  constructor() {
    for (const name of Object.keys(ANCHOR_KINDS)) {
      this.points[name] = [];
      this.poses[name] = [];
    }
  }

  /** Refreshes every anchor from the life service (empty lists without one). */
  update(life: LifeService | null | undefined): Readonly<Record<string, readonly AnchorPoint[]>> {
    for (const [name, kinds] of Object.entries(ANCHOR_KINDS)) {
      const out = this.points[name];
      const poses = life ? life.vessels(kinds, this.poses[name]) : [];
      let n = 0;
      for (const p of poses) {
        if (!inService(p)) continue;
        const a = (out[n] ??= { x: 0, z: 0, id: -1 });
        a.x = p.x;
        a.z = p.z;
        a.id = p.id;
        n++;
      }
      out.length = n;
    }
    return this.points;
  }

  /** Poses of an anchor's vessels from the last update (all of them, in service or not). */
  vesselsOf(name: string): readonly VesselPose[] {
    return this.poses[name] ?? [];
  }
}

/** Unit vectors of a vessel pose: forward (bow) and starboard, in world x/z. */
export function vesselAxes(p: Pick<VesselPose, 'yaw'>): { fx: number; fz: number; rx: number; rz: number } {
  const s = Math.sin(p.yaw);
  const c = Math.cos(p.yaw);
  return { fx: -s, fz: -c, rx: c, rz: -s };
}

export interface FerryShortcut {
  pose: MomentStartPose;
  anchorId: number;
}

/**
 * Where the ?moment= shortcut puts the dragon for a ferry moment: next to a ferry in service with open water around it,
 * hovering ~48 m off its beam on the more open side, a little ahead of the stern and facing it, so the stern and its
 * gulls drift past in front of the camera. `coastDistance` is GeoQuery.coastDistance (negative over water). Null
 * while no ferry is in service.
 */
export function ferryShortcut(poses: readonly VesselPose[], coastDistance: (x: number, z: number) => number): FerryShortcut | null {
  let best: VesselPose | null = null;
  let bestScore = -Infinity;
  for (const p of poses) {
    if (!inService(p) || p.speed < 3.5) continue;
    const { fx, fz } = vesselAxes(p);
    // Open water here and 200 m ahead: a ferry mid-crossing, not one about to dock.
    const score = Math.min(-coastDistance(p.x, p.z), -coastDistance(p.x + fx * 200, p.z + fz * 200));
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (!best) {
    return null;
  }
  const { fx, fz, rx, rz } = vesselAxes(best);
  const half = best.length / 2;
  // Stern (+Z in model space) and a point the stern reaches in ~5 s.
  const sx = best.x - fx * half + fx * best.speed * 5;
  const sz = best.z - fz * half + fz * best.speed * 5;
  const off = 48;
  const side = coastDistance(sx + rx * off, sz + rz * off) <= coastDistance(sx - rx * off, sz - rz * off) ? 1 : -1;
  const x = sx + rx * off * side;
  const z = sz + rz * off * side;
  // Face the ship, turned a little aft toward its wake.
  const lx = -rx * side - fx * 0.35;
  const lz = -rz * side - fz * 0.35;
  const headingDeg = ((Math.atan2(lx, -lz) * 180) / Math.PI + 360) % 360;
  return { pose: { x, y: 18, z, headingDeg, pitchDeg: 0, speed: 0 }, anchorId: best.id };
}
