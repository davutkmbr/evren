/**
 * Evren world compiler: compiles one street-profile OSM area (data/osm/<area>.json, written by
 * scripts/data/fetch-osm.mjs) into ~100 m glTF tiles plus JSON manifests under public/world/<area>/ (gitignored).
 *
 *   npm run compile:world -- --area kadikoy [--out public/world/kadikoy] [--format 0|1] [--strip auto|none|x0,z0,x1,z1]
 *                            [--tiles all|strip] [--tex-max 2048] [--all-props] [--no-validate] [--min-walk-share 0.9]
 *
 * Format 0: greybox. Format 1 (default): textured PBR materials with shared external textures, UV0/UV1, LOD glbs
 * with distance bands, prop instances and a light list; the strip compiles at full detail, other tiles as greybox.
 * The compile steps, materials and props come from registry.ts. Output layout and format: tools/world-compiler/README.md.
 * Map data © OpenStreetMap contributors, ODbL 1.0.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
import { useDistrict } from './district';
import { buildFoundation } from './foundation';
import { GENERATOR, GENERATOR_V1, weatherRecord, writeTileGlb, writeTileGlbV1 } from './gltf';
import { exportLaneGraph, exportWalkGraph } from './graphs';
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

const COMPILER_VERSION = '0.2.0';
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
  const minWalkShare = Number(argOf('--min-walk-share') ?? MIN_WALK_SHARE);
  const onlyStrip = argOf('--tiles') === 'strip';
  const texMax = argOf('--tex-max') ? Number(argOf('--tex-max')) : null;
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
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(resolve(outDir, 'tiles'), { recursive: true });
  const textures = format === 1 ? new TextureBaker(outDir, texMax ? { ...DEFAULT_TEXTURES, colorMax: Math.min(texMax, DEFAULT_TEXTURES.colorMax), normalMax: Math.min(texMax, DEFAULT_TEXTURES.normalMax), ormMax: Math.min(texMax, DEFAULT_TEXTURES.ormMax) } : DEFAULT_TEXTURES) : null;
  const props = textures ? new PropBaker(outDir, textures) : null;
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
    cover: solidCover(solids),
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
    await s.prepare?.(actx);
  }
  const fileCache = new Map<string, Uint8Array>();
  const readOut = (base: string) => (uri: string): Uint8Array => {
    const p = resolve(outDir, base, uri);
    let b = fileCache.get(p);
    if (!b) {
      b = readFileSync(p);
      fileCache.set(p, b);
    }
    return b;
  };
  const baked = new Map<MaterialName, BakedSet | null>();
  const usedMaterials = new Set<MaterialName>();
  const lightmapTexels: number[] = [];
  const stepMs: Record<string, number> = {};
  let droppedInstances = 0;
  for (const m of manifests.values()) {
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
    for (const s of stepsFor(format, detail)) {
      if (s.tile) {
        const ts = performance.now();
        await s.tile(t);
        stepMs[s.id] = (stepMs[s.id] ?? 0) + performance.now() - ts;
      }
    }
    m.triangles = mesh.triangles();
    if (!m.triangles) {
      manifests.delete(m.id);
      continue;
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
        reports.push(await validateGlb(`tiles/${m.id}.glb`, glb));
      }
      continue;
    }

    /* Format 1: instances of available props, their lights, then one glb per LOD. */
    const keep: InstanceRec[] = [];
    for (const rec of instances.list) {
      const prop = await props!.get(rec.asset);
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
      const res = mesh.takeLod(L.mask, detail === 'full' ? L.lightmap.full : L.lightmap.greybox);
      if (!res.triangles) {
        continue;
      }
      for (const p of res.parts) {
        for (const id of [p.material, ...weatherLayerMaterials(p.material)]) {
          usedMaterials.add(id);
          if (!baked.has(id)) {
            baked.set(id, await textures!.material(id));
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
      const glb = await writeTileGlbV1({ name: `tile_${m.id}${L.level ? `_lod${L.level}` : ''}`, origin: m.origin, parts: res.parts, extras: { format, area: area.id, tile: m.id, lod: L.level, detail, lightmap: lm }, baked });
      writeFileSync(resolve(outDir, 'tiles', file), glb);
      lods.push({ level: L.level, glb: file, hash: sha(glb), bytes: glb.byteLength, triangles: res.triangles, lightmap: lm });
      if (validate) {
        reports.push(await validateGlb(`tiles/${file}`, glb, readOut('tiles')));
      }
    }
    m.triangles = lods[0].triangles;
    m.detail = detail;
    m.lods = lods;
    m.instances = keep;
    m.lights = lights.list;
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
      hash: sha(glbHash + manifestHash),
      bytes: lods[0].bytes,
      triangles: lods[0].triangles,
      instances: keep.length,
      lights: lights.list.length,
    });
  }
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
        reports.push(await validateGlb(p.rec.glb, readFileSync(resolve(outDir, p.rec.glb)), readOut('props')));
      }
    }
  }
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
          stepMs: Object.fromEntries(Object.entries(stepMs).map(([k, v]) => [k, Math.round(v)])),
        }
      : {}),
    buildings: { solids: sum(all.map((m) => m.buildings.length)), height: solids.filter((s) => s.rec.heightSource === 'height').length, levels: solids.filter((s) => s.rec.heightSource === 'levels').length, default: solids.filter((s) => s.rec.heightSource === 'default').length },
    doors: { total: doors.length, tagged: doors.filter((d) => !d.inferred).length, inferred: doors.filter((d) => d.inferred).length, ...doorStats },
    pois: poiCount,
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
      network: { merged: walkNet.merged, healed: walkNet.healed, addedLanes: walkNet.addedLanes, endLinks: walkNet.endLinks, stitched: walkNet.stitched },
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
  };
  console.log(JSON.stringify(summary, null, 1));
  if (!walkConnected) {
    console.error(`walk graph: largest component holds ${(walkNet.largestShare * 100).toFixed(1)}% of ${nWalk} vertices (${walkNet.components} components), below ${minWalkShare * 100}%`);
  }
  if (!summary.ok) {
    process.exitCode = 1;
  }
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
