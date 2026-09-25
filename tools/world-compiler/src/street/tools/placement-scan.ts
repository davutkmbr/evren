/**
 * Dev tool: scans a compiled area's full-detail tile glbs and instances against the street surface raster and lists
 * small details on the wrong surface (npx tsx placement-scan.ts <area> [--spots N] [--json out.json]):
 * - road paint (st_paint zebras, st_paint_lines lane / edge lines) off the carriageway, on pedestrian streets or kerbs;
 * - tactile strips (st_tactile) on the carriageway or inside buildings;
 * - tram rails (st_rail) off the carriageway; gully grates (st_iron) outside the gutter;
 * - prop instances (street furniture, lamps, trees, bins, bollards) on the carriageway or inside buildings.
 * Counts are per triangle (centroid) for geometry and per instance for props; `--spots` prints the worst 4 m cells.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { latLonToLocal } from '../../../../../src/core/geo-coords';
import { readArea, ROOT } from '../../../lib/areas.mjs';
import { buildFoundation } from '../../foundation';
import { TILE_SIZE } from '../../format';
import { loadStreetData } from '../../osm-street';
import { Zone } from '../../../../../src/world/osm/shared/street-surface';
import { groundHeights, landField, PierField } from '../../ground';
import { GUTTER_WIDTH, KERB_WIDTH, streetContext } from '../common';
import { Ground } from '../../../../../src/world/osm/shared/street-field';

const areaId = process.argv[2] ?? 'eminonu';
const argOf = (n: string): string | null => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const spotsN = Number(argOf('--spots') ?? 12);
const area = readArea(areaId);
const data = loadStreetData(resolve(ROOT, area.dataFile));
const sw = latLonToLocal(area.bbox.south, area.bbox.west);
const ne = latLonToLocal(area.bbox.north, area.bbox.east);
const i0 = Math.floor(sw.x / TILE_SIZE);
const i1 = Math.floor((ne.x - 1e-6) / TILE_SIZE);
const j0 = Math.floor(ne.z / TILE_SIZE);
const j1 = Math.floor((sw.z - 1e-6) / TILE_SIZE);
const rect = { minX: i0 * TILE_SIZE, maxX: (i1 + 1) * TILE_SIZE, minZ: j0 * TILE_SIZE, maxZ: (j1 + 1) * TILE_SIZE };
const f = buildFoundation(data, rect);
const s = f.surface;
const sc = streetContext({ shared: new Map(), data, foundation: f, heights: groundHeights(s), land: landField(f, new PierField(data)) } as unknown as Parameters<typeof streetContext>[0]);
/** What the street ground draws at (x, z) (street/ground.ts: carriageway where D < 0, pedestrian paving where a pedestrian street wins). */
const pedPaving = (x: number, z: number): boolean => sc.winMargin(x, z, (q) => q.pedestrian) > 0;
const kerbStone = (x: number, z: number): boolean => sc.winMargin(x, z, (q) => q.kerbed) > 0 && s.liftAt(x, z) > 0.05;
const dir = resolve(ROOT, `public/world/${areaId}`);

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

type Check = (x: number, z: number) => string | null;
/** Road paint: must lie on a vehicular carriageway, clear of the kerb (gutter excluded for lane lines). */
const paintCheck = (lane: boolean): Check => (x, z) => {
  const d = s.distance(x, z);
  if (d >= 0) {
    return s.zone(x, z) === Zone.Sidewalk ? 'onSidewalk' : 'offCarriageway';
  }
  if (pedPaving(x, z)) {
    return 'onPedestrianPaving';
  }
  if (lane && d > -GUTTER_WIDTH && kerbStone(x, z)) {
    return 'inGutter';
  }
  if (lane && s.tramBed(x, z)) {
    return 'onTramBed';
  }
  if (s.groundAt(x, z) === Ground.Parking) {
    return 'onParking';
  }
  return null;
};
const tactileCheck: Check = (x, z) => {
  if (f.footprints.inside(x, z)) {
    return 'inBuilding';
  }
  const d = s.distance(x, z);
  if (d < 0) {
    return 'onCarriageway';
  }
  if (d < KERB_WIDTH && s.kerbed(x, z)) {
    return 'onKerb';
  }
  return null;
};
const railCheck: Check = (x, z) => (s.distance(x, z) >= 0 && !s.tramBed(x, z) ? (s.zone(x, z) === Zone.Sidewalk ? 'onSidewalk' : 'offCarriageway') : null);

