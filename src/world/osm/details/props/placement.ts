/**
 * Street furniture and stationary people (worker side): benches (OSM and along park paths) with people sitting on
 * them, bins, bollards (OSM and the black kerb bollards of Beyoğlu's commercial sidewalks), İETT shelters with
 * waiting passengers, tram platform crowds, kiosks, café tables with guests at cafés and restaurants, simit and
 * chestnut carts with their sellers, flag poles, pigeon flocks and chatting groups on the squares, and the hoardings
 * and tower cranes of construction sites.
 */
import type { OsmData, OsmPoint } from '../../data';
import { BoxGrid, hash, pointInRing } from '../../shared/geometry';
import { Surf, classifyStreets } from '../../shared/street-field';
import { Zone, type StreetSurface } from '../../shared/street-surface';
import { CoverChannel, isGreenArea, isPathRoad, streetClearance, type CoverBuild } from '../cover/cover';
import { Pose } from '../protocol';
import { decodeSdf } from '../raster';
import type { PropStamper } from './stamp';

export interface PlaceContext {
  surface: StreetSurface;
  cover: CoverBuild;
  area: { minX: number; maxX: number; minZ: number; maxZ: number };
  pads: readonly number[];
  poi: (x: number, z: number) => number;
}

const MARGIN = 24;
const PARASOL_TINTS: [number, number, number][] = [
  [0.85, 0.82, 0.74],
  [0.6, 0.05, 0.04],
  [0.8, 0.78, 0.7],
  [0.08, 0.2, 0.1],
  [0.45, 0.28, 0.12],
  [0.05, 0.1, 0.3],
];

export class Placer {
  readonly standers: number[] = [];
  readonly flags: number[] = [];
  readonly pigeons: number[] = [];
  private readonly used = new BoxGrid(8);
  private readonly usedPos: number[] = [];

  constructor(
    readonly ctx: PlaceContext,
    readonly props: PropStamper,
  ) {}

  inArea(x: number, z: number, margin = MARGIN): boolean {
    const a = this.ctx.area;
    return x > a.minX + margin && x < a.maxX - margin && z > a.minZ + margin && z < a.maxZ - margin;
  }

  wall(x: number, z: number): number {
    const k = this.ctx.cover.grid.index(x, z);
    return k < 0 ? 0 : this.ctx.cover.buildingDist[k] / 10;
  }

  channel(x: number, z: number, c: number): number {
    const k = this.ctx.cover.grid.index(x, z);
    return k < 0 ? -99 : decodeSdf(this.ctx.cover.rgba[k * 4 + c]);
  }

  onPad(x: number, z: number, k = 0.8): boolean {
    const p = this.ctx.pads;
    for (let i = 0; i < p.length; i += 3) {
      const r = p[i + 2] * k;
      if ((x - p[i]) ** 2 + (z - p[i + 1]) ** 2 < r * r) {
        return true;
      }
    }
    return false;
  }

  /** Free-standing spot for furniture: land, off carriageways, clear of walls and of other placed props. */
  free(x: number, z: number, wall: number, room: number): boolean {
    const s = this.ctx.surface;
    if (!this.inArea(x, z) || s.geo.coast(x, z) < 1.2 || this.wall(x, z) < wall || this.onPad(x, z)) {
      return false;
    }
    if (s.zone(x, z) === Zone.Carriageway) {
      return false;
    }
    return this.clearance(x, z) >= room;
  }

