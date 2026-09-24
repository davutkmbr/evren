/**
 * Dev tool: numbers of a compiled street output for the S1 strip (npx tsx strip-stats.ts [public/world/<out>]):
 * lights and instances in the spine corridor (<= CORRIDOR m of the cameras.json spine, or in the arrival square),
 * LOD0 triangles by material family (street lane `st_*` + core ground, façade `fac_*`, hero, other) and prop triangles.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ROOT } from '../../../lib/areas.mjs';
import type { IndexManifest, TileManifest } from '../../format';

const CORRIDOR = 15;
const out = resolve(ROOT, process.argv[2] ?? 'public/world/s1-street');
const index = JSON.parse(readFileSync(resolve(out, 'index.json'), 'utf8')) as IndexManifest;
const cams = JSON.parse(readFileSync(resolve(ROOT, 'tools/world-compiler/s1/cameras.json'), 'utf8')) as { strip: { polyline: { position: number[] }[]; arrivalSquare: { polygon: number[][] } } };
const spine = cams.strip.polyline.map((p) => [p.position[0], p.position[2]]);
const square = cams.strip.arrivalSquare.polygon;
const segDist = (x: number, z: number, a: number[], b: number[]): number => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
};
const inSquare = (x: number, z: number): boolean => {
  let c = false;
  for (let i = 0, j = square.length - 1; i < square.length; j = i++) {
    const [xi, zi] = square[i];
    const [xj, zj] = square[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      c = !c;
    }
  }
  return c;
};
const corridor = (x: number, z: number): boolean => inSquare(x, z) || spine.some((p, k) => k > 0 && segDist(x, z, spine[k - 1], p) <= CORRIDOR);

const lights: Record<string, number> = {};
const nightLights: Record<string, number> = {};
const inst: Record<string, number> = {};
const instAll: Record<string, number> = {};
let propTris = 0;
let propTrisLod = 0;
const tris: Record<string, number> = {};
const io = new NodeIO();
for (const ref of index.tiles) {
  const m = JSON.parse(readFileSync(resolve(out, ref.manifest), 'utf8')) as TileManifest;
  for (const l of m.lights ?? []) {
    if (corridor(l.position[0], l.position[2])) {
      lights[`${l.source}:${l.type}`] = (lights[`${l.source}:${l.type}`] ?? 0) + 1;
      if (l.night) {
        nightLights[l.source] = (nightLights[l.source] ?? 0) + 1;
      }
    }
  }
  for (const i of m.instances ?? []) {
    instAll[i.asset] = (instAll[i.asset] ?? 0) + 1;
    const p = index.props?.[i.asset];
    const t = p ? p.triangles / Math.max(1, i.variant ? p.variants.length : 1) : 0;
    propTris += t;
    propTrisLod += p?.lods?.length ? t * (p.lods[0].triangles / p.triangles) : t;
    if (corridor(i.position[0], i.position[2])) {
      inst[i.asset] = (inst[i.asset] ?? 0) + 1;
    }
  }
  const doc = await io.read(resolve(out, ref.glb));
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const name = p.getMaterial()?.getName() ?? '?';
      const fam = name.startsWith('st_') || ['road', 'sidewalk', 'kerb', 'pedestrian', 'quay', 'lot', 'grass'].includes(name) ? 'street+ground' : name.startsWith('fac_') ? 'facade' : name.startsWith('hero_') ? 'hero' : name.startsWith('int_') ? 'interiors' : `other`;
      tris[fam] = (tris[fam] ?? 0) + (p.getIndices()?.getCount() ?? 0) / 3;
    }
  }
}
const sum = (o: Record<string, number>): number => Object.values(o).reduce((a, b) => a + b, 0);
console.log(
  JSON.stringify(
    {
      corridorM: CORRIDOR,
      lightsInCorridor: { total: sum(lights), night: sum(nightLights), byNightSource: nightLights, bySourceType: lights },
      instancesInCorridor: { total: sum(inst), byAsset: inst },
      instancesAll: { total: sum(instAll), people: instAll.st_person ?? 0 },
      lod0TrianglesByFamily: Object.fromEntries(Object.entries(tris).map(([k, v]) => [k, Math.round(v)])),
      propTrianglesAllInstances: { lod0: Math.round(propTris), atFirstLod: Math.round(propTrisLod) },
    },
    null,
    1,
  ),
);
