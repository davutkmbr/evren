/**
 * Tree placement (worker side): OSM natural=tree nodes and tree rows, then plausible fill: groves and clearings in
 * parks, dense woods, cypress cemeteries, courtyard trees in enclosed garden lots and the plane / cypress rings of
 * mosque yards. Never inside buildings, on carriageways, sidewalks, park paths or water.
 */
import type { OsmArea, OsmData, OsmPoint } from '../../data';
import { FloatBuf } from '../../shared/buffers';
import { BoxGrid, hash, pointInRing } from '../../shared/geometry';
import { type StandGround, standFault } from '../../../placement/stand';
import { osmStandGround } from '../../shared/stand';
import type { StreetSurface } from '../../shared/street-surface';
import { CoverChannel, LotHint, LotStyle, isGreenArea, streetClearance, vnoise, type CoverBuild } from '../cover/cover';
import { decodeSdf } from '../raster';
import { TREE_SPECIES, type TreeSpecies } from './species';

interface Planter {
  surface: StreetSurface;
  cover: CoverBuild;
  /**
   * Planting bounds: the build rect (area plus seam), where the vegetation system removes its own urban and park
   * trees (policy.ts OWNS_PARK_TREES).
   */
  area: { minX: number; maxX: number; minZ: number; maxZ: number };
  pads: readonly number[];
  /** Mosque pads (x, z, radius): their yards get a loose ring of cypresses and planes. */
  mosques: readonly number[];
}

/** Model heights (m) at scale 1 (trees/models.ts). */
const BASE_HEIGHT: Record<TreeSpecies, number> = { plane: 14, cypress: 13, pine: 13, palm: 9 };

class Forest {
  readonly out: Record<TreeSpecies, FloatBuf> = { plane: new FloatBuf(), cypress: new FloatBuf(), pine: new FloatBuf(), palm: new FloatBuf() };
  private readonly placed = new BoxGrid(10);
  /** Trunk positions (x, z pairs). */
  readonly trunks: number[] = [];
  count = 0;

  /** Shared stand rule ground (placement/stand.ts). */
  private readonly land: StandGround;

  constructor(private readonly p: Planter) {
    this.land = osmStandGround(p.surface);
  }

  private channel(x: number, z: number, c: number): number {
    const k = this.p.cover.grid.index(x, z);
    return k < 0 ? -99 : decodeSdf(this.p.cover.rgba[k * 4 + c]);
  }

  /** Distance (m) to the nearest building outline (capped by the cover pass). */
  wallDistance(x: number, z: number): number {
    const k = this.p.cover.grid.index(x, z);
    return k < 0 ? 0 : this.p.cover.buildingDist[k] / 10;
  }

