/**
 * The four landmark families, run headlessly with the game's own generators (full detail, LOD 0) and turned into
 * landmark meshes (mesh.ts) plus placement records:
 *
 * - mosques: the 21 landmark mosques (mosques/gen, own frame, placed by heading) and the neighbourhood mosque
 *   prototypes, instanced on geo.smallMosqueSites with the game's variant choice (mosques/system/placement.ts);
 * - structures: bridges, towers and skyscraper clusters (structures/builders, world space), cables as tubes;
 * - heritage: palaces, fortresses, stations, barracks, monuments (heritage/build), one mesh per site chunk;
 * - walls: the city walls from the offline bake (public/world/walls, `npm run compile:walls`), one mesh per 100 m tile.
 *
 * Frames: everything is web metres (+X east, +Y up, +Z south); a mesh is local to its item's origin, and an item's
 * yaw (degrees) turns it about +Y like three.js rotation.y = -yaw (the web's headingToYaw), i.e. the Unreal yaw.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { GeoQuery, LandmarkDef } from '../../../src/core/contracts';
import { makeJob } from '../../../src/world/landmarks/heritage/jobs';
import { WALL_MATERIAL_SITES } from '../../../src/world/landmarks/heritage/build/registry';
import { FACADE_BASE, FACADE_STYLES, Surf as HS } from '../../../src/world/landmarks/heritage/build/surfaces';
import { buildSite } from '../../../src/world/landmarks/heritage/worker/build-site';
import { buildLandmarkModel, buildNeighborhoodModels } from '../../../src/world/landmarks/mosques/gen/build';
import { Mat } from '../../../src/world/landmarks/mosques/gen/types';
import type { GeomData } from '../../../src/world/landmarks/mosques/gen/types';
import { chooseVariant } from '../../../src/world/landmarks/mosques/system/placement';
import { StructureBuild } from '../../../src/world/landmarks/structures/build/context';
import { Surf as SS } from '../../../src/world/landmarks/structures/build/surfaces';
import { builderFor } from '../../../src/world/landmarks/structures/builders/registry';
import { prepareSite } from '../../../src/world/landmarks/structures/system/site-planner';
import { BatchKind, WIRE_STRIDE, type GeometryData } from '../../../src/world/landmarks/structures/types';
import { decodeMeshes, WALLS_TILE, type WallsIndex } from '../../../src/world/landmarks/walls/data/baked';
import { LandmarkMesh, tube, type Vertex } from './mesh';

export interface Item {
  id: string;
  name: string;
  /** Landmark kind (mosque, bridge, tower, skyscraper, palace, ..., walls) or 'neighbourhood-mosque'. */
  kind: string;
  family: 'mosques' | 'structures' | 'heritage' | 'walls';
  /** Key of the mesh it places (shared by instances of one prototype). */
  mesh: string;
  origin: [number, number, number];
  yawDeg: number;
  scale: number;
}

export interface Collected {
  items: Item[];
  meshes: Map<string, LandmarkMesh>;
  /** Material ids whose colour comes from COLOR_0 (materials.ts isTinted). */
  warnings: string[];
}

type Tinted = (id: string) => boolean;

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const SRGB = Array.from({ length: 256 }, (_, i) => toLinear(i / 255));
const SQRT = Array.from({ length: 256 }, (_, i) => (i / 255) ** 2);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/* ------------------------------------------------------------------------------------------------ mosques -- */

const MOSQUE_MAT: Record<number, string> = {
  [Mat.Stone]: 'lm_stone',
  [Mat.Smooth]: 'lm_stone_fine',
  [Mat.Carved]: 'lm_stone_fine',
  [Mat.Lead]: 'lm_lead',
  [Mat.Glass]: 'lm_window',
  [Mat.Gold]: 'lm_gold',
  [Mat.Plaster]: 'lm_plaster',
  [Mat.Brick]: 'lm_brick',
  [Mat.Marble]: 'lm_marble',
  [Mat.Paving]: 'lm_paving',
  [Mat.Lamp]: 'lm_lamp',
  [Mat.Dark]: 'lm_dark',
  [Mat.Tile]: 'lm_roof_tiles',
  [Mat.Banded]: 'lm_banded',
};

/** Mosque paving ignores the tint in the web shader: its colour. */
const MOSQUE_PAVING: [number, number, number] = [0.5, 0.49, 0.46];

