/**
 * Street layer in the flight game: close-range detail where the dragon comes down. The compiled areas (the landing
 * spots, tools/world-compiler output in /world/<area>/ compiled with `--web --landmarks none`) are listed with their
 * bounds and tiles in the root index /world/index.json (tools/world-compiler/src/world-index.ts). Near an area and below
 * ACTIVE_AGL, its tiles stream in around the camera (src/street/tile-streamer.ts); an area's own index and streamer are
 * loaded on approach and dropped again far away.
 * Areas may overlap (adjacent spots such as Karaköy and Galata): every 100 m grid cell is drawn by one area only, the
 * one whose compiled bounds cover most of the cell (full detail before greybox), so nothing is drawn twice. Several
 * areas can be live at once: their streamers share one fade slot space, one set of draw batches and materials, and one
 * hole mask (a fixed-size wrapped texture around the camera), so crossing from one area into the next only adds tiles:
 * no new GPU buffers, programs or mask.
 * The flight-scale OSM and terrain geometry the tiles replace is discarded through the global street hole mask
 * (core/uniforms.ts streetHole):
 * - ground materials (terrain, street ground, cover, street furniture) under every live tile;
 * - building materials by whole building: the footprints of the buildings the live tiles draw (a compiled building
 *   belongs to the tile of its centroid and may overhang it) plus the rest of the live tiles, except the footprints
 *   of buildings that belong to tiles not loaded, so no flight-scale building is cut at a tile edge;
 * - never inside landmark footprints, where the game's own mosque and landmark models keep showing.
 * Tiles cross-fade with the city they replace (a screen-door dissolve over FADE_SECONDS, street/fade.ts): each live
 * tile owns a fade slot, the mask stores the slot per texel, and both sides dither against the slot's fade. A tile fades
 * in once its hole is painted and fades out before it is dropped, so neither streaming nor the activation height pops.
 * On by default; `?street=0` turns it off.
 * The slice's trees stay (the compiled tiles only carry OSM-mapped trees), as do the game's crowd and traffic: the
 * compiled placeholders for those are left out.
 */
import * as THREE from 'three';
import { RenderLayers, UpdateOrder, type EngineContext, type System } from '../../core/contracts';
import { globalUniforms, patchMaterial } from '../../core/uniforms';
import { FadeTable, STREET_DITHER_GLSL } from '../../street/fade';
import { fetchJson, type StreetIndex, type StreetTileManifest, type StreetTileRef } from '../../street/format';
import { installLazyBufferUploads, ownsBufferArray, TileBatches } from '../../street/tile-batches';
import { TileStreamer } from '../../street/tile-streamer';

/** Root index of the compiled areas (tools/world-compiler/src/world-index.ts). */
const WORLD_INDEX = 'world/index.json';
/**
 * Camera height above the ground (m) below which the street layer streams in, and the load radius (m). Only the
 * full-detail LOD0 band (0-120 m) is worth replacing the flight-scale city: the compiled LOD1 blocks read worse than
 * the Galata slice from the air, so the radius stays inside that band and the slice keeps everything beyond.
 */
const ACTIVE_AGL = 80;
const RADIUS = 110;
/**
 * Height (m) below which the tiles already stream in, hidden: loading, copying into the batches, compiling and the
 * first buffer uploads happen while the camera comes down from here, so crossing ACTIVE_AGL only starts the fades.
 */
const PREFETCH_AGL = 130;
/** Extra distance (m) beyond an area's edge before a camera inside it counts as having left. */
const EDGE_HYSTERESIS = 60;
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

/** An area as the root index lists it (world-index.ts WorldIndexArea). */
interface AreaEntry {
  id: string;
  index: string;
  tileSize: number;
  rect: Rect;
  areaBounds: Rect;
  /** [i, j, detail] per tile ('f' full, 'g' greybox). */
  tiles: [number, number, string][];
}

interface WorldIndex {
  format: number;
  areas: AreaEntry[];
}

/** A loaded area: its index (the tiles it owns) and streamer. */
interface Area {
  id: string;
  baseUrl: string;
  index: StreetIndex;
  streamer: TileStreamer;
  /** Square of the owned tiles. */
  rect: Rect;
}

