/**
 * Signed distance field for the rider: primitives in layers (skin, garments, hair, accessories), combined with smooth
 * unions / subtractions, garment layers grown from other layers (offset shells cut by coverage masks), paint
 * primitives that write material and mask channels, and per-primitive bone weights (softmax over distances).
 *
 * Compiled to one Float32Array so the heavy meshing can run in a worker; no three.js here.
 */
import { fbm3 } from './noise';

export const enum PrimKind {
  Ellipsoid = 0,
  /** Round cone along local +y from the origin to (0, h, 0); radii r1 (base) and r2 (tip); section scale sx / sz. */
  RoundCone = 1,
  RoundBox = 2,
  /** Torus around local y, major radius R (scaled per axis by sx / sz), minor radius r. */
  Torus = 3,
  /** Half space: distance = dot(local, (0,1,0)); inside below the plane. */
  Plane = 4,
  /** Capped cylinder along local +y from 0 to h, radius r (section scaled by sx / sz), flat ends. */
  Cylinder = 5,
}

export const enum PrimOp {
  Union = 0,
  Subtract = 1,
  /** Writes material / channels where inside (feathered); no geometry. */
  Paint = 2,
  /** Coverage of an offset layer (the garment exists only inside the union of its masks). */
  Mask = 3,
  /** Smooth intersection with everything before it in the layer. */
  Intersect = 4,
  /** Moves skin weight to its bone inside (feathered), after the softmax; any layer. No geometry. */
  WeightPaint = 5,
}

/** Record layout (floats per primitive). */
export const STRIDE = 44;
export const F = {
  kind: 0,
  op: 1,
  layer: 2,
  k: 3,
  mat: 4,
  bone0: 5,
  bone1: 6,
  t0: 7,
  t1: 8,
  weight: 9,
  bx: 10,
  by: 11,
  bz: 12,
  br: 13,
  px: 14,
  py: 15,
  pz: 16,
  /** Ellipsoid radii / box half extents / cone (r1, r2, h) / torus (R, r, -). */
  a: 17,
  b: 18,
  c: 19,
  round: 20,
  sx: 21,
  sz: 22,
  /** World -> local rotation, row-major 3x3. */
  m: 23,
  /** Paint channel values (4) and which ones are written (bit mask), feather (m). */
  ch: 32,
  chMask: 36,
  feather: 37,
  /** 1: when this primitive defines the surface, its own bones win over the weight layers (hair chains, eyes). */
  own: 38,
  /** Paint: material written only where the paint weight > 0.5 (-1 none). */
  paintMat: 39,
  /** Displacement amplitude (m) and frequency (1/m) of this primitive's own noise (hair clumps, knots). */
  nAmp: 40,
  nFreq: 41,
  /** Culling reach beyond the bounding sphere: the largest blend radius in the layer (smooth unions chain). */
  reach: 42,
  spare1: 43,
} as const;

export interface LayerDef {
  /** Layer this one is an offset shell of (-1: built from its own primitives only). */
  offsetOf: number;
  /** Shell offset (m) outward from the source layer. */
  thickness: number;
  /** Smoothness of the coverage cut (m). */
  maskK: number;
  /** Fold noise: amplitude (m) and frequency per axis (1/m). */
  noiseAmp: number;
  noiseFreq: [number, number, number];
  /** Default material of the layer's surface. */
  mat: number;
  /** Part of the visible surface (helper layers only feed offsets). */
  visible: boolean;
  /** Its primitives feed the skin weights. */
  weights: boolean;
  /** Filled by compile(): the layer has coverage masks. */
  hasMasks?: boolean;
}

export interface CompiledSculpt {
  prims: Float32Array;
  count: number;
  layers: LayerDef[];
  /** Per layer: first primitive index and one past the last (prims are sorted by layer, masks first). */
  layerStart: Int32Array;
  layerEnd: Int32Array;
}

export const BIG = 1e3;

