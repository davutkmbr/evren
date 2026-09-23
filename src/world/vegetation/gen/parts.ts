import type { CrownVolume } from './crown';
import { bentNormal } from './crown';
import type { MeshBuilder, VertexAttribs } from './mesh-builder';
import { perpendicular, V3 } from './vec3';
import type { Rng } from './vec3';

export interface TubeOptions {
  sides: number;
  layer: number;
  crown: CrownVolume;
  /** Target bark tile size (m) around the circumference at the chain start. */
  barkTile: number;
  /** Wind branch weight at the chain start and end. */
  branchWeight: [number, number];
  phase: number;
  /** Root flare: extra radius fraction at the ground, decay height (m), number of buttress lobes. */
  flare?: { amount: number; height: number; lobes: number; y0: number };
  /** Radial noise amplitude (fraction of radius) for irregular trunks. */
  bumpiness?: number;
  /** Texture v offset (keeps bark continuous between trunk pieces). */
  vOffset?: number;
}

const _t = new V3();
const _n = new V3();
const _b = new V3();
const _d = new V3();
const _p = new V3();
const _prevN = new V3();

function attribs(u: number, v: number, layer: number, trunk: number, branch: number, leaf: number, phase: number, ao: number): VertexAttribs {
  return { u, v, layer, windTrunk: trunk, windBranch: branch, windLeaf: leaf, phase, ao };
}

/** Generalised cylinder along a polyline with parallel-transport frames (outward CCW winding). */
export function buildTube(mb: MeshBuilder, points: V3[], radii: number[], o: TubeOptions): void {
  const count = points.length;
  if (count < 2) {
    return;
  }
  const sides = o.sides;
  const r0 = Math.max(radii[0], 1e-3);
  const circumference = 2 * Math.PI * r0;
  const uRepeat = Math.max(1, Math.round(circumference / o.barkTile));
  const tileV = circumference / uRepeat;
  let arc = 0;
  let total = 0;
  for (let i = 1; i < count; i++) {
    total += points[i].distanceTo(points[i - 1]);
  }
  const base = mb.vertexCount;
  for (let i = 0; i < count; i++) {
    const p = points[i];
    if (i > 0) {
      arc += p.distanceTo(points[i - 1]);
    }
    const a = points[Math.max(i - 1, 0)];
    const b = points[Math.min(i + 1, count - 1)];
    _t.copy(b).sub(a).normalize();
    if (i === 0) {
      _n.copy(perpendicular(_t));
    } else {
      _n.copy(_prevN).addScaled(_t, -_prevN.dot(_t));
      if (_n.length() < 1e-4) {
        _n.copy(perpendicular(_t));
      }
      _n.normalize();
    }
    _prevN.copy(_n);
    _b.copy(_t).cross(_n).normalize();
    const along = total > 0 ? arc / total : 0;
    const branch = o.branchWeight[0] + (o.branchWeight[1] - o.branchWeight[0]) * along;
    const r = radii[i];
    for (let j = 0; j <= sides; j++) {
      const ang = (j / sides) * Math.PI * 2;
      _d.copy(_n).scale(Math.cos(ang)).addScaled(_b, Math.sin(ang));
      let rr = r;
      if (o.flare) {
        const f = o.flare;
        const h = Math.max(p.y - f.y0, 0);
        const decay = Math.exp(-h / f.height);
        rr *= 1 + f.amount * decay * (0.65 + 0.35 * Math.cos(ang * f.lobes + 0.7));
      }
      if (o.bumpiness) {
        rr *= 1 + o.bumpiness * Math.sin(ang * 3 + arc * 1.7) * Math.sin(ang * 5 - arc * 0.9);
      }
      _p.copy(p).addScaled(_d, rr);
      const ao = o.crown.ao(_p, false);
      mb.vertex(_p, _d, attribs((j / sides) * uRepeat, (o.vOffset ?? 0) + arc / tileV, o.layer, o.crown.bendWeight(_p.y), branch, 0, o.phase, ao));
    }
  }
  const ring = sides + 1;
  for (let i = 0; i < count - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = base + i * ring + j;
      mb.quad(a, a + 1, a + ring + 1, a + ring);
    }
  }
}

