/**
 * Infill of city blocks OpenStreetMap leaves empty (worker side). Parts of Beyoğlu, Karaköy and Tophane are mapped
 * with gaps: whole block edges without building outlines, which read as empty grey lots between streets. Real
 * blocks there are perimeter blocks of narrow row buildings, so the infill walks every street and places row
 * parcels (6-12 m frontage, 8-18 m deep) on free land facing it.
 *
 * Land counts as free when it is not street / sidewalk (street raster), not an OSM building, not a mapped open space
 * (parks, squares, parking, platforms, piers, pitches, construction sites...), not near a railway, not a landmark
 * pad, and not water / park / forest / cemetery land use. Parcels are only placed where the surrounding 60 m are
 * already built up (OSM building cover >= MIN_COVER), so genuinely open areas stay open.
 *
 * No parcel reaches into a compiled street area (`keepOut`): the street tiles draw only the mapped buildings up close,
 * so the city seen from the air has to be the same there.
 */
import type { WorldBounds } from '../../../core/contracts';
import { LandUse } from '../../../core/contracts';
import type { OsmArea, OsmBuilding, OsmRail, OsmRoad } from '../data';
import { hash } from '../shared/geometry';
import { Ground, type StreetSurface } from '../shared/street-surface';

/** Open-space area kinds that must stay free. */
const OPEN = /^(leisure=(park|garden|pitch|playground|sports_centre|track|dog_park|common)|landuse=(grass|forest|cemetery|construction|railway|religious|military|meadow|recreation_ground|village_green|harbour|brownfield|greenfield)|amenity=(parking|ferry_terminal|fountain|bus_station|taxi|marketplace|grave_yard)|place=square|highway=pedestrian|railway=platform|man_made=(pier|bridge)|natural=.*|area:highway=.*)/;
/** Streets parcels may face. */
const FRONT = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'pedestrian', 'service', 'primary_link', 'secondary_link', 'tertiary_link', 'steps', 'footway']);
const NO_BUILD_USE = new Set<number>([LandUse.Water, LandUse.Park, LandUse.Forest, LandUse.Cemetery, LandUse.Landmark]);
const MIN_COVER = 0.26;
/** Growth (m) of the keep-out rects: rectFree samples 0.4 m inside a parcel on 1 m cells, so corners overhang ~1.7 m. */
const KEEP_OUT_GROW = 2.5;

class Grid {
  readonly w: number;
  readonly h: number;
  readonly cells: Uint8Array;
  constructor(readonly minX: number, readonly minZ: number, maxX: number, maxZ: number) {
    this.w = Math.ceil(maxX - minX);
    this.h = Math.ceil(maxZ - minZ);
    this.cells = new Uint8Array(this.w * this.h);
  }

  at(x: number, z: number): number {
    const i = Math.floor(x - this.minX);
    const j = Math.floor(z - this.minZ);
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? 1 : this.cells[j * this.w + i];
  }

  /** Scanline fill of polygons (even-odd over all rings) with `v`, grown by `grow` m. */
  fill(rings: readonly (readonly number[])[], v: number, grow = 0): void {
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const r of rings) {
      for (let k = 1; k < r.length; k += 2) {
        z0 = Math.min(z0, r[k]);
        z1 = Math.max(z1, r[k]);
      }
    }
    const j0 = Math.max(0, Math.floor(z0 - grow - this.minZ));
    const j1 = Math.min(this.h - 1, Math.ceil(z1 + grow - this.minZ));
    const xs: number[] = [];
    for (let j = j0; j <= j1; j++) {
      const z = this.minZ + j + 0.5;
      xs.length = 0;
      for (const r of rings) {
        const n = r.length / 2;
        for (let a = 0, b = n - 1; a < n; b = a++) {
          const za = r[a * 2 + 1];
          const zb = r[b * 2 + 1];
          if (za > z !== zb > z) {
            xs.push(r[a * 2] + ((z - za) / (zb - za)) * (r[b * 2] - r[a * 2]));
          }
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.floor(xs[k] - grow - this.minX));
        const i1 = Math.min(this.w - 1, Math.ceil(xs[k + 1] + grow - this.minX));
        // TypedArray.fill reads negative bounds from the end of the array: skip spans outside the row.
        if (i1 >= i0) {
          this.cells.fill(v, j * this.w + i0, j * this.w + i1 + 1);
        }
      }
    }
  }

  /** Marks cells within `r` m of the polyline. */
  line(pts: readonly number[], r: number, v: number): void {
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k];
      const az = pts[k + 1];
      const bx = pts[k + 2];
      const bz = pts[k + 3];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.ceil(len / 0.7) + 1;
      for (let s = 0; s <= steps; s++) {
        const x = ax + ((bx - ax) * s) / steps;
        const z = az + ((bz - az) * s) / steps;
        const i0 = Math.max(0, Math.floor(x - r - this.minX));
        const i1 = Math.min(this.w - 1, Math.floor(x + r - this.minX));
        const j0 = Math.max(0, Math.floor(z - r - this.minZ));
        const j1 = Math.min(this.h - 1, Math.floor(z + r - this.minZ));
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const dx = this.minX + i + 0.5 - x;
            const dz = this.minZ + j + 0.5 - z;
            if (dx * dx + dz * dz <= r * r) {
              this.cells[j * this.w + i] = v;
            }
          }
        }
      }
    }
  }
}

