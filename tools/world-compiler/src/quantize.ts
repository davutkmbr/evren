/**
 * `KHR_mesh_quantization` for compress.ts: the algorithm of @gltf-transform/functions' quantize() (4.5, volume
 * 'mesh'), step for step, with the per-vertex work on the typed arrays instead of Accessor.getElement/setElement
 * and gl-matrix calls per vertex (the library's loops were ~15 % of a compile). Same bounds, node transform, float32
 * rounding of transformed positions, bit layout, attribute order, cleanup (prune + dedup, same options), so the
 * glbs are byte-identical to the library's. Documents outside the common case (morph targets, skins, animated or
 * parent nodes, GPU instancing, volume materials, normalized or sparse sources, joints / weights) go to the library.
 */
import { Accessor, type Document, Node, Primitive, type Transform } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { compactPrimitive, createTransform, dedup, getPrimitiveVertexCount, prune, quantize, QUANTIZE_DEFAULTS, reorder } from '@gltf-transform/functions';
import { PropertyType } from '@gltf-transform/core';

export interface QuantizeOptions {
  /** Semantics to quantize (default all); morph-target semantics (library path only). */
  pattern?: RegExp;
  patternTargets?: RegExp;
  quantizeWeight?: number;
  quantizePosition: number;
  quantizeNormal: number;
  quantizeTexcoord: number;
  quantizeColor: number;
  quantizeGeneric: number;
}

type Ctor = Int8ArrayConstructor | Int16ArrayConstructor | Uint8ArrayConstructor | Uint16ArrayConstructor;
type Mat4 = number[];

/* gl-matrix, as bundled by @gltf-transform/functions (the same operations, so the same doubles). */
function fromRotationTranslationScale(out: Mat4, v: number[], s: number[]): Mat4 {
  // q = [0, 0, 0, 1]: every rotation term is 0.
  const x = 0;
  const y = 0;
  const z = 0;
  const w = 1;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  out[0] = (1 - (yy + zz)) * s[0];
  out[1] = (xy + wz) * s[0];
  out[2] = (xz - wy) * s[0];
  out[3] = 0;
  out[4] = (xy - wz) * s[1];
  out[5] = (1 - (xx + zz)) * s[1];
  out[6] = (yz + wx) * s[1];
  out[7] = 0;
  out[8] = (xz + wy) * s[2];
  out[9] = (yz - wx) * s[2];
  out[10] = (1 - (xx + yy)) * s[2];
  out[11] = 0;
  out[12] = v[0];
  out[13] = v[1];
  out[14] = v[2];
  out[15] = 1;
  return out;
}

