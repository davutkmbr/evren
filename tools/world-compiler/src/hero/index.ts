/**
 * Hero step (format 1): hand-made hero buildings replace the greybox blocks of their OSM solids. It runs before the
 * buildings step: in each tile it takes its anchor solids out of `t.solids` (so no façade step dresses them), builds
 * the hero into the tile mesh (LOD0 detail, LOD1 massing), adds its lights and props, corrects the building records'
 * heights and records what it built in `extra.heroes`.
 *
 * Other steps can ask `area.shared.get('heroes')` (HeroShared) which solids a hero owns.
 */
import { ringArea } from '../../../../src/world/osm/shared/geometry';
import type { BuildingRec } from '../format';
import type { AreaContext, CompileStep, TileContext } from '../registry';
import { FERRY_PROP } from './ferry';
import { SKYLINE_ANCHOR, SKYLINE_PROP } from './farfield';
import { buildHaldunTaner } from './haldun-taner';
import { headingYaw } from '../instances';
import type { PropDef } from '../props';
import { buildNewPier } from './new-pier';
import { buildPier1926, type HeroBuild } from './pier1926';
import { buildAyaEfimia, buildIskeleCamii } from './worship';

export interface HeroShared {
  /** Building record ids (w<way>) whose greybox block a hero replaces. */
  solids: Set<string>;
  /** OSM outline ids (building:part parents) a hero rebuilds as a whole. */
  outlines: Set<number>;
}

interface HeroDef {
  id: string;
  /** Solid (building record id) the hero is anchored to and replaces. */
  anchor: string;
  /** Further solids it replaces. */
  replaces?: string[];
  /** OSM outline it rebuilds (for building:part parents that format 0 drops). */
  outline?: number;
  /** `ring` is the outline (or the anchor's ring), `bottomY` the base under it. */
  build(t: TileContext, ring: readonly number[], bottomY: number, anchorRing: readonly number[]): HeroBuild;
}

const HEROES: HeroDef[] = [
  { id: 'pier1926', anchor: 'w102190096', build: (t, ring, bottomY) => buildPier1926(t, ring, bottomY) },
  { id: 'newPier', anchor: 'w560203763', build: (t, ring, bottomY) => buildNewPier(t, ring, bottomY) },
  { id: 'haldunTaner', anchor: 'w102190100', build: (t, ring, bottomY) => buildHaldunTaner(t, ring, bottomY) },
  { id: 'iskeleCamii', anchor: 'w694298377', outline: 102190093, build: (t, ring, bottomY, dome) => buildIskeleCamii(t, ring, dome, bottomY) },
  { id: 'ayaEfimia', anchor: 'w694298363', outline: 694298362, build: (t, ring, bottomY, tower) => buildAyaEfimia(t, ring, tower, bottomY) },
];

/** Hero props: the docked City Lines ferry and the far-field skyline (registered in registry.ts PROP_SETS). */
export const HERO_PROPS: PropDef[] = [FERRY_PROP, SKYLINE_PROP];

/**
 * The ferry lies broadside to c02 (bearing about 317° from it, 70 m long): on the view ray from the c02 camera the
 * first spot 80-160 m out where the whole hull is over water, the long axis across the ray.
 */
function ferryPose(a: AreaContext): { x: number; z: number; heading: number } | null {
  const cam = { x: 189.8, z: 5937.6 };
  const bearing = 317;
  const h = (bearing * Math.PI) / 180;
  const dx = Math.sin(h);
  const dz = -Math.cos(h);
  const axis = bearing - 90;
  const ah = (axis * Math.PI) / 180;
  const ax = Math.sin(ah);
  const az = -Math.cos(ah);
  for (let d = 80; d <= 160; d += 2) {
    const x = cam.x + dx * d;
    const z = cam.z + dz * d;
    let ok = true;
    for (let u = -37; u <= 37 && ok; u += 4) {
      for (const v of [-8, 0, 8]) {
        if (a.land(x + ax * u + -az * v, z + az * u + ax * v) > -1) {
          ok = false;
          break;
        }
      }
    }
    if (ok) {
      return { x, z, heading: axis };
    }
  }
  return null;
}