export function smin(a: number, b: number, k: number): number {
  if (k <= 0) {
    return a < b ? a : b;
  }
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/** Primitive distance at (x, y, z); also leaves the axial parameter (0..1) in `lastT`. */
let lastT = 0;
export function primDistance(P: Float32Array, o: number, x: number, y: number, z: number): number {
  const d = primDistanceRaw(P, o, x, y, z);
  if (P[o + F.kind] === PrimKind.Plane) {
    return d;
  }
  // Never nearer than the bounding sphere: keeps culled primitives exactly without effect (approximate SDFs of
  // eccentric ellipsoids can underestimate far away), so neighbouring bricks agree on every shared sample.
  const bx = x - P[o + F.bx];
  const by = y - P[o + F.by];
  const bz = z - P[o + F.bz];
  const bd = Math.sqrt(bx * bx + by * by + bz * bz) - P[o + F.br];
  return bd > d ? bd : d;
}

function primDistanceRaw(P: Float32Array, o: number, x: number, y: number, z: number): number {
  const dx = x - P[o + F.px];
  const dy = y - P[o + F.py];
  const dz = z - P[o + F.pz];
  const m = o + F.m;
  let lx = P[m] * dx + P[m + 1] * dy + P[m + 2] * dz;
  const ly = P[m + 3] * dx + P[m + 4] * dy + P[m + 5] * dz;
  let lz = P[m + 6] * dx + P[m + 7] * dy + P[m + 8] * dz;
  const kind = P[o + F.kind];
  if (kind === PrimKind.Ellipsoid) {
    const rx = P[o + F.a];
    const ry = P[o + F.b];
    const rz = P[o + F.c];
    lastT = Math.min(1, Math.max(0, 0.5 + (0.5 * ly) / ry));
    const ax = lx / rx;
    const ay = ly / ry;
    const az = lz / rz;
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const bx = ax / rx;
    const by = ay / ry;
    const bz = az / rz;
    const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    if (k1 < 1e-9) {
      return -Math.min(rx, ry, rz);
    }
    return (k0 * (k0 - 1)) / k1;
  }
  if (kind === PrimKind.RoundCone) {
    const r1 = P[o + F.a];
    const r2 = P[o + F.b];
    const h = P[o + F.c];
    const sx = P[o + F.sx];
    const sz = P[o + F.sz];
    lx /= sx;
    lz /= sz;
    const scale = Math.min(sx, sz);
    lastT = Math.min(1, Math.max(0, ly / h));
    const b = (r1 - r2) / h;
    const a = Math.sqrt(Math.max(1 - b * b, 1e-6));
    const qx = Math.sqrt(lx * lx + lz * lz);
    const qy = ly;
    const kk = -b * qx + a * qy;
    let d: number;
    if (kk < 0) {
      d = Math.sqrt(qx * qx + qy * qy) - r1;
    } else if (kk > a * h) {
      d = Math.sqrt(qx * qx + (qy - h) * (qy - h)) - r2;
    } else {
      d = qx * a + qy * b - r1;
    }
    return d * scale;
  }
  if (kind === PrimKind.RoundBox) {
    const r = P[o + F.round];
    const qx = Math.abs(lx) - P[o + F.a] + r;
    const qy = Math.abs(ly) - P[o + F.b] + r;
    const qz = Math.abs(lz) - P[o + F.c] + r;
    lastT = Math.min(1, Math.max(0, 0.5 + (0.5 * ly) / P[o + F.b]));
    const mx = Math.max(qx, 0);
    const my = Math.max(qy, 0);
    const mz = Math.max(qz, 0);
    return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0) - r;
  }
  if (kind === PrimKind.Torus) {
    const sx = P[o + F.sx];
    const sz = P[o + F.sz];
    const R = P[o + F.a];
    const ex = lx / sx;
    const ez = lz / sz;
    const len = Math.sqrt(ex * ex + ez * ez);
    // Distance to the (elliptical) centre line, approximated by scaling the radial error by the local scale.
    const s = len > 1e-9 ? Math.sqrt((ex * sx * ex * sx + ez * sz * ez * sz) / (len * len)) : 1;
    const qx = (len - R) * s;
    lastT = 0;
    return Math.sqrt(qx * qx + ly * ly) - P[o + F.b];
  }
  if (kind === PrimKind.Cylinder) {
    const r = P[o + F.a];
    const h = P[o + F.c];
    const sx = P[o + F.sx];
    const sz = P[o + F.sz];
    lx /= sx;
    lz /= sz;
    lastT = Math.min(1, Math.max(0, ly / h));
    const dr = (Math.sqrt(lx * lx + lz * lz) - r) * Math.min(sx, sz);
    const dy = Math.abs(ly - h / 2) - h / 2;
    const ox = Math.max(dr, 0);
    const oy = Math.max(dy, 0);
    return Math.min(Math.max(dr, dy), 0) + Math.sqrt(ox * ox + oy * oy);
  }
  lastT = 0;
  return ly;
}

