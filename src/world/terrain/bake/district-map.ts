import * as THREE from 'three';
import type { DistrictStyle, GeoQuery } from '../../../core/contracts';
import { DISTRICT_TEX_SIZE, WORLD_HALF } from '../config';

/** Style codes stored in the district map (G channel = code * 32). Must match the GLSL constants in surface GLSL. */
export const STYLE_CODES: Record<DistrictStyle, number> = {
  historic: 0,
  dense: 1,
  modern: 2,
  highrise: 3,
  villa: 4,
  yali: 5,
  industrial: 6,
  suburban: 7,
};

const ROWS_PER_SLICE = 24;

/**
 * District raster (DISTRICT_TEX_SIZE² RGBA8 over the world): R = building density, G = style code · 32,
 * B = typical floor count · 10, A = 255 where a district exists. Filled in time slices from GeoQuery lookups.
 */
export async function bakeDistrictMap(geo: GeoQuery): Promise<THREE.DataTexture> {
  const n = DISTRICT_TEX_SIZE;
  const cell = (WORLD_HALF * 2) / n;
  const data = new Uint8Array(n * n * 4);
  for (let r0 = 0; r0 < n; r0 += ROWS_PER_SLICE) {
    const r1 = Math.min(n, r0 + ROWS_PER_SLICE);
    for (let r = r0; r < r1; r++) {
      const z = -WORLD_HALF + (r + 0.5) * cell;
      for (let c = 0; c < n; c++) {
        const x = -WORLD_HALF + (c + 0.5) * cell;
        const k = (r * n + c) * 4;
        data[k] = Math.round(geo.densityAt(x, z) * 255);
        const d = geo.districtAt(x, z);
        if (d) {
          data[k + 1] = STYLE_CODES[d.style] * 32;
          data[k + 2] = Math.min(255, Math.round(d.floorsMean * 10));
          data[k + 3] = 255;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = 'terrain-districts';
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
