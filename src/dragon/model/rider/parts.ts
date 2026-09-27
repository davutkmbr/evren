/**
 * Rigid or simply-skinned rider parts outside the distance field (eyeballs, straps, lenses, the cloak) in the same
 * vertex layout as the sculpt mesh, and the merge of everything into one geometry.
 */
import * as THREE from 'three';
import type { SculptMesh } from './sdf/mesher';

export class PartsBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly si: number[] = [];
  readonly sw: number[] = [];
  readonly data: number[] = [];
  readonly extra: number[] = [];
  readonly idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vertex(p: THREE.Vector3, n: THREE.Vector3, bones: number[], weights: number[], data: [number, number, number, number], extra: [number, number, number] = [0, 0, 0]): number {
    const i = this.vertexCount;
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    for (let k = 0; k < 4; k++) {
      this.si.push(bones[k] ?? bones[0]);
      this.sw.push(weights[k] ?? 0);
    }
    this.data.push(...data);
    this.extra.push(...extra);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /**
   * UV sphere around `center` (rigid on `bone`); aExtra = the vertex direction in the sphere's frame (z = `forward`),
   * so the shader can paint an iris that turns with the bone.
   */
  sphere(center: THREE.Vector3, radius: number, forward: THREE.Vector3, up: THREE.Vector3, bone: number, mat: number, rings = 14, segs = 20, hidden = 0): void {
    const z = forward.clone().normalize();
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    const base = this.vertexCount;
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let r = 0; r <= rings; r++) {
      const th = (r / rings) * Math.PI;
      for (let s = 0; s <= segs; s++) {
        const ph = (s / segs) * Math.PI * 2;
        const lx = Math.sin(th) * Math.cos(ph);
        const ly = Math.sin(th) * Math.sin(ph);
        const lz = Math.cos(th);
        n.set(0, 0, 0).addScaledVector(x, lx).addScaledVector(y, ly).addScaledVector(z, lz);
        p.copy(center).addScaledVector(n, radius);
        this.vertex(p, n, [bone], [1], [mat, 0, hidden, -1], [lx, ly, lz]);
      }
    }
    const W = segs + 1;
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segs; s++) {
        const a = base + r * W + s;
        const b = a + W;
        this.tri(a, b, a + 1);
        this.tri(a + 1, b, b + 1);
      }
    }
  }
}

