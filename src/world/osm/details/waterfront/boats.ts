/**
 * Moored boats of the slice (worker side): the gilded balık-ekmek boats rocking at the Eminönü quay west of the
 * Galata Bridge, and small fishing kayıks along the Karaköy and Eminönü quays. The ferries and their piers belong to
 * the life module (world/life); boats keep clear of its berths. Boats are merged into one mesh; `aPivot` (x, z, yaw,
 * phase) lets the boat material rock each hull around its own keel (waterfront/material.ts).
 */
import * as THREE from 'three';
import { latLonToLocal } from '../../../../core/geo-coords';
import { PIERS } from '../../../life/data/places';
import type { OsmData } from '../../data';
import { MeshBuf } from '../../shared/buffers';
import { hash, segDist } from '../../shared/geometry';
import type { GeoSampler } from '../../shared/geo';
import type { MeshArrays } from '../../shared/protocol';
import { merge, part } from '../../shared/props';

type Rgb = number;

/**
 * Lofted hull: pointed bow (+Z) and a fuller stern, from the waterline region down to the keel, between heights y0
 * and y1 of the side (y = 0 is the waterline).
 */
function hullBand(L: number, B: number, y0: number, y1: number, keel: number, sternFull: number): THREE.BufferGeometry {
  const stations = 14;
  const pos: number[] = [];
  const idx: number[] = [];
  const half = (s: number): number => {
    const t = s * 2 - 1;
    const bow = t > 0 ? 1 - Math.pow(t, 2.2) : 1 - Math.pow(-t, 2.2) * (1 - sternFull);
    return (B / 2) * Math.max(0.02, bow);
  };
  const ring = (s: number, y: number): [number, number, number][] => {
    const w = half(s);
    const z = (s - 0.5) * L;
    const shape = (yy: number): number => (yy >= 0 ? w : w * Math.max(0.05, 1 + yy / keel));
    const ya = Math.max(y, -keel);
    return [
      [-shape(ya), ya, z],
      [shape(ya), ya, z],
    ];
  };
  const rows = [y1, (y0 + y1) / 2, y0];
  for (let i = 0; i <= stations; i++) {
    const s = i / stations;
    for (const y of rows) {
      const [l, r] = ring(s, y);
      pos.push(...l, ...r);
    }
  }
  const per = rows.length * 2;
  for (let i = 0; i < stations; i++) {
    for (let r = 0; r < rows.length - 1; r++) {
      const a = i * per + r * 2;
      const b = (i + 1) * per + r * 2;
      // left side (x < 0)
      idx.push(a, a + 2, b, b, a + 2, b + 2);
      // right side
      idx.push(a + 1, b + 1, a + 3, b + 1, b + 3, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

/** Flat deck plate following the hull plan at height y (bow towards +Z). */
function deck(L: number, B: number, y: number, sternFull: number): THREE.BufferGeometry {
  const n = 16;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const t = s * 2 - 1;
    const w = (B / 2) * Math.max(0.02, t > 0 ? 1 - Math.pow(t, 2.2) : 1 - Math.pow(-t, 2.2) * (1 - sternFull));
    pts.push(new THREE.Vector2(w, -(s - 0.5) * L));
  }
  for (let i = n; i >= 0; i--) {
    pts.push(new THREE.Vector2(-pts[i].x, pts[i].y));
  }
  // Shape points run clockwise in x/y here; ShapeGeometry fixes the winding. rotateX(-90°) maps (x, y) -> (x, -y).
  return new THREE.ShapeGeometry(new THREE.Shape(pts)).rotateX(-Math.PI / 2).translate(0, y, 0);
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Eminönü balık-ekmek boat: ornate wooden hull, gilded rail, red canopy on carved posts, lanterns and grills. */
function fishBreadBoat(hullCol: Rgb, trim: Rgb, canopy: Rgb): THREE.BufferGeometry {
  const L = 14;
  const B = 4.6;
  const parts = [
    part(hullBand(L, B, -0.9, 0.2, 0.9, 0.55), 0x5a1d17),
    part(hullBand(L, B, 0.2, 1.05, 0.9, 0.55), hullCol),
    part(hullBand(L, B * 1.02, 1.05, 1.3, 0.9, 0.55), trim),
    part(deck(L * 0.98, B * 0.98, 1.1, 0.55), 0x8a6a45),
  ];
  // Canopy on posts over the middle of the deck.
  for (const x of [-1.9, 1.9]) {
    for (const z of [-4.5, -1.5, 1.5, 4.0]) {
      parts.push(part(box(0.12, 2.3, 0.12, x * (Math.abs(z) > 4 ? 0.8 : 1), 2.3, z), trim));
    }
  }
  parts.push(part(box(4.3, 0.12, 10.2, 0, 3.5, -0.3), canopy));
  parts.push(part(box(4.4, 0.35, 0.06, 0, 3.3, 4.85), trim, 0.2));
  parts.push(part(box(4.4, 0.35, 0.06, 0, 3.3, -5.45), trim, 0.2));
  parts.push(part(box(0.06, 0.35, 10.2, 2.18, 3.3, -0.3), trim, 0.2));
  parts.push(part(box(0.06, 0.35, 10.2, -2.18, 3.3, -0.3), trim, 0.2));
  // Grills along the quay side, with glowing coals.
  parts.push(part(box(0.9, 0.9, 5, 1.5, 1.55, -0.5), 0x3c3c3c));
  parts.push(part(box(0.8, 0.05, 4.8, 1.5, 2.02, -0.5), 0xff7a2a, 0.9));
  // Lanterns under the canopy and on the bow.
  for (const z of [-4, -1, 2]) {
    parts.push(part(box(0.25, 0.35, 0.25, 0, 3.1, z), 0xf4d38a, 1));
  }
  parts.push(part(box(0.3, 0.45, 0.3, 0, 2.0, 6.3), 0xf4d38a, 1));
  // Bow ornament and flag staff.
  parts.push(part(box(0.1, 1.6, 0.1, 0, 2.0, 6.7), trim));
  return merge(parts);
}

/** Small open fishing boat (kayık) with a little wheelhouse. */
function kayik(hullCol: Rgb, stripe: Rgb): THREE.BufferGeometry {
  const L = 7.5;
  const B = 2.4;
  return merge([
    part(hullBand(L, B, -0.5, 0.35, 0.5, 0.35), 0x6d2a20),
    part(hullBand(L, B, 0.35, 0.75, 0.5, 0.35), hullCol),
    part(hullBand(L, B * 1.01, 0.75, 0.9, 0.5, 0.35), stripe),
    part(deck(L * 0.96, B * 0.96, 0.62, 0.35), 0x9a8266),
    part(box(1.2, 1.1, 1.3, 0, 1.2, -0.8), 0xe8e4da),
    part(box(1.3, 0.08, 1.4, 0, 1.8, -0.8), stripe),
    part(box(0.9, 0.4, 0.03, 0, 1.35, -0.14), 0x6f8a94),
  ]);
}

interface Model {
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
  glow: Float32Array;
  count: number;
}

function flatten(g: THREE.BufferGeometry): Model {
  const src = g.index ? g.toNonIndexed() : g;
  return {
    pos: src.getAttribute('position').array as Float32Array,
    nrm: src.getAttribute('normal').array as Float32Array,
    col: src.getAttribute('color').array as Float32Array,
    glow: src.getAttribute('aGlow').array as Float32Array,
    count: src.getAttribute('position').count,
  };
}

class BoatStamper {
  readonly mesh = new MeshBuf({ position: 3, normal: 3, color: 3, aGlow: 1, aPivot: 4 });
  count = 0;

  add(m: Model, x: number, z: number, yaw: number, phase: number): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (let v = 0; v < m.count; v++) {
      const o = v * 3;
      const px = m.pos[o];
      const pz = m.pos[o + 2];
      const nx = m.nrm[o];
      const nz = m.nrm[o + 2];
      this.mesh.vertex(x + px * c + pz * s, m.pos[o + 1], z - px * s + pz * c, nx * c + nz * s, m.nrm[o + 1], -nx * s + nz * c, m.col[o], m.col[o + 1], m.col[o + 2], m.glow[v], x, z, yaw, phase);
    }
    const base = this.mesh.count - m.count;
    for (let v = 0; v < m.count; v += 3) {
      this.mesh.tri(base + v, base + v + 1, base + v + 2);
    }
    this.count++;
  }
}

/** Life-module ferry berths (keep boats clear of the ferries' approach). */
function berths(): number[] {
  const out: number[] = [];
  for (const p of PIERS) {
    for (const [lat, lon] of p.berths) {
      const q = latLonToLocal(lat, lon);
      out.push(q.x, q.z);
    }
  }
  return out;
}

export interface BoatResult {
  mesh: MeshArrays | null;
  /** Mooring anchors (x, z pairs) for quay bollards. */
  anchors: number[];
  count: number;
}

/**
 * Moors boats along the OSM coastline near `anchors` ([x, z, kind] with kind 0 fish-bread boats, 1 kayıks): hulls
 * parallel to the quay, 1.2 m off it, every boat fully in water and away from the ferry berths.
 */
function moorAlong(data: Pick<OsmData, 'lines'>, geo: GeoSampler, ax: number, az: number, reach: number, spacing: number, max: number, keep: number[], cb: (x: number, z: number, yaw: number, i: number) => void): void {
  const avoid = berths();
  let placed = 0;
  let best: { l: number[]; k: number; d: number } | null = null;
  for (const l of data.lines) {
    if (l.kind !== 'natural=coastline') {
      continue;
    }
    for (let k = 2; k < l.pts.length; k += 2) {
      const d = segDist(ax, az, l.pts[k - 2], l.pts[k - 1], l.pts[k], l.pts[k + 1]);
      if (!best || d < best.d) {
        best = { l: l.pts, k, d };
      }
    }
  }
  if (!best || best.d > 60) {
    return;
  }
  const pts = best.l;
  for (let k = 2; k < pts.length && placed < max; k += 2) {
    const x0 = pts[k - 2];
    const z0 = pts[k - 1];
    const x1 = pts[k];
    const z1 = pts[k + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < spacing) {
      continue;
    }
    const tx = (x1 - x0) / len;
    const tz = (z1 - z0) / len;
    for (let f = spacing / 2; f < len - spacing / 2 && placed < max; f += spacing) {
      const qx = x0 + tx * f;
      const qz = z0 + tz * f;
      if (Math.hypot(qx - ax, qz - az) > reach) {
        continue;
      }
      let clear = true;
      for (let b = 0; b < avoid.length && clear; b += 2) {
        clear = Math.hypot(avoid[b] - qx, avoid[b + 1] - qz) > 55;
      }
      for (let b = 0; b < keep.length && clear; b += 2) {
        clear = Math.hypot(keep[b] - qx, keep[b + 1] - qz) > spacing * 0.9;
      }
      if (!clear) {
        continue;
      }
      // Seaward is the right of the coastline direction (land on the left).
      for (const off of [3.2, 4.5, 6]) {
        const bx = qx - tz * off;
        const bz = qz + tx * off;
        const ends = [bx + tx * spacing * 0.45, bz + tz * spacing * 0.45, bx - tx * spacing * 0.45, bz - tz * spacing * 0.45];
        if (geo.coast(bx, bz) < -1.5 && geo.coast(ends[0], ends[1]) < -0.8 && geo.coast(ends[2], ends[3]) < -0.8) {
          cb(bx, bz, Math.atan2(tx, tz), placed);
          keep.push(qx, qz);
          placed++;
          break;
        }
      }
    }
  }
}

export function buildBoats(data: Pick<OsmData, 'lines' | 'roads'>, geo: GeoSampler): BoatResult {
  const stamper = new BoatStamper();
  const anchors: number[] = [];
  const fish = [fishBreadBoat(0x1f3f86, 0xd7a93a, 0xa3201b), fishBreadBoat(0x8f1d1d, 0xe0b441, 0x1c3f7a), fishBreadBoat(0x1b5a3a, 0xd9ad40, 0xa3201b)].map(flatten);
  const small = [kayik(0xe9e6de, 0x1d5fa8), kayik(0x2a7d9a, 0xe9e6de), kayik(0xe9e6de, 0x2e8a4a), kayik(0xd8b04a, 0x2b2b2b)].map(flatten);
  // Galata Bridge southern end: the fish-bread boats lie just west of it on the Eminönü side.
  const bridge = data.roads.filter((r) => r.bridge && r.name && /Galata Köprüsü/i.test(r.name));
  let south: [number, number] | null = null;
  let north: [number, number] | null = null;
  for (const r of bridge) {
    for (const k of [0, r.pts.length - 2]) {
      const p: [number, number] = [r.pts[k], r.pts[k + 1]];
      if (!south || p[1] > south[1]) south = p;
      if (!north || p[1] < north[1]) north = p;
    }
  }
  const keep: number[] = [];
  if (south) {
    const [sx, sz] = south;
    moorAlong(data, geo, sx - 70, sz + 10, 90, 16, 3, keep, (x, z, yaw, i) => {
      stamper.add(fish[i % fish.length], x, z, yaw, hash(i * 3.3) * 6.28);
      anchors.push(x, z);
    });
    moorAlong(data, geo, sx - 170, sz + 30, 70, 9, 4, keep, (x, z, yaw, i) => stamper.add(small[i % small.length], x, z, yaw + (hash(i) < 0.5 ? 0 : Math.PI), hash(i * 7.1) * 6.28));
  }
  if (north) {
    const [nx, nz] = north;
    moorAlong(data, geo, nx - 60, nz, 80, 9, 5, keep, (x, z, yaw, i) => {
      stamper.add(small[(i + 1) % small.length], x, z, yaw + (hash(i * 1.3) < 0.5 ? 0 : Math.PI), hash(i * 5.7) * 6.28);
      anchors.push(x, z);
    });
    moorAlong(data, geo, nx + 90, nz + 10, 60, 9, 3, keep, (x, z, yaw, i) => {
      stamper.add(small[(i + 2) % small.length], x, z, yaw + (hash(i * 2.3) < 0.5 ? 0 : Math.PI), hash(i * 4.1) * 6.28);
      anchors.push(x, z);
    });
  }
  return { mesh: stamper.count ? stamper.mesh.take('color') : null, anchors, count: stamper.count };
}
