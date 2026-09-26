/**
 * Stage timers of the compiler (summary `perf`): wall milliseconds per stage label, summed over calls. Worker threads
 * keep their own totals and send them back with their tile results (parallel/pool.ts), so the summary shows CPU time
 * per stage across every thread next to the wall time of the run.
 */
const totals = new Map<string, number>();

export function perfAdd(label: string, ms: number): void {
  totals.set(label, (totals.get(label) ?? 0) + ms);
}

export async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const t = performance.now();
  try {
    return await run();
  } finally {
    perfAdd(label, performance.now() - t);
  }
}

export function timedSync<T>(label: string, run: () => T): T {
  const t = performance.now();
  try {
    return run();
  } finally {
    perfAdd(label, performance.now() - t);
  }
}

/** Current totals (ms, rounded), largest first. */
export function perfReport(): Record<string, number> {
  return Object.fromEntries([...totals].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)]));
}

/** Adds another thread's totals. */
export function perfMerge(other: Record<string, number>): void {
  for (const [k, v] of Object.entries(other)) {
    perfAdd(k, v);
  }
}

export function perfSnapshot(): Record<string, number> {
  return Object.fromEntries(totals);
}

/** Totals added since `before` (a perfSnapshot). */
export function perfSince(before: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of totals) {
    const d = v - (before[k] ?? 0);
    if (d > 0) {
      out[k] = d;
    }
  }
  return out;
}
