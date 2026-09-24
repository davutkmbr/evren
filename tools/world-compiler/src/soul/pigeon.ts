/**
 * Pigeons of the square from the approved animated model "Animated Pigeon - Rigged & Optimized" by GAMICO (CC-BY 4.0,
 * Sketchfab; cached in assets-src/model/pigeon_gamico/gltf/, gitignored), baked into static poses for instances:
 * the skinned mesh is posed on the CPU at one frame of a clip (standing: Idle, pecking: the lowest head of Eat,
 * walking: mid-stride of WalkFoward), its base-colour texture is sampled into COLOR_0 per vertex, and the result is
 * emitted as a procedural prop variant (metres, +Y up, feet at the origin, head towards +Z). The rig and its 17 clips
 * stay in the source; the soul step records the clip names so a runtime can load the rigged model and animate it
 * (S5). Without the cached source (other machines, CI) the procedural stand-in of animals.ts is used instead.
 *
 * Credit (CC-BY 4.0): This work is based on "Animated Pigeon - Rigged & Optimized"
 * (https://sketchfab.com/3d-models/animated-pigeon-rigged-optimized-6cdb9b2f5f784d8f9abc92e4c132f116) by GAMICO
 * (https://sketchfab.com/gamico) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from '../../lib/areas.mjs';
import type { RGBA, TileMesh } from '../mesh';
import { CACHE_DIR } from '../textures';

const SOURCE_DIR = resolve(ROOT, 'assets-src/model/pigeon_gamico/gltf');
/** Body length of a feral pigeon, bill to tail (m). */
const LENGTH = 0.32;

export const PIGEON_MODEL = {
  id: 'pigeon_gamico',
  name: 'Animated Pigeon - Rigged & Optimized',
  author: 'GAMICO',
  url: 'https://sketchfab.com/3d-models/animated-pigeon-rigged-optimized-6cdb9b2f5f784d8f9abc92e4c132f116',
  licence: 'CC-BY-4.0',
  attribution:
    'This work is based on "Animated Pigeon - Rigged & Optimized" (https://sketchfab.com/3d-models/animated-pigeon-rigged-optimized-6cdb9b2f5f784d8f9abc92e4c132f116) by GAMICO (https://sketchfab.com/gamico) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
  source: 'assets-src/model/pigeon_gamico/gltf/scene.gltf',
};

export type PigeonPose = 'standing' | 'pecking' | 'walking';

/* ------------------------------------------------------------------------------------------------------------- */
/* Minimal synchronous glTF reader (one .gltf + .bin)                                                              */
/* ------------------------------------------------------------------------------------------------------------- */

type M4 = Float64Array;

interface Gltf {
  json: {
    accessors: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
    bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
    buffers: { uri: string }[];
    nodes: { name?: string; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; mesh?: number; skin?: number }[];
    meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
    skins: { joints: number[]; inverseBindMatrices?: number }[];
    animations: { name: string; channels: { sampler: number; target: { node?: number; path: string } }[]; samplers: { input: number; output: number; interpolation?: string }[] }[];
    images: { uri: string }[];
    materials: { pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[];
    textures: { source: number }[];
  };
  bin: Buffer;
}

const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(g: Gltf, i: number): { v: Float64Array; size: number; count: number } {
  const a = g.json.accessors[i];
  const size = SIZE[a.type];
  const v = new Float64Array(a.count * size);
  if (a.bufferView === undefined) {
    return { v, size, count: a.count };
  }
  const bv = g.json.bufferViews[a.bufferView];
  const bytes = { 5126: 4, 5125: 4, 5123: 2, 5122: 2, 5121: 1, 5120: 1 }[a.componentType]!;
  const stride = bv.byteStride ?? bytes * size;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  for (let k = 0; k < a.count; k++) {
    for (let c = 0; c < size; c++) {
      const o = base + k * stride + c * bytes;
      let x: number;
      switch (a.componentType) {
        case 5126:
          x = g.bin.readFloatLE(o);
          break;
        case 5125:
          x = g.bin.readUInt32LE(o);
          break;
        case 5123:
          x = g.bin.readUInt16LE(o);
          x = a.normalized ? x / 65535 : x;
          break;
        case 5122:
          x = g.bin.readInt16LE(o);
          x = a.normalized ? Math.max(x / 32767, -1) : x;
          break;
        case 5121:
          x = g.bin.readUInt8(o);
          x = a.normalized ? x / 255 : x;
          break;
        default:
          x = g.bin.readInt8(o);
          x = a.normalized ? Math.max(x / 127, -1) : x;
      }
      v[k * size + c] = x;
    }
  }
  return { v, size, count: a.count };
}

function mul(a: M4, b: M4): M4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        s += a[k * 4 + r] * b[c * 4 + k];
      }
      o[c * 4 + r] = s;
    }
  }
  return o;
}

