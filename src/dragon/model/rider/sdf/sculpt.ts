/**
 * Authoring side of the rider's distance field: add primitives and layers with plain vectors, then compile() into
 * the flat record the mesher (and its worker) evaluates.
 */
import { F, PrimKind, PrimOp, STRIDE, type CompiledSculpt, type LayerDef } from './field';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Orthonormal basis (local axes in rig space). */
export interface Basis {
  x: V3;
  y: V3;
  z: V3;
}

export interface PrimCommon {
  layer?: number;
  op?: PrimOp;
  /** Blend radius (m) with what came before in the layer. */
  k?: number;
  /** Material id (-1 / undefined keeps the layer's). */
  mat?: number;
  /** Bone at t = 0 and (optional) bone at t = 1 with the ramp t0..t1 along the primitive's axis. */
  bone: number;
  bone1?: number;
  ramp?: [number, number];
  /** Influence scale for skin weights (0 = none, 1 default; larger spreads it). */
  weight?: number;
  /** When it defines the surface, only its own bones skin it. */
  own?: boolean;
  /** Paint: channel values (undefined = untouched), feather (m) and the material written inside. */
  channels?: [number?, number?, number?, number?];
  feather?: number;
  paintMat?: number;
  /** Own displacement noise. */
  noise?: { amp: number; freq: number };
}

const IDENTITY: Basis = { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } };

