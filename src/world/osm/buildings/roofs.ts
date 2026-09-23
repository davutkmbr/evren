/**
 * Roofs (worker side): hipped, gabled, pyramidal, skillion, dome and hamam domes in the roof material (terracotta
 * Marseille tiles, lead, metal, slate) with ridge caps, eave soffits and fascias; flat roofs as slabs in the facade
 * material (membrane / terrace tiles / concrete / gravel) with parapet caps, stair houses and rooftop clutter
 * (water tanks, solar heaters, dishes, antennas), chimneys on pitched roofs, and minarets of neighbourhood mosques.
 */
import * as THREE from 'three';
import { hash, pointInRing, ringArea, segDist } from '../shared/geometry';
import { INSTANCE_STRIDE } from '../shared/protocol';
import { Arch, Kind, styleCode } from './archetypes';
import { type Obb, obbPoint, offsetRing } from './footprint';
import { F, R, RecordList, type StateMesh } from './mesh';
import { type BuildingPlan, RoofCover } from './plan';

type V3 = [number, number, number];

export const PROP_KINDS = ['chimney', 'tank', 'solar', 'dish', 'antenna', 'minaret'] as const;
export type PropKind = (typeof PROP_KINDS)[number];
export type PropSink = Record<PropKind, RecordList>;

export function createPropSink(): PropSink {
  return Object.fromEntries(PROP_KINDS.map((k) => [k, new RecordList(INSTANCE_STRIDE)])) as PropSink;
}

/** Roof part ids (aRoof.w). */
export const RoofPart = { Tiles: 0, Ridge: 1, Dome: 2, Flat: 3 } as const;

const EAVE: Record<number, number> = { [Arch.Wood]: 0.75, [Arch.Plain]: 0.45, [Arch.Levantine]: 0.4, [Arch.Han]: 0.35, [Arch.Civic]: 0.45, [Arch.Mosque]: 0.5, [Arch.Modern]: 0.3 };
const TANK_COLOURS: [number, number, number][] = [
  [0.78, 0.78, 0.75],
  [0.72, 0.72, 0.7],
  [0.28, 0.42, 0.6],
  [0.62, 0.55, 0.4],
  [0.45, 0.45, 0.45],
  [0.85, 0.83, 0.78],
];

export interface RoofContext {
  roof: StateMesh;
  facade: StateMesh;
  plan: BuildingPlan;
  ring: number[];
  holes: number[][];
  box: Obb;
  /** Absolute wall top. */
  top: number;
  gMin: number;
  props: PropSink;
  stats: Record<string, number>;
}

function setTrim(c: RoofContext, kind: number, tint: THREE.Color = c.plan.trim): void {
  const m = c.facade;
  const p = c.plan;
  m.set(F.Color, tint.r, tint.g, tint.b);
  m.set(F.Fac, 1, c.top - c.gMin, p.seed, p.wear);
  m.set(F.Gnd, 0, 0);
  m.set(F.Sty, p.floorH, styleCode(p.arch, p.wall, p.plinth), kind, 0);
  m.set(F.Win, 1, 0.3, 1, 2);
}

function setRoof(c: RoofContext, part: number, cover: number = c.plan.roofCover): void {
  const t = c.plan.roofTint;
  c.roof.set(R.Color, t.r, t.g, t.b);
  c.roof.set(R.Roof, cover, c.plan.seed, c.plan.wear, part);
}

