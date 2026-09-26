/**
 * Masonry built from OSM geometry (one mesh, masonry material with world-space UVs into the ground texture arrays):
 * - highway=steps as real flights (treads, risers and stepped cheek walls; Kamondo, Yüksek Kaldırım side stairs...),
 *   rising between the ground heights at both ends,
 * - raised tram platforms (railway=platform areas) with a yellow tactile strip along the track edge,
 * - quay walls along the water: granite coping on the ground edge and a stone wall down into the sea, darkened
 *   and stained towards the waterline.
 */
import type { WorldBounds } from '../../../core/contracts';
import type { OsmData } from '../data';
import { MeshBuf } from '../shared/buffers';
import { ringArea, segDist } from '../shared/geometry';
import { clipPlatformRing, PLATFORM_HEIGHT, platformClearance, tramPlatforms, type Path } from '../shared/street-field';
import { tracksNear } from '../shared/tram-tracks';
import type { StreetSurface } from '../shared/street-surface';
import { GROUND_LAYER_INDEX } from './layers';

export function masonryMesh(): MeshBuf {
  return new MeshBuf({ position: 3, normal: 3, color: 3, aUvM: 2, aLayer: 1 });
}

export type Rgb = [number, number, number];
const STEP_STONE: Rgb = [0.62, 0.61, 0.58];
const WALL_STONE: Rgb = [0.55, 0.53, 0.5];
const PLATFORM: Rgb = [0.72, 0.72, 0.7];
const TACTILE: Rgb = [0.95, 0.72, 0.1];
const PLATFORM_EDGE: Rgb = [0.8, 0.8, 0.78];
const PLATFORM_COPING: Rgb = [1.05, 1.05, 1.02];
const QUAY_COPING: Rgb = [0.86, 0.85, 0.81];
const QUAY_WALL: Rgb = [0.58, 0.57, 0.53];
const QUAY_WET: Rgb = [0.2, 0.22, 0.19];
/** Quay wall foot below the water (m). */
const QUAY_FOOT = -3;