  clearance(x: number, z: number): number {
    let best = 99;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        for (const id of this.used.at(x + di * 8, z + dj * 8)) {
          best = Math.min(best, Math.hypot(this.usedPos[id * 2] - x, this.usedPos[id * 2 + 1] - z));
        }
      }
    }
    return best;
  }

  reserve(x: number, z: number): void {
    const id = this.usedPos.length / 2;
    this.usedPos.push(x, z);
    this.used.add(id, x, z, x, z);
  }

  /** Nearest spot within `radius` that passes free() (spiral of deterministic samples), or null. */
  near(x: number, z: number, radius: number, wall: number, room: number): [number, number] | null {
    if (this.free(x, z, wall, room)) {
      return [x, z];
    }
    for (let r = 0.75; r <= radius; r += 0.75) {
      const n = Math.max(6, Math.round(r * 5));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + r;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (this.free(px, pz, wall, room)) {
          return [px, pz];
        }
      }
    }
    return null;
  }

  y(x: number, z: number): number {
    return this.ctx.surface.heightAt(x, z);
  }

  /** Yaw facing down the street distance gradient (towards the nearest carriageway), or `fallback`. */
  faceStreet(x: number, z: number, fallback: number): number {
    const s = this.ctx.surface;
    const gx = s.distance(x + 1, z) - s.distance(x - 1, z);
    const gz = s.distance(x, z + 1) - s.distance(x, z - 1);
    return Math.hypot(gx, gz) < 0.05 ? fallback : Math.atan2(-gx, -gz);
  }

  /** Yaw facing away from the nearest wall, or `fallback`. */
  faceAwayFromWall(x: number, z: number, fallback: number): number {
    const gx = this.wall(x + 1.5, z) - this.wall(x - 1.5, z);
    const gz = this.wall(x, z + 1.5) - this.wall(x, z - 1.5);
    return Math.hypot(gx, gz) < 0.05 ? fallback : Math.atan2(gx, gz);
  }

  person(x: number, z: number, yaw: number, pose: number, seed: number, y = this.y(x, z)): void {
    this.standers.push(x, y, z, yaw, pose, seed);
  }

  /** Stamps a prop on the ground; false when the shared stand rule refuses the spot (then nothing is reserved). */
  prop(kind: Parameters<PropStamper['add']>[0], x: number, z: number, yaw: number, scale = 1, tint?: [number, number, number]): boolean {
    if (!this.props.add(kind, x, this.y(x, z), z, yaw, scale, tint)) {
      return false;
    }
    this.reserve(x, z);
    return true;
  }
}

/** Local (dx, dz) of a prop turned to `yaw` in world space. */
function local(x: number, z: number, yaw: number, dx: number, dz: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x + dx * c + dz * s, z - dx * s + dz * c];
}

function benchWithPeople(pl: Placer, x: number, z: number, yaw: number, seed: number): void {
  if (!pl.prop('bench', x, z, yaw)) {
    return;
  }
  const r = hash(seed * 3.7);
  const sitters = r < 0.4 ? 1 : r < 0.6 ? 2 : 0;
  for (let k = 0; k < sitters; k++) {
    const side = sitters === 1 ? (hash(seed) - 0.5) * 0.8 : k ? 0.42 : -0.42;
    const [px, pz] = local(x, z, yaw, side, 0.02);
    pl.person(px, pz, yaw + (hash(seed + k) - 0.5) * 0.3, Pose.Sit, seed * 13 + k);
  }
  if (hash(seed * 9.1) < 0.35) {
    const [bx, bz] = local(x, z, yaw, 1.35, 0.1);
    if (pl.free(bx, bz, 0.4, 0.5)) {
      pl.prop('bin', bx, bz, yaw);
    }
  }
}

function placeBenches(pl: Placer, data: Pick<OsmData, 'points' | 'roads' | 'areas'>): void {
  data.points.forEach((p, i) => {
    if (p.kind !== 'amenity=bench') {
      return;
    }
    const spot = pl.near(p.x, p.z, 4, 0.6, 1.8);
    if (spot) {
      benchWithPeople(pl, spot[0], spot[1], pl.faceStreet(spot[0], spot[1], hash(i) * 6.28), i);
    }
  });
  // Park benches along the paths of green areas.
  const greens = data.areas.filter((a) => isGreenArea(a) && a.kind !== 'landuse=grass');
  for (const r of data.roads) {
    if (!isPathRoad(r)) {
      continue;
    }
    let along = 8;
    for (let k = 2; k < r.pts.length; k += 2) {
      const ax = r.pts[k - 2];
      const az = r.pts[k - 1];
      const bx = r.pts[k];
      const bz = r.pts[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.1) {
        continue;
      }
      const tx = (bx - ax) / len;
      const tz = (bz - az) / len;
      for (; along < len; along += 21) {
        const side = hash(along + ax) < 0.5 ? 1 : -1;
        const off = Math.max(1, r.width / 2) + 0.75;
        const x = ax + tx * along + tz * off * side;
        const z = az + tz * along - tx * off * side;
        if (hash(x * 0.7 + z) > 0.55 || pl.channel(x, z, CoverChannel.Green) < 0.3 || !greens.some((a) => pointInRing(a.ring, x, z))) {
          continue;
        }
        if (pl.free(x, z, 1.2, 3)) {
          benchWithPeople(pl, x, z, Math.atan2(-tz * side, tx * side), Math.round(x * 3 + z));
        }
      }
      along -= len;
    }
  }
}

