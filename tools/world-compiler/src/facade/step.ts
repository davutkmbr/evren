/**
 * The façade compile step: replaces the core `buildings` step in registry.ts.
 *
 * - Format 0 and greybox tiles: exactly the core step (format 0 stays byte-identical).
 * - Format 1, prepare: building parts inherit their outline's levels / height (Simple 3D Buildings), every building
 *   of a full-detail tile gets a FacadePlan (typology, storeys from the S1 spec table, OSM tags or a hash) and its
 *   manifest record's topY / height follow the plan, so colliders and the other lanes see the real heights.
 * - Format 1, full-detail tiles: real façade geometry (facade/build.ts) and shopfronts (shopfront/); hero buildings
 *   stay blocks with door recesses. The hero lane can take a building over entirely by adding its id to the Set in
 *   `AreaContext.shared` under FACADE_SKIP ('facade:skip'); this step then emits nothing for it.
 * - Tile manifests get `extra.facade`: per-building typology, storeys, height source, shop units, and triangles.
 */
import { LEVEL_HEIGHT, emitSolid, type Solid } from '../buildings';
import { buildingsStep, emitBlock } from '../core-steps';
import { LOD0, LOD1 } from '../mesh';
import type { AreaContext, CompileStep } from '../registry';
import { osmWords } from '../shopfront/names';
import { buildFacade, classifyEdges, type Edge, type FacadeRecord, streetBase } from './build';
import { type FacadePlan, HERO_HEIGHT, HERO_IDS, parentOf, planFacade, planTop } from './plan';

/** AreaContext.shared key of the Set<string> of building ids (e.g. "w102190096") the façade step must not emit. */
export const FACADE_SKIP = 'facade:skip';

interface Shared {
  plans: Map<Solid, { plan: FacadePlan; edges: Edge[] }>;
  avoid: Set<string>;
  inherited: string[];
  totals: { buildings: number; shops: number; lod0Triangles: number };
}

/** The fish / produce end of the strip: near the Yasa × Güneşlibahçe × Yağlıkçı İsmail junction (spec P10–P11). */
function inMarket(x: number, z: number): boolean {
  const ax = 405.1;
  const az = 6032.1;
  const bx = 442.2;
  const bz = 6052.5;
  const l2 = (bx - ax) ** 2 + (bz - az) ** 2;
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
  return Math.hypot(ax + (bx - ax) * t - x, az + (bz - az) * t - z) < 18 || Math.hypot(x - bx, z - bz) < 40;
}

function prepare(a: AreaContext): void {
  if (a.format !== 1) {
    return;
  }
  const byId = new Map(a.data.buildings.map((b) => [b.id, b]));
  const sh: Shared = { plans: new Map(), avoid: new Set(), inherited: [], totals: { buildings: 0, shops: 0, lod0Triangles: 0 } };
  a.shared.set('facade', sh);
  const names: string[] = [];
  for (const m of a.manifests.values()) {
    for (const q of m.pois) {
      if (q.osmName) {
        names.push(q.osmName);
      }
    }
  }
  sh.avoid = osmWords(names);
  const f = a.foundation;
  for (const s of a.solids) {
    const osm = byId.get(s.rec.osmId);
    const parent = s.rec.part && s.rec.heightSource === 'default' ? parentOf(s, a.data.buildings) : null;
    const full = a.detailOf(a.tileOfSolid.get(s) ?? '') === 'full';
    if (HERO_IDS.has(s.rec.osmId)) {
      const h = HERO_HEIGHT[s.rec.osmId];
      if (h && full) {
        s.rec.topY = Math.round((s.rec.groundY + h) * 100) / 100;
        s.rec.height = h;
      }
      continue;
    }
    if (!full || !s.grounded || s.rec.kind === 'roof') {
      // Greybox: parts still inherit their outline's levels (Simple 3D Buildings).
      if (parent && (parent.levels || parent.height) && s.grounded) {
        const h = parent.height ?? (parent.levels! + (parent.roofLevels ?? 0)) * LEVEL_HEIGHT;
        s.rec.topY = Math.round((s.rec.groundY + h) * 100) / 100;
        s.rec.height = Math.round(h * 100) / 100;
        s.rec.levels = parent.levels;
        sh.inherited.push(s.rec.id);
      }
      continue;
    }
    const edges = classifyEdges(s, a.heights, f.footprints, f.surface, a.land);
    const base = streetBase(s, edges);
    const plan = planFacade(s, osm, parent, base);
    if (plan.source === 'parent-levels') {
      sh.inherited.push(s.rec.id);
      s.rec.levels = plan.storeys;
    }
    const ridge = plan.roof === 'hipped' ? 2.2 : 0;
    s.rec.topY = Math.round(planTop(plan, ridge) * 100) / 100;
    s.rec.height = Math.round((s.rec.topY - s.rec.groundY) * 100) / 100;
    sh.plans.set(s, { plan, edges });
  }
}

export const facadeStep: CompileStep = {
  id: 'facade',
  formats: [0, 1],
  prepare,
  tile(t) {
    if (t.area.format === 0 || t.detail !== 'full') {
      return buildingsStep.tile!(t);
    }
    const sh = t.area.shared.get('facade') as Shared;
    const skip = t.area.shared.get(FACADE_SKIP) as Set<string> | undefined;
    const records: FacadeRecord[] = [];
    let plainTris = 0;
    for (const s of t.solids) {
      if (skip?.has(s.rec.id)) {
        continue;
      }
      const entry = sh.plans.get(s);
      if (!entry) {
        const before = t.mesh.triangles(LOD0);
        t.mesh.withLod(LOD0, () => emitSolid(s, t.mesh));
        t.mesh.withLod(LOD1, () => emitBlock(s, t.mesh));
        plainTris += t.mesh.triangles(LOD0) - before;
        continue;
      }
      const cx = s.cx;
      const cz = s.cz;
      records.push(
        buildFacade(s, entry.plan, entry.edges, {
          mesh: t.mesh,
          heights: t.area.heights,
          footprints: t.area.foundation.footprints,
          surface: t.area.foundation.surface,
          land: t.area.land,
          place: (asset, position, yaw, opts) => t.place(asset, position, yaw, opts),
          lights: t.lights,
          tile: t.id,
          avoid: sh.avoid,
          pois: t.manifest.pois.filter((q) => q.building === s.rec.id),
          doors: t.manifest.doors.filter((d) => d.building === s.rec.id),
          market: inMarket(cx, cz),
          interiors: () => t.area.shared.get('interiors') as ReturnType<Parameters<typeof buildFacade>[3]['interiors']>,
        }),
      );
    }
    const tris = records.reduce((q, r) => q + r.lod0Triangles, 0);
    sh.totals.buildings += records.length;
    sh.totals.shops += records.reduce((q, r) => q + r.shops.filter((u) => u.kind === 'shop').length, 0);
    sh.totals.lod0Triangles += tris;
    t.record('facade', { buildings: records, lod0Triangles: tris, plainLod0Triangles: plainTris, inherited: sh.inherited.filter((id) => t.manifest.buildings.some((b) => b.id === id)) });
  },
};
