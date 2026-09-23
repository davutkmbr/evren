/**
 * Evren world compiler, format 0 (greybox): compiles one street-profile OSM area (data/osm/<area>.json, written by
 * scripts/data/fetch-osm.mjs) into ~100 m glTF tiles plus JSON manifests under public/world/<area>/ (gitignored).
 *
 *   npm run compile:world -- --area kadikoy [--out public/world/kadikoy] [--no-validate] [--min-walk-share 0.9]
 *
 * Output layout and format: tools/world-compiler/README.md. Map data © OpenStreetMap contributors, ODbL 1.0.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { latLonToLocal, WORLD_ORIGIN } from '../../../src/core/geo-coords';
import { BoxGrid, bounds, hash, pointInRing } from '../../../src/world/osm/shared/geometry';
import { readArea, ROOT } from '../lib/areas.mjs';
import { emitSolid, finalizeDoors, makeSolids, placeDoors, type Solid } from './buildings';
import { FORMAT, type IndexManifest, type PoiRec, type SpawnRec, TILE_SIZE, type TileManifest, type TileRef, type XYZ } from './format';
import { buildFoundation } from './foundation';
import { GENERATOR, writeTileGlb } from './gltf';
import { exportLaneGraph, exportWalkGraph } from './graphs';
import { buildGround, groundHeights, landField, PierField } from './ground';
import { MATERIALS } from './materials';
import { TileMesh } from './mesh';
import { loadStreetData } from './osm-street';
import { placeLamps } from './lamps';
import { isBench, isPoi, isTree } from './pois';
import { validateGlb, type ValidationSummary } from './validate';

const COMPILER_VERSION = '0.1.1';
/** The run fails when the largest walk-graph component holds less than this share of the vertices (--min-walk-share). */
const MIN_WALK_SHARE = 0.9;
const SPAWNS_PER_TILE = 4;
const SPAWN_SPACING = 25;

const args = process.argv.slice(2);
const argOf = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};
const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex').slice(0, 16);
const r2 = (v: number): number => Math.round(v * 100) / 100;
const tileKey = (i: number, j: number): string => `${i}_${j}`;
const tileOfPoint = (x: number, z: number): string => tileKey(Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE));
const heading = (dx: number, dz: number): number => {
  const h = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return Math.round((h < 0 ? h + 360 : h) * 10) / 10;
};