/** Face of a sloped roof plane with uv = (m along the eave, m up the slope). */
function slopeFace(m: StateMesh, pts: V3[], eaveA: V3, eaveB: V3): void {
  const ex = eaveB[0] - eaveA[0];
  const ez = eaveB[2] - eaveA[2];
  const el = Math.hypot(ex, ez) || 1;
  const ux = pts[1][0] - pts[0][0];
  const uy = pts[1][1] - pts[0][1];
  const uz = pts[1][2] - pts[0][2];
  const vx = pts[pts.length - 1][0] - pts[0][0];
  const vy = pts[pts.length - 1][1] - pts[0][1];
  const vz = pts[pts.length - 1][2] - pts[0][2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  m.poly(pts, nx, ny, nz, (x, y, z) => {
    const px = x - eaveA[0];
    const pz = z - eaveA[2];
    return [(px * ex + pz * ez) / el, Math.hypot(Math.abs(px * ez - pz * ex) / el, y - eaveA[1])];
  });
}

/** Ridge / hip cap: an inverted V of half width 0.14 m along a - b. */
function ridgeCap(c: RoofContext, a: V3, b: V3): void {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const hl = Math.hypot(dx, dz);
  if (hl < 0.2) {
    return;
  }
  const wx = -dz / hl;
  const wz = dx / hl;
  setRoof(c, RoofPart.Ridge);
  for (const s of [1, -1]) {
    const w = 0.15 * s;
    const pts: V3[] = [
      [a[0], a[1] + 0.09, a[2]],
      [b[0], b[1] + 0.09, b[2]],
      [b[0] + wx * w, b[1] - 0.02, b[2] + wz * w],
      [a[0] + wx * w, a[1] - 0.02, a[2] + wz * w],
    ];
    const nx = wx * s * 0.6;
    const nz = wz * s * 0.6;
    const nl = Math.hypot(nx, 0.8, nz);
    c.roof.poly(pts, nx / nl, 0.8 / nl, nz / nl, (x, y, z) => [(x - a[0]) * (dx / hl) + (z - a[2]) * (dz / hl), y]);
  }
}

/** Eave soffit (horizontal, facing down) and fascia board (vertical) along every ring edge. */
function eaves(c: RoofContext, eave: number[], eaveY: number, fascia: THREE.Color): void {
  const r = c.ring;
  const n = r.length / 2;
  const y0 = eaveY - 0.16;
  setTrim(c, Kind.Trim, fascia);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const w0: V3 = [r[i * 2], y0, r[i * 2 + 1]];
    const w1: V3 = [r[j * 2], y0, r[j * 2 + 1]];
    const e0: V3 = [eave[i * 2], y0, eave[i * 2 + 1]];
    const e1: V3 = [eave[j * 2], y0, eave[j * 2 + 1]];
    c.facade.poly([w0, w1, e1, e0], 0, -1, 0, (x, _y, z) => [x, z]);
    const len = Math.hypot(e1[0] - e0[0], e1[2] - e0[2]) || 1;
    const nx = (e1[2] - e0[2]) / len;
    const nz = -(e1[0] - e0[0]) / len;
    c.facade.poly([e0, e1, [e1[0], eaveY + 0.02, e1[2]], [e0[0], eaveY + 0.02, e0[2]]], nx, 0, nz, (x, y, z) => [(x - e0[0]) * -nz + (z - e0[2]) * nx, y - c.gMin]);
  }
}

/** Height of the pitched roof surface at OBB coords (s, t) above `top` (hipped / gabled / pyramidal). */
function roofRiseAt(c: RoofContext, s: number, t: number, rise: number): number {
  const b = c.box;
  const k = c.plan.pitch;
  switch (c.plan.roof) {
    case 'gabled':
      return Math.max(0, Math.min(rise, (b.hw - Math.abs(t)) * k));
    case 'pyramidal':
      return Math.max(0, Math.min(rise, Math.min(b.hw - Math.abs(t), b.hl - Math.abs(s)) * k));
    default:
      return Math.max(0, Math.min(rise, Math.min(b.hw - Math.abs(t), b.hl - Math.abs(s)) * k));
  }
}

/** Builds the roof; returns the highest point (m) for the collider. */
export function buildRoof(c: RoofContext): number {
  const { plan, box } = c;
  switch (plan.roof) {
    case 'hipped':
    case 'gabled':
    case 'pyramidal':
      return pitchedRoof(c);
    case 'skillion':
      return skillionRoof(c);
    case 'dome':
      return domeRoof(c);
    case 'domes':
      return hamamRoof(c);
    default:
      flatRoof(c, box);
      return c.top + 3;
  }
}