  /** Nearest planted trunk distance (m, capped at 12). */
  spacing(x: number, z: number): number {
    let best = 12;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        for (const id of this.placed.at(x + di * 10, z + dj * 10)) {
          best = Math.min(best, Math.hypot(this.trunks[id * 2] - x, this.trunks[id * 2 + 1] - z));
        }
      }
    }
    return best;
  }

  /** Ground rules shared by every planting (OSM trees relax the street rule, see placeTrees()). */
  groundOk(x: number, z: number, wallClearance: number, street = true): boolean {
    return this.groundCheck(x, z, wallClearance, street) === '';
  }

  /** The ground rule a spot breaks ('' when it passes): area, water, wall, pad, street, path or parking. */
  groundCheck(x: number, z: number, wallClearance: number, street = true): string {
    const a = this.p.area;
    if (x < a.minX + 2 || x > a.maxX - 2 || z < a.minZ + 2 || z > a.maxZ - 2) {
      return 'area';
    }
    const s = this.p.surface;
    // Shared stand rule: on the OSM ground, on land and 2 m from the shore (a trunk plus its root flare).
    const fault = standFault(this.land, x, z, { shore: 2, building: false });
    if (fault) {
      return fault === 'shore' ? 'water' : fault;
    }
    if (this.wallDistance(x, z) < wallClearance) {
      return 'wall';
    }
    if (this.onPad(x, z)) {
      return 'pad';
    }
    if (street ? streetClearance(s, x, z) < 1 : s.distance(x, z) < 0.3) {
      return 'street';
    }
    if (this.channel(x, z, CoverChannel.Path) >= -0.8) {
      return 'path';
    }
    return this.channel(x, z, CoverChannel.Parking) >= -0.5 ? 'parking' : '';
  }

  private onPad(x: number, z: number): boolean {
    const p = this.p.pads;
    for (let k = 0; k < p.length; k += 3) {
      const r = p[k + 2] * 0.75;
      if ((x - p[k]) ** 2 + (z - p[k + 1]) ** 2 < r * r) {
        return true;
      }
    }
    return false;
  }

  green(x: number, z: number): number {
    return this.channel(x, z, CoverChannel.Green);
  }

  plant(species: TreeSpecies, x: number, z: number, scale: number, seed: number): void {
    const h = hash(seed * 7.13 + x * 0.31 + z * 0.17);
    const h2 = hash(h * 51.7 + 3.1);
    const y = this.p.surface.heightAt(x, z) - 0.15;
    const hs = scale * (0.85 + 0.3 * h);
    const vs = scale * (0.85 + 0.3 * h2);
    let r = 1;
    let g = 1;
    let b = 1;
    if (species === 'plane') {
      const autumn = h2 > 0.88 ? 1 : 0;
      r = 0.85 + 0.25 * h + 0.35 * autumn;
      g = 0.9 + 0.15 * h2;
      b = 0.8 + 0.2 * h - 0.2 * autumn;
    } else {
      r = g = b = 0.85 + 0.25 * h;
    }
    this.out[species].push(x, y, z, h * Math.PI * 2, hs, vs, r, g, b);
    const id = this.trunks.length / 2;
    this.trunks.push(x, z);
    this.placed.add(id, x, z, x, z);
    this.count++;
  }

  take(): Record<TreeSpecies, Float32Array> {
    const out = {} as Record<TreeSpecies, Float32Array>;
    for (const s of TREE_SPECIES) {
      out[s] = this.out[s].take();
    }
    return out;
  }
}

function osmSpecies(p: OsmPoint, x: number, z: number, religious: boolean): TreeSpecies {
  const g = `${p.genus ?? ''} ${p.species ?? ''}`.toLowerCase();
  if (/cupressus|cypress/.test(g)) return 'cypress';
  if (/pinus|pine/.test(g) || p.leafType === 'needleleaved') return 'pine';
  if (/phoenix|washingtonia|palm|trachycarpus/.test(g)) return 'palm';
  if (religious && hash(x * 0.3 + z) < 0.5) return 'cypress';
  return 'plane';
}

export interface TreePlacement {
  trees: Record<TreeSpecies, Float32Array>;
  /** Trunk positions (x, z pairs) of every tree, for the furniture and walk graph passes to keep clear of. */
  trunks: Float32Array;
  count: number;
  osm: number;
  /** Mapped trees left out, by the ground rule they break (Forest.groundCheck). */
  osmRejected: Record<string, number>;
}