/** Planar quad a-b-c-d (counter-clockwise seen from the front) with a flat normal and world-metre UVs. */
function quad(m: MeshBuf, a: number[], b: number[], c: number[], d: number[], col: Rgb, layer: number): void {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = d[0] - a[0];
  const vy = d[1] - a[1];
  const vz = d[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  // UVs: project on the plane most facing the normal.
  const uv = (p: number[]): [number, number] => (Math.abs(ny) > 0.7 ? [p[0], p[2]] : Math.abs(nx) > Math.abs(nz) ? [p[2], p[1]] : [p[0], p[1]]);
  const ids = [a, b, c, d].map((p) => m.vertex(p[0], p[1], p[2], nx, ny, nz, ...col, ...uv(p), layer));
  m.tri(ids[0], ids[1], ids[2]);
  m.tri(ids[0], ids[2], ids[3]);
}

/** Box between two centre points (a, b) on the ground plan, lateral half width hw, from y0 up to yTop (at a / b). */
export function slab(m: MeshBuf, ax: number, az: number, bx: number, bz: number, hw: number, y0: number, yTopA: number, yTopB: number, col: Rgb, layer: number, faces = { front: true, back: true, sides: true }): void {
  const l = Math.hypot(bx - ax, bz - az) || 1;
  const rx = -(bz - az) / l;
  const rz = (bx - ax) / l;
  const aL = [ax - rx * hw, yTopA, az - rz * hw];
  const aR = [ax + rx * hw, yTopA, az + rz * hw];
  const bL = [bx - rx * hw, yTopB, bz - rz * hw];
  const bR = [bx + rx * hw, yTopB, bz + rz * hw];
  const low = (p: number[]): number[] => [p[0], y0, p[2]];
  // quad() winds around (b - a) x (d - a); r is right of a->b seen from above, r x t points up.
  quad(m, aL, aR, bR, bL, col, layer);
  if (faces.front) {
    quad(m, low(aL), low(aR), aR, aL, col, layer);
  }
  if (faces.back) {
    quad(m, low(bR), low(bL), bL, bR, col, layer);
  }
  if (faces.sides) {
    quad(m, low(bL), low(aL), aL, bL, col, layer);
    quad(m, low(aR), low(bR), bR, aR, col, layer);
  }
}

/**
 * Beam between a and b with half width hw whose bottom and top follow the given heights at both ends (sloped rails,
 * hoarding bands): top, bottom and both long sides.
 */
export function beam(m: MeshBuf, ax: number, az: number, bx: number, bz: number, hw: number, ya0: number, ya1: number, yb0: number, yb1: number, col: Rgb, layer: number): void {
  const l = Math.hypot(bx - ax, bz - az) || 1;
  const rx = (-(bz - az) / l) * hw;
  const rz = ((bx - ax) / l) * hw;
  const aL = [ax - rx, az - rz];
  const aR = [ax + rx, az + rz];
  const bL = [bx - rx, bz - rz];
  const bR = [bx + rx, bz + rz];
  const P = (p: number[], y: number): number[] => [p[0], y, p[1]];
  quad(m, P(aL, ya1), P(aR, ya1), P(bR, yb1), P(bL, yb1), col, layer);
  quad(m, P(aL, ya0), P(bL, yb0), P(bR, yb0), P(aR, ya0), col, layer);
  quad(m, P(bL, yb0), P(aL, ya0), P(aL, ya1), P(bL, yb1), col, layer);
  quad(m, P(aR, ya0), P(bR, yb0), P(bR, yb1), P(aR, ya1), col, layer);
}

/** Point and tangent at arc length s along a polyline. */
function at(pts: readonly number[], cum: number[], s: number): [number, number, number, number] {
  let k = 1;
  while (k < cum.length - 1 && cum[k] < s) {
    k++;
  }
  const a = (k - 1) * 2;
  const seg = cum[k] - cum[k - 1] || 1;
  const t = Math.max(0, Math.min(1, (s - cum[k - 1]) / seg));
  const tx = (pts[a + 2] - pts[a]) / seg;
  const tz = (pts[a + 3] - pts[a + 1]) / seg;
  return [pts[a] + (pts[a + 2] - pts[a]) * t, pts[a + 1] + (pts[a + 3] - pts[a + 1]) * t, tx, tz];
}

export function buildSteps(m: MeshBuf, paths: readonly Path[], surface: StreetSurface): number {
  const stone = GROUND_LAYER_INDEX.granite;
  const wallLayer = GROUND_LAYER_INDEX.stone;
  let flights = 0;
  for (const p of paths) {
    if (p.kind !== 'steps' || p.pts.length < 4) {
      continue;
    }
    const pts = p.pts;
    const cum = [0];
    for (let k = 2; k < pts.length; k += 2) {
      cum.push(cum[cum.length - 1] + Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]));
    }
    const len = cum[cum.length - 1];
    // Trim the ends that run onto a carriageway (ways often end on the street's centre line).
    const clear = (s: number): boolean => {
      const [x, z] = at(pts, cum, s);
      return surface.distance(x, z) > 0.25;
    };
    let s0 = 0;
    while (s0 < len && !clear(s0)) {
      s0 += 0.25;
    }
    let s1 = len;
    while (s1 > s0 && !clear(s1)) {
      s1 -= 0.25;
    }
    if (s1 - s0 < 1.5) {
      continue;
    }
    const [xa, za] = at(pts, cum, s0);
    const [xb, zb] = at(pts, cum, s1);
    // Past the build rect there is no OSM ground (heights clamp to the rect edge): the flight would float.
    if (!surface.covers(xa, za) || !surface.covers(xb, zb)) {
      continue;
    }
    const ya = surface.heightAt(xa, za);
    const yb = surface.heightAt(xb, zb);
    const up = yb >= ya;
    const y0 = Math.min(ya, yb);
    const rise = Math.abs(yb - ya);
    if (rise < 0.3) {
      // Level "steps" (underpass mouths, mapping on flat ground): the path paving is enough.
      continue;
    }
    // Arc position of fraction t of the flight, from its low end.
    const sAt = (t: number): number => (up ? s0 + t * (s1 - s0) : s1 - t * (s1 - s0));
    const run = s1 - s0;
    // OSM step_count when it gives a plausible riser (it covers the whole way, trimmed ends included).
    const tagged = p.stepCount ? Math.round((p.stepCount * run) / len) : 0;
    const n = tagged >= 3 && rise / tagged > 0.08 && rise / tagged < 0.24 ? tagged : Math.max(3, Math.min(Math.round(run / 0.3), Math.round(rise / 0.16)));
    const r = rise / n;
    const hw = Math.max(0.6, Math.min(3, p.hw));
    for (let i = 0; i < n; i++) {
      const [ax, az] = at(pts, cum, sAt(i / n));
      const [bx, bz] = at(pts, cum, sAt((i + 1) / n));
      const top = y0 + (i + 1) * r + 0.04;
      const base = Math.min(surface.heightAt(ax, az), surface.heightAt(bx, bz)) - 0.3;
      slab(m, ax, az, bx, bz, hw, base, top, top, STEP_STONE, stone, { front: true, back: i === n - 1, sides: false });
      // Stepped cheek walls on both sides.
      for (const side of [-1, 1]) {
        const l = Math.hypot(bx - ax, bz - az) || 1;
        const ox = (-(bz - az) / l) * (hw + 0.14) * side;
        const oz = ((bx - ax) / l) * (hw + 0.14) * side;
        slab(m, ax + ox, az + oz, bx + ox, bz + oz, 0.14, base, top + 0.5, top + 0.5, WALL_STONE, wallLayer, { front: i === 0, back: i === n - 1, sides: true });
      }
    }
    flights++;
  }
  return flights;
}

