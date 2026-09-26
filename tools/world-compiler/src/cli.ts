/**
 * Evren world compiler: compiles one street-profile OSM area (data/osm/<area>.json, written by
 * scripts/data/fetch-osm.mjs) into ~100 m glTF tiles plus JSON manifests under public/world/<area>/ (gitignored).
 *
 *   npm run compile:world -- --area kadikoy [--out public/world/kadikoy] [--format 0|1] [--strip auto|none|x0,z0,x1,z1]
 *   [--no-compress]  (format 1 glbs are meshopt-compressed by default, see compress.ts)
 *   [--web]  (format 1: the flight game's delivery profile, see web.ts: unread attributes dropped, --tex-max 1024 unless
 *            given, WebP in the shared store, gzip, root index public/world/index.json)
 *   [--landmarks block|none]  (none: landmark buildings get no geometry, for runtimes with their own models)
 *                            [--tiles all|strip] [--tex-max 2048] [--all-props] [--no-validate] [--min-walk-share 0.9]
 *   [--jobs N|auto]  (tile worker threads, parallel/pool.ts; default auto = cores - 1, capped by memory)
 *   [--cache strict|local|off] [--force]  (incremental compile: cache.ts, stage-cache.ts; --force rebuilds everything)
 *   [--check]  (compiles again serially without the cache and compares the outputs byte for byte, parallel/check.ts)
 *   `npm run compile:world` runs this file through tools/world-compiler/run.mjs (an esbuild bundle, faster than tsx).
 *
 * Format 0: greybox. Format 1 (default): textured PBR materials with shared external textures, UV0/UV1, LOD glbs
 * with distance bands, prop instances and a light list; the strip compiles at full detail, other tiles as greybox.
 * The compile steps, materials and props come from registry.ts. Output layout and format: tools/world-compiler/README.md.
 * Map data © OpenStreetMap contributors, ODbL 1.0.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { latLonToLocal, WORLD_ORIGIN } from '../../../src/core/geo-coords';
import { BoxGrid, bounds, hash, pointInRing } from '../../../src/world/osm/shared/geometry';
import { readArea, ROOT } from '../lib/areas.mjs';
import { finalizeDoors, makeSolids, placeDoors, type Solid } from './buildings';
import type { GroundTotals } from './core-steps';
import {
  type AssetCreditRec,
  FORMAT,
  type FormatVersion,
  type IndexManifest,
  type InstanceRec,
  type LodRef,
  type MaterialRec,
  type PoiRec,
  type PropRec,
  type SpawnRec,
  type StripInfo,
  TILE_SIZE,
  type TileManifest,
  type TileRef,
  type XYZ,
} from './format';
import { outlineIndex, solidCover } from './cover';
import { landmarkOf, setLandmarkBlocks, useDistrict } from './district';
import { buildFoundation, type CoastSpec, coastGrid, coastPlan, coastRows, type SharedFoundation } from './foundation';
import { CoastField } from './coast';
import type { GridWin } from '../../../src/world/osm/shared/protocol';
import { receiveShared, toShared } from './parallel/share';
import { GENERATOR, GENERATOR_V1, weatherRecord, writeTileGlb, writeTileGlbV1 } from './gltf';
import { exportLaneGraph, exportWalkGraph } from './graphs';
import { attachPassages } from './passages';
import { groundHeights, landField, PierField } from './ground';
import { InstanceSink, rotateYaw, yawQuat } from './instances';
import { LightSink } from './lights';
import { LOD_LEVELS, LOD_POLICY } from './lod';
import { linearRgb, materialDef, MATERIALS, type MaterialName, variantFields, weatherLayerMaterials } from './materials';
import { TileMesh } from './mesh';
import { loadStreetData } from './osm-street';
import { placeLamps } from './lamps';
import { isBench, isPoi, isTree } from './pois';
import { PropBaker, propDef } from './props';
import { type AreaContext, type PlaceOptions, PROP_SETS, registerAll, stepsFor, type TileContext } from './registry';
import { intersects, readStrip } from './strip';
import { type BakedSet, DEFAULT_TEXTURES, TextureBaker, tilingOf } from './textures';
import { validateGlb, type ValidationSummary } from './validate';
import { compressionEnabled, setCompression } from './compress';
import { packWeb, setWebProfile, WEB_TEX_MAX, webProfile } from './web';
import { writeWorldIndex } from './world-index';
import { type PlacementLog, placementLog, placementRules } from './street/placement';
import { areaKey, clearAreaStamp, FeatureIndex, optionsKey, readAreaStamp, sourceHash, TileCache, type TileKeyScope, writeAreaStamp } from './cache';
import { StageStore } from './stage-cache';
import { assemblySourceHash, globalInputs, setupSourceHash } from './sources';
import { perfAdd, perfMerge, perfReport, timed, timedSync } from './perf';
import { askState, autoJobs, serveTiles, tellState, TilePool, workerInput } from './parallel/pool';
import { ExitStates, localGate, OrderedChain, remoteGate } from './parallel/ordered';
import { addInto, LoggedSet, statsApply, statsDelta, statsOf, statsReset, type TileOut } from './parallel/tile-out';
import { checkAgainstSerial } from './parallel/check';
import { takeTileSlots, writeAreaModules } from './modules/assemble';

const COMPILER_VERSION = '0.2.0';
/** The run fails when the largest walk-graph component holds less than this share of the vertices (--min-walk-share). */
const MIN_WALK_SHARE = 0.9;
const SPAWNS_PER_TILE = 4;
const SPAWN_SPACING = 25;