export interface CardRecord {
  center: V3;
  normal: V3;
  up: V3;
  width: number;
  height: number;
  branchWeight: number;
  phase: number;
}

export interface CardOptions {
  layer: number;
  crown: CrownVolume;
  /** 0 = fixed orientation, 1 = fully camera facing. */
  billboard: number;
  /** Amount the shading normal is bent toward the crown's radial direction. */
  bend: number;
  flipU: boolean;
  /** In-plane rotation (rad) of the camera-facing variant. */
  spin: number;
}

const _right = new V3();
const _up = new V3();
const _sn = new V3();
const _c = new V3();

/** One alpha-tested foliage card (twig spray texture: stem at the bottom centre). */
export function addCard(mb: MeshBuilder, card: CardRecord, o: CardOptions): void {
  _up.copy(card.up);
  _right.copy(_up).cross(card.normal);
  if (_right.length() < 1e-4) {
    _right.copy(perpendicular(card.normal));
  }
  _right.normalize();
  _up.copy(card.normal).cross(_right).normalize();
  bentNormal(o.crown, card.center, card.normal, o.bend, _sn);
  const hw = card.width * 0.5;
  const hh = card.height * 0.5;
  const cs = Math.cos(o.spin);
  const sn = Math.sin(o.spin);
  const base = mb.vertexCount;
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [sx, sy] of corners) {
    _c.copy(card.center).addScaled(_right, sx * hw).addScaled(_up, sy * hh);
    const u = o.flipU ? (1 - sx) * 0.5 : (sx + 1) * 0.5;
    const v = (sy + 1) * 0.5;
    const bx = sx * hw * cs - sy * hh * sn;
    const by = sx * hw * sn + sy * hh * cs;
    const ao = o.crown.ao(_c, true);
    mb.cardVertex(
      _c,
      _sn,
      { u, v, layer: o.layer, windTrunk: o.crown.bendWeight(_c.y), windBranch: card.branchWeight, windLeaf: 1, phase: card.phase, ao },
      card.center.x - _c.x,
      card.center.y - _c.y,
      card.center.z - _c.z,
      o.billboard,
      bx,
      by,
    );
  }
  mb.quad(base, base + 1, base + 2, base + 3);
}

/**
 * Merges foliage cards into larger camera-facing clusters on a voxel grid (mid-distance LOD).
 * Card size follows the leaf area gathered in each voxel.
 */
export function clusterCards(cards: CardRecord[], cell: number, sizeGain: number, rng: Rng): CardRecord[] {
  const groups = new Map<string, { c: V3; n: V3; area: number; count: number; branch: number; phase: number }>();
  for (const card of cards) {
    const jx = Math.floor(card.center.x / cell);
    const jy = Math.floor(card.center.y / cell);
    const jz = Math.floor(card.center.z / cell);
    const key = `${jx},${jy},${jz}`;
    let g = groups.get(key);
    if (!g) {
      g = { c: new V3(), n: new V3(), area: 0, count: 0, branch: 0, phase: card.phase };
      groups.set(key, g);
    }
    g.c.add(card.center);
    g.n.add(card.normal);
    g.area += card.width * card.height;
    g.count++;
    g.branch += card.branchWeight;
  }
  const out: CardRecord[] = [];
  for (const g of groups.values()) {
    const center = g.c.scale(1 / g.count);
    const side = Math.sqrt(g.area) * sizeGain;
    const size = Math.min(Math.max(side, cell * 0.85), cell * 1.9) * (0.9 + 0.2 * rng());
    out.push({
      center,
      normal: g.n.length() > 1e-4 ? g.n.normalize() : new V3(0, 1, 0),
      up: new V3(0, 1, 0),
      width: size,
      height: size,
      branchWeight: g.branch / g.count,
      phase: g.phase,
    });
  }
  return out;
}
