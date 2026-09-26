/**
 * Mesh part measurements shared by the headless movement checks: the lowest point of the wings (membrane), the tail
 * and the feet above the ground over a stretch of recorded frames, on the CPU-skinned rig.
 */
import { skinVertex, type MeshData } from './raster';
import type { FrameRecord } from './runtime';

export type PartName = 'wing' | 'tail' | 'feet';

export interface PartRun {
  records: readonly FrameRecord[];
  meshes: readonly MeshData[];
  boneNames: readonly string[];
  /** Surface height under (x, z): the ground, or the water surface for sea runs. */
  ground: (x: number, z: number) => number;
}

/** Vertex lists per part: membrane (wings), body vertices on tail bones, body vertices on the feet and wrist claws. */
export function partVertices(run: PartRun): Record<PartName, Array<[MeshData, number]>> {
  const parts: Record<PartName, Array<[MeshData, number]>> = { wing: [], tail: [], feet: [] };
  for (const m of run.meshes) {
    if (m.kind === 'membrane') {
      for (let i = 0; i < m.count; i += 2) {
        parts.wing.push([m, i]);
      }
    } else if (m.kind === 'body') {
      for (let i = 0; i < m.count; i++) {
        const bone = run.boneNames[m.dominant[i]] ?? '';
        if (bone.startsWith('tail')) {
          if (i % 2 === 0) {
            parts.tail.push([m, i]);
          }
        } else if (/^(foot|thumb)/.test(bone)) {
          parts.feet.push([m, i]);
        }
      }
    }
  }
  return parts;
}

export type LowestParts = Record<PartName, number> & { frameWing: number; frameTail: number; frameFeet: number; boneFeet: string };

/** Lowest height (m) above the ground of each part over the records in [t0, t1], every `step` frames. */
export function lowestParts(run: PartRun, t0: number, t1: number, step = 2): LowestParts {
  const parts = partVertices(run);
  const out: LowestParts = { wing: Infinity, tail: Infinity, feet: Infinity, frameWing: 0, frameTail: 0, frameFeet: 0, boneFeet: '' };
  const p = new Float32Array(3);
  for (let k = 0; k < run.records.length; k += step) {
    const r = run.records[k];
    if (r.time < t0 || r.time > t1) {
      continue;
    }
    for (const name of ['wing', 'tail', 'feet'] as PartName[]) {
      for (const [m, i] of parts[name]) {
        skinVertex(m, i, r, p, 0);
        const h = p[1] - run.ground(p[0], p[2]);
        if (h < out[name]) {
          out[name] = h;
          if (name === 'wing') {
            out.frameWing = r.time;
          } else if (name === 'tail') {
            out.frameTail = r.time;
          } else {
            out.frameFeet = r.time;
            out.boneFeet = run.boneNames[m.dominant[i]] ?? '';
          }
        }
      }
    }
  }
  return out;
}
