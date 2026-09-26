/**
 * CPU skinning and a tiny z-buffered triangle rasteriser for the pose strip: every mesh of the rig is skinned on the
 * CPU (the vertex shaders' bind-space displacements included), projected with an orthographic camera and filled with
 * flat colours by part (near / far side, membrane, rider, tack). Depth and part edges get an outline so overlapping
 * limbs read; anything below the ground plane is flagged in red.
 */
import * as THREE from 'three';
import type { FrameRecord } from './runtime';

export type View = 'side' | 'front' | 'top' | 'three-quarter';
export const VIEWS: readonly View[] = ['side', 'front', 'top', 'three-quarter'];

/** Part classes (index into PALETTE). */
const enum Part {
  None = 0,
  Body = 1,
  BodyFar = 2,
  Membrane = 3,
  MembraneFar = 4,
  Rider = 5,
  RiderFar = 6,
  Tack = 7,
}

type RGB = readonly [number, number, number];
const PALETTE: readonly RGB[] = [
  [0, 0, 0],
  [38, 42, 49],
  [112, 120, 132],
  [66, 76, 92],
  [158, 167, 179],
  [168, 72, 44],
  [214, 132, 100],
  [96, 72, 50],
];
const BACKGROUND: RGB = [240, 236, 227];
const GROUND_FILL: RGB = [219, 209, 188];
const GROUND_LINE: RGB = [120, 104, 78];
const GROUND_TICK: RGB = [176, 162, 132];
const OUTLINE: RGB = [14, 16, 20];
const BELOW_GROUND: RGB = [222, 44, 36];
/** Sea scenarios: the water between the surface and the seabed, and the surface line. */
const WATER_FILL: RGB = [206, 222, 230];
const WATER_LINE: RGB = [86, 128, 150];
/** Model colour seen through the water (sea scenarios). */
function tintWet(c: RGB): RGB {
  return [Math.round(c[0] * 0.55 + 70), Math.round(c[1] * 0.55 + 105), Math.round(c[2] * 0.55 + 125)];
}

const LIMB_BONE = /^(thigh|shin|meta|foot|humerus|forearm|hand|thumb|finger)/;

/** Skinning data of one mesh, flattened for speed. */
export interface MeshData {
  name: string;
  count: number;
  position: Float32Array;
  normal: Float32Array;
  skinIndex: Uint16Array | Float32Array | Uint8Array;
  skinWeight: Float32Array;
  aData: Float32Array | null;
  aExtra: Float32Array | null;
  index: Uint32Array | Uint16Array;
  /** Part class per vertex. */
  part: Uint8Array;
  /** Bone with the largest skin weight, per vertex. */
  dominant: Uint16Array;
  kind: 'body' | 'membrane' | 'rider';
}

function asFloat(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined): Float32Array | null {
  if (!attr) {
    return null;
  }
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let k = 0; k < attr.itemSize; k++) {
      out[i * attr.itemSize + k] = attr.getComponent(i, k);
    }
  }
  return out;
}

/** Collects the rig's skinned meshes and classifies every vertex by the part it belongs to. */
export function collectMeshes(root: THREE.Object3D, boneNames: readonly string[]): MeshData[] {
  const meshes: MeshData[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) {
      return;
    }
    const g = mesh.geometry;
    const kind: MeshData['kind'] = mesh.name.includes('membrane') ? 'membrane' : mesh.name.includes('rider') ? 'rider' : 'body';
    const position = asFloat(g.attributes.position)!;
    const count = g.attributes.position.count;
    const skinIndexAttr = g.attributes.skinIndex;
    const skinIndex = new Uint16Array(count * 4);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 4; k++) {
        skinIndex[i * 4 + k] = skinIndexAttr.getComponent(i, k);
      }
    }
    const skinWeight = asFloat(g.attributes.skinWeight)!;
    const index = g.index ? (g.index.array as Uint32Array | Uint16Array) : Uint32Array.from({ length: count }, (_, i) => i);
    const part = new Uint8Array(count);
    const dominant = new Uint16Array(count);
    for (let i = 0; i < count; i++) {
      let best = 0;
      let bestW = -1;
      for (let k = 0; k < 4; k++) {
        const w = skinWeight[i * 4 + k];
        if (w > bestW) {
          bestW = w;
          best = skinIndex[i * 4 + k];
        }
      }
      dominant[i] = best;
      const bone = boneNames[best] ?? '';
      const left = bone.endsWith('L');
      if (kind === 'membrane') {
        part[i] = position[i * 3] < -0.3 ? Part.MembraneFar : Part.Membrane;
      } else if (kind === 'rider') {
        part[i] = bone.startsWith('rider') ? (left && bone !== 'riderPelvis' ? Part.RiderFar : Part.Rider) : Part.Tack;
      } else {
        part[i] = LIMB_BONE.test(bone) && left ? Part.BodyFar : Part.Body;
      }
    }
    meshes.push({
      name: mesh.name,
      count,
      position,
      normal: asFloat(g.attributes.normal)!,
      skinIndex,
      skinWeight,
      aData: asFloat(g.attributes.aData),
      aExtra: asFloat(g.attributes.aExtra),
      index,
      part,
      dominant,
      kind,
    });
  });
  return meshes;
}