function trs(t: number[], q: number[], s: number[]): M4 {
  const [x, y, z, w] = q;
  const m = new Float64Array(16);
  m[0] = (1 - 2 * (y * y + z * z)) * s[0];
  m[1] = 2 * (x * y + z * w) * s[0];
  m[2] = 2 * (x * z - y * w) * s[0];
  m[4] = 2 * (x * y - z * w) * s[1];
  m[5] = (1 - 2 * (x * x + z * z)) * s[1];
  m[6] = 2 * (y * z + x * w) * s[1];
  m[8] = 2 * (x * z + y * w) * s[2];
  m[9] = 2 * (y * z - x * w) * s[2];
  m[10] = (1 - 2 * (x * x + y * y)) * s[2];
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  m[15] = 1;
  return m;
}

/** Node TRS of one clip at time `t` (LINEAR, STEP and CUBICSPLINE samplers). */
function sampleClip(g: Gltf, clip: string, t: number): Map<number, { t?: number[]; r?: number[]; s?: number[] }> {
  const a = g.json.animations.find((q) => q.name === clip);
  const out = new Map<number, { t?: number[]; r?: number[]; s?: number[] }>();
  if (!a) {
    return out;
  }
  for (const ch of a.channels) {
    if (ch.target.node === undefined) {
      continue;
    }
    const smp = a.samplers[ch.sampler];
    const times = readAccessor(g, smp.input).v;
    const vals = readAccessor(g, smp.output);
    const cubic = smp.interpolation === 'CUBICSPLINE';
    const n = ch.target.path === 'rotation' ? 4 : 3;
    const at = (k: number): number[] => {
      const i = cubic ? k * 3 + 1 : k;
      return Array.from(vals.v.subarray(i * n, i * n + n));
    };
    let k = 0;
    while (k + 1 < times.length && times[k + 1] <= t) {
      k++;
    }
    let v: number[];
    if (k + 1 >= times.length || smp.interpolation === 'STEP' || t <= times[0]) {
      v = at(t <= times[0] ? 0 : k);
    } else {
      const f = (t - times[k]) / (times[k + 1] - times[k] || 1);
      const p = at(k);
      let q = at(k + 1);
      if (n === 4 && p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3] < 0) {
        q = q.map((x) => -x);
      }
      v = p.map((x, c) => x + (q[c] - x) * f);
      if (n === 4) {
        const l = Math.hypot(v[0], v[1], v[2], v[3]) || 1;
        v = v.map((x) => x / l);
      }
    }
    const e = out.get(ch.target.node) ?? {};
    if (ch.target.path === 'translation') {
      e.t = v;
    } else if (ch.target.path === 'rotation') {
      e.r = v;
    } else if (ch.target.path === 'scale') {
      e.s = v;
    }
    out.set(ch.target.node, e);
  }
  return out;
}

function clipDuration(g: Gltf, clip: string): number {
  const a = g.json.animations.find((q) => q.name === clip);
  let d = 0;
  for (const s of a?.samplers ?? []) {
    const v = readAccessor(g, s.input).v;
    d = Math.max(d, v[v.length - 1] ?? 0);
  }
  return d;
}

