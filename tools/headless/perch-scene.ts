/**
 * Scene for the perch checks and pose sheets (phase 03): the real GeoQuery, the resolved perch service, and the
 * colliders of every landmark a perch sits on (structures builders, the mosque generator) registered in a
 * CollisionWorld the way the landmark systems do it in the game. The world triangles of the most detailed LOD are kept
 * for drawing the structures in the pose sheets.
 */
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CollisionWorld, type Collider } from '../../src/core/collision';
import type { GeoQuery, LandmarkDef, PerchPoint } from '../../src/core/contracts';
import { buildLandmarkModel } from '../../src/world/landmarks/mosques/gen/build';
import { placementFromHeading, placementMatrix } from '../../src/world/landmarks/mosques/system/placement';
import { StructureBuild } from '../../src/world/landmarks/structures/build/context';
import { builderFor } from '../../src/world/landmarks/structures/builders/registry';
import { prepareSite } from '../../src/world/landmarks/structures/system/site-planner';
import type { WallsColliders } from '../../src/world/landmarks/walls/data/baked';
import type { ColliderData } from '../../src/world/landmarks/structures/types';
import type { PerchServiceImpl } from '../../src/world/perches/service';
import { buildPerchService } from '../../src/world/perches/service';
import { buildHeadlessGeo } from './geo';

export interface PerchLandmark {
  id: string;
  colliders: Collider[];
  /** World-space triangle soups (9 floats per triangle). */
  tris: Float32Array[];
}

export interface PerchScene {
  geo: GeoQuery;
  perches: PerchServiceImpl;
  landmarks: Map<string, PerchLandmark>;
  /** A fresh collision world with the geo and every perch landmark's colliders. */
  createWorld(): CollisionWorld;
}

function toCollider(c: ColliderData): Collider {
  if (c.kind === 'box') {
    return { kind: 'box', center: new THREE.Vector3(...c.center), halfSize: new THREE.Vector3(...c.halfSize), yaw: c.yaw };
  }
  if (c.kind === 'cylinder') {
    return { kind: 'cylinder', base: new THREE.Vector3(...c.base), radius: c.radius, height: c.height };
  }
  return { kind: 'sphere', center: new THREE.Vector3(...c.center), radius: c.radius };
}

function trianglesOf(position: Float32Array, index: Uint32Array, m?: THREE.Matrix4): Float32Array {
  const out = new Float32Array(index.length * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < index.length; i++) {
    const k = index[i] * 3;
    v.set(position[k], position[k + 1], position[k + 2]);
    if (m) {
      v.applyMatrix4(m);
    }
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

function buildStructure(def: LandmarkDef, geo: GeoQuery): PerchLandmark {
  const b = new StructureBuild(prepareSite(def, geo));
  builderFor(b.def)(b);
  const r = b.result(0);
  return { id: def.id, colliders: r.colliders.map(toCollider), tris: r.parts.map((p) => trianglesOf(p.lods[0].position, p.lods[0].index)) };
}

/** Mosque generator model and colliders in world space (the mosque system's placement). */
function buildMosque(def: LandmarkDef): PerchLandmark | null {
  const model = buildLandmarkModel(def.id, [0], { height: def.height, radius: def.radius });
  const g = model?.lods[0];
  if (!model || !g) {
    return null;
  }
  const p = placementFromHeading(def.x, def.y, def.z, def.headingDeg);
  const m = placementMatrix(p, new THREE.Matrix4());
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  const w = (lx: number, ly: number, lz: number): THREE.Vector3 => new THREE.Vector3(p.x + lx * c + lz * s, p.y + ly, p.z - lx * s + lz * c);
  const colliders: Collider[] = model.colliders.map((k) =>
    k.kind === 'box'
      ? { kind: 'box', center: w(k.cx, k.cy, k.cz), halfSize: new THREE.Vector3(k.hx, k.hy, k.hz), yaw: p.yaw + k.yaw }
      : k.kind === 'cylinder'
        ? { kind: 'cylinder', base: w(k.x, k.y, k.z), radius: k.r, height: k.h }
        : { kind: 'sphere', center: w(k.x, k.y, k.z), radius: k.r },
  );
  return { id: def.id, colliders, tris: [trianglesOf(g.position, g.index, m)] };
}

/** Range (m) around a perch within which the city-wall colliders of the bake join the scene. */
const WALLS_RANGE = 400;

/**
 * City-wall box colliders near the perches, from the walls bake (public/world/walls/colliders.json, `npm run
 * compile:walls`), as the walls system registers them. Empty (with a note) when the bake is missing.
 */
function wallColliders(points: readonly PerchPoint[]): Collider[] {
  const file = new URL('../../public/world/walls/colliders.json', import.meta.url);
  if (!existsSync(file)) {
    if (points.some((p) => p.id.startsWith('sur-kulesi-'))) {
      console.warn('perch scene: no walls bake (npm run compile:walls): wall-tower perches are checked without their towers');
    }
    return [];
  }
  const data = JSON.parse(readFileSync(file, 'utf8')) as WallsColliders;
  const out: Collider[] = [];
  const b = data.boxes;
  for (let k = 0; k < b.length; k += 8) {
    if (points.some((p) => Math.hypot(p.x - b[k], p.z - b[k + 2]) < WALLS_RANGE)) {
      out.push({ kind: 'box', center: new THREE.Vector3(b[k], b[k + 1], b[k + 2]), halfSize: new THREE.Vector3(b[k + 3], b[k + 4], b[k + 5]), yaw: b[k + 6] });
    }
  }
  return out;
}

export function buildPerchScene(): PerchScene {
  const geo = buildHeadlessGeo();
  const perches = buildPerchService(geo);
  const walls = wallColliders(perches.points);
  const landmarks = new Map<string, PerchLandmark>();
  for (const p of perches.points) {
    const def = p.landmarkId ? geo.landmark(p.landmarkId) : undefined;
    if (!def || landmarks.has(def.id)) {
      continue;
    }
    const built = def.builder === 'structures' ? buildStructure(def, geo) : def.builder === 'mosques' ? buildMosque(def) : null;
    if (built) {
      landmarks.set(def.id, built);
    }
  }
  return {
    geo,
    perches,
    landmarks,
    createWorld() {
      const world = new CollisionWorld();
      world.setGeo(geo);
      for (const l of landmarks.values()) {
        for (const c of l.colliders) {
          world.add(c, 'structure', l.id);
        }
      }
      for (const c of walls) {
        world.add(c, 'heritage', 'city-wall');
      }
      return world;
    },
  };
}

/** Triangles of the landmark a perch sits on (empty for hills and unbuilt structures). */
export function perchTriangles(scene: PerchScene, p: PerchPoint): Float32Array[] {
  return p.landmarkId ? (scene.landmarks.get(p.landmarkId)?.tris ?? []) : [];
}
