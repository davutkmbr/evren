import { Species, SPECIES_SHAPES } from '../species';
import type { SpeciesId } from '../species';
import type { BranchMeshSpec, FoliageSpec } from './branchy';
import { crownFoliage, meshBranches } from './branchy';
import { colonize } from './colonize';
import { CrownVolume } from './crown';
import { MeshBuilder } from './mesh-builder';
import type { CardRecord } from './parts';
import { addCard, buildTube } from './parts';
import { Skeleton } from './skeleton';
import { dirFromAngles, gauss, range, V3 } from './vec3';
import type { Rng } from './vec3';

export interface TreeModel {
  lod0: MeshBuilder;
  lod1: MeshBuilder;
  crown: CrownVolume;
}

/** 3D value noise in [0, 1] for attractor clumping. */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number): number => hash3(ix + dx, iy + dy, iz + dz, seed);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), ux), l(c(0, 1, 0), c(1, 1, 0), ux), uy),
    l(l(c(0, 0, 1), c(1, 0, 1), ux), l(c(0, 1, 1), c(1, 1, 1), ux), uy),
    uz,
  );
}

/** Curved trunk polyline from `base` upward: lean (rad) toward `leanAz`, plus a gentle sinuous wobble. */
function trunkLine(base: V3, height: number, segments: number, lean: number, leanAz: number, wobble: number, rng: Rng): V3[] {
  const pts: V3[] = [];
  const ph1 = rng() * 6.28;
  const ph2 = rng() * 6.28;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = base.y + height * t;
    const bend = Math.sin(lean) * height * (t * t * 0.6 + t * 0.4);
    const wx = wobble * Math.sin(t * 5.1 + ph1) * t;
    const wz = wobble * Math.sin(t * 4.3 + ph2) * t;
    pts.push(new V3(base.x + Math.cos(leanAz) * bend + wx, y, base.z + Math.sin(leanAz) * bend + wz));
  }
  return pts;
}

/** A limb growing from `from` along `dir`, curving toward `curveTo` by `curve` over its length. */
function limbLine(from: V3, dir: V3, length: number, segments: number, curveTo: V3, curve: number, wobble = 0, rng?: Rng): V3[] {
  const pts: V3[] = [];
  const d = dir.clone().normalize();
  const p = from.clone();
  const step = length / segments;
  const target = curveTo.clone().normalize();
  for (let i = 0; i < segments; i++) {
    d.lerp(target, curve / segments);
    if (wobble > 0 && rng) {
      d.x += (rng() - 0.5) * wobble;
      d.y += (rng() - 0.5) * wobble * 0.6;
      d.z += (rng() - 0.5) * wobble;
    }
    d.normalize();
    p.addScaled(d, step);
    pts.push(p.clone());
  }
  return pts;
}

function linearRadii(count: number, r0: number, r1: number, power = 1): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0;
    out.push(r0 + (r1 - r0) * Math.pow(t, power));
  }
  return out;
}

function branchSpec(o: Partial<BranchMeshSpec> & Pick<BranchMeshSpec, 'barkLayer' | 'crown'>): BranchMeshSpec {
  return {
    barkTile: 0.9,
    lod0Sides: [
      [0.25, 12],
      [0.1, 7],
      [0.05, 5],
      [0.028, 3],
    ],
    lod1Sides: [
      [0.22, 6],
      [0.1, 3],
    ],
    lod1Stride: 4,
    ...o,
  };
}

function foliageSpec(o: Partial<FoliageSpec> & Pick<FoliageSpec, 'layer' | 'count' | 'size'>): FoliageSpec {
  return {
    aspect: 1,
    nodeRadius: 0.035,
    shellBias: 1.2,
    upBias: 0.4,
    radialBias: 0.3,
    billboard: 0.3,
    bend: 0.65,
    lift: 0.3,
    lod1Cell: 2.4,
    lod1Gain: 1.4,
    ...o,
  };
}

