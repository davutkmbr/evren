/**
 * Parked vehicles (worker side): kerbside rows along the parking strips network.ts reserved (dense in residential
 * streets), and stalls in surface parking lots (amenity=parking). Slots stay clear of junctions, crossings,
 * signals, bus and tram stops, building footprints and anything that is not carriageway / lot.
 */
import { standFault } from '../../placement/stand';
import type { OsmData } from '../data';
import type { FootprintIndex } from '../shared/footprints';
import { pointInRing } from '../shared/geometry';
import { osmStandGround } from '../shared/stand';
import type { StreetSurface } from '../shared/street-surface';
import { MODEL_LENGTH, Model, paintOf, PARKED_MIX, pickModel } from './catalog';
import type { Edge } from './network';
import { PARK_STRIP } from './network';
import { offsetPolyline, pointAt, polyLength } from './paths';
import { PARKED_STRIDE } from './protocol';

/** Kerbside occupancy by street class. */
const OCCUPANCY: Record<string, number> = {
  residential: 0.86,
  living_street: 0.8,
  unclassified: 0.72,
  service: 0.55,
  tertiary: 0.62,
  tertiary_link: 0.3,
};

const LOT_SKIP = new Set(['multi-storey', 'underground', 'rooftop']);

export class ParkedBuffer {
  private readonly data: number[] = [];

  constructor(
    private readonly surface: StreetSurface,
    private readonly rng: () => number,
  ) {}

  get count(): number {
    return this.data.length / PARKED_STRIDE;
  }

  /** Adds a vehicle centred at (x, z) heading along yaw (object forward -Z), posed on the ground. */
  add(x: number, z: number, yaw: number, model: number): void {
    const s = this.surface;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const half = MODEL_LENGTH[model] * 0.35;
    const yf = s.heightAt(x + fx * half, z + fz * half);
    const yb = s.heightAt(x - fx * half, z - fz * half);
    const yr = s.heightAt(x - fz * 0.8, z + fx * 0.8);
    const yl = s.heightAt(x + fz * 0.8, z - fx * 0.8);
    const pitch = Math.atan2(yf - yb, half * 2);
    const roll = Math.atan2(yl - yr, 1.6);
    const c = paintOf(model, this.rng(), this.rng());
    this.data.push(x, (yf + yb + yr + yl) / 4, z, yaw, pitch, roll, model, c[0], c[1], c[2]);
  }

  take(): Float32Array {
    return Float32Array.from(this.data);
  }
}

function clearOf(list: readonly number[] | undefined, s: number, gap: number): boolean {
  if (!list) {
    return true;
  }
  for (const q of list) {
    if (Math.abs(q - s) < gap) {
      return false;
    }
  }
  return true;
}

/** Kerbside rows along every edge with a parking strip. */
export function parkKerbside(edges: readonly Edge[], keepClear: Map<number, number[]>, degree: (node: number) => number, out: ParkedBuffer, surface: StreetSurface, footprints: FootprintIndex, rng: () => number): void {
  // Shared stand rule (placement/stand.ts): parked cars stay on the OSM ground, on land (network edges run past it).
  const land = osmStandGround(surface, footprints);
  for (const e of edges) {
    if (e.deck || e.r.tunnel) {
      continue;
    }
    const occ = OCCUPANCY[e.r.kind] ?? 0.4;
    const clear = keepClear.get(e.id);
    const endGap0 = degree(e.from) >= 3 ? Math.max(e.trim0 + 3, 8) : 2;
    const endGap1 = degree(e.to) >= 3 ? Math.max(e.trim1 + 3, 8) : 2;
    for (const side of [1, -1] as const) {
      const strip = side > 0 ? e.parkR : e.parkL;
      if (strip <= 0) {
        continue;
      }
      const off = side * (e.width / 2 - PARK_STRIP / 2 + 0.08);
      const line = offsetPolyline(e.pts, off);
      const L = polyLength(line);
      // oneway streets: both rows face the travel direction; two-way: each row faces its own lane
      const facing = e.oneway || side > 0 ? 1 : -1;
      let s = endGap0 + rng() * 3;
      while (s < L - endGap1) {
        const r = rng();
        const model = pickModel(PARKED_MIX, rng());
        const len = MODEL_LENGTH[model];
        const gap = 0.5 + rng() * rng() * 2.4;
        const sc = s + len / 2;
        if (sc + len / 2 > L - endGap1) {
          break;
        }
        const edgeS = (sc / L) * e.len;
        if (r < occ && clearOf(clear, edgeS, 7 + len / 2)) {
          const p = pointAt(line, sc);
          const ok =
            standFault(land, p[0], p[1]) === null &&
            surface.distance(p[0] + p[2] * len * 0.4, p[1] + p[3] * len * 0.4) < -0.25 &&
            surface.distance(p[0] - p[2] * len * 0.4, p[1] - p[3] * len * 0.4) < -0.25;
          if (ok) {
            const yaw = facing > 0 ? Math.atan2(-p[2], -p[3]) : Math.atan2(p[2], p[3]);
            // small lateral / angular jitter: nobody parks perfectly
            const j = (rng() - 0.5) * 0.18;
            out.add(p[0] - p[3] * j * side, p[1] + p[2] * j * side, yaw + (rng() - 0.5) * 0.05, model);
          }
        } else if (r > 0.93 && rng() < 0.6) {
          // a scooter squeezed into the gap, angled to the kerb
          const p = pointAt(line, sc);
          if (!footprints.inside(p[0], p[1]) && surface.distance(p[0], p[1]) < -0.2) {
            const k = side * 0.55;
            out.add(p[0] - p[3] * k, p[1] + p[2] * k, Math.atan2(-p[2], -p[3]) + side * 1.1, Model.Moto);
          }
        }
        s += len + gap;
      }
    }
  }
}