/** Ear clipping of a simple polygon (flat x, z), returns triangle vertex indices (counter-clockwise from above). */
export function triangulate(ring: readonly number[]): number[] {
  const n = ring.length / 2;
  const idx = Array.from({ length: n }, (_, i) => i);
  // Positive shoelace area in x/z means clockwise seen from +Y (x east, z south); emit counter-clockwise.
  if (ringArea(ring) < 0) {
    idx.reverse();
  }
  const out: number[] = [];
  const x = (i: number): number => ring[i * 2];
  const z = (i: number): number => ring[i * 2 + 1];
  const cross = (a: number, b: number, c: number): number => (x(b) - x(a)) * (z(c) - z(a)) - (z(b) - z(a)) * (x(c) - x(a));
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) <= 0) {
        continue;
      }
      let inside = false;
      for (const q of idx) {
        if (q === a || q === b || q === c) {
          continue;
        }
        if (cross(a, b, q) > 0 && cross(b, c, q) > 0 && cross(c, a, q) > 0) {
          inside = true;
          break;
        }
      }
      if (inside) {
        continue;
      }
      out.push(a, c, b);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      break;
    }
  }
  if (idx.length === 3) {
    out.push(idx[0], idx[2], idx[1]);
  }
  return out;
}

export function buildPlatforms(m: MeshBuf, data: Pick<OsmData, 'areas' | 'rails'>, surface: StreetSurface): number {
  const layer = GROUND_LAYER_INDEX.sidewalk;
  const g = surface.ground;
  let count = 0;
  // Only the raised part of the outline (street-field.ts platformClearance: off the carriageway and clear of the
  // rails, where StreetSurface.heightAt raises it; OSM often draws the platform over the rails).
  const rings = tramPlatforms(data).flatMap((a) => {
    const tracks = tracksNear(surface.tramTracks, a.ring, 6);
    return clipPlatformRing(a.ring, platformClearance((x, z) => surface.distance(x, z), tracks)).map((ring) => ({ ring, tracks }));
  });
  for (const { ring, tracks } of rings) {
    if (Math.abs(ringArea(ring)) < 2) {
      continue;
    }
    const n = ring.length / 2;
    // The top follows the street slope PLATFORM_HEIGHT above the carriageway (StreetSurface.heightAt matches it).
    const topAt = (x: number, z: number): number => g.yAt(x, z) + PLATFORM_HEIGHT;
    const tris = triangulate(ring);
    const ids: number[] = [];
    for (let k = 0; k < n; k++) {
      const x = ring[k * 2];
      const z = ring[k * 2 + 1];
      ids.push(m.vertex(x, topAt(x, z), z, 0, 1, 0, ...PLATFORM, x, z, layer));
    }
    for (let k = 0; k < tris.length; k += 3) {
      m.tri(ids[tris[k]], ids[tris[k + 1]], ids[tris[k + 2]]);
    }
    const cw = ringArea(ring) > 0;
    for (let k = 0; k < n; k++) {
      const i = cw ? k : (k + 1) % n;
      const j = cw ? (k + 1) % n : k;
      const ax = ring[i * 2];
      const az = ring[i * 2 + 1];
      const bx = ring[j * 2];
      const bz = ring[j * 2 + 1];
      const ta = topAt(ax, az);
      const tb = topAt(bx, bz);
      // Outward side face: a->b runs clockwise seen from above (interior on the right), so it faces left.
      quad(m, [ax, ta - PLATFORM_HEIGHT - 0.25, az], [ax, ta, az], [bx, tb, bz], [bx, tb - PLATFORM_HEIGHT - 0.25, bz], PLATFORM_EDGE, GROUND_LAYER_INDEX.granite);
      // Tactile strip along edges that face a track.
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      let dTrack = Infinity;
      for (const t of tracks) {
        for (let q = 2; q < t.pts.length; q += 2) {
          dTrack = Math.min(dTrack, segDist(mx, mz, t.pts[q - 2], t.pts[q - 1], t.pts[q], t.pts[q + 1]));
        }
      }
      const el = Math.hypot(bx - ax, bz - az);
      if (dTrack < 3.5 && el > 3) {
        const ix = -(bz - az) / el;
        const iz = (bx - ax) / el;
        const sgn = ringContains(ring, mx + ix * 0.8, mz + iz * 0.8) ? 1 : -1;
        const strip = (o0: number, o1: number, col: Rgb): void => {
          const p0 = [ax + ix * sgn * o0, ta + 0.004, az + iz * sgn * o0];
          const p1 = [bx + ix * sgn * o0, tb + 0.004, bz + iz * sgn * o0];
          const p2 = [bx + ix * sgn * o1, tb + 0.004, bz + iz * sgn * o1];
          const p3 = [ax + ix * sgn * o1, ta + 0.004, az + iz * sgn * o1];
          const up = (p1[0] - p0[0]) * (p3[2] - p0[2]) - (p1[2] - p0[2]) * (p3[0] - p0[0]);
          if (up < 0) {
            quad(m, p0, p1, p2, p3, col, layer);
          } else {
            quad(m, p0, p3, p2, p1, col, layer);
          }
        };
        strip(0, 0.3, PLATFORM_COPING);
        strip(0.5, 0.9, TACTILE);
      }
    }
    count++;
  }
  return count;
}

