/**
 * Placement rules of the street tiles (format 1): the one place that says which surface a small street detail may
 * sit on and how much room it keeps, so OSM geometry is not taken as-is. Every emitter (markings, furniture, lamps,
 * railings, crossings) asks these predicates and either keeps an item, moves it to the nearest valid spot, shortens
 * it or drops it; each outcome is counted per rule and printed in the compile summary (`placement`), so a regression
 * shows up as a changed count. Surfaces follow what street/ground.ts draws:
 * - carriageway: signed carriageway distance D < 0 where no pedestrian street wins the texel (winMargin);
 * - gutter: the GUTTER_WIDTH band in front of a raised kerb; kerb: the KERB_WIDTH stone behind the kerb line;
 * - track: the flush tram track bed where rails leave the carriageway (common.ts trackBed), at road level;
 * - pedestrianLane: carriageway raster of a pedestrian street (slabs / küp taş, no traffic);
 * - pavement: everything walkable off the carriageway (raised sidewalks, kerbless paving, squares, paths, lots);
 * - building, water.
 * README "Placement rules" lists the rules and their predicates.
 */
import { BoxGrid } from '../../../../src/world/osm/shared/geometry';
import { Ground } from '../../../../src/world/osm/shared/street-field';
import type { AreaContext } from '../registry';
import { GUTTER_WIDTH, KERB_WIDTH, streetContext, type StreetContext } from './common';

export type Outcome = 'kept' | 'moved' | 'shortened' | 'dropped' | 'flagged';
export type Surface = 'water' | 'building' | 'track' | 'carriageway' | 'gutter' | 'pedestrianLane' | 'kerb' | 'pavement';

/** Per-rule outcome counts (compile summary `placement`). */
export class PlacementLog {
  readonly counts: Record<string, Partial<Record<Outcome, number>>> = {};

  note(rule: string, outcome: Outcome, n = 1): void {
    if (n <= 0) {
      return;
    }
    const c = (this.counts[rule] ??= {});
    c[outcome] = (c[outcome] ?? 0) + n;
  }

  summary(): Record<string, Partial<Record<Outcome, number>>> {
    return Object.fromEntries(Object.entries(this.counts).sort(([p], [q]) => (p < q ? -1 : 1)));
  }
}

/** The area's placement log (created on first use). */
export function placementLog(a: AreaContext): PlacementLog {
  let log = a.shared.get('placementLog') as PlacementLog | undefined;
  if (!log) {
    log = new PlacementLog();
    a.shared.set('placementLog', log);
  }
  return log;
}

/** What a standing prop needs around its base. */
export interface StandSpec {
  /** Minimum distance (m) behind the kerb line (carriageway edge), so the base clears the kerb stone. */
  kerb: number;
  /** Minimum distance (m) from façades. */
  wall: number;
  /** 'never': off every carriageway; 'pedestrian': also on pedestrian-street paving. */
  carriage: 'never' | 'pedestrian';
  /** Keep out of the approach in front of doors. */
  door: boolean;
}

/** Placement rule and stand spec of a prop (null: exempt, e.g. hanging pendants, vehicles, wall brackets). */
export function propRule(prop: string): { rule: string; spec: StandSpec; reach: number } | null {
  if (prop === 'st_tree') {
    return { rule: 'prop.tree', spec: { kerb: 0.6, wall: 0.8, carriage: 'pedestrian', door: true }, reach: 2.5 };
  }
  if (prop === 'st_bollard') {
    return { rule: 'prop.bollard', spec: { kerb: 0.2, wall: 0.3, carriage: 'pedestrian', door: true }, reach: 1.2 };
  }
  if (/^(st_signal|st_stop_pole|lamp_mast.*|street_lamp_01)$/.test(prop)) {
    return { rule: 'prop.pole', spec: { kerb: 0.3, wall: 0.3, carriage: 'pedestrian', door: true }, reach: 1.5 };
  }
  if (/^(st_bench|st_bin|st_cabinet|st_planter|st_twin_lantern|st_umbrella|outdoor_table_chair_set_01|plastic_monobloc_chair_01|standing_chalkboard_01)$/.test(prop)) {
    return { rule: 'prop.furniture', spec: { kerb: 0.45, wall: 0.2, carriage: 'pedestrian', door: true }, reach: 1.5 };
  }
  return null;
}

/** Door approach kept free: up to DOOR_REACH m out from the façade, the door's half width plus DOOR_SIDE m to each side. */
const DOOR_REACH = 1.3;
const DOOR_SIDE = 0.2;
/** Road paint keeps this far (m) from the rails' centre line of a tram track. */
const TRAM_CLEAR = 1.25;
/** Carriageway axis and paint direction may differ by this much (rad). */
const AXIS_TOL = (25 * Math.PI) / 180;

export class PlacementRules {
  readonly log: PlacementLog;
  readonly sc: StreetContext;
  private readonly doors = new BoxGrid(4);
  private readonly doorList: { x: number; z: number; nx: number; nz: number; hw: number }[] = [];

  constructor(private readonly a: AreaContext) {
    this.log = placementLog(a);
    this.sc = streetContext(a);
    for (const m of a.manifests.values()) {
      for (const d of m.doors) {
        const id = this.doorList.push({ x: d.position[0], z: d.position[2], nx: d.normal[0], nz: d.normal[2], hw: d.width / 2 }) - 1;
        const r = DOOR_REACH + d.width;
        this.doors.add(id, d.position[0] - r, d.position[2] - r, d.position[0] + r, d.position[2] + r);
      }
    }
  }

  private get s() {
    return this.a.foundation.surface;
  }

  /** A raised kerb stone stands at this carriageway edge (as street/ground.ts builds it). */
  kerbStone(x: number, z: number): boolean {
    return this.s.kerbed(x, z) && this.s.liftAt(x, z) > 0.05;
  }

