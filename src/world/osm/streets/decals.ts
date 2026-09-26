/**
 * Road paint, street ironwork and embedded rails, draped on the visible ground (StreetSurface.heightAt): lane lines
 * on multi-lane asphalt roads (kept out of junctions), zebra crossings at marked OSM crossing nodes, stop lines at
 * signals, yellow zig-zags at bus stops, manhole covers and kerb gullies, and grooved tram rails (steel head + dark
 * flangeway) for T1 / T5 and the İstiklal tram. Paint wear varies per street and per crossing.
 */
import type { OsmData } from '../data';
import { MeshBuf } from '../shared/buffers';
import { laneLines } from '../shared/ground-lines';
import { BoxGrid, hash, segDist } from '../shared/geometry';
import { Surf, type Street } from '../shared/street-field';
import { TRAM_PAINT_CLEAR, trackBedClearanceIndex, trackDistanceIndex, tramInlayHalf } from '../shared/tram-tracks';
import type { StreetSurface } from '../shared/street-surface';
import type { Marks } from './furniture';
import { GROUND_LAYER_INDEX } from './layers';

type Decal = MeshBuf;
type Rgb = [number, number, number];

export function decalMesh(): Decal {
  return new MeshBuf({ position: 3, normal: 3, color: 3 });
}

const WHITE: Rgb = [0.8, 0.8, 0.76];
const PAINT: Rgb = WHITE;
const YELLOW: Rgb = [0.82, 0.62, 0.08];
const GROOVE: Rgb = [0.03, 0.03, 0.03];
const RAIL: Rgb = [0.56, 0.55, 0.53];
const IRON: Rgb = [0.075, 0.072, 0.068];
const BED: Rgb = [0.5, 0.5, 0.5];
const BED_EDGE: Rgb = [0.7, 0.69, 0.66];
const IRON_RIM: Rgb = [0.2, 0.19, 0.17];

const worn = (c: Rgb, seed: number): Rgb => {
  const f = 0.72 + 0.28 * hash(seed);
  return [c[0] * f, c[1] * f, c[2] * f];
};

/** Half length (along the traffic) and half width (m) of a zebra stripe. */
const ZEBRA_HL = 1.6;
const ZEBRA_HW = 0.25;

/** Flat disc draped on the ground (manhole covers): rim ring and dark lid. */
function disc(out: Decal, surface: StreetSurface, x: number, z: number, r: number, lift: number): void {
  if (!surface.covers(x, z)) {
    return;
  }
  const n = 12;
  const y = surface.heightAt(x, z) + lift;
  const c = out.vertex(x, y, z, 0, 1, 0, ...IRON);
  const inner: number[] = [];
  const outer: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    inner.push(out.vertex(x + ca * r * 0.82, y, z + sa * r * 0.82, 0, 1, 0, ...IRON));
    outer.push(out.vertex(x + ca * r, y, z + sa * r, 0, 1, 0, ...IRON_RIM));
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // Counter-clockwise seen from above (+Y): x east, z south, so increasing angle turns clockwise; wind c, j, i.
    out.tri(c, inner[j], inner[i]);
    out.tri(inner[i], inner[j], outer[j]);
    out.tri(inner[i], outer[j], outer[i]);
  }
}

/**
 * Ribbon draped along a polyline, offset sideways by `offset` (right of the way positive); optional dash pattern
 * [on, off] and a `keep(x, z)` test per sample (e.g. out of junctions).
 */
function ribbon(out: Decal, surface: StreetSurface, pts: readonly number[], offset: number, halfWidth: number, lift: number, col: Rgb, dash?: [number, number], keep?: (x: number, z: number) => boolean): void {
  const step = 1;
  let dist = 0;
  let prevL = -1;
  let prevR = -1;
  let prevKeep = false;
  for (let k = 2; k < pts.length; k += 2) {
    const ax = pts[k - 2];
    const az = pts[k - 1];
    const bx = pts[k];
    const bz = pts[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-3) {
      continue;
    }
    const tx = (bx - ax) / len;
    const tz = (bz - az) / len;
    const rx = -tz;
    const rz = tx;
    const m = Math.max(1, Math.ceil(len / step));
    for (let s = k === 2 ? 0 : 1; s <= m; s++) {
      const f = (s / m) * len;
      const x = ax + tx * f + rx * offset;
      const z = az + tz * f + rz * offset;
      const on = !dash || (dist + f) % (dash[0] + dash[1]) < dash[0];
      const kept = surface.covers(x, z) && (!keep || keep(x, z));
      const lx = x - rx * halfWidth;
      const lz = z - rz * halfWidth;
      const qx = x + rx * halfWidth;
      const qz = z + rz * halfWidth;
      const l = out.vertex(lx, surface.heightAt(lx, lz) + lift, lz, 0, 1, 0, ...col);
      const r = out.vertex(qx, surface.heightAt(qx, qz) + lift, qz, 0, 1, 0, ...col);
      if (prevL >= 0 && on && kept && prevKeep) {
        out.tri(prevL, prevR, l);
        out.tri(prevR, r, l);
      }
      prevL = l;
      prevR = r;
      prevKeep = kept;
    }
    dist += len;
  }
}