/** Skinned positions and normals (glTF scene space) of the model's mesh posed at `clip` time `t`. */
function pose(g: Gltf, clip: string, t: number): { pos: Float64Array; nrm: Float64Array } {
  const nodes = g.json.nodes;
  const parent = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));
  const anim = sampleClip(g, clip, t);
  const world = new Map<number, M4>();
  const worldOf = (i: number): M4 => {
    const known = world.get(i);
    if (known) {
      return known;
    }
    const n = nodes[i];
    const a = anim.get(i);
    const local = n.matrix && !a ? Float64Array.from(n.matrix) : trs(a?.t ?? n.translation ?? [0, 0, 0], a?.r ?? n.rotation ?? [0, 0, 0, 1], a?.s ?? n.scale ?? [1, 1, 1]);
    const m = parent[i] >= 0 ? mul(worldOf(parent[i]), local) : local;
    world.set(i, m);
    return m;
  };
  const meshNode = nodes.findIndex((n) => n.mesh !== undefined && n.skin !== undefined);
  const skin = g.json.skins[nodes[meshNode].skin!];
  const ibm = skin.inverseBindMatrices !== undefined ? readAccessor(g, skin.inverseBindMatrices).v : null;
  const joints = skin.joints.map((j, k) => mul(worldOf(j), ibm ? ibm.subarray(k * 16, k * 16 + 16) : trs([0, 0, 0], [0, 0, 0, 1], [1, 1, 1])));
  const prim = g.json.meshes[nodes[meshNode].mesh!].primitives[0];
  const P = readAccessor(g, prim.attributes.POSITION).v;
  const N = readAccessor(g, prim.attributes.NORMAL).v;
  const J = readAccessor(g, prim.attributes.JOINTS_0).v;
  const W = readAccessor(g, prim.attributes.WEIGHTS_0).v;
  const n = P.length / 3;
  const pos = new Float64Array(n * 3);
  const nrm = new Float64Array(n * 3);
  for (let v = 0; v < n; v++) {
    const [x, y, z] = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    const [nx, ny, nz] = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
    for (let k = 0; k < 4; k++) {
      const w = W[v * 4 + k];
      if (w <= 0) {
        continue;
      }
      const m = joints[J[v * 4 + k]];
      pos[v * 3] += w * (m[0] * x + m[4] * y + m[8] * z + m[12]);
      pos[v * 3 + 1] += w * (m[1] * x + m[5] * y + m[9] * z + m[13]);
      pos[v * 3 + 2] += w * (m[2] * x + m[6] * y + m[10] * z + m[14]);
      nrm[v * 3] += w * (m[0] * nx + m[4] * ny + m[8] * nz);
      nrm[v * 3 + 1] += w * (m[1] * nx + m[5] * ny + m[9] * nz);
      nrm[v * 3 + 2] += w * (m[2] * nx + m[6] * ny + m[10] * nz);
    }
    const l = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) || 1;
    nrm[v * 3] /= l;
    nrm[v * 3 + 1] /= l;
    nrm[v * 3 + 2] /= l;
  }
  return { pos, nrm };
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Base colour texture → vertex colours                                                                            */
/* ------------------------------------------------------------------------------------------------------------- */

/** The base-colour image as 8-bit RGB via macOS sips (BMP), `size` px square. */
function readImage(file: string, size: number): { w: number; h: number; px: (x: number, y: number) => [number, number, number, number] } {
  const dir = join(CACHE_DIR, 'tmp');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `pigeon_basecolor_${size}.bmp`);
  if (!existsSync(out)) {
    execFileSync('sips', ['-s', 'format', 'bmp', '-z', String(size), String(size), file, '--out', out], { stdio: 'ignore' });
  }
  const b = readFileSync(out);
  const off = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const hRaw = b.readInt32LE(22);
  const h = Math.abs(hRaw);
  const bpp = b.readUInt16LE(28) / 8;
  const row = Math.ceil((w * bpp) / 4) * 4;
  return {
    w,
    h,
    px: (x, y) => {
      const yy = hRaw > 0 ? h - 1 - y : y;
      const o = off + yy * row + x * bpp;
      return [b[o + 2], b[o + 1], b[o], bpp === 4 ? b[o + 3] : 255];
    },
  };
}

