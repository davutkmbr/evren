/**
 * Ground contact analysis over every render frame: one fixed skin vertex per foot (the lowest vertex of the hind feet
 * and of the wing thumbs, which the wyvern walks on, at the window's first frame) tracked through the whole run.
 * Reports how often each foot is planted, how fast it slides while planted (foot skate; ideally ~0) and how deep it
 * goes below the surface.
 */
import type { FrameRecord } from './runtime';
import { skinVertex, type MeshData } from './raster';

export const CONTACT_BONES = ['footR', 'footL', 'thumbR', 'thumbL'] as const;
/** A foot counts as planted below this height above the surface (m). */
const PLANTED = 0.04;

export interface FootTrack {
  bone: string;
  /** World position per record. */
  points: Float32Array;
}

export interface FootStats {
  bone: string;
  /** Fraction of the grounded frames the foot is planted. */
  planted: number;
  /** Median horizontal foot speed while planted (m/s; the median keeps a low, shuffling swing out of it). */
  slip: number;
  /** Mean horizontal body speed over the same frames (m/s). */
  bodySpeed: number;
  /** Lowest height above the surface (m, negative = below). */
  lowest: number;
  /** Highest lift of the foot during the grounded frames (m). */
  lift: number;
}

/** Tracks the lowest vertex (at `ref`) of each contact bone through all records. */
export function trackFeet(body: MeshData, boneNames: readonly string[], records: readonly FrameRecord[], ref: FrameRecord): FootTrack[] {
  const tmp = new Float32Array(3);
  const tracks: FootTrack[] = [];
  for (const name of CONTACT_BONES) {
    const b = boneNames.indexOf(name);
    let best = -1;
    let bestY = Infinity;
    for (let i = 0; i < body.count; i++) {
      if (body.dominant[i] !== b) {
        continue;
      }
      skinVertex(body, i, ref, tmp, 0);
      if (tmp[1] < bestY) {
        bestY = tmp[1];
        best = i;
      }
    }
    if (best < 0) {
      continue;
    }
    const points = new Float32Array(records.length * 3);
    records.forEach((r, k) => skinVertex(body, best, r, points, k * 3));
    tracks.push({ bone: name, points });
  }
  return tracks;
}

/** Contact statistics over the grounded records between t0 and t1 (s). */
export function footStats(tracks: readonly FootTrack[], records: readonly FrameRecord[], t0: number, t1: number): FootStats[] {
  return tracks.map((tr) => {
    let grounded = 0;
    let planted = 0;
    const slips: number[] = [];
    let bodySum = 0;
    let pairs = 0;
    let lowest = Infinity;
    let lift = -Infinity;
    for (let k = 1; k < records.length; k++) {
      const r = records[k];
      if (r.time < t0 || r.time > t1 || r.mode !== 'grounded') {
        continue;
      }
      grounded++;
      const h = tr.points[k * 3 + 1] - r.surfaceY;
      lowest = Math.min(lowest, h);
      lift = Math.max(lift, h);
      if (h > PLANTED) {
        continue;
      }
      planted++;
      const prevH = tr.points[(k - 1) * 3 + 1] - records[k - 1].surfaceY;
      if (prevH > PLANTED) {
        continue;
      }
      const dt = r.time - records[k - 1].time;
      const dx = tr.points[k * 3] - tr.points[(k - 1) * 3];
      const dz = tr.points[k * 3 + 2] - tr.points[(k - 1) * 3 + 2];
      slips.push(Math.hypot(dx, dz) / dt);
      bodySum += r.groundSpeed;
      pairs++;
    }
    const round = (v: number): number => Math.round(v * 100) / 100;
    return {
      bone: tr.bone,
      planted: grounded > 0 ? round(planted / grounded) : 0,
      slip: pairs > 0 ? round(slips.sort((a, b) => a - b)[Math.floor(pairs / 2)]) : 0,
      bodySpeed: pairs > 0 ? round(bodySum / pairs) : 0,
      lowest: lowest === Infinity ? 0 : round(lowest),
      lift: lift === -Infinity ? 0 : round(lift),
    };
  });
}
