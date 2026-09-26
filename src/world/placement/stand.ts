/**
 * The one "may a prop stand here?" rule shared by every placer: the procedural city, the OSM slice layers and the
 * world compiler (tools/world-compiler/src/street/placement.ts). Lamps, trees, benches, bins, bollards, signals,
 * parked cars and the like ask standFault() with the ground they are placed on and either keep the spot, move to
 * another one (e.g. the land side of a coastal road) or are dropped; StandLog counts the outcomes per system.
 *
 * A prop stands when:
 * - the ground fields are valid at the spot (`covers`): lookups outside a data window clamp to its edge, so a lamp
 *   placed beyond it would take the edge's height (floating or buried) and the edge's coast (land over the sea);
 * - it is on land, `shore` metres or more from the coastline, and the rendered ground is not below sea level;
 * - its base sits on the rendered ground (|base - ground| <= tolerance) when the caller passes a base height;
 * - optionally: outside building footprints, and off vehicular carriageways.
 * Pure (no three.js), so workers and the compiler import it too.
 */

/** Ground a placer stands props on. */
export interface StandGround {
  /** Signed distance (m) to the coastline, positive on land. */
  coast(x: number, z: number): number;
  /** Height (m) of the rendered ground (terrain, or the street layer's ground where it replaces the terrain). */
  ground(x: number, z: number): number;
  /** Whether coast() and ground() are valid at (x, z) (inside their data window); everywhere when absent. */
  covers?(x: number, z: number): boolean;
  /** Inside a building footprint. */
  inBuilding?(x: number, z: number): boolean;
  /** On a vehicular carriageway (pedestrian streets do not count). */
  onCarriageway?(x: number, z: number): boolean;
}

/** What a prop needs from its spot. */
export interface StandRule {
  /** Minimum distance (m) from the coastline (default SHORE_MARGIN). */
  shore?: number;
  /** Must be outside building footprints (default true; false for wall brackets and rooftop props). */
  building?: boolean;
  /** Must be off vehicular carriageways (default false: kerb, median and lane rules stay with the placer). */
  offRoad?: boolean;
  /** Allowed |base - ground| (m) when a base height is checked (default BASE_TOLERANCE). */
  tolerance?: number;
}

export type StandFault = 'outside' | 'water' | 'shore' | 'building' | 'carriageway' | 'float' | 'buried';

/** Default coastline margin (m): the geo coast grid is ~23 m, so a prop keeps a metre from the interpolated shore. */
export const SHORE_MARGIN = 1;
/** Rendered ground below this height (m) is under water. */
export const SEA_LEVEL = 0;
/** Default base tolerance (m): props are sunk by a few centimetres into the ground they stand on. */
export const BASE_TOLERANCE = 0.4;
/**
 * Clearance (m) of a pole's base (lamp masts, signal and stop poles) behind the kerb line: the 0.15 m kerb stone plus
 * the base plate. The runtime kerb masts (osm/streets/lamps.ts, whose lamp records the world compiler also places) and
 * the compiler's placement rule prop.pole share it.
 */
export const POLE_KERB = 0.3;

/** Why a prop following `rule` may not stand at (x, z) with its base at `baseY` (optional), or null when it may. */
export function standFault(g: StandGround, x: number, z: number, rule: StandRule = {}, baseY?: number): StandFault | null {
  if (g.covers && !g.covers(x, z)) {
    return 'outside';
  }
  const c = g.coast(x, z);
  if (c < 0) {
    return 'water';
  }
  if (c < (rule.shore ?? SHORE_MARGIN)) {
    return 'shore';
  }
  const h = g.ground(x, z);
  if (h < SEA_LEVEL) {
    return 'water';
  }
  if ((rule.building ?? true) && g.inBuilding?.(x, z)) {
    return 'building';
  }
  if (rule.offRoad && g.onCarriageway?.(x, z)) {
    return 'carriageway';
  }
  if (baseY !== undefined) {
    const tol = rule.tolerance ?? BASE_TOLERANCE;
    if (baseY - h > tol) {
      return 'float';
    }
    if (h - baseY > tol) {
      return 'buried';
    }
  }
  return null;
}

/**
 * First spot from (x, z) stepping along (dx, dz) (unit) by `step` m up to `reach` m where the prop may stand, or null.
 * Placers use it to move a roadside prop to the land side (dx, dz pointing across the road, away from the water).
 */
export function standAlong(g: StandGround, x: number, z: number, dx: number, dz: number, reach: number, rule: StandRule = {}, step = 0.5): [number, number] | null {
  for (let t = 0; t <= reach + 1e-6; t += step) {
    const px = x + dx * t;
    const pz = z + dz * t;
    if (standFault(g, px, pz, rule) === null) {
      return [px, pz];
    }
  }
  return null;
}

/** Outcome counts per system (kept / moved / one entry per fault), for build stats and the placement scan. */
export class StandLog {
  readonly counts: Record<string, Record<string, number>> = {};

  note(system: string, outcome: StandFault | 'kept' | 'moved', n = 1): void {
    const c = (this.counts[system] ??= {});
    c[outcome] = (c[outcome] ?? 0) + n;
  }

  /** Dropped count of `system` (every fault), or of all systems. */
  dropped(system?: string): number {
    let n = 0;
    for (const [s, c] of Object.entries(this.counts)) {
      if (system !== undefined && s !== system) {
        continue;
      }
      for (const [k, v] of Object.entries(c)) {
        if (k !== 'kept' && k !== 'moved') {
          n += v;
        }
      }
    }
    return n;
  }

  /** Flat `system.outcome` counts (build stats). */
  flat(prefix = ''): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [s, c] of Object.entries(this.counts)) {
      for (const [k, v] of Object.entries(c)) {
        out[`${prefix}${s}.${k}`] = v;
      }
    }
    return out;
  }
}
