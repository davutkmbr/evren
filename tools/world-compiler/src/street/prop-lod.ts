/**
 * Decimated LODs of processed props (format 1), with meshoptimizer's simplifier (MIT, dev dependency): each prop of
 * at least MIN_TRIANGLES gets `props/<id>.lod1.glb` and `props/<id>.lod2.glb` next to its glb — the same nodes,
 * materials and external textures, every primitive simplified (seams kept, attribute-aware, unused vertices
 * dropped). A level is kept only when it removes at least a quarter of the previous level's triangles.
 *
 * `distance` of a level is where its geometric error (metres, from the simplifier) projects to at most one pixel at
 * 1600 x 900 with a 60° vertical field of view: runtimes draw level k from lods[k].distance on (LOD0 before the first).
 * The approved Poly Haven post lantern (30.6k triangles, 900+ instances in Kadıköy) is the case this is for.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Document, NodeIO } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import { externalizeImages, TEXTURE_URI } from '../gltf';
import { validateGlb } from '../validate';

export interface PropLod {
  level: number;
  glb: string;
  hash: string;
  bytes: number;
  triangles: number;
  /** Largest simplification error of the level (m). */
  error: number;
  /** Draw this level from this camera distance on (m). */
  distance: number;
}

const MIN_TRIANGLES = 1500;
/** Target share of the source triangles and the error cap (m) per level. */
const LEVELS: { level: number; ratio: number; maxError: number }[] = [
  { level: 1, ratio: 0.25, maxError: 0.01 },
  { level: 2, ratio: 0.06, maxError: 0.04 },
];
/** Metres per pixel per metre of distance at 1600 x 900, 60° vertical FOV. */
const PIXEL_PER_M = (2 * Math.tan(Math.PI / 6)) / 900;
const MIN_DISTANCE = 6;

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex').slice(0, 16);

function triangles(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      n += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3;
    }
  }
  return n;
}

/** Simplifies every primitive of `doc` in place; returns the largest error (m). */
function simplify(doc: Document, ratio: number, maxError: number): number {
  let worst = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute('POSITION');
      const idxAcc = prim.getIndices();
      if (!posAcc || !idxAcc || prim.getMode() !== 4) {
        continue;
      }
      const positions = new Float32Array(posAcc.getArray()!);
      const indices = Uint32Array.from(idxAcc.getArray()!);
      if (indices.length < 3 * 64) {
        continue;
      }
      // Normals and UVs as attributes, so shading and texture seams survive.
      const nrm = prim.getAttribute('NORMAL')?.getArray();
      const uv = prim.getAttribute('TEXCOORD_0')?.getArray();
      const nv = posAcc.getCount();
      const stride = (nrm ? 3 : 0) + (uv ? 2 : 0);
      let out: Uint32Array;
      let err: number;
      const target = Math.max(3, Math.floor((indices.length * ratio) / 3) * 3);
      if (stride) {
        const attrs = new Float32Array(nv * stride);
        for (let v = 0; v < nv; v++) {
          let o = v * stride;
          if (nrm) {
            attrs[o++] = nrm[v * 3];
            attrs[o++] = nrm[v * 3 + 1];
            attrs[o++] = nrm[v * 3 + 2];
          }
          if (uv) {
            attrs[o++] = uv[v * 2];
            attrs[o++] = uv[v * 2 + 1];
          }
        }
        const weights = [...(nrm ? [0.5, 0.5, 0.5] : []), ...(uv ? [1, 1] : [])];
        [out, err] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attrs, stride, weights, null, target, maxError, ['ErrorAbsolute', 'Prune']);
      } else {
        [out, err] = MeshoptSimplifier.simplify(indices, positions, 3, target, maxError, ['ErrorAbsolute', 'Prune']);
      }
      if (out.length < 3) {
        // Everything pruned: keep one degenerate-free triangle set of the original (tiny parts vanish at distance).
        out = indices.slice(0, 3);
      }
      worst = Math.max(worst, err);
      // Compact: keep the used vertices of every attribute.
      const map = new Int32Array(nv).fill(-1);
      const used: number[] = [];
      for (let i = 0; i < out.length; i++) {
        if (map[out[i]] < 0) {
          map[out[i]] = used.length;
          used.push(out[i]);
        }
      }
      for (const sem of prim.listSemantics()) {
        const acc = prim.getAttribute(sem)!;
        const src = acc.getArray()!;
        const size = acc.getElementSize();
        const Ctor = src.constructor as { new (n: number): typeof src };
        const dst = new Ctor(used.length * size);
        used.forEach((v, k) => {
          for (let c = 0; c < size; c++) {
            dst[k * size + c] = src[v * size + c];
          }
        });
        const next = doc.createAccessor(acc.getName()).setType(acc.getType()).setArray(dst).setNormalized(acc.getNormalized()).setBuffer(acc.getBuffer());
        prim.setAttribute(sem, next);
      }
      const remapped = new Uint32Array(out.length);
      for (let i = 0; i < out.length; i++) {
        remapped[i] = map[out[i]];
      }
      prim.setIndices(doc.createAccessor(idxAcc.getName()).setType('SCALAR').setArray(used.length <= 65535 ? Uint16Array.from(remapped) : remapped).setBuffer(idxAcc.getBuffer()));
    }
  }
  // Drop the replaced accessors.
  for (const acc of doc.getRoot().listAccessors()) {
    if (acc.listParents().every((p) => p === doc.getRoot())) {
      acc.dispose();
    }
  }
  return worst;
}

/**
 * Writes the LOD glbs of a processed prop to <outDir>/props/ and returns their records (empty for small props). The
 * document is simplified in place, level after level (call it after the prop's own glb is written).
 */
export async function writePropLods(doc: Document, id: string, outDir: string): Promise<PropLod[]> {
  const base = triangles(doc);
  if (base < MIN_TRIANGLES) {
    return [];
  }
  await MeshoptSimplifier.ready;
  const lods: PropLod[] = [];
  let prev = base;
  let error = 0;
  for (const L of LEVELS) {
    error += simplify(doc, (L.ratio * base) / prev, L.maxError);
    const tris = triangles(doc);
    if (tris > prev * 0.75) {
      continue;
    }
    const glb = externalizeImages(await new NodeIO().writeBinary(doc), TEXTURE_URI);
    const file = `props/${id}.lod${L.level}.glb`;
    writeFileSync(join(outDir, file), glb);
    const report = await validateGlb(file, glb, (uri) => readFileSync(resolve(outDir, 'props', uri)));
    if (report.errors) {
      throw new Error(`${file}: ${report.errors} validator errors: ${report.messages.join('; ')}`);
    }
    const distance = Math.max(MIN_DISTANCE, lods.length ? lods[lods.length - 1].distance * 1.5 : 0, Math.round((error / PIXEL_PER_M) * 10) / 10);
    lods.push({ level: L.level, glb: file, hash: sha(glb), bytes: glb.byteLength, triangles: tris, error: Math.round(error * 10000) / 10000, distance: Math.round(distance * 10) / 10 });
    prev = tris;
  }
  return lods;
}