  /** Metres by which a pedestrian street wins the texel (> 0: pedestrian paving on the carriageway raster). */
  pedestrianMargin(x: number, z: number): number {
    return this.sc.winMargin(x, z, (st) => st.pedestrian);
  }

  surface(x: number, z: number): Surface {
    const s = this.s;
    if (this.a.land(x, z) <= 0) {
      return 'water';
    }
    if (this.a.foundation.footprints.inside(x, z)) {
      return 'building';
    }
    if (this.sc.trackBed(x, z) > 0) {
      return 'track';
    }
    const d = s.distance(x, z);
    if (d < 0) {
      if (this.pedestrianMargin(x, z) > 0) {
        return 'pedestrianLane';
      }
      return d > -GUTTER_WIDTH && this.kerbStone(x, z) ? 'gutter' : 'carriageway';
    }
    return d < KERB_WIDTH && this.kerbStone(x, z) ? 'kerb' : 'pavement';
  }

  /**
   * Road paint may cover (x, z): a vehicular carriageway at least `margin` m inside its edge and 0.3 m clear of
   * pedestrian-street paving. `lane` (lane, centre and edge lines) also keeps out of the gutter, off parking ground
   * and TRAM_CLEAR m from tram tracks.
   */
  paintable(x: number, z: number, margin: number, lane: boolean): boolean {
    const s = this.s;
    const d = s.distance(x, z);
    if (d > -margin || this.pedestrianMargin(x, z) > -0.3) {
      return false;
    }
    if (!lane) {
      return true;
    }
    if (d > -GUTTER_WIDTH && this.kerbStone(x, z)) {
      return false;
    }
    return s.groundAt(x, z) !== Ground.Parking && this.sc.tramDist(x, z) >= TRAM_CLEAR;
  }

  /** The carriageway that wins the texel runs along `angle` (rad, atan2(dz, dx)) within AXIS_TOL. */
  axisAgrees(x: number, z: number, angle: number): boolean {
    const a = ((angle % Math.PI) + Math.PI) % Math.PI;
    const diff = Math.abs(this.s.directionAt(x, z) - a);
    return Math.min(diff, Math.PI - diff) < AXIS_TOL;
  }

  /** Distance (m) along (dx, dz) from (x, z) to where the carriageway ends (D crosses 0), or null within `reach`. */
  edgeAlong(x: number, z: number, dx: number, dz: number, reach: number): number | null {
    const s = this.s;
    let prev = s.distance(x, z);
    if (prev >= 0) {
      return 0;
    }
    for (let t = 0.05; t <= reach; t += 0.05) {
      const d = s.distance(x + dx * t, z + dz * t);
      if (d >= 0) {
        return t - 0.05 * (d / (d - prev || 1));
      }
      prev = d;
    }
    return null;
  }

  /** Unit gradient of the carriageway distance (points away from the carriageway). */
  outward(x: number, z: number): [number, number] {
    const s = this.s;
    const h = 0.3;
    const gx = s.distance(x + h, z) - s.distance(x - h, z);
    const gz = s.distance(x, z + h) - s.distance(x, z - h);
    const l = Math.hypot(gx, gz) || 1;
    return [gx / l, gz / l];
  }

  /** Inside the approach of a door (in front of the opening, out to DOOR_REACH). */
  doorBlocked(x: number, z: number): boolean {
    for (const id of this.doors.at(x, z)) {
      const d = this.doorList[id];
      const dx = x - d.x;
      const dz = z - d.z;
      const out = dx * d.nx + dz * d.nz;
      const side = Math.abs(-dx * d.nz + dz * d.nx);
      if (out > -0.2 && out < DOOR_REACH && side < d.hw + DOOR_SIDE) {
        return true;
      }
    }
    return false;
  }

  /** Why a prop with `spec` may not stand at (x, z) (the surface, 'kerb', 'wall' or 'door'), or null when it may. */
  violation(x: number, z: number, spec: StandSpec): string | null {
    const s = this.s;
    const surf = this.surface(x, z);
    if (surf === 'water' || surf === 'building' || surf === 'track' || surf === 'carriageway' || surf === 'gutter') {
      return surf;
    }
    if (surf === 'pedestrianLane') {
      if (spec.carriage !== 'pedestrian' || this.pedestrianMargin(x, z) < 0.3) {
        return surf;
      }
    } else if (s.distance(x, z) < spec.kerb) {
      return 'kerb';
    }
    if (s.buildingDistance(x, z) < spec.wall || this.a.land(x, z) < 0.3) {
      return 'wall';
    }
    return spec.door && this.doorBlocked(x, z) ? 'door' : null;
  }

  standable(x: number, z: number, spec: StandSpec): boolean {
    return this.violation(x, z, spec) === null;
  }

  /** (x, z) when it satisfies `spec`, else the nearest spot that does within `reach` m (0.25 m rings), else null. */
  settle(x: number, z: number, spec: StandSpec, reach: number): [number, number] | null {
    if (this.standable(x, z, spec)) {
      return [x, z];
    }
    for (let r = 0.25; r <= reach + 1e-6; r += 0.25) {
      const n = Math.max(8, Math.round((r * Math.PI * 2) / 0.3));
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        const px = x + Math.cos(ang) * r;
        const pz = z + Math.sin(ang) * r;
        if (this.standable(px, pz, spec)) {
          return [px, pz];
        }
      }
    }
    return null;
  }
}

/** The area's placement rules (built on first use, after the manifests exist). */
export function placementRules(a: AreaContext): PlacementRules {
  let r = a.shared.get('placement') as PlacementRules | undefined;
  if (!r) {
    r = new PlacementRules(a);
    a.shared.set('placement', r);
  }
  return r;
}