function ringContains(r: readonly number[], x: number, z: number): boolean {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2];
    const zi = r[i * 2 + 1];
    const xj = r[j * 2];
    const zj = r[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Vertical wall quad along a -> b between heights (ya0, ya1) / (yb0, yb1), facing (fx, fz), bottom / top colours. */
function wallQuad(m: MeshBuf, ax: number, az: number, bx: number, bz: number, ya0: number, ya1: number, yb0: number, yb1: number, fx: number, fz: number, bottom: Rgb, top: Rgb, layer: number): void {
  const uvA = Math.abs(fx) > Math.abs(fz) ? az : ax;
  const uvB = Math.abs(fx) > Math.abs(fz) ? bz : bx;
  const v0 = m.vertex(ax, ya0, az, fx, 0, fz, ...bottom, uvA, ya0, layer);
  const v1 = m.vertex(bx, yb0, bz, fx, 0, fz, ...bottom, uvB, yb0, layer);
  const v2 = m.vertex(bx, yb1, bz, fx, 0, fz, ...top, uvB, yb1, layer);
  const v3 = m.vertex(ax, ya1, az, fx, 0, fz, ...top, uvA, ya1, layer);
  // (v0, v1, v2) winds around (b - a) x up = (-(bz - az), 0, bx - ax) rotated... keep it when that faces (fx, fz).
  if ((az - bz) * fx + (bx - ax) * fz > 0) {
    m.quad(v0, v1, v2, v3);
  } else {
    m.quad(v0, v3, v2, v1);
  }
}

/**
 * Quay walls from the ground mesh's cut segments at the quay edge (x0, y0, z0, x1, y1, z1 each): coping stones on top
 * of the edge and the wall face down to QUAY_FOOT, facing the water (down the coast distance gradient). Segments in
 * the rect's fade-out margin are skipped (the ground dissolves there).
 */
export function buildQuay(m: MeshBuf, segs: readonly number[], surface: StreetSurface, rect: WorldBounds): number {
  const geo = surface.geo;
  const wallLayer = GROUND_LAYER_INDEX.stone;
  const copeLayer = GROUND_LAYER_INDEX.granite;
  let count = 0;
  for (let k = 0; k < segs.length; k += 6) {
    let ax = segs[k];
    const ya = segs[k + 1];
    let az = segs[k + 2];
    let bx = segs[k + 3];
    const yb = segs[k + 4];
    let bz = segs[k + 5];
    const l = Math.hypot(bx - ax, bz - az);
    if (l < 0.02) {
      continue;
    }
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    if (Math.min(mx - rect.minX, rect.maxX - mx, mz - rect.minZ, rect.maxZ - mz) < 36) {
      continue;
    }
    // Water side: down the coast gradient, snapped perpendicular to the segment.
    const gx = geo.coast(mx + 1.5, mz) - geo.coast(mx - 1.5, mz);
    const gz = geo.coast(mx, mz + 1.5) - geo.coast(mx, mz - 1.5);
    const tx = (bx - ax) / l;
    const tz = (bz - az) / l;
    let wx = -tz;
    let wz = tx;
    if (wx * -gx + wz * -gz < 0) {
      wx = -wx;
      wz = -wz;
    }
    // Overlap neighbours slightly so the coping has no gaps at bends.
    ax -= tx * 0.06;
    az -= tz * 0.06;
    bx += tx * 0.06;
    bz += tz * 0.06;
    const top = 0.12;
    const over = 0.08;
    const inner = 0.6;
    // Coping top.
    const c0 = [ax + wx * over, ya + top, az + wz * over];
    const c1 = [bx + wx * over, yb + top, bz + wz * over];
    const c2 = [bx - wx * inner, yb + top, bz - wz * inner];
    const c3 = [ax - wx * inner, ya + top, az - wz * inner];
    const up = (c1[0] - c0[0]) * (c3[2] - c0[2]) - (c1[2] - c0[2]) * (c3[0] - c0[0]);
    if (up < 0) {
      quad(m, c0, c1, c2, c3, QUAY_COPING, copeLayer);
    } else {
      quad(m, c0, c3, c2, c1, QUAY_COPING, copeLayer);
    }
    // Coping front and inner lip, then the wall face below the coping.
    wallQuad(m, ax + wx * over, az + wz * over, bx + wx * over, bz + wz * over, ya - 0.14, ya + top, yb - 0.14, yb + top, wx, wz, QUAY_COPING, QUAY_COPING, copeLayer);
    wallQuad(m, ax - wx * inner, az - wz * inner, bx - wx * inner, bz - wz * inner, ya - 0.05, ya + top, yb - 0.05, yb + top, -wx, -wz, QUAY_COPING, QUAY_COPING, copeLayer);
    // Wall: wet and dark below the waterline, a stained band just above it, dry stone up to the coping.
    const wet = 0.05;
    const stain = 0.4;
    const ta = ya - 0.14;
    const tb = yb - 0.14;
    wallQuad(m, ax, az, bx, bz, QUAY_FOOT, Math.min(wet, ta), QUAY_FOOT, Math.min(wet, tb), wx, wz, QUAY_WET, QUAY_WET, wallLayer);
    if (ta > wet && tb > wet) {
      wallQuad(m, ax, az, bx, bz, wet, Math.min(stain, ta), wet, Math.min(stain, tb), wx, wz, QUAY_WET, QUAY_WALL, wallLayer);
      if (ta > stain && tb > stain) {
        wallQuad(m, ax, az, bx, bz, stain, ta, stain, tb, wx, wz, QUAY_WALL, QUAY_WALL, wallLayer);
      }
    }
    count++;
  }
  return count;
}
