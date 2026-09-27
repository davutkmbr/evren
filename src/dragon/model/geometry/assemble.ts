import type * as THREE from 'three';
import type { RigSkeleton } from '../skeleton';
import { MeshBuilder } from './buffers';
import { BodySurface } from './body';
import { buildFrillMembranes, buildHead, buildRictus } from './head';
import { buildWings } from './wings';
import { buildLegs } from './legs';
import { buildDorsalSpikes, buildTailSpade } from './spikes';
import { buildRider } from './rider';
import { buildTack } from './tack';

export interface DragonGeometryOptions {
  /** The procedural rider mesh (off when another rider character replaces it). */
  proceduralRider: boolean;
  /** Reins as simulated free spans (the human rider) instead of fixed geometry. */
  dynamicReins: boolean;
}

/**
 * The dragon's skinned geometry for a skeleton built from buildBoneSpecs(): body, wing membranes, rider and tack. The
 * skin indices follow the bone order of the specs, so every skeleton built from them can share these geometries
 * (the local rig builds its own; remote dragons share one set, src/dragon/remote/kit.ts).
 */
export function buildDragonGeometry(skel: RigSkeleton, opts: DragonGeometryOptions) {
  const body = new BodySurface(skel);
  const bodyBuilder = new MeshBuilder();
  const membraneBuilder = new MeshBuilder();
  body.build(bodyBuilder);
  const head = buildHead(bodyBuilder, body, skel);
  buildRictus(bodyBuilder, body, skel);
  const wings = buildWings(body, bodyBuilder, membraneBuilder, skel);
  buildFrillMembranes(membraneBuilder, head, skel);
  buildLegs(bodyBuilder, skel);
  buildDorsalSpikes(bodyBuilder, body);
  buildTailSpade(bodyBuilder, body);

  const riderBuilder = new MeshBuilder();
  if (opts.proceduralRider) {
    buildRider(riderBuilder, skel);
  }
  const tack = buildTack(riderBuilder, body, skel, { dynamicReins: opts.dynamicReins });

  const bodyGeometry: THREE.BufferGeometry = bodyBuilder.build();
  const membraneGeometry: THREE.BufferGeometry = membraneBuilder.build();
  membraneGeometry.deleteAttribute('tangent');
  const riderGeometry: THREE.BufferGeometry = riderBuilder.build();
  riderGeometry.deleteAttribute('tangent');
  return {
    body,
    head,
    wings,
    tack,
    bodyGeometry,
    membraneGeometry,
    riderGeometry,
    triangles: { body: bodyBuilder.triangleCount, membrane: membraneBuilder.triangleCount, rider: riderBuilder.triangleCount },
  };
}