async function main(): Promise<void> {
  const t0 = performance.now();
  const area = readArea(argOf('--area') ?? 'kadikoy');
  if (area.profile !== 'street') {
    throw new Error(`area '${area.id}' has profile '${area.profile}'; the compiler needs a 'street' area`);
  }
  const outDir = resolve(ROOT, argOf('--out') ?? `public/world/${area.id}`);
  const validate = !args.includes('--no-validate');
  const minWalkShare = Number(argOf('--min-walk-share') ?? MIN_WALK_SHARE);
  const data = loadStreetData(resolve(ROOT, area.dataFile));

  /* Tile grid: every TILE_SIZE square that touches the area. */
  const sw = latLonToLocal(area.bbox.south, area.bbox.west);
  const ne = latLonToLocal(area.bbox.north, area.bbox.east);
  const areaRect = { minX: sw.x, maxX: ne.x, minZ: ne.z, maxZ: sw.z };
  const i0 = Math.floor(areaRect.minX / TILE_SIZE);
  const i1 = Math.floor((areaRect.maxX - 1e-6) / TILE_SIZE);
  const j0 = Math.floor(areaRect.minZ / TILE_SIZE);
  const j1 = Math.floor((areaRect.maxZ - 1e-6) / TILE_SIZE);
  const rect = { minX: i0 * TILE_SIZE, maxX: (i1 + 1) * TILE_SIZE, minZ: j0 * TILE_SIZE, maxZ: (j1 + 1) * TILE_SIZE };
  const inRect = (x: number, z: number): boolean => x >= rect.minX && x < rect.maxX && z >= rect.minZ && z < rect.maxZ;

  /* Foundation, fields, solids, doors, graphs. */
  const f = buildFoundation(data, rect);
  const t1 = performance.now();
  const piers = new PierField(data);
  const land = landField(f, piers);
  const heights = groundHeights(f.surface);
  const solids = makeSolids(data.buildings, heights).filter((s) => inRect(s.cx, s.cz));
  const { stats: doorStats, poiDoor } = placeDoors(solids, data.points, f.surface, f.footprints, land, (p) => inRect(p.x, p.z));
  const replaced = new Map<object, object>();
  for (const s of solids) {
    finalizeDoors(s, heights, doorStats, (from, to) => replaced.set(from, to));
  }
  const walk = exportWalkGraph(area.id, data, f.surface, rect, heights, tileOfPoint);
  const lanes = exportLaneGraph(area.id, data, f.surface, rect, heights);
  const t2 = performance.now();

  /* Host building of every POI (the solid it stands in, or the nearest facade within 8 m). */
  const solidGrid = new BoxGrid(20);
  solids.forEach((s, k) => {
    const b = bounds(s.ring);
    solidGrid.add(k, b.minX - 8, b.minZ - 8, b.maxX + 8, b.maxZ + 8);
  });
  const hostOf = (x: number, z: number): Solid | null => {
    let best: Solid | null = null;
    let bestD = 8;
    for (const k of solidGrid.at(x, z)) {
      const s = solids[k];
      if (!s.grounded) {
        continue;
      }
      if (pointInRing(s.ring, x, z)) {
        return s;
      }
      for (let i = 0; i < s.ring.length / 2; i++) {
        const n = s.ring.length / 2;
        const ax = s.ring[i * 2];
        const az = s.ring[i * 2 + 1];
        const bx = s.ring[((i + 1) % n) * 2];
        const bz = s.ring[((i + 1) % n) * 2 + 1];
        const l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
        const d = Math.hypot(ax + (bx - ax) * t - x, az + (bz - az) * t - z);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
    }
    return best;
  };
  const resolveDoor = <T extends object>(d: T | null): T | null => {
    let cur = d;
    while (cur && replaced.has(cur)) {
      cur = replaced.get(cur) as T;
    }
    return cur;
  };

  /* Per-tile manifests. */
  const manifests = new Map<string, TileManifest>();
  const tileBounds = (i: number, j: number) => ({ minX: i * TILE_SIZE, minZ: j * TILE_SIZE, maxX: (i + 1) * TILE_SIZE, maxZ: (j + 1) * TILE_SIZE });
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const id = tileKey(i, j);
      const b = tileBounds(i, j);
      manifests.set(id, { format: FORMAT, area: area.id, id, i, j, bounds: b, origin: [b.minX + TILE_SIZE / 2, 0, b.minZ + TILE_SIZE / 2], content: { min: [0, 0, 0], max: [0, 0, 0] }, glb: `${id}.glb`, triangles: 0, buildings: [], doors: [], pois: [], lamps: [], trees: [], benches: [], spawns: [] });
    }
  }
  const tileOfSolid = new Map<Solid, string>();
  for (const s of solids) {
    const t = tileOfPoint(s.cx, s.cz);
    tileOfSolid.set(s, t);
    const m = manifests.get(t)!;
    m.buildings.push(s.rec);
    for (const d of s.doors) {
      if (d.rec) {
        m.doors.push(d.rec);
      }
    }
  }
  const at = (x: number, z: number): XYZ => [r2(x), r2(heights.at(x, z)), r2(z)];
  let poiCount = 0;
  data.points.forEach((p, pi) => {
    if (!inRect(p.x, p.z)) {
      return;
    }
    if (isPoi(p)) {
      const link = poiDoor.get(pi);
      const host = link?.solid ?? hostOf(p.x, p.z);
      let door = resolveDoor(link?.door ?? null);
      if (!door?.rec && host) {
        door = null;
        let best = 15;
        for (const d of host.doors) {
          const dd = d.rec ? Math.hypot(d.rec.position[0] - p.x, d.rec.position[2] - p.z) : Infinity;
          if (dd < best) {
            best = dd;
            door = d;
          }
        }
      }
      const rec: PoiRec = { id: `p${pi}`, kind: p.kind, position: at(p.x, p.z) };
      if (p.name) {
        rec.osmName = p.name;
      }
      if (host) {
        rec.building = host.rec.id;
      }
      if (door?.rec) {
        rec.door = door.rec.id;
        door.rec.pois.push(rec.id);
      }
      const t = host && tileOfSolid.has(host) ? tileOfSolid.get(host)! : tileOfPoint(p.x, p.z);
      manifests.get(t)?.pois.push(rec);
      poiCount++;
      return;
    }
    const m = manifests.get(tileOfPoint(p.x, p.z));
    if (!m) {
      return;
    }
    if (isTree(p)) {
      m.trees.push({ position: at(p.x, p.z), ...(p.height ? { height: p.height } : {}), ...(p.crown ? { crown: p.crown } : {}), ...(p.species ? { species: p.species } : {}), ...(p.genus ? { genus: p.genus } : {}), ...(p.leafType ? { leafType: p.leafType } : {}) });
    } else if (isBench(p)) {
      m.benches.push({ position: at(p.x, p.z), kind: p.kind, ...(p.backrest ? { backrest: p.backrest } : {}) });
    }
  });

  /* Street lamps (OSM nodes first, then the street lighting rules). */
  const placedLamps = placeLamps(data, f.surface, f.footprints);
  for (const l of placedLamps) {
    if (!inRect(l.x, l.z)) {
      continue;
    }
    const { x, z, ...rest } = l;
    manifests.get(tileOfPoint(x, z))?.lamps.push({ position: at(x, z), ...rest });
  }

  /* Spawn points: spaced walk graph vertices per tile, plus the ferry landings. */
  const wv = walk.file.vertices;
  const nWalk = wv.length / 3;
  const order = Array.from({ length: nWalk }, (_, v) => v).sort((a, b) => hash(a * 1.618) - hash(b * 1.618));
  for (const v of order) {
    const m = manifests.get(walk.file.tile[v]);
    if (!m || m.spawns.length >= SPAWNS_PER_TILE) {
      continue;
    }
    const x = wv[v * 3];
    const z = wv[v * 3 + 2];
    if (m.spawns.some((s) => Math.hypot(s.position[0] - x, s.position[2] - z) < SPAWN_SPACING)) {
      continue;
    }
    m.spawns.push({ position: [x, wv[v * 3 + 1], z], heading: heading(walk.dir[v * 2], walk.dir[v * 2 + 1]), kind: 'walk' });
  }
  let pierSpawns = 0;
  for (const a of data.areas) {
    if (a.kind !== 'man_made=pier' && a.kind !== 'amenity=ferry_terminal') {
      continue;
    }
    const n = a.ring.length / 2;
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < n; k++) {
      cx += a.ring[k * 2];
      cz += a.ring[k * 2 + 1];
    }
    cx /= n;
    cz /= n;
    let best = -1;
    let bestD = 60;
    for (let v = 0; v < nWalk; v++) {
      const d = Math.hypot(wv[v * 3] - cx, wv[v * 3 + 2] - cz);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    const m = best >= 0 ? manifests.get(walk.file.tile[best]) : undefined;
    if (m) {
      const spawn: SpawnRec = { position: [wv[best * 3], wv[best * 3 + 1], wv[best * 3 + 2]], heading: heading(walk.dir[best * 2], walk.dir[best * 2 + 1]), kind: 'pier' };
      m.spawns.push(spawn);
      pierSpawns++;
    }
  }

  /* Geometry, glb, validation. */
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(resolve(outDir, 'tiles'), { recursive: true });
  const refs: TileRef[] = [];
  const reports: ValidationSummary[] = [];
  const groundTotals = { kerbWallM: 0, quayWallM: 0, kerbStepM: [0, 0, 0, 0] };
  const bySolidTile = new Map<string, Solid[]>();
  for (const s of solids) {
    const t = tileOfSolid.get(s)!;
    bySolidTile.set(t, [...(bySolidTile.get(t) ?? []), s]);
  }
  for (const m of manifests.values()) {
    const mesh = new TileMesh(m.origin[0], m.origin[2]);
    const g = buildGround(m.bounds, f, heights, land, mesh);
    groundTotals.kerbWallM += g.kerbWallM;
    groundTotals.quayWallM += g.quayWallM;
    g.kerbStepM.forEach((v, k) => (groundTotals.kerbStepM[k] += v));
    for (const s of bySolidTile.get(m.id) ?? []) {
      emitSolid(s, mesh);
    }
    m.triangles = mesh.triangles();
    if (!m.triangles) {
      manifests.delete(m.id);
      continue;
    }
    const parts = mesh.take();
    const min: XYZ = [Infinity, Infinity, Infinity];
    const max: XYZ = [-Infinity, -Infinity, -Infinity];
    for (const p of parts) {
      for (let k = 0; k < p.position.length; k += 3) {
        for (let c = 0; c < 3; c++) {
          const v = p.position[k + c] + m.origin[c];
          min[c] = Math.min(min[c], v);
          max[c] = Math.max(max[c], v);
        }
      }
    }
    m.content = { min: min.map(r2) as XYZ, max: max.map(r2) as XYZ };
    const glb = await writeTileGlb(`tile_${m.id}`, m.origin, parts, { format: FORMAT, area: area.id, tile: m.id });
    const manifestText = JSON.stringify(m);
    writeFileSync(resolve(outDir, 'tiles', `${m.id}.glb`), glb);
    writeFileSync(resolve(outDir, 'tiles', `${m.id}.json`), manifestText);
    const glbHash = sha(glb);
    const manifestHash = sha(manifestText);
    refs.push({ id: m.id, i: m.i, j: m.j, bounds: m.bounds, glb: `tiles/${m.id}.glb`, manifest: `tiles/${m.id}.json`, glbHash, manifestHash, hash: sha(glbHash + manifestHash), bytes: glb.byteLength, triangles: m.triangles });
    if (validate) {
      reports.push(await validateGlb(`tiles/${m.id}.glb`, glb));
    }
  }
  const walkText = JSON.stringify(walk.file);
  const laneText = JSON.stringify(lanes);
  writeFileSync(resolve(outDir, 'walk.json'), walkText);
  writeFileSync(resolve(outDir, 'lanes.json'), laneText);
  const index: IndexManifest = {
    format: FORMAT,
    area: area.id,
    compiler: { name: GENERATOR, version: COMPILER_VERSION },
    frame: { origin: { ...WORLD_ORIGIN }, axes: '+X east, +Y up, +Z south (north is -Z); glTF axes are the same', units: 'm', seaLevel: 0 },
    osm: { source: data.source, licence: 'Map data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)', fetched: data.fetched, osmBase: data.osmBase, bbox: area.bbox },
    tileSize: TILE_SIZE,
    areaBounds: { minX: r2(areaRect.minX), minZ: r2(areaRect.minZ), maxX: r2(areaRect.maxX), maxZ: r2(areaRect.maxZ) },
    rect: { minX: rect.minX, minZ: rect.minZ, maxX: rect.maxX, maxZ: rect.maxZ },
    materials: Object.entries(MATERIALS).map(([name, c]) => ({ name, color: `#${c.toString(16).padStart(6, '0')}` })),
    tiles: refs,
    walkGraph: { file: 'walk.json', hash: sha(walkText), vertices: nWalk, edges: walk.file.edges.length / 2 },
    laneGraph: { file: 'lanes.json', hash: sha(laneText), paths: lanes.paths.length },
    hash: '',
  };
  index.hash = sha(refs.map((r) => r.hash).join('') + index.walkGraph.hash + index.laneGraph.hash);
  writeFileSync(resolve(outDir, 'index.json'), JSON.stringify(index, null, 1));
  const t3 = performance.now();

  /* Summary. */
  const tris = refs.map((r) => r.triangles).sort((a, b) => a - b);
  const sizes = refs.map((r) => r.bytes).sort((a, b) => a - b);
  const all = [...manifests.values()];
  const doors = all.flatMap((m) => m.doors);
  const sum = (list: number[]): number => list.reduce((a, b) => a + b, 0);
  const walkNet = walk.network;
  const walkConnected = walkNet.largestShare >= minWalkShare;
  const summary = {
    ok: !reports.some((r) => r.errors > 0) && walkConnected,
    area: area.id,
    out: outDir,
    tiles: refs.length,
    tileGrid: `${i1 - i0 + 1} x ${j1 - j0 + 1} (${(i1 - i0 + 1) * (j1 - j0 + 1) - refs.length} water-only tiles skipped)`,
    triangles: { total: sum(tris), min: tris[0], median: tris[tris.length >> 1], max: tris.at(-1) },
    glbBytes: { total: sum(sizes), min: sizes[0], median: sizes[sizes.length >> 1], max: sizes.at(-1) },
    manifestBytes: sum(all.map((m) => JSON.stringify(m).length)),
    buildings: { solids: sum(all.map((m) => m.buildings.length)), height: solids.filter((s) => s.rec.heightSource === 'height').length, levels: solids.filter((s) => s.rec.heightSource === 'levels').length, default: solids.filter((s) => s.rec.heightSource === 'default').length },
    doors: { total: doors.length, tagged: doors.filter((d) => !d.inferred).length, inferred: doors.filter((d) => d.inferred).length, ...doorStats },
    pois: poiCount,
    lamps: { total: sum(all.map((m) => m.lamps.length)), inferred: sum(all.map((m) => m.lamps.filter((l) => l.inferred).length)) },
    trees: sum(all.map((m) => m.trees.length)),
    benches: sum(all.map((m) => m.benches.length)),
    spawns: { total: sum(all.map((m) => m.spawns.length)), pier: pierSpawns },
    ground: { kerbWallM: Math.round(groundTotals.kerbWallM), kerbStepM: { below5cm: Math.round(groundTotals.kerbStepM[0]), '5to12cm': Math.round(groundTotals.kerbStepM[1]), '12to15cm': Math.round(groundTotals.kerbStepM[2]), above15cm: Math.round(groundTotals.kerbStepM[3]) }, quayWallM: Math.round(groundTotals.quayWallM), coastSource: f.coastSource, piers: piers.count },
    walkGraph: {
      vertices: nWalk,
      edges: walk.file.edges.length / 2,
      components: walkNet.components,
      largestComponent: walkNet.largest,
      largestShare: walkNet.largestShare,
      minShare: minWalkShare,
      connected: walkConnected,
      isolated: walkNet.isolated,
      crossings: walkNet.crossings,
      runtime: { ...walk.runtime, lanes: walk.lanes, squares: walk.squares, crossings: walk.runtimeCrossings },
      network: { merged: walkNet.merged, healed: walkNet.healed, addedLanes: walkNet.addedLanes, endLinks: walkNet.endLinks, stitched: walkNet.stitched },
      bytes: walkText.length,
    },
    laneGraph: { paths: lanes.paths.length, lanes: lanes.paths.filter((p) => p.kind === 'lane').length, bytes: laneText.length },
    validator: validate ? { files: reports.length, errors: sum(reports.map((r) => r.errors)), warnings: sum(reports.map((r) => r.warnings)), infos: sum(reports.map((r) => r.infos)), hints: sum(reports.map((r) => r.hints)), firstIssues: reports.filter((r) => r.errors + r.warnings > 0).slice(0, 3) } : 'skipped',
    indexHash: index.hash,
    ms: { foundation: Math.round(t1 - t0), ...f.ms, solidsDoorsGraphs: Math.round(t2 - t1), tiles: Math.round(t3 - t2), total: Math.round(t3 - t0) },
  };
  console.log(JSON.stringify(summary, null, 1));
  if (!walkConnected) {
    console.error(`walk graph: largest component holds ${(walkNet.largestShare * 100).toFixed(1)}% of ${nWalk} vertices (${walkNet.components} components), below ${minWalkShare * 100}%`);
  }
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