/**
 * World-space vertex positions of a mesh for one recorded frame: the bind-space displacement of the mesh's vertex
 * shader (breathing, membrane billow and fold pleats, the cloak's drape; the time-driven flutter is left out), then
 * linear blend skinning with the recorded bone matrices (the same maths as SkinnedMesh.applyBoneTransform).
 */
export function skinMesh(m: MeshData, rec: FrameRecord, out: Float32Array): void {
  for (let i = 0; i < m.count; i++) {
    skinVertex(m, i, rec, out, i * 3);
  }
}

/** One vertex of skinMesh(), written to out[o..o+2]. */
export function skinVertex(m: MeshData, i: number, rec: FrameRecord, out: Float32Array, o: number): void {
  const B = rec.bones;
  const s = rec.shader;
  let px = m.position[i * 3];
  let py = m.position[i * 3 + 1];
  let pz = m.position[i * 3 + 2];
  const nx = m.normal[i * 3];
  const ny = m.normal[i * 3 + 1];
  const nz = m.normal[i * 3 + 2];
  const d = m.aData;
  if (d) {
    const dx = d[i * 4];
    const dy = d[i * 4 + 1];
    const dz = d[i * 4 + 2];
    const dw = d[i * 4 + 3];
    if (m.kind === 'body') {
      const k = dz * s.breath;
      px += nx * k;
      py += ny * k;
      pz += nz * k;
    } else if (m.kind === 'membrane') {
      const billow = dw > 0 ? s.billowRight : s.billowLeft;
      const pleats = s.foldSlack * Math.min(dx * 1.6, 1) * (0.6 * Math.sin(px * 6.3 + pz * 1.3) + 0.4 * Math.sin(px * 10.7 - pz * 2.1 + 1.3));
      const k = dx * billow + pleats;
      px += nx * k;
      py += ny * k;
      pz += nz * k;
    } else if (dw > 0.5 && m.aExtra) {
      const stream = Math.min(Math.max((s.airspeed - 3) / 22, 0), 1);
      const t2 = dy * dy;
      const e = m.aExtra;
      px += e[i * 3] * (1 - stream) + s.airflow[0] * t2 * (0.12 + 0.35 * stream);
      py += e[i * 3 + 1] * (1 - stream);
      pz += e[i * 3 + 2] * (1 - stream) + Math.max(s.airflow[2], 0) * t2 * 0.1 * (1 - stream) * Math.min(Math.max(s.airspeed / 6, 0), 1);
    }
  }
  let ox = 0;
  let oy = 0;
  let oz = 0;
  for (let k = 0; k < 4; k++) {
    const w = m.skinWeight[i * 4 + k];
    if (w === 0) {
      continue;
    }
    const b = m.skinIndex[i * 4 + k] * 16;
    ox += w * (B[b] * px + B[b + 4] * py + B[b + 8] * pz + B[b + 12]);
    oy += w * (B[b + 1] * px + B[b + 5] * py + B[b + 9] * pz + B[b + 13]);
    oz += w * (B[b + 2] * px + B[b + 6] * py + B[b + 10] * pz + B[b + 14]);
  }
  out[o] = ox;
  out[o + 1] = oy;
  out[o + 2] = oz;
}

/** Orthographic camera basis for a view, relative to the dragon's heading `yaw` (world, rad). */
export interface Camera {
  right: THREE.Vector3;
  up: THREE.Vector3;
  /** Viewing direction (into the screen). */
  dir: THREE.Vector3;
  center: THREE.Vector3;
  /** Pixels per metre (at the supersampled resolution). */
  scale: number;
}