export const heroStep: CompileStep = {
  id: 'heroes',
  prepare(a: AreaContext) {
    const shared: HeroShared = { solids: new Set(), outlines: new Set() };
    for (const h of HEROES) {
      shared.solids.add(h.anchor);
      for (const r of h.replaces ?? []) {
        shared.solids.add(r);
      }
      if (h.outline) {
        shared.outlines.add(h.outline);
      }
    }
    a.shared.set('heroes', shared);
    // The façade lane's opt-out set (facade/step.ts FACADE_SKIP): it emits nothing for these buildings.
    const skip = (a.shared.get('facade:skip') as Set<string> | undefined) ?? new Set<string>();
    for (const id of shared.solids) {
      skip.add(id);
    }
    a.shared.set('facade:skip', skip);
  },
  tile(t) {
    const shared = t.area.shared.get('heroes') as HeroShared;
    const solids = t.solids as unknown as { rec: BuildingRec; ring: number[] }[];
    const built: Record<string, unknown>[] = [];
    for (const h of HEROES) {
      const anchor = solids.find((s) => s.rec.id === h.anchor);
      if (!anchor) {
        continue;
      }
      const osm = h.outline ? t.area.data.buildings.find((b) => b.id === h.outline) : undefined;
      let ring = osm?.ring ?? anchor.ring;
      if (ringArea(ring) < 0) {
        ring = reverseRing(ring);
      }
      let groundY = anchor.rec.groundY;
      if (osm) {
        for (let k = 0; k < ring.length; k += 2) {
          groundY = Math.min(groundY, t.area.heights.at(ring[k], ring[k + 1]));
        }
      }
      const bottomY = Math.min(anchor.rec.bottomY, groundY - 0.3);
      const res = h.build(t, ring, bottomY, anchor.ring);
      anchor.rec.topY = res.topY;
      anchor.rec.height = Math.round((res.topY - anchor.rec.groundY) * 100) / 100;
      if (osm && !t.manifest.buildings.some((b) => b.id === `w${osm.id}`)) {
        // The outline format 0 drops for its part, as a building record (colliders see the whole hero).
        const r2 = (v: number): number => Math.round(v * 100) / 100;
        t.manifest.buildings.push({ id: `w${osm.id}`, osmId: osm.id, kind: osm.kind, ...(osm.name ? { name: osm.name } : {}), footprint: ring.map(r2), groundY: r2(groundY), bottomY: r2(bottomY), topY: res.topY, height: r2(res.topY - groundY), heightSource: 'height', doors: [] });
      }
      built.push({ id: h.id, building: h.anchor, ...(h.outline ? { outline: `w${h.outline}` } : {}), floorY: res.floorY, topY: res.topY, lights: res.lights, instances: res.instances, ...res.notes });
    }
    // Take every replaced solid out of the tile's list before the buildings step runs.
    for (let k = solids.length - 1; k >= 0; k--) {
      if (shared.solids.has(solids[k].rec.id)) {
        solids.splice(k, 1);
      }
    }
    // The ferry at the 1926 pier and the far-field skyline belong to the tile of the pier.
    if (t.area.format === 1 && Math.floor(SKYLINE_ANCHOR[0] / 100) === t.manifest.i && Math.floor(SKYLINE_ANCHOR[2] / 100) === t.manifest.j) {
      t.place('hero_skyline', SKYLINE_ANCHOR, 0, { variant: 'istanbul', ref: 'hero/skyline' });
      const fp = ferryPose(t.area);
      if (fp) {
        t.place('hero_ferry', [fp.x, 0, fp.z], headingYaw(fp.heading, '+Z'), { variant: 'kadikoy', ref: 'hero/ferry' });
        built.push({ id: 'ferry', position: [Math.round(fp.x * 10) / 10, 0, Math.round(fp.z * 10) / 10], headingDeg: Math.round(fp.heading) });
      }
    }
    if (built.length) {
      t.record('heroes', built);
    }
  },
};

function reverseRing(r: readonly number[]): number[] {
  const out: number[] = [];
  for (let k = r.length - 2; k >= 0; k -= 2) {
    out.push(r[k], r[k + 1]);
  }
  return out;
}