function len(v: V3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/** Basis whose +y runs along `dir`, +z as close as possible to `hint`. */
export function basisAlong(dir: V3, hint: V3 = { x: 0, y: 0, z: -1 }): Basis {
  const l = len(dir) || 1;
  const y = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
  let dot = hint.x * y.x + hint.y * y.y + hint.z * y.z;
  let z = { x: hint.x - y.x * dot, y: hint.y - y.y * dot, z: hint.z - y.z * dot };
  if (len(z) < 1e-4) {
    const alt = Math.abs(y.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
    dot = alt.x * y.x + alt.y * y.y + alt.z * y.z;
    z = { x: alt.x - y.x * dot, y: alt.y - y.y * dot, z: alt.z - y.z * dot };
  }
  const zl = len(z);
  z = { x: z.x / zl, y: z.y / zl, z: z.z / zl };
  const x = { x: y.y * z.z - y.z * z.y, y: y.z * z.x - y.x * z.z, z: y.x * z.y - y.y * z.x };
  return { x, y, z };
}

export class Sculpt {
  private readonly records: number[][] = [];
  readonly layers: LayerDef[] = [];

  addLayer(def: Partial<LayerDef> & { mat: number }): number {
    this.layers.push({
      offsetOf: -1,
      thickness: 0,
      maskK: 0.004,
      noiseAmp: 0,
      noiseFreq: [30, 30, 30],
      visible: true,
      weights: false,
      ...def,
    });
    return this.layers.length - 1;
  }

  private push(kind: PrimKind, c: PrimCommon, pos: V3, basis: Basis, a: number, b: number, cc: number, extra: { round?: number; sx?: number; sz?: number }, bound: { x: number; y: number; z: number; r: number }): void {
    const r = new Array<number>(STRIDE).fill(0);
    r[F.kind] = kind;
    r[F.op] = c.op ?? PrimOp.Union;
    r[F.layer] = c.layer ?? 0;
    r[F.k] = c.k ?? 0;
    r[F.mat] = c.mat ?? -1;
    r[F.bone0] = c.bone;
    r[F.bone1] = c.bone1 ?? -1;
    r[F.t0] = c.ramp ? c.ramp[0] : 0;
    r[F.t1] = c.ramp ? c.ramp[1] : 1;
    r[F.weight] = c.weight ?? 1;
    r[F.bx] = bound.x;
    r[F.by] = bound.y;
    r[F.bz] = bound.z;
    r[F.br] = bound.r;
    r[F.px] = pos.x;
    r[F.py] = pos.y;
    r[F.pz] = pos.z;
    r[F.a] = a;
    r[F.b] = b;
    r[F.c] = cc;
    r[F.round] = extra.round ?? 0;
    r[F.sx] = extra.sx ?? 1;
    r[F.sz] = extra.sz ?? 1;
    // World -> local = transpose of the basis matrix (rows are the axes).
    const m = F.m;
    r[m] = basis.x.x;
    r[m + 1] = basis.x.y;
    r[m + 2] = basis.x.z;
    r[m + 3] = basis.y.x;
    r[m + 4] = basis.y.y;
    r[m + 5] = basis.y.z;
    r[m + 6] = basis.z.x;
    r[m + 7] = basis.z.y;
    r[m + 8] = basis.z.z;
    let mask = 0;
    if (c.channels) {
      for (let i = 0; i < 4; i++) {
        const v = c.channels[i];
        if (v !== undefined) {
          r[F.ch + i] = v;
          mask |= 1 << i;
        }
      }
    }
    r[F.chMask] = mask;
    r[F.feather] = c.feather ?? 0.004;
    r[F.own] = c.own ? 1 : 0;
    r[F.paintMat] = c.paintMat ?? -1;
    r[F.nAmp] = c.noise ? c.noise.amp : 0;
    r[F.nFreq] = c.noise ? c.noise.freq : 0;
    this.records.push(r);
  }

  ellipsoid(c: PrimCommon, center: V3, radii: V3, basis: Basis = IDENTITY): void {
    const r = Math.max(radii.x, radii.y, radii.z);
    this.push(PrimKind.Ellipsoid, c, center, basis, radii.x, radii.y, radii.z, {}, { ...center, r: r + (c.feather ?? 0) });
  }

  sphere(c: PrimCommon, center: V3, radius: number): void {
    this.ellipsoid(c, center, { x: radius, y: radius, z: radius });
  }

  /**
   * Round cone from a (radius ra) to b (radius rb); the section is scaled by sx (local x) and sz (local z, toward
   * `hint`), e.g. a flatter thigh.
   */
  cone(c: PrimCommon, a: V3, b: V3, ra: number, rb: number, opts: { sx?: number; sz?: number; hint?: V3 } = {}): void {
    const dir = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const h = Math.max(len(dir), 1e-4);
    const basis = basisAlong(dir, opts.hint);
    // Keep |r1 - r2| < h for the round-cone formula.
    let r1 = ra;
    let r2 = rb;
    if (Math.abs(r1 - r2) > h * 0.98) {
      const mid = (r1 + r2) / 2;
      const half = h * 0.49;
      r1 = r1 > r2 ? mid + half : mid - half;
      r2 = r1 > r2 ? mid - half : mid + half;
    }
    const s = Math.max(opts.sx ?? 1, opts.sz ?? 1);
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    this.push(PrimKind.RoundCone, c, a, basis, r1, r2, h, { sx: opts.sx, sz: opts.sz }, { ...center, r: h / 2 + Math.max(r1, r2) * s + (c.feather ?? 0) });
  }

  /** Capped cylinder from a to b, radius r; section scaled by sx (local x) / sz (toward `hint`). */
  cylinder(c: PrimCommon, a: V3, b: V3, r: number, opts: { sx?: number; sz?: number; hint?: V3 } = {}): void {
    const dir = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const h = Math.max(len(dir), 1e-4);
    const basis = basisAlong(dir, opts.hint);
    const s = Math.max(opts.sx ?? 1, opts.sz ?? 1);
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    this.push(PrimKind.Cylinder, c, a, basis, r, 0, h, { sx: opts.sx, sz: opts.sz }, { ...center, r: Math.sqrt((h / 2) ** 2 + (r * s) ** 2) + (c.feather ?? 0) });
  }

  box(c: PrimCommon, center: V3, half: V3, round: number, basis: Basis = IDENTITY): void {
    this.push(PrimKind.RoundBox, c, center, basis, half.x, half.y, half.z, { round }, { ...center, r: len(half) + (c.feather ?? 0) });
  }

  /** Torus around basis.y; major radius R scaled by sx / sz across. */
  torus(c: PrimCommon, center: V3, R: number, r: number, basis: Basis = IDENTITY, sx = 1, sz = 1): void {
    this.push(PrimKind.Torus, c, center, basis, R, r, 0, { sx, sz }, { ...center, r: R * Math.max(sx, sz) + r + (c.feather ?? 0) });
  }

  /** Half space below the plane through `point` with normal `normal` (inside = behind the normal). */
  plane(c: PrimCommon, point: V3, normal: V3): void {
    const basis = basisAlong(normal);
    this.push(PrimKind.Plane, c, point, basis, 0, 0, 0, {}, { ...point, r: 50 });
  }

  compile(): CompiledSculpt {
    const layers = this.layers.map((l) => ({ ...l, hasMasks: false }));
    // Stable sort: by layer, masks first.
    const order = this.records.map((r, i) => ({ r, i }));
    order.sort((p, q) => {
      const dl = p.r[F.layer] - q.r[F.layer];
      if (dl !== 0) {
        return dl;
      }
      const pm = p.r[F.op] === PrimOp.Mask ? 0 : 1;
      const qm = q.r[F.op] === PrimOp.Mask ? 0 : 1;
      return pm - qm || p.i - q.i;
    });
    // Culling reach: smooth unions chain, so a primitive still matters where a later neighbour blends; take the
    // largest blend radius among the primitives of its layer whose bounds come near its own.
    for (const { r } of order) {
      let reach = Math.max(r[F.k], layers[r[F.layer]].maskK);
      for (const { r: q } of order) {
        if (q[F.layer] !== r[F.layer] || q[F.k] <= reach) {
          continue;
        }
        const dx = q[F.bx] - r[F.bx];
        const dy = q[F.by] - r[F.by];
        const dz = q[F.bz] - r[F.bz];
        const gap = Math.sqrt(dx * dx + dy * dy + dz * dz) - r[F.br] - q[F.br];
        if (gap < q[F.k] * 2) {
          reach = q[F.k];
        }
      }
      r[F.reach] = reach + (r[F.op] === PrimOp.Paint || r[F.op] === PrimOp.WeightPaint ? r[F.feather] : 0);
    }
    const prims = new Float32Array(order.length * STRIDE);
    const layerStart = new Int32Array(layers.length).fill(-1);
    const layerEnd = new Int32Array(layers.length).fill(-1);
    order.forEach(({ r }, i) => {
      prims.set(r, i * STRIDE);
      const l = r[F.layer];
      if (layerStart[l] < 0) {
        layerStart[l] = i;
      }
      layerEnd[l] = i + 1;
      if (r[F.op] === PrimOp.Mask) {
        layers[l].hasMasks = true;
      }
    });
    for (let l = 0; l < layers.length; l++) {
      if (layers[l].offsetOf >= l) {
        throw new Error(`rider sculpt: layer ${l} offsets a later layer`);
      }
    }
    return { prims, count: order.length, layers, layerStart, layerEnd };
  }
}
