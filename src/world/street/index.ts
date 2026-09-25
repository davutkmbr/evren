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
 * The slice's trees stay (the compiled tiles only carry OSM-mapped trees), as do the game's crowd and traffic: the
 * compiled placeholders for those are left out.
 */
import * as THREE from 'three';
import { UpdateOrder, type EngineContext, type System } from '../../core/contracts';
import { globalUniforms, patchMaterial } from '../../core/uniforms';
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

/**
 * The hole mask of one area (RG8, MASK_CELL m texels): red = ground hole (live tiles minus landmarks), green =
 * building hole (see the module comment).
 */
class HoleMask {
  readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array;
  private readonly w: number;
  private readonly h: number;
  private signature = '';
  /** Texel indices covered by a footprint grown by some distance, per building id and growth. */
  private readonly cells = new Map<string, Int32Array>();

  constructor(private readonly rect: Rect) {
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

  private paint(cells: Int32Array, channel: 0 | 1, value: number): void {
    for (let k = 0; k < cells.length; k++) {
      this.data[cells[k] * 2 + channel] = value;
    }
  }

  /**
   * Rebuilds when the live tiles or the known footprints changed. `live` are the tiles in the scene whose manifest is
   * ready; `others` the footprints of the tiles around them that are not loaded.
   */
  update(live: readonly { ref: StreetTileRef; footprints: readonly Footprint[] }[], others: readonly { id: string; footprints: readonly Footprint[] }[]): void {
    const signature = `${live.map((t) => t.ref.id).sort().join(',')}|${others.map((t) => t.id).sort().join(',')}`;
    if (signature === this.signature) {
      return;
    }
    this.signature = signature;
    const d = this.data;
    d.fill(0);
    const cell = (x: number, z: number): [number, number] => [Math.floor((x - this.rect.minX) / MASK_CELL), Math.floor((z - this.rect.minZ) / MASK_CELL)];
    for (const { ref } of live) {
      const [x0, z0] = cell(ref.bounds.minX, ref.bounds.minZ);
      const [x1, z1] = cell(ref.bounds.maxX, ref.bounds.maxZ);
      for (let z = Math.max(0, z0); z < Math.min(this.h, z1); z++) {
        d.fill(255, (z * this.w + Math.max(0, x0)) * 2, (z * this.w + Math.min(this.w, x1)) * 2);
      }
    }
    for (const { footprints } of live) {
      for (const fp of footprints) {
        if (!fp.landmark) {
          this.paint(this.cellsOf(fp, GROW_LIVE), 1, 255);
        }
      }
    }
    const liveRects = live.map((t) => t.ref.bounds);
    for (const { footprints } of others) {
      for (const fp of footprints) {
        if (liveRects.some((r) => overlaps(fp.bbox, r, GROW_LIVE))) {
          this.paint(this.cellsOf(fp, GROW_KEEP), 1, 0);
        }
      }
    }
    for (const list of [live, others]) {
      for (const { footprints } of list) {
        for (const fp of footprints) {
          if (fp.landmark && liveRects.some((r) => overlaps(fp.bbox, r, GROW_LANDMARK))) {
            const cells = this.cellsOf(fp, GROW_LANDMARK);
            this.paint(cells, 0, 0);
            this.paint(cells, 1, 0);
          }
        }
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
 * their meshes get a depth material that discards the same fragments (per mask channel). Materials with their own
 * depth material, alpha test or a hole anchor (instanced details) keep theirs.
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
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vHoleW;\nuniform sampler2D uStreetHoleMask;\nuniform vec4 uStreetHoleRect;').replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
  {
    vec2 streetUv = (vHoleW - uStreetHoleRect.xy) / uStreetHoleRect.zw;
    if (all(greaterThan(streetUv, vec2(0.0))) && all(lessThan(streetUv, vec2(1.0))) && texture2D(uStreetHoleMask, streetUv)[${channel}] > 0.5) discard;
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

export function createStreetLayerSystem(): System {
  const areas: Area[] = [];
  let mask: HoleMask | null = null;
  let maskArea: Area | null = null;
  let inactiveFor = 0;
  let active = false;
  let pendingInit = 0;
  const emptyMask = globalUniforms.uStreetHoleMask.value as THREE.Texture;
  const depthChecked = new WeakSet<THREE.Object3D>();

  const setMask = (area: Area | null): void => {
    if (area === maskArea) {
      return;
    }
    maskArea = area;
    mask?.texture.dispose();
    mask = area ? new HoleMask(area.rect) : null;
    globalUniforms.uStreetHoleMask.value = mask ? mask.texture : emptyMask;
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

  const updateMask = (a: Area): void => {
    const live: { ref: StreetTileRef; footprints: readonly Footprint[] }[] = [];
    const liveIds = new Set<string>();
    for (const t of a.streamer.liveTiles()) {
      const fp = a.footprints.get(t.ref.id);
      if (t.manifest && Array.isArray(fp)) {
        live.push({ ref: t.ref, footprints: fp });
        liveIds.add(t.ref.id);
      }
    }
    const others: { id: string; footprints: readonly Footprint[] }[] = [];
    for (const [id, fp] of a.footprints) {
      if (!liveIds.has(id) && Array.isArray(fp)) {
        others.push({ id, footprints: fp });
      }
    }
    mask!.update(live, others);
  };

  return {
    name: 'street-layer',
    order: UpdateOrder.World + 20,

    init(ctx: EngineContext): void {
      // Opt-in (?street=1) until the compiled tiles read clearly better than the Galata slice at landing distance.
      if (new URLSearchParams(window.location.search).get('street') !== '1') {
        return;
      }
      for (const id of AREAS) {
        const baseUrl = `${import.meta.env.BASE_URL}world/${id}/`;
        pendingInit++;
        void fetchJson<StreetIndex>(`${baseUrl}index.json`)
          .then((index) => {
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
            });
            streamer.root.visible = false;
            ctx.scene.add(streamer.root);
            areas.push({ id, baseUrl, index, streamer, rect: tileRect(index.tiles), footprints: new Map() });
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
      for (const a of areas) {
        const on = active && a === near;
        if (on) {
          a.streamer.update(cam.x, cam.z);
          ensureFootprints(a, cam.x, cam.z);
        } else if (a.streamer.liveTiles().length) {
          // Far away: drop every tile (a focus far outside the area unloads them).
          a.streamer.update(a.rect.minX - 1e5, a.rect.minZ - 1e5);
        }
        a.streamer.root.visible = on;
      }
      const shown = active ? near : null;
      if (shown && shown !== maskArea) {
        assignHoleDepth(ctx.scene, depthChecked);
      }
      setMask(shown);
      if (shown && mask) {
        updateMask(shown);
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
      return n;
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
