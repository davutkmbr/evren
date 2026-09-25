/**
 * Street layer in the flight game: close-range detail where the dragon comes down. Near a compiled street area
 * (tools/world-compiler output in /world/<area>/, compiled with `--landmarks none`) and below ACTIVE_AGL, the area's
 * tiles stream in around the camera (src/street/tile-streamer.ts). The flight-scale OSM and terrain geometry they
 * replace is discarded through the global street hole mask (core/uniforms.ts streetHole):
 * - ground materials (terrain, street ground, cover, street furniture) under every live tile;
 * - building materials by whole building: the footprints of the buildings the live tiles draw (a compiled building
 *   belongs to the tile of its centroid and may overhang it) plus the rest of the live tiles, except the footprints
 *   of buildings that belong to tiles not loaded, so no flight-scale building is cut at a tile edge;
 * - never inside landmark footprints, where the game's own mosque and landmark models keep showing.
 * Tiles cross-fade with the city they replace (a screen-door dissolve over FADE_SECONDS, street/fade.ts): each live
 * tile owns a fade slot, the mask stores the slot per texel, and both sides dither against the slot's fade. A tile fades
 * in once its hole is painted and fades out before it is dropped, so neither streaming nor the activation height pops.
 * Opt-in with `?street=1`.
 * The slice's trees stay (the compiled tiles only carry OSM-mapped trees), as do the game's crowd and traffic: the
 * compiled placeholders for those are left out.
 */
import * as THREE from 'three';
import { RenderLayers, UpdateOrder, type EngineContext, type System } from '../../core/contracts';
import { globalUniforms, patchMaterial } from '../../core/uniforms';
import { STREET_DITHER_GLSL } from '../../street/fade';
import { fetchJson, type StreetIndex, type StreetTileManifest, type StreetTileRef } from '../../street/format';
import { TileStreamer } from '../../street/tile-streamer';

/** Areas the game streams (compiled by the world compiler; missing ones are skipped). */
const AREAS = ['eminonu'];
/**
 * Camera height above the ground (m) below which the street layer streams in, and the load radius (m). Only the
 * full-detail LOD0 band (0-120 m) is worth replacing the flight-scale city: the compiled LOD1 blocks read worse than
 * the Galata slice from the air, so the radius stays inside that band and the slice keeps everything beyond.
 */
const ACTIVE_AGL = 80;
const RADIUS = 110;
/** Seconds outside the active zone before the tiles are dropped. */
const DROP_AFTER = 20;
/** Hole mask resolution (m per texel). */
const MASK_CELL = 0.5;
/**
 * Footprint growth (m) of a live building's hole (balconies, cornices and signs of the flight-scale twin), of a
 * not-loaded building's keep-out (its walls exactly on the outline) and of a landmark's keep-out.
 */
const GROW_LIVE = 1.6;
const GROW_KEEP = 0.35;
const GROW_LANDMARK = 1;
/** Tiles within this distance (m) of a tile's square may own buildings that reach into it. */
const NEIGHBOUR_REACH = 40;
/** Cross-fade time (s) of a tile with the flight-scale city under it. */
const FADE_SECONDS = 0.6;
/** Main-thread time (ms) per frame for copying loaded tiles into the draw batches and for rasterizing footprints. */
const WORK_BUDGET_MS = 2.5;
const MASK_BUDGET_MS = 1;
/** Prop assets the game draws itself: its crowd, its traffic and the slice's trees. */
const EXCLUDED_PROPS = ['st_person', 'st_vehicle', 'st_tree'];

interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

interface Footprint {
  id: string;
  ring: readonly number[];
  landmark: boolean;
  bbox: Rect;
}

interface Area {
  id: string;
  baseUrl: string;
  index: StreetIndex;
  streamer: TileStreamer;
  rect: Rect;
  /** Building footprints per tile id, from the tile manifests (loaded for the tiles around the live ones). */
  footprints: Map<string, Footprint[] | 'loading' | 'failed'>;
}

function tileRect(tiles: readonly StreetTileRef[]): Rect {
  const r = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const t of tiles) {
    r.minX = Math.min(r.minX, t.bounds.minX);
    r.minZ = Math.min(r.minZ, t.bounds.minZ);
    r.maxX = Math.max(r.maxX, t.bounds.maxX);
    r.maxZ = Math.max(r.maxZ, t.bounds.maxZ);
  }
  return r;
}

