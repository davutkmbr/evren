/**
 * Handover of the streamed OSM regions (phase 24, S3): while a region appears or goes, its materials dither against
 * the city chunks that draw the same buildings (the far OSM layer, city/osm/), so the switch reads as detail sharpening
 * rather than a pop.
 *
 * Sequence (index.ts, regions.ts setOsmRegionActive, city/streamer.ts refresh):
 * 1. A region loads hidden (its group invisible).
 * 2. Its buildings are uploaded: it becomes active and the city rebuilds the chunks over its rect without the buildings
 *    the region owns. When every one of them is ready the city swaps them all at once, the old chunks dithering out
 *    and the new ones in, and reports the start time.
 * 3. From that time the region fades in over OSM_FADE_SECONDS on its slot (core/uniforms.ts uOsmFadeRect /
 *    uOsmFadeVal), with the city's dither pattern: every pixel shows either the old city chunk or the region.
 * Going away is the same in reverse: the region stays until the city's chunks with its buildings are ready, fades out,
 * and is disposed.
 */
import type * as THREE from 'three';
import type { WorldBounds } from '../../core/contracts';
import { globalUniforms, OSM_FADE_SLOTS } from '../../core/uniforms';

/** Same duration as the city's chunk cross-fade (city/streamer.ts FADE_SECONDS). */
export const OSM_FADE_SECONDS = 0.75;

const used = new Array<boolean>(OSM_FADE_SLOTS).fill(false);

function rects(): THREE.Vector4[] {
  return globalUniforms.uOsmFadeRect.value as THREE.Vector4[];
}

function vals(): THREE.Vector2[] {
  return globalUniforms.uOsmFadeVal.value as THREE.Vector2[];
}

/** Claims a slot for `rect` (hidden: fade 0); null when all slots are busy (the region then pops, as before). */
export function acquireOsmFade(rect: WorldBounds): number | null {
  const slot = used.indexOf(false);
  if (slot < 0) {
    return null;
  }
  used[slot] = true;
  rects()[slot].set(rect.minX, rect.minZ, rect.maxX, rect.maxZ);
  vals()[slot].set(0, 0);
  return slot;
}

/** Fade (0 hidden, 1 fully drawn) and direction of a slot. */
export function setOsmFade(slot: number, fade: number, out: boolean): void {
  vals()[slot].set(Math.min(1, Math.max(0, fade)), out ? 1 : 0);
}

export function releaseOsmFade(slot: number): void {
  used[slot] = false;
  rects()[slot].set(1e9, 1e9, 1e9, 1e9);
  vals()[slot].set(1, 0);
}

/** Adds the OSM_FADE define to every material under `root` (once per material; the program keeps it for good). */
export function tagOsmFade(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) {
      return;
    }
    for (const mat of Array.isArray(m) ? m : [m]) {
      if (!mat.defines?.OSM_FADE) {
        mat.defines = { ...(mat.defines ?? {}), OSM_FADE: 1 };
        mat.needsUpdate = true;
      }
    }
  });
}
