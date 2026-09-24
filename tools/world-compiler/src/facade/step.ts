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
import * as THREE from 'three';
import { LEVEL_HEIGHT, emitSolid, type Solid } from '../buildings';
import { buildingsStep, emitBlock } from '../core-steps';
import { LOD0, LOD1, type TileMesh, type Vec3 } from '../mesh';
import { lin, scale } from './frame';
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

/**
 * An OSM building=roof (a canopy: shelter, stop roof) as a thin slab on steel posts: roof top at the record's topY,
 * a 0.28 m fascia band round the edge, a soffit 0.12 m under the top, and square posts from the ground to the soffit
 * at every corner and at most POST_SPACING apart along the edges (inset 0.3 m).
 */
const POST_SPACING = 6;
function emitCanopy(s: Solid, mesh: TileMesh, groundAt: (x: number, z: number) => number): void {
  const ring = s.ring;
  const n = ring.length / 2;
  const top = s.rec.topY;
  const soffit = top - 0.12;
  const fascia = top - 0.28;
  const steel = lin(0x9ea3a6);
  const fasciaC = lin(0xc9cccd);
  const pts = pairs(ring);
  const tris = THREE.ShapeUtils.triangulateShape(pts, []).flat();
  mesh.flatTriangles('fac_roof_flat', pts.map((v) => [v.x, top, v.y] as Vec3), tris, [0, 1, 0], { color: lin(0x6c6f71) });
  mesh.flatTriangles('fac_panel', pts.map((v) => [v.x, soffit, v.y] as Vec3), tris, [0, -1, 0], { color: lin(0xb4b6b5) });
  let cx = 0;
  let cz = 0;
  for (let k = 0; k < n; k++) {
    cx += ring[k * 2] / n;
    cz += ring[k * 2 + 1] / n;
  }
  for (let i = 0; i < n; i++) {
    const ax = ring[i * 2];
    const az = ring[i * 2 + 1];
    const bx = ring[((i + 1) % n) * 2];
    const bz = ring[((i + 1) % n) * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) {
      continue;
    }
    let nx = (bz - az) / len;
    let nz = -(bx - ax) / len;
    if (nx * (ax - cx) + nz * (az - cz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    mesh.wall('fac_metal', ax, az, bx, bz, fascia, top, fascia, top, [nx, 0, nz], { color: fasciaC });
    mesh.flatPolygon('fac_metal', [[ax, fascia, az], [bx, fascia, bz], [bx - nx * 0.06, fascia, bz - nz * 0.06], [ax - nx * 0.06, fascia, az - nz * 0.06]], [0, -1, 0], { color: fasciaC });
    mesh.wall('fac_metal', bx - nx * 0.06, bz - nz * 0.06, ax - nx * 0.06, az - nz * 0.06, fascia, soffit, fascia, soffit, [-nx, 0, -nz], { color: scale(fasciaC, 0.8) });
    // Posts along this edge (the corner post near a; b is the next edge's corner).
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const count = Math.max(1, Math.ceil(len / POST_SPACING));
    for (let k = 0; k < count; k++) {
      const along = Math.min(Math.max((k / count) * len, 0.3), len - 0.3);
      const px = ax + ux * along - nx * 0.3;
      const pz = az + uz * along - nz * 0.3;
      const g = groundAt(px, pz) - 0.05;
      const h = 0.075;
      const c: [number, number][] = [
        [px - ux * h - nx * h, pz - uz * h - nz * h],
        [px + ux * h - nx * h, pz + uz * h - nz * h],
        [px + ux * h + nx * h, pz + uz * h + nz * h],
        [px - ux * h + nx * h, pz - uz * h + nz * h],
      ];
      for (let q = 0; q < 4; q++) {
        const [x0, z0] = c[q];
        const [x1, z1] = c[(q + 1) % 4];
        const el = Math.hypot(x1 - x0, z1 - z0) || 1;
        let fx = (z1 - z0) / el;
        let fz = -(x1 - x0) / el;
        if (fx * ((x0 + x1) / 2 - px) + fz * ((z0 + z1) / 2 - pz) < 0) {
          fx = -fx;
          fz = -fz;
        }
        mesh.wall('fac_metal', x0, z0, x1, z1, g, soffit, g, soffit, [fx, 0, fz], { color: steel });
      }
      mesh.flatPolygon('fac_metal', c.map(([x, z]): Vec3 => [px + (x - px) * 1.8, g + 0.07, pz + (z - pz) * 1.8]), [0, 1, 0], { color: scale(steel, 0.7) });
    }
  }
}

function pairs(r: readonly number[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let k = 0; k < r.length; k += 2) {
    out.push(new THREE.Vector2(r[k], r[k + 1]));
  }
  return out;
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
      if (!entry && s.rec.kind === 'roof' && s.holes.length === 0) {
        const before = t.mesh.triangles(LOD0);
        t.mesh.withLod(LOD0, () => emitCanopy(s, t.mesh, (x, z) => t.area.heights.at(x, z)));
        t.mesh.withLod(LOD1, () => emitBlock(s, t.mesh));
        plainTris += t.mesh.triangles(LOD0) - before;
        continue;
      }
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
