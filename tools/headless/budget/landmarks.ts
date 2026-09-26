/**
 * Landmark probes: the real generators of the mosques, structures and heritage modules (the code their workers run)
 * and each system's LOD rules. BatchedMesh draws count as one multi-draw per pass with per-object frustum culling
 * (as three.js does it); plain meshes count one draw each after frustum culling.
 */
import * as THREE from 'three';
import { buildLandmarkModel, buildNeighborhoodModels } from '../../../src/world/landmarks/mosques/gen/build';
import type { BuiltModel, GeomData } from '../../../src/world/landmarks/mosques/gen/types';
import { lodDistances } from '../../../src/world/landmarks/mosques/system/mosque-system';
import { chooseVariant, placementFromHeading, type Placement } from '../../../src/world/landmarks/mosques/system/placement';
import { StructureBuild } from '../../../src/world/landmarks/structures/build/context';
import { builderFor } from '../../../src/world/landmarks/structures/builders/registry';
import { prepareSite } from '../../../src/world/landmarks/structures/system/site-planner';
import { lodFor } from '../../../src/world/landmarks/structures/render/batches';
import { BatchKind, LIGHT_STRIDE, WIRE_STRIDE, type PartData } from '../../../src/world/landmarks/structures/types';
import { SITE_BUILDERS } from '../../../src/world/landmarks/heritage/build/registry';
import { makeJob } from '../../../src/world/landmarks/heritage/jobs';
import { buildSite } from '../../../src/world/landmarks/heritage/worker/build-site';
import type { ChunkResult } from '../../../src/world/landmarks/heritage/protocol';
import { cascadeSplits, cascadesFor, emptyView, frusta, MB, probeCamera, timeMedian, type ModuleReport, type ModuleViewReport, type ProbeContext } from './common';

const _s = new THREE.Sphere();
const _v = new THREE.Vector3();

function tris(g: GeomData | null | undefined): number {
  return g ? g.index.length / 3 : 0;
}

function geomBytes(g: GeomData | null | undefined): number {
  return g ? g.position.byteLength + g.normal.byteLength + g.uv.byteLength + g.tint.byteLength + g.data.byteLength + g.index.byteLength : 0;
}

function sphereOf(g: GeomData, p: Placement): THREE.Sphere {
  const b = g.bounds;
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  const k = p.scale;
  return new THREE.Sphere(new THREE.Vector3(p.x + (b[6] * c + b[8] * s) * k, p.y + b[7] * k, p.z + (-b[6] * s + b[8] * c) * k), b[9] * k);
}

/** Adds one BatchedMesh instance (main / shadow / other geometry triangles) to a view report. */
function addBatched(r: ModuleViewReport, sphere: THREE.Sphere, main: number, shadow: number, other: number, f: ReturnType<typeof frusta>, splits: number[], cam: THREE.PerspectiveCamera, casts: boolean[]): void {
  if (main > 0 && f.main.intersectsSphere(sphere)) {
    r.main.tris += main;
  }
  if (other > 0 && f.mirror.intersectsSphere(sphere)) {
    r.reflection.tris += other;
  }
  if (shadow > 0) {
    for (let i = 0; i + 1 < splits.length; i++) {
      const n = cascadesFor([splits[i], splits[i + 1]], f.main, cam, sphere.center, sphere.radius);
      if (n > 0) {
        r.shadow.tris += shadow;
        casts[i] = true;
      }
    }
  }
}