/**
 * Fıstık çamı: straight or leaning bare trunk forking at ~57 % of the height into 3-5 ascending limbs that divide and
 * spread; the needle mass forms a dense, flat-topped umbrella 3-4 m deep.
 */
function buildStonePine(rng: Rng): TreeModel {
  const s = SPECIES_SHAPES[Species.StonePine];
  const H = s.height;
  const R = s.crownWidth / 2;
  const crown = new CrownVolume(H - 2.0, R + 0.4, 2.3, H, s.crownBase, false, 0.32);
  const skel = new Skeleton();
  const root = skel.add(new V3(0, -0.6, 0), -1, false, s.trunkRadius * 1.1);
  const fork = H * 0.54 + rng() * 1.0;
  const leanAz = rng() * Math.PI * 2;
  const trunk = trunkLine(new V3(0, -0.6, 0), fork + 0.6, 12, 0.05 + 0.06 * rng(), leanAz, 0.25, rng).slice(1);
  const trunkIds = skel.addChain(root, trunk, false, linearRadii(trunk.length, s.trunkRadius, 0.22));
  const limbs = 3 + Math.floor(rng() * 3);
  const az0 = rng() * Math.PI * 2;
  for (let i = 0; i < limbs; i++) {
    const az = az0 + (i / limbs) * Math.PI * 2 + (rng() - 0.5) * 0.7;
    const start = trunkIds[trunkIds.length - 1 - (i % 3)];
    const dir = dirFromAngles(az, range(rng, 0.72, 1.05));
    const outward = dirFromAngles(az, 0.35);
    const pts1 = limbLine(skel.nodes[start].p, dir, range(rng, 2.0, 3.2), 5, outward, 0.25, 0.08, rng);
    const ids1 = skel.addChain(start, pts1, false, linearRadii(pts1.length, 0.16, 0.12));
    const forks = 2 + (rng() < 0.4 ? 1 : 0);
    for (let k = 0; k < forks; k++) {
      const az2 = az + (k - (forks - 1) / 2) * range(rng, 0.45, 0.75);
      const d2 = dirFromAngles(az2, range(rng, 0.45, 0.75));
      const pts2 = limbLine(pts1[pts1.length - 1], d2, range(rng, 2.0, 3.4), 6, dirFromAngles(az2, 0.15), 0.35, 0.1, rng);
      const ids2 = skel.addChain(ids1[ids1.length - 1], pts2, false, linearRadii(pts2.length, 0.1, 0.05));
      for (let q = 2; q < ids2.length; q++) {
        skel.nodes[ids2[q]].canGrow = true;
      }
    }
  }
  const attractors: V3[] = [];
  const seed = Math.floor(rng() * 1e6);
  let guard = 0;
  while (attractors.length < 4600 && guard++ < 60000) {
    const rr = R * Math.sqrt(rng());
    const th = rng() * Math.PI * 2;
    const outline = R * (0.82 + 0.18 * noise3(Math.cos(th) * 2 + 5, Math.sin(th) * 2, 0.5, seed));
    if (rr > outline) {
      continue;
    }
    const q = rr / R;
    const topY = H - 0.35 - 1.35 * q * q;
    const botY = H - 4.3 + 2.9 * Math.pow(q, 1.6);
    const y = botY + (topY - botY) * Math.pow(rng(), 0.6);
    const p = new V3(Math.cos(th) * rr, y, Math.sin(th) * rr);
    if (noise3(p.x * 0.45, p.y * 0.45, p.z * 0.45, seed + 1) < 0.33) {
      continue;
    }
    attractors.push(p);
  }
  colonize(skel, attractors, { segment: 0.42, influence: 2.3, kill: 0.62, maxIterations: 100, tropism: new V3(0, 0.16, 0), maxNodes: 3800 });
  skel.computeRadii(0.012, 2.3);
  skel.smooth(2, 0.5, trunkIds.length + 1);
  const lod0 = new MeshBuilder();
  const lod1 = new MeshBuilder();
  const chains = meshBranches(
    skel,
    branchSpec({ barkLayer: s.barkLayer, crown, trunkFlare: { amount: 0.28, height: 0.6, lobes: 4, y0: -0.6 }, trunkBumpiness: 0.04 }),
    lod0,
    lod1,
    rng,
  );
  crownFoliage(
    skel,
    chains,
    crown,
    foliageSpec({ layer: s.leafLayer, count: 900, size: [1.25, 1.85], shellBias: 1.1, upBias: 0.5, radialBias: 0.25, bend: 0.62, lod1Cell: 2.0, lod1Gain: 1.3 }),
    lod0,
    lod1,
    rng,
  );
  return { lod0, lod1, crown };
}

