/**
 * Scene for the overhead-clearance check: the real GeoQuery plus the colliders of real landmark structures (bridges,
 * skyscraper clusters) built in Node by their structures builders, registered in a CollisionWorld exactly as the
 * structure system does it in the game.
 */
import * as THREE from 'three';
import { CollisionWorld, type Collider } from '../../src/core/collision';
import type { GeoQuery } from '../../src/core/contracts';
import { StructureBuild } from '../../src/world/landmarks/structures/build/context';
import { builderFor } from '../../src/world/landmarks/structures/builders/registry';
import { prepareSite } from '../../src/world/landmarks/structures/system/site-planner';
import type { ColliderData, DeckData } from '../../src/world/landmarks/structures/types';

export interface BuiltStructure {
  id: string;
  colliders: Collider[];
  decks: DeckData[];
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

/** Runs the real structures builder of a landmark and returns its colliders and road decks. */
export function buildStructure(geo: GeoQuery, id: string): BuiltStructure {
  const def = geo.landmark(id);
  if (!def) {
    throw new Error(`landmark ${id} missing`);
  }
  const b = new StructureBuild(prepareSite(def, geo));
  builderFor(b.def)(b);
  const r = b.result(0);
  return { id, colliders: r.colliders.map(toCollider), decks: r.decks };
}

/** A CollisionWorld with the geo and the given structures registered. */
export function createWorld(geo: GeoQuery, structures: readonly BuiltStructure[]): CollisionWorld {
  const world = new CollisionWorld();
  world.setGeo(geo);
  for (const s of structures) {
    for (const c of s.colliders) {
      world.add(c, 'structure', s.id);
    }
  }
  return world;
}