const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/* ------------------------------------------------------------------------------------------------------------- */
/* Baked variants                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------- */

interface Baked {
  positions: number[];
  normals: number[];
  indices: number[];
  colors: RGBA[];
}

let cache: { gltf: Gltf; colors: RGBA[]; indices: number[]; baked: Map<PigeonPose, Baked> } | null | undefined;

/** True when the cached source model is present. */
export function pigeonModelAvailable(): boolean {
  return existsSync(join(SOURCE_DIR, 'scene.gltf')) && existsSync(join(SOURCE_DIR, 'scene.bin'));
}

/** Names of the model's animation clips (for the manifest records), or [] without the source. */
export function pigeonClips(): string[] {
  const s = load();
  return s ? s.gltf.json.animations.map((a) => a.name) : [];
}

/** Frame of each static pose (clip @ seconds). */
export const PIGEON_POSES: Record<PigeonPose, string> = { standing: 'Idle@0.30', pecking: 'Eat@lowest-head', walking: 'WalkFoward@0.25' };

function load(): NonNullable<typeof cache> | null {
  if (cache !== undefined) {
    return cache;
  }
  if (!pigeonModelAvailable()) {
    cache = null;
    return null;
  }
  const json = JSON.parse(readFileSync(join(SOURCE_DIR, 'scene.gltf'), 'utf8')) as Gltf['json'];
  const gltf: Gltf = { json, bin: readFileSync(join(SOURCE_DIR, json.buffers[0].uri)) };
  const meshNode = json.nodes.findIndex((n) => n.mesh !== undefined && n.skin !== undefined);
  const prim = json.meshes[json.nodes[meshNode].mesh!].primitives[0];
  const uv = readAccessor(gltf, prim.attributes.TEXCOORD_0).v;
  const tex = json.materials[0]?.pbrMetallicRoughness?.baseColorTexture;
  const img = tex ? readImage(join(SOURCE_DIR, json.images[json.textures[tex.index].source].uri), 512) : null;
  const colors: RGBA[] = [];
  for (let v = 0; v < uv.length / 2; v++) {
    if (!img) {
      colors.push([0.3, 0.3, 0.32, 1]);
      continue;
    }
    // Average the opaque texels round the vertex (UV islands have transparent, black margins; vertices on island
    // borders search outwards until they find paint).
    const cx = Math.floor((((uv[v * 2] % 1) + 1) % 1) * img.w);
    const cy = Math.floor((((uv[v * 2 + 1] % 1) + 1) % 1) * img.h);
    let r = 0;
    let gg = 0;
    let bb = 0;
    let n = 0;
    for (let rad = 1; rad <= 8 && n === 0; rad++) {
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const [pr, pg, pb, pa] = img.px(Math.min(img.w - 1, Math.max(0, cx + dx)), Math.min(img.h - 1, Math.max(0, cy + dy)));
          if (pa < 200) {
            continue;
          }
          r += toLinear(pr);
          gg += toLinear(pg);
          bb += toLinear(pb);
          n++;
        }
      }
    }
    colors.push(n ? [r / n, gg / n, bb / n, 1] : [0.3, 0.3, 0.32, 1]);
  }
  const indices = prim.indices !== undefined ? Array.from(readAccessor(gltf, prim.indices).v) : [...Array(uv.length / 2).keys()];
  cache = { gltf, colors, indices, baked: new Map() };
  return cache;
}

