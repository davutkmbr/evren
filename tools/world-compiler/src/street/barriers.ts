/**
 * Iron railings along OSM `barrier=fence` lines (format 1, street tiles of districts whose profile sets
 * `street.barriers`): posts every POST_M, top, middle and bottom rails and square balusters, standing on the compiled
 * ground. Each piece belongs to the tile of its midpoint, so a railing runs on across tile borders.
 */
import { district } from '../district';
import { LOD0, LOD1, type Vec3 } from '../mesh';
import type { CompileStep, TileContext } from '../registry';
import { inTile, streetTile } from './common';
import { placementRules } from './placement';
import { beam } from './shapes';

const HEIGHT = 1.05;
const POST_M = 2.4;
const POST = 0.07;
const RAIL = 0.045;
const BALUSTER_M = 0.16;
const BALUSTER = 0.022;

function emitRailing(t: TileContext, pts: readonly number[]): number {
  const h = t.area.heights;
  const rules = placementRules(t.area);
  let pieces = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const az = pts[i + 1];
    const bx = pts[i + 2];
    const bz = pts[i + 3];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / POST_M));
    for (let k = 0; k < n; k++) {
      const x0 = ax + ((bx - ax) * k) / n;
      const z0 = az + ((bz - az) * k) / n;
      const x1 = ax + ((bx - ax) * (k + 1)) / n;
      const z1 = az + ((bz - az) * (k + 1)) / n;
      if (!inTile(t, (x0 + x1) / 2, (z0 + z1) / 2)) {
        continue;
      }
      // Rule railing: a piece whose ends or middle stand on a vehicular carriageway, its gutter or a tram track bed, in a building or
      // across a door's approach is dropped (railings run along kerbs and plots, never across the road or a door).
      const blocked = [0, 0.5, 1].some((f) => {
        const x = x0 + (x1 - x0) * f;
        const z = z0 + (z1 - z0) * f;
        const surf = rules.surface(x, z);
        return surf === 'carriageway' || surf === 'gutter' || surf === 'track' || surf === 'building' || surf === 'water' || rules.doorBlocked(x, z);
      });
      rules.log.note('railing', blocked ? 'dropped' : 'kept');
      if (blocked) {
        continue;
      }
      pieces++;
      const y0 = h.at(x0, z0);
      const y1 = h.at(x1, z1);
      const p0: Vec3 = [x0, y0, z0];
      t.mesh.withLod(LOD0 | LOD1, () => {
        beam(t.mesh, 'st_iron', p0, [x0, y0 + HEIGHT + 0.03, z0], POST, POST);
        if (k === n - 1) {
          beam(t.mesh, 'st_iron', [x1, y1, z1], [x1, y1 + HEIGHT + 0.03, z1], POST, POST);
        }
        for (const ry of [HEIGHT, HEIGHT * 0.52]) {
          beam(t.mesh, 'st_iron', [x0, y0 + ry, z0], [x1, y1 + ry, z1], RAIL, RAIL);
        }
      });
      t.mesh.withLod(LOD0, () => {
        beam(t.mesh, 'st_iron', [x0, y0 + 0.12, z0], [x1, y1 + 0.12, z1], RAIL, RAIL);
        const seg = Math.hypot(x1 - x0, z1 - z0);
        const m = Math.floor(seg / BALUSTER_M);
        for (let j = 1; j < m; j++) {
          const f = j / m;
          const x = x0 + (x1 - x0) * f;
          const z = z0 + (z1 - z0) * f;
          const y = y0 + (y1 - y0) * f;
          beam(t.mesh, 'st_iron', [x, y + 0.12, z], [x, y + HEIGHT, z], BALUSTER, BALUSTER);
        }
      });
    }
  }
  return pieces;
}

export const streetBarriersStep: CompileStep = {
  id: 'streetBarriers',
  tile(t) {
    if (!district().street.barriers || !streetTile(t)) {
      return;
    }
    let pieces = 0;
    for (const line of t.area.data.lines) {
      if (line.kind === 'barrier=fence') {
        pieces += emitRailing(t, line.pts);
      }
    }
    if (pieces) {
      t.record('streetBarriers', { railingPieces: pieces });
    }
  },
};