export function primT(): number {
  return lastT;
}

/** Per-point evaluation scratch (layer distances). */
export class FieldEval {
  readonly D: Float64Array;
  constructor(readonly sculpt: CompiledSculpt) {
    this.D = new Float64Array(sculpt.layers.length);
    this.base = new Float64Array(sculpt.layers.length);
  }

  /**
   * Distance of the visible surface at a point, using only the primitives in `list` (indices sorted by layer; see
   * gather). `list` holds `n` entries.
   */
  distance(x: number, y: number, z: number, list: Int32Array, n: number): number {
    const S = this.sculpt;
    const P = S.prims;
    const D = this.D;
    const base = this.base;
    const L = S.layers.length;
    let i = 0;
    let best = BIG;
    for (let l = 0; l < L; l++) {
      const layer = S.layers[l];
      let d = BIG;
      if (layer.offsetOf >= 0) {
        const src = D[layer.offsetOf];
        d = src < BIG * 0.5 ? src - layer.thickness : BIG;
      }
      // Coverage masks come first within the layer.
      let md = BIG;
      let masks = 0;
      while (i < n) {
        const o = list[i] * STRIDE;
        if (P[o + F.layer] !== l || P[o + F.op] !== PrimOp.Mask) {
          break;
        }
        i++;
        const di = primDistance(P, o, x, y, z);
        md = masks === 0 ? di : smin(md, di, P[o + F.k]);
        masks++;
      }
      // An offset shell exists only inside its coverage masks (none: no shell, only the layer's own primitives).
      if (layer.offsetOf >= 0) {
        d = layer.hasMasks && masks > 0 && d < BIG * 0.5 ? smax(d, md, layer.maskK) : BIG;
      }
      base[l] = d;
      while (i < n) {
        const o = list[i] * STRIDE;
        if (P[o + F.layer] !== l) {
          break;
        }
        i++;
        const op = P[o + F.op];
        if (op === PrimOp.Paint || op === PrimOp.WeightPaint) {
          continue;
        }
        const k = P[o + F.k];
        const amp = P[o + F.nAmp];
        if (op !== PrimOp.Intersect && P[o + F.kind] !== PrimKind.Plane) {
          // Skip exactly-ineffective primitives by their bounding sphere (a lower bound of their distance).
          const bx = x - P[o + F.bx];
          const by = y - P[o + F.by];
          const bz = z - P[o + F.bz];
          const bd = Math.sqrt(bx * bx + by * by + bz * bz) - P[o + F.br] - amp;
          if (op === PrimOp.Union ? bd >= d + k : bd >= k - d) {
            continue;
          }
        }
        let di = primDistance(P, o, x, y, z);
        if (amp > 0 && di < amp * 3) {
          const f = P[o + F.nFreq];
          di += amp * fbm3(x * f, y * f, z * f);
        }
        if (op === PrimOp.Union) {
          d = smin(d, di, k);
        } else if (op === PrimOp.Subtract) {
          d = smax(d, -di, k);
        } else {
          d = smax(d, di, k);
        }
      }
      if (layer.noiseAmp > 0 && d < 0.03) {
        const f = layer.noiseFreq;
        d += layer.noiseAmp * fbm3(x * f[0], y * f[1], z * f[2]);
      }
      D[l] = d;
      if (layer.visible && d < best) {
        best = d;
      }
    }
    return best;
  }

