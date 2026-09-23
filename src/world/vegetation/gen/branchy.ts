import type { CrownVolume } from './crown';
import type { MeshBuilder } from './mesh-builder';
import type { CardRecord } from './parts';
import { addCard, buildTube, clusterCards } from './parts';
import type { Chain, Skeleton } from './skeleton';
import { extractChains } from './skeleton';
import { V3 } from './vec3';
import type { Rng } from './vec3';

export interface BranchMeshSpec {
  barkLayer: number;
  crown: CrownVolume;
  barkTile: number;
  /** Radius thresholds (m) for tube sides: [>= r0: s0, >= r1: s1, ...]; thinner chains are skipped. */
  lod0Sides: [number, number][];
  lod1Sides: [number, number][];
  /** LOD1 keeps every n-th chain point (the trunk every 2nd). */
  lod1Stride: number;
  trunkFlare?: { amount: number; height: number; lobes: number; y0: number };
  trunkBumpiness?: number;
}

export interface FoliageSpec {
  layer: number;
  /** LOD0 card count target. */
  count: number;
  /** Card width range (m) and height / width ratio. */
  size: [number, number];
  aspect: number;
  /** Skeleton nodes thinner than this (and chain tips) may carry cards. */
  nodeRadius: number;
  /** Exponent of the preference for nodes near the crown envelope (0 = uniform). */
  shellBias: number;
  /** Card normal = mix of random, world up and crown radial directions. */
  upBias: number;
  radialBias: number;
  billboard: number;
  /** Shading normal bend toward the crown radial direction. */
  bend: number;
  /** Push of the card centre along the twig direction (fraction of card height). */
  lift: number;
  /** LOD1 clustering cell (m) and size gain. */
  lod1Cell: number;
  lod1Gain: number;
}

function sidesFor(radius: number, table: [number, number][]): number {
  for (const [r, s] of table) {
    if (radius >= r) {
      return s;
    }
  }
  return 0;
}

function chainBranchWeight(level: number): [number, number] {
  if (level === 0) {
    return [0, 0.08];
  }
  return [Math.min(0.12 + (level - 1) * 0.3, 0.8), Math.min(0.55 + level * 0.25, 1)];
}

function chainGeometry(skel: Skeleton, chain: Chain, stride: number): { pts: V3[]; radii: number[] } {
  const nodes = skel.nodes;
  const idx = chain.nodes;
  const pts: V3[] = [];
  const radii: number[] = [];
  for (let k = 0; k < idx.length; k++) {
    if (k !== 0 && k !== idx.length - 1 && k % stride !== 0) {
      continue;
    }
    const n = nodes[idx[k]];
    pts.push(n.p);
    radii.push(n.radius);
  }
  // The attachment point belongs to the (thicker) parent: start the child with its own radius, slightly swollen.
  if (chain.level > 0 && radii.length > 1) {
    radii[0] = Math.min(radii[0], radii[1] * 1.15);
  }
  radii[radii.length - 1] *= 0.5;
  return { pts, radii };
}

/** Bark tubes of every chain thick enough for each LOD. */
export function meshBranches(skel: Skeleton, spec: BranchMeshSpec, lod0: MeshBuilder, lod1: MeshBuilder, rng: Rng): Chain[] {
  const chains = extractChains(skel);
  const nodes = skel.nodes;
  for (const chain of chains) {
    const r = nodes[chain.nodes[Math.min(1, chain.nodes.length - 1)]].radius;
    const phase = rng();
    const bw = chainBranchWeight(chain.level);
    const s0 = sidesFor(r, spec.lod0Sides);
    if (s0 > 0) {
      const g = chainGeometry(skel, chain, 1);
      buildTube(lod0, g.pts, g.radii, {
        sides: s0,
        layer: spec.barkLayer,
        crown: spec.crown,
        barkTile: spec.barkTile,
        branchWeight: bw,
        phase,
        flare: chain.level === 0 ? spec.trunkFlare : undefined,
        bumpiness: chain.level === 0 ? spec.trunkBumpiness : undefined,
        vOffset: chain.level === 0 ? 0 : rng() * 4,
      });
    }
    const s1 = sidesFor(r, spec.lod1Sides);
    if (s1 > 0) {
      const g = chainGeometry(skel, chain, chain.level === 0 ? 2 : spec.lod1Stride);
      buildTube(lod1, g.pts, g.radii, {
        sides: s1,
        layer: spec.barkLayer,
        crown: spec.crown,
        barkTile: spec.barkTile,
        branchWeight: bw,
        phase,
        flare: chain.level === 0 ? spec.trunkFlare : undefined,
        vOffset: 0,
      });
    }
  }
  return chains;
}

