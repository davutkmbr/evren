/**
 * Main-thread timing of the OSM region load path, behind `?osmprof=1` (off: one boolean test per call). Every span is
 * kept in `window.__osmProf.spans` and written as a user-timing measure (`osm:<label>`), so Chrome traces show it.
 */
import { devParams, exposeDebug } from '../../../core/dev-tools';

export const OSM_PROF = devParams().get('osmprof') === '1';

export interface OsmProfSpan {
  label: string;
  /** Start (performance.now()) and duration, ms. */
  t: number;
  ms: number;
}

const spans: OsmProfSpan[] = [];

if (OSM_PROF) {
  exposeDebug('__osmProf', {
    spans,
    reset: () => {
      spans.length = 0;
    },
  });
}

/** Records a span measured by the caller. */
export function osmProfSpan(label: string, t: number, ms: number): void {
  spans.push({ label, t, ms });
  performance.measure(`osm:${label}`, { start: t, duration: ms });
}

/** Runs `fn`, timed as `label` when profiling is on. */
export function osmProf<T>(label: string, fn: () => T): T {
  if (!OSM_PROF) {
    return fn();
  }
  const t = performance.now();
  try {
    return fn();
  } finally {
    osmProfSpan(label, t, performance.now() - t);
  }
}