/** Draped masonry strip (track beds) with world-metre UVs into ground texture layer `layer`. */
function bed(out: MeshBuf, surface: StreetSurface, pts: readonly number[], offset: number, halfWidth: number, lift: number, col: Rgb, layer: number): void {
  let prevL = -1;
  let prevR = -1;
  let prevKeep = false;
  for (let k = 2; k < pts.length; k += 2) {
    const ax = pts[k - 2];
    const az = pts[k - 1];
    const len = Math.hypot(pts[k] - ax, pts[k + 1] - az);
    if (len < 1e-3) {
      continue;
    }
    const tx = (pts[k] - ax) / len;
    const tz = (pts[k + 1] - az) / len;
    const m = Math.max(1, Math.ceil(len));
    for (let s = k === 2 ? 0 : 1; s <= m; s++) {
      const f = (s / m) * len;
      const x = ax + tx * f - tz * offset;
      const z = az + tz * f + tx * offset;
      const lx = x + tz * halfWidth;
      const lz = z - tx * halfWidth;
      const qx = x - tz * halfWidth;
      const qz = z + tx * halfWidth;
      // UVs 1.4x world metres: bed setts smaller than the street cobbles.
      const l = out.vertex(lx, surface.heightAt(lx, lz) + lift, lz, 0, 1, 0, ...col, lx * 1.4, lz * 1.4, layer);
      const r = out.vertex(qx, surface.heightAt(qx, qz) + lift, qz, 0, 1, 0, ...col, qx * 1.4, qz * 1.4, layer);
      const kept = surface.covers(x, z);
      if (prevL >= 0 && kept && prevKeep) {
        out.tri(prevL, prevR, l);
        out.tri(prevR, r, l);
      }
      prevL = l;
      prevR = r;
      prevKeep = kept;
    }
  }
}

/** Flat rectangle draped on the ground: centre, unit direction of the long side, half length / half width. */
function patch(out: Decal, surface: StreetSurface, cx: number, cz: number, tx: number, tz: number, hl: number, hw: number, lift: number, col: Rgb): void {
  ribbon(out, surface, [cx - tx * hl, cz - tz * hl, cx + tx * hl, cz + tz * hl], 0, hw, lift, col);
}

/** Marked crossings: OSM crossing nodes except crossing=unmarked / no and crossing:markings=no. */
export function crossingPoints(data: Pick<OsmData, 'points'>): number[] {
  const out: number[] = [];
  for (const p of data.points) {
    if (p.kind === 'highway=crossing' && p.crossing !== 'unmarked' && p.crossing !== 'no' && p.markings !== 'no') {
      out.push(p.x, p.z);
    }
  }
  return out;
}

