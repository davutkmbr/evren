/**
 * Ghost replay of the best run (pure math, no three.js): time → position by interpolating the recorded samples, and
 * the live time gap between the racer and the ghost.
 *
 * The recorder (records.ts) samples the path at GHOST_HZ from GO, so sample i sits at i / GHOST_HZ seconds of race
 * time. The gap compares progress along the course (gate index + fraction along the leg, see courseProgress): the
 * ghost's progress per sample comes from the record's splits (which leg it is on) and its projection onto that leg,
 * made non-decreasing so the inverse (progress → time) is well defined.
 */
import type { CompiledCourse } from './courses';
import { courseProgress, type Vec3 } from './race';
import { GHOST_HZ } from './records';

export class GhostTrack {
  /** Positions [x0, y0, z0, …] at `hz`. */
  readonly samples: Float32Array;
  readonly hz: number;
  readonly count: number;
  /** Seconds covered by the samples. */
  readonly duration: number;
  /** Race time at which the ghost finished (the record time), or the sample duration without one. */
  readonly finishTime: number;
  /** Course progress per sample (non-decreasing). Empty without a course. */
  private readonly progress: Float32Array;

  constructor(samples: Float32Array, opts: { hz?: number; course?: CompiledCourse; splits?: readonly number[]; finishTime?: number } = {}) {
    this.samples = samples;
    this.hz = opts.hz ?? GHOST_HZ;
    this.count = Math.floor(samples.length / 3);
    this.duration = this.count > 1 ? (this.count - 1) / this.hz : 0;
    this.finishTime = opts.finishTime ?? this.duration;
    const course = opts.course;
    const splits = opts.splits;
    this.progress = new Float32Array(course && splits ? this.count : 0);
    if (course && splits) {
      const p: Vec3 = { x: 0, y: 0, z: 0 };
      let leg = 0;
      let last = 0;
      for (let i = 0; i < this.count; i++) {
        const t = i / this.hz;
        while (leg < splits.length && splits[leg] <= t) {
          leg++;
        }
        p.x = samples[i * 3];
        p.y = samples[i * 3 + 1];
        p.z = samples[i * 3 + 2];
        last = Math.max(last, courseProgress(course, leg, p));
        this.progress[i] = last;
      }
    }
  }

  /** True when the track has enough samples to replay. */
  get valid(): boolean {
    return this.count >= 2;
  }

  /**
   * Writes the ghost position at race time `t` (s) into `out` (linear interpolation, clamped to the recorded range).
   * Returns false when the track is empty.
   */
  positionAt(t: number, out: Vec3): boolean {
    if (this.count === 0) {
      return false;
    }
    const f = Math.max(0, Math.min(this.count - 1, t * this.hz));
    const i = Math.min(this.count - 2, Math.floor(f));
    if (i < 0) {
      out.x = this.samples[0];
      out.y = this.samples[1];
      out.z = this.samples[2];
      return true;
    }
    const k = f - i;
    const s = this.samples;
    const a = i * 3;
    const b = a + 3;
    out.x = s[a] + (s[b] - s[a]) * k;
    out.y = s[a + 1] + (s[b + 1] - s[a + 1]) * k;
    out.z = s[a + 2] + (s[b + 2] - s[a + 2]) * k;
    return true;
  }

  /**
   * Race time at which the ghost first reached course progress `p` (interpolated between samples), or null when it
   * never got that far in the samples (or the track has no progress data).
   */
  timeAtProgress(p: number): number | null {
    const prog = this.progress;
    const n = prog.length;
    if (n === 0 || p > prog[n - 1]) {
      return null;
    }
    if (p <= prog[0]) {
      return 0;
    }
    // First sample with progress >= p (binary search; progress is non-decreasing).
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (prog[mid] >= p) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    const b = lo;
    const a = b - 1;
    const span = prog[b] - prog[a];
    const k = span > 1e-9 ? (p - prog[a]) / span : 1;
    return (a + k) / this.hz;
  }
}

/**
 * Time gap to the ghost (s) for a racer at course progress `progress` after `elapsed` s: negative = ahead of the ghost
 * (reached this point sooner), positive = behind. When the ghost's samples end before this progress (the racer is
 * past its last recorded point) the ghost's finish time is the reference. Null without progress data.
 */
export function ghostGap(track: GhostTrack, elapsed: number, progress: number): number | null {
  const t = track.timeAtProgress(progress);
  if (t !== null) {
    return elapsed - t;
  }
  return track.valid && track.timeAtProgress(0) !== null ? elapsed - track.finishTime : null;
}