/** OSM bollards plus rows of kerb bollards on the busy sidewalks of commercial asphalt streets. */
function placeBollards(pl: Placer, data: Pick<OsmData, 'points' | 'roads'>): void {
  for (const p of data.points) {
    if (p.kind === 'barrier=bollard' && pl.inArea(p.x, p.z) && pl.wall(p.x, p.z) > 0.3) {
      pl.props.add('bollard', p.x, pl.y(p.x, p.z), p.z, 0);
    }
  }
  const crossings = new BoxGrid(20);
  const cpos: number[] = [];
  for (const p of data.points) {
    if (p.kind === 'highway=crossing' || p.kind === 'highway=traffic_signals') {
      crossings.add(cpos.length / 2, p.x, p.z, p.x, p.z);
      cpos.push(p.x, p.z);
    }
  }
  const nearCrossing = (x: number, z: number): boolean => crossings.at(x, z).some((id) => Math.hypot(cpos[id * 2] - x, cpos[id * 2 + 1] - z) < 5);
  const surface = pl.ctx.surface;
  for (const s of classifyStreets(data.roads)) {
    if (s.surf !== Surf.Asphalt || s.sidewalk <= 0 || s.rank >= 3.5) {
      continue;
    }
    for (const side of [1, -1]) {
      let dist = 0;
      for (let k = 2; k < s.pts.length; k += 2) {
        const ax = s.pts[k - 2];
        const az = s.pts[k - 1];
        const bx = s.pts[k];
        const bz = s.pts[k + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.1) {
          continue;
        }
        const tx = (bx - ax) / len;
        const tz = (bz - az) / len;
        const nx = tz * side;
        const nz = -tx * side;
        const stretch = Math.floor((dist + len * 0.5) / 60);
        const on = hash(s.road * 1.37 + stretch * 7.1 + side) < 0.45;
        if (on && pl.ctx.poi(ax, az) > 0.25) {
          for (let f = 1.5; f < len - 1.5; f += 1.9) {
            const x = ax + tx * f + nx * (s.hw + 0.3);
            const z = az + tz * f + nz * (s.hw + 0.3);
            if (!pl.inArea(x, z) || nearCrossing(x, z) || pl.wall(x, z) < 1.3 || surface.zone(x, z) !== Zone.Sidewalk) {
              continue;
            }
            pl.props.add('bollard', x, pl.y(x, z), z, 0);
          }
        }
        dist += len;
      }
    }
  }
}

