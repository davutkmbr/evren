/**
 * City-wall tower perches, picked by rule from the tower candidates of the walls bake (towers.json, written by
 * `npm run compile:walls`: tower tops flat enough to stand on, with the measured top of the tallest building or wall
 * piece around each). Every candidate is validated with the perch rules (rules.ts, with its measured surroundings:
 * the trees around a perch are cleared, clearings.ts), faces the best open view (the one with the most landmarks and
 * sea in its cone), and the passing towers are spread along the walls: the clearest first, none closer than
 * WALL_PERCH.spacing to another. Player-facing names and texts are Turkish.
 */
import type { GeoQuery, PerchPoint } from '../../core/contracts';
import TOWERS from '../landmarks/walls/data/towers.json';
import { PERCH_RULES, validatePerch, viewBlocker, type PerchSurroundings } from './rules';

export const WALL_PERCH = {
  /** Most wall-tower perches offered, and the least distance (m) between two of them. */
  max: 6,
  spacing: 1500,
  /** Landmarks counted in a view cone out to this distance (m); sea samples along it from 150 m to `sea` m. */
  landmarkRange: 6000,
  sea: 3000,
  /** A landmark within this distance (m) names the tower after it; else the nearest gate within `gateRange`. */
  landmarkName: 400,
  gateRange: 1500,
} as const;

type Candidate = [number, number, number, number, number, number, number, number];
/** Named wall gates of the bake (name, x, z) for naming the towers. */
const GATES = (TOWERS.gates as [string, number, number][]).map(([name, x, z]) => ({ name, x, z }));

export interface WallPerch {
  point: PerchPoint;
  surroundings: PerchSurroundings;
}

const DEG = Math.PI / 180;

/** Compass heading (deg) of a direction (x east, z south). */
function headingOf(dx: number, dz: number): number {
  return ((Math.atan2(dx, -dz) / DEG) % 360 + 360) % 360;
}

/** Landmarks and sea inside the view cone of a heading (higher is better). */
function viewScore(geo: GeoQuery, x: number, z: number, heading: number): number {
  let score = 0;
  for (const l of geo.landmarks) {
    const d = Math.hypot(l.x - x, l.z - z);
    if (d < 60 || d > WALL_PERCH.landmarkRange || l.kind === 'walls') {
      continue;
    }
    const off = Math.abs(((headingOf(l.x - x, l.z - z) - heading + 540) % 360) - 180);
    if (off <= PERCH_RULES.viewSpread) {
      score += 1;
    }
  }
  let sea = 0;
  let n = 0;
  for (const b of [-PERCH_RULES.viewSpread, 0, PERCH_RULES.viewSpread]) {
    const h = (heading + b) * DEG;
    for (let d = 150; d <= WALL_PERCH.sea; d += 150) {
      sea += geo.heightAt(x + Math.sin(h) * d, z - Math.cos(h) * d) < 0 ? 1 : 0;
      n++;
    }
  }
  return score + (3 * sea) / n;
}

/**
 * Name and info text: "Sur Kulesi" (or "Deniz Surları" on the shore) and the place: the nearest landmark within
 * landmarkName m, else the nearest named gate within gateRange m, else the district.
 */
function nameOf(geo: GeoQuery, x: number, z: number, seaSide: boolean): { name: string; info: string } {
  let place: string | null = null;
  let best: number = WALL_PERCH.landmarkName;
  for (const l of geo.landmarks) {
    const d = Math.hypot(l.x - x, l.z - z);
    if (l.kind !== 'walls' && d < best) {
      best = d;
      place = l.name;
    }
  }
  if (!place) {
    best = WALL_PERCH.gateRange;
    for (const g of GATES) {
      const d = Math.hypot(g.x - x, g.z - z);
      if (d < best) {
        best = d;
        place = g.name;
      }
    }
  }
  place ??= geo.districtAt(x, z)?.name ?? null;
  const kind = seaSide ? 'Deniz Surları' : 'Sur Kulesi';
  return {
    name: place ? `${kind} · ${place}` : kind,
    info: seaSide
      ? 'Deniz kıyısındaki eski surların bir kulesinin tepesi. Bir yanda dalgaların dövdüğü taşlar, öte yanda şehrin kubbeleri ve tepeleri.'
      : 'Eski surların bir kulesinin tepesi. Kırık mazgalların arasından hendek, bahçeler ve ötede şehrin kubbeleri görünür.',
  };
}

/** The wall-tower perches of the current bake (empty when it has no candidates). */
export function wallTowerPerches(geo: GeoQuery): WallPerch[] {
  const passing: { perch: WallPerch; clear: number }[] = [];
  for (const [src, x, z, y, , ox, oz, neighbourTop] of TOWERS.towers as Candidate[]) {
    const surroundings: PerchSurroundings = { neighbourTop };
    const out = headingOf(ox, oz);
    let best: { heading: number; score: number } | null = null;
    for (const heading of [out, (out + 180) % 360, (out + 90) % 360, (out + 270) % 360]) {
      const probe: PerchPoint = { id: '', name: '', info: '', x, y, z, headingDeg: heading, surface: 'roof', gripRadius: 3 };
      if (viewBlocker(geo, probe, surroundings)) {
        continue;
      }
      const score = viewScore(geo, x, z, heading);
      if (!best || score > best.score) {
        best = { heading, score };
      }
    }
    if (!best) {
      continue;
    }
    const seaSide = geo.coastDistance(x, z) < 120;
    const { name, info } = nameOf(geo, x, z, seaSide);
    const point: PerchPoint = {
      id: `sur-kulesi-${src}-${Math.round(x)}-${Math.round(z)}`,
      name,
      info,
      x,
      y,
      z,
      headingDeg: Math.round(best.heading),
      surface: 'roof',
      gripRadius: 3,
    };
    if (validatePerch(geo, point, surroundings).length === 0) {
      passing.push({ perch: { point, surroundings }, clear: y - neighbourTop });
    }
  }
  passing.sort((a, b) => b.clear - a.clear);
  const picked: WallPerch[] = [];
  for (const c of passing) {
    if (picked.length >= WALL_PERCH.max) {
      break;
    }
    if (picked.every((p) => Math.hypot(p.point.x - c.perch.point.x, p.point.z - c.perch.point.z) >= WALL_PERCH.spacing)) {
      picked.push(c.perch);
    }
  }
  return picked;
}