  /** Per layer: the offset shell after its coverage cut (before the layer's own primitives). */
  readonly base: Float64Array;
}

/**
 * Full attributes at a surface point: winning layer, material, paint channels and skin weights (top 4 bones).
 * Weights: softmax over the distances of the weight-layer primitives (sigma m), mapped to bones along each
 * primitive's axis; a winning primitive flagged `own` uses its own bones instead.
 */
export interface PointAttributes {
  layer: number;
  mat: number;
  ch: Float64Array;
  bones: Int32Array;
  weights: Float64Array;
}

export class AttributeEval {
  private readonly field: FieldEval;
  private readonly boneW: Float64Array;
  private readonly touched: number[] = [];
  private dist = new Float64Array(64);
  private axial = new Float64Array(64);
  readonly out: PointAttributes = { layer: 0, mat: 0, ch: new Float64Array(4), bones: new Int32Array(4), weights: new Float64Array(4) };

  constructor(
    readonly sculpt: CompiledSculpt,
    boneCount: number,
    private readonly sigma = 0.012,
  ) {
    this.field = new FieldEval(sculpt);
    this.boneW = new Float64Array(boneCount);
  }

  evaluate(x: number, y: number, z: number, list: Int32Array, n: number): PointAttributes {
    const S = this.sculpt;
    const P = S.prims;
    this.field.distance(x, y, z, list, n);
    const D = this.field.D;
    // Every primitive's distance and axial parameter, once.
    if (this.dist.length < n) {
      this.dist = new Float64Array(n * 2);
      this.axial = new Float64Array(n * 2);
    }
    const dist = this.dist;
    const axial = this.axial;
    for (let i = 0; i < n; i++) {
      dist[i] = primDistance(P, list[i] * STRIDE, x, y, z);
      axial[i] = lastT;
    }
    // Winning layer.
    let win = 0;
    let best = BIG;
    for (let l = 0; l < S.layers.length; l++) {
      if (S.layers[l].visible && D[l] < best) {
        best = D[l];
        win = l;
      }
    }
    const out = this.out;
    out.layer = win;
    out.mat = S.layers[win].mat;
    out.ch.fill(0);
    // Material and paint in the winning layer; the primitive currently defining the union surface sets the material.
    let ownPrim = -1;
    let d = this.field.base[win];
    let minWeightD = BIG;
    for (let i = 0; i < n; i++) {
      const o = list[i] * STRIDE;
      const l = P[o + F.layer];
      if (l !== win) {
        continue;
      }
      const op = P[o + F.op];
      if (op === PrimOp.Mask || op === PrimOp.WeightPaint) {
        continue;
      }
      const di = dist[i];
      if (op === PrimOp.Paint) {
        const f = Math.max(P[o + F.feather], 1e-5);
        const w = di <= -f ? 1 : di >= f ? 0 : 0.5 - (0.5 * di) / f;
        if (w <= 0) {
          continue;
        }
        const mask = P[o + F.chMask];
        for (let c = 0; c < 4; c++) {
          if (mask & (1 << c)) {
            out.ch[c] += (P[o + F.ch + c] - out.ch[c]) * w;
          }
        }
        const pm = P[o + F.paintMat];
        if (pm >= 0 && w > 0.5) {
          out.mat = pm;
        }
        continue;
      }
      if (op === PrimOp.Union) {
        if (di < d) {
          const pm = P[o + F.mat];
          if (pm >= 0) {
            out.mat = pm;
          }
          ownPrim = P[o + F.own] > 0 ? i : -1;
        }
        d = smin(d, di, P[o + F.k]);
      }
    }
    // Skin weights.
    const bw = this.boneW;
    const touched = this.touched;
    touched.length = 0;
    if (ownPrim >= 0) {
      this.addBones(list[ownPrim] * STRIDE, 1, axial[ownPrim]);
    } else {
      for (let i = 0; i < n; i++) {
        const o = list[i] * STRIDE;
        if (P[o + F.op] !== PrimOp.Union || P[o + F.weight] <= 0 || !S.layers[P[o + F.layer]].weights) {
          continue;
        }
        if (dist[i] < minWeightD) {
          minWeightD = dist[i];
        }
      }
      if (minWeightD < BIG * 0.5) {
        for (let i = 0; i < n; i++) {
          const o = list[i] * STRIDE;
          if (P[o + F.op] !== PrimOp.Union || P[o + F.weight] <= 0 || !S.layers[P[o + F.layer]].weights) {
            continue;
          }
          const e = (dist[i] - minWeightD) / (this.sigma * P[o + F.weight]);
          if (e > 8) {
            continue;
          }
          this.addBones(o, Math.exp(-e), axial[i]);
        }
      }
    }
    // Weight paint (face rig regions: eyelids, mouth corners...).
    if (ownPrim < 0) {
      for (let i = 0; i < n; i++) {
        const o = list[i] * STRIDE;
        if (P[o + F.op] !== PrimOp.WeightPaint) {
          continue;
        }
        const di = dist[i];
        const f = Math.max(P[o + F.feather], 1e-5);
        const w = (di <= -f ? 1 : di >= f ? 0 : 0.5 - (0.5 * di) / f) * P[o + F.weight];
        if (w <= 0) {
          continue;
        }
        let total = 0;
        for (const b of touched) {
          total += bw[b];
        }
        for (const b of touched) {
          bw[b] *= 1 - w;
        }
        this.addBone(P[o + F.bone0], total * w);
      }
    }
    // Top 4.
    out.bones.fill(0);
    out.weights.fill(0);
    for (const b of touched) {
      const w = bw[b];
      let slot = -1;
      for (let s = 0; s < 4; s++) {
        if (w > out.weights[s]) {
          slot = s;
          break;
        }
      }
      if (slot >= 0) {
        for (let s = 3; s > slot; s--) {
          out.weights[s] = out.weights[s - 1];
          out.bones[s] = out.bones[s - 1];
        }
        out.weights[slot] = w;
        out.bones[slot] = b;
      }
      bw[b] = 0;
    }
    const sum = out.weights[0] + out.weights[1] + out.weights[2] + out.weights[3];
    if (sum > 0) {
      for (let s = 0; s < 4; s++) {
        out.weights[s] /= sum;
      }
    } else {
      out.weights[0] = 1;
    }
    return out;
  }

