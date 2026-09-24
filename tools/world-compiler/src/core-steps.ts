/**
 * The format 0 compile steps, kept as registry entries so lanes can put their own steps before, after or instead of
 * them: the ground of every tile (ground.ts) and the greybox blocks with door recesses (buildings.ts).
 *
 * In format 1 the blocks of full-detail tiles are split by LOD: LOD0 gets the blocks with their door recesses, LOD1
 * the same blocks collapsed to plain walls and a flat roof (emitBlock). Greybox tiles keep one mesh for every LOD.
 */
import * as THREE from 'three';
import { emitSolid, type Solid } from './buildings';
import { buildGround, type GroundStats } from './ground';
import { LOD0, LOD1, type TileMesh, type Vec3 } from './mesh';
import type { CompileStep } from './registry';

export interface GroundTotals {
  kerbWallM: number;
  quayWallM: number;
  kerbStepM: number[];
}

export const groundStep: CompileStep = {
  id: 'ground',
  formats: [0, 1],
  prepare(a) {
    a.shared.set('ground', { kerbWallM: 0, quayWallM: 0, kerbStepM: [0, 0, 0, 0] } satisfies GroundTotals);
  },
  tile(t) {
    const a = t.area;
    const g: GroundStats = buildGround(t.bounds, a.foundation, a.heights, a.land, t.mesh, a.format === 1 ? (x, z) => a.cover.id(x, z) : undefined);
    const totals = a.shared.get('ground') as GroundTotals;
    totals.kerbWallM += g.kerbWallM;
    totals.quayWallM += g.quayWallM;
    g.kerbStepM.forEach((v, k) => (totals.kerbStepM[k] += v));
  },
};

export const buildingsStep: CompileStep = {
  id: 'buildings',
  formats: [0, 1],
  tile(t) {
    const split = t.area.format === 1 && t.detail === 'full';
    for (const s of t.solids) {
      if (split) {
        t.mesh.withLod(LOD0, () => emitSolid(s, t.mesh));
        t.mesh.withLod(LOD1, () => emitBlock(s, t.mesh));
      } else {
        emitSolid(s, t.mesh);
      }
    }
  },
};

/** A solid as a plain block: full-height walls, flat roof, underside for raised parts (no door recesses). */
export function emitBlock(s: Solid, mesh: TileMesh, wall = 'wall', roof = 'roof'): void {
  const { bottomY, topY } = s.rec;
  for (const ring of [s.ring, ...s.holes]) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = ring[i * 2];
      const az = ring[i * 2 + 1];
      const bx = ring[((i + 1) % n) * 2];
      const bz = ring[((i + 1) % n) * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) {
        continue;
      }
      // Positive-area ring: the outward normal is the right-hand side (dz, -dx).
      const nrm: Vec3 = [(bz - az) / len, 0, -(bx - ax) / len];
      mesh.wall(wall, ax, az, bx, bz, bottomY, topY, bottomY, topY, nrm);
    }
  }
  const pairs = (r: readonly number[]): THREE.Vector2[] => {
    const out: THREE.Vector2[] = [];
    for (let k = 0; k < r.length; k += 2) {
      out.push(new THREE.Vector2(r[k], r[k + 1]));
    }
    return out;
  };
  const contour = pairs(s.ring);
  const holes = s.holes.map(pairs);
  const tris = THREE.ShapeUtils.triangulateShape(contour, holes).flat();
  const flat = [...contour, ...holes.flat()];
  mesh.flatTriangles(
    roof,
    flat.map((v) => [v.x, topY, v.y] as Vec3),
    tris,
    [0, 1, 0],
  );
  if (!s.grounded) {
    mesh.flatTriangles(
      wall,
      flat.map((v) => [v.x, bottomY, v.y] as Vec3),
      tris,
      [0, -1, 0],
    );
  }
}