function pineEnvelope(y: number, cb: number, H: number, R: number): number {
  const t = Math.min(Math.max((y - cb) / (H - cb), 0), 1);
  return R * Math.pow(Math.sin(Math.PI * Math.min(t * 0.85 + 0.12, 1)), 0.75);
}

/**
 * Karaçam / kızılçam: excurrent trunk to the top, whorls of near-horizontal branches every 0.7-1 m with side shoots,
 * needle clumps on the outer parts; the lower trunk self-pruned with dead stubs.
 */
function buildPine(rng: Rng): TreeModel {
  const s = SPECIES_SHAPES[Species.Pine];
  const H = s.height;
  const R = s.crownWidth / 2;
  const cb = s.crownBase;
  const crown = new CrownVolume((cb + H) / 2 + 0.3, R + 0.3, (H - cb) / 2 + 0.6, H, cb, false, 0.36);
  const skel = new Skeleton();
  const root = skel.add(new V3(0, -0.6, 0), -1, false, s.trunkRadius * 1.1);
  const trunk = trunkLine(new V3(0, -0.6, 0), H + 0.2, 34, 0.035, rng() * 6.28, 0.22, rng).slice(1);
  const trunkR = trunk.map((p) => Math.max(0.03, s.trunkRadius * Math.pow(1 - Math.min(Math.max(p.y, 0) / H, 1), 0.8)));
  const trunkIds = skel.addChain(root, trunk, false, trunkR);
  const golden = Math.PI * (3 - Math.sqrt(5));
  let y = cb - 0.3;
  let whorl = 0;
  while (y < H - 0.45) {
    const t = (y - cb) / (H - cb);
    const env = pineEnvelope(y, cb, H, R);
    const n = 3 + Math.floor(rng() * 3);
    let attach = 0;
    while (attach < trunk.length - 1 && trunk[attach].y < y) {
      attach++;
    }
    for (let b = 0; b < n; b++) {
      const az = whorl * golden + (b / n) * Math.PI * 2 + (rng() - 0.5) * 0.6;
      const len = env * range(rng, 0.62, 1.05);
      if (len < 0.35) {
        continue;
      }
      const elev = -0.18 + 0.62 * t + gauss(rng) * 0.1;
      const start = trunkIds[attach];
      const segs = Math.max(3, Math.round(len / 0.4));
      const pts = limbLine(skel.nodes[start].p, dirFromAngles(az, elev), len, segs, new V3(0, 1, 0), 0.3 + 0.2 * rng(), 0.12, rng);
      const r0 = Math.min(0.02 + 0.03 * len, trunkR[attach] * 0.6);
      const ids = skel.addChain(start, pts, false, linearRadii(pts.length, r0, 0.008));
      const side = 1 + Math.floor(len * 0.9);
      for (let k = 0; k < side; k++) {
        const at = Math.min(ids.length - 2, Math.max(1, Math.floor(ids.length * range(rng, 0.35, 0.85))));
        const az2 = az + (rng() < 0.5 ? -1 : 1) * range(rng, 0.5, 0.95);
        const len2 = len * range(rng, 0.28, 0.5);
        const pts2 = limbLine(skel.nodes[ids[at]].p, dirFromAngles(az2, elev + 0.15), len2, Math.max(2, Math.round(len2 / 0.35)), new V3(0, 1, 0), 0.35, 0.15, rng);
        skel.addChain(ids[at], pts2, false, linearRadii(pts2.length, 0.014, 0.007));
      }
    }
    y += range(rng, 0.62, 0.95);
    whorl++;
  }
  // Leader shoot tuft.
  skel.computeRadii(0.007, 2.4);
  const lod0 = new MeshBuilder();
  const lod1 = new MeshBuilder();
  const chains = meshBranches(
    skel,
    branchSpec({
      barkLayer: s.barkLayer,
      crown,
      trunkFlare: { amount: 0.22, height: 0.5, lobes: 3, y0: -0.6 },
      trunkBumpiness: 0.03,
      lod0Sides: [
        [0.2, 10],
        [0.08, 6],
        [0.035, 4],
        [0.018, 3],
      ],
      lod1Sides: [
        [0.14, 5],
        [0.075, 3],
      ],
    }),
    lod0,
    lod1,
    rng,
  );
  crownFoliage(
    skel,
    chains,
    crown,
    foliageSpec({ layer: s.leafLayer, count: 780, size: [1.05, 1.55], nodeRadius: 0.028, shellBias: 0.8, upBias: 0.35, radialBias: 0.35, billboard: 0.35, bend: 0.6, lift: 0.35, lod1Cell: 1.95, lod1Gain: 1.3 }),
    lod0,
    lod1,
    rng,
  );
  // Dead branch stubs on the self-pruned lower trunk.
  for (let i = 0; i < 9; i++) {
    const yy = range(rng, 2.2, cb - 0.4);
    const idx = Math.min(trunk.length - 1, Math.round(((yy + 0.6) / (H + 0.8)) * trunk.length));
    const base = trunk[idx].clone();
    const dir = dirFromAngles(rng() * 6.28, range(rng, -0.35, 0.1));
    buildTube(lod0, [base, base.clone().addScaled(dir, range(rng, 0.35, 1.1))], [0.03, 0.008], { sides: 3, layer: s.barkLayer, crown, barkTile: 0.5, branchWeight: [0, 0.1], phase: rng() });
  }
  return { lod0, lod1, crown };
}