function pitchedRoof(c: RoofContext): number {
  const { plan, box, ring: r, top } = c;
  const n = r.length / 2;
  const overhang = EAVE[plan.arch] ?? 0.4;
  const k = plan.pitch;
  const rise = Math.min(plan.roof === 'pyramidal' ? 6 : 5, box.hw * k);
  const eaveY = top - overhang * k;
  const ridgeY = top + rise;
  const fascia = plan.arch === Arch.Wood ? new THREE.Color().copy(plan.tint).multiplyScalar(0.7) : new THREE.Color(0.78, 0.76, 0.72);
  c.stats.pitched++;

  if (plan.roof === 'gabled') {
    c.stats.gabled++;
    const L = box.hl + 0.35;
    const W = box.hw + overhang;
    const P = (s: number, t: number, y: number): V3 => {
      const [x, z] = obbPoint(box, s, t);
      return [x, y, z];
    };
    setRoof(c, RoofPart.Tiles);
    for (const side of [1, -1]) {
      const e0 = P(-L, side * W, eaveY);
      const e1 = P(L, side * W, eaveY);
      slopeFace(c.roof, [e0, e1, P(L, 0, ridgeY), P(-L, 0, ridgeY)], e0, e1);
    }
    ridgeCap(c, P(-L, 0, ridgeY), P(L, 0, ridgeY));
    // Gable walls (facade material) and eave soffits along the two long sides.
    setTrim(c, Kind.Trim, plan.tint);
    for (const side of [1, -1]) {
      const g0 = P(side * box.hl, -box.hw, top);
      const g1 = P(side * box.hl, box.hw, top);
      const g2 = P(side * box.hl, 0, ridgeY);
      c.facade.poly([g0, g1, g2], box.dx * side, 0, box.dz * side, (x, y, z) => [(x - g0[0]) * -box.dz * side + (z - g0[2]) * box.dx * side, y - c.gMin]);
    }
    setTrim(c, Kind.Trim, fascia);
    for (const side of [1, -1]) {
      const w0 = P(-L, side * box.hw, eaveY - 0.16);
      const w1 = P(L, side * box.hw, eaveY - 0.16);
      const e0 = P(-L, side * W, eaveY - 0.16);
      const e1 = P(L, side * W, eaveY - 0.16);
      c.facade.poly([w0, w1, e1, e0], 0, -1, 0, (x, _y, z) => [x, z]);
      const nx = -box.dz * side;
      const nz = box.dx * side;
      c.facade.poly([e0, e1, [e1[0], eaveY + 0.02, e1[2]], [e0[0], eaveY + 0.02, e0[2]]], nx, 0, nz, (x, y, z) => [x * -nz + z * nx, y - c.gMin]);
    }
  } else {
    const eave = offsetRing(r, overhang);
    const ridgeHalf = plan.roof === 'pyramidal' ? 0 : Math.max(0, box.hl - box.hw);
    const ridge: V3[] = [
      [box.cx + box.dx * ridgeHalf, ridgeY, box.cz + box.dz * ridgeHalf],
      [box.cx - box.dx * ridgeHalf, ridgeY, box.cz - box.dz * ridgeHalf],
    ];
    const side: number[] = [];
    for (let i = 0; i < n; i++) {
      side.push(plan.roof === 'pyramidal' ? 0 : (r[i * 2] - box.cx) * box.dx + (r[i * 2 + 1] - box.cz) * box.dz >= 0 ? 0 : 1);
    }
    setRoof(c, RoofPart.Tiles);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a: V3 = [eave[i * 2], eaveY, eave[i * 2 + 1]];
      const b: V3 = [eave[j * 2], eaveY, eave[j * 2 + 1]];
      if (plan.roof === 'pyramidal' || side[i] === side[j]) {
        slopeFace(c.roof, [a, b, ridge[side[i]]], a, b);
      } else {
        slopeFace(c.roof, [a, b, ridge[side[j]], ridge[side[i]]], a, b);
      }
    }
    if (ridgeHalf > 0.2) {
      ridgeCap(c, ridge[0], ridge[1]);
    }
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n;
      const q = (i + 1) % n;
      const e1x = r[i * 2] - r[p * 2];
      const e1z = r[i * 2 + 1] - r[p * 2 + 1];
      const e2x = r[q * 2] - r[i * 2];
      const e2z = r[q * 2 + 1] - r[i * 2 + 1];
      const turn = Math.abs(e1x * e2z - e1z * e2x) / ((Math.hypot(e1x, e1z) || 1) * (Math.hypot(e2x, e2z) || 1));
      if (turn > 0.3) {
        ridgeCap(c, [eave[i * 2], eaveY, eave[i * 2 + 1]], ridge[side[i]]);
      }
    }
    eaves(c, eave, eaveY, fascia);
  }

  // Chimneys: 19th-century blocks had a stove flue per flat.
  const nCh = plan.arch === Arch.Levantine ? 1 + Math.floor(hash(plan.seed * 7.7) * 3) : plan.arch === Arch.Wood || plan.arch === Arch.Han ? Math.floor(hash(plan.seed * 7.7) * 2.6) : hash(plan.seed * 7.7) < 0.45 ? 1 : 0;
  for (let k2 = 0; k2 < nCh; k2++) {
    const s = (hash(plan.seed * 7 + k2) - 0.5) * 1.3 * box.hl;
    const t = (hash(plan.seed * 11 + k2) < 0.5 ? -1 : 1) * box.hw * (0.2 + 0.25 * hash(plan.seed * 19 + k2));
    const [x, z] = obbPoint(box, s, t);
    if (!pointInRing(r, x, z)) {
      continue;
    }
    const y = top + roofRiseAt(c, s, t, rise);
    const brick = hash(plan.seed * 5 + k2) < 0.55;
    const col = brick ? [0.36, 0.15, 0.1] : [plan.tint.r * 0.9, plan.tint.g * 0.9, plan.tint.b * 0.9];
    c.props.chimney.push(0, x, y - 0.6, z, -Math.atan2(box.dz, box.dx), 0.5 + 0.25 * hash(plan.seed * 3 + k2), 1.5 + 0.7 * hash(plan.seed * 9 + k2), col[0], col[1], col[2]);
  }
  if (plan.minaret) {
    minaret(c);
  }
  return ridgeY;
}