export function buildDecals(streets: readonly Street[], data: Pick<OsmData, 'points' | 'rails' | 'roads'>, surface: StreetSurface, marks: Marks): { paint: Decal; rails: Decal; inlay: MeshBuf; crossings: number; zebraTrack: number; manholes: number } {
  const paint = decalMesh();
  const rails = decalMesh();

  // Junction discs (ref shared by 2+ carriageways): no lane paint inside them.
  const refHw = new Map<number, number>();
  const refCount = new Map<number, number>();
  for (const s of streets) {
    const refs = data.roads[s.road].refs;
    if (!refs) {
      continue;
    }
    for (let k = 0; k < refs.length; k += 2) {
      const ref = refs[k + 1];
      refCount.set(ref, (refCount.get(ref) ?? 0) + 1);
      refHw.set(ref, Math.max(refHw.get(ref) ?? 0, s.hw));
    }
  }
  const junctions = new BoxGrid(20);
  const jpts: number[] = [];
  for (const s of streets) {
    const refs = data.roads[s.road].refs;
    if (!refs) {
      continue;
    }
    for (let k = 0; k < refs.length; k += 2) {
      const ref = refs[k + 1];
      if ((refCount.get(ref) ?? 0) < 2) {
        continue;
      }
      const v = refs[k];
      const x = s.pts[v * 2];
      const z = s.pts[v * 2 + 1];
      const r = (refHw.get(ref) ?? 3) + 2.5;
      const id = jpts.push(x, z, r) / 3 - 1;
      junctions.add(id, x - r, z - r, x + r, z + r);
    }
  }
  const outOfJunctions = (x: number, z: number): boolean => {
    for (const id of junctions.at(x, z)) {
      if ((jpts[id * 3] - x) ** 2 + (jpts[id * 3 + 1] - z) ** 2 < jpts[id * 3 + 2] ** 2) {
        return false;
      }
    }
    return true;
  };

  // Lane lines on asphalt main roads (shared/ground-lines.ts: bridge decks continue them), TRAM_PAINT_CLEAR m clear
  // of the tram tracks and off the flush track bed (the compiler's placement rule `paintable`).
  const tramDist = trackDistanceIndex(surface.tramTracks, TRAM_PAINT_CLEAR);
  const laneKeep = (x: number, z: number): boolean => outOfJunctions(x, z) && tramDist(x, z) >= TRAM_PAINT_CLEAR && !surface.trackBedAt(x, z);
  for (const s of streets) {
    const PAINT = worn(WHITE, s.road);
    for (const l of laneLines(s)) {
      ribbon(paint, surface, s.pts, l.offset, l.halfWidth, 0.02, PAINT, l.dash, laneKeep);
    }
  }

  // Zebra crossings at OSM crossing nodes on asphalt / concrete / paved carriageways.
  const segs = new BoxGrid(30);
  const segList: [number, number, number, number, number][] = [];
  streets.forEach((s, si) => {
    if (s.pedestrian || s.surf === Surf.Cobble || s.surf === Surf.Granite) {
      return;
    }
    for (let k = 2; k < s.pts.length; k += 2) {
      const id = segList.push([s.pts[k - 2], s.pts[k - 1], s.pts[k], s.pts[k + 1], si]) - 1;
      segs.add(id, Math.min(s.pts[k - 2], s.pts[k]), Math.min(s.pts[k - 1], s.pts[k + 1]), Math.max(s.pts[k - 2], s.pts[k]), Math.max(s.pts[k - 1], s.pts[k + 1]));
    }
  });
  let crossings = 0;
  // Crossing paint stops at a tram track bed (the T1 crossings leave the granite bed bare; the compiler's placement
  // rule paint.zebraTrack): a stripe touching the bed (sett inlay / rail reach, or the flush track bed) is left out.
  let zebraTrack = 0;
  const bedClear = trackBedClearanceIndex(surface.tramTracks, 1);
  const onBed = (x: number, z: number): boolean => bedClear(x, z) < ZEBRA_HW || surface.trackBedAt(x, z);
  const points = crossingPoints(data);
  for (let c = 0; c < points.length; c += 2) {
    const px = points[c];
    const pz = points[c + 1];
    let best = -1;
    let bestD = 3;
    for (const id of segs.at(px, pz)) {
      const [ax, az, bx, bz] = segList[id];
      const d = segDist(px, pz, ax, az, bx, bz);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (best < 0) {
      continue;
    }
    const [ax, az, bx, bz, si] = segList[best];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    const tx = (bx - ax) / l;
    const tz = (bz - az) / l;
    const hw = streets[si].hw;
    const t = ((px - ax) * tx + (pz - az) * tz) / l;
    const cx = ax + (bx - ax) * Math.max(0, Math.min(1, t));
    const cz = az + (bz - az) * Math.max(0, Math.min(1, t));
    const stripes = Math.max(2, Math.floor((hw * 2 - 0.6) / 1.0));
    const zebra = worn(WHITE, c * 0.77 + 3);
    const start = -((stripes - 1) * 1.0) / 2;
    let drawn = 0;
    for (let i = 0; i < stripes; i++) {
      const o = start + i;
      const sx = cx - tz * o;
      const sz = cz + tx * o;
      let bed = false;
      for (let f = -ZEBRA_HL; f <= ZEBRA_HL + 1e-6 && !bed; f += ZEBRA_HL / 4) {
        bed = onBed(sx + tx * f, sz + tz * f);
      }
      if (bed) {
        zebraTrack++;
        continue;
      }
      patch(paint, surface, sx, sz, tx, tz, ZEBRA_HL, ZEBRA_HW, 0.025, zebra);
      drawn++;
    }
    if (drawn) {
      crossings++;
    }
  }

  // Stop lines at signals.
  const sl = marks.stopLines;
  for (let k = 0; k < sl.length; k += 5) {
    const [x, z, tx, tz, half] = [sl[k], sl[k + 1], sl[k + 2], sl[k + 3], sl[k + 4]];
    patch(paint, surface, x, z, -tz, tx, half, 0.2, 0.025, PAINT);
  }

  // Bus stop zig-zags (yellow) along the kerb.
  const bb = marks.busBays;
  for (let k = 0; k < bb.length; k += 5) {
    const [x, z, tx, tz, side] = [bb[k], bb[k + 1], bb[k + 2], bb[k + 3], bb[k + 4]];
    const rx = -tz * side;
    const rz = tx * side;
    const zig: number[] = [];
    for (let i = -6; i <= 6; i++) {
      const o = i % 2 === 0 ? 0.7 : -0.1;
      zig.push(x + tx * i * 1.2 + rx * o, z + tz * i * 1.2 + rz * o);
    }
    ribbon(paint, surface, zig, 0, 0.07, 0.025, YELLOW);
    ribbon(paint, surface, [x - tx * 7.2 + rx * 0.9, z - tz * 7.2 + rz * 0.9, x + tx * 7.2 + rx * 0.9, z + tz * 7.2 + rz * 0.9], 0, 0.07, 0.025, YELLOW);
  }

  // Street ironwork: manhole covers in the lanes, gullies at the kerbs.
  let manholes = 0;
  for (const s of streets) {
    if (s.pedestrian || s.hw < 2) {
      continue;
    }
    const kerb = s.kerbed;
    let along = 0;
    let next = 8 + hash(s.road * 0.37) * 20;
    let nextGully = 5 + hash(s.road * 0.91) * 10;
    for (let k = 2; k < s.pts.length; k += 2) {
      const ax = s.pts[k - 2];
      const az = s.pts[k - 1];
      const len = Math.hypot(s.pts[k] - ax, s.pts[k + 1] - az);
      if (len < 1e-3) {
        continue;
      }
      const tx = (s.pts[k] - ax) / len;
      const tz = (s.pts[k + 1] - az) / len;
      while (next < along + len) {
        const f = next - along;
        const h = hash(next * 1.37 + s.road);
        const o = (h - 0.5) * s.hw * 0.9;
        const x = ax + tx * f - tz * o;
        const z = az + tz * f + tx * o;
        if (surface.distance(x, z) < -0.6 && outOfJunctions(x, z)) {
          disc(paint, surface, x, z, 0.36, 0.018);
          manholes++;
        }
        next += 22 + hash(next + s.road * 3.1) * 30;
      }
      while (kerb && nextGully < along + len) {
        const f = nextGully - along;
        const side = hash(nextGully * 0.7 + s.road) < 0.5 ? -1 : 1;
        const o = side * (s.hw - 0.28);
        const x = ax + tx * f - tz * o;
        const z = az + tz * f + tx * o;
        if (surface.distance(x, z) < -0.1) {
          patch(paint, surface, x, z, tx, tz, 0.42, 0.18, 0.018, IRON);
        }
        nextGully += 18 + hash(nextGully + s.road) * 14;
      }
      along += len;
    }
  }

  // Track beds of the standard-gauge lines (T1, T5): granite setts between and beside the rails with a lighter
  // edging course; the metre-gauge İstiklal tram runs in the street's own granite slabs.
  const inlay = new MeshBuf({ position: 3, normal: 3, color: 3, aUvM: 2, aLayer: 1 });
  for (const t of surface.tramTracks) {
    const hw = tramInlayHalf(t.gauge);
    if (hw <= 0) {
      continue;
    }
    bed(inlay, surface, t.pts, 0, hw, 0.012, BED, GROUND_LAYER_INDEX.cobble);
    bed(inlay, surface, t.pts, hw - 0.1, 0.1, 0.014, BED_EDGE, GROUND_LAYER_INDEX.granite);
    bed(inlay, surface, t.pts, -hw + 0.1, 0.1, 0.014, BED_EDGE, GROUND_LAYER_INDEX.granite);
  }

  // Grooved tram rails: steel head with the flangeway groove on its inner side.
  for (const t of surface.tramTracks) {
    const g = t.gauge / 2;
    ribbon(rails, surface, t.pts, g + 0.035, 0.035, 0.022, RAIL);
    ribbon(rails, surface, t.pts, -g - 0.035, 0.035, 0.022, RAIL);
    ribbon(paint, surface, t.pts, g - 0.02, 0.02, 0.02, GROOVE);
    ribbon(paint, surface, t.pts, -g + 0.02, 0.02, 0.02, GROOVE);
  }
  return { paint, rails, inlay, crossings, zebraTrack, manholes };
}