export function probeMosques(pc: ProbeContext): ModuleReport {
  const geo = pc.geo;
  const D = lodDistances(pc.quality);
  const t0 = performance.now();
  const defs = geo.landmarks.filter((l) => l.builder === 'mosques');
  const landmarks = defs
    .map((def) => {
      const model = buildLandmarkModel(def.id, [0, 1, 2], { height: def.height, radius: def.radius });
      if (!model || !model.lods[1] || !model.lods[2]) {
        return null;
      }
      const placement = placementFromHeading(def.x, def.y, def.z, def.headingDeg);
      return { def, model, placement, sphere: sphereOf(model.lods[1], placement) };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  const small: BuiltModel[] = buildNeighborhoodModels();
  const footprints = small.map((m) => m.footprint ?? m.radius);
  const pitched = small.map((m) => !!m.pitched);
  const sites = geo.smallMosqueSites.map((site) => {
    const choice = chooseVariant(site, footprints, pitched, geo);
    const placement = placementFromHeading(site.x, site.y, site.z, site.headingDeg, choice.scale);
    return { variant: choice.variant, sphere: sphereOf(small[choice.variant].lods[0]!, placement) };
  });
  const genMs = performance.now() - t0;
  let batchBytes = 0;
  for (const e of landmarks) {
    batchBytes += geomBytes(e.model.lods[1]) + geomBytes(e.model.lods[2]);
  }
  for (const m of small) {
    m.lods.forEach((g) => (batchBytes += geomBytes(g)));
  }
  const report: ModuleReport = {
    module: 'mosques',
    materials: 1,
    textureMB: 0,
    geometryMB: batchBytes / MB,
    views: {},
    notes: [
      `${landmarks.length} landmark mosques, ${sites.length} neighbourhood sites, ${small.length} prototypes (generated in ${(genMs / 1000).toFixed(1)} s)`,
      `LOD distances: landmark LOD0 < ${D.landmark0.toFixed(0)} m (own mesh), LOD1 < ${D.landmark1} m; small LOD0 < ${D.small0.toFixed(0)}, LOD1 < ${D.small1.toFixed(0)}, LOD2 < ${D.small2.toFixed(0)} m`,
      `landmark triangles LOD0/1/2 (largest): ${landmarks
        .map((e) => [tris(e.model.lods[0]), tris(e.model.lods[1]), tris(e.model.lods[2]), e.def.id] as const)
        .sort((a, b) => b[0] - a[0])
        .slice(0, 3)
        .map((t) => `${t[3]} ${t[0]}/${t[1]}/${t[2]}`)
        .join(', ')}`,
      `small prototype triangles LOD0/1/2: ${small.map((m) => m.lods.map(tris).join('/')).join(', ')}`,
    ],
  };
  for (const v of pc.views) {
    const cam = probeCamera(v);
    const f = frusta(cam);
    const splits = cascadeSplits(pc.quality, cam.position.y);
    const r = emptyView();
    const casts = [false, false, false, false];
    let lod0Meshes = 0;
    const lodMix = [0, 0, 0, 0];
    const split = { landmarkMain: 0, small1Main: 0, small2Main: 0 };
    const select = (): void => {
      for (const e of landmarks) {
        const d = Math.max(0, cam.position.distanceTo(e.sphere.center) - e.sphere.radius);
        if (d < D.landmark0) {
          lod0Meshes++;
          const lod0 = tris(e.model.lods[0]);
          const g1 = tris(e.model.lods[1]);
          if (f.main.intersectsSphere(e.sphere)) {
            r.main.tris += lod0;
            r.main.draws++;
          }
          const castsLod0 = d < D.landmarkShadow0;
          if (castsLod0) {
            const n = cascadesFor(splits, f.main, cam, e.sphere.center, e.sphere.radius);
            r.shadow.tris += lod0 * n;
            r.shadow.draws += n;
          }
          addBatched(r, e.sphere, 0, castsLod0 ? 0 : g1, g1, f, splits, cam, casts);
          continue;
        }
        const near = d < D.landmark0 * 1.5;
        const m0 = r.main.tris;
        const after = (): void => {
          split.landmarkMain += r.main.tris - m0;
        };
        if (d < D.landmark1) {
          const g1 = tris(e.model.lods[1]);
          const g2 = tris(e.model.lods[2]);
          addBatched(r, e.sphere, g1, near ? g1 : g2, near ? g1 : g2, f, splits, cam, casts);
        } else {
          const g2 = tris(e.model.lods[2]);
          addBatched(r, e.sphere, g2, g2, g2, f, splits, cam, casts);
        }
        after();
      }
      const shadow0 = D.landmarkShadow0 * 0.6;
      for (const s of sites) {
        const d = Math.max(0, cam.position.distanceTo(s.sphere.center) - s.sphere.radius);
        const g = small[s.variant].lods.map(tris);
        if (d < D.small0) {
          lodMix[0]++;
          addBatched(r, s.sphere, g[0], d < shadow0 ? g[0] : g[1], g[1], f, splits, cam, casts);
        } else if (d < D.small1) {
          lodMix[1]++;
          const m0 = r.main.tris;
          addBatched(r, s.sphere, g[1], g[2], g[2], f, splits, cam, casts);
          split.small1Main += r.main.tris - m0;
        } else if (d < D.small2) {
          lodMix[2]++;
          const m0 = r.main.tris;
          addBatched(r, s.sphere, g[2], g[2], 0, f, splits, cam, casts);
          split.small2Main += r.main.tris - m0;
        } else {
          lodMix[3]++;
        }
      }
    };
    select();
    r.main.draws += r.main.tris > 0 ? 1 : 0;
    r.reflection.draws += r.reflection.tris > 0 ? 1 : 0;
    r.shadow.draws += casts.filter(Boolean).length;
    // CPU: the per-frame LOD pass of MosqueSystem.updateLods (distance per instance + setInstanceLods early-out).
    const centers = [...landmarks.map((e) => e.sphere), ...sites.map((s) => s.sphere)];
    r.cpuMs = timeMedian(() => {
      let acc = 0;
      for (const sp of centers) {
        acc += Math.max(0, cam.position.distanceTo(sp.center) - sp.radius) < D.small0 ? 1 : 0;
      }
      _v.x = acc;
    }, 25);
    r.detail = { landmarkLod0: lod0Meshes, smallLod0: lodMix[0], smallLod1: lodMix[1], smallLod2: lodMix[2], hidden: lodMix[3], ...split };
    report.views[v.id] = r;
  }
  return report;
}

export function probeStructures(pc: ProbeContext): ModuleReport {
  const geo = pc.geo;
  const t0 = performance.now();
  const parts: PartData[] = [];
  let wires = 0;
  let lights = 0;
  let bytes = 0;
  const failures: string[] = [];
  for (const def of geo.landmarks.filter((l) => l.builder === 'structures')) {
    try {
      const b = new StructureBuild(prepareSite(def, geo));
      builderFor(b.def)(b);
      const res = b.result(0);
      parts.push(...res.parts);
      wires += res.wires.length / WIRE_STRIDE;
      lights += res.lights.length / LIGHT_STRIDE;
    } catch (err) {
      failures.push(`${def.id}: ${(err as Error).message}`);
    }
  }
  for (const p of parts) {
    for (const g of p.lods) {
      bytes += g.position.byteLength + g.normal.byteLength + g.uv.byteLength + g.color.byteLength + g.surf.byteLength + g.emit.byteLength + g.index.byteLength;
    }
  }
  const genMs = performance.now() - t0;
  const detail = pc.quality.landmarkDetailDistance;
  const report: ModuleReport = {
    module: 'structures',
    // Opaque + glass batches, wire depth + colour, light sprites.
    materials: 4,
    textureMB: 0,
    geometryMB: bytes / MB,
    views: {},
    notes: [
      `${parts.length} parts (${parts.filter((p) => p.batch === BatchKind.Glass).length} glass), ${wires} wire segments, ${lights} light sprites (generated in ${(genMs / 1000).toFixed(1)} s)`,
      'wires: 2 draws (depth + colour), frustumCulled off, drawn in the reflection too; lights: 1 draw',
      ...failures.map((f) => `build failed: ${f}`),
    ],
  };
  const sphere = new THREE.Sphere();
  for (const v of pc.views) {
    const cam = probeCamera(v);
    const f = frusta(cam);
    const splits = cascadeSplits(pc.quality, cam.position.y);
    const r = emptyView();
    const castsOpaque = [false, false, false, false];
    const castsGlass = [false, false, false, false];
    const inMain = [false, false];
    const inMirror = [false, false];
    const lodMix = [0, 0, 0, 0, 0];
    let hidden = 0;
    const lods: number[] = new Array(parts.length).fill(-1);
    const update = (): void => {
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const d = Math.max(Math.hypot(cam.position.x - p.center[0], cam.position.y - p.center[1], cam.position.z - p.center[2]) - p.radius, 0);
        lods[i] = d <= p.cullDistance ? lodFor(d, detail * p.detailScale, p.lods.length) : -1;
      }
    };
    update();
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const lod = lods[i];
      if (lod < 0) {
        hidden++;
        continue;
      }
      lodMix[Math.min(lod, 4)]++;
      const t = p.lods[lod].index.length / 3;
      sphere.center.set(p.center[0], p.center[1], p.center[2]);
      sphere.radius = p.radius;
      const k = p.batch === BatchKind.Glass ? 1 : 0;
      const before = r.main.tris;
      const beforeR = r.reflection.tris;
      addBatched(r, sphere, t, t, t, f, splits, cam, k ? castsGlass : castsOpaque);
      inMain[k] ||= r.main.tris > before;
      inMirror[k] ||= r.reflection.tris > beforeR;
    }
    r.main.tris += wires * 2 * 2 + lights * 2;
    r.main.draws = inMain.filter(Boolean).length + (wires > 0 ? 2 : 0) + (lights > 0 ? 1 : 0);
    r.reflection.tris += wires * 2 * 2 + lights * 2;
    r.reflection.draws = inMirror.filter(Boolean).length + (wires > 0 ? 2 : 0) + (lights > 0 ? 1 : 0);
    r.shadow.draws = castsOpaque.filter(Boolean).length + castsGlass.filter(Boolean).length;
    r.cpuMs = timeMedian(update, 25);
    r.detail = { lod0: lodMix[0], lod1: lodMix[1], lod2: lodMix[2], lod3: lodMix[3] + lodMix[4], culled: hidden };
    report.views[v.id] = r;
  }
  return report;
}

