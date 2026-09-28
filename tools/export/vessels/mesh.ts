/**
 * Vessel geometry to plain-float glTF (tools/export/vessels-gltf.ts).
 *
 * A vessel is one root node (the design's origin: midship on the design waterline, bow to -Z, starboard +X, +Y up,
 * metres) with a `hull` mesh node, one mesh node per moving or swappable part (`flag_0`, `radar_0`, `emblem_0`, ...)
 * placed at the part's pivot with its vertices relative to it, and empty `SOCKET_*` nodes for effects. Meshes have a
 * primitive per material slot (the glTF material name `vessel_<slot>`). Vertex data (no quantization, no meshopt:
 * Unreal's Interchange reads plain glTF only):
 *   COLOR_0     linear base colour, alpha 1
 *   TEXCOORD_0  surface coordinates in metres (walls: along the wall and up; decks and other flat faces: x and z)
 *   TEXCOORD_1  (roughness, metalness)
 *   TEXCOORD_2  (paint mode, emissive class): paint 0 baked colour, 1 x instance hull paint, 2 x accent palette;
 *               emissive 0 none, 1 cabin window, 2 crew window, 3 lamp, 4 sign, 5 glow (moored boats)
 *   TEXCOORD_3  (motion weight, glow strength): flag cloth 0 at the staff .. 1 at the fly; glow of class 5
 */
import { Document, NodeIO, type Material, type Mesh } from '@gltf-transform/core';
import type * as THREE from 'three';
import { Detail, Emit, type MeshPart } from '../../../src/world/life/util/mesh-builder';
import type { Layout } from './sources';

export type Vec3 = [number, number, number];

interface Prim {
  pos: number[];
  nrm: number[];
  col: number[];
  uv0: number[];
  uv1: number[];
  uv2: number[];
  uv3: number[];
  idx: number[];
}

const lower = (o: Record<string, number>): string[] => {
  const out: string[] = [];
  for (const [k, v] of Object.entries(o)) out[v] = k.toLowerCase();
  return out;
};
/** Detail pattern and emissive class names, by id (mesh-builder.ts). */
export const DETAIL_NAMES = lower(Detail);
export const EMIT_NAMES = lower(Emit);
/** Emissive class of the moored boats' glowing parts (lanterns, coals). */
export const EMIT_GLOW = 5;

/** Material slot of a surface: detail pattern, split by emissive class; moored boats: plain or glowing. */
export function slotOf(layout: Layout, detail: number, emit: number, glow: number): string {
  if (layout === 'prop') return glow > 0 ? 'boat_glow' : 'boat';
  const e = Math.round(emit);
  if (e === Emit.Lamp) return 'lamp';
  if (e === Emit.Sign) return 'sign';
  const d = DETAIL_NAMES[Math.round(detail)] ?? 'paint';
  return e > 0 ? `${d}_${EMIT_NAMES[e]}` : d;
}

/** Slots whose surfaces are open shells in the web (the moored boats' hull bands): drawn from both sides. */
export const TWO_SIDED = new Set(['boat', 'boat_glow']);

export class ExportMesh {
  readonly prims = new Map<string, Prim>();
  private readonly seen = new Map<string, Map<number, number>>();

  constructor(
    readonly name: string,
    /** Subtracted from every model-space position (the part's pivot). */
    readonly origin: Vec3,
  ) {}

  prim(slot: string): Prim {
    let p = this.prims.get(slot);
    if (!p) {
      p = { pos: [], nrm: [], col: [], uv0: [], uv1: [], uv2: [], uv3: [], idx: [] };
      this.prims.set(slot, p);
      this.seen.set(slot, new Map());
    }
    return p;
  }

  /** Output index of source vertex `key` in `slot`, adding it through `fill` the first time. */
  vertex(slot: string, key: number, fill: (p: Prim) => void): number {
    const p = this.prim(slot);
    const seen = this.seen.get(slot)!;
    let o = seen.get(key);
    if (o === undefined) {
      o = p.pos.length / 3;
      fill(p);
      seen.set(key, o);
    }
    return o;
  }

  triangles(): number {
    let n = 0;
    for (const p of this.prims.values()) n += p.idx.length / 3;
    return n;
  }

  /** Model-space bounds [min, max] (the origin added back). */
  bounds(): [Vec3, Vec3] {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of this.prims.values()) {
      for (let i = 0; i < p.pos.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const v = p.pos[i + k] + this.origin[k];
          if (v < min[k]) min[k] = v;
          if (v > max[k]) max[k] = v;
        }
      }
    }
    return [min, max];
  }
}