/** Worker threads (--jobs, parallel/pool.ts) run this file too: they compile the tiles the main thread hands them. */
const worker = workerInput();
const args = worker?.args ?? process.argv.slice(2);
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
const median = (list: number[]): number => {
  const s = [...list].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

async function main(): Promise<void> {
  const t0 = performance.now();
  const area = readArea(argOf('--area') ?? 'kadikoy');
  const profile = useDistrict(area.id);
  registerAll();
  if (area.profile !== 'street') {
    throw new Error(`area '${area.id}' has profile '${area.profile}'; the compiler needs a 'street' area`);
  }
  const format = Number(argOf('--format') ?? FORMAT) as FormatVersion;
  if (format !== 0 && format !== 1) {
    throw new Error(`--format must be 0 or 1`);
  }
  const outDir = resolve(ROOT, argOf('--out') ?? `public/world/${area.id}`);
  const validate = !args.includes('--no-validate');
  setCompression(format === 1 && !args.includes('--no-compress'));
  setWebProfile(format === 1 && compressionEnabled() && args.includes('--web'));
  const landmarkMode = argOf('--landmarks') ?? 'block';
  if (landmarkMode !== 'block' && landmarkMode !== 'none') {
    throw new Error(`--landmarks must be block or none, got '${landmarkMode}'`);
  }
  const landmarkBlocks = landmarkMode === 'block';
  setLandmarkBlocks(landmarkBlocks);
  const minWalkShare = Number(argOf('--min-walk-share') ?? MIN_WALK_SHARE);
  const onlyStrip = argOf('--tiles') === 'strip';
  const texMax = argOf('--tex-max') ? Number(argOf('--tex-max')) : args.includes('--web') ? WEB_TEX_MAX : null;
  /* Incremental cache (cache.ts): --cache strict|local|off (default strict), --force rebuilds everything. */
  const cacheMode = (argOf('--cache') ?? 'strict') as TileKeyScope | 'off';
  if (!['strict', 'local', 'off'].includes(cacheMode)) {
    throw new Error(`--cache must be strict, local or off, got '${cacheMode}'`);
  }
  const force = args.includes('--force');
  const dataBytes = readFileSync(resolve(ROOT, area.dataFile));
  const stampKey = worker || cacheMode === 'off' ? '' : areaKey({ source: sourceHash(), data: dataBytes, options: optionsKey(args), area: area.id });
  if (stampKey && !force) {
    const stamp = readAreaStamp(outDir, stampKey);
    if (stamp) {
      console.log(JSON.stringify({ ...(stamp.summary as object), upToDate: true, ms: { total: Math.round(performance.now() - t0) } }, null, 1));
      return;
    }
  }
  if (!worker) {
    clearAreaStamp(outDir);
  }
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
  /* Tile workers (--jobs N|auto, parallel/pool.ts): started now, so their area setup runs alongside this one's. */
  const jobsArg = argOf('--jobs') ?? 'auto';
  const jobs = worker ? 1 : jobsArg === 'auto' ? autoJobs((i1 - i0 + 1) * (j1 - j0 + 1)) : Math.max(1, Math.floor(Number(jobsArg)) || 1);
  const pool = jobs > 1 ? new TilePool(jobs, new URL(import.meta.url), (k) => ({ evrenCompileWorker: true, args, bakeDir: resolve(ROOT, 'node_modules/.cache/evren-world/jobs', `${process.pid}-${k}`) })) : null;

  /* Foundation, fields, solids, doors, graphs. */
  // Worker threads take the main thread's foundation (parallel/share.ts) instead of building their own.
  // Their setup jobs: rows of the main thread's coast grids (the slowest part of the foundation on a large area).
  let shore: CoastField | null = null;
  const coastJob = (p: { spec: CoastSpec; coarse: GridWin<Float32Array> | null; j0: number; j1: number }): Float32Array => coastRows((shore ??= new CoastField(data)), p.spec, p.coarse, p.j0, p.j1);
  const f = worker ? buildFoundation(data, rect, 40, await receiveShared<SharedFoundation>('foundation', { coast: coastJob })) : buildFoundation(data, rect, 40, undefined, pool ? await timed('setup.coast', () => parallelCoast(pool, data, rect)) : undefined);
  pool?.share('foundation', toShared({ base: f.base, coastSource: f.coastSource } satisfies SharedFoundation));
  const t1 = performance.now();
  const piers = new PierField(data);
  const land = landField(f, piers);
  const heights = groundHeights(f.surface);
  const solids = timedSync('setup.solids', () => makeSolids(data.buildings, heights).filter((s) => inRect(s.cx, s.cz)));
  const landmarkOsmIds = new Set(data.buildings.filter((b) => landmarkOf(b)).map((b) => b.id));
  // Building passages (rule walk.passage): opened in the emitted buildings, walked by the walk network. Landmarks drawn
  // as plain blocks (--landmarks block) keep their walls, so no passage runs through them.
  const passages = attachPassages(
    solids.filter((s) => !(landmarkBlocks && landmarkOsmIds.has(s.rec.osmId))),
    data,
    heights,
  );
  const { stats: doorStats, poiDoor } = timedSync('setup.doors', () => placeDoors(solids, data.points, f.surface, f.footprints, land, (p) => inRect(p.x, p.z)));
  const replaced = new Map<object, object>();
  for (const s of solids) {
    finalizeDoors(s, heights, doorStats, (from, to) => replaced.set(from, to));
  }
  // The graphs are plain data: worker threads take the main thread's (parallel/share.ts).
  type Graphs = { walk: ReturnType<typeof exportWalkGraph>; lanes: ReturnType<typeof exportLaneGraph> };
  const { walk, lanes } = worker
    ? await receiveShared<Graphs>('graphs')
    : { walk: timedSync('setup.walk', () => exportWalkGraph(area.id, data, f.surface, rect, heights, tileOfPoint, passages)), lanes: timedSync('setup.lanes', () => exportLaneGraph(area.id, data, f.surface, rect, heights)) };
  pool?.share('graphs', toShared({ walk, lanes } satisfies Graphs));
  walk.file.format = format;
  lanes.format = format;
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
      manifests.set(id, { format, area: area.id, id, i, j, bounds: b, origin: [b.minX + TILE_SIZE / 2, 0, b.minZ + TILE_SIZE / 2], content: { min: [0, 0, 0], max: [0, 0, 0] }, glb: `${id}.glb`, triangles: 0, buildings: [], doors: [], pois: [], lamps: [], trees: [], benches: [], spawns: [] });
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
  const placedLamps = timedSync('setup.lamps', () => placeLamps(data, f.surface, f.footprints));
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

  /* Strip (format 1): full detail inside, greybox outside. */
  let strip: StripInfo | null = null;
  if (format === 1) {
    const s = readStrip(argOf('--strip') === 'auto' ? null : argOf('--strip'));
    if (s) {
      strip = { source: s.source, rect: s.rect, tiles: [...manifests.values()].filter((m) => intersects(m.bounds, s.rect)).map((m) => m.id) };
    }
  }
  const stripTiles = new Set(strip?.tiles ?? []);
  const detailOf = (id: string): 'full' | 'greybox' => (stripTiles.has(id) ? 'full' : 'greybox');
  if (onlyStrip) {
    for (const id of [...manifests.keys()]) {
      if (!stripTiles.has(id)) {
        manifests.delete(id);
      }
    }
  }

  /* Geometry, glb, validation. */
  // Worker threads write their tiles into outDir (the main thread created it) and bake textures and props into a
  // private folder: the main thread rebuilds those from the tiles' records, in serial order.
  const bakeDir = worker?.bakeDir ?? outDir;
  if (!worker) {
    // Retries: Spotlight or a viewer may hold files of the old output for a moment (ENOTEMPTY / EBUSY).
    rmSync(outDir, { recursive: true, force: true, maxRetries: 5 });
  }
  mkdirSync(resolve(outDir, 'tiles'), { recursive: true });
  const textures = format === 1 ? new TextureBaker(bakeDir, texMax ? { ...DEFAULT_TEXTURES, colorMax: Math.min(texMax, DEFAULT_TEXTURES.colorMax), normalMax: Math.min(texMax, DEFAULT_TEXTURES.normalMax), ormMax: Math.min(texMax, DEFAULT_TEXTURES.ormMax) } : DEFAULT_TEXTURES) : null;
  const props = textures ? new PropBaker(bakeDir, textures) : null;
  const propLog: string[] = [];
  if (props) {
    // Worker threads process the props their tiles use themselves (into their bake folder): asking the main thread
    // serialises every prop build behind one thread and leaves the workers waiting.
    const get = props.get.bind(props);
    props.get = (id: string) => {
      propLog.push(id);
      return get(id);
    };
  }
  const refs: TileRef[] = [];
  const reports: ValidationSummary[] = [];
  const bySolidTile = new Map<string, Solid[]>();
  for (const s of solids) {
    const t = tileOfSolid.get(s)!;
    bySolidTile.set(t, [...(bySolidTile.get(t) ?? []), s]);
  }
  const actx: AreaContext = {
    format,
    area: { id: area.id, bbox: area.bbox },
    data,
    foundation: f,
    heights,
    land,
    piers,
    solids,
    tileOfSolid,
    outlines: outlineIndex(data.buildings),
    cover: solidCover(landmarkBlocks ? solids : solids.filter((s) => !landmarkOsmIds.has(s.rec.osmId))),
    district: profile,
    manifests,
    walk,
    lanes,
    strip,
    detailOf,
    outDir,
    shared: new Map(),
  };
  const steps = stepsFor(format);
  for (const s of steps) {
    const tp = performance.now();
    await s.prepare?.(actx);
    perfAdd(`prepare.${s.id}`, performance.now() - tp);
  }
  const fileCache = new Map<string, Uint8Array>();
  const readOut = (base: string) => (uri: string): Uint8Array => {
    const p = resolve(bakeDir, base, uri);
    let b = fileCache.get(p);
    if (!b) {
      b = readFileSync(p);
      fileCache.set(p, b);
    }
    return b;
  };
  const baked = new Map<MaterialName, BakedSet | null>();
  const usedMaterials = new LoggedSet<MaterialName>();
  const lightmapTexels: number[] = [];
  const stepMs: Record<string, number> = {};
  let droppedInstances = 0;
  // Ordered steps (parallel/ordered.ts): worker threads take the entry state from the main thread.
  const exits = new ExitStates(worker ? tellState : undefined);
  const gate = worker ? remoteGate(exits, askState) : localGate(exits);
  /* Caches (cache.ts, stage-cache.ts): per-step effects, and assembled tiles. */
  const stageStore = cacheMode === 'off' ? null : new StageStore(area.id, optionsKey(args));
  const tileCache = cacheMode === 'off' ? null : new TileCache(area.id, optionsKey(args), outDir);
  let features: FeatureIndex | null = null;
  const setupKey = cacheMode === 'off' ? '' : sha(`${globalInputs()} ${setupSourceHash()} ${optionsKey(args)} ${area.id}`);
  const dataDigest = cacheMode === 'strict' ? sha(dataBytes) : '';
  /** Chain start of a tile: global inputs, setup code, options, the tile as the setup made it, the OSM data. */
  const tileInputKey = (m: TileManifest): string =>
    sha(`${setupKey} ${detailOf(m.id)} ${JSON.stringify(m)} ${cacheMode === 'local' ? (features ??= new FeatureIndex(data as unknown as Record<string, unknown>)).digest(m.bounds) : dataDigest}`);
  /** Set by compileTile: the tile's assembly key, and its stored result when the tile cache had it. */
  let assemblyKey = '';
  let cachedOut: TileOut | null = null;
  /**
   * What assembly reads through the registries, for the materials and props a tile uses: material definitions,
   * tiling, variants and baked texture sets; prop availability, variants and lights. Stored with a tile and checked
   * when it is restored, so a changed material or prop re-assembles exactly the tiles that use it.
   */
  const assemblyDeps = async (o: Pick<TileOut, 'materials' | 'props'>): Promise<string> => {
    const ps: unknown[] = [];
    for (const a of o.props) {
      const p = await props!.get(a);
      ps.push([a, p ? [p.rec.variants, p.rec.lights ?? null] : null]);
    }
    const ms: unknown[] = [];
    for (const id of o.materials) {
      if (textures && !baked.has(id)) {
        baked.set(id, await textures.material(id));
      }
      const b = baked.get(id) ?? null;
      ms.push([id, materialDef(id), tilingOf(id), variantFields(id), b ? [b.key, b.baseColor?.file, b.normal?.file, b.orm?.file, b.alpha] : null]);
    }
    return sha(JSON.stringify([ps, ms]));
  };
  /** The tile cache's result under `key` when its registry inputs still match (files restored), else null. */
  const assembled = async (m: TileManifest, key: string): Promise<TileOut | null> => {
    const out = tileCache!.restore(m.id, key);
    return out && out.deps === (await assemblyDeps(out)) ? out : null;
  };
  /** Compiles one tile: geometry, glbs, validation, manifest (a tile without geometry is deleted from manifests). */
  const compileTile = async (m: TileManifest): Promise<void> => {
    const detail = detailOf(m.id);
    const mesh = new TileMesh(m.origin[0], m.origin[2]);
    const instances = new InstanceSink();
    const lights = new LightSink(m.id);
    const pending: { rec: InstanceRec; yaw: number; over: Exclude<PlaceOptions['lights'], false | undefined> | Record<string, never> }[] = [];
    const extra: Record<string, unknown> = {};
    const t: TileContext = {
      area: actx,
      id: m.id,
      manifest: m,
      bounds: m.bounds,
      origin: m.origin,
      detail,
      mesh,
      solids: bySolidTile.get(m.id) ?? [],
      instances,
      lights,
      place(asset, position, yaw, opts = {}) {
        propDef(asset);
        // Shared stand rule, final check: every standing prop on land with its base on the ground (summary stand.audit).
        placementRules(actx).audit(asset, position[0], position[1], position[2]);
        const rec = instances.add(asset, position, yawQuat(yaw), opts);
        if (opts.lights !== false) {
          pending.push({ rec, yaw, over: opts.lights ?? {} });
        }
        return rec;
      },
      record(stepId, value) {
        extra[stepId] = value;
      },
    };
    /* Steps, through the stage cache (stage-cache.ts): stored effects are replayed, the others run and are stored. */
    const tileSteps = stepsFor(format, detail).filter((s) => s.tile);
    const st = stageStore ? stageStore.tile(m.id) : null;
    if (st) {
      st.chain = tileInputKey(m);
      // Every step stored and the tile assembled before (no ordered step in the way): restore its files.
      if (!force && !tileSteps.some((s) => s.ordered)) {
        const start = st.chain;
        const found = tileSteps.map((s) => {
          const key = st.key(s);
          const f = st.find(s, key);
          if (f) {
            st.advance(f);
          }
          return f;
        });
        const out = found.every(Boolean) ? await assembled(m, (assemblyKey = sha(st.chain + assemblySourceHash()))) : null;
        if (out) {
          cachedOut = out;
          st.prune();
          return;
        }
        st.chain = start;
      }
    }
    const io = { mesh, instances, lights, pending, extra, manifest: m };
    st?.attach(mesh);
    for (const s of tileSteps) {
      if (s.ordered) {
        await gate.enter(s, m.id, actx);
      }
      const ts = performance.now();
      if (st) {
        const key = st.key(s, s.ordered ? s.ordered.state(actx) : undefined);
        const f = force ? null : st.find(s, key);
        if (f) {
          st.replay(f, s, io, actx, (x) => statsApply(actx, x, () => placementLog(actx)));
          st.advance(f);
          perfAdd('stage.replay', performance.now() - ts);
        } else {
          await st.record(key, s, io, actx, async () => s.tile!(t));
          stepMs[s.id] = (stepMs[s.id] ?? 0) + performance.now() - ts;
          perfAdd(`step.${s.id}`, performance.now() - ts);
        }
      } else {
        await s.tile!(t);
        stepMs[s.id] = (stepMs[s.id] ?? 0) + performance.now() - ts;
        perfAdd(`step.${s.id}`, performance.now() - ts);
      }
      if (s.ordered) {
        gate.leave(s, m.id, actx);
      }
    }
    if (st) {
      st.prune();
      assemblyKey = sha(st.chain + assemblySourceHash());
      const out = force ? null : await assembled(m, assemblyKey);
      if (out) {
        cachedOut = out;
        return;
      }
    }
    m.triangles = mesh.triangles();
    if (!m.triangles) {
      manifests.delete(m.id);
      return;
    }

    if (format === 0) {
      const parts = mesh.take();
      m.content = contentOf(parts, m.origin);
      const glb = await writeTileGlb(`tile_${m.id}`, m.origin, parts, { format, area: area.id, tile: m.id });
      const manifestText = JSON.stringify(m);
      writeFileSync(resolve(outDir, 'tiles', `${m.id}.glb`), glb);
      writeFileSync(resolve(outDir, 'tiles', `${m.id}.json`), manifestText);
      const glbHash = sha(glb);
      const manifestHash = sha(manifestText);
      refs.push({ id: m.id, i: m.i, j: m.j, bounds: m.bounds, glb: `tiles/${m.id}.glb`, manifest: `tiles/${m.id}.json`, glbHash, manifestHash, hash: sha(glbHash + manifestHash), bytes: glb.byteLength, triangles: m.triangles });
      if (validate) {
        reports.push(await timed('validate', () => validateGlb(`tiles/${m.id}.glb`, glb)));
      }
      return;
    }

    /* Format 1: instances of available props, their lights, then one glb per LOD. */
    const keep: InstanceRec[] = [];
    for (const rec of instances.list) {
      const prop = await timed('props', () => props!.get(rec.asset));
      if (!prop || (rec.variant && !prop.rec.variants.includes(rec.variant))) {
        droppedInstances++;
        continue;
      }
      keep.push(rec);
      const p = pending.find((q) => q.rec === rec);
      for (const l of p ? (prop.rec.lights ?? []) : []) {
        const sc = rec.scale ?? 1;
        const local: XYZ = typeof sc === 'number' ? [l.position[0] * sc, l.position[1] * sc, l.position[2] * sc] : [l.position[0] * sc[0], l.position[1] * sc[1], l.position[2] * sc[2]];
        const off = rotateYaw(local, p!.yaw);
        const over = p!.over as { kelvin?: number; lumens?: number; night?: boolean };
        lights.add({
          type: l.type,
          position: [rec.position[0] + off[0], rec.position[1] + off[1], rec.position[2] + off[2]],
          ...(l.direction ? { direction: rotateYaw(l.direction, p!.yaw) } : {}),
          kelvin: over.kelvin ?? l.kelvin,
          lumens: over.lumens ?? l.lumens,
          ...(l.cone ? { cone: l.cone } : {}),
          night: over.night ?? l.night,
          source: l.source,
          ref: rec.ref ?? `${m.id}/i${keep.length - 1}`,
        });
      }
    }
    const lods: LodRef[] = [];
    const same = mesh.lodsIdentical(LOD_LEVELS[0].mask, LOD_LEVELS[1].mask);
    for (const L of LOD_LEVELS) {
      if (L.level > 0 && same) {
        lods.push({ ...lods[0], level: L.level });
        continue;
      }
      const tl = performance.now();
      const res = mesh.takeLod(L.mask, detail === 'full' ? L.lightmap.full : L.lightmap.greybox);
      perfAdd('tile.lod', performance.now() - tl);
      if (!res.triangles) {
        continue;
      }
      for (const p of res.parts) {
        for (const id of [p.material, ...weatherLayerMaterials(p.material)]) {
          usedMaterials.add(id);
          if (!baked.has(id)) {
            baked.set(id, await timed('textures', () => textures!.material(id)));
          }
        }
      }
      if (L.level === 0) {
        m.content = contentOf(res.parts, m.origin);
        if (res.lightmap && detail === 'full') {
          lightmapTexels.push(res.lightmap.texelsPerM);
        }
      }
      const file = L.level === 0 ? `${m.id}.glb` : `${m.id}.lod${L.level}.glb`;
      const lm = res.lightmap ? { size: res.lightmap.size, texelsPerM: res.lightmap.texelsPerM, padding: res.lightmap.padding, charts: res.lightmap.charts } : null;
      const glb = await timed('tile.glb', () => writeTileGlbV1({ name: `tile_${m.id}${L.level ? `_lod${L.level}` : ''}`, origin: m.origin, parts: res.parts, extras: { format, area: area.id, tile: m.id, lod: L.level, detail, lightmap: lm }, baked }));
      writeFileSync(resolve(outDir, 'tiles', file), glb);
      lods.push({ level: L.level, glb: file, hash: sha(glb), bytes: glb.byteLength, triangles: res.triangles, lightmap: lm });
      if (validate) {
        reports.push(await timed('validate', () => validateGlb(`tiles/${file}`, glb, readOut('tiles'))));
      }
    }
    m.triangles = lods[0].triangles;
    m.detail = detail;
    m.lods = lods;
    m.instances = keep;
    m.lights = lights.list;
    const slots = takeTileSlots(outDir, m.id, extra);
    if (Object.keys(extra).length) {
      m.extra = extra;
    }
    const manifestText = JSON.stringify(m);
    writeFileSync(resolve(outDir, 'tiles', `${m.id}.json`), manifestText);
    const glbHash = sha(lods.map((l) => l.hash).join(''));
    const manifestHash = sha(manifestText);
    refs.push({
      id: m.id,
      i: m.i,
      j: m.j,
      bounds: m.bounds,
      detail,
      glb: `tiles/${lods[0].glb}`,
      lods: lods.map((l) => ({ level: l.level, glb: `tiles/${l.glb}`, hash: l.hash, bytes: l.bytes, triangles: l.triangles })),
      manifest: `tiles/${m.id}.json`,
      glbHash,
      manifestHash,
      hash: sha(glbHash + manifestHash + (slots?.hash ?? '')),
      bytes: lods[0].bytes,
      triangles: lods[0].triangles,
      instances: keep.length,
      lights: lights.list.length,
      ...(slots ? { slots } : {}),
    });
  };

  /* Tiles: in this thread (--jobs 1), on the worker threads, or from the tile cache; applied in tile order. */
  const runTile = async (m: TileManifest): Promise<TileOut> => {
    const mark = { refs: refs.length, reports: reports.length, texels: lightmapTexels.length, dropped: droppedInstances, materials: usedMaterials.log.length, props: propLog.length, stepMs: { ...stepMs }, stats: statsOf(actx) };
    assemblyKey = '';
    cachedOut = null;
    await compileTile(m);
    if (cachedOut) {
      exits.take();
      return { ...(cachedOut as TileOut), cached: true, key: assemblyKey, statsBefore: mark.stats };
    }
    const empty = !manifests.has(m.id);
    const ref = empty ? undefined : refs[refs.length - 1];
    const files = ref ? [...new Set([ref.glb, ...(ref.lods ?? []).map((l) => l.glb), ref.manifest, ...(ref.slots ? [ref.slots.file] : [])])] : [];
    const out: TileOut = {
      id: m.id,
      empty,
      ...(ref ? { manifest: m, ref } : {}),
      reports: reports.slice(mark.reports),
      lightmapTexels: lightmapTexels.slice(mark.texels),
      dropped: droppedInstances - mark.dropped,
      stepMs: Object.fromEntries(Object.entries(stepMs).map(([k, v]) => [k, v - (mark.stepMs[k] ?? 0)])),
      materials: [...new Set(usedMaterials.log.slice(mark.materials))],
      props: [...new Set(propLog.slice(mark.props))],
      stats: statsDelta(mark.stats, statsOf(actx)),
      ordered: exits.take(),
      files,
      key: assemblyKey,
    };
    if (tileCache && assemblyKey) {
      out.deps = await assemblyDeps(out);
      tileCache.store(m.id, assemblyKey, out);
    }
    return out;
  };
  if (worker) {
    await serveTiles((id) => runTile(manifests.get(id)!));
    rmSync(bakeDir, { recursive: true, force: true });
    return;
  }
  /** Adds a tile compiled elsewhere (worker thread, cache) to this thread's state, as compileTile would have. */
  const applyTile = async (o: TileOut): Promise<void> => {
    if (o.empty) {
      manifests.delete(o.id);
    } else {
      manifests.set(o.id, o.manifest!);
      refs.push(o.ref!);
    }
    reports.push(...o.reports);
    lightmapTexels.push(...o.lightmapTexels);
    droppedInstances += o.dropped;
    addInto(stepMs, o.stepMs);
    statsApply(actx, o.stats, () => placementLog(actx));
    for (const [id, state] of Object.entries(o.ordered)) {
      steps.find((s) => s.id === id)!.ordered!.restore(actx, state);
    }
    for (const id of o.materials) {
      usedMaterials.add(id);
      if (textures && !baked.has(id)) {
        baked.set(id, await timed('textures', () => textures.material(id)));
      }
    }
    for (const a of o.props) {
      await timed('props', () => props!.get(a));
    }
  };
  const tileList = [...manifests.values()];
  const orderedSteps = () => steps.filter((s) => s.ordered && s.tile);
  const outs: TileOut[] = [];
  const tt = performance.now();
  if (pool) {
    const states = new OrderedChain(new Map(orderedSteps().map((s) => [s.id, tileList.filter((m) => stepsFor(format, detailOf(m.id)).includes(s)).map((m) => m.id)])), new Map(orderedSteps().map((s) => [s.id, structuredClone(s.ordered!.state(actx))])));
    pool.services = { state: (step, tile) => states.get(step, tile), putState: (step, tile, state) => states.put(step, tile, state) };
    const pending = tileList.map((m) => pool.run(m.id));
    pending.forEach((p) => p.catch(() => {}));
    for (const p of pending) {
      const out = await p;
      outs.push(out);
      await applyTile(out);
    }
    for (const p of await pool.close()) {
      perfMerge(p);
    }
  } else {
    for (const m of tileList) {
      const out = await runTile(m);
      outs.push(out);
      if (out.cached) {
        // The tile's stored result stands for its compile: back to the statistics before it, then apply it.
        statsReset(actx, out.statsBefore!);
        await applyTile(out);
      }
    }
  }
  perfAdd('wall.tiles', performance.now() - tt);
  for (const s of steps) {
    await s.finish?.(actx);
  }

  /* Props (format 1), validated like tiles. */
  const propRecs: Record<string, PropRec> = {};
  const credits = new Map<string, AssetCreditRec>();
  const credit = (c: { id: string; name: string; kind: string; source: string; url: string; licence: string; author: string; attribution: string | null; conditions?: { text: string; met: string }[] }, user: string): void => {
    const known = credits.get(c.id);
    if (known) {
      if (!known.usedBy.includes(user)) {
        known.usedBy.push(user);
      }
    } else {
      credits.set(c.id, { ...c, usedBy: [user] });
    }
  };
  if (props && args.includes('--all-props')) {
    for (const set of PROP_SETS) {
      for (const d of set) {
        await props.get(d.id);
      }
    }
  }
  if (props) {
    for (const p of (await props.all()).sort((a, b) => a.rec.id.localeCompare(b.rec.id))) {
      propRecs[p.rec.id] = p.rec;
      if (p.credit) {
        credit(p.credit, `prop:${p.rec.id}`);
      }
      if (validate) {
        reports.push(await timed('validate', () => validateGlb(p.rec.glb, readFileSync(resolve(outDir, p.rec.glb)), readOut('props'))));
      }
    }
  }
  // Façade modules (modules/assemble.ts): the shared library and this area's material palette for them.
  const modulesRef =
    format === 1 && refs.some((r) => r.slots)
      ? await writeAreaModules(
          outDir,
          dirname(outDir),
          async (id) => {
            for (const mid of [id, ...weatherLayerMaterials(id)]) {
              usedMaterials.add(mid);
              if (textures && !baked.has(mid)) {
                baked.set(mid, await timed('textures', () => textures.material(mid)));
              }
            }
          },
          baked,
        )
      : null;
  const materialRecs: MaterialRec[] = [];
  if (format === 1) {
    for (const id of [...usedMaterials].sort()) {
      const d = materialDef(id);
      const b = baked.get(id) ?? null;
      if (b) {
        credit(b.credit, `material:${id}`);
      }
      const alphaMode = d.alphaMode ?? (b?.alpha ? 'MASK' : 'OPAQUE');
      materialRecs.push({
        id,
        baseColorFactor: [...linearRgb(d.color), 1],
        baseColor: b?.baseColor ? `textures/${b.baseColor.file}` : null,
        normal: b?.normal ? `textures/${b.normal.file}` : null,
        orm: b?.orm ? `textures/${b.orm.file}` : null,
        tiling: tilingOf(id),
        roughness: d.roughness ?? (b?.orm ? 1 : 0.9),
        metallic: d.metallic ?? 0,
        alphaMode,
        ...(alphaMode === 'MASK' ? { alphaCutoff: d.alphaCutoff ?? 0.5 } : {}),
        doubleSided: !!d.doubleSided,
        ...(d.emissive ? { emissive: { color: linearRgb(d.emissive.color), nits: d.emissive.nits, night: d.emissive.night, source: d.emissive.source } } : {}),
        ...(d.surface ? { surface: d.surface } : {}),
        castShadow: d.castShadow ?? (d.surface === 'wall' || d.surface === 'roof'),
        ...(b ? { set: b.key } : {}),
        ...variantFields(id),
        ...(d.weather ? { weather: weatherRecord(id, baked, 'textures/') } : {}),
      });
    }
  }

  const walkText = JSON.stringify(walk.file);
  const laneText = JSON.stringify(lanes);
  writeFileSync(resolve(outDir, 'walk.json'), walkText);
  writeFileSync(resolve(outDir, 'lanes.json'), laneText);
  const index: IndexManifest = {
    format,
    area: area.id,
    compiler: { name: format === 0 ? GENERATOR : GENERATOR_V1, version: format === 0 ? '0.1.1' : COMPILER_VERSION },
    ...(compressionEnabled() ? { compression: 'meshopt' as const } : {}),
    frame: { origin: { ...WORLD_ORIGIN }, axes: '+X east, +Y up, +Z south (north is -Z); glTF axes are the same', units: 'm', seaLevel: 0 },
    osm: { source: data.source, licence: 'Map data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)', fetched: data.fetched, osmBase: data.osmBase, bbox: area.bbox },
    tileSize: TILE_SIZE,
    areaBounds: { minX: r2(areaRect.minX), minZ: r2(areaRect.minZ), maxX: r2(areaRect.maxX), maxZ: r2(areaRect.maxZ) },
    rect: { minX: rect.minX, minZ: rect.minZ, maxX: rect.maxX, maxZ: rect.maxZ },
    materials: format === 0 ? Object.entries(MATERIALS).map(([name, c]) => ({ name, color: `#${c.toString(16).padStart(6, '0')}` })) : materialRecs.map((r) => ({ name: r.id, color: `#${materialDef(r.id).color.toString(16).padStart(6, '0')}` })),
    tiles: refs,
    walkGraph: { file: 'walk.json', hash: sha(walkText), vertices: nWalk, edges: walk.file.edges.length / 2 },
    laneGraph: { file: 'lanes.json', hash: sha(laneText), paths: lanes.paths.length },
    hash: '',
  };
  const textureFiles = textures?.written() ?? [];
  if (format === 1) {
    index.lod = LOD_POLICY;
    if (strip) {
      index.strip = { ...strip, tiles: strip.tiles.filter((id) => refs.some((r) => r.id === id)) };
    }
    index.materialDefs = materialRecs;
    index.textures = textureFiles.map((t) => ({ file: `textures/${t.file}`, mimeType: t.mimeType, width: t.width, height: t.height, bytes: t.bytes }));
    index.props = propRecs;
    if (modulesRef) {
      index.modules = modulesRef;
    }
    index.assets = [...credits.values()].sort((a, b) => a.id.localeCompare(b.id));
    index.totals = {
      tiles: refs.length,
      lod0Triangles: refs.reduce((s, r) => s + (r.lods?.[0]?.triangles ?? 0), 0),
      lod1Triangles: refs.reduce((s, r) => s + (r.lods?.[1]?.triangles ?? 0), 0),
      instances: refs.reduce((s, r) => s + (r.instances ?? 0), 0),
      lights: refs.reduce((s, r) => s + (r.lights ?? 0), 0),
      textureBytes: textureFiles.reduce((s, t) => s + t.bytes, 0),
      propBytes: Object.values(propRecs).reduce((s, p) => s + p.bytes, 0),
      glbBytes: refs.reduce((s, r) => s + (r.lods ?? []).filter((l, k, all) => all.findIndex((q) => q.glb === l.glb) === k).reduce((q, l) => q + l.bytes, 0), 0),
    };
  }
  index.hash = sha(refs.map((r) => r.hash).join('') + index.walkGraph.hash + index.laneGraph.hash + (format === 1 ? sha(JSON.stringify([index.materialDefs, index.textures, index.props])) : ''));
  writeFileSync(resolve(outDir, 'index.json'), JSON.stringify(index, null, 1));
  const web = webProfile() ? await timed('web.pack', () => packWeb(outDir, index as unknown as Parameters<typeof packWeb>[1])) : null;
  if (web) {
    writeFileSync(resolve(outDir, 'index.json'), JSON.stringify(index));
    // The game's list of compiled areas (world-index.ts) next to the area folders.
    writeWorldIndex(dirname(outDir));
  }
  const t3 = performance.now();

  /* Summary. */
  const tris = refs.map((r) => r.triangles).sort((a, b) => a - b);
  const sizes = refs.map((r) => r.bytes).sort((a, b) => a - b);
  const all = [...manifests.values()];
  const doors = all.flatMap((m) => m.doors);
  const sum = (list: number[]): number => list.reduce((a, b) => a + b, 0);
  const walkNet = walk.network;
  const walkConnected = walkNet.largestShare >= minWalkShare;
  const groundTotals = actx.shared.get('ground') as GroundTotals | undefined;
  const allLights = all.flatMap((m) => m.lights ?? []);
  const summary = {
    ok: !reports.some((r) => r.errors > 0) && walkConnected,
    area: area.id,
    format,
    out: outDir,
    tiles: refs.length,
    tileGrid: `${i1 - i0 + 1} x ${j1 - j0 + 1} (${(i1 - i0 + 1) * (j1 - j0 + 1) - refs.length} water-only${onlyStrip ? ' or non-strip' : ''} tiles skipped)`,
    triangles: { total: sum(tris), min: tris[0], median: tris[tris.length >> 1], max: tris.at(-1) },
    glbBytes: { total: sum(sizes), min: sizes[0], median: sizes[sizes.length >> 1], max: sizes.at(-1) },
    manifestBytes: sum(all.map((m) => JSON.stringify(m).length)),
    ...(format === 1
      ? {
          strip: strip ? { source: strip.source, rect: strip.rect, tiles: index.strip?.tiles.length ?? 0 } : null,
          lods: {
            lod0Triangles: index.totals!.lod0Triangles,
            lod1Triangles: index.totals!.lod1Triangles,
            fullTiles: refs.filter((r) => r.detail === 'full').length,
            separateLod1: refs.filter((r) => r.lods && r.lods.length > 1 && r.lods[1].glb !== r.lods[0].glb).length,
            lightmapTexelsPerM: lightmapTexels.length ? { min: Math.min(...lightmapTexels), median: median(lightmapTexels), max: Math.max(...lightmapTexels) } : null,
            allGlbBytes: index.totals!.glbBytes,
          },
          materials: { used: materialRecs.length, textured: materialRecs.filter((r) => r.baseColor).length, flat: materialRecs.filter((r) => !r.baseColor).map((r) => r.id) },
          textures: { files: textureFiles.length, bytes: index.totals!.textureBytes, cache: { hits: textures!.cacheHits, misses: textures!.cacheMisses }, skippedSets: Object.fromEntries(textures!.problems) },
          props: { processed: Object.keys(propRecs).length, bytes: index.totals!.propBytes, skipped: Object.fromEntries(props!.problems) },
          instances: { total: index.totals!.instances, byAsset: countBy(all.flatMap((m) => m.instances ?? []).map((i) => i.asset)), dropped: droppedInstances },
          lights: { total: allLights.length, night: allLights.filter((l) => l.night).length, bySource: countBy(allLights.map((l) => l.source)), byType: countBy(allLights.map((l) => l.type)), inStrip: all.filter((m) => m.detail === 'full').reduce((s, m) => s + (m.lights?.length ?? 0), 0) },
          assets: index.assets!.length,
          placement: (actx.shared.get('placementLog') as PlacementLog | undefined)?.summary() ?? {},
          stepMs: Object.fromEntries(Object.entries(stepMs).map(([k, v]) => [k, Math.round(v)])),
        }
      : {}),
    buildings: { solids: sum(all.map((m) => m.buildings.length)), height: solids.filter((s) => s.rec.heightSource === 'height').length, levels: solids.filter((s) => s.rec.heightSource === 'levels').length, default: solids.filter((s) => s.rec.heightSource === 'default').length },
    doors: { total: doors.length, tagged: doors.filter((d) => !d.inferred).length, inferred: doors.filter((d) => d.inferred).length, ...doorStats },
    pois: poiCount,
    ...(web ? { web } : {}),
    lamps: { total: sum(all.map((m) => m.lamps.length)), inferred: sum(all.map((m) => m.lamps.filter((l) => l.inferred).length)) },
    trees: sum(all.map((m) => m.trees.length)),
    benches: sum(all.map((m) => m.benches.length)),
    spawns: { total: sum(all.map((m) => m.spawns.length)), pier: pierSpawns },
    ground: groundTotals
      ? { kerbWallM: Math.round(groundTotals.kerbWallM), kerbStepM: { below5cm: Math.round(groundTotals.kerbStepM[0]), '5to12cm': Math.round(groundTotals.kerbStepM[1]), '12to15cm': Math.round(groundTotals.kerbStepM[2]), above15cm: Math.round(groundTotals.kerbStepM[3]) }, quayWallM: Math.round(groundTotals.quayWallM), coastSource: f.coastSource, piers: piers.count }
      : null,
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
      network: { merged: walkNet.merged, healed: walkNet.healed, addedLanes: walkNet.addedLanes, endLinks: walkNet.endLinks, stitched: walkNet.stitched, bridgeLanded: walkNet.bridgeLanded, passages: { opened: passages.length, linked: walkNet.passages } },
      bytes: walkText.length,
    },
    laneGraph: { paths: lanes.paths.length, lanes: lanes.paths.filter((p) => p.kind === 'lane').length, bytes: laneText.length },
    validator: validate
      ? {
          files: reports.length,
          errors: sum(reports.map((r) => r.errors)),
          warnings: sum(reports.map((r) => r.warnings)),
          infos: sum(reports.map((r) => r.infos)),
          hints: sum(reports.map((r) => r.hints)),
          codes: reports.reduce<Record<string, number>>((acc, r) => {
            for (const [c, n] of Object.entries(r.codes)) {
              acc[c] = (acc[c] ?? 0) + n;
            }
            return acc;
          }, {}),
          firstIssues: reports.filter((r) => r.errors + r.warnings > 0).slice(0, 3),
        }
      : 'skipped',
    indexHash: index.hash,
    ms: { foundation: Math.round(t1 - t0), ...f.ms, solidsDoorsGraphs: Math.round(t2 - t1), tiles: Math.round(t3 - t2), total: Math.round(t3 - t0) },
    jobs,
    cache: tileCache ? { scope: cacheMode, tiles: outs.filter((o) => o.cached).length, built: outs.filter((o) => !o.cached).length, pruned: onlyStrip ? 0 : tileCache.prune(outs.map((o) => `${o.id}.${o.key}`)) } : 'off',
    // Stage timers (perf.ts), summed over every thread: CPU-side cost per stage; `wall.tiles` is the tile phase's wall time.
    perf: perfReport(),
  };
  if (args.includes('--check')) {
    Object.assign(summary, { check: await checkAgainstSerial(outDir, args) });
    summary.ok &&= (summary as { check?: { identical: boolean } }).check!.identical;
  }
  if (summary.ok && stampKey) {
    writeAreaStamp(outDir, stampKey, index.hash, summary);
  }
  console.log(JSON.stringify(summary, null, 1));
  if (!walkConnected) {
    console.error(`walk graph: largest component holds ${(walkNet.largestShare * 100).toFixed(1)}% of ${nWalk} vertices (${walkNet.components} components), below ${minWalkShare * 100}%`);
  }
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

/** The coast grids of the foundation, rows spread over the worker threads (coastPlan, coastRows); null: no coastline. */
async function parallelCoast(pool: TilePool, data: Parameters<typeof coastPlan>[0], rect: Parameters<typeof coastPlan>[1]): Promise<GridWin<Float32Array> | null> {
  const plan = coastPlan(data, rect);
  if (!plan) {
    return null;
  }
  const grid = async (spec: CoastSpec, coarse: GridWin<Float32Array> | null): Promise<GridWin<Float32Array>> => {
    const chunks = pool.size * 4;
    const step = Math.ceil(spec.h / chunks);
    const payloads: { spec: CoastSpec; coarse: GridWin<Float32Array> | null; j0: number; j1: number }[] = [];
    for (let j0 = 0; j0 < spec.h; j0 += step) {
      payloads.push({ spec, coarse, j0, j1: Math.min(spec.h, j0 + step) });
    }
    const parts = (await pool.runJobs('coast', payloads)) as Float32Array[];
    const out = new Float32Array(spec.w * spec.h);
    parts.forEach((p, k) => out.set(p, payloads[k].j0 * spec.w));
    return coastGrid(spec, out);
  };
  const coarse = await grid(plan.coarse, null);
  return grid(plan.fine, toShared(coarse));
}

function countBy(list: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of list) {
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** World AABB of the parts (positions are relative to the node origin). */
function contentOf(parts: readonly { position: Float32Array }[], origin: XYZ): { min: XYZ; max: XYZ } {
  const min: XYZ = [Infinity, Infinity, Infinity];
  const max: XYZ = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    for (let k = 0; k < p.position.length; k += 3) {
      for (let c = 0; c < 3; c++) {
        const v = p.position[k + c] + origin[c];
        min[c] = Math.min(min[c], v);
        max[c] = Math.max(max[c], v);
      }
    }
  }
  return { min: min.map(r2) as XYZ, max: max.map(r2) as XYZ };
}


main().catch((e) => {
  console.error(e);
  process.exit(1);
});