function cypressEnvelope(y: number, H: number, R: number): number {
  const t = Math.min(Math.max(y / H, 0), 1);
  const r = R * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.75) * (1 - 0.1 * t);
  return t < 0.03 ? Math.max(r, 0.25) : r;
}

/** Servi: a dense dark spindle of scale-leaf sprays on short ascending branches around a straight trunk. */
function buildCypress(rng: Rng): TreeModel {
  const s = SPECIES_SHAPES[Species.Cypress];
  const H = s.height;
  const R = s.crownWidth / 2;
  const crown = new CrownVolume(H * 0.45, R, H * 0.55, H, 0.6, true, 0.2);
  const lod0 = new MeshBuilder();
  const lod1 = new MeshBuilder();
  const seed = Math.floor(rng() * 1e6);
  const trunk = trunkLine(new V3(0, -0.5, 0), H - 0.1, 22, 0.012, rng() * 6.28, 0.08, rng);
  const radii = trunk.map((p) => Math.max(0.012, s.trunkRadius * Math.pow(1 - Math.min(Math.max(p.y, 0) / H, 1), 0.9)));
  buildTube(lod0, trunk, radii, { sides: 9, layer: s.barkLayer, crown, barkTile: 0.7, branchWeight: [0, 0.05], phase: 0, flare: { amount: 0.3, height: 0.4, lobes: 5, y0: -0.5 } });
  const trunk1 = trunk.filter((_, i) => i % 3 === 0 || i === trunk.length - 1);
  const radii1 = trunk1.map((p) => Math.max(0.012, s.trunkRadius * Math.pow(1 - Math.min(Math.max(p.y, 0) / H, 1), 0.9)));
  buildTube(lod1, trunk1, radii1, { sides: 5, layer: s.barkLayer, crown, barkTile: 0.7, branchWeight: [0, 0.05], phase: 0 });
  const golden = Math.PI * (3 - Math.sqrt(5));
  const branches = 44;
  for (let i = 0; i < branches; i++) {
    const y = 0.7 + (H * 0.86 - 0.7) * (i / branches) + (rng() - 0.5) * 0.3;
    const env = cypressEnvelope(y, H, R);
    const elev = range(rng, 1.05, 1.3);
    const dir = dirFromAngles(i * golden, elev);
    const len = Math.min((env * 0.85) / Math.cos(elev), 3.2);
    const t = Math.min(Math.max(y / H, 0), 1);
    const base = new V3(0, y, 0);
    const r0 = Math.max(0.018, s.trunkRadius * 0.28 * (1 - t));
    buildTube(lod0, [base, base.clone().addScaled(dir, len)], [r0, r0 * 0.3], { sides: 3, layer: s.barkLayer, crown, barkTile: 0.4, branchWeight: [0.1, 0.6], phase: rng() });
  }
  const cards: CardRecord[] = [];
  const total = 900;
  let guard = 0;
  while (cards.length < total && guard++ < total * 20) {
    const y = range(rng, 0.2, H - 0.2);
    const th = rng() * Math.PI * 2;
    // Lumpy spindle: vertical grooves and bulges.
    const lump = 0.78 + 0.34 * noise3(Math.cos(th) * 1.6, y * 0.5, Math.sin(th) * 1.6, seed);
    const env = cypressEnvelope(y, H, R) * lump;
    if (rng() * R > env * 1.05) {
      continue;
    }
    const inner = cards.length > total * 0.84;
    const rr = env * (inner ? range(rng, 0.2, 0.55) : range(rng, 0.7, 1.0));
    const center = new V3(Math.cos(th) * rr, y, Math.sin(th) * rr);
    const normal = new V3(Math.cos(th + (rng() - 0.5) * 1.2), gauss(rng) * 0.25 + 0.15, Math.sin(th + (rng() - 0.5) * 1.2)).normalize();
    const cardUp = new V3(Math.cos(th) * 0.25, 1, Math.sin(th) * 0.25);
    cardUp.addScaled(normal, -cardUp.dot(normal)).normalize();
    const w = range(rng, 0.75, 1.05) * Math.min(1, 0.45 + env / R);
    cards.push({ center, normal, up: cardUp, width: w, height: w * 1.35, branchWeight: 0.5, phase: rng() });
  }
  for (const card of cards) {
    addCard(lod0, card, { layer: s.leafLayer, crown, billboard: 0.25, bend: 0.75, flipU: rng() < 0.5, spin: (rng() - 0.5) * 0.5 });
  }
  // LOD1: fewer, larger upright sprays keep the columnar silhouette (round clusters would stack like discs).
  let made = 0;
  guard = 0;
  while (made < 120 && guard++ < 5000) {
    const y = range(rng, 0.6, H - 0.6);
    const th = rng() * Math.PI * 2;
    const env = cypressEnvelope(y, H, R) * (0.8 + 0.3 * noise3(Math.cos(th) * 1.6, y * 0.5, Math.sin(th) * 1.6, seed));
    if (env < 0.2) {
      continue;
    }
    const rr = env * range(rng, 0.45, 0.8);
    const center = new V3(Math.cos(th) * rr, y, Math.sin(th) * rr);
    const normal = new V3(Math.cos(th), 0.15, Math.sin(th)).normalize();
    const w = Math.min(1.5, 0.55 + env * 0.7) * range(rng, 0.9, 1.15);
    addCard(lod1, { center, normal, up: new V3(0, 1, 0), width: w, height: w * 1.9, branchWeight: 0.5, phase: rng() }, { layer: s.leafLayer, crown, billboard: 0.85, bend: 0.8, flipU: rng() < 0.5, spin: (rng() - 0.5) * 0.25 });
    made++;
  }
  return { lod0, lod1, crown };
}

