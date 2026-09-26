/**
 * Where the ?escort= debug flag puts the dragon (pure TS): beside a vapur or city ferry in the middle of a crossing,
 * ~70 m off its beam on the more open side, a little astern of its centre, flying the ferry's heading, so the escort
 * offer shows at once.
 */
import type { MomentStartPose } from '../../moments/runtime';
import { inService, vesselAxes } from '../../moments/anchors';
import { vesselHeadingDeg, type EscortFerry } from './escort';

export interface EscortShortcut {
  pose: MomentStartPose;
  ferryId: number;
}

/** Offset of the dragon from the ferry's centre: abeam and astern (m), and its height above the sea. */
const ABEAM = 70;
const ASTERN = 15;
const HEIGHT = 30;
/** The ferry should have at least this far (m) to its next pier, so there is a crossing to escort. */
const MIN_PIER_DISTANCE = 900;

/** `coastDistance`: GeoQuery.coastDistance (negative over water). Null while no ferry is mid-crossing. */
export function escortShortcut(ferries: readonly EscortFerry[], coastDistance: (x: number, z: number) => number): EscortShortcut | null {
  let best: EscortFerry | null = null;
  let bestScore = -Infinity;
  for (const f of ferries) {
    const p = f.pose;
    if (!f.leg || f.leg.phase !== 'route' || !inService(p) || p.speed < 3.5) continue;
    const toPier = Math.hypot(p.x - f.leg.dockX, p.z - f.leg.dockZ);
    const { fx, fz } = vesselAxes(p);
    // Open water here and 300 m ahead, and a long way still to go.
    const open = Math.min(-coastDistance(p.x, p.z), -coastDistance(p.x + fx * 300, p.z + fz * 300));
    const score = open + Math.min(toPier, 3000) * 0.05 - (toPier < MIN_PIER_DISTANCE ? 1000 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  if (!best) {
    return null;
  }
  const p = best.pose;
  const { fx, fz, rx, rz } = vesselAxes(p);
  const cx = p.x - fx * ASTERN;
  const cz = p.z - fz * ASTERN;
  const side = coastDistance(cx + rx * ABEAM, cz + rz * ABEAM) <= coastDistance(cx - rx * ABEAM, cz - rz * ABEAM) ? 1 : -1;
  return {
    pose: { x: cx + rx * ABEAM * side, y: HEIGHT, z: cz + rz * ABEAM * side, headingDeg: vesselHeadingDeg(p), pitchDeg: 0, speed: 16 },
    ferryId: p.id,
  };
}