function placeStops(pl: Placer, data: Pick<OsmData, 'points' | 'areas'>): void {
  data.points.forEach((p, i) => {
    if (p.kind !== 'highway=bus_stop' || !pl.inArea(p.x, p.z)) {
      return;
    }
    const shelter = p.shelter === 'yes';
    const spot = pl.near(p.x, p.z, 6, shelter ? 1.2 : 0.4, shelter ? 3 : 1);
    if (!spot) {
      return;
    }
    const [x, z] = spot;
    const yaw = pl.faceStreet(x, z, 0);
    const waiting = 1 + Math.floor(hash(i * 5.3) * (shelter ? 5 : 3));
    if (!pl.prop(shelter ? 'busShelter' : 'busSign', x, z, yaw)) {
      return;
    }
    for (let k = 0; k < waiting; k++) {
      const sit = shelter && k < 2 && hash(i + k * 3.3) < 0.6;
      const [px, pz] = sit ? local(x, z, yaw, -1.1 + k * 0.7, -0.4) : local(x, z, yaw, (hash(i * 7 + k) - 0.5) * 4.5, 0.3 + hash(k * 3 + i) * 0.9);
      pl.person(px, pz, yaw + (hash(k + i * 1.1) - 0.5) * 1.2, sit ? Pose.Sit : Pose.Stand, i * 31 + k);
    }
  });
  // Tram platforms (T1): passengers spread along the platform islands next to each stop.
  const stops = data.points.filter((p) => p.kind === 'railway=tram_stop');
  for (const a of data.areas) {
    if (a.kind !== 'railway=platform' || (a.layer ?? 0) !== 0) {
      continue;
    }
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < a.ring.length; k += 2) {
      cx += a.ring[k];
      cz += a.ring[k + 1];
    }
    cx /= a.ring.length / 2;
    cz /= a.ring.length / 2;
    if (!pl.inArea(cx, cz) || !stops.some((s) => Math.hypot(s.x - cx, s.z - cz) < 80)) {
      continue;
    }
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
    const busy = /Eminönü|Karaköy/.test(stops.find((s) => Math.hypot(s.x - cx, s.z - cz) < 80)?.name ?? '') ? 1.6 : 1;
    const want = Math.round(Math.min(26, ((x1 - x0) * (z1 - z0)) / 30) * busy);
    for (let t = 0, k = 0; k < want && t < want * 8; t++) {
      const x = x0 + hash(t * 1.3 + cx) * (x1 - x0);
      const z = z0 + hash(t * 2.9 + cz) * (z1 - z0);
      if (!pointInRing(a.ring, x, z) || pl.clearance(x, z) < 0.7) {
        continue;
      }
      pl.person(x, z, hash(t + cx) * 6.28, Pose.Stand, Math.round(cx) + t, pl.y(x, z) + 0.2);
      pl.reserve(x, z);
      k++;
    }
  }
}

function isFood(p: OsmPoint): boolean {
  return /^amenity=(cafe|restaurant|bar|pub|fast_food|ice_cream)$/.test(p.kind);
}

/** Tables along the facade in front of cafés and restaurants where the street leaves room; half the chairs taken. */
function placeCafes(pl: Placer, data: Pick<OsmData, 'points'>): void {
  const surface = pl.ctx.surface;
  data.points.forEach((p, i) => {
    if (!isFood(p) || !pl.inArea(p.x, p.z) || hash(i * 0.73) > 0.7) {
      return;
    }
    // Step out of the building towards the street until the spot is 1.1 m clear of the facade.
    let best: [number, number] | null = null;
    for (let r = 0.5; r <= 9 && !best; r += 0.75) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        const wall = pl.wall(x, z);
        if (wall < 1.0 || wall > 1.6) {
          continue;
        }
        const zone = surface.zone(x, z);
        const cobble = surface.surfaceAt(x, z) !== Surf.Asphalt;
        const roomy = zone === Zone.Pedestrian || (zone === Zone.Sidewalk && surface.sidewalkWidth(x, z) >= 3) || (cobble && zone !== Zone.Carriageway) || zone === Zone.Lot;
        if (roomy && pl.free(x, z, 1.0, 2.2) && (zone !== Zone.Lot || streetClearance(surface, x, z) < 4)) {
          best = [x, z];
          break;
        }
      }
    }
    if (!best) {
      return;
    }
    const [x, z] = best;
    // Tables run along the facade: tangent = perpendicular to the wall distance gradient.
    const face = pl.faceAwayFromWall(x, z, 0);
    const tx = Math.cos(face);
    const tz = -Math.sin(face);
    const sets = 1 + Math.floor(hash(i * 1.9) * 3);
    const parasol = hash(i * 4.1) < 0.45;
    const tint = PARASOL_TINTS[Math.floor(hash(i * 2.2) * PARASOL_TINTS.length)];
    for (let k = 0; k < sets; k++) {
      const off = (k - (sets - 1) / 2) * 1.9;
      const px = x + tx * off;
      const pz = z + tz * off;
      if (k > 0 && (!pl.free(px, pz, 0.9, 1.5) || surface.zone(px, pz) === Zone.Carriageway)) {
        continue;
      }
      const yaw = face + Math.PI / 2 + (hash(k + i) - 0.5) * 0.25;
      if (!pl.prop('cafeTable', px, pz, yaw)) {
        continue;
      }
      for (const s of [-1, 1]) {
        if (hash(i * 3 + k * 7 + s) < 0.55) {
          const [sx, sz] = local(px, pz, yaw, s * 0.62, 0);
          pl.person(sx, sz, yaw - (s * Math.PI) / 2, Pose.Sit, i * 17 + k * 3 + s);
        }
      }
      if (parasol && k % 2 === 0) {
        pl.props.add('parasol', px, pl.y(px, pz), pz, 0, 1, tint);
      }
    }
  });
}