interface BroadCrownOptions {
  fork: number;
  trunkTop: number;
  leaders: [number, number];
  leaderElev: [number, number];
  leaderLen: [number, number];
  leaderRadius: [number, number];
  crownCenterY: number;
  crownRx: number;
  crownRy: number;
  crownMinY: number;
  attractors: number;
  clumpScale: number;
  clumpCut: number;
  segment: number;
  influence: number;
  kill: number;
  branch: Partial<BranchMeshSpec>;
  foliage: Omit<Partial<FoliageSpec>, 'layer'> & Pick<FoliageSpec, 'count' | 'size'>;
}

/** Decurrent broadleaf: short trunk, a few spreading leaders, space-colonized crown with lumpy clumps. */
function buildBroadCrownTree(rng: Rng, species: SpeciesId, o: BroadCrownOptions): TreeModel {
  const s = SPECIES_SHAPES[species];
  const crown = new CrownVolume(o.crownCenterY, o.crownRx, o.crownRy, s.height, s.crownBase, false, 0.3);
  const skel = new Skeleton();
  const root = skel.add(new V3(0, -0.7, 0), -1, false, s.trunkRadius * 1.1);
  const trunk = trunkLine(new V3(0, -0.7, 0), o.fork + 0.7, 9, 0.05, rng() * 6.28, 0.12, rng).slice(1);
  const trunkIds = skel.addChain(root, trunk, false, linearRadii(trunk.length, s.trunkRadius, o.trunkTop));
  const top = trunk[trunk.length - 1];
  const n = o.leaders[0] + Math.floor(rng() * (o.leaders[1] - o.leaders[0] + 1));
  const az0 = rng() * Math.PI * 2;
  const up = new V3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const az = az0 + (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.8;
    const dir = dirFromAngles(az, range(rng, o.leaderElev[0], o.leaderElev[1]));
    const len = range(rng, o.leaderLen[0], o.leaderLen[1]);
    const pts = limbLine(top, dir, len, 10, up, 0.35, 0.06, rng);
    const ids = skel.addChain(trunkIds[trunkIds.length - 1 - (i % 2)], pts, false, linearRadii(pts.length, o.leaderRadius[0], o.leaderRadius[1]));
    for (let k = 3; k < ids.length; k++) {
      skel.nodes[ids[k]].canGrow = true;
    }
  }
  const seed = Math.floor(rng() * 1e6);
  const attractors: V3[] = [];
  let guard = 0;
  while (attractors.length < o.attractors && guard++ < o.attractors * 40) {
    const d = new V3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
    const t = d.length();
    if (t > 1) {
      continue;
    }
    const p = new V3(d.x * o.crownRx, o.crownCenterY + d.y * o.crownRy, d.z * o.crownRx);
    if (p.y < o.crownMinY + (o.crownCenterY - o.crownMinY) * 0.35 * (1 - Math.hypot(d.x, d.z))) {
      continue;
    }
    if (t < 0.5 && rng() > 0.2) {
      continue;
    }
    const lump = noise3(p.x * o.clumpScale, p.y * o.clumpScale, p.z * o.clumpScale, seed);
    if (lump < o.clumpCut + 0.25 * t) {
      continue;
    }
    attractors.push(p);
  }
  colonize(skel, attractors, { segment: o.segment, influence: o.influence, kill: o.kill, maxIterations: 100, tropism: new V3(0, 0.12, 0), maxNodes: 3800 });
  skel.computeRadii(0.013, 2.35);
  skel.smooth(2, 0.5, trunkIds.length + 1);
  const lod0 = new MeshBuilder();
  const lod1 = new MeshBuilder();
  const chains = meshBranches(skel, branchSpec({ barkLayer: s.barkLayer, crown, ...o.branch }), lod0, lod1, rng);
  crownFoliage(skel, chains, crown, foliageSpec({ layer: s.leafLayer, ...o.foliage }), lod0, lod1, rng);
  return { lod0, lod1, crown };
}