/** Building footprints per tile id (tile ids are grid cells, and every cell is owned by one area). */
type Footprints = Map<string, Footprint[] | 'loading' | 'failed'>;

/**
 * Owner of every grid cell that several areas compiled: full detail before greybox, then the area whose compiled bounds
 * cover most of the cell (its OSM data reaches furthest around it), then the nearest area centre. Returns the owned
 * cell ids ("i_j") per area.
 */
/** Lexicographic comparison of two scores. */
function better(a: readonly number[], b: readonly number[]): boolean {
  for (let k = 0; k < a.length; k++) {
    if (a[k] !== b[k]) {
      return a[k] > b[k];
    }
  }
  return false;
}

function cellOwners(entries: readonly AreaEntry[]): Map<string, Set<string>> {
  const best = new Map<string, { id: string; score: number[] }>();
  for (const e of entries) {
    const b = e.areaBounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    for (const [i, j, detail] of e.tiles) {
      const x0 = i * e.tileSize;
      const z0 = j * e.tileSize;
      const x1 = x0 + e.tileSize;
      const z1 = z0 + e.tileSize;
      const cover = Math.max(0, Math.min(x1, b.maxX) - Math.max(x0, b.minX)) * Math.max(0, Math.min(z1, b.maxZ) - Math.max(z0, b.minZ));
      const score = [detail === 'g' ? 0 : 1, Math.round(cover), -Math.hypot((x0 + x1) / 2 - cx, (z0 + z1) / 2 - cz)];
      const key = `${i}_${j}`;
      const cur = best.get(key);
      if (!cur || better(score, cur.score)) {
        best.set(key, { id: e.id, score });
      }
    }
  }
  const out = new Map<string, Set<string>>();
  for (const [cell, { id }] of best) {
    let set = out.get(id);
    if (!set) {
      set = new Set();
      out.set(id, set);
    }
    set.add(cell);
  }
  return out;
}

const distanceToRect = (r: Rect, x: number, z: number): number => Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minZ - z, 0, z - r.maxZ));

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

/** Texels per side of the hole mask: a MASK_TEXELS * MASK_CELL m (1024 m) window that follows the camera. */
const MASK_TEXELS = 2048;
/**
 * Distance (m) the camera may move from the window's centre before the window recentres. Painted holes lie within
 * ~300 m of the camera (live tiles within the load radius plus hysteresis, retiring ones, building overhangs), so they
 * stay inside the window's 512 m half width.
 */
const MASK_RECENTRE = 150;

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/**
 * The hole mask of the live tiles: one RG8 texture of MASK_TEXELS^2 texels of MASK_CELL m, addressed by world position
 * modulo its size (the shaders sample it with repeat wrapping at world / size) and valid inside a window around the
 * camera (uStreetHoleRect). Each texel holds the fade slot of the live tile whose geometry replaces the flight-scale city
 * there (0 = no hole): red = ground (the live tiles' squares minus landmarks), green = buildings (see the module
 * comment). It is allocated once and never replaced: areas coming and going, or the camera flying on, only repaint and
 * upload the regions that change (a mask per set of live areas meant a new 10-25 MB buffer, a full upload and every
 * footprint rasterized again at each crossing between adjacent areas). A live tile is painted once its own and its
 * neighbours' footprints are known and rasterized (spread over frames within a time budget).
 */
class HoleMask {
  readonly texture: THREE.DataTexture;
  /** Window (minX, minZ, size, size) in world metres, see uStreetHoleRect. */
  readonly rect = new THREE.Vector4();
  private readonly data: Uint8Array;
  /** Wrapped texel indices covered by a footprint grown by some distance, per building id and growth. */
  private readonly cells = new Map<string, Int32Array>();
  /** Painted tiles: id -> slot and ref. */
  private readonly painted = new Map<string, { slot: number; ref: StreetTileRef }>();
  /** Tiles whose footprints were known at the last update. */
  private readonly known = new Map<string, StreetTileRef>();
  private readonly dirty: Rect[] = [];
  /** The tiles this mask can paint and whose buildings count as neighbours (the engaged areas' owned tiles). */
  private refs = new Map<string, StreetTileRef>();
  private byCell = new Map<string, StreetTileRef>();
  private refsKey = '';
  /** Texel coordinates of the window's minimum corner; NaN until the first follow(). */
  private wx = NaN;
  private wz = NaN;
  /** Rasterizations still queued for the live tiles. */
  backlog = 0;