function addMosqueGeometry(mesh: LandmarkMesh, g: GeomData, tinted: Tinted): void {
  const n = g.position.length / 3;
  mesh.beginSource(n);
  const ns = g.normal.length / n;
  const idx = g.index;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const matId = g.data[a * 4];
    const material = MOSQUE_MAT[matId] ?? 'lm_stone';
    const tint = tinted(material);
    mesh.triangle(material, a, idx[t + 1], idx[t + 2], (i, o: Vertex) => {
      o.x = g.position[i * 3];
      o.y = g.position[i * 3 + 1];
      o.z = g.position[i * 3 + 2];
      o.nx = g.normal[i * ns] / 127;
      o.ny = g.normal[i * ns + 1] / 127;
      o.nz = g.normal[i * ns + 2] / 127;
      o.u = g.uv[i * 2];
      o.v = g.uv[i * 2 + 1];
      const ao = g.tint[i * 4 + 3] / 255;
      let c: [number, number, number] = [1, 1, 1];
      if (matId === Mat.Paving) {
        c = MOSQUE_PAVING;
      } else if (tint) {
        c = [SRGB[g.tint[i * 4]], SRGB[g.tint[i * 4 + 1]], SRGB[g.tint[i * 4 + 2]]];
        if (matId === Mat.Dark) {
          c = [c[0] * c[0] * 0.55, c[1] * c[1] * 0.55, c[2] * c[2] * 0.55];
        } else if (matId === Mat.Carved) {
          c = [c[0] * 0.86, c[1] * 0.86, c[2] * 0.86];
        }
      }
      o.r = c[0] * ao;
      o.g = c[1] * ao;
      o.b = c[2] * ao;
    });
  }
}

export function collectMosques(geo: GeoQuery, only: Set<string> | null, tinted: Tinted, out: Collected): void {
  for (const l of geo.landmarks) {
    if (l.builder !== 'mosques' || (only && !only.has(l.id))) {
      continue;
    }
    const model = buildLandmarkModel(l.id, [0], { height: l.height, radius: l.radius });
    const g = model?.lods[0];
    if (!g) {
      out.warnings.push(`${l.id}: no mosque model`);
      continue;
    }
    const mesh = new LandmarkMesh(l.id, [0, 0, 0]);
    addMosqueGeometry(mesh, g, tinted);
    out.meshes.set(l.id, mesh);
    out.items.push({ id: l.id, name: l.name, kind: l.kind, family: 'mosques', mesh: l.id, origin: [l.x, l.y, l.z], yawDeg: l.headingDeg ?? 0, scale: 1 });
  }
  if (only && !only.has('neighbourhood-mosques')) {
    return;
  }
  const models = buildNeighborhoodModels();
  const footprints = models.map((m) => m.footprint ?? 10);
  const pitched = models.map((m) => !!m.pitched);
  const used = new Set<number>();
  geo.smallMosqueSites.forEach((s, k) => {
    const { variant, scale } = chooseVariant(s, footprints, pitched, geo);
    used.add(variant);
    out.items.push({
      id: `mescit-${String(k).padStart(3, '0')}`,
      name: 'Mahalle camisi',
      kind: 'neighbourhood-mosque',
      family: 'mosques',
      mesh: `mosque-small-${variant}`,
      origin: [s.x, s.y, s.z],
      yawDeg: s.headingDeg,
      scale: r3(scale),
    });
  });
  for (const v of used) {
    const mesh = new LandmarkMesh(`mosque-small-${v}`, [0, 0, 0]);
    addMosqueGeometry(mesh, models[v].lods[0]!, tinted);
    out.meshes.set(mesh.key, mesh);
  }
}

/* --------------------------------------------------------------------------------------------- structures -- */

function structureMaterial(surf: number, rough: number, metal: number): string {
  switch (surf) {
    case SS.Steel:
      return metal >= 0.3 ? 'lm_metal' : 'lm_steel';
    case SS.Concrete:
    case SS.Rail:
      return 'lm_concrete';
    case SS.Ashlar:
      return 'lm_stone';
    case SS.Rubble:
      return 'lm_rubble';
    case SS.Road:
      return 'lm_road';
    case SS.Lead:
      return 'lm_lead';
    case SS.Plain:
      return rough >= 0.7 ? 'lm_plaster' : 'lm_paint';
    case SS.Paving:
      return 'lm_paving';
    case SS.Window:
      return 'lm_window';
    default:
      return 'lm_paint';
  }
}