/** Çınar: massive buttressed trunk forking low into 3-4 great leaders; very broad, dense dome. */
function buildPlane(rng: Rng): TreeModel {
  return buildBroadCrownTree(rng, Species.Plane, {
    fork: 4.6,
    trunkTop: 0.5,
    leaders: [3, 4],
    leaderElev: [0.62, 0.98],
    leaderLen: [6, 8.5],
    leaderRadius: [0.34, 0.2],
    crownCenterY: 13.6,
    crownRx: 10.2,
    crownRy: 8.8,
    crownMinY: 5.5,
    attractors: 6800,
    clumpScale: 0.2,
    clumpCut: 0.28,
    segment: 0.55,
    influence: 2.8,
    kill: 0.8,
    branch: {
      barkTile: 1.1,
      trunkFlare: { amount: 0.55, height: 1.0, lobes: 5, y0: -0.7 },
      trunkBumpiness: 0.07,
      lod0Sides: [
        [0.3, 14],
        [0.12, 8],
        [0.06, 5],
        [0.035, 3],
      ],
      lod1Sides: [
        [0.3, 7],
        [0.13, 3],
      ],
    },
    foliage: { count: 1050, size: [2.0, 2.9], nodeRadius: 0.045, shellBias: 1.3, upBias: 0.42, radialBias: 0.33, bend: 0.62, lod1Cell: 2.8, lod1Gain: 1.3 },
  });
}