function pointInRing(ring: readonly number[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i];
    const zi = ring[i + 1];
    const xj = ring[j];
    const zj = ring[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToRing(ring: readonly number[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[j];
    const az = ring[j + 1];
    const dx = ring[i] - ax;
    const dz = ring[i + 1] - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

function footprintsOf(manifest: StreetTileManifest): Footprint[] {
  return (manifest.buildings ?? []).map((b) => {
    const f = b.footprint;
    const bbox = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
    for (let i = 0; i < f.length; i += 2) {
      bbox.minX = Math.min(bbox.minX, f[i]);
      bbox.maxX = Math.max(bbox.maxX, f[i]);
      bbox.minZ = Math.min(bbox.minZ, f[i + 1]);
      bbox.maxZ = Math.max(bbox.maxZ, f[i + 1]);
    }
    return { id: b.id, ring: f, landmark: !!b.landmark, bbox };
  });
}

const overlaps = (a: Rect, b: Rect, grow: number): boolean => a.minX - grow < b.maxX && a.maxX + grow > b.minX && a.minZ - grow < b.maxZ && a.maxZ + grow > b.minZ;

const growRect = (r: Rect, d: number): Rect => ({ minX: r.minX - d, minZ: r.minZ - d, maxX: r.maxX + d, maxZ: r.maxZ + d });

/** A live tile as the mask paints it. */
interface MaskTile {
  ref: StreetTileRef;
  slot: number;
}

/**
 * The hole mask of one area (RG8, MASK_CELL m texels). Each texel holds the fade slot of the live tile whose geometry
 * replaces the flight-scale city there (0 = no hole): red = ground (the live tiles' squares minus landmarks), green =
 * buildings (see the module comment). A live tile is painted once its own and its neighbours' footprints are known and
 * rasterized (rasterization is spread over frames within a time budget); only the region a change touches is repainted
 * and uploaded, so a tile coming or going costs well under a millisecond.
 */
class HoleMask {
  readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array;
  private readonly w: number;
  private readonly h: number;
  /** Texel indices covered by a footprint grown by some distance, per building id and growth. */
  private readonly cells = new Map<string, Int32Array>();
  /** Painted tiles: id -> slot. */
  private readonly painted = new Map<string, number>();
  /** Tiles whose footprints were known at the last update. */
  private readonly known = new Set<string>();
  private readonly dirty: Rect[] = [];

  constructor(
    private readonly rect: Rect,
    private readonly index: StreetIndex,
    private readonly footprints: Map<string, Footprint[] | 'loading' | 'failed'>,
  ) {
    this.w = Math.ceil((rect.maxX - rect.minX) / MASK_CELL);
    this.h = Math.ceil((rect.maxZ - rect.minZ) / MASK_CELL);
    this.data = new Uint8Array(this.w * this.h * 2);
    this.texture = new THREE.DataTexture(this.data, this.w, this.h, THREE.RGFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;
  }

  get vector(): THREE.Vector4 {
    return new THREE.Vector4(this.rect.minX, this.rect.minZ, this.w * MASK_CELL, this.h * MASK_CELL);
  }

  /** Whether the tile's hole is in the mask with this slot (the tile may fade in). */
  isPainted(id: string, slot: number): boolean {
    return this.painted.get(id) === slot;
  }

  /** Rasterizations still queued for the live tiles. */
  backlog = 0;

  private footprintsOf(id: string): readonly Footprint[] {
    const f = this.footprints.get(id);
    return Array.isArray(f) ? f : [];
  }

  private isKnown(id: string): boolean {
    const f = this.footprints.get(id);
    return Array.isArray(f) || f === 'failed';
  }

  /** Tiles whose buildings can reach into the tile's square (buildings overhang their tile by less than a tile). */
  private neighbours(ref: StreetTileRef): StreetTileRef[] {
    return this.index.tiles.filter((t) => t !== ref && overlaps(t.bounds, ref.bounds, NEIGHBOUR_REACH));
  }

  /** Texels whose centre lies inside the footprint or within `grow` m of its outline. */
  private cellsOf(fp: Footprint, grow: number): Int32Array {
    const key = `${fp.id}|${grow}`;
    let out = this.cells.get(key);
    if (out) {
      return out;
    }
    const list: number[] = [];
    const x0 = Math.max(0, Math.floor((fp.bbox.minX - grow - this.rect.minX) / MASK_CELL));
    const x1 = Math.min(this.w - 1, Math.floor((fp.bbox.maxX + grow - this.rect.minX) / MASK_CELL));
    const z0 = Math.max(0, Math.floor((fp.bbox.minZ - grow - this.rect.minZ) / MASK_CELL));
    const z1 = Math.min(this.h - 1, Math.floor((fp.bbox.maxZ + grow - this.rect.minZ) / MASK_CELL));
    for (let z = z0; z <= z1; z++) {
      const wz = this.rect.minZ + (z + 0.5) * MASK_CELL;
      for (let x = x0; x <= x1; x++) {
        const wx = this.rect.minX + (x + 0.5) * MASK_CELL;
        if (pointInRing(fp.ring, wx, wz) || (grow > 0 && distanceToRing(fp.ring, wx, wz) < grow)) {
          list.push(z * this.w + x);
        }
      }
    }
    out = Int32Array.from(list);
    this.cells.set(key, out);
    return out;
  }

  /** Growth a footprint is painted with when its tile is live / not live. */
  private static growth(fp: Footprint, live: boolean): number {
    return fp.landmark ? GROW_LANDMARK : live ? GROW_LIVE : GROW_KEEP;
  }

  /**
   * Rasterizes what painting the tile needs (its footprints grown as live, its neighbours' as keep-outs) within the
   * time budget; returns whether everything is ready.
   */
  private prepare(ref: StreetTileRef, deadline: number): boolean {
    for (const fp of this.footprintsOf(ref.id)) {
      const key = `${fp.id}|${HoleMask.growth(fp, true)}`;
      if (!this.cells.has(key)) {
        if (performance.now() > deadline) {
          return false;
        }
        this.cellsOf(fp, HoleMask.growth(fp, true));
      }
    }
    for (const n of this.neighbours(ref)) {
      for (const fp of this.footprintsOf(n.id)) {
        if (!overlaps(fp.bbox, ref.bounds, GROW_LIVE + GROW_LANDMARK)) {
          continue;
        }
        const g = HoleMask.growth(fp, false);
        if (!this.cells.has(`${fp.id}|${g}`)) {
          if (performance.now() > deadline) {
            return false;
          }
          this.cellsOf(fp, g);
        }
      }
    }
    return true;
  }

  /** Square of the tile plus every footprint of it (grown), i.e. every texel the tile can paint. */
  private extent(id: string, ref: StreetTileRef): Rect {
    const r = { ...ref.bounds };
    for (const fp of this.footprintsOf(id)) {
      r.minX = Math.min(r.minX, fp.bbox.minX);
      r.minZ = Math.min(r.minZ, fp.bbox.minZ);
      r.maxX = Math.max(r.maxX, fp.bbox.maxX);
      r.maxZ = Math.max(r.maxZ, fp.bbox.maxZ);
    }
    return growRect(r, Math.max(GROW_LIVE, GROW_LANDMARK) + MASK_CELL);
  }

  /** Brings the mask in line with the live tiles; rasterization work stops at `budgetMs`. */
  update(live: readonly MaskTile[], budgetMs: number): void {
    const deadline = performance.now() + budgetMs;
    const refs = new Map(this.index.tiles.map((t) => [t.id, t]));
    const wanted = new Map<string, number>();
    this.backlog = 0;
    for (const t of live) {
      if (t.slot <= 0 || !this.isKnown(t.ref.id) || !this.neighbours(t.ref).every((n) => this.isKnown(n.id))) {
        this.backlog++;
        continue;
      }
      if (this.painted.get(t.ref.id) === t.slot || this.prepare(t.ref, deadline)) {
        wanted.set(t.ref.id, t.slot);
      } else {
        this.backlog++;
      }
    }
    for (const [id, slot] of this.painted) {
      if (wanted.get(id) !== slot) {
        this.painted.delete(id);
        this.dirty.push(this.extent(id, refs.get(id)!));
      }
    }
    for (const [id, slot] of wanted) {
      if (!this.painted.has(id)) {
        this.painted.set(id, slot);
        this.dirty.push(this.extent(id, refs.get(id)!));
      }
    }
    // Footprints that arrive later only matter where they reach painted tiles (keep-outs).
    for (const [id, f] of this.footprints) {
      if (Array.isArray(f) && !this.known.has(id)) {
        this.known.add(id);
        if (!this.painted.has(id) && this.painted.size) {
          this.dirty.push(this.extent(id, refs.get(id)!));
        }
      }
    }
    if (this.dirty.length) {
      this.repaint(refs);
    }
  }

  private repaint(refs: ReadonlyMap<string, StreetTileRef>): void {
    const d = this.data;
    const w = this.w;
    const toCell = (v: number, min: number, n: number): number => THREE.MathUtils.clamp(Math.floor((v - min) / MASK_CELL), 0, n);
    const paintedRects = [...this.painted].map(([id, slot]) => ({ id, slot, rect: refs.get(id)!.bounds }));
    for (const region of this.dirty.splice(0)) {
      const x0 = toCell(region.minX, this.rect.minX, w);
      const x1 = toCell(region.maxX, this.rect.minX, w);
      const z0 = toCell(region.minZ, this.rect.minZ, this.h);
      const z1 = toCell(region.maxZ, this.rect.minZ, this.h);
      if (x1 <= x0 || z1 <= z0) {
        continue;
      }
      for (let z = z0; z < z1; z++) {
        d.fill(0, (z * w + x0) * 2, (z * w + x1) * 2);
      }
      const inRegion = (c: number): boolean => {
        const x = c % w;
        const z = (c - x) / w;
        return x >= x0 && x < x1 && z >= z0 && z < z1;
      };
      const paint = (cells: Int32Array, channel: 0 | 1 | -1, value: number): void => {
        for (let k = 0; k < cells.length; k++) {
          const c = cells[k];
          if (inRegion(c)) {
            if (channel < 0) {
              d[c * 2] = value;
              d[c * 2 + 1] = value;
            } else {
              d[c * 2 + channel] = value;
            }
          }
        }
      };
      // Live squares (both channels), then the live buildings' overhangs (green).
      for (const { slot, rect } of paintedRects) {
        const a0 = Math.max(x0, toCell(rect.minX, this.rect.minX, w));
        const a1 = Math.min(x1, toCell(rect.maxX, this.rect.minX, w));
        const b0 = Math.max(z0, toCell(rect.minZ, this.rect.minZ, this.h));
        const b1 = Math.min(z1, toCell(rect.maxZ, this.rect.minZ, this.h));
        for (let z = b0; z < b1; z++) {
          d.fill(slot, (z * w + a0) * 2, (z * w + a1) * 2);
        }
      }
      for (const { id, slot } of paintedRects) {
        for (const fp of this.footprintsOf(id)) {
          if (!fp.landmark && overlaps(fp.bbox, region, GROW_LIVE)) {
            paint(this.cellsOf(fp, GROW_LIVE), 1, slot);
          }
        }
      }
      // Buildings of tiles that are not painted keep their flight-scale twin; landmarks keep the game's models.
      const nearPainted = (fp: Footprint, grow: number): boolean => paintedRects.some((p) => overlaps(fp.bbox, p.rect, grow));
      for (const [id, f] of this.footprints) {
        if (!Array.isArray(f)) {
          continue;
        }
        const isPainted = this.painted.has(id);
        for (const fp of f) {
          if (fp.landmark) {
            if (overlaps(fp.bbox, region, GROW_LANDMARK) && nearPainted(fp, GROW_LANDMARK)) {
              paint(this.cellsOf(fp, GROW_LANDMARK), -1, 0);
            }
          } else if (!isPainted && overlaps(fp.bbox, region, GROW_KEEP) && nearPainted(fp, GROW_LIVE)) {
            paint(this.cellsOf(fp, GROW_KEEP), 1, 0);
          }
        }
      }
      // Upload the region row by row (update ranges count 4 components per texel whatever the format).
      for (let z = z0; z < z1; z++) {
        this.texture.addUpdateRange((z * w + x0) * 4, (x1 - x0) * 4);
      }
    }
    this.texture.needsUpdate = true;
  }
}

/**
 * Albedo grade of compiled materials in the game's light (linear multipliers of the base colour factor). The game's
 * exposure is set for the slice's bright albedos (e.g. its plaza granite at 1.25x the texture): the compiled square
 * granite at its physical tint reads 20-30 % darker and browner than the slice's square at the same spot.
 */
const ALBEDO_GRADE: Readonly<Record<string, readonly [number, number, number]>> = {
  st_pavers: [1.6, 1.75, 1.95],
  st_slabs: [1.55, 1.66, 1.8],
  // Lawns read mint-teal under the game's blue sky light: warmer, more yellow-green.
  st_grass: [1.0, 1.05, 0.62],
};

/**
 * Squares, quays and market lanes get the bands of darker slabs that Istanbul's granite paving is laid with (every
 * BAND_REPEATS texture repeats, one slab wide, along the paving's own UV frame so they follow the joints): without them
 * the large paved areas read as one flat tone from landing height.
 */
const BANDED = new Set(['st_pavers', 'st_slabs']);
const BAND_REPEATS = 4;
/**
 * Facade trim whose shadows are a few centimetres deep (frames, cladding, signs, closed shutters): not drawn into the
 * four shadow cascades, which saves about a tenth of the layer's draw calls in a market lane. Walls, roofs, awnings,
 * balconies and timber keep theirs.
 */
const NO_SHADOW = new Set(['fac_alu', 'fac_kepenk', 'fac_kepenk_worn', 'fac_marble', 'fac_plant', 'fac_pvc', 'fac_roller', 'fac_shutter_wood', 'fac_sign']);

/**
 * Game look for the compiled materials: the shadow casters, the albedo grade, the paving bands, and night-only glow
 * (street lamps, lit rooms and signs) that follows the sky's night factor instead of glowing by day.
 */
function adaptMaterial(m: THREE.Material): void {
  if (NO_SHADOW.has(m.name)) {
    m.userData.castShadow = false;
  }
  if (m.name === 'fac_glass') {
    // The blocks are hollow behind their windows: without the panes in the shadow map, sunlight falls through a
    // building onto the street as rows of lit windows inside its shadow.
    m.userData.castShadow = true;
    m.shadowSide = THREE.DoubleSide;
  }
  const grade = ALBEDO_GRADE[m.name];
  const std = m as THREE.MeshStandardMaterial;
  if (grade && std.color) {
    std.color.setRGB(std.color.r * grade[0], std.color.g * grade[1], std.color.b * grade[2]);
  }
  const rec = m.userData.emissive as { nits?: number; night?: boolean } | undefined;
  const glow = rec?.night ? Math.min(3, Math.max(1, (rec.nits ?? 0) / 6000)).toFixed(3) : null;
  const banded = BANDED.has(m.name) && !!std.map;
  if (!glow && !banded) {
    return;
  }
  const host = m.onBeforeCompile;
  m.onBeforeCompile = function (shader, renderer) {
    host.call(this, shader, renderer);
    if (banded) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  {
    // Granite tile set: 5 x 5 slabs per repeat; one slab wide band every ${BAND_REPEATS} repeats in u and v.
    vec2 bq = fract(vMapUv / ${BAND_REPEATS}.0) * ${BAND_REPEATS * 5}.0;
    vec2 bw = fwidth(vMapUv) * ${BAND_REPEATS * 5 / BAND_REPEATS}.0 + 1e-4;
    vec2 inBand = (1.0 - smoothstep(1.0 - bw, 1.0 + bw, bq)) * smoothstep(-bw, bw, bq);
    float band = max(inBand.x, inBand.y);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.74, 0.72, 0.7), band);
  }`,
      );
    }
    if (glow) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n  totalEmissiveRadiance *= ${glow} * smoothstep(0.06, 0.5, uNight);`);
    }
  };
  m.customProgramCacheKey = () => `street-game-${glow ?? 0}-${banded ? 1 : 0}`;
  m.needsUpdate = true;
}

/**
 * Shadow casters of the flight-scale city cut by the hole mask would still cast their shadows onto the street tiles:
 * their meshes get a depth material that discards the same fragments (per mask channel) once the tile there is half
 * faded in. Materials with their own depth material, alpha test or a hole anchor (instanced details) keep theirs.
 */
const holeDepthMaterials = new Map<number, THREE.MeshDepthMaterial>();

function holeDepthMaterial(channel: number): THREE.MeshDepthMaterial {
  let m = holeDepthMaterials.get(channel);
  if (!m) {
    m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    patchMaterial(m, `street-hole-depth-${channel}`, (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vHoleW;').replace(
        '#include <project_vertex>',
        `#include <project_vertex>
#ifdef USE_INSTANCING
  vHoleW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz;
#else
  vHoleW = (modelMatrix * vec4(transformed, 1.0)).xz;
#endif`,
      );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vHoleW;\nuniform sampler2D uStreetHoleMask;\nuniform vec4 uStreetHoleRect;\nuniform sampler2D uStreetFade;\n${STREET_DITHER_GLSL}`)
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
  {
    vec2 streetUv = (vHoleW - uStreetHoleRect.xy) / uStreetHoleRect.zw;
    if (all(greaterThan(streetUv, vec2(0.0))) && all(lessThan(streetUv, vec2(1.0)))) {
      float streetSlot = floor(texture2D(uStreetHoleMask, streetUv)[${channel}] * 255.0 + 0.5);
      if (streetSlot > 0.5 && streetFadeAt(uStreetFade, streetSlot) > 0.5) discard;
    }
  }`,
        );
    });
    holeDepthMaterials.set(channel, m);
  }
  return m;
}