/** Percentage of free cells (diagnostics). */
function free(cells: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < cells.length; i++) {
    n += cells[i] ? 0 : 1;
  }
  return Math.round((n / Math.max(1, cells.length)) * 1000) / 10;
}

export interface InfillResult {
  parcels: OsmBuilding[];
  stats: Record<string, number>;
}

export function findInfill(buildings: readonly OsmBuilding[], data: { roads: readonly OsmRoad[]; areas: readonly OsmArea[]; rails: readonly OsmRail[]; keepOut?: readonly WorldBounds[] }, pads: Float32Array, surface: StreetSurface, area: WorldBounds): InfillResult {
  const geo = surface.geo;
  const grid = new Grid(area.minX, area.minZ, area.maxX, area.maxZ);
  const built = new Grid(area.minX, area.minZ, area.maxX, area.maxZ);
  const { w, h, cells } = grid;

  // Streets, sidewalks, footpaths and mapped ground covers (squares, parking, platforms, grass, quays, courtyards).
  for (let j = 0; j < h; j++) {
    const z = area.minZ + j + 0.5;
    for (let i = 0; i < w; i++) {
      const x = area.minX + i + 0.5;
      const d = surface.distance(x, z);
      if (d < Math.max(0.8, surface.sidewalkWidth(x, z)) + 0.3 || surface.groundAt(x, z) !== Ground.Lot || surface.pathDistance(x, z) < 0.6) {
        cells[j * w + i] = 1;
      }
    }
  }
  for (let j = 0; j < h; j += 4) {
    for (let i = 0; i < w; i += 4) {
      const x = area.minX + i + 2;
      const z = area.minZ + j + 2;
      if (geo.coast(x, z) < 3 || NO_BUILD_USE.has(geo.landUse(x, z))) {
        for (let jj = j; jj < Math.min(h, j + 4); jj++) {
          cells.fill(1, jj * w + i, jj * w + Math.min(w, i + 4));
        }
      }
    }
  }
  const freeAfterStreets = free(cells);
  // Mapped buildings (also the cover map), open spaces, paths, rails, landmark pads.
  for (const b of buildings) {
    if (b.part) {
      continue;
    }
    grid.fill([b.ring], 1, 0.6);
    built.fill([b.ring], 1);
  }
  for (const a of data.areas) {
    if (OPEN.test(a.kind)) {
      grid.fill([a.ring, ...(a.holes ?? [])], 1, 0.5);
    }
  }
  for (const r of data.roads) {
    if (!r.tunnel) {
      grid.line(r.pts, r.width / 2 + (r.kind === 'footway' || r.kind === 'steps' || r.kind === 'path' ? 0.8 : 1.5), 1);
    }
  }
  for (const r of data.rails) {
    if (!r.tunnel) {
      grid.line(r.pts, r.embedded ? 2.5 : 4.5, 1);
    }
  }
  for (let k = 0; k < pads.length; k += 3) {
    const r = pads[k + 2];
    grid.line([pads[k], pads[k + 1], pads[k] + 0.01, pads[k + 1]], r, 1);
  }
  // Compiled street areas (street-areas.ts): up close the street tiles draw only the mapped buildings there, so no
  // parcel may reach into one.
  for (const k of data.keepOut ?? []) {
    const [x0, z0, x1, z1] = [k.minX - KEEP_OUT_GROW, k.minZ - KEEP_OUT_GROW, k.maxX + KEEP_OUT_GROW, k.maxZ + KEEP_OUT_GROW];
    grid.fill([[x0, z0, x1, z0, x1, z1, x0, z1]], 1);
  }

  const freeAfterMasks = free(cells);
  // Summed-area table of the OSM building cover.
  const sat = new Float32Array((w + 1) * (h + 1));
  for (let j = 0; j < h; j++) {
    let row = 0;
    for (let i = 0; i < w; i++) {
      row += built.cells[j * w + i];
      sat[(j + 1) * (w + 1) + i + 1] = sat[j * (w + 1) + i + 1] + row;
    }
  }
  const cover = (x: number, z: number, r: number): number => {
    const i0 = Math.max(0, Math.floor(x - r - area.minX));
    const i1 = Math.min(w, Math.floor(x + r - area.minX));
    const j0 = Math.max(0, Math.floor(z - r - area.minZ));
    const j1 = Math.min(h, Math.floor(z + r - area.minZ));
    const n = (i1 - i0) * (j1 - j0);
    if (n <= 0) {
      return 0;
    }
    const s = sat[j1 * (w + 1) + i1] - sat[j0 * (w + 1) + i1] - sat[j1 * (w + 1) + i0] + sat[j0 * (w + 1) + i0];
    return s / n;
  };

  /** All cells of the oriented rectangle free (sampled on a 0.8 m lattice, 0.4 m inside its edges). */
  const rectFree = (cx: number, cz: number, tx: number, tz: number, nx: number, nz: number, f: number, d0: number, d1: number): boolean => {
    for (let dd = d0 + 0.4; dd <= d1 - 0.4 + 1e-6; dd += 0.8) {
      for (let s = -f / 2 + 0.4; s <= f / 2 - 0.4 + 1e-6; s += 0.8) {
        if (grid.at(cx + tx * s + nx * dd, cz + tz * s + nz * dd)) {
          return false;
        }
      }
    }
    return true;
  };
  const mark = (ring: number[]): void => grid.fill([ring], 1);

  const parcels: OsmBuilding[] = [];
  let tested = 0;
  let lowCover = 0;
  let id = 0;
  for (const road of data.roads) {
    if (!FRONT.has(road.kind) || road.tunnel || road.bridge || road.covered) {
      continue;
    }
    const pts = road.pts;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k];
      const az = pts[k + 1];
      const bx = pts[k + 2];
      const bz = pts[k + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 6) {
        continue;
      }
      const tx = (bx - ax) / len;
      const tz = (bz - az) / len;
      for (const side of [1, -1]) {
        const nx = tz * side;
        const nz = -tx * side;
        let s = 3;
        while (s < len - 3) {
          const hs = hash(road.id * 0.013 + k * 7.1 + s * 0.37 + side * 3.3);
          let f = Math.min(6 + hs * 6.5, len - s - 1);
          const px = ax + tx * (s + f / 2);
          const pz = az + tz * (s + f / 2);
          // Front line: first free cell run outward from the centre line.
          let front = -1;
          for (let d = road.width / 2 + 0.5; d < road.width / 2 + 9; d += 0.5) {
            if (!grid.at(px + nx * d, pz + nz * d) && !grid.at(px + nx * (d + 1.2), pz + nz * (d + 1.2)) && !grid.at(px + nx * (d + 2.4), pz + nz * (d + 2.4))) {
              front = d;
              break;
            }
          }
          if (front < 0 || f < 5) {
            s += 2;
            continue;
          }
          tested++;
          if (cover(px + nx * (front + 8), pz + nz * (front + 8), 30) < MIN_COVER) {
            lowCover++;
            s += f;
            continue;
          }
          const cx = px + nx * front;
          const cz = pz + nz * front;
          if (!rectFree(cx, cz, tx, tz, nx, nz, f, 0, 4)) {
            f = Math.min(f, 6);
            if (!rectFree(cx, cz, tx, tz, nx, nz, f, 0, 4)) {
              s += 2;
              continue;
            }
          }
          const target = 9 + hash(hs * 91.7) * 9;
          let depth = 4;
          while (depth < target && rectFree(cx, cz, tx, tz, nx, nz, f, depth, depth + 1)) {
            depth += 1;
          }
          if (depth < 7) {
            s += 2;
            continue;
          }
          const corners = [
            [cx - tx * (f / 2), cz - tz * (f / 2)],
            [cx + tx * (f / 2), cz + tz * (f / 2)],
            [cx + tx * (f / 2) + nx * depth, cz + tz * (f / 2) + nz * depth],
            [cx - tx * (f / 2) + nx * depth, cz - tz * (f / 2) + nz * depth],
          ];
          const inside = corners.every(([x, z]) => x > area.minX && x < area.maxX && z > area.minZ && z < area.maxZ);
          if (inside) {
            // Positive shoelace area (data.ts outer ring convention).
            let ring = corners.flat();
            let a2 = 0;
            for (let q = 0; q < 4; q++) {
              const r2 = (q + 1) % 4;
              a2 += ring[q * 2] * ring[r2 * 2 + 1] - ring[r2 * 2] * ring[q * 2 + 1];
            }
            if (a2 < 0) {
              ring = [ring[0], ring[1], ring[6], ring[7], ring[4], ring[5], ring[2], ring[3]];
            }
            mark(ring);
            parcels.push({ id: 2_000_000_000 + id++, ring, kind: 'yes' });
          }
          s += f;
        }
      }
    }
  }
  return { parcels, stats: { infillParcels: parcels.length, infillTested: tested, infillLowCover: lowCover, infillFree0: freeAfterStreets, infillFree1: freeAfterMasks } };
}