  constructor(private readonly footprints: Footprints) {
    this.data = new Uint8Array(MASK_TEXELS * MASK_TEXELS * 2);
    this.texture = new THREE.DataTexture(this.data, MASK_TEXELS, MASK_TEXELS, THREE.RGFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.unpackAlignment = 1;
    // The first upload allocates the storage (zeroed) and copies one texel; later ones only the repainted rows.
    this.texture.addUpdateRange(0, 4);
    this.texture.needsUpdate = true;
  }

  /** Whether the tile's hole is in the mask with this slot (the tile may fade in). */
  isPainted(id: string, slot: number): boolean {
    return this.painted.get(id)?.slot === slot;
  }

  get paintedCount(): number {
    return this.painted.size;
  }

  dispose(): void {
    this.texture.dispose();
  }

  /** Sets the tiles the mask covers (`key` names the set; the list is only read when it changes). */
  setTiles(key: string, tiles: () => readonly StreetTileRef[]): void {
    if (key === this.refsKey) {
      return;
    }
    this.refsKey = key;
    const list = tiles();
    this.refs = new Map(list.map((t) => [t.id, t]));
    this.byCell = new Map(list.map((t) => [`${t.i}_${t.j}`, t]));
    // Keep-outs of buildings of tiles that left the set are painted over again.
    for (const [id, ref] of this.known) {
      if (this.refs.get(id) !== ref) {
        this.known.delete(id);
        if (this.painted.size) {
          this.dirty.push(this.extent(id, ref));
        }
      }
    }
  }

  /** Drops the cached rasterizations of these tiles' buildings (their area was unloaded). */
  forget(tiles: readonly StreetTileRef[]): void {
    for (const t of tiles) {
      const f = this.footprints.get(t.id);
      if (Array.isArray(f)) {
        for (const fp of f) {
          for (const g of [GROW_LIVE, GROW_KEEP, GROW_LANDMARK]) {
            this.cells.delete(`${fp.id}|${g}`);
          }
        }
      }
    }
  }

  /** Keeps the window around the camera; painted tiles it would no longer hold are unpainted first. */
  follow(x: number, z: number): void {
    const half = (MASK_TEXELS * MASK_CELL) / 2;
    const cx = (this.wx + MASK_TEXELS / 2) * MASK_CELL;
    const cz = (this.wz + MASK_TEXELS / 2) * MASK_CELL;
    if (Math.abs(x - cx) <= MASK_RECENTRE && Math.abs(z - cz) <= MASK_RECENTRE) {
      return;
    }
    this.wx = Math.floor((x - half) / MASK_CELL);
    this.wz = Math.floor((z - half) / MASK_CELL);
    this.rect.set(this.wx * MASK_CELL, this.wz * MASK_CELL, MASK_TEXELS * MASK_CELL, MASK_TEXELS * MASK_CELL);
    for (const [id, p] of this.painted) {
      if (!this.inWindow(this.extent(id, p.ref))) {
        this.painted.delete(id);
        this.dirty.push(this.extent(id, p.ref));
      }
    }
  }

  private inWindow(r: Rect): boolean {
    return r.minX >= this.rect.x && r.minZ >= this.rect.y && r.maxX <= this.rect.x + this.rect.z && r.maxZ <= this.rect.y + this.rect.w;
  }

  private footprintsOf(id: string): readonly Footprint[] {
    const f = this.footprints.get(id);
    return Array.isArray(f) ? f : [];
  }

  private isKnown(id: string): boolean {
    const f = this.footprints.get(id);
    return Array.isArray(f) || f === 'failed';
  }

  /**
   * Tiles whose buildings can reach into the tile's square: the grid cells around it (buildings overhang their tile by
   * less than NEIGHBOUR_REACH, which is less than a tile).
   */
  private neighbours(ref: StreetTileRef): StreetTileRef[] {
    const out: StreetTileRef[] = [];
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const n = di || dj ? this.byCell.get(`${ref.i + di}_${ref.j + dj}`) : undefined;
        if (n && overlaps(n.bounds, ref.bounds, NEIGHBOUR_REACH)) {
          out.push(n);
        }
      }
    }
    return out;
  }

  /** Wrapped indices of the texels whose centre lies inside the footprint or within `grow` m of its outline. */
  private cellsOf(fp: Footprint, grow: number): Int32Array {
    const key = `${fp.id}|${grow}`;
    let out = this.cells.get(key);
    if (out) {
      return out;
    }
    // Scanline fill of the inside plus a band along each edge: linear in area + perimeter (testing every texel of the
    // bounds against every edge took ~30 ms for one market hall, in a single frame). Texel x covers world
    // [x * MASK_CELL, (x + 1) * MASK_CELL).
    const x0 = Math.floor((fp.bbox.minX - grow) / MASK_CELL);
    const x1 = Math.floor((fp.bbox.maxX + grow) / MASK_CELL);
    const z0 = Math.floor((fp.bbox.minZ - grow) / MASK_CELL);
    const z1 = Math.floor((fp.bbox.maxZ + grow) / MASK_CELL);
    const bw = x1 - x0 + 1;
    const bh = z1 - z0 + 1;
    const mark = new Uint8Array(bw * bh);
    const ring = fp.ring;
    const n = ring.length;
    const xs: number[] = [];
    for (let z = z0; z <= z1; z++) {
      const wz = (z + 0.5) * MASK_CELL;
      xs.length = 0;
      for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
        const zi = ring[i + 1];
        const zj = ring[j + 1];
        if (zi > wz !== zj > wz) {
          xs.push(((ring[j] - ring[i]) * (wz - zi)) / (zj - zi) + ring[i]);
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.max(x0, Math.ceil(xs[k] / MASK_CELL - 0.5));
        const b = Math.min(x1, Math.floor(xs[k + 1] / MASK_CELL - 0.5));
        for (let x = a; x <= b; x++) {
          mark[(z - z0) * bw + (x - x0)] = 1;
        }
      }
    }
    if (grow > 0) {
      for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
        const ax = ring[j];
        const az = ring[j + 1];
        const dx = ring[i] - ax;
        const dz = ring[i + 1] - az;
        const len2 = dx * dx + dz * dz;
        const ex0 = Math.max(x0, Math.floor((Math.min(ax, ring[i]) - grow) / MASK_CELL));
        const ex1 = Math.min(x1, Math.floor((Math.max(ax, ring[i]) + grow) / MASK_CELL));
        const ez0 = Math.max(z0, Math.floor((Math.min(az, ring[i + 1]) - grow) / MASK_CELL));
        const ez1 = Math.min(z1, Math.floor((Math.max(az, ring[i + 1]) + grow) / MASK_CELL));
        for (let z = ez0; z <= ez1; z++) {
          const wz = (z + 0.5) * MASK_CELL;
          for (let x = ex0; x <= ex1; x++) {
            const m = (z - z0) * bw + (x - x0);
            if (mark[m]) {
              continue;
            }
            const wx = (x + 0.5) * MASK_CELL;
            const t = len2 > 0 ? Math.max(0, Math.min(1, ((wx - ax) * dx + (wz - az) * dz) / len2)) : 0;
            if (Math.hypot(wx - ax - t * dx, wz - az - t * dz) < grow) {
              mark[m] = 1;
            }
          }
        }
      }
    }
    const list: number[] = [];
    for (let z = 0; z < bh; z++) {
      const row = mod(z + z0, MASK_TEXELS) * MASK_TEXELS;
      for (let x = 0; x < bw; x++) {
        if (mark[z * bw + x]) {
          list.push(row + mod(x + x0, MASK_TEXELS));
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
    const refs = this.refs;
    const wanted = new Map<string, number>();
    this.backlog = 0;
    for (const t of live) {
      if (refs.get(t.ref.id) !== t.ref) {
        continue; // a tile of an area outside the set (it waits for the set to include it)
      }
      const p = this.painted.get(t.ref.id);
      if (p?.slot === t.slot) {
        wanted.set(t.ref.id, t.slot);
        continue;
      }
      if (t.slot <= 0 || !this.isKnown(t.ref.id) || !this.neighbours(t.ref).every((n) => this.isKnown(n.id)) || !this.inWindow(this.extent(t.ref.id, t.ref))) {
        this.backlog++;
        continue;
      }
      if (this.prepare(t.ref, deadline)) {
        wanted.set(t.ref.id, t.slot);
      } else {
        this.backlog++;
      }
    }
    for (const [id, p] of this.painted) {
      if (wanted.get(id) !== p.slot) {
        this.painted.delete(id);
        this.dirty.push(this.extent(id, p.ref));
      }
    }
    for (const [id, slot] of wanted) {
      if (!this.painted.has(id)) {
        const ref = refs.get(id)!;
        this.painted.set(id, { slot, ref });
        this.dirty.push(this.extent(id, ref));
      }
    }
    // Footprints that arrive later only matter where they reach painted tiles (keep-outs).
    for (const [id, f] of this.footprints) {
      const ref = refs.get(id);
      if (Array.isArray(f) && ref && !this.known.has(id)) {
        this.known.set(id, ref);
        if (!this.painted.has(id) && this.painted.size) {
          this.dirty.push(this.extent(id, ref));
        }
      }
    }
    if (this.dirty.length) {
      this.repaint();
    }
  }

  /** Calls fn(row, x0, x1) for the wrapped row segments of world texel columns [gx0, gx1) on texel row gz. */
  private static segments(gz: number, gx0: number, gx1: number, fn: (row: number, a: number, b: number) => void): void {
    const row = mod(gz, MASK_TEXELS);
    const a = mod(gx0, MASK_TEXELS);
    const n = Math.min(gx1 - gx0, MASK_TEXELS);
    if (a + n <= MASK_TEXELS) {
      fn(row, a, a + n);
    } else {
      fn(row, a, MASK_TEXELS);
      fn(row, 0, a + n - MASK_TEXELS);
    }
  }

  private repaint(): void {
    const d = this.data;
    const N = MASK_TEXELS;
    const cell = (v: number): number => Math.floor(v / MASK_CELL);
    const paintedRects = [...this.painted].map(([id, p]) => ({ id, slot: p.slot, rect: p.ref.bounds }));
    for (const region of this.dirty.splice(0)) {
      const x0 = cell(region.minX);
      const x1 = cell(region.maxX);
      const z0 = cell(region.minZ);
      const z1 = cell(region.maxZ);
      if (x1 <= x0 || z1 <= z0) {
        continue;
      }
      for (let z = z0; z < z1; z++) {
        HoleMask.segments(z, x0, x1, (row, a, b) => d.fill(0, (row * N + a) * 2, (row * N + b) * 2));
      }
      const rx = mod(x0, N);
      const rz = mod(z0, N);
      const inRegion = (c: number): boolean => {
        const x = c % N;
        const z = (c - x) / N;
        return mod(x - rx, N) < x1 - x0 && mod(z - rz, N) < z1 - z0;
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
        const a0 = Math.max(x0, cell(rect.minX));
        const a1 = Math.min(x1, cell(rect.maxX));
        const b0 = Math.max(z0, cell(rect.minZ));
        const b1 = Math.min(z1, cell(rect.maxZ));
        for (let z = b0; z < b1; z++) {
          if (a1 > a0) {
            HoleMask.segments(z, a0, a1, (row, a, b) => d.fill(slot, (row * N + a) * 2, (row * N + b) * 2));
          }
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
        if (!Array.isArray(f) || !this.refs.has(id)) {
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
        HoleMask.segments(z, x0, x1, (row, a, b) => this.texture.addUpdateRange((row * N + a) * 4, (b - a) * 4));
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
      // The mask wraps: it is addressed by world position over its size (see HoleMask).
      float streetSlot = floor(texture2D(uStreetHoleMask, vHoleW / uStreetHoleRect.zw)[${channel}] * 255.0 + 0.5);
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
 * Compiles an object's programs in parallel for the way the pipeline draws the scene: into an HDR render target
 * (linear output, no tone mapping). Compiled against the canvas (the default), every program came out as a variant the
 * frame never uses, and the real ones were linked synchronously on first draw (12 at once when the layer switched on).
 */
let compileTarget: THREE.WebGLRenderTarget | null = null;

function compileForScene(ctx: EngineContext, object: THREE.Object3D): Promise<unknown> {
  compileTarget ??= new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const r = ctx.renderer;
  const previous = r.getRenderTarget();
  r.setRenderTarget(compileTarget);
  try {
    // compileAsync creates the programs synchronously (with the current target) and then polls their completion.
    return r.compileAsync(object, ctx.camera, ctx.scene);
  } finally {
    r.setRenderTarget(previous);
  }
}

/** Distance (m) from an area at which the flight-scale shadow casters get their hole depth materials. */
const PREPARE_DISTANCE = 600;

/** Whether the street layer runs: on by default, `?street=0` turns it off. */
function streetLayerEnabled(): boolean {
  return new URLSearchParams(window.location.search).get('street') !== '0';
}

/** Distance (m) from an area's square at which its index is loaded and its streamer set up / dropped again. */
const LOAD_DISTANCE = PREPARE_DISTANCE;
const UNLOAD_DISTANCE = 1500;

export function createStreetLayerSystem(): System {
  /** Areas of the root index, the cells each owns and the loaded ones. */
  let entries: AreaEntry[] = [];
  let owned = new Map<string, Set<string>>();
  const loaded = new Map<string, Area | 'loading' | 'failed'>();
  const areas: Area[] = [];
  /** One slot space for every area's tiles, so one mask can hold the holes of several areas. */
  const fade = new FadeTable();
  /** Textures by URL for every area: the compiled areas share one texture store (decoded and uploaded once). */
  const textures = new Map<string, Promise<THREE.Texture | null>>();
  /**
   * Draw batches and materials of every area (created with the first area): an area coming into range fills the free
   * ranges of pages already uploaded instead of creating, compiling and uploading its own set (with per-area batches a
   * crossing between adjacent areas made ~150 new pages, ~1 GB of first uploads, in a minute of flight).
   */
  let batches: TileBatches | null = null;
  const materials = new Map<string, THREE.Material>();
  const footprints: Footprints = new Map();
  /** The hole mask (created with the first engaged area, kept for the session) and whether the shaders use it. */
  let mask: HoleMask | null = null;
  let bound = false;
  let inactiveFor = 0;
  let active = false;
  /** The tiles may fade in (the camera came below ACTIVE_AGL since the layer became active). */
  let showing = false;
  let pendingInit = 0;
  const emptyMask = globalUniforms.uStreetHoleMask.value as THREE.Texture;
  const defaultFade = globalUniforms.uStreetFade.value as THREE.Texture;
  const depthChecked = new WeakSet<THREE.Object3D>();
  let holeDepthDone = false;
  /** Areas the camera was near at the last update (they keep a wider margin: hysteresis at the edge). */
  let near = new Set<Area>();

  /** Points the shaders at the mask (while tiles are live) or at the empty one. */
  const bindMask = (on: boolean, ctx: EngineContext): void => {
    if (on === bound || !mask) {
      return;
    }
    bound = on;
    globalUniforms.uStreetHoleMask.value = on ? mask.texture : emptyMask;
    globalUniforms.uStreetFade.value = on ? fade.texture : defaultFade;
    if (on) {
      // Flight-scale casters that appeared since the last check get their hole depth materials.
      assignHoleDepth(ctx.scene, depthChecked);
    } else {
      (globalUniforms.uStreetHoleRect.value as THREE.Vector4).set(0, 0, 1, 1);
    }
  };

  /** Loads the building footprints of every tile near the camera (the live tiles and the ring around them). */
  const ensureFootprints = (a: Area, x: number, z: number): void => {
    const reach = RADIUS + 140;
    for (const ref of a.index.tiles) {
      if (distanceToRect(ref.bounds, x, z) > reach || footprints.has(ref.id)) {
        continue;
      }
      footprints.set(ref.id, 'loading');
      void fetchJson<StreetTileManifest>(new URL(ref.manifest, new URL(a.baseUrl, window.location.href)).href)
        .then((m) => footprints.get(ref.id) === 'loading' && footprints.set(ref.id, footprintsOf(m)))
        .catch(() => footprints.get(ref.id) === 'loading' && footprints.set(ref.id, 'failed'));
    }
  };

  const loadArea = (e: AreaEntry, ctx: EngineContext): void => {
    const baseUrl = `${import.meta.env?.BASE_URL ?? '/'}world/${e.id}/`;
    loaded.set(e.id, 'loading');
    pendingInit++;
    void fetchJson<StreetIndex>(new URL(e.index, new URL(`${import.meta.env?.BASE_URL ?? '/'}${WORLD_INDEX}`, window.location.href)).href)
      .then((full) => {
        if (loaded.get(e.id) !== 'loading') {
          return;
        }
        const cells = owned.get(e.id) ?? new Set<string>();
        // The streamer only sees the cells this area owns (overlapping areas draw each cell once).
        const index: StreetIndex = { ...full, tiles: full.tiles.filter((t) => cells.has(`${t.i}_${t.j}`)) };
        if (!index.tiles.length) {
          loaded.set(e.id, 'failed');
          return;
        }
        const area: Partial<Area> = { id: e.id, baseUrl, index, rect: tileRect(index.tiles) };
        if (!batches) {
          // New pages and grown prop batches upload only their filled part when first drawn.
          installLazyBufferUploads(ctx.renderer.getContext() as WebGL2RenderingContext);
          // The water's planar reflection draws the tiles' walls, roofs and glass, not their small detail; night glow
          // follows the sky in the shader (adaptMaterial), so emissive materials can share batches.
          batches = new TileBatches(true, (o) => compileForScene(ctx, o), RenderLayers.NoReflection, true, fade, (t) => ctx.renderer.initTexture(t));
          batches.group.name = 'street:batches';
          // Debug: tests attribute GL buffer uploads to the layer (scripts/street-layer-test.mjs).
          batches.group.userData.ownsBufferArray = ownsBufferArray;
          ctx.scene.add(batches.group);
        }
        const streamer = new TileStreamer({
          baseUrl,
          index,
          radius: RADIUS,
          shadows: true,
          anisotropy: Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy()),
          propDistances: { distanceScale: 1, personDistance: 0, smallPropDistance: 60, lodBias: 1 },
          excludeAssets: EXCLUDED_PROPS,
          adaptMaterial,
          compile: (o) => compileForScene(ctx, o),
          fadeSeconds: FADE_SECONDS,
          fade,
          textureCache: textures,
          batches,
          materials,
          // A tile fades in once the flight-scale city under it is cut (its hole is in the mask with its slot).
          gate: (ref, slot) => showing && !!mask && mask.isPainted(ref.id, slot),
          workBudgetMs: WORK_BUDGET_MS,
          initTexture: (t) => ctx.renderer.initTexture(t),
          // The water's planar reflection draws the tiles' walls, roofs and glass, not their small detail.
          detailLayer: RenderLayers.NoReflection,
          // Night glow follows the sky in the shader (adaptMaterial), so emissive materials can share batches.
          mergeEmissive: true,
        });
        area.streamer = streamer;
        streamer.root.visible = false;
        // Debug access from the page (scene.getObjectByName('street:<area>').userData.holeMask).
        streamer.root.userData.holeMask = mask;
        ctx.scene.add(streamer.root);
        areas.push(area as Area);
        loaded.set(e.id, area as Area);
      })
      .catch((err: unknown) => {
        loaded.set(e.id, 'failed');
        console.info(`[street] no compiled street tiles for ${e.id} (${String(err)})`);
      })
      .finally(() => pendingInit--);
  };

  const unloadArea = (a: Area): void => {
    mask?.forget(a.index.tiles);
    a.streamer.root.removeFromParent();
    a.streamer.dispose();
    areas.splice(areas.indexOf(a), 1);
    loaded.delete(a.id);
    near.delete(a);
    for (const t of a.index.tiles) {
      footprints.delete(t.id);
    }
  };

  return {
    name: 'street-layer',
    order: UpdateOrder.World + 20,

    init(): void {
      if (!streetLayerEnabled()) {
        return;
      }
      pendingInit++;
      void fetchJson<WorldIndex>(`${import.meta.env?.BASE_URL ?? '/'}${WORLD_INDEX}`)
        .then((root) => {
          entries = root.areas;
          owned = cellOwners(entries);
        })
        .catch((err: unknown) => console.info(`[street] no compiled street areas (${String(err)})`))
        .finally(() => pendingInit--);
    },

    update(dt: number, ctx: EngineContext): void {
      const cam = ctx.camera.position;
      const geo = ctx.services.tryGet('geo');
      const agl = cam.y - (geo ? geo.heightAt(cam.x, cam.z) : 0);
      // Areas are loaded on approach and dropped far away (once none of their tiles is live).
      for (const e of entries) {
        const d = distanceToRect(e.rect, cam.x, cam.z);
        const state = loaded.get(e.id);
        if (!state && d < LOAD_DISTANCE) {
          loadArea(e, ctx);
        } else if (typeof state === 'object' && d > UNLOAD_DISTANCE && !state.streamer.liveTiles().length) {
          unloadArea(state);
        }
      }
      const within = (a: Area, m: number): boolean => distanceToRect(a.rect, cam.x, cam.z) < m;
      near = new Set(areas.filter((a) => within(a, near.has(a) ? RADIUS + EDGE_HYSTERESIS : RADIUS)));
      const wantActive = near.size > 0 && agl < PREFETCH_AGL;
      if (wantActive) {
        inactiveFor = 0;
        active = true;
        showing ||= agl < ACTIVE_AGL;
      } else if (active) {
        inactiveFor += Math.max(ctx.time.realDt, dt);
        if (inactiveFor > DROP_AFTER) {
          active = false;
          showing = false;
        }
      }
      // Parts of loaded tiles are copied into the shared batches (the streamers see them complete on their update).
      batches?.work(WORK_BUDGET_MS);
      const engaged: Area[] = [];
      for (const a of areas) {
        const on = active && near.has(a);
        if (on) {
          a.streamer.update(cam.x, cam.z);
          ensureFootprints(a, cam.x, cam.z);
        } else if (a.streamer.liveTiles().length) {
          // Far away or high up: every tile fades out and is dropped (a focus far outside the area unloads them).
          a.streamer.update(a.rect.minX - 1e5, a.rect.minZ - 1e5);
        }
        const live = a.streamer.liveTiles();
        a.streamer.root.visible = live.length > 0;
        // Debug state for page-side checks (scene.getObjectByName('street:<area>').userData.layer).
        a.streamer.root.userData.layer = { active, showing, on, agl };
        if (on || live.length) {
          engaged.push(a);
        }
      }
      // Hole depth materials go on well before the layer switches on, so their programs are not linked at that frame.
      if (!holeDepthDone && entries.some((e) => distanceToRect(e.rect, cam.x, cam.z) < PREPARE_DISTANCE)) {
        holeDepthDone = true;
        assignHoleDepth(ctx.scene, depthChecked);
      }
      if (!engaged.length && !mask?.paintedCount) {
        bindMask(false, ctx);
        return;
      }
      if (!mask) {
        mask = new HoleMask(footprints);
        for (const a of areas) {
          a.streamer.root.userData.holeMask = mask;
        }
      }
      const key = engaged
        .map((a) => a.id)
        .sort()
        .join('+');
      mask.setTiles(key, () => engaged.flatMap((a) => a.index.tiles));
      mask.follow(cam.x, cam.z);
      const live = engaged.flatMap((a) => a.streamer.liveTiles().map((t) => ({ ref: t.ref, slot: t.slot })));
      mask.update(live, MASK_BUDGET_MS);
      (globalUniforms.uStreetHoleRect.value as THREE.Vector4).copy(mask.rect);
      bindMask(live.length > 0 || mask.paintedCount > 0, ctx);
    },

    pending(): number {
      let n = pendingInit;
      for (const a of areas) {
        if (a.streamer.root.visible) {
          n += a.streamer.pending();
          for (const t of a.index.tiles) {
            n += footprints.get(t.id) === 'loading' ? 1 : 0;
          }
        }
      }
      return n + (mask?.backlog ?? 0);
    },

    dispose(): void {
      for (const a of [...areas]) {
        unloadArea(a);
      }
      mask?.dispose();
      mask = null;
      bound = false;
      globalUniforms.uStreetHoleMask.value = emptyMask;
      (globalUniforms.uStreetHoleRect.value as THREE.Vector4).set(0, 0, 1, 1);
      globalUniforms.uStreetFade.value = defaultFade;
      batches?.group.removeFromParent();
      batches?.dispose();
      batches = null;
      for (const m of materials.values()) {
        m.dispose();
      }
      materials.clear();
      fade.dispose();
      for (const p of textures.values()) {
        void p.then((t) => t?.dispose());
      }
      textures.clear();
    },
  };
}
