import { createRng } from '../../../core/math/noise';
import { SPECIES_COUNT } from '../species';
import type { SpeciesId } from '../species';
import type { TreeMeshData } from './mesh-builder';
import { buildSpeciesModel } from './models';

export interface SpeciesMeshes {
  species: SpeciesId;
  lod0: TreeMeshData;
  lod1: TreeMeshData;
  /** Bounding sphere around (0, centerY, 0) that encloses every LOD. */
  centerY: number;
  radius: number;
  /** Half size of the tightest square impostor frame (orthographic, any upper-hemisphere view) around centerY. */
  impostorRadius: number;
  minY: number;
  maxY: number;
  triangles: [number, number];
}

const SEEDS = [7121, 3343, 9011, 5527, 1289, 4447];

/**
 * Largest |x| / |y| of the mesh projected orthographically on view planes over the upper hemisphere (hemi-octahedral
 * directions), with billboard cards expanded in the view plane exactly like the bake does.
 */
function projectedHalfExtent(m: TreeMeshData, centerY: number): number {
  const n = 11;
  let best = 0;
  const p = m.position;
  const card = m.card;
  const corner = m.corner;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const fx = (i / (n - 1)) * 2 - 1;
      const fy = (j / (n - 1)) * 2 - 1;
      const px = (fx + fy) * 0.5;
      const pz = (fx - fy) * 0.5;
      let dx = px;
      let dy = 1 - Math.abs(px) - Math.abs(pz);
      let dz = pz;
      const dl = Math.hypot(dx, dy, dz);
      dx /= dl;
      dy /= dl;
      dz /= dl;
      // right = normalize(cross(up, dir)), up' = cross(dir, right) (three.js lookAt basis).
      let rx = dz;
      let ry = 0;
      let rz = -dx;
      if (Math.abs(dy) > 0.999) {
        rx = 1;
        rz = 0;
      }
      const rl = Math.hypot(rx, ry, rz);
      rx /= rl;
      ry /= rl;
      rz /= rl;
      const ux = dy * rz - dz * ry;
      const uy = dz * rx - dx * rz;
      const uz = dx * ry - dy * rx;
      for (let v = 0, q = 0, c = 0; v < p.length; v += 3, q += 4, c += 3) {
        const x = p[v];
        const y = p[v + 1] - centerY;
        const z = p[v + 2];
        let sx = x * rx + y * ry + z * rz;
        let sy = x * ux + y * uy + z * uz;
        const w = card[q + 3];
        if (w > 0) {
          const cx = x + card[q];
          const cy = y + card[q + 1];
          const cz = z + card[q + 2];
          const bx = cx * rx + cy * ry + cz * rz + corner[c];
          const by = cx * ux + cy * uy + cz * uz + corner[c + 1];
          sx += (bx - sx) * w;
          sy += (by - sy) * w;
        }
        best = Math.max(best, Math.abs(sx), Math.abs(sy));
      }
    }
  }
  return best;
}

/** Generates LOD0/LOD1 meshes of one species (deterministic). */
export function generateSpecies(species: SpeciesId): SpeciesMeshes {
  const rng = createRng(SEEDS[species] ?? 17 + species);
  const model = buildSpeciesModel(species, rng);
  const b = model.lod0.bounds();
  const minY = Math.max(b.minY, -0.2);
  const centerY = (minY + b.maxY) * 0.5;
  const radius = Math.max(model.lod0.radiusAround(centerY), model.lod1.radiusAround(centerY)) * 1.02;
  const lod0 = model.lod0.build();
  return {
    species,
    lod0,
    lod1: model.lod1.build(),
    centerY,
    radius,
    impostorRadius: Math.min(projectedHalfExtent(lod0, centerY) * 1.03, radius),
    minY: b.minY,
    maxY: b.maxY,
    triangles: [model.lod0.triangleCount, model.lod1.triangleCount],
  };
}

export function generateAllSpecies(): SpeciesMeshes[] {
  const out: SpeciesMeshes[] = [];
  for (let s = 0; s < SPECIES_COUNT; s++) {
    out.push(generateSpecies(s as SpeciesId));
  }
  return out;
}