/** Simit and chestnut carts at tram stops, ferry piers, squares and along İstiklal, each with its seller. */
function placeCarts(pl: Placer, data: Pick<OsmData, 'points' | 'areas' | 'roads'>): void {
  const spots: [number, number, number][] = [];
  for (const p of data.points) {
    if (p.kind === 'railway=tram_stop' || p.kind === 'amenity=ferry_terminal' || p.kind === 'public_transport=station') {
      spots.push([p.x, p.z, 7]);
    }
  }
  for (const a of data.areas) {
    if (a.kind === 'place=square' || a.kind === 'amenity=ferry_terminal') {
      for (let k = 0; k < a.ring.length; k += 8) {
        spots.push([a.ring[k], a.ring[k + 1], 10]);
      }
    }
  }
  for (const r of data.roads) {
    if (r.name && /stiklal/i.test(r.name)) {
      for (let k = 0; k < r.pts.length; k += 6) {
        spots.push([r.pts[k], r.pts[k + 1], 5]);
      }
    }
  }
  let placed = 0;
  spots.forEach(([sx, sz, rad], i) => {
    if (hash(i * 2.71 + sx) > 0.55 || placed > 40) {
      return;
    }
    const spot = pl.near(sx + (hash(i) - 0.5) * rad, sz + (hash(i * 3) - 0.5) * rad, rad, 1.2, 6);
    if (!spot) {
      return;
    }
    const [x, z] = spot;
    const yaw = hash(i * 5.5) * 6.28;
    const chestnut = hash(i * 8.3) < 0.35;
    if (!pl.prop(chestnut ? 'chestnutCart' : 'simitCart', x, z, yaw)) {
      return;
    }
    const [vx, vz] = local(x, z, yaw, 0.2, -0.95);
    pl.person(vx, vz, yaw, Pose.Stand, i * 7 + 3);
    if (hash(i * 6.1) < 0.5) {
      const [cx, cz] = local(x, z, yaw, -0.3, 1.1);
      pl.person(cx, cz, yaw + Math.PI, Pose.Stand, i * 7 + 5);
    }
    placed++;
  });
}

function placeKiosks(pl: Placer, data: Pick<OsmData, 'points'>): void {
  data.points.forEach((p, i) => {
    if (p.kind !== 'shop=kiosk' || !pl.inArea(p.x, p.z)) {
      return;
    }
    const spot = pl.near(p.x, p.z, 5, 0.8, 3);
    if (spot) {
      pl.prop('kiosk', spot[0], spot[1], pl.faceStreet(spot[0], spot[1], hash(i) * 6.28));
    }
  });
}