export function placeTrees(data: Pick<OsmData, 'points' | 'lines' | 'areas'>, p: Planter): TreePlacement {
  const f = new Forest(p);
  const religious = data.areas.filter((a) => a.kind === 'landuse=religious' || a.kind === 'amenity=place_of_worship');
  const inReligious = (x: number, z: number): boolean => religious.some((a) => pointInRing(a.ring, x, z));

  // OSM trees: keep them where mapped, except inside buildings or on the carriageway.
  let osm = 0;
  const osmRejected: Record<string, number> = {};
  data.points.forEach((pt, i) => {
    if (pt.kind !== 'natural=tree') {
      return;
    }
    const why = f.groundCheck(pt.x, pt.z, 0.8, false);
    if (why) {
      osmRejected[why] = (osmRejected[why] ?? 0) + 1;
      return;
    }
    const sp = osmSpecies(pt, pt.x, pt.z, inReligious(pt.x, pt.z));
    const scale = pt.height ? pt.height / BASE_HEIGHT[sp] : sp === 'plane' ? 0.75 : 0.9;
    f.plant(sp, pt.x, pt.z, Math.min(1.5, Math.max(0.45, scale)), i);
    osm++;
  });
  for (const row of data.lines) {
    if (row.kind !== 'natural=tree_row') {
      continue;
    }
    for (let k = 2; k < row.pts.length; k += 2) {
      const ax = row.pts[k - 2];
      const az = row.pts[k - 1];
      const len = Math.hypot(row.pts[k] - ax, row.pts[k + 1] - az);
      for (let d = 0; d < len; d += 7.5) {
        const x = ax + ((row.pts[k] - ax) * d) / len;
        const z = az + ((row.pts[k + 1] - az) * d) / len;
        if (f.groundOk(x, z, 1, false) && f.spacing(x, z) > 5) {
          f.plant('plane', x, z, 0.8, k * 31 + d);
          osm++;
        }
      }
    }
  }

  // Fill of the green areas.
  for (const a of data.areas) {
    if (!isGreenArea(a) || (a.layer ?? 0) < 0 || a.kind === 'leisure=pitch' || a.kind === 'leisure=playground') {
      continue;
    }
    fillArea(f, a, p);
  }

  plantLots(f, p);

  // Mosque yards: a loose ring of cypresses and planes.
  const pads = p.mosques;
  for (let k = 0; k < pads.length; k += 3) {
    const [cx, cz, r] = [pads[k], pads[k + 1], pads[k + 2]];
    if (cx < p.area.minX || cx > p.area.maxX || cz < p.area.minZ || cz > p.area.maxZ) {
      continue;
    }
    const n = Math.round(r * 0.8);
    for (let s = 0; s < n; s++) {
      const a = (s / n) * Math.PI * 2 + hash(cx) * 3;
      const rr = r * (0.8 + 0.35 * hash(s * 3.1 + cx));
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      if (hash(s * 7.7 + cz) < 0.45 && f.groundOk(x, z, 2) && f.spacing(x, z) > 5) {
        const cypress = hash(s * 1.9 + cx) < 0.55;
        f.plant(cypress ? 'cypress' : 'plane', x, z, cypress ? 0.9 : 0.85, s + k);
      }
    }
  }
  return { trees: f.take(), trunks: Float32Array.from(f.trunks), count: f.count, osm, osmRejected };
}

/**
 * Lot trees (cover/cover.ts LotStyle / LotHint): fig, lime and small plane trees in courtyard gardens, old groves in
 * the walled grounds of consulates, churches and hospitals and in large back gardens, a plane tree or two in mosque
 * courtyards and schoolyards, and a few shade trees along the edges of open plazas.
 */
function plantLots(f: Forest, p: Planter): void {
  const { grid } = p.cover;
  for (const lot of p.cover.lots) {
    const big = lot.area >= 600;
    let want = 0;
    let wall = 2.2;
    let street = 2;
    let spacing = 5;
    let scale = [0.45, 0.25];
    switch (lot.style) {
      case LotStyle.Garden:
        want = lot.hint === LotHint.Grounds ? lot.area / 85 : big ? lot.area / 120 : Math.min(3, lot.area / 140);
        scale = big ? [0.6, 0.45] : [0.45, 0.25];
        spacing = big ? 6 : 5;
        break;
      case LotStyle.Paved:
        if (lot.hint === LotHint.Mosque) {
          want = Math.min(6, lot.area / 220);
          scale = [0.7, 0.3];
          wall = 3;
          spacing = 8;
        } else if (lot.hint === LotHint.School || lot.hint === LotHint.Grounds) {
          want = Math.min(6, lot.area / 450);
          scale = [0.6, 0.3];
          wall = 2.5;
          spacing = 8;
        }
        break;
      case LotStyle.Yard:
        want = lot.area >= 300 ? Math.min(2, lot.area / 300) : 0;
        scale = [0.45, 0.2];
        break;
      case LotStyle.Plaza:
        // Shade trees along the plaza edges, clear of the crowd's open middle.
        want = Math.min(10, lot.area / 900);
        scale = [0.55, 0.3];
        wall = 3;
        street = 1.5;
        spacing = 9;
        break;
    }
    want = Math.floor(Math.min(90, want) + hash(lot.cx * 0.37 + lot.cz) * 0.99);
    const coast = p.surface.geo.coast(lot.cx, lot.cz);
    for (let t = 0, tries = 0; t < want && tries < want * 10 + 12; tries++) {
      const k = lot.cells[Math.floor(hash(lot.cx * 0.1 + lot.cz * 0.013 + tries * 13.7) * lot.cells.length)];
      const i = k % grid.w;
      const j = (k - i) / grid.w;
      const x = grid.cx(i) + (hash(k * 0.31) - 0.5) * 0.9;
      const z = grid.cz(j) + (hash(k * 0.73) - 0.5) * 0.9;
      if (lot.style === LotStyle.Plaza && f.wallDistance(x, z) > 9 && streetClearance(p.surface, x, z) > 6) {
        continue;
      }
      if (!f.groundOk(x, z, wall) || streetClearance(p.surface, x, z) < street || f.spacing(x, z) < spacing) {
        continue;
      }
      const r = hash(x * 0.37 + z * 0.11);
      let sp: TreeSpecies = 'plane';
      if (big && lot.style === LotStyle.Garden) {
        sp = r < 0.12 ? 'cypress' : r < 0.2 ? 'pine' : coast < 150 && r < 0.26 ? 'palm' : 'plane';
      } else if (lot.hint === LotHint.Mosque && r < 0.25) {
        sp = 'cypress';
      }
      const s = sp === 'plane' ? scale[0] + scale[1] * hash(x + z * 3) : 0.75 + 0.25 * hash(z - x);
      f.plant(sp, x, z, s, k);
      t++;
    }
  }
}

