/**
 * Main thread: decides which terrain patches every structure site needs, samples the visible ground there and
 * packages the landmark definition for the worker.
 */
import type { GeoQuery, LandmarkDef } from '../../../../core/contracts';
import { samplePatch, type PatchSpec } from '../build/height-sampler';
import type { SiteDef, SiteInput } from '../types';
import { inRects, osmStaticExclusion } from '../../../osm/regions';
import { osmGroundHeight, QUAY_EDGE } from '../../../osm/shared/street-surface';

function squarePatch(x: number, z: number, half: number, cell: number): PatchSpec {
  return { ox: x, oz: z, ux: 1, uz: 0, u0: -half, lenU: half * 2, v0: -half, lenV: half * 2, cell };
}

/** Strip along a->b extended by `extend` at both ends, `halfWidth` to each side. */
function stripPatch(ax: number, az: number, bx: number, bz: number, extend: number, halfWidth: number, cell: number): PatchSpec {
  const len = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  return { ox: ax, oz: az, ux, uz, u0: -extend, lenU: len + extend * 2, v0: -halfWidth, lenV: halfWidth * 2, cell };
}

export function planPatches(def: LandmarkDef): PatchSpec[] {
  const anchors = def.anchors ?? [];
  if (def.kind === 'bridge' && anchors.length >= 4) {
    const a = anchors[2];
    const b = anchors[3];
    const long = Math.hypot(b.x - a.x, b.z - a.z) > 1200;
    return [stripPatch(a.x, a.z, b.x, b.z, long ? 900 : 500, long ? 90 : 60, long ? 6 : 2)];
  }
  if (def.kind === 'skyscraper' && anchors.length > 0) {
    return anchors.map((p) => squarePatch(p.x, p.z, 130, 4));
  }
  return [squarePatch(def.x, def.z, Math.max(def.radius, 30) + 60, 2)];
}

/**
 * The ground a structure stands on: the OSM street ground inside the OSM regions (quays raised, ground lift), the geo
 * terrain elsewhere, so abutments and bases meet the drawn surface exactly.
 */
function visibleGround(geo: GeoQuery): (x: number, z: number) => number {
  const rects = osmStaticExclusion();
  return (x, z) => {
    const h = geo.heightAt(x, z);
    if (!inRects(rects, x, z)) {
      return h;
    }
    // The OSM ground ends in the quay wall (QUAY_EDGE): seaward of it the sea floor stays.
    const c = geo.coastDistance(x, z);
    return c > QUAY_EDGE ? osmGroundHeight(h, c) : h;
  };
}

export function prepareSite(def: LandmarkDef, geo: GeoQuery): SiteInput {
  const ground = visibleGround(geo);
  const patches = planPatches(def).map((spec) => samplePatch(ground, spec));
  const anchors = def.anchors?.map((p) => {
    const h = (p as { height?: number }).height;
    return h === undefined ? { x: p.x, z: p.z } : { x: p.x, z: p.z, height: h };
  });
  const siteDef: SiteDef = { ...def, anchors };
  return { def: siteDef, patches };
}