function skillionRoof(c: RoofContext): number {
  const { plan, box, ring: r, top } = c;
  const n = r.length / 2;
  const k = Math.tan((12 * Math.PI) / 180);
  const yAt = (x: number, z: number): number => {
    const t = -(x - box.cx) * box.dz + (z - box.cz) * box.dx;
    return top + (t + box.hw) * k;
  };
  const eave = offsetRing(r, 0.3);
  setRoof(c, RoofPart.Tiles, plan.roofCover === RoofCover.Tiles && hash(plan.seed * 2.2) < 0.5 ? RoofCover.Metal : plan.roofCover);
  const pts: V3[] = [];
  for (let i = 0; i < n; i++) {
    pts.push([eave[i * 2], yAt(eave[i * 2], eave[i * 2 + 1]), eave[i * 2 + 1]]);
  }
  const [lx, lz] = obbPoint(box, 0, -box.hw - 0.3);
  const a: V3 = [lx - box.dx, yAt(lx, lz), lz - box.dz];
  const b: V3 = [lx + box.dx, yAt(lx, lz), lz + box.dz];
  const contour = pts.map((p) => new THREE.Vector2(p[0], p[2]));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const t of tris) {
    slopeFace(c.roof, [pts[t[0]], pts[t[1]], pts[t[2]]], a, b);
  }
  // Filler walls between the wall top and the sloping roof.
  setTrim(c, Kind.Trim, plan.tint);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[i * 2];
    const az = r[i * 2 + 1];
    const bx = r[j * 2];
    const bz = r[j * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) {
      continue;
    }
    const nx = (bz - az) / len;
    const nz = -(bx - ax) / len;
    c.facade.poly([[ax, top, az], [bx, top, bz], [bx, yAt(bx, bz), bz], [ax, yAt(ax, az), az]], nx, 0, nz, (x, y, z) => [(x - ax) * -nz + (z - az) * nx, y - c.gMin]);
  }
  return top + 2 * box.hw * k;
}

function domeRoof(c: RoofContext): number {
  const { plan, box, top } = c;
  const R0 = Math.max(1.5, Math.min(8, Math.min(box.hw, box.hl) * 0.72));
  const drumH = R0 > 4 ? 1.2 : 0.5;
  // Lead-covered flat roof around the dome.
  flatRoof(c, box, true);
  const cx = box.cx;
  const cz = box.cz;
  const seg = R0 > 5 ? 24 : 16;
  // Drum (facade material, trim).
  setTrim(c, Kind.Trim, plan.trim);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const p0: V3 = [cx + Math.cos(a0) * R0, top - 0.3, cz + Math.sin(a0) * R0];
    const p1: V3 = [cx + Math.cos(a1) * R0, top - 0.3, cz + Math.sin(a1) * R0];
    c.facade.poly([p0, p1, [p1[0], top + drumH, p1[2]], [p0[0], top + drumH, p0[2]]], Math.cos(am), 0, Math.sin(am), (x, y, z) => [Math.atan2(z - cz, x - cx) * R0, y - c.gMin]);
  }
  const base = top + drumH;
  const peak = dome(c, cx, base, cz, R0 * 1.04, 1.0, seg);
  if (plan.minaret) {
    minaret(c);
  }
  return peak;
}