function invert(out: Mat4, a: Mat4): Mat4 | null {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) {
    return null;
  }
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];
    out[c * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[c * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[c * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[c * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

/** MathUtils.decodeNormalizedInt / encodeNormalizedInt by array type (null: a float array, read as is). */
const DECODE = new Map<unknown, (i: number) => number>([
  [Uint16Array, (i) => i / 65535],
  [Uint8Array, (i) => i / 255],
  [Int16Array, (i) => Math.max(i / 32767, -1)],
  [Int8Array, (i) => Math.max(i / 127, -1)],
]);
const ENCODE = new Map<unknown, (f: number) => number>([
  [Uint16Array, (f) => Math.round(Math.min(Math.max(f, 0), 1) * 65535)],
  [Uint8Array, (f) => Math.round(Math.min(Math.max(f, 0), 1) * 255)],
  [Int16Array, (f) => Math.round(Math.min(Math.max(f, -1), 1) * 32767)],
  [Int8Array, (f) => Math.round(Math.min(Math.max(f, -1), 1) * 127)],
]);
type Arr = Float32Array | Int8Array | Int16Array | Uint8Array | Uint16Array;
const decoderOf = (a: Accessor): ((i: number) => number) | null => (a.getNormalized() ? DECODE.get((a.getArray() as Arr).constructor)! : null);

/** Accessor.getMinNormalized / getMaxNormalized (finite raw values, then decoded) straight on the array. */
function bounds(a: Accessor): { min: number[]; max: number[] } {
  const arr = a.getArray()!;
  const n = a.getElementSize();
  const min = new Array<number>(n).fill(Infinity);
  const max = new Array<number>(n).fill(-Infinity);
  for (let i = 0; i < arr.length; i += n) {
    for (let j = 0; j < n; j++) {
      const v = arr[i + j];
      if (Number.isFinite(v)) {
        min[j] = Math.min(min[j], v);
        max[j] = Math.max(max[j], v);
      }
    }
  }
  const dec = decoderOf(a);
  return dec ? { min: min.map(dec), max: max.map(dec) } : { min, max };
}

/** Whether the fast path reproduces the library for this document. */
function supported(doc: Document): boolean {
  const root = doc.getRoot();
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_mesh_primitive_restart') || root.listAnimations().length || root.listSkins().length) {
    return false;
  }
  for (const mesh of root.listMeshes()) {
    for (const parent of mesh.listParents()) {
      if (parent instanceof Node && (parent.listChildren().length || parent.getSkin() || parent.getExtension('EXT_mesh_gpu_instancing'))) {
        return false;
      }
    }
    for (const prim of mesh.listPrimitives()) {
      if (!prim.getAttribute('POSITION') || prim.listTargets().length || prim.getMaterial()?.getExtension('KHR_materials_volume')) {
        return false;
      }
      for (const sem of prim.listSemantics()) {
        const a = prim.getAttribute(sem)!;
        const arr = a.getArray();
        const ok = a.getNormalized() ? DECODE.has(arr?.constructor) : arr instanceof Float32Array;
        if (!ok || a.getSparse() || sem.startsWith('JOINTS_') || sem.startsWith('WEIGHTS_')) {
          return false;
        }
      }
    }
  }
  return true;
}

function settings(sem: string, a: Accessor, o: QuantizeOptions): { bits: number; ctor: Ctor | null } {
  const skip = { bits: -1, ctor: null };
  if (sem === 'POSITION') {
    return { bits: o.quantizePosition, ctor: o.quantizePosition <= 8 ? Int8Array : Int16Array };
  }
  if (sem === 'NORMAL' || sem === 'TANGENT') {
    return { bits: o.quantizeNormal, ctor: o.quantizeNormal <= 8 ? Int8Array : Int16Array };
  }
  if (sem.startsWith('COLOR_')) {
    return { bits: o.quantizeColor, ctor: o.quantizeColor <= 8 ? Uint8Array : Uint16Array };
  }
  const { min, max } = bounds(a);
  if (sem.startsWith('TEXCOORD_')) {
    return min.some((v) => v < 0) || max.some((v) => v > 1) ? skip : { bits: o.quantizeTexcoord, ctor: o.quantizeTexcoord <= 8 ? Uint8Array : Uint16Array };
  }
  if (sem.startsWith('_')) {
    if (min.some((v) => v < -1) || max.some((v) => v > 1)) {
      return skip;
    }
    const signed = min.some((v) => v < 0);
    return { bits: o.quantizeGeneric, ctor: signed ? (o.quantizeGeneric <= 8 ? Int8Array : Int16Array) : o.quantizeGeneric <= 8 ? Uint8Array : Uint16Array };
  }
  throw new Error(`quantize: unexpected semantic "${sem}"`);
}

/** quantizeAttribute over the attribute's values as getElement reads them (decoded when normalized). */
function quantizeValues(src: Float64Array, ctor: Ctor, bits: number): InstanceType<Ctor> {
  const dst = new ctor(src.length);
  const signBits = ctor === Int8Array || ctor === Int16Array ? 1 : 0;
  const quantBits = bits - signBits;
  const storageBits = ctor.BYTES_PER_ELEMENT * 8 - signBits;
  const scale = Math.pow(2, quantBits) - 1;
  const lo = storageBits - quantBits;
  const hi = 2 * quantBits - storageBits;
  const rmin = signBits > 0 ? -1 : 0;
  for (let i = 0; i < src.length; i++) {
    const e = src[i];
    let value = Math.min(Math.max(e, rmin), 1);
    value = Math.round(Math.abs(value) * scale);
    value = (value << lo) | (value >> hi);
    dst[i] = value * Math.sign(e);
  }
  return dst;
}

/** Drop-in for quantize(options) in compress.ts. */
export function fastQuantize(o: QuantizeOptions): Transform {
  const library = quantize(o);
  return createTransform('quantize', async (doc: Document) => {
    if (!supported(doc)) {
      return library(doc);
    }
    const root = doc.getRoot();
    for (const mesh of root.listMeshes()) {
      // Volume: the mesh's POSITION bounds (getPositionQuantizationVolume, flatBounds).
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const prim of mesh.listPrimitives()) {
        const b = bounds(prim.getAttribute('POSITION')!);
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], b.min[i]);
          max[i] = Math.max(max[i], b.max[i]);
        }
      }
      const scale = Math.max((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2);
      const offset = [min[0] + (max[0] - min[0]) / 2, min[1] + (max[1] - min[1]) / 2, min[2] + (max[2] - min[2]) / 2];
      const fromT = fromRotationTranslationScale([], offset, [scale, scale, scale]);
      for (const parent of o.pattern && !o.pattern.test('POSITION') ? [] : mesh.listParents()) {
        if (parent instanceof Node) {
          const m = parent.getMatrix() as unknown as Mat4;
          multiply(m, m, fromT);
          parent.setMatrix(m as never);
        }
      }
      const inv = invert([], fromT)!;
      for (const prim of mesh.listPrimitives()) {
        if (getPrimitiveVertexCount(prim, 'render' as never) < getPrimitiveVertexCount(prim, 'upload' as never) / 2) {
          compactPrimitive(prim);
        }
        for (const sem of prim.listSemantics()) {
          if (o.pattern && !o.pattern.test(sem)) {
            continue;
          }
          const src = prim.getAttribute(sem)!;
          const { bits, ctor } = settings(sem, src, o);
          if (!ctor) {
            continue;
          }
          if (bits < 8 || bits > 16) {
            throw new Error('quantize: Requires bits = 8–16.');
          }
          if (src.getComponentSize() <= bits / 8) {
            continue;
          }
          const dst = src.clone();
          const raw = dst.getArray() as Arr;
          const dec = decoderOf(dst);
          // The values getElement reads: decoded when normalized.
          const vals = new Float64Array(raw.length);
          for (let i = 0; i < raw.length; i++) {
            vals[i] = dec ? dec(raw[i]) : raw[i];
          }
          if (sem === 'POSITION') {
            // transformMat4 in doubles, stored back like setElement (float32, or encoded when normalized), read again.
            const m = inv;
            const enc = dec ? ENCODE.get(raw.constructor)! : null;
            const store = new (raw.constructor as new (n: number) => Arr)(3);
            for (let i = 0; i < vals.length; i += 3) {
              const x = vals[i];
              const y = vals[i + 1];
              const z = vals[i + 2];
              let w = m[3] * x + m[7] * y + m[11] * z + m[15];
              w = w || 1;
              store[0] = enc ? enc((m[0] * x + m[4] * y + m[8] * z + m[12]) / w) : (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
              store[1] = enc ? enc((m[1] * x + m[5] * y + m[9] * z + m[13]) / w) : (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
              store[2] = enc ? enc((m[2] * x + m[6] * y + m[10] * z + m[14]) / w) : (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
              for (let c = 0; c < 3; c++) {
                vals[i + c] = dec ? dec(store[c]) : store[c];
              }
            }
          }
          dst.setArray(quantizeValues(vals, ctor, bits) as never).setNormalized(true).setSparse(false);
          prim.setAttribute(sem, dst);
        }
        const indices = prim.getIndices();
        if (prim instanceof Primitive && indices && prim.listAttributes().length && prim.listAttributes()[0].getCount() < 65535) {
          indices.setArray(new Uint16Array(indices.getArray()!));
        }
      }
    }
    const quantized = root.listMeshes().some((mesh) =>
      mesh.listPrimitives().some((prim) => prim.listSemantics().some((sem) => isQuantized(sem, prim.getAttribute('POSITION')!))),
    );
    if (quantized) {
      doc.createExtension(KHRMeshQuantization).setRequired(true);
    }
    await doc.transform(
      prune({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.SKIN, PropertyType.MATERIAL], keepAttributes: true, keepIndices: true, keepLeaves: true, keepSolidTextures: true }),
      dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MATERIAL, PropertyType.SKIN], keepUniqueNames: true }),
    );
  });
}

