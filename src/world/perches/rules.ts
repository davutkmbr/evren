/**
 * Placement rules every perch must meet (the owner's rule: a perch is always on top of everything). Checked against
 * the GeoQuery when the service loads (a failing perch is not offered) and by tools/headless/perches-check.ts, which
 * also measures the real built structure. The in-game audit (scripts/perch-audit.mjs) measures the rendered scene.
 */
import { LandUse, type GeoQuery, type PerchPoint } from '../../core/contracts';

export const PERCH_RULES = {
  /** Grip point at least this high above the ground or the sea under it (m). */
  minAboveGround: 20,
  /** Neighbourhood radius (m) the perch must top, and the margin (m) it keeps over it. */
  neighbourRadius: 40,
  neighbourMargin: 3,
  /**
   * Radius (m) within which the perch's own structure may not rise over the grip (the camera boom's reach); slender
   * parts farther out (minarets beside a dome) are allowed, the perch camera keeps them out of the line of sight.
   */
  ownRadius: 28,
  /** The view along the heading: terrain from `viewFrom` to `viewTo` m stays below the eye (grip + `eye` m). */
  viewFrom: 40,
  viewTo: 1500,
  viewStep: 25,
  eye: 3,
} as const;

/**
 * Height allowance (m) over the terrain per land use for what the GeoQuery cannot see: trees (tallest species 24 m,
 * scaled up to ~1.2x), OSM and procedural buildings, street props. Towers are landmarks and checked by their data.
 */
const OBSTACLE: Record<LandUse, number> = {
  [LandUse.Water]: 0,
  [LandUse.Beach]: 3,
  [LandUse.Urban]: 30,
  [LandUse.HistoricUrban]: 30,
  [LandUse.Highrise]: 60,
  [LandUse.Industrial]: 25,
  [LandUse.Park]: 30,
  [LandUse.Forest]: 30,
  [LandUse.Farmland]: 12,
  [LandUse.Airport]: 12,
  [LandUse.Cemetery]: 30,
  [LandUse.Landmark]: 15,
  [LandUse.Road]: 15,
  [LandUse.Suburban]: 25,
};

/** Rule violations of a resolved perch (empty when it passes). */
export function validatePerch(geo: GeoQuery, p: PerchPoint): string[] {
  const R = PERCH_RULES;
  const out: string[] = [];
  const f1 = (v: number): string => v.toFixed(1);
  const ground = Math.max(geo.heightAt(p.x, p.z), 0);
  if (p.y - ground < R.minAboveGround) {
    out.push(`only ${f1(p.y - ground)} m above the ground (min ${R.minAboveGround})`);
  }
  const top = neighbourEnvelope(geo, p.x, p.z, p.landmarkId);
  if (p.y < top.height + R.neighbourMargin) {
    out.push(`below the neighbour envelope ${f1(top.height)} m (${top.what}) within ${R.neighbourRadius} m (grip ${f1(p.y)})`);
  }
  const h = (p.headingDeg * Math.PI) / 180;
  for (let d = R.viewFrom; d <= R.viewTo; d += R.viewStep) {
    const t = geo.heightAt(p.x + Math.sin(h) * d, p.z - Math.cos(h) * d);
    if (t >= p.y + R.eye) {
      out.push(`view blocked by terrain ${f1(t)} m at ${d} m`);
      break;
    }
  }
  return out;
}

/**
 * Highest thing the GeoQuery knows of within the neighbourhood radius: the terrain (or the sea) plus the obstacle
 * allowance of its land use, and every other landmark standing inside it.
 */
export function neighbourEnvelope(geo: GeoQuery, x: number, z: number, own?: string): { height: number; what: string } {
  const R = PERCH_RULES.neighbourRadius;
  let height = -Infinity;
  let what = '';
  for (let dz = -R; dz <= R; dz += 5) {
    for (let dx = -R; dx <= R; dx += 5) {
      if (dx * dx + dz * dz > R * R) {
        continue;
      }
      const t = geo.heightAt(x + dx, z + dz);
      const use = geo.landUseAt(x + dx, z + dz);
      const e = Math.max(t, 0) + (t > 0 ? (OBSTACLE[use] ?? 30) : 0);
      if (e > height) {
        height = e;
        what = t > 0 ? `terrain + ${LandUse[use]} allowance` : 'sea';
      }
    }
  }
  for (const l of geo.landmarks) {
    if (l.id === own || Math.hypot(l.x - x, l.z - z) > R) {
      continue;
    }
    if (l.y + l.height > height) {
      height = l.y + l.height;
      what = `landmark ${l.id}`;
    }
  }
  return { height, what };
}