/** Hemispherical lead dome (radius r, height factor hf) with a finial; returns its top. */
function dome(c: RoofContext, cx: number, y0: number, cz: number, r: number, hf: number, seg: number): number {
  setRoof(c, RoofPart.Dome, RoofCover.Lead);
  const rings = Math.max(4, Math.round(seg / 3));
  const m = c.roof;
  const start = m.count;
  for (let j = 0; j <= rings; j++) {
    const phi = (j / rings) * (Math.PI / 2);
    const cr = Math.cos(phi) * r;
    const y = y0 + Math.sin(phi) * r * hf;
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const nx = Math.cos(phi) * Math.cos(th);
      const ny = Math.sin(phi) / Math.max(0.3, hf);
      const nz = Math.cos(phi) * Math.sin(th);
      const nl = Math.hypot(nx, ny, nz);
      m.v(cx + Math.cos(th) * cr, y, cz + Math.sin(th) * cr, nx / nl, ny / nl, nz / nl, (i / seg) * Math.PI * 2 * r, (j / rings) * r * 1.57);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = start + j * (seg + 1) + i;
      const b = a + seg + 1;
      m.quad(a, b, b + 1, a + 1);
    }
  }
  c.stats.domes++;
  return y0 + r * hf;
}

/** Hamam: one large dome over the hot room and small domes over the rest. Bazaars / bedestens: rows of equal domes. */
function hamamRoof(c: RoofContext): number {
  const { box, ring: r, top, plan } = c;
  flatRoof(c, box, true);
  const bazaar = plan.arch === Arch.Han;
  const mainR = bazaar ? 0 : Math.max(2, Math.min(box.hw, box.hl * 0.5) * 0.85);
  const [mx, mz] = obbPoint(box, -box.hl + mainR * 1.1, 0);
  let peak = bazaar ? top : dome(c, mx, top + 0.3, mz, mainR, 0.85, 20);
  const spacing = bazaar ? 5.4 : 3.4;
  const small = bazaar ? 2.2 : 1.25;
  const n = r.length / 2;
  for (let s = -box.hl + spacing / 2; s < box.hl; s += spacing) {
    for (let t = -box.hw + spacing / 2; t < box.hw; t += spacing) {
      const [x, z] = obbPoint(box, s, t);
      if ((!bazaar && Math.hypot(x - mx, z - mz) < mainR + 1.8) || !pointInRing(r, x, z)) {
        continue;
      }
      let edge = Infinity;
      for (let e = 0; e < n; e++) {
        const f = (e + 1) % n;
        edge = Math.min(edge, segDist(x, z, r[e * 2], r[e * 2 + 1], r[f * 2], r[f * 2 + 1]));
      }
      if (edge < small + 0.15) {
        continue;
      }
      peak = Math.max(peak, dome(c, x, top + 0.2, z, small, bazaar ? 0.65 : 0.8, bazaar ? 14 : 12));
    }
  }
  return peak;
}

/** Minaret at the entrance-side corner of a neighbourhood mosque. */
function minaret(c: RoofContext): void {
  const { plan, box } = c;
  // The qibla (~151°) side is the mihrab wall; the entrance and the minaret are on the opposite, north-west side.
  const qx = Math.sin((151 * Math.PI) / 180);
  const qz = -Math.cos((151 * Math.PI) / 180);
  let best: [number, number] = [box.cx, box.cz];
  let bestScore = Infinity;
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) {
      const [x, z] = obbPoint(box, s * (box.hl + 1.2), t * (box.hw + 1.2));
      const score = (x - box.cx) * qx + (z - box.cz) * qz + (hash(plan.seed * 3 + s + 2 * t) - 0.5) * 2;
      if (score < bestScore) {
        bestScore = score;
        best = [x, z];
      }
    }
  }
  const h = 18 + Math.min(16, Math.sqrt(box.hl * box.hw * 4) * 0.8) + 4 * hash(plan.seed * 41);
  const stone = 0.62 + 0.1 * hash(plan.seed * 9);
  c.props.minaret.push(0, best[0], c.gMin - 1, best[1], hash(plan.seed * 5) * 6.28, 0.8 + 0.15 * hash(plan.seed * 7), h + (c.top - c.gMin) * 0.2, stone, stone * 0.96, stone * 0.88);
  c.stats.minarets++;
}