  private addBones(o: number, w: number, t: number): void {
    const P = this.sculpt.prims;
    const b0 = P[o + F.bone0];
    const b1 = P[o + F.bone1];
    let w1 = 0;
    if (b1 >= 0) {
      const t0 = P[o + F.t0];
      const t1 = P[o + F.t1];
      const u = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : t >= t0 ? 1 : 0;
      w1 = u * u * (3 - 2 * u);
    }
    this.addBone(b0, w * (1 - w1));
    if (w1 > 0) {
      this.addBone(b1, w * w1);
    }
  }

  private addBone(b: number, w: number): void {
    if (w <= 0) {
      return;
    }
    if (this.boneW[b] === 0) {
      this.touched.push(b);
    }
    this.boneW[b] += w;
  }
}

/**
 * Indices of the primitives that can influence the box (centre, half-diagonal `radius`) within `margin`, sorted
 * by layer with masks first (the order FieldEval expects), from the candidate `from` list (or all).
 */
export function gather(S: CompiledSculpt, cx: number, cy: number, cz: number, radius: number, margin: number, out: Int32Array, from?: Int32Array, fromN?: number): number {
  const P = S.prims;
  let n = 0;
  const total = from ? (fromN ?? from.length) : S.count;
  for (let j = 0; j < total; j++) {
    const i = from ? from[j] : j;
    const o = i * STRIDE;
    const dx = cx - P[o + F.bx];
    const dy = cy - P[o + F.by];
    const dz = cz - P[o + F.bz];
    const reach = P[o + F.br] + radius + margin + P[o + F.reach] + P[o + F.nAmp];
    if (dx * dx + dy * dy + dz * dz <= reach * reach) {
      out[n++] = i;
    }
  }
  return n;
}