/** Sculpt mesh + parts -> one skinned geometry (rig space). */
export function mergeRiderGeometry(m: SculptMesh, parts: PartsBuilder): THREE.BufferGeometry {
  const nv = m.stats.vertices + parts.vertexCount;
  const ni = m.indices.length + parts.idx.length;
  const positions = new Float32Array(nv * 3);
  const normals = new Float32Array(nv * 3);
  const skinIndex = new Uint16Array(nv * 4);
  const skinWeight = new Float32Array(nv * 4);
  const data = new Float32Array(nv * 4);
  const extra = new Float32Array(nv * 3);
  const indices = new Uint32Array(ni);
  positions.set(m.positions);
  normals.set(m.normals);
  skinIndex.set(m.skinIndex);
  skinWeight.set(m.skinWeight);
  data.set(m.data);
  extra.set(m.extra);
  indices.set(m.indices);
  const v0 = m.stats.vertices;
  positions.set(parts.pos, v0 * 3);
  normals.set(parts.nrm, v0 * 3);
  skinIndex.set(parts.si, v0 * 4);
  skinWeight.set(parts.sw, v0 * 4);
  data.set(parts.data, v0 * 4);
  extra.set(parts.extra, v0 * 3);
  for (let i = 0; i < parts.idx.length; i++) {
    indices[m.indices.length + i] = parts.idx[i] + v0;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  g.setAttribute('aData', new THREE.BufferAttribute(data, 4));
  g.setAttribute('aExtra', new THREE.BufferAttribute(extra, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  return g;
}

/**
 * Riding cloak: two cloth layers (the inner mirrors the outer) joined by a hem strip along the free edges. Rest shape
 * streams back (flight); aExtra = offset to the draped shape (the shader blends by airspeed). aData.y = t down the
 * cloak, aData.w = 1 outer / 2 inner layer (the flutter flips the inner normal so both layers move together).
 */
export function buildCloak(parts: PartsBuilder, pivot: THREE.Vector3, halfWidth: number, bones: { chest: number; spine: number; cloak: number }, mat: number): void {
  const cols = 22;
  const rows = 18;
  const length = 1.2;
  const THICK = 0.007;
  const W = cols + 1;
  const grid: THREE.Vector3[] = [];
  const drape: THREE.Vector3[] = [];
  const smooth = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let r = 0; r <= rows; r++) {
    const d = (r / rows) * length;
    const k = d / length;
    for (let c = 0; c <= cols; c++) {
      const phi = THREE.MathUtils.lerp(-1.95, 1.95, c / cols);
      const sx = Math.sin(phi);
      const cz = Math.cos(phi);
      const attach = new THREE.Vector3(sx * halfWidth, 0.02 * (1 - cz), cz * 0.14 + 0.01).add(pivot);
      const side = Math.abs(sx);
      const streamDir = new THREE.Vector3(sx * (0.28 + 0.25 * side), -0.3 - 0.1 * side, 1).normalize();
      const p = attach.clone().addScaledVector(streamDir, d);
      p.y -= 0.06 * Math.sin(k * Math.PI) * (1 - side);
      const fold =
        0.05 * Math.sin(phi * 6.5 + 0.4 + 0.8 * Math.sin(phi * 2.3)) * smooth(0.0, 0.5, k) +
        0.012 * Math.sin(phi * 13 + 1.3 + d * 3) * k +
        0.008 * Math.sin(phi * 23 + 0.5) * smooth(0.85, 1, k);
      p.y += fold * (1 - 0.5 * side);
      p.x += fold * sx * 0.5;
      const down = Math.min(d, 0.5);
      const rest = Math.max(d - 0.5, 0);
      const dfold = 0.04 * Math.sin(phi * 6.5 + 0.4 + 0.8 * Math.sin(phi * 2.3)) * smooth(0.0, 0.4, k);
      const draped = attach
        .clone()
        .add(new THREE.Vector3(sx * (0.08 * d + 0.05 * side), -down * 0.92, 0.12 * down + 0.05 + dfold))
        .add(new THREE.Vector3(sx * 0.2 * rest, -0.15 * rest, rest * 0.9));
      grid.push(p);
      drape.push(draped.sub(p));
    }
  }
  const normals: THREE.Vector3[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      a.subVectors(grid[r * W + Math.min(c + 1, cols)], grid[r * W + Math.max(c - 1, 0)]);
      b.subVectors(grid[Math.min(r + 1, rows) * W + c], grid[Math.max(r - 1, 0) * W + c]);
      normals.push(new THREE.Vector3().crossVectors(b, a).normalize());
    }
  }
  const orient = normals[Math.floor(rows / 2) * W + Math.floor(cols / 2)].y < 0 ? -1 : 1;
  for (const n of normals) {
    n.multiplyScalar(orient);
  }
  const pos = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const addVertex = (i: number, layer: number, offsetInner = false): number => {
    const r = Math.floor(i / W);
    const t = r / rows;
    const free = smooth(0.0, 0.45, t);
    const wc = (1 - 0.35 * t) * (1 - free);
    const ws = 0.35 * t * (1 - free);
    pos.copy(grid[i]).addScaledVector(normals[i], layer === 1 || offsetInner ? -THICK : 0);
    nrm.copy(normals[i]).multiplyScalar(layer === 0 ? 1 : -1);
    const d = drape[i];
    return parts.vertex(pos, nrm, [bones.cloak, bones.chest, bones.spine], [free, wc, ws], [mat, t, 0, layer === 0 ? 1 : 2], [d.x, d.y, d.z]);
  };
  for (const layer of [0, 1]) {
    const base = parts.vertexCount;
    for (let i = 0; i < grid.length; i++) {
      addVertex(i, layer);
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i0 = base + r * W + c;
        const i1 = i0 + 1;
        const i2 = i0 + W;
        const i3 = i2 + 1;
        if ((layer === 0) === orient > 0) {
          parts.tri(i0, i2, i1);
          parts.tri(i1, i2, i3);
        } else {
          parts.tri(i0, i1, i2);
          parts.tri(i1, i3, i2);
        }
      }
    }
  }
  const edge: number[] = [];
  for (let r = 0; r <= rows; r++) {
    edge.push(r * W);
  }
  for (let c = 1; c <= cols; c++) {
    edge.push(rows * W + c);
  }
  for (let r = rows - 1; r >= 0; r--) {
    edge.push(r * W + cols);
  }
  const strip = parts.vertexCount;
  for (const i of edge) {
    addVertex(i, 0);
    addVertex(i, 0, true);
  }
  for (let k = 0; k < edge.length - 1; k++) {
    const o0 = strip + k * 2;
    parts.tri(o0, o0 + 1, o0 + 2);
    parts.tri(o0 + 1, o0 + 3, o0 + 2);
  }
}