/** Meşe / kestane: forest broadleaf with a rounded, lumpy crown. */
function buildBroadleaf(rng: Rng): TreeModel {
  return buildBroadCrownTree(rng, Species.Broadleaf, {
    fork: 3.9,
    trunkTop: 0.28,
    leaders: [2, 3],
    leaderElev: [0.85, 1.2],
    leaderLen: [3.5, 5],
    leaderRadius: [0.22, 0.13],
    crownCenterY: 10.2,
    crownRx: 5.8,
    crownRy: 5.6,
    crownMinY: 4.4,
    attractors: 5000,
    clumpScale: 0.3,
    clumpCut: 0.28,
    segment: 0.45,
    influence: 2.3,
    kill: 0.66,
    branch: {
      trunkFlare: { amount: 0.35, height: 0.7, lobes: 4, y0: -0.7 },
      trunkBumpiness: 0.05,
      lod0Sides: [
        [0.2, 10],
        [0.08, 6],
        [0.045, 4],
        [0.028, 3],
      ],
      lod1Sides: [
        [0.16, 5],
        [0.08, 3],
      ],
    },
    foliage: { count: 900, size: [1.5, 2.15], nodeRadius: 0.035, shellBias: 1.3, upBias: 0.4, radialBias: 0.35, bend: 0.65, lod1Cell: 2.2, lod1Gain: 1.3 },
  });
}