function assignHoleDepth(scene: THREE.Scene, done: WeakSet<THREE.Object3D>): void {
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.castShadow || mesh.customDepthMaterial || done.has(mesh) || Array.isArray(mesh.material)) {
      return;
    }
    done.add(mesh);
    const m = mesh.material as THREE.Material;
    const channel = m.defines?.STREET_HOLE as number | undefined;
    if (channel === undefined || m.defines?.STREET_HOLE_AT || m.alphaTest > 0 || (m as THREE.MeshStandardMaterial).alphaMap || m.transparent) {
      return;
    }
    mesh.customDepthMaterial = holeDepthMaterial(channel);
  });
}

/**
 * Whether the street layer runs: opt-in (`?street=1`) until it fits the default budget (see
 * .docs/planning/README.md: CPU and streaming hitches at eye level are still above it).
 */
function streetLayerEnabled(): boolean {
  return new URLSearchParams(window.location.search).get('street') === '1';
}

export function createStreetLayerSystem(): System {
  const areas: Area[] = [];
  let mask: HoleMask | null = null;
  let maskArea: Area | null = null;
  let inactiveFor = 0;
  let active = false;
  let pendingInit = 0;
  const emptyMask = globalUniforms.uStreetHoleMask.value as THREE.Texture;
  const defaultFade = globalUniforms.uStreetFade.value as THREE.Texture;
  const depthChecked = new WeakSet<THREE.Object3D>();

  const setMask = (area: Area | null): void => {
    if (area === maskArea) {
      return;
    }
    maskArea = area;
    mask?.texture.dispose();
    mask = area ? new HoleMask(area.rect, area.index, area.footprints) : null;
    globalUniforms.uStreetHoleMask.value = mask ? mask.texture : emptyMask;
    globalUniforms.uStreetFade.value = area ? area.streamer.batches.fade.texture : defaultFade;
    if (mask) {
      (globalUniforms.uStreetHoleRect.value as THREE.Vector4).copy(mask.vector);
    }
  };

  /** Loads the building footprints of every tile near the camera (the live tiles and the ring around them). */
  const ensureFootprints = (a: Area, x: number, z: number): void => {
    const reach = RADIUS + 140;
    for (const ref of a.index.tiles) {
      const b = ref.bounds;
      if (Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ)) > reach || a.footprints.has(ref.id)) {
        continue;
      }
      a.footprints.set(ref.id, 'loading');
      void fetchJson<StreetTileManifest>(new URL(ref.manifest, new URL(a.baseUrl, window.location.href)).href)
        .then((m) => a.footprints.set(ref.id, footprintsOf(m)))
        .catch(() => a.footprints.set(ref.id, 'failed'));
    }
  };

  return {
    name: 'street-layer',
    order: UpdateOrder.World + 20,

    init(ctx: EngineContext): void {
      if (!streetLayerEnabled()) {
        return;
      }
      for (const id of AREAS) {
        const baseUrl = `${import.meta.env.BASE_URL}world/${id}/`;
        pendingInit++;
        void fetchJson<StreetIndex>(`${baseUrl}index.json`)
          .then((index) => {
            const footprints: Area['footprints'] = new Map();
            const area: Partial<Area> = { id, baseUrl, index, rect: tileRect(index.tiles), footprints };
            const streamer = new TileStreamer({
              baseUrl,
              index,
              radius: RADIUS,
              shadows: true,
              anisotropy: Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy()),
              propDistances: { distanceScale: 1, personDistance: 0, smallPropDistance: 60, lodBias: 1 },
              excludeAssets: EXCLUDED_PROPS,
              adaptMaterial,
              compile: (o) => ctx.renderer.compileAsync(o, ctx.camera, ctx.scene),
              fadeSeconds: FADE_SECONDS,
              // A tile fades in once the flight-scale city under it is cut (its hole is in the mask with its slot).
              gate: (ref, slot) => maskArea === area && !!mask && mask.isPainted(ref.id, slot),
              workBudgetMs: WORK_BUDGET_MS,
              // The water's planar reflection draws the tiles' walls, roofs and glass, not their small detail.
              detailLayer: RenderLayers.NoReflection,
              // Night glow follows the sky in the shader (adaptMaterial), so emissive materials can share batches.
              mergeEmissive: true,
            });
            area.streamer = streamer;
            streamer.root.visible = false;
            ctx.scene.add(streamer.root);
            areas.push(area as Area);
          })
          .catch((err: unknown) => console.info(`[street] no compiled street tiles for ${id} (${String(err)})`))
          .finally(() => pendingInit--);
      }
    },

    update(dt: number, ctx: EngineContext): void {
      const cam = ctx.camera.position;
      const geo = ctx.services.tryGet('geo');
      const agl = cam.y - (geo ? geo.heightAt(cam.x, cam.z) : 0);
      const near = areas.find((a) => cam.x > a.rect.minX - RADIUS && cam.x < a.rect.maxX + RADIUS && cam.z > a.rect.minZ - RADIUS && cam.z < a.rect.maxZ + RADIUS) ?? null;
      const wantActive = !!near && agl < ACTIVE_AGL;
      if (wantActive) {
        inactiveFor = 0;
        active = true;
      } else if (active) {
        inactiveFor += Math.max(ctx.time.realDt, dt);
        if (inactiveFor > DROP_AFTER) {
          active = false;
        }
      }
      let shown: Area | null = null;
      for (const a of areas) {
        const on = active && a === near;
        if (on) {
          a.streamer.update(cam.x, cam.z);
          ensureFootprints(a, cam.x, cam.z);
        } else if (a.streamer.liveTiles().length) {
          // Far away or high up: every tile fades out and is dropped (a focus far outside the area unloads them).
          a.streamer.update(a.rect.minX - 1e5, a.rect.minZ - 1e5);
        }
        const live = a.streamer.liveTiles();
        a.streamer.root.visible = live.length > 0;
        if (live.length && (!shown || on)) {
          shown = a;
        }
      }
      if (shown && shown !== maskArea) {
        assignHoleDepth(ctx.scene, depthChecked);
      }
      setMask(shown);
      if (shown && mask) {
        mask.update(
          shown.streamer.liveTiles().map((t) => ({ ref: t.ref, slot: t.slot })),
          MASK_BUDGET_MS,
        );
      }
    },

    pending(): number {
      let n = pendingInit;
      for (const a of areas) {
        if (a.streamer.root.visible) {
          n += a.streamer.pending();
          for (const fp of a.footprints.values()) {
            n += fp === 'loading' ? 1 : 0;
          }
        }
      }
      return n + (mask?.backlog ?? 0);
    },

    dispose(): void {
      setMask(null);
      for (const a of areas) {
        a.streamer.root.removeFromParent();
        a.streamer.dispose();
      }
      areas.length = 0;
    },
  };
}