/** Chatting groups and onlookers on squares and around the Galata Tower, pigeons in front of Yeni Cami. */
function placeSquares(pl: Placer, data: Pick<OsmData, 'areas' | 'points'>): void {
  for (const a of data.areas) {
    if (a.kind !== 'place=square' && a.kind !== 'highway=pedestrian') {
      continue;
    }
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
    const busy = /Eminönü/.test(a.name ?? '');
    const groups = Math.round((((x1 - x0) * (z1 - z0)) / (busy ? 260 : 900)) * (0.5 + pl.ctx.poi((x0 + x1) / 2, (z0 + z1) / 2)));
    for (let t = 0, g = 0; g < groups && t < groups * 6; t++) {
      const x = x0 + hash(t * 1.1 + a.id * 0.01) * (x1 - x0);
      const z = z0 + hash(t * 1.7 - a.id * 0.01) * (z1 - z0);
      if (!pointInRing(a.ring, x, z) || !pl.free(x, z, 1.5, 3)) {
        continue;
      }
      const n = 2 + Math.floor(hash(t * 3.3 + x) * 3);
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2 + hash(t);
        const px = x + Math.cos(ang) * 0.55;
        const pz = z + Math.sin(ang) * 0.55;
        pl.person(px, pz, Math.atan2(x - px, z - pz), Pose.Stand, t * 11 + k + a.id);
      }
      pl.reserve(x, z);
      g++;
    }
    if (busy) {
      const flocks = Math.max(1, Math.round(((x1 - x0) * (z1 - z0)) / 5000));
      for (let t = 0, f = 0; f < flocks && t < 40; t++) {
        const x = x0 + hash(t * 4.1 + 0.3) * (x1 - x0);
        const z = z0 + hash(t * 5.3 + 0.7) * (z1 - z0);
        if (pointInRing(a.ring, x, z) && pl.free(x, z, 3, 4)) {
          pl.pigeons.push(x, pl.y(x, z), z, 5 + hash(t) * 4, 40 + Math.round(hash(t * 2) * 50));
          // Someone feeding them.
          pl.person(x + 1.2, z + 0.8, Math.atan2(-1.2, -0.8), Pose.Stand, t * 5 + 1);
          pl.reserve(x, z);
          f++;
        }
      }
    }
  }
  // Tourists around the landmark pads (Galata Tower forecourt, mosque yards), looking up.
  const pads = pl.ctx.pads;
  for (let k = 0; k < pads.length; k += 3) {
    const [cx, cz, r] = [pads[k], pads[k + 1], pads[k + 2]];
    if (!pl.inArea(cx, cz) || r > 45) {
      continue;
    }
    const n = Math.round(r * 0.9 * (0.3 + pl.ctx.poi(cx, cz)));
    for (let t = 0; t < n * 3 && t < 60; t++) {
      const ang = hash(t * 1.9 + cx) * Math.PI * 2;
      const rr = r * (0.75 + 0.5 * hash(t * 2.3 + cz));
      const x = cx + Math.cos(ang) * rr;
      const z = cz + Math.sin(ang) * rr;
      if (pl.free(x, z, 0.8, 0.9) && pl.ctx.surface.zone(x, z) !== Zone.Carriageway) {
        pl.person(x, z, Math.atan2(cx - x, cz - z) + (hash(t) - 0.5) * 0.8, Pose.Stand, t * 3 + Math.round(cx));
        pl.reserve(x, z);
      }
    }
  }
}

/** Flag poles: ferry terminals, schools and public buildings, the Galataport quay. */
function placeFlags(pl: Placer, data: Pick<OsmData, 'points' | 'areas'>): void {
  const add = (x: number, z: number, h: number, kind: number): void => {
    const spot = pl.near(x, z, 8, 1.5, 2);
    if (spot) {
      const y = pl.y(spot[0], spot[1]);
      if (pl.props.add('flagPole', spot[0], y, spot[1], 0, 1, undefined, h)) {
        pl.flags.push(spot[0], y, spot[1], 0, h, kind);
        pl.reserve(spot[0], spot[1]);
      }
    }
  };
  data.points.forEach((p, i) => {
    if (!pl.inArea(p.x, p.z)) {
      return;
    }
    if (/^amenity=(school|townhall|police|courthouse|college|university)$|^office=government/.test(p.kind) && hash(i) < 0.6) {
      add(p.x, p.z, 7 + hash(i * 3) * 3, 0);
    }
  });
  for (const a of data.areas) {
    if (a.kind === 'amenity=ferry_terminal' || a.kind === 'landuse=harbour') {
      const step = a.kind === 'landuse=harbour' ? 30 : 12;
      for (let k = 0; k < a.ring.length; k += step) {
        if (pl.inArea(a.ring[k], a.ring[k + 1])) {
          add(a.ring[k], a.ring[k + 1], 9, 0);
        }
      }
    }
  }
}

