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
  { id: 'iskeleCamii', anchor: 'w694298377', outline: 102190093, build: (t, ring, bottomY, dome) => buildIskeleCamii(t, ring, dome, bottomY) },
  { id: 'ayaEfimia', anchor: 'w694298363', outline: 694298362, build: (t, ring, bottomY, tower) => buildAyaEfimia(t, ring, tower, bottomY) },
];

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