/** Phoenix canariensis: thick scarred trunk, crown knob and ~40 arching pinnate fronds (V-folded strips). */
function buildPalm(rng: Rng): TreeModel {
  const s = SPECIES_SHAPES[Species.Palm];
  const trunkH = 8.6;
  const crown = new CrownVolume(trunkH + 0.9, 4.6, 2.6, s.height, s.crownBase, false, 0.4);
  const lod0 = new MeshBuilder();
  const lod1 = new MeshBuilder();
  const trunk = trunkLine(new V3(0, -0.5, 0), trunkH + 0.5, 16, 0.05, rng() * 6.28, 0.1, rng);
  const radius = (p: V3): number => {
    const t = Math.min(Math.max(p.y / trunkH, 0), 1);
    return s.trunkRadius * (1.08 - 0.12 * t + 0.35 * Math.exp(-((t - 1) ** 2) / 0.004));
  };
  buildTube(lod0, trunk, trunk.map(radius), { sides: 14, layer: s.barkLayer, crown, barkTile: 0.34, branchWeight: [0, 0.05], phase: 0, flare: { amount: 0.25, height: 0.35, lobes: 7, y0: -0.5 } });
  const trunk1 = trunk.filter((_, i) => i % 4 === 0 || i === trunk.length - 1);
  buildTube(lod1, trunk1, trunk1.map(radius), { sides: 7, layer: s.barkLayer, crown, barkTile: 0.34, branchWeight: [0, 0.05], phase: 0 });
  const top = trunk[trunk.length - 1];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const addFronds = (mb: MeshBuilder, count: number, segments: number, widthGain: number): void => {
    for (let f = 0; f < count; f++) {
      const age = f / (count - 1);
      const az = f * golden + rng() * 0.2;
      const elev = 1.15 - age * 1.65 + (rng() - 0.5) * 0.18;
      const L = range(rng, 4.3, 5.3) * (0.85 + 0.15 * (1 - Math.abs(age - 0.45)));
      const droop = 0.1 + age * 0.14;
      const base = top.clone().add(new V3(Math.cos(az) * 0.35, 0.2 + (1 - age) * 0.5, Math.sin(az) * 0.35));
      const dir = dirFromAngles(az, elev);
      const side = new V3(-Math.sin(az), 0, Math.cos(az));
      const phase = rng();
      const p = base.clone();
      const d = dir.clone();
      const down = new V3(0, -1, 0);
      const step = L / segments;
      const fold = 0.42;
      const baseIndex = mb.vertexCount;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        if (i > 0) {
          d.lerp(down, droop * step).normalize();
          p.addScaled(d, step);
        }
        const nrm = side.clone().cross(d).normalize();
        if (nrm.y < 0) {
          nrm.scale(-1);
        }
        const width = (t < 0.12 ? 0.08 : 0.62 * Math.pow(Math.sin(Math.PI * Math.min((t - 0.1) / 0.92, 1)), 0.55) + 0.05) * widthGain;
        const ao = crown.ao(p, true);
        for (let k = -1; k <= 1; k++) {
          const e = p.clone();
          if (k !== 0) {
            e.addScaled(side, k * width * Math.cos(fold)).addScaled(nrm, width * Math.sin(fold) * (0.6 + t * 0.4));
          }
          const n = nrm.clone().addScaled(side, -k * 0.3).normalize();
          const radial = e.clone().sub(new V3(0, crown.centerY, 0)).normalize();
          n.lerp(radial, 0.35).normalize();
          mb.vertex(e, n, {
            u: (k + 1) * 0.5,
            v: t,
            layer: s.leafLayer,
            windTrunk: crown.bendWeight(e.y),
            windBranch: Math.min(1, 0.2 + t),
            windLeaf: t * (k === 0 ? 0.3 : 1),
            phase,
            ao,
          });
        }
      }
      for (let i = 0; i < segments; i++) {
        const a = baseIndex + i * 3;
        mb.quad(a, a + 1, a + 4, a + 3);
        mb.quad(a + 1, a + 2, a + 5, a + 4);
      }
    }
  };
  addFronds(lod0, 44, 12, 1);
  addFronds(lod1, 18, 5, 1.15);
  return { lod0, lod1, crown };
}

export function buildSpeciesModel(species: SpeciesId, rng: Rng): TreeModel {
  switch (species) {
    case Species.StonePine:
      return buildStonePine(rng);
    case Species.Pine:
      return buildPine(rng);
    case Species.Cypress:
      return buildCypress(rng);
    case Species.Plane:
      return buildPlane(rng);
    case Species.Broadleaf:
      return buildBroadleaf(rng);
    case Species.Palm:
    default:
      return buildPalm(rng);
  }
}
