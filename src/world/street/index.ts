/**
 * Street layer in the flight game: close-range detail where the dragon comes down. Near a compiled street area
 * (tools/world-compiler output in /world/<area>/, compiled with `--landmarks none`) and below ACTIVE_AGL, the area's
 * tiles stream in around the camera (src/street/tile-streamer.ts); the flight-scale OSM and terrain geometry under a
 * live tile is discarded through the global street hole mask (core/uniforms.ts streetHole), except inside landmark
 * footprints, where the game's own mosque and landmark models keep showing.
 */
import * as THREE from 'three';
import { UpdateOrder, type EngineContext, type System } from '../../core/contracts';
import { globalUniforms } from '../../core/uniforms';
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
const MASK_CELL = 1;

interface Area {
  id: string;
  streamer: TileStreamer;
  rect: { minX: number; minZ: number; maxX: number; maxZ: number };
}

function tileRect(tiles: readonly StreetTileRef[]): Area['rect'] {
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

/** The hole mask of one area: 255 under live tiles, 0 elsewhere and inside landmark footprints. */
class HoleMask {
  readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array;
  private readonly w: number;
  private readonly h: number;
  private signature = '';

  constructor(private readonly rect: Area['rect']) {
    this.w = Math.ceil((rect.maxX - rect.minX) / MASK_CELL);
    this.h = Math.ceil((rect.maxZ - rect.minZ) / MASK_CELL);
    this.data = new Uint8Array(this.w * this.h);
    this.texture = new THREE.DataTexture(this.data, this.w, this.h, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
  }

  get vector(): THREE.Vector4 {
    return new THREE.Vector4(this.rect.minX, this.rect.minZ, this.w * MASK_CELL, this.h * MASK_CELL);
  }

  /** Rebuilds when the set of live tiles (with manifests) changed. */
  update(live: readonly { ref: StreetTileRef; manifest: StreetTileManifest | null }[]): void {
    const ready = live.filter((t) => t.manifest);
    const signature = ready.map((t) => t.ref.id).sort().join(',');
    if (signature === this.signature) {
      return;
    }
    this.signature = signature;
    this.data.fill(0);
    const cell = (x: number, z: number): [number, number] => [Math.floor((x - this.rect.minX) / MASK_CELL), Math.floor((z - this.rect.minZ) / MASK_CELL)];
    for (const { ref, manifest } of ready) {
      const [x0, z0] = cell(ref.bounds.minX, ref.bounds.minZ);
      const [x1, z1] = cell(ref.bounds.maxX, ref.bounds.maxZ);
      for (let z = Math.max(0, z0); z < Math.min(this.h, z1); z++) {
        this.data.fill(255, z * this.w + Math.max(0, x0), z * this.w + Math.min(this.w, x1));
      }
      for (const b of manifest!.buildings ?? []) {
        if (!b.landmark) {
          continue;
        }
        const f = b.footprint;
        let minX = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxZ = -Infinity;
        for (let i = 0; i < f.length; i += 2) {
          minX = Math.min(minX, f[i]);
          maxX = Math.max(maxX, f[i]);
          minZ = Math.min(minZ, f[i + 1]);
          maxZ = Math.max(maxZ, f[i + 1]);
        }
        // One texel of margin keeps the landmark's own walls whole.
        const [bx0, bz0] = cell(minX - MASK_CELL, minZ - MASK_CELL);
        const [bx1, bz1] = cell(maxX + MASK_CELL, maxZ + MASK_CELL);
        for (let z = Math.max(0, bz0); z <= Math.min(this.h - 1, bz1); z++) {
          for (let x = Math.max(0, bx0); x <= Math.min(this.w - 1, bx1); x++) {
            const wx = this.rect.minX + (x + 0.5) * MASK_CELL;
            const wz = this.rect.minZ + (z + 0.5) * MASK_CELL;
            if (pointInRing(f, wx, wz) || pointInRing(f, wx - MASK_CELL, wz) || pointInRing(f, wx + MASK_CELL, wz) || pointInRing(f, wx, wz - MASK_CELL) || pointInRing(f, wx, wz + MASK_CELL)) {
              this.data[z * this.w + x] = 0;
            }
          }
        }
      }
    }
    this.texture.needsUpdate = true;
  }
}

export function createStreetLayerSystem(): System {
  const areas: Area[] = [];
  let mask: HoleMask | null = null;
  let maskArea: Area | null = null;
  let inactiveFor = 0;
  let active = false;
  let pendingInit = 0;
  const emptyMask = globalUniforms.uStreetHoleMask.value as THREE.Texture;

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
              // The game's own crowd and traffic walk these streets: the compiled placeholder people stay out.
              propDistances: { distanceScale: 1, personDistance: 0, smallPropDistance: 60, lodBias: 1 },
              compile: (o) => ctx.renderer.compileAsync(o, ctx.camera, ctx.scene),
            });
            streamer.root.visible = false;
            ctx.scene.add(streamer.root);
            areas.push({ id, streamer, rect: tileRect(index.tiles) });
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
        } else if (a.streamer.liveTiles().length) {
          // Far away: drop every tile (a focus far outside the area unloads them).
          a.streamer.update(a.rect.minX - 1e5, a.rect.minZ - 1e5);
        }
        a.streamer.root.visible = on;
      }
      const shown = active ? near : null;
      setMask(shown);
      if (shown && mask) {
        mask.update(shown.streamer.liveTiles());
      }
    },

    pending(): number {
      let n = pendingInit;
      for (const a of areas) {
        if (a.streamer.root.visible) {
          n += a.streamer.pending();
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