export function probeHeritage(pc: ProbeContext): ModuleReport {
  const geo = pc.geo;
  const t0 = performance.now();
  const chunks: { site: string; box: THREE.Box3; tris: number[]; spheres: THREE.Sphere[] }[] = [];
  let bytes = 0;
  const errors: string[] = [];
  for (const l of geo.landmarks.filter((d) => d.builder === 'heritage' && SITE_BUILDERS[d.id])) {
    const res = buildSite(makeJob(geo, l, 2));
    if (res.error) {
      errors.push(`${l.id}: ${res.error}`);
    }
    for (const c of res.chunks as ChunkResult[]) {
      const box = new THREE.Box3();
      const spheres: THREE.Sphere[] = [];
      c.lods.forEach((d, i) => {
        const b = new THREE.Box3(new THREE.Vector3(...d.min), new THREE.Vector3(...d.max)).translate(_v.set(c.originX, 0, c.originZ));
        if (i === 0) {
          box.copy(b);
        }
        spheres.push(b.getBoundingSphere(new THREE.Sphere()));
        bytes += d.positions.byteLength + d.normals.byteLength + d.uvs.byteLength + d.colors.byteLength + d.surf.byteLength + d.index.byteLength;
      });
      chunks.push({ site: l.id, box, tris: c.lods.map((d) => d.triangleCount), spheres });
    }
  }
  const genMs = performance.now() - t0;
  const d0 = pc.quality.landmarkDetailDistance;
  const report: ModuleReport = {
    module: 'heritage',
    materials: 1,
    textureMB: 0,
    geometryMB: bytes / MB,
    views: {},
    notes: [`${chunks.length} chunks in ${new Set(chunks.map((c) => c.site)).size} sites (generated in ${(genMs / 1000).toFixed(1)} s)`, ...errors.map((e) => `build error: ${e}`)],
  };
  for (const v of pc.views) {
    const cam = probeCamera(v);
    const f = frusta(cam);
    const splits = cascadeSplits(pc.quality, cam.position.y);
    const r = emptyView();
    const levels = chunks.map((c) => Math.min(c.box.distanceToPoint(cam.position) > d0 ? 1 : 0, c.tris.length - 1));
    let lod0 = 0;
    chunks.forEach((c, i) => {
      const lvl = levels[i];
      lod0 += lvl === 0 ? 1 : 0;
      const t = c.tris[lvl];
      _s.copy(c.spheres[lvl]);
      if (f.main.intersectsSphere(_s)) {
        r.main.tris += t;
        r.main.draws++;
      }
      if (f.mirror.intersectsSphere(_s)) {
        r.reflection.tris += t;
        r.reflection.draws++;
      }
      const n = cascadesFor(splits, f.main, cam, _s.center, _s.radius);
      r.shadow.tris += t * n;
      r.shadow.draws += n;
    });
    r.cpuMs = timeMedian(() => {
      for (const c of chunks) {
        _v.x = c.box.distanceToPoint(cam.position);
      }
    }, 25);
    r.detail = { chunks: chunks.length, lod0 };
    report.views[v.id] = r;
  }
  return report;
}
