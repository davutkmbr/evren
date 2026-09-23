/**
 * Generator entry points (worker-safe, no three.js): landmark models and neighbourhood mosque prototypes.
 */
import { MeshBuilder } from './builder';
import { genericLandmarkSpec, LANDMARK_SPECS, type MosqueSpec } from './specs';
import { buildByzantine } from './styles/byzantine';
import { buildImperial, type StyleResult } from './styles/imperial';
import { buildNeighborhood, NEIGHBORHOOD_VARIANTS } from './styles/neighborhood';
import type { BuiltModel, GeomData, LodLevel } from './types';

function buildSpec(b: MeshBuilder, spec: MosqueSpec, lod: LodLevel): StyleResult {
  return spec.style === 'byzantine' ? buildByzantine(b, spec, lod) : buildImperial(b, spec, lod);
}

/** Adds axis-aligned bounds and a bounding sphere to finished geometry. */
export function withBounds(g: Omit<GeomData, 'bounds'>): GeomData {
  const p = g.position;
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i];
    const y = p[i + 1];
    const z = p[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  if (p.length === 0) {
    x0 = y0 = z0 = x1 = y1 = z1 = 0;
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const cz = (z0 + z1) / 2;
  let r2 = 0;
  for (let i = 0; i < p.length; i += 3) {
    const d = (p[i] - cx) ** 2 + (p[i + 1] - cy) ** 2 + (p[i + 2] - cz) ** 2;
    if (d > r2) r2 = d;
  }
  return { ...g, bounds: [x0, y0, z0, x1, y1, z1, cx, cy, cz, Math.sqrt(r2)] };
}

export function hasLandmarkSpec(id: string): boolean {
  return id in LANDMARK_SPECS;
}

/**
 * Builds the requested LODs of a landmark mosque in its own frame (-Z = qibla, origin on the floor at the complex
 * centre). Colliders do not depend on the LOD, they come from the first level built.
 */
export function buildLandmarkModel(id: string, levels: readonly LodLevel[], fallback?: { height: number; radius: number }): BuiltModel | null {
  const spec = LANDMARK_SPECS[id] ?? (fallback ? genericLandmarkSpec(fallback.height, fallback.radius) : undefined);
  if (!spec) {
    return null;
  }
  const lods: (GeomData | null)[] = [null, null, null];
  let info: StyleResult | null = null;
  for (const lod of levels) {
    const b = new MeshBuilder(lod === 0 ? 1 << 17 : 1 << 14);
    const r = buildSpec(b, spec, lod);
    info ??= r;
    lods[lod] = withBounds(b.build());
  }
  if (!info) {
    return null;
  }
  return { id, lods, colliders: info.colliders, radius: info.radius, height: info.height };
}

/** Builds every LOD of all neighbourhood mosque prototypes (variant index = array index). */
export function buildNeighborhoodModels(): BuiltModel[] {
  return NEIGHBORHOOD_VARIANTS.map((v, i) => {
    const lods: (GeomData | null)[] = [];
    let info: StyleResult | null = null;
    for (const lod of [0, 1, 2] as const) {
      const b = new MeshBuilder(lod === 0 ? 1 << 14 : 1 << 11);
      const r = buildNeighborhood(b, v, lod);
      info ??= r;
      lods.push(withBounds(b.build()));
    }
    return { id: `small-${i}`, lods, colliders: info!.colliders, radius: info!.radius, height: info!.height, footprint: v.footprint, pitched: v.style === 'pitched' };
  });
}