/**
 * Foliage cards on the twig nodes of a skeleton, sampled without replacement with a preference for nodes near the
 * crown envelope (Efraimidis–Spirakis weighted sampling). LOD1 gets voxel-clustered camera-facing cards.
 */
export function crownFoliage(skel: Skeleton, chains: Chain[], crown: CrownVolume, spec: FoliageSpec, lod0: MeshBuilder, lod1: MeshBuilder, rng: Rng): CardRecord[] {
  const nodes = skel.nodes;
  const candidates: { node: number; prev: number; level: number; phase: number; key: number }[] = [];
  for (const chain of chains) {
    const idx = chain.nodes;
    const phase = rng();
    for (let k = 1; k < idx.length; k++) {
      const node = nodes[idx[k]];
      const isTip = k === idx.length - 1;
      if (node.radius > spec.nodeRadius && !isTip) {
        continue;
      }
      if (isTip && node.radius > spec.nodeRadius * 3) {
        continue;
      }
      const depth = crown.depth(node.p);
      const w = Math.pow(Math.min(Math.max(depth, 0.15), 1.15), spec.shellBias) * (isTip ? 1.6 : 1);
      candidates.push({ node: idx[k], prev: idx[k - 1], level: chain.level, phase, key: Math.pow(rng(), 1 / w) });
    }
  }
  candidates.sort((a, b) => b.key - a.key);
  const cards: CardRecord[] = [];
  const up = new V3(0, 1, 0);
  const radial = new V3();
  const count = Math.min(spec.count, candidates.length);
  for (let i = 0; i < count; i++) {
    const c = candidates[i];
    const node = nodes[c.node];
    const twig = node.p.clone().sub(nodes[c.prev].p).normalize();
    crown.radial(node.p, radial);
    const n = new V3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    n.scale(Math.max(0, 1 - spec.upBias - spec.radialBias)).addScaled(up, spec.upBias).addScaled(radial, spec.radialBias).normalize();
    const depth = crown.depth(node.p);
    const w = (spec.size[0] + (spec.size[1] - spec.size[0]) * rng()) * (0.8 + 0.25 * Math.min(depth, 1));
    const h = w * spec.aspect;
    // Twig direction projected into the card plane becomes the card's up axis.
    const cardUp = twig.clone().addScaled(n, -twig.dot(n));
    if (cardUp.length() < 0.1) {
      cardUp.copy(up).addScaled(n, -n.y);
    }
    cardUp.normalize();
    const center = node.p.clone().addScaled(cardUp, h * spec.lift);
    cards.push({ center, normal: n, up: cardUp, width: w, height: h, branchWeight: Math.min(1, 0.7 + c.level * 0.1), phase: (c.phase + rng() * 0.15) % 1 });
  }
  for (const card of cards) {
    addCard(lod0, card, { layer: spec.layer, crown, billboard: spec.billboard, bend: spec.bend, flipU: rng() < 0.5, spin: (rng() - 0.5) * 0.9 });
  }
  addClusteredFoliage(lod1, cards, spec.layer, crown, spec.lod1Cell, spec.lod1Gain, spec.bend, rng);
  return cards;
}

/** LOD1 foliage: voxel-clustered, fully camera-facing cards. */
export function addClusteredFoliage(mb: MeshBuilder, cards: CardRecord[], layer: number, crown: CrownVolume, cell: number, gain: number, bend: number, rng: Rng): void {
  const clusters = clusterCards(cards, cell, gain, rng);
  for (const c of clusters) {
    addCard(mb, c, { layer, crown, billboard: 1, bend: Math.max(bend, 0.8), flipU: rng() < 0.5, spin: (rng() - 0.5) * 1.2 });
  }
}