/** Posed, oriented (head +Z), grounded and scaled mesh of one pose. */
function bake(p: PigeonPose): Baked | null {
  const s = load();
  if (!s) {
    return null;
  }
  const known = s.baked.get(p);
  if (known) {
    return known;
  }
  const g = s.gltf;
  let clip = 'Idle';
  let t = 0.3;
  if (p === 'walking') {
    clip = 'WalkFoward';
    t = 0.25;
  } else if (p === 'pecking') {
    // The frame of Eat where the highest point is lowest (head down at the ground).
    clip = 'Eat';
    const d = clipDuration(g, clip);
    let best = Infinity;
    for (let q = 0; q <= d; q += 0.05) {
      const { pos } = pose(g, clip, q);
      let top = -Infinity;
      let low = Infinity;
      for (let v = 1; v < pos.length; v += 3) {
        top = Math.max(top, pos[v]);
        low = Math.min(low, pos[v]);
      }
      if (top - low < best) {
        best = top - low;
        t = q;
      }
    }
  }
  const { pos, nrm } = pose(g, clip, t);
  // Orientation from the standing pose: the head is the highest point, forward is from the body centre towards it.
  const ref = p === 'standing' ? pos : pose(g, 'Idle', 0.3).pos;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let top = 0;
  for (let v = 0; v < ref.length / 3; v++) {
    minX = Math.min(minX, ref[v * 3]);
    maxX = Math.max(maxX, ref[v * 3]);
    minZ = Math.min(minZ, ref[v * 3 + 2]);
    maxZ = Math.max(maxZ, ref[v * 3 + 2]);
    if (ref[v * 3 + 1] > ref[top * 3 + 1]) {
      top = v;
    }
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const hx = ref[top * 3] - cx;
  const hz = ref[top * 3 + 2] - cz;
  const yaw = Math.atan2(hx, hz);
  const c = Math.cos(-yaw);
  const sn = Math.sin(-yaw);
  const len = Math.max(maxX - minX, maxZ - minZ) || 1;
  const k = LENGTH / len;
  const out: Baked = { positions: [], normals: [], indices: s.indices, colors: s.colors };
  let minY = Infinity;
  for (let v = 1; v < pos.length; v += 3) {
    minY = Math.min(minY, pos[v]);
  }
  for (let v = 0; v < pos.length / 3; v++) {
    const x = pos[v * 3] - cx;
    const z = pos[v * 3 + 2] - cz;
    // Rotate by -yaw about +Y so the head direction becomes +Z.
    out.positions.push((x * c + z * sn) * k, (pos[v * 3 + 1] - minY) * k, (-x * sn + z * c) * k);
    const nx = nrm[v * 3];
    const nz = nrm[v * 3 + 2];
    out.normals.push(nx * c + nz * sn, nrm[v * 3 + 1], -nx * sn + nz * c);
  }
  // Keep the source winding facing along the skinned normals (flip every triangle if most disagree).
  let agree = 0;
  const P = out.positions;
  for (let q = 0; q + 2 < out.indices.length; q += 3) {
    const [a, b2, c2] = [out.indices[q], out.indices[q + 1], out.indices[q + 2]];
    const e1 = [P[b2 * 3] - P[a * 3], P[b2 * 3 + 1] - P[a * 3 + 1], P[b2 * 3 + 2] - P[a * 3 + 2]];
    const e2 = [P[c2 * 3] - P[a * 3], P[c2 * 3 + 1] - P[a * 3 + 1], P[c2 * 3 + 2] - P[a * 3 + 2]];
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nn = [0, 1, 2].map((d) => out.normals[a * 3 + d] + out.normals[b2 * 3 + d] + out.normals[c2 * 3 + d]);
    agree += f[0] * nn[0] + f[1] * nn[1] + f[2] * nn[2] >= 0 ? 1 : -1;
  }
  if (agree < 0) {
    const flipped: number[] = [];
    for (let q = 0; q + 2 < out.indices.length; q += 3) {
      flipped.push(out.indices[q], out.indices[q + 2], out.indices[q + 1]);
    }
    out.indices = flipped;
  }
  s.baked.set(p, out);
  return out;
}

/**
 * Emits the model pigeon in a pose with material `m` (its colour multiplies the texture's vertex colours: morphs).
 * Returns false when the source model is not available.
 */
export function modelPigeon(mesh: TileMesh, m: string, p: PigeonPose): boolean {
  const b = bake(p);
  if (!b) {
    return false;
  }
  mesh.addMesh(m, { positions: b.positions, indices: b.indices, normals: b.normals, color: b.colors });
  return true;
}
