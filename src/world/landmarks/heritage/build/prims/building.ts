import { withSurf, type Mat, type MeshBuilder } from '../mesh-builder';
import { obb, offsetRing, type V2 } from '../geom';
import { FACADE_BASE, FACADE_STYLES } from '../surfaces';
import { flatPoly, prism, wallSeg } from './basic';
import { balustrade } from './details';
import { gableRoof, hipRoof, insetRoof, pyramidRoof, type InsetStep } from './roofs';

/**
 * Walls of a CCW ring between y0 and y1. With a facade surface, every edge is split into plain margins and a
 * window zone whose u starts at 0 on the first bay, so the shader's window grid is centred and never cut by corners.
 */
export function facadeWalls(mb: MeshBuilder, ring: readonly V2[], y0: number, y1: number, wall: Mat, facadeSurf: number | null, aoTop = 1): void {
  const style = facadeSurf !== null && facadeSurf >= FACADE_BASE ? FACADE_STYLES[facadeSurf - FACADE_BASE] : null;
  const plain = style ? withSurf(wall, style.base) : wall;
  const fac = style ? withSurf(wall, facadeSurf!) : wall;
  const H = y1 - y0;
  let rows = 0;
  let yF = y0;
  if (style) {
    rows = Math.min(style.rows, Math.floor((H - style.sill - style.winH - style.frame - 0.25) / style.floorH) + 1);
    if (rows > 0) {
      yF = Math.min(y1, y0 + style.sill + (rows - 1) * style.floorH + style.winH + style.frame + 0.35);
    }
  }
  const n = ring.length;
  let uRun = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-3) {
      continue;
    }
    const dx = (b[0] - a[0]) / L;
    const dz = (b[1] - a[1]) / L;
    const bays = style && rows > 0 ? Math.floor((L - 1.6) / style.spacing) : 0;
    if (bays < 1) {
      wallSeg(mb, a[0], a[1], b[0], b[1], y0, y1, y0, y1, uRun, y0, plain, 1, aoTop);
      uRun += L;
      continue;
    }
    const margin = (L - bays * style!.spacing) / 2;
    const p1: V2 = [a[0] + dx * margin, a[1] + dz * margin];
    const p2: V2 = [b[0] - dx * margin, b[1] - dz * margin];
    // Plain margins (full height).
    wallSeg(mb, a[0], a[1], p1[0], p1[1], y0, y1, y0, y1, uRun, y0, plain, 1, aoTop);
    wallSeg(mb, p2[0], p2[1], b[0], b[1], y0, y1, y0, y1, uRun + L - margin, y0, plain, 1, aoTop);
    // Window zone and the plain band above it.
    wallSeg(mb, p1[0], p1[1], p2[0], p2[1], y0, yF, y0, yF, 0, y0, fac);
    if (y1 - yF > 0.01) {
      wallSeg(mb, p1[0], p1[1], p2[0], p2[1], yF, y1, yF, y1, uRun + margin, y0, plain, 1, aoTop);
    }
    uRun += L;
  }
}

export type RoofKind = 'hip' | 'flat' | 'pyramid' | 'gable' | 'none' | 'terrace' | 'mansard';

export interface BuildingSpec {
  ring: readonly V2[];
  /** Ground floor level (facade base). */
  base: number;
  /** Bottom of the foundation (below the lowest ground under the footprint). */
  foundation: number;
  /** Eave / cornice height above `base`. */
  wallH: number;
  wall: Mat;
  facade?: number | null;
  /** Rusticated plinth band at the foot (m) in `plinthMat`. */
  plinth?: number;
  plinthMat?: Mat;
  /** Projecting cornice at the top. */
  cornice?: { h: number; proj: number; mat: Mat } | null;
  roof: RoofKind;
  roofMat: Mat;
  pitchDeg?: number;
  overhang?: number;
  soffitMat?: Mat;
  /** Pyramid apex rise (roof 'pyramid'). */
  apexRise?: number;
  /** Balustrade on flat / terrace roofs. */
  balustrade?: { h: number; mat: Mat; coping: Mat } | null;
  /** Mansard steps (roof 'mansard'). */
  mansard?: readonly InsetStep[];
}

/** Generic building from a footprint: foundation, walls with facade, cornice, roof. Returns the roof top height. */
export function building(mb: MeshBuilder, s: BuildingSpec, lod: number): number {
  const top = s.base + s.wallH;
  const plinth = s.plinth ?? 0;
  const plinthMat = s.plinthMat ?? s.wall;
  if (s.foundation < s.base + plinth - 0.01) {
    prism(mb, offsetRing(s.ring, plinth > 0 ? 0.12 : 0.02), s.foundation, s.base + plinth, plinthMat, { cap: false, vRef: s.foundation, aoBottom: 0.7 });
  }
  facadeWalls(mb, s.ring, s.base + plinth, top, s.wall, s.facade ?? null, s.cornice ? 1 : 0.8);
  let y = top;
  if (s.cornice && lod === 0) {
    const c = s.cornice;
    prism(mb, offsetRing(s.ring, c.proj), top - c.h, top, c.mat, { cap: false, vRef: top - c.h, aoBottom: 0.6 });
    // Underside of the projection.
    flatPoly(mb, offsetRing(s.ring, c.proj), top - c.h, c.mat, true, 0.5);
  }
  const pitch = s.pitchDeg ?? 22;
  const over = s.overhang ?? 0.6;
  switch (s.roof) {
    case 'hip':
      y = hipRoof(mb, s.cornice ? offsetRing(s.ring, s.cornice.proj) : s.ring, top, s.roofMat, {
        pitchDeg: pitch,
        overhang: s.cornice ? 0.05 : over,
        soffitMat: s.soffitMat,
      });
      break;
    case 'pyramid':
      y = pyramidRoof(mb, s.ring, top, s.apexRise ?? 4, s.roofMat, { overhang: over, soffitMat: s.soffitMat });
      break;
    case 'gable':
      y = gableRoof(mb, s.ring, top, pitch, s.roofMat, s.wall, over);
      break;
    case 'mansard':
      y = insetRoof(mb, s.ring, top, s.mansard ?? [{ inset: 1.2, rise: 3.5 }, { inset: 3, rise: 1.2 }], s.roofMat);
      break;
    case 'terrace':
    case 'flat': {
      const outer = s.cornice ? offsetRing(s.ring, s.cornice.proj) : s.ring;
      flatPoly(mb, outer, top, s.roofMat);
      if (s.balustrade && lod === 0) {
        const bb = s.balustrade;
        const inner = offsetRing(outer, -0.2);
        for (let i = 0; i < inner.length; i++) {
          balustrade(mb, inner[i], inner[(i + 1) % inner.length], top, bb.h, bb.mat, bb.coping);
        }
      }
      if (s.roof === 'flat') {
        // Low lead hip roof set back behind the parapet.
        const set = offsetRing(outer, -1.2);
        y = insetRoof(mb, set, top + 0.05, [{ inset: Math.min(4, 0.3 * shortSide(set)), rise: Math.min(4, 0.3 * shortSide(set)) * Math.tan((pitch * Math.PI) / 180) }], s.roofMat);
      } else {
        y = top + (s.balustrade ? s.balustrade.h : 0);
      }
      break;
    }
    default:
      flatPoly(mb, s.ring, top, s.roofMat);
  }
  return y;
}

function shortSide(ring: readonly V2[]): number {
  return obb(ring).wid;
}
