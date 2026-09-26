/**
 * Landmark ground claims: the part of the map a modelled landmark occupies, so the OSM layers (buildings, infill,
 * trees, street furniture) leave it to the landmark instead of drawing through it.
 *
 * Rules (one per footprint kind, applied to every landmark the same way):
 * - Only landmarks a landmark system actually draws claim ground (`isModelled`). A landmark without a model (e.g. a
 *   heritage site whose builder does not exist yet) claims nothing, so the real OSM buildings stay visible there
 *   instead of an empty pad.
 * - 'pad' / 'slope' / 'polygon': a disc of `radius` (buildings mostly inside it are dropped).
 * - 'cluster': a disc of `footprintWidth` around every anchor (one per tower).
 * - 'line': the anchor polyline as capsules. `body` = half the modelled body width plus a clearance: any building
 *   touching it is dropped (the landmark never passes through a building); `corridor` = footprintWidth, kept free of
 *   synthetic infill parcels only.
 * - 'none' (bridges) and kind 'walls' (the city walls system owns its buildings, walls/system/owned.ts): no claim.
 */
import type { GeoQuery, LandmarkDef } from '../../core/contracts';
import { SITE_BUILDERS } from './heritage/build/registry';
import type { LandmarkClaims } from './claim-shapes';

export { LINE_STRIDE, onLineBody, ringTouchesLineBody, type LandmarkClaims } from './claim-shapes';

/** Clearance (m) between a line landmark's body and the nearest kept building. */
export const BODY_CLEARANCE = 1;

/** Whether a landmark system draws a model for this landmark. */
export function isModelled(l: LandmarkDef): boolean {
  switch (l.builder) {
    case 'heritage':
      return SITE_BUILDERS[l.id] !== undefined;
    case 'mosques':
    case 'structures':
      // Both systems draw every landmark of theirs (generic fallbacks for unknown ids).
      return true;
    default:
      return false;
  }
}

/** Ground claims of the modelled landmarks; `grow` widens pads and line bodies (m). */
export function landmarkClaims(geo: GeoQuery, grow = 0): LandmarkClaims {
  const pads: number[] = [];
  const lines: number[] = [];
  for (const l of geo.landmarks) {
    if (l.kind === 'walls' || !isModelled(l)) {
      continue;
    }
    const fp = l.footprint ?? 'pad';
    const anchors = l.anchors ?? [];
    if (fp === 'none') {
      continue;
    }
    if (fp === 'cluster' && anchors.length) {
      for (const a of anchors) {
        pads.push(a.x, a.z, (l.footprintWidth ?? 40) + grow);
      }
    } else if (fp === 'line' && anchors.length >= 2) {
      const body = (l.bodyWidth ?? (l.footprintWidth ?? 8) * 0.8) / 2 + BODY_CLEARANCE + grow;
      const corridor = Math.max(body, l.footprintWidth ?? body);
      for (let i = 0; i + 1 < anchors.length; i++) {
        lines.push(anchors[i].x, anchors[i].z, anchors[i + 1].x, anchors[i + 1].z, body, corridor);
      }
    } else {
      pads.push(l.x, l.z, l.radius + grow);
    }
  }
  for (const m of geo.smallMosqueSites) {
    pads.push(m.x, m.z, m.radius);
  }
  return { pads: new Float32Array(pads), lines: new Float32Array(lines) };
}