/**
 * Flat roof: slab (Kind.Slab, with courtyard holes) below the parapet, parapet inner faces and cap; stair house,
 * tanks, solar heaters, dishes and antennas. `lead` makes it the lead-covered base of a dome instead.
 */
function flatRoof(c: RoofContext, box: Obb, lead = false): void {
  const { plan, ring: r, top } = c;
  const parapet = lead ? 0.3 : plan.parapet;
  const roofY = top - parapet;
  const n = r.length / 2;
  const inset = lead ? 0.2 : 0.25;
  const inner = offsetRing(r, -inset);
  const holes = c.holes.map((h) => offsetRing(h, -inset));
  // Slab.
  const contour: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    contour.push(new THREE.Vector2(inner[i * 2], inner[i * 2 + 1]));
  }
  const holeV = holes.map((h) => {
    const out: THREE.Vector2[] = [];
    for (let i = 0; i < h.length; i += 2) {
      out.push(new THREE.Vector2(h[i], h[i + 1]));
    }
    return out;
  });
  if (lead) {
    setRoof(c, RoofPart.Flat, RoofCover.Lead);
    slab(c.roof, contour, holeV, roofY);
  } else {
    setTrim(c, Kind.Slab, new THREE.Color(1, 1, 1));
    c.facade.get(F.Sty)[3] = plan.slab;
    slab(c.facade, contour, holeV, roofY);
  }
  // Parapet: inner faces and cap.
  setTrim(c, Kind.Trim, lead ? plan.trim : plan.tint);
  const rings: [number[], number[]][] = [[r, inner], ...c.holes.map((h, i): [number[], number[]] => [h, holes[i]])];
  for (const [outer, inn] of rings) {
    const m = outer.length / 2;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const ax = inn[i * 2];
      const az = inn[i * 2 + 1];
      const bx = inn[j * 2];
      const bz = inn[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) {
        continue;
      }
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      c.facade.poly([[ax, roofY, az], [bx, roofY, bz], [bx, top, bz], [ax, top, az]], nx, 0, nz, (x, y, z) => [(x - ax) * -nz + (z - az) * nx, y - c.gMin]);
      c.facade.poly([[outer[i * 2], top, outer[i * 2 + 1]], [outer[j * 2], top, outer[j * 2 + 1]], [bx, top, bz], [ax, top, az]], 0, 1, 0, (x, _y, z) => [x, z]);
    }
  }
  if (lead) {
    return;
  }
  rooftop(c, box, roofY);
}

/** Horizontal upward-facing polygon with holes at height y (uv = world x, z). */
export function slab(m: StateMesh, contour: THREE.Vector2[], holes: THREE.Vector2[][], y: number): void {
  const start = m.count;
  const all = [...contour, ...holes.flat()];
  for (const p of all) {
    m.v(p.x, y, p.y, 0, 1, 0, p.x, p.y);
  }
  for (const t of THREE.ShapeUtils.triangulateShape(contour, holes)) {
    const [p, q, s] = t.map((k) => all[k]);
    const up = (q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x);
    if (up <= 0) {
      m.tri(start + t[0], start + t[1], start + t[2]);
    } else {
      m.tri(start + t[0], start + t[2], start + t[1]);
    }
  }
}