/** What a runtime does with each kind of part (all turn about +Y through the node origin). */
export const PART_ROLES: Record<string, string> = {
  flag: 'flutters in the wind: TEXCOORD_3.x runs 0 at the staff .. 1 at the fly',
  radar: 'turns about the axis',
  emblem: 'livery mark on the funnel: hide or replace',
};

export interface PartOut {
  node: string;
  kind: string;
  pivot: Vec3;
  mesh: ExportMesh;
}

export interface Converted {
  hull: ExportMesh;
  parts: PartOut[];
}

/** Reads a web vessel geometry (optionally turned half a turn about +Y) as a hull mesh and its parts. */
export function convert(g: THREE.BufferGeometry, layout: Layout, turn: boolean, name: string): Converted {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const col = g.getAttribute('color');
  const srf = layout === 'life' ? g.getAttribute('aSurf') : null;
  const det = layout === 'life' ? g.getAttribute('aDetail') : null;
  const glow = layout === 'prop' ? g.getAttribute('aGlow') : null;
  const index = g.getIndex();
  const tris = (index ? index.count : pos.count) / 3;
  const at = (t: number, k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);
  const s = turn ? -1 : 1;
  const px = (i: number): number => s * pos.getX(i);
  const pz = (i: number): number => s * pos.getZ(i);

  const partOf = new Int32Array(tris).fill(-1);
  const counters = new Map<string, number>();
  const parts: PartOut[] = ((g.userData.parts as MeshPart[] | undefined) ?? []).map((p, i) => {
    const n = counters.get(p.name) ?? 0;
    counters.set(p.name, n + 1);
    for (let t = p.start / 3; t < p.end / 3; t++) partOf[t] = i;
    const pivot: Vec3 = [s * p.pivot[0], p.pivot[1], s * p.pivot[2]];
    return { node: `${p.name}_${n}`, kind: p.name, pivot, mesh: new ExportMesh(`${name}_${p.name}_${n}`, pivot) };
  });
  const hull = new ExportMesh(`${name}_hull`, [0, 0, 0]);

  for (let t = 0; t < tris; t++) {
    const v = [at(t, 0), at(t, 1), at(t, 2)];
    const mesh = partOf[t] >= 0 ? parts[partOf[t]].mesh : hull;
    const detail = det ? det.getX(v[0]) : 0;
    const slot = slotOf(layout, detail, srf ? srf.getW(v[0]) : 0, glow ? glow.getX(v[0]) : 0);
    // Projection of TEXCOORD_0: decks always (x, z) like the shader; otherwise by the face's dominant axis.
    const e1x = px(v[1]) - px(v[0]);
    const e1y = pos.getY(v[1]) - pos.getY(v[0]);
    const e1z = pz(v[1]) - pz(v[0]);
    const e2x = px(v[2]) - px(v[0]);
    const e2y = pos.getY(v[2]) - pos.getY(v[0]);
    const e2z = pz(v[2]) - pz(v[0]);
    const nx = Math.abs(e1y * e2z - e1z * e2y);
    const ny = Math.abs(e1z * e2x - e1x * e2z);
    const nz = Math.abs(e1x * e2y - e1y * e2x);
    const proj = Math.round(detail) === Detail.Deck || (ny >= nx && ny >= nz) ? 0 : nx > nz ? 1 : 2;
    const out = v.map((i) =>
      mesh.vertex(slot, i * 4 + proj, (p) => {
        const x = px(i);
        const y = pos.getY(i);
        const z = pz(i);
        p.pos.push(x - mesh.origin[0], y - mesh.origin[1], z - mesh.origin[2]);
        const l = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i)) || 1;
        p.nrm.push((s * nrm.getX(i)) / l, nrm.getY(i) / l, (s * nrm.getZ(i)) / l);
        p.col.push(col.getX(i), col.getY(i), col.getZ(i), 1);
        if (proj === 0) p.uv0.push(x, z);
        else if (proj === 1) p.uv0.push(z, y);
        else p.uv0.push(x, y);
        if (srf) {
          p.uv1.push(srf.getY(i), srf.getZ(i));
          p.uv2.push(srf.getX(i), srf.getW(i));
          p.uv3.push(0, 0);
        } else {
          const gl = glow ? glow.getX(i) : 0;
          p.uv1.push(0.7, 0.05);
          p.uv2.push(0, gl > 0 ? EMIT_GLOW : 0);
          p.uv3.push(0, gl);
        }
      }),
    );
    mesh.prim(slot).idx.push(out[0], out[1], out[2]);
  }

  // Flag cloth: flutter weight from the staff (the pivot's vertical axis) to the fly end.
  for (const p of parts) {
    if (p.kind !== 'flag') continue;
    let max = 0;
    for (const pr of p.mesh.prims.values()) {
      for (let i = 0; i < pr.pos.length; i += 3) max = Math.max(max, Math.hypot(pr.pos[i], pr.pos[i + 2]));
    }
    for (const pr of p.mesh.prims.values()) {
      for (let i = 0, k = 0; i < pr.pos.length; i += 3, k += 2) pr.uv3[k] = max > 0 ? Math.hypot(pr.pos[i], pr.pos[i + 2]) / max : 0;
    }
  }
  return { hull, parts: parts.filter((p) => p.mesh.triangles() > 0) };
}

