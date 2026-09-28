/**
 * Time-sliced main-thread work of the OSM regions. A worker result used to be turned into meshes, LOD structures and
 * colliders in one go (91–99 ms near Kadıköy, .docs/planning/28-frame-budget.md); now each layer hands its upload in
 * as a generator that yields between steps, and OsmSystem runs the queue for OSM_JOB_BUDGET_MS per frame.
 *
 * A step is the unit of work between two yields, so it should stay well under the budget (a few hundred colliders,
 * one mesh). Jobs run in order; a job's owner counts it as pending until it finishes (the region stays hidden, its
 * colliders arrive before the region can be activated). Cancelled jobs (their layer disposed) are dropped unfinished.
 */
import { OSM_PROF, osmProfSpan } from './prof';

/** Main-thread time (ms) the queue may spend per frame. */
export const OSM_JOB_BUDGET_MS = 2.5;

export interface OsmJob {
  /** Resolves when the job has run to its end (or was cancelled). */
  readonly done: Promise<void>;
  cancel(): void;
}

interface Entry {
  /** Dropped when the job ends: the generator keeps its whole frame (e.g. a worker result) alive. */
  steps: Iterator<unknown> | null;
  label: string;
  cancelled: boolean;
  finish: () => void;
  fail: (e: unknown) => void;
}

const queue: Entry[] = [];

/** Queues `steps` (a generator: work, yield, work, ...). */
export function queueOsmJob(label: string, steps: Iterator<unknown>): OsmJob {
  let entry: Entry;
  const done = new Promise<void>((resolve, reject) => {
    entry = { steps, label, cancelled: false, finish: resolve, fail: reject };
  });
  queue.push(entry!);
  return {
    done,
    cancel: () => {
      entry.cancelled = true;
    },
  };
}

/** Runs queued steps until `budgetMs` is spent (at least one step when anything is queued). */
export function runOsmJobs(budgetMs = OSM_JOB_BUDGET_MS): void {
  const t0 = performance.now();
  while (queue.length) {
    const e = queue[0];
    if (e.cancelled || !e.steps) {
      queue.shift();
      e.steps = null;
      e.finish();
      continue;
    }
    const steps = e.steps;
    let end = false;
    try {
      const ts = performance.now();
      const r = steps.next();
      end = r.done === true;
      if (OSM_PROF) {
        // A step is named by the value it yields (e.g. `yield 'colliders'`).
        osmProfSpan(`job:${e.label}${typeof r.value === 'string' ? `:${r.value}` : ''}`, ts, performance.now() - ts);
      }
    } catch (err) {
      queue.shift();
      e.steps = null;
      e.fail(err);
      continue;
    }
    if (end) {
      queue.shift();
      e.steps = null;
      e.finish();
    }
    if (performance.now() - t0 >= budgetMs) {
      return;
    }
  }
}

/** Jobs waiting or running (debug). */
export function osmJobCount(): number {
  return queue.length;
}

/** Runs `fn` as one queued step (inside a frame's budget) and resolves with its result. */
export function osmStep<T>(label: string, fn: () => T): Promise<T> {
  let out: T;
  const job = queueOsmJob(
    label,
    (function* (): Generator<string> {
      out = fn();
    })(),
  );
  return job.done.then(() => out);
}