/** Jittered grid planting inside one green area with groves and clearings from low-frequency noise. */
function fillArea(f: Forest, a: OsmArea, p: Planter): void {
  const wood = a.kind === 'landuse=forest' || a.kind === 'natural=wood';
  const cemetery = a.kind === 'landuse=cemetery';
  const grass = a.kind === 'landuse=grass' || a.kind === 'natural=grass';
  const scrub = a.kind === 'natural=scrub';
  const spacing = wood ? 6.5 : cemetery ? 5 : grass ? 11 : scrub ? 8 : a.kind === 'leisure=garden' ? 10 : 9;
  const keep = wood ? 0.85 : cemetery ? 0.8 : grass ? 0.3 : scrub ? 0.4 : a.kind === 'leisure=garden' ? 0.55 : 0.75;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let k = 0; k < a.ring.length; k += 2) {
    x0 = Math.min(x0, a.ring[k]);
    x1 = Math.max(x1, a.ring[k]);
    z0 = Math.min(z0, a.ring[k + 1]);
    z1 = Math.max(z1, a.ring[k + 1]);
  }
  x0 = Math.max(x0, p.area.minX);
  x1 = Math.min(x1, p.area.maxX);
  z0 = Math.max(z0, p.area.minZ);
  z1 = Math.min(z1, p.area.maxZ);
  const seed = hash(a.id * 0.001);
  for (let z = z0 + spacing / 2; z < z1; z += spacing) {
    for (let x = x0 + spacing / 2; x < x1; x += spacing) {
      const jx = x + (hash(x * 3.1 + z * 0.7 + seed) - 0.5) * spacing * 0.9;
      const jz = z + (hash(z * 2.3 - x * 0.9 + seed) - 0.5) * spacing * 0.9;
      const grove = wood || cemetery ? 1 : Math.min(1, Math.max(0, (vnoise(jx / 45 + seed * 9, jz / 45) - 0.3) / 0.35));
      if (hash(jx * 1.7 + jz * 5.3) > keep * (0.25 + 0.75 * grove)) {
        continue;
      }
      if (f.green(jx, jz) < (grass ? 2 : 1.2) || !f.groundOk(jx, jz, 2.5) || f.spacing(jx, jz) < spacing * 0.6) {
        continue;
      }
      const r = hash(jx * 0.37 + jz * 0.11);
      const coast = p.surface.geo.coast(jx, jz);
      let sp: TreeSpecies = 'plane';
      if (cemetery) {
        sp = r < 0.8 ? 'cypress' : 'plane';
      } else if (wood) {
        sp = r < 0.3 ? 'pine' : r < 0.36 ? 'cypress' : 'plane';
      } else if (coast < 70 && r < 0.12) {
        sp = 'palm';
      } else {
        sp = r < 0.14 ? 'pine' : r < 0.2 ? 'cypress' : 'plane';
      }
      const scale = sp === 'plane' ? 0.7 + 0.45 * hash(jx + jz * 3) : 0.85 + 0.25 * hash(jz - jx);
      f.plant(sp, jx, jz, scrub ? scale * 0.55 : scale, x * 13 + z);
    }
  }
}