export interface SocketOut {
  name: string;
  position: Vec3;
  extras: Record<string, unknown>;
}

/** Material factors a plain glTF viewer shows before a runtime assigns its own materials. */
function materialOf(doc: Document, cache: Map<string, Material>, slot: string): Material {
  let m = cache.get(slot);
  if (!m) {
    const glass = slot.startsWith('glass');
    m = doc
      .createMaterial(`vessel_${slot}`)
      .setBaseColorFactor([1, 1, 1, 1])
      .setRoughnessFactor(glass ? 0.07 : slot === 'lamp' ? 0.3 : 0.6)
      .setMetallicFactor(0)
      .setDoubleSided(TWO_SIDED.has(slot));
    if (slot === 'lamp' || slot === 'boat_glow') m.setEmissiveFactor([1, 0.86, 0.66]);
    cache.set(slot, m);
  }
  return m;
}

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** Binary glTF of one vessel variant: root node, hull, parts on their pivots, sockets (sorted for stable bytes). */
export async function writeGlb(rootName: string, hull: ExportMesh, parts: readonly PartOut[], sockets: readonly SocketOut[], extras: Record<string, unknown>): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const materials = new Map<string, Material>();
  const acc = (type: 'VEC2' | 'VEC3' | 'VEC4' | 'SCALAR', array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const meshOf = (m: ExportMesh): Mesh | null => {
    if (!m.triangles()) return null;
    const mesh = doc.createMesh(m.name);
    for (const slot of [...m.prims.keys()].sort()) {
      const p = m.prims.get(slot)!;
      if (!p.idx.length) continue;
      const n = p.pos.length / 3;
      mesh.addPrimitive(
        doc
          .createPrimitive()
          .setAttribute('POSITION', acc('VEC3', new Float32Array(p.pos)))
          .setAttribute('NORMAL', acc('VEC3', new Float32Array(p.nrm)))
          .setAttribute('COLOR_0', acc('VEC4', new Float32Array(p.col)))
          .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(p.uv0)))
          .setAttribute('TEXCOORD_1', acc('VEC2', new Float32Array(p.uv1)))
          .setAttribute('TEXCOORD_2', acc('VEC2', new Float32Array(p.uv2)))
          .setAttribute('TEXCOORD_3', acc('VEC2', new Float32Array(p.uv3)))
          .setIndices(acc('SCALAR', n < 65536 ? new Uint16Array(p.idx) : new Uint32Array(p.idx)))
          .setMaterial(materialOf(doc, materials, slot)),
      );
    }
    return mesh;
  };
  const root = doc.createNode(rootName).setExtras(extras);
  const hullMesh = meshOf(hull);
  if (hullMesh) root.addChild(doc.createNode('hull').setMesh(hullMesh));
  for (const p of parts) {
    const mesh = meshOf(p.mesh);
    if (!mesh) continue;
    root.addChild(
      doc
        .createNode(p.node)
        .setTranslation(p.pivot.map(r4) as Vec3)
        .setMesh(mesh)
        .setExtras({ part: p.kind, role: PART_ROLES[p.kind] ?? 'static', pivot: 'this node', axis: [0, 1, 0] }),
    );
  }
  for (const s of sockets) {
    root.addChild(
      doc
        .createNode(`SOCKET_${s.name}`)
        .setTranslation(s.position.map(r4) as Vec3)
        .setExtras(s.extras),
    );
  }
  doc.createScene(rootName).addChild(root);
  return new NodeIO().writeBinary(doc);
}
