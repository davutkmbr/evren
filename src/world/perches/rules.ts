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
   * Radius (m) within which the perch's own structure may not rise over the grip in front of the dragon (within
   * ±`frontAngle` degrees of the heading). Behind it the structure may rise (a lantern or a pier beside the grip);
   * slender parts farther out (minarets beside a dome) are allowed, the perch camera keeps them out of its sight line.
   */
  ownRadius: 28,
  frontAngle: 75,
  /**
   * The view cone: `viewRays` rays across ±`viewSpread` degrees of the heading. From `viewFrom` to `viewTo` m the
   * terrain stays below the eye (grip + `eye` m); within `viewNear` m the land-use obstacle allowance (trees,
   * buildings) does too. Landmarks in the view are what the perch looks at, not blockers.
   */
  viewSpread: 30,
  viewRays: 5,
  viewFrom: 40,
  viewNear: 150,
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
  const blocker = viewBlocker(geo, p);
  if (blocker) {
    out.push(`view blocked by ${blocker.what} ${f1(blocker.height)} m at ${blocker.at} m, ${blocker.bearing}° off the heading`);
  }
  return out;
}

/** First thing rising over the eye inside the view cone (rules above), or null when the view is open. */
export function viewBlocker(geo: GeoQuery, p: PerchPoint): { height: number; at: number; bearing: number; what: string } | null {
  const R = PERCH_RULES;
  const eye = p.y + R.eye;
  for (let i = 0; i < R.viewRays; i++) {
    const bearing = R.viewRays > 1 ? -R.viewSpread + (2 * R.viewSpread * i) / (R.viewRays - 1) : 0;
    const h = ((p.headingDeg + bearing) * Math.PI) / 180;
    for (let d = R.viewFrom; d <= R.viewTo; d += R.viewStep) {
      const x = p.x + Math.sin(h) * d;
      const z = p.z - Math.cos(h) * d;
      const t = geo.heightAt(x, z);
      const near = d <= R.viewNear && t > 0 ? (OBSTACLE[geo.landUseAt(x, z)] ?? 30) : 0;
      if (t + near >= eye) {
        return { height: t + near, at: d, bearing, what: near > 0 ? `terrain + ${LandUse[geo.landUseAt(x, z)]} allowance` : 'terrain' };
      }
    }
  }
  return null;
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