/** Stair house, water tanks, solar heaters, dishes and antennas on a flat roof at `roofY`. */
function rooftop(c: RoofContext, box: Obb, roofY: number): void {
  const { plan, ring: r } = c;
  const n = r.length / 2;
  const area = Math.abs(ringArea(r));
  if (area < 30) {
    return;
  }
  const H = (k: number): number => hash(plan.seed * 71.3 + k * 5.17);
  const placed: [number, number, number][] = [];
  const place = (tries: number, radius: number, margin: number, salt: number): [number, number] | null => {
    for (let k = 0; k < tries; k++) {
      const s = (H(salt + k * 2.1) - 0.5) * 2 * Math.max(0, box.hl - margin);
      const t = (H(salt + k * 3.7 + 0.5) - 0.5) * 2 * Math.max(0, box.hw - margin);
      const [x, z] = obbPoint(box, s, t);
      if (!pointInRing(r, x, z) || c.holes.some((h) => pointInRing(h, x, z))) {
        continue;
      }
      let edge = Infinity;
      for (let e = 0; e < n; e++) {
        const f = (e + 1) % n;
        edge = Math.min(edge, segDist(x, z, r[e * 2], r[e * 2 + 1], r[f * 2], r[f * 2 + 1]));
      }
      if (edge < margin || placed.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < pr + radius)) {
        continue;
      }
      placed.push([x, z, radius]);
      return [x, z];
    }
    return null;
  };
  // Stair house (merdiven evi) of apartment blocks.
  if (plan.floors >= 4 && area > 70 && plan.arch !== Arch.Civic && H(1) < 0.72) {
    const w = 2.4 + 0.6 * H(2);
    const d = 3.0 + 0.8 * H(3);
    const p = place(10, Math.hypot(w, d) / 2, Math.max(w, d) / 2 + 0.4, 10);
    if (p) {
      box3(c, p[0], roofY, p[1], box.dx, box.dz, d / 2, w / 2, 2.5 + 0.3 * H(4), plan.tint);
      c.stats.stairHouses++;
    }
  }
  const residential = plan.arch !== Arch.Civic && plan.arch !== Arch.Mosque;
  const tanks = residential ? (H(5) < 0.85 ? 1 + Math.floor(H(6) * Math.min(4, area / 60)) : 0) : 0;
  for (let k = 0; k < tanks; k++) {
    const p = place(10, 0.8, 1.0, 20 + k * 7);
    if (p) {
      const col = TANK_COLOURS[Math.floor(H(30 + k) * TANK_COLOURS.length)];
      c.props.tank.push(0, p[0], roofY, p[1], H(40 + k) * 6.28, 0.85 + 0.35 * H(50 + k), 0.85 + 0.45 * H(60 + k), col[0], col[1], col[2]);
    }
  }
  const solars = residential && H(7) < 0.32 ? 1 + Math.floor(H(8) * 2.2) : 0;
  for (let k = 0; k < solars; k++) {
    const p = place(10, 1.4, 1.3, 70 + k * 5);
    if (p) {
      c.props.solar.push(0, p[0], roofY, p[1], -Math.PI / 2 + (H(80 + k) - 0.5) * 0.3, 1, 1, 1, 1, 1);
    }
  }
  if (H(9) < 0.45) {
    const p = place(8, 0.5, 0.5, 90);
    if (p) {
      c.props.dish.push(0, p[0], roofY, p[1], Math.atan2(-0.906, 0.42) + (H(91) - 0.5) * 0.3, 0.8 + 0.4 * H(92), 1, 0.78, 0.78, 0.76);
    }
  }
  if (residential && H(11) < 0.5) {
    const p = place(8, 0.3, 0.4, 100);
    if (p) {
      c.props.antenna.push(0, p[0], roofY, p[1], H(101) * 6.28, 1, 2.2 + 1.8 * H(102), 0.55, 0.55, 0.55);
    }
  }
}

/** Axis-aligned-to-OBB box on the roof in the facade material (trim surfaces). */
function box3(c: RoofContext, x: number, y: number, z: number, dx: number, dz: number, hl: number, hw: number, h: number, tint: THREE.Color): void {
  setTrim(c, Kind.Trim, tint);
  const corners: [number, number][] = [
    [x + dx * hl - dz * hw, z + dz * hl + dx * hw],
    [x + dx * hl + dz * hw, z + dz * hl - dx * hw],
    [x - dx * hl + dz * hw, z - dz * hl - dx * hw],
    [x - dx * hl - dz * hw, z - dz * hl + dx * hw],
  ];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    const mx = (ax + bx) / 2 - x;
    const mz = (az + bz) / 2 - z;
    const ml = Math.hypot(mx, mz) || 1;
    const nx = mx / ml;
    const nz = mz / ml;
    c.facade.poly([[ax, y, az], [bx, y, bz], [bx, y + h, bz], [ax, y + h, az]], nx, 0, nz, (px, py, pz) => [(px - ax) * -nz + (pz - az) * nx, py - c.gMin]);
  }
  c.facade.poly(corners.map(([px, pz]) => [px, y + h, pz] as V3), 0, 1, 0, (px, _py, pz) => [px, pz]);
}