export function makeCamera(view: View, yaw: number, center: THREE.Vector3, scale: number): Camera {
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const rightD = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const Y = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  let right: THREE.Vector3;
  let up: THREE.Vector3;
  if (view === 'top') {
    dir.set(0, -1, 0);
    right = rightD.clone();
    up = fwd.clone();
  } else {
    if (view === 'side') {
      dir.copy(rightD).negate();
    } else if (view === 'front') {
      dir.copy(fwd).negate();
    } else {
      // From ahead-right and above: the camera sits at right + 0.8 forward + 0.7 up.
      dir.copy(rightD).addScaledVector(fwd, 0.8).addScaledVector(Y, 0.7).normalize().negate();
    }
    right = new THREE.Vector3().crossVectors(dir, Y).normalize();
    up = new THREE.Vector3().crossVectors(right, dir).normalize();
  }
  return { right, up, dir, center: center.clone(), scale };
}

export interface Cell {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  /** Lowest skinned body/membrane point relative to the ground (m; negative = below the surface). */
  lowest: number;
}

/**
 * Renders one frame: ground (a line with world-fixed ticks in side/front view, a world-fixed grid seen from above),
 * then the model with a z-buffer at `ss`× supersampling, outlines at part and depth edges, box-filtered down.
 */
export function renderCell(meshes: readonly MeshData[], worlds: readonly Float32Array[], rec: FrameRecord, cam: Camera, width: number, height: number, ss: number): Cell {
  const W = width * ss;
  const H = height * ss;
  const depth = new Float32Array(W * H).fill(Infinity);
  const part = new Uint8Array(W * H);
  const below = new Uint8Array(W * H);
  // Sea scenarios: pixels of the model under the water surface are tinted, so the waterline reads in every view.
  const wet = new Uint8Array(W * H);
  // Sea scenarios draw the ground at the seabed (red = through it) and the water above it.
  const groundY = rec.seabedY ?? rec.surfaceY;
  const waterY = rec.waterY;
  const { right, up, dir, center, scale } = cam;
  const cx = W / 2;
  const cy = H / 2;
  let lowest = Infinity;

  for (let mi = 0; mi < meshes.length; mi++) {
    const m = meshes[mi];
    const wp = worlds[mi];
    const n = m.count;
    const sx = new Float32Array(n);
    const sy = new Float32Array(n);
    const sz = new Float32Array(n);
    const wy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = wp[i * 3] - center.x;
      const y = wp[i * 3 + 1] - center.y;
      const z = wp[i * 3 + 2] - center.z;
      sx[i] = cx + (x * right.x + y * right.y + z * right.z) * scale;
      sy[i] = cy - (x * up.x + y * up.y + z * up.z) * scale;
      sz[i] = x * dir.x + y * dir.y + z * dir.z;
      wy[i] = wp[i * 3 + 1] - groundY;
      if (m.kind !== 'rider' && wy[i] < lowest) {
        lowest = wy[i];
      }
    }
    const idx = m.index;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t];
      const b = idx[t + 1];
      const c = idx[t + 2];
      const ax = sx[a];
      const ay = sy[a];
      const bx = sx[b];
      const by = sy[b];
      const qx = sx[c];
      const qy = sy[c];
      const area = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
      if (Math.abs(area) < 1e-9) {
        continue;
      }
      let x0 = Math.floor(Math.min(ax, bx, qx));
      let x1 = Math.ceil(Math.max(ax, bx, qx));
      let y0 = Math.floor(Math.min(ay, by, qy));
      let y1 = Math.ceil(Math.max(ay, by, qy));
      if (x1 < 0 || y1 < 0 || x0 >= W || y0 >= H) {
        continue;
      }
      x0 = Math.max(x0, 0);
      y0 = Math.max(y0, 0);
      x1 = Math.min(x1, W - 1);
      y1 = Math.min(y1, H - 1);
      const inv = 1 / area;
      const pc = m.part[a];
      const za = sz[a];
      const zb = sz[b];
      const zc = sz[c];
      const ya = wy[a];
      const yb = wy[b];
      const yc = wy[c];
      for (let py = y0; py <= y1; py++) {
        const fy = py + 0.5;
        for (let px = x0; px <= x1; px++) {
          const fx = px + 0.5;
          const w0 = ((bx - fx) * (qy - fy) - (by - fy) * (qx - fx)) * inv;
          const w1 = ((qx - fx) * (ay - fy) - (qy - fy) * (ax - fx)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) {
            continue;
          }
          const z = w0 * za + w1 * zb + w2 * zc;
          const k = py * W + px;
          if (z < depth[k]) {
            depth[k] = z;
            part[k] = pc;
            const yk = w0 * ya + w1 * yb + w2 * yc;
            below[k] = yk < -0.05 ? 1 : 0;
            wet[k] = waterY !== undefined && yk + groundY < waterY ? 1 : 0;
          }
        }
      }
    }
  }

  // Background and ground.
  const hi = new Uint8ClampedArray(W * H * 3);
  const put = (k: number, c: RGB): void => {
    hi[k * 3] = c[0];
    hi[k * 3 + 1] = c[1];
    hi[k * 3 + 2] = c[2];
  };
  const edgeOn = Math.abs(dir.y) < 1e-3;
  const gy = cy - (groundY - center.y) * up.y * scale;
  const wy = waterY === undefined ? -Infinity : cy - (waterY - center.y) * up.y * scale;
  const tick = 2;
  const pxW = 1 / scale;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const k = py * W + px;
      let c = BACKGROUND;
      // World point on the view plane through the centre for this pixel.
      const a = (px + 0.5 - cx) / scale;
      const b = (cy - (py + 0.5)) / scale;
      if (edgeOn) {
        if (py + 0.5 > wy && py + 0.5 <= gy) {
          c = py + 0.5 < wy + 1.5 * ss ? WATER_LINE : WATER_FILL;
        }
        if (py + 0.5 > gy) {
          c = GROUND_FILL;
          const along = center.x * right.x + center.z * right.z + a;
          const m = ((along % tick) + tick) % tick;
          if (py + 0.5 < gy + 5 * ss && m < 1.5 * pxW) {
            c = GROUND_TICK;
          }
          if (py + 0.5 < gy + 1.5 * ss) {
            c = GROUND_LINE;
          }
        }
      } else {
        // Ray through the pixel meets the ground plane (sea scenarios: the water surface, gridded the same way).
        const ox = center.x + right.x * a + up.x * b;
        const oy = center.y + right.y * a + up.y * b;
        const oz = center.z + right.z * a + up.z * b;
        const t = ((waterY ?? groundY) - oy) / dir.y;
        const gx = ox + dir.x * t;
        const gz = oz + dir.z * t;
        c = waterY !== undefined ? WATER_FILL : GROUND_FILL;
        const mx = ((gx % tick) + tick) % tick;
        const mz = ((gz % tick) + tick) % tick;
        const lineW = 1.2 * pxW * (view3(dir) ? 1.5 : 1);
        if (mx < lineW || mz < lineW) {
          c = waterY !== undefined ? tintWet(GROUND_TICK) : GROUND_TICK;
        }
      }
      put(k, c);
    }
  }

  // Model with outlines.
  const edgeDepth = 0.6;
  const o = Math.max(1, Math.round(ss * 0.75));
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const k = py * W + px;
      const p = part[k];
      if (p === Part.None) {
        continue;
      }
      let edge = false;
      for (let d = 0; d < 4 && !edge; d++) {
        const nx = px + (d === 0 ? o : d === 1 ? -o : 0);
        const ny = py + (d === 2 ? o : d === 3 ? -o : 0);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) {
          edge = true;
          break;
        }
        const j = ny * W + nx;
        if (part[j] === Part.None) {
          edge = true;
        } else if (depth[j] - depth[k] > edgeDepth && part[j] !== p) {
          edge = true;
        } else if (depth[j] - depth[k] > 2 * edgeDepth) {
          edge = true;
        }
      }
      const c = below[k] ? BELOW_GROUND : edge ? OUTLINE : PALETTE[p];
      put(k, wet[k] && !below[k] ? tintWet(c) : c);
    }
  }

  // Box filter down to the output size.
  const rgba = new Uint8ClampedArray(width * height * 4);
  const n = ss * ss;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let bl = 0;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const k = ((y * ss + j) * W + x * ss + i) * 3;
          r += hi[k];
          g += hi[k + 1];
          bl += hi[k + 2];
        }
      }
      const q = (y * width + x) * 4;
      rgba[q] = r / n;
      rgba[q + 1] = g / n;
      rgba[q + 2] = bl / n;
      rgba[q + 3] = 255;
    }
  }
  return { width, height, rgba, lowest };
}

function view3(dir: THREE.Vector3): boolean {
  return Math.abs(dir.y) < 0.99;
}
