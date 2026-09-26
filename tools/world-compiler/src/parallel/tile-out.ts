/**
 * What compiling one tile leaves behind, as a plain record: worker threads send it to the main thread, and the tile
 * cache stores it next to the tile's files. The main thread applies records in tile order (cli.ts applyTile), which
 * rebuilds exactly the state the serial loop leaves: refs, validation reports, used materials and props (replayed
 * through the main thread's texture and prop bakers, in the same order), counters and the step statistics that
 * live in AreaContext.shared.
 */
import type { GroundTotals } from '../core-steps';
import type { TileManifest, TileRef } from '../format';
import type { MaterialName } from '../materials';
import type { AreaContext } from '../registry';
import type { PlacementLog } from '../street/placement';
import type { ValidationSummary } from '../validate';

export interface TileStats {
  ground?: GroundTotals;
  placement?: PlacementLog['counts'];
}

export interface TileOut {
  id: string;
  /** No geometry: the tile is left out of the output. */
  empty: boolean;
  manifest?: TileManifest;
  ref?: TileRef;
  reports: ValidationSummary[];
  lightmapTexels: number[];
  dropped: number;
  stepMs: Record<string, number>;
  /** Materials the tile's LODs use, in first-use order (with their weather layers). */
  materials: MaterialName[];
  /** Props asked for by the tile's instances, in first-use order. */
  props: string[];
  stats: TileStats;
  /** Exit state per ordered step that ran on the tile (parallel/ordered.ts). */
  ordered: Record<string, unknown>;
  /** Files written, relative to the output folder. */
  files: string[];
  /** Assembly key of the tile cache (cache.ts TileCache), and the digest of the registry inputs it read. */
  key?: string;
  deps?: string;
  /** The result came from the tile cache; statsBefore: the area statistics before the tile (serial runs). */
  cached?: boolean;
  statsBefore?: TileStats;
}

/** A Set that also logs every add (in order): the tile loop's material list. */
export class LoggedSet<T> extends Set<T> {
  readonly log: T[] = [];
  override add(v: T): this {
    this.log?.push(v);
    return super.add(v);
  }
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

/** The step statistics in AreaContext.shared that tiles add to. */
export function statsOf(a: AreaContext): TileStats {
  const g = a.shared.get('ground') as GroundTotals | undefined;
  const p = a.shared.get('placementLog') as PlacementLog | undefined;
  return { ground: clone(g), placement: clone(p?.counts) };
}

/** after - before. */
export function statsDelta(before: TileStats, after: TileStats): TileStats {
  const out: TileStats = {};
  if (after.ground) {
    const b = before.ground ?? { kerbWallM: 0, quayWallM: 0, kerbStepM: [0, 0, 0, 0] };
    out.ground = { kerbWallM: after.ground.kerbWallM - b.kerbWallM, quayWallM: after.ground.quayWallM - b.quayWallM, kerbStepM: after.ground.kerbStepM.map((v, k) => v - (b.kerbStepM[k] ?? 0)) };
  }
  if (after.placement) {
    const d: PlacementLog['counts'] = {};
    for (const [rule, outcomes] of Object.entries(after.placement)) {
      for (const [o, n] of Object.entries(outcomes) as [keyof typeof outcomes, number][]) {
        const diff = n - (before.placement?.[rule]?.[o] ?? 0);
        if (diff) {
          (d[rule] ??= {})[o] = diff;
        }
      }
    }
    // Sorted: the delta is part of stage-cache digests, and the log's key order depends on what ran before.
    out.placement = Object.fromEntries(Object.entries(d).sort(([p], [q]) => (p < q ? -1 : 1)).map(([k, o]) => [k, Object.fromEntries(Object.entries(o).sort(([p], [q]) => (p < q ? -1 : 1)))]));
  }
  return out;
}

/** Adds a tile's statistics to the area's (the ground totals and the placement log exist after prepare). */
export function statsApply(a: AreaContext, s: TileStats, log: () => PlacementLog): void {
  const g = a.shared.get('ground') as GroundTotals | undefined;
  if (g && s.ground) {
    g.kerbWallM += s.ground.kerbWallM;
    g.quayWallM += s.ground.quayWallM;
    s.ground.kerbStepM.forEach((v, k) => (g.kerbStepM[k] += v));
  }
  for (const [rule, outcomes] of Object.entries(s.placement ?? {})) {
    for (const [o, n] of Object.entries(outcomes) as [Parameters<PlacementLog['note']>[1], number][]) {
      log().note(rule, o, n);
    }
  }
}

export function addInto(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) {
    into[k] = (into[k] ?? 0) + v;
  }
}

/** Sets the area's statistics back to a statsOf() snapshot. */
export function statsReset(a: AreaContext, s: TileStats): void {
  const g = a.shared.get('ground') as GroundTotals | undefined;
  if (g && s.ground) {
    g.kerbWallM = s.ground.kerbWallM;
    g.quayWallM = s.ground.quayWallM;
    g.kerbStepM = [...s.ground.kerbStepM];
  }
  const p = a.shared.get('placementLog') as PlacementLog | undefined;
  if (p) {
    for (const k of Object.keys(p.counts)) {
      delete p.counts[k];
    }
    Object.assign(p.counts, structuredClone(s.placement ?? {}));
  }
}
