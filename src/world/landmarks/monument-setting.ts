/**
 * Monument settings: the surroundings of a historic mosque keep low buildings, as the conservation plans of the historic
 * peninsula require (1st degree sites: H 9.50 m; the külliye silhouette and its terraces stay open). The rule only
 * touches buildings whose height OSM does not know (no height, no building:levels); tagged heights are kept.
 *
 * - Within SETTING.radius of a historic mosque (a modelled mosque built before SETTING.maxYear), an untagged building
 *   rises at most SETTING.maxHeight above its lowest ground.
 * - A building standing below the mosque's platform stays under the platform (SETTING.below), so the terraces keep their
 *   view over the roofs downhill (Süleymaniye over the Golden Horn); at least SETTING.minHeight.
 *
 * One rule for every layer: the flight layer and the city bake (buildings/build.ts planSolid) and the street compiler
 * (tools/world-compiler facade plans) all read the sites from the landmark claims. Worker-safe, pure.
 */
import type { LandmarkDef } from '../../core/contracts';

export const SETTING = {
  /** Distance (m) from the mosque's centre within which the setting applies. */
  radius: 250,
  /** Highest untagged building (m above its lowest ground) in a setting: the 1st degree site limit. */
  maxHeight: 9.5,
  /** A building below the platform keeps its top this far (m) under it. */
  below: 0.5,
  /** Never lower than one storey (m). */
  minHeight: 3.2,
  /** Mosques built up to this year are historic monuments with a protected setting (Çamlıca, Taksim are not). */
  maxYear: 1900,
} as const;

/** x, z, radius, platform y per site. */
export const SETTING_STRIDE = 4;

/** Setting sites of the given landmarks (only modelled mosques; `modelled` from claims.ts isModelled). */
export function settingSites(landmarks: readonly LandmarkDef[], modelled: (l: LandmarkDef) => boolean): Float32Array {
  const out: number[] = [];
  for (const l of landmarks) {
    if (l.kind === 'mosque' && l.builder === 'mosques' && (l.year ?? 0) <= SETTING.maxYear && modelled(l)) {
      out.push(l.x, l.z, SETTING.radius, l.y);
    }
  }
  return new Float32Array(out);
}

/**
 * Highest absolute top (m) an untagged building at (cx, cz) with lowest ground `groundMin` may reach, or Infinity
 * outside every setting. `platformAt` overrides a site's platform height (the street compiler samples its own ground).
 */
export function settingTop(sites: ArrayLike<number> | undefined, cx: number, cz: number, groundMin: number, platformAt?: (k: number) => number): number {
  let top = Infinity;
  if (!sites) {
    return top;
  }
  for (let k = 0; k < sites.length; k += SETTING_STRIDE) {
    const dx = cx - sites[k];
    const dz = cz - sites[k + 1];
    if (dx * dx + dz * dz > sites[k + 2] * sites[k + 2]) {
      continue;
    }
    let t = groundMin + SETTING.maxHeight;
    const platform = (platformAt ? platformAt(k) : sites[k + 3]) - SETTING.below;
    if (groundMin < platform) {
      t = Math.min(t, platform);
    }
    top = Math.min(top, Math.max(groundMin + SETTING.minHeight, t));
  }
  return top;
}
