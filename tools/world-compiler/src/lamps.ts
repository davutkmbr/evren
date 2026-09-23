/**
 * Street lamps for the manifest. OSM maps no highway=street_lamp nodes in Kadıköy (2026-09), so the compiler runs
 * the flight slice's lighting rules (src/world/osm/streets/lamps.ts: kerb masts on main and residential streets,
 * lantern posts on pedestrian streets, wall brackets in narrow lanes; OSM lamp nodes first) and records every lamp,
 * flagged `inferred` unless it stands on an OSM lamp node.
 */
import type { OsmData } from '../../../src/world/osm/data';
import type { FootprintIndex } from '../../../src/world/osm/shared/footprints';
import { INSTANCE_STRIDE } from '../../../src/world/osm/shared/protocol';
import { classifyPaths, classifyStreets } from '../../../src/world/osm/shared/street-field';
import type { StreetSurface } from '../../../src/world/osm/shared/street-surface';
import { Light, type PropKind } from '../../../src/world/osm/streets/kinds';
import { buildLamps } from '../../../src/world/osm/streets/lamps';
import { PropSink } from '../../../src/world/osm/streets/sink';

export interface PlacedLamp {
  x: number;
  z: number;
  /** Compass heading (deg) the lamp head faces. */
  heading: number;
  kind: 'arm' | 'armLow' | 'double' | 'lantern' | 'wall';
  light: 'sodium' | 'led' | 'warm';
  inferred: boolean;
  mount?: string;
  height?: number;
}

const KINDS: Partial<Record<PropKind, PlacedLamp['kind']>> = { lampArm: 'arm', lampArmLow: 'armLow', lampDouble: 'double', lampLantern: 'lantern', lampWall: 'wall' };
const LIGHTS: Record<number, PlacedLamp['light']> = { [Light.Sodium]: 'sodium', [Light.Led]: 'led', [Light.Warm]: 'warm' };

export function placeLamps(data: OsmData, surface: StreetSurface, footprints: FootprintIndex): PlacedLamp[] {
  const sink = new PropSink();
  buildLamps(classifyStreets(data.roads), classifyPaths(data.roads), data, surface, footprints, sink, () => false);
  const osm = data.points.filter((p) => p.kind === 'highway=street_lamp');
  const out: PlacedLamp[] = [];
  for (const [prop, kind] of Object.entries(KINDS) as [PropKind, PlacedLamp['kind']][]) {
    const rec = sink.records[prop];
    const lights = sink.lights[prop];
    for (let i = 0; i < lights.length; i++) {
      const o = i * INSTANCE_STRIDE;
      const x = rec.array[o];
      const z = rec.array[o + 2];
      const yaw = rec.array[o + 3];
      // yaw turns local +X towards the facing direction (cos yaw, -sin yaw).
      const h = (Math.atan2(Math.cos(yaw), Math.sin(yaw)) * 180) / Math.PI;
      const node = osm.find((p) => Math.hypot(p.x - x, p.z - z) < 0.1);
      const lamp: PlacedLamp = { x, z, heading: Math.round((h < 0 ? h + 360 : h) * 10) / 10, kind, light: LIGHTS[lights.array[i]] ?? 'warm', inferred: !node };
      if (node?.mount) {
        lamp.mount = node.mount;
      }
      if (node?.height) {
        lamp.height = node.height;
      }
      out.push(lamp);
    }
  }
  return out;
}