function addStructureGeometry(mesh: LandmarkMesh, g: GeometryData, glass: boolean, tinted: Tinted): void {
  const n = g.position.length / 3;
  mesh.beginSource(n);
  const cs = g.color.length / n;
  const ns = g.normal.length / n;
  const idx = g.index;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const surf = Math.round(g.surf[a * 4]);
    const material = glass ? 'lm_curtain_glass' : structureMaterial(surf, g.surf[a * 4 + 1], g.surf[a * 4 + 2]);
    const tint = tinted(material);
    const rail = !glass && surf === SS.Rail;
    mesh.triangle(material, a, idx[t + 1], idx[t + 2], (i, o: Vertex) => {
      o.x = g.position[i * 3];
      o.y = g.position[i * 3 + 1];
      o.z = g.position[i * 3 + 2];
      o.nx = g.normal[i * ns] / 32767;
      o.ny = g.normal[i * ns + 1] / 32767;
      o.nz = g.normal[i * ns + 2] / 32767;
      o.u = g.uv[i * 2];
      o.v = g.uv[i * 2 + 1];
      // Opaque colours are linear; glass carries its tint (reflections come from the material).
      const k = glass ? 0.35 : rail ? 0.75 : 1;
      o.r = tint ? (g.color[i * cs] / 255) * k : 1;
      o.g = tint ? (g.color[i * cs + 1] / 255) * k : 1;
      o.b = tint ? (g.color[i * cs + 2] / 255) * k : 1;
    });
  }
}

export function collectStructures(geo: GeoQuery, only: Set<string> | null, tinted: Tinted, out: Collected): void {
  for (const l of geo.landmarks) {
    if (l.builder !== 'structures' || (only && !only.has(l.id))) {
      continue;
    }
    const b = new StructureBuild(prepareSite(l, geo));
    builderFor(b.def)(b);
    const r = b.result(0);
    const origin: [number, number, number] = [l.x, l.y, l.z];
    const mesh = new LandmarkMesh(l.id, origin);
    for (const part of r.parts) {
      const g = part.lods[0];
      if (g) {
        addStructureGeometry(mesh, g, part.batch === BatchKind.Glass, tinted);
      }
    }
    // Cables, hangers, stays and railings: layout ax ay az bx by bz radius r g b ... (build/wire-list.ts).
    const w = r.wires;
    for (let i = 0; i + WIRE_STRIDE <= w.length; i += WIRE_STRIDE) {
      const radius = w[i + 6];
      // Thin wires get fewer sides; the web draws them at least ~1 px wide, Nanite keeps them as geometry.
      tube(mesh, 'lm_cable', [w[i], w[i + 1], w[i + 2]], [w[i + 3], w[i + 4], w[i + 5]], radius, [w[i + 7], w[i + 8], w[i + 9]], radius >= 0.2 ? 8 : 5);
    }
    out.meshes.set(l.id, mesh);
    out.items.push({ id: l.id, name: l.name, kind: l.kind, family: 'structures', mesh: l.id, origin, yawDeg: 0, scale: 1 });
  }
}

/* ----------------------------------------------------------------------------------------------- heritage -- */

/** Heritage / wall-kit surface id -> material, given whether the site uses the city-wall textures. */
export function heritageMaterial(surf: number, wallTextures: boolean, facade: (style: number) => string): string {
  if (surf >= FACADE_BASE) {
    const style = surf - FACADE_BASE;
    return FACADE_STYLES[style] ? facade(style) : 'lm_stone';
  }
  switch (surf) {
    case HS.Plaster:
    case HS.Stucco:
      return 'lm_plaster';
    case HS.Ashlar:
      return wallTextures ? 'lm_wall_stone' : 'lm_stone';
    case HS.BandedStone:
    case HS.Balustrade:
      return 'lm_stone_fine';
    case HS.Byzantine:
      return 'lm_byzantine';
    case HS.Rubble:
      return 'lm_rubble';
    case HS.Marble:
      return 'lm_marble';
    case HS.Brick:
      return wallTextures ? 'lm_wall_brick' : 'lm_brick';
    case HS.Lead:
      return 'lm_lead';
    case HS.Slate:
      return 'lm_slate';
    case HS.Tile:
      return 'lm_roof_tiles';
    case HS.Glass:
      return 'lm_window';
    case HS.Granite:
      return 'lm_granite';
    case HS.Bronze:
      return 'lm_bronze';
    case HS.Gold:
      return 'lm_gold';
    case HS.Wood:
      return 'lm_wood';
    case HS.Earth:
      return 'lm_grass';
    case HS.Paving:
      return 'lm_paving';
    case HS.Iron:
    case HS.Railing:
      return 'lm_iron';
    case HS.Void:
      return 'lm_void';
    case HS.Lamp:
      return 'lm_lamp';
    case HS.Clock:
      return 'lm_clock';
    case WALL_FOLIAGE:
      return 'lm_foliage';
    default:
      return 'lm_stone';
  }
}

