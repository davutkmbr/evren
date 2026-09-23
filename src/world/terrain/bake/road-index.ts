import * as THREE from 'three';
import type { RoadDef, RoadKind } from '../../../core/contracts';
import { ROAD_GRID_SIZE, ROAD_MARGIN, WORLD_HALF } from '../config';

/** Road kind codes used in GLSL. */
export const ROAD_KIND_CODE: Record<RoadKind, number> = { highway: 0, avenue: 1, street: 2, coastal: 3, bridge: 4 };

const TEX_WIDTH = 1024;
const MAX_PER_CELL = 15;
/** Douglas-Peucker tolerance (m): straight stretches collapse into long segments, curves keep their shape. */
const SIMPLIFY_TOLERANCE = 0.8;

export interface RoadIndex {
  texture: THREE.DataTexture;
  /** x = texture width, y = first list row, z = first segment row, w = segment count. */
  layout: THREE.Vector4;
}

interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  halfWidth: number;
  kind: number;
  along: number;
  length: number;
}

function simplify(points: { x: number; z: number }[], tolerance: number): { x: number; z: number }[] {
  if (points.length < 3) {
    return points.slice();
  }
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const a = points[i0];
    const b = points[i1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    let worst = -1;
    let worstD = tolerance;
    for (let i = i0 + 1; i < i1; i++) {
      const p = points[i];
      let t = l2 > 0 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i0, worst], [worst, i1]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

function segmentCellDistance(s: Segment, cx: number, cz: number): number {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((cx - s.ax) * dx + (cz - s.az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(s.ax + dx * t - cx, s.az + dz * t - cz);
}

/**
 * Packs the non-bridge geo roads into one RGBA32F texture for per-pixel analytic road shading:
 *   rows [0, y): cell headers, 4 cells per texel, value = listStart * 16 + count
 *   rows [y, z): segment indices, 4 per texel
 *   rows [z, ..): 2 texels per segment: (ax, az, bx, bz), (halfWidth, kind, along at a, length)
 */
export function buildRoadIndex(roads: readonly RoadDef[]): RoadIndex {
  const segments: Segment[] = [];
  for (const road of roads) {
    if (road.kind === 'bridge' || road.points.length < 2) {
      continue;
    }
    const pts = simplify(road.points.map((p) => ({ x: p.x, z: p.z })), SIMPLIFY_TOLERANCE);
    let along = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 0.01) {
        continue;
      }
      segments.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, halfWidth: road.width * 0.5, kind: ROAD_KIND_CODE[road.kind], along, length });
      along += length;
    }
  }

  const n = ROAD_GRID_SIZE;
  const cell = (WORLD_HALF * 2) / n;
  const halfDiag = cell * Math.SQRT1_2;
  const cells: number[][] = Array.from({ length: n * n }, () => []);
  segments.forEach((s, index) => {
    const reach = s.halfWidth + ROAD_MARGIN;
    const c0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - reach + WORLD_HALF) / cell));
    const c1 = Math.min(n - 1, Math.floor((Math.max(s.ax, s.bx) + reach + WORLD_HALF) / cell));
    const r0 = Math.max(0, Math.floor((Math.min(s.az, s.bz) - reach + WORLD_HALF) / cell));
    const r1 = Math.min(n - 1, Math.floor((Math.max(s.az, s.bz) + reach + WORLD_HALF) / cell));
    for (let r = r0; r <= r1; r++) {
      const cz = -WORLD_HALF + (r + 0.5) * cell;
      for (let c = c0; c <= c1; c++) {
        const cx = -WORLD_HALF + (c + 0.5) * cell;
        if (segmentCellDistance(s, cx, cz) <= reach + halfDiag) {
          cells[r * n + c].push(index);
        }
      }
    }
  });

  let listLength = 0;
  let dropped = 0;
  for (const list of cells) {
    if (list.length > MAX_PER_CELL) {
      dropped += list.length - MAX_PER_CELL;
      // Keep the widest roads when a junction cell overflows.
      list.sort((a, b) => segments[b].halfWidth - segments[a].halfWidth);
      list.length = MAX_PER_CELL;
    }
    listLength += list.length;
  }
  if (dropped > 0) {
    console.info(`[terrain] road index: ${dropped} segment references dropped in crowded cells`);
  }

  const headerRows = Math.ceil((n * n) / 4 / TEX_WIDTH);
  const listRows = Math.max(1, Math.ceil(listLength / 4 / TEX_WIDTH));
  const segRows = Math.max(1, Math.ceil((segments.length * 2) / TEX_WIDTH));
  const height = headerRows + listRows + segRows;
  const data = new Float32Array(TEX_WIDTH * height * 4);
  let listPos = 0;
  const listBase = headerRows * TEX_WIDTH * 4;
  cells.forEach((list, i) => {
    data[i] = listPos * 16 + list.length;
    for (const s of list) {
      data[listBase + listPos] = s;
      listPos++;
    }
  });
  const segBase = (headerRows + listRows) * TEX_WIDTH * 4;
  segments.forEach((s, i) => {
    const o = segBase + i * 8;
    data[o] = s.ax;
    data[o + 1] = s.az;
    data[o + 2] = s.bx;
    data[o + 3] = s.bz;
    data[o + 4] = s.halfWidth;
    data[o + 5] = s.kind;
    data[o + 6] = s.along;
    data[o + 7] = s.length;
  });
  const texture = new THREE.DataTexture(data, TEX_WIDTH, height, THREE.RGBAFormat, THREE.FloatType);
  texture.name = 'terrain-roads';
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, layout: new THREE.Vector4(TEX_WIDTH, headerRows, headerRows + listRows, segments.length) };
}
