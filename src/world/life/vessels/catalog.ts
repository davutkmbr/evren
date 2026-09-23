import type { ModelOptions, VesselKind, VesselModel } from './model-types';
import { buildSeabus, buildTourBoat, buildVapur, type BuiltModel } from './models/ferries';
import { buildCargoShip, type CargoDesign } from './models/cargo';
import { buildFishingBoat, buildSailboat, buildSeiner, buildYacht } from './models/small-craft';

interface ModelRecipe {
  key: string;
  kind: VesselKind;
  length: number;
  beam: number;
  draft: number;
  big: boolean;
  lodDistance: number;
  build: (o: ModelOptions) => BuiltModel;
}

function cargo(key: string, d: CargoDesign): ModelRecipe {
  return {
    key,
    kind: d.type,
    length: d.length,
    beam: d.beam,
    draft: d.draft,
    big: true,
    lodDistance: 1500,
    build: (o) => buildCargoShip(d, o),
  };
}

/** Every vessel design in the simulation. */
export const RECIPES: readonly ModelRecipe[] = [
  { key: 'vapur', kind: 'vapur', length: 72, beam: 13, draft: 3.1, big: true, lodDistance: 750, build: buildVapur },
  { key: 'seabus', kind: 'seabus', length: 38.5, beam: 11.2, draft: 1.35, big: true, lodDistance: 550, build: buildSeabus },
  { key: 'tour', kind: 'tour', length: 30, beam: 7.2, draft: 1.6, big: false, lodDistance: 420, build: buildTourBoat },
  cargo('tanker-a', { type: 'tanker', length: 183, beam: 32.2, depth: 18.2, draft: 11.6, tiers: 6, seed: 11 }),
  cargo('tanker-b', { type: 'tanker', length: 228, beam: 32.2, depth: 20.6, draft: 13.2, tiers: 7, seed: 12 }),
  cargo('tanker-c', { type: 'tanker', length: 118, beam: 19.6, depth: 10.2, draft: 7.2, tiers: 5, seed: 13 }),
  cargo('container-a', { type: 'container', length: 172, beam: 27.4, depth: 14.2, draft: 9.6, tiers: 7, seed: 21 }),
  cargo('container-b', { type: 'container', length: 222, beam: 32.2, depth: 18.6, draft: 11.2, tiers: 7, seed: 22 }),
  cargo('bulk-a', { type: 'bulk', length: 180, beam: 30, depth: 16.4, draft: 10.4, tiers: 6, seed: 31 }),
  cargo('bulk-b', { type: 'bulk', length: 146, beam: 23.6, depth: 13.2, draft: 9.1, tiers: 5, seed: 32 }),
  { key: 'fishing', kind: 'fishing', length: 10.5, beam: 3.3, draft: 0.85, big: false, lodDistance: 260, build: buildFishingBoat },
  { key: 'seiner', kind: 'seiner', length: 28, beam: 7.6, draft: 2.4, big: false, lodDistance: 380, build: buildSeiner },
  { key: 'yacht', kind: 'yacht', length: 24, beam: 6, draft: 1.6, big: false, lodDistance: 360, build: buildYacht },
  { key: 'sailboat', kind: 'sailboat', length: 13, beam: 4.1, draft: 0.8, big: false, lodDistance: 300, build: buildSailboat },
];

/** Builds all models, yielding to the browser between designs. */
export async function buildCatalog(): Promise<Map<string, VesselModel>> {
  const out = new Map<string, VesselModel>();
  for (const r of RECIPES) {
    const t0 = performance.now();
    const near = r.build({ lod: 0 });
    const far = r.build({ lod: 1 });
    out.set(r.key, {
      key: r.key,
      kind: r.kind,
      length: r.length,
      beam: r.beam,
      draft: r.draft,
      airDraft: near.airDraft,
      big: r.big,
      lod0: near.geometry,
      lod1: far.geometry,
      lodDistance: r.lodDistance,
      lights: near.lights,
    });
    const ms = performance.now() - t0;
    if (ms > 40) console.info(`[life] model ${r.key}: ${Math.round(ms)} ms, ${near.geometry.getAttribute('position').count} verts`);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return out;
}