/** Stalls in surface parking lots, rows along the lot's longest edge. */
export function parkLots(data: Pick<OsmData, 'areas'>, out: ParkedBuffer, surface: StreetSurface, footprints: FootprintIndex, rng: () => number): number {
  const land = osmStandGround(surface, footprints);
  let lots = 0;
  for (const a of data.areas) {
    if (a.kind !== 'amenity=parking' || (a.parking && LOT_SKIP.has(a.parking))) {
      continue;
    }
    const ring = a.ring;
    const n = ring.length / 2;
    let best = 0;
    let ux = 1;
    let uz = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = ring[j * 2] - ring[i * 2];
      const dz = ring[j * 2 + 1] - ring[i * 2 + 1];
      const l = Math.hypot(dx, dz);
      if (l > best) {
        best = l;
        ux = dx / l;
        uz = dz / l;
      }
    }
    const vx = -uz;
    const vz = ux;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const u = ring[i * 2] * ux + ring[i * 2 + 1] * uz;
      const v = ring[i * 2] * vx + ring[i * 2 + 1] * vz;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    if ((u1 - u0) * (v1 - v0) > 60000) {
      continue;
    }
    const inside = (u: number, v: number): boolean => {
      const x = u * ux + v * vx;
      const z = u * uz + v * vz;
      return pointInRing(ring, x, z) && surface.distance(x, z) > 0.3 && standFault(land, x, z) === null;
    };
    const STALL_W = 2.5;
    const STALL_D = 5.0;
    const AISLE = 6.0;
    let placed = 0;
    // pattern across v: [stall row facing -v][stall row facing +v][aisle]
    let v = v0 + 0.6;
    let row = 0;
    const occ = 0.62 + rng() * 0.3;
    while (v + STALL_D < v1) {
      const vc = v + STALL_D / 2;
      for (let u = u0 + 0.8 + STALL_W / 2; u < u1 - STALL_W / 2; u += STALL_W) {
        const ok = inside(u - 1.1, vc - 2.3) && inside(u + 1.1, vc - 2.3) && inside(u - 1.1, vc + 2.3) && inside(u + 1.1, vc + 2.3);
        if (!ok || rng() > occ) {
          continue;
        }
        const x = u * ux + vc * vx;
        const z = u * uz + vc * vz;
        const dir = row % 2 === 0 ? 1 : -1;
        const model = pickModel(PARKED_MIX, rng());
        // forward (-Z of the model) along -dir * v
        const fx = -vx * dir;
        const fz = -vz * dir;
        const back = (STALL_D - MODEL_LENGTH[model]) * 0.5 - 0.15;
        out.add(x + fx * back, z + fz * back, Math.atan2(-fx, -fz) + (rng() - 0.5) * 0.06, model);
        placed++;
      }
      v += STALL_D;
      row++;
      if (row % 2 === 0) {
        v += AISLE;
      }
    }
    if (placed) {
      lots++;
    }
  }
  return lots;
}