/** Mooring bollards and lifebuoys along the quays within reach of the piers and moored boats. */
function placeQuay(pl: Placer, data: Pick<OsmData, 'lines'>, anchors: readonly number[]): void {
  const geo = pl.ctx.surface.geo;
  for (const l of data.lines) {
    if (l.kind !== 'natural=coastline') {
      continue;
    }
    let along = 0;
    for (let k = 2; k < l.pts.length; k += 2) {
      const ax = l.pts[k - 2];
      const az = l.pts[k - 1];
      const bx = l.pts[k];
      const bz = l.pts[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) {
        continue;
      }
      const tx = (bx - ax) / len;
      const tz = (bz - az) / len;
      for (; along < len; along += 9) {
        const x = ax + tx * along;
        const z = az + tz * along;
        let close = false;
        for (let a = 0; a < anchors.length && !close; a += 2) {
          close = Math.hypot(anchors[a] - x, anchors[a + 1] - z) < 170;
        }
        if (!close || !pl.inArea(x, z)) {
          continue;
        }
        // Step inland (left of the coastline direction) until on land.
        for (let d = 0.6; d < 4; d += 0.4) {
          const px = x + tz * d;
          const pz = z - tx * d;
          if (geo.coast(px, pz) > 0.4 && pl.ctx.surface.zone(px, pz) !== Zone.Carriageway && pl.wall(px, pz) > 1) {
            const lifebuoy = Math.floor(along / 9 + k) % 7 === 0;
            pl.props.add(lifebuoy ? 'lifebuoy' : 'mooring', px, pl.y(px, pz), pz, Math.atan2(-tz, tx));
            break;
          }
        }
      }
      along -= len;
    }
  }
}

const HOARDING_TINTS: [number, number, number][] = [
  [0.1, 0.25, 0.55],
  [0.16, 0.38, 0.22],
  [0.85, 0.85, 0.82],
  [0.55, 0.57, 0.58],
];

/** Hoardings along the perimeter of landuse=construction sites (off streets and buildings), a crane on big sites. */
function placeConstruction(pl: Placer, data: Pick<OsmData, 'areas'>): void {
  const s = pl.ctx.surface;
  for (const a of data.areas) {
    if (a.kind !== 'landuse=construction' || (a.layer ?? 0) !== 0) {
      continue;
    }
    const tint = HOARDING_TINTS[Math.floor(hash(a.id * 0.0137) * HOARDING_TINTS.length)];
    const ring = a.ring;
    const n = ring.length / 2;
    let area = 0;
    let cx = 0;
    let cz = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = ring[j * 2];
      const az = ring[j * 2 + 1];
      const bx = ring[i * 2];
      const bz = ring[i * 2 + 1];
      area += (ax * bz - bx * az) / 2;
      cx += ax;
      cz += az;
      const len = Math.hypot(bx - ax, bz - az);
      const yaw = Math.atan2(bz - az, -(bx - ax));
      for (let d = 1; d + 1 <= len; d += 2) {
        const x = ax + ((bx - ax) * (d / len));
        const z = az + ((bz - az) * (d / len));
        if (!pl.inArea(x, z, 8) || s.geo.coast(x, z) < 1 || pl.wall(x, z) < 0.4 || pl.onPad(x, z)) {
          continue;
        }
        const zone = s.zone(x, z);
        if (zone === Zone.Carriageway || zone === Zone.Sidewalk) {
          continue;
        }
        pl.props.add('hoarding', x, pl.y(x, z), z, yaw, 1, tint);
      }
    }
    cx /= n;
    cz /= n;
    if (Math.abs(area) > 2500 && pointInRing(ring, cx, cz) && pl.wall(cx, cz) > 4 && pl.inArea(cx, cz)) {
      pl.props.add('crane', cx, pl.y(cx, cz), cz, hash(a.id * 0.31) * Math.PI * 2);
    }
  }
}

export interface PlacementResult {
  standers: Float32Array;
  flags: Float32Array;
  pigeons: Float32Array;
}

export function placeFurniture(pl: Placer, data: Pick<OsmData, 'points' | 'roads' | 'areas' | 'lines'>, quayAnchors: readonly number[]): PlacementResult {
  placeStops(pl, data);
  placeKiosks(pl, data);
  placeCarts(pl, data);
  placeBenches(pl, data);
  placeCafes(pl, data);
  placeSquares(pl, data);
  placeFlags(pl, data);
  placeBollards(pl, data);
  placeQuay(pl, data, quayAnchors);
  placeConstruction(pl, data);
  return {
    standers: Float32Array.from(pl.standers),
    flags: Float32Array.from(pl.flags),
    pigeons: Float32Array.from(pl.pigeons),
  };
}