/** The wall kit's foliage cards (walls/kit/detail.ts). */
const WALL_FOLIAGE = 30;

interface KitMesh {
  positions: Float32Array;
  normals: Int8Array;
  uvs: Float32Array;
  colors: Uint8Array;
  surf: Uint8Array;
  index: Uint32Array | Uint16Array;
}

/** Heritage and wall-kit buffers: positions relative to (ox, 0, oz), sqrt-encoded tint, surf = (id, weather, h, AO). */
function addKitGeometry(mesh: LandmarkMesh, m: KitMesh, ox: number, oz: number, wallTextures: boolean, tinted: Tinted, facade: (style: number) => string): void {
  const n = m.positions.length / 3;
  mesh.beginSource(n);
  const idx = m.index;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const material = heritageMaterial(m.surf[a * 4], wallTextures, facade);
    const tint = tinted(material);
    mesh.triangle(material, a, idx[t + 1], idx[t + 2], (i, o: Vertex) => {
      o.x = m.positions[i * 3] + ox;
      o.y = m.positions[i * 3 + 1];
      o.z = m.positions[i * 3 + 2] + oz;
      o.nx = m.normals[i * 3] / 127;
      o.ny = m.normals[i * 3 + 1] / 127;
      o.nz = m.normals[i * 3 + 2] / 127;
      o.u = m.uvs[i * 2];
      o.v = m.uvs[i * 2 + 1];
      const ao = m.surf[i * 4 + 3] / 255;
      o.r = (tint ? SQRT[m.colors[i * 4]] : 1) * ao;
      o.g = (tint ? SQRT[m.colors[i * 4 + 1]] : 1) * ao;
      o.b = (tint ? SQRT[m.colors[i * 4 + 2]] : 1) * ao;
    });
  }
}

export function collectHeritage(geo: GeoQuery, only: Set<string> | null, tinted: Tinted, facade: (style: number) => string, out: Collected): void {
  for (const l of geo.landmarks) {
    if (l.builder !== 'heritage' || l.kind === 'walls' || (only && !only.has(l.id))) {
      continue;
    }
    const r = buildSite(makeJob(geo, l as LandmarkDef, 1));
    if (r.error) {
      out.warnings.push(`${l.id}: ${r.error.split('\n')[0]}`);
      continue;
    }
    const wallTextures = WALL_MATERIAL_SITES.has(l.id);
    for (const c of r.chunks) {
      const m = c.lods[0];
      if (!m || !m.triangleCount) {
        continue;
      }
      const key = r.chunks.length === 1 ? l.id : `${l.id}--${c.key}`;
      const origin: [number, number, number] = [c.originX, l.y, c.originZ];
      const mesh = new LandmarkMesh(key, origin);
      addKitGeometry(mesh, m, c.originX, c.originZ, wallTextures, tinted, facade);
      out.meshes.set(key, mesh);
      out.items.push({ id: key, name: l.name, kind: l.kind, family: 'heritage', mesh: key, origin, yawDeg: 0, scale: 1 });
    }
  }
}

/* -------------------------------------------------------------------------------------------------- walls -- */

/** The city walls from the bake: LOD 0 tiles (wall and foliage meshes) as one mesh per 100 m tile. */
export function collectWalls(wallsDir: string, tinted: Tinted, out: Collected): void {
  const indexFile = join(wallsDir, 'index.json');
  if (!existsSync(indexFile)) {
    out.warnings.push(`walls: no bake at ${wallsDir} (npm run compile:walls)`);
    return;
  }
  const index = JSON.parse(readFileSync(indexFile, 'utf8')) as WallsIndex;
  const dir = join(wallsDir, 'lod0');
  const files = new Set(readdirSync(dir));
  for (const tile of index.tiles) {
    const [i, j] = [tile.i, tile.j];
    const file = `${i}_${j}.bin.gz`;
    if (!files.has(file)) {
      out.warnings.push(`walls: tile ${i}_${j} missing`);
      continue;
    }
    const buf = gunzipSync(readFileSync(join(dir, file)));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const ox = i * WALLS_TILE;
    const oz = j * WALLS_TILE;
    const key = `walls-${i}_${j}`;
    const origin: [number, number, number] = [ox, 0, oz];
    const mesh = new LandmarkMesh(key, origin);
    for (const m of decodeMeshes(ab)) {
      addKitGeometry(mesh, m, ox, oz, true, tinted, () => 'lm_stone');
    }
    out.meshes.set(key, mesh);
    out.items.push({ id: key, name: 'Surlar', kind: 'walls', family: 'walls', mesh: key, origin, yawDeg: 0, scale: 1 });
  }
}