/** isQuantizedAttribute as the library calls it (with the POSITION accessor for every semantic). */
function isQuantized(sem: string, a: Accessor): boolean {
  const size = a.getComponentSize();
  if (sem === 'POSITION' || sem === 'NORMAL' || sem === 'TANGENT') {
    return size < 4;
  }
  if (sem.startsWith('TEXCOORD_')) {
    const t = a.getComponentType();
    const n = a.getNormalized();
    return size < 4 && !(n && t === Accessor.ComponentType.UNSIGNED_BYTE) && !(n && t === Accessor.ComponentType.UNSIGNED_SHORT);
  }
  return false;
}


/**
 * Drop-in for meshopt({ encoder, level }): the library's meshopt() is reorder + quantize (again, with its defaults) +
 * the extension; this runs the same with fastQuantize.
 */
export function fastMeshopt(opts: { encoder: Parameters<typeof reorder>[0]['encoder']; level: 'medium' | 'high' }): Transform {
  return createTransform('meshopt', async (doc: Document) => {
    if (doc.getRoot().listAccessors().length === 0) {
      return;
    }
    if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_mesh_primitive_restart')) {
      throw new Error('meshopt: Missing support for KHR_mesh_primitive_restart.');
    }
    const medium = opts.level === 'medium';
    const pattern = medium ? /.*/ : /^(POSITION|TEXCOORD|JOINTS|WEIGHTS|COLOR)(_\d+)?$/;
    const patternTargets = medium ? /.*/ : /^(POSITION|TEXCOORD|JOINTS|WEIGHTS|COLOR|NORMAL|TANGENT)(_\d+)?$/;
    const d = QUANTIZE_DEFAULTS;
    await doc.transform(
      reorder({ encoder: opts.encoder, target: 'size' }),
      fastQuantize({ quantizePosition: d.quantizePosition, quantizeNormal: medium ? d.quantizeNormal : Math.min(d.quantizeNormal, 8), quantizeTexcoord: d.quantizeTexcoord, quantizeColor: d.quantizeColor, quantizeGeneric: d.quantizeGeneric, quantizeWeight: d.quantizeWeight, pattern, patternTargets }),
    );
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: medium ? EXTMeshoptCompression.EncoderMethod.QUANTIZE : EXTMeshoptCompression.EncoderMethod.FILTER });
  });
}