const CHECKS: Record<string, Check> = { st_paint: paintCheck(false), st_paint_lines: paintCheck(true), st_tactile: tactileCheck, st_rail: railCheck };
const counts = new Map<string, Map<string, number>>();
const totals = new Map<string, number>();
const spots = new Map<string, { n: number; x: number; z: number; what: Set<string> }>();
const bump = (m: string, k: string, x: number, z: number): void => {
  const c = counts.get(m) ?? new Map<string, number>();
  counts.set(m, c);
  c.set(k, (c.get(k) ?? 0) + 1);
  const key = `${Math.floor(x / 4)}_${Math.floor(z / 4)}`;
  const sp = spots.get(key) ?? { n: 0, x, z, what: new Set<string>() };
  sp.n++;
  sp.what.add(`${m}:${k}`);
  spots.set(key, sp);
};

const index = JSON.parse(readFileSync(resolve(dir, 'index.json'), 'utf8')) as { tiles: { id: string; glb: string; manifest: string }[] };
for (const tile of index.tiles) {
  const man = JSON.parse(readFileSync(resolve(dir, tile.manifest), 'utf8')) as { detail: string; instances?: { asset: string; position: number[] }[] };
  if (man.detail === 'full') {
    const doc = await io.read(resolve(dir, tile.glb));
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) {
        continue;
      }
      const w = node.getWorldMatrix();
      for (const p of mesh.listPrimitives()) {
        const m = p.getMaterial()?.getName() ?? '';
        const check = CHECKS[m];
        if (!check) {
          continue;
        }
        const pos = p.getAttribute('POSITION');
        const idx = p.getIndices();
        if (!pos || !idx) {
          continue;
        }
        const v = [0, 0, 0];
        const world = (i: number): [number, number] => {
          pos.getElement(i, v);
          return [w[0] * v[0] + w[4] * v[1] + w[8] * v[2] + w[12], w[2] * v[0] + w[6] * v[1] + w[10] * v[2] + w[14]];
        };
        for (let k = 0; k < idx.getCount(); k += 3) {
          const a = world(idx.getScalar(k));
          const b = world(idx.getScalar(k + 1));
          const c = world(idx.getScalar(k + 2));
          const x = (a[0] + b[0] + c[0]) / 3;
          const z = (a[1] + b[1] + c[1]) / 3;
          totals.set(m, (totals.get(m) ?? 0) + 1);
          let bad = check(x, z);
          if (!bad && (m === 'st_paint_lines' || m === 'st_paint') && [a, b, c].some((q) => s.distance(q[0], q[1]) > 0)) {
            bad = 'cornerOverKerb';
          }
          if (!bad && m === 'st_tactile' && [a, b, c].some((q) => s.distance(q[0], q[1]) < 0)) {
            bad = 'cornerOnCarriageway';
          }
          if (bad) {
            bump(m, bad, x, z);
          }
        }
      }
    }
  }
  for (const inst of man.instances ?? []) {
    if (!/^(st_|fac_bin|lamp)/.test(inst.asset) || /^st_(person|car|bus|tram|dog|cat|pigeon|gull|vehicle)/.test(inst.asset)) {
      continue;
    }
    const [x, , z] = inst.position;
    const key = `inst:${inst.asset}`;
    totals.set(key, (totals.get(key) ?? 0) + 1);
    if (f.footprints.inside(x, z)) {
      bump(key, 'inBuilding', x, z);
    } else if (s.distance(x, z) < 0 && !pedPaving(x, z)) {
      bump(key, 'onCarriageway', x, z);
    } else if (s.distance(x, z) < KERB_WIDTH + 0.05 && s.distance(x, z) >= 0 && s.kerbed(x, z)) {
      bump(key, 'onKerb', x, z);
    }
  }
}

const out: Record<string, { total: number; bad: Record<string, number> }> = {};
for (const [m, n] of [...totals.entries()].sort()) {
  const bad = Object.fromEntries([...(counts.get(m) ?? new Map()).entries()].sort());
  out[m] = { total: n, bad };
  const nb = Object.values(bad).reduce((q: number, v) => q + (v as number), 0);
  if (nb || CHECKS[m]) {
    console.log(m.padEnd(28), String(n).padStart(7), 'bad', String(nb).padStart(6), JSON.stringify(bad));
  }
}
console.log('\nworst 4 m cells:');
for (const sp of [...spots.values()].sort((a, b) => b.n - a.n).slice(0, spotsN)) {
  console.log(`${sp.x.toFixed(1)},${sp.z.toFixed(1)}`, sp.n, [...sp.what].join(' '), 'zone', s.zone(sp.x, sp.z), 'D', s.distance(sp.x, sp.z).toFixed(2));
}
const json = argOf('--json');
if (json) {
  writeFileSync(json, JSON.stringify({ area: areaId, out, spots: [...spots.values()].sort((a, b) => b.n - a.n).slice(0, 60).map((q) => ({ ...q, what: [...q.what] })) }, null, 1));
}
