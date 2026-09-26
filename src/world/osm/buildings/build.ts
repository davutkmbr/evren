/**
 * Buildings worker core: turns OSM outlines, building:part records and infill parcels into
 * - one facade mesh (every wall, trim, bay window, flat roof slab; facade texture array, see materials.ts),
 * - one roof mesh (tiles, lead domes, ridge caps),
 * - near-LOD detail instances per tile (details.ts), rooftop / minaret prop instances (roofs.ts),
 * - one footprint prism collider per building (outline and courtyards, protocol.ts encodePrism).
 *
 * Walls are classified against their surroundings: party walls (another footprint right behind them) stay blank,
 * street walls get shops from mapped POIs or the neighbourhood's shop rate, courtyard walls get small windows.
 */
import type { WorldBounds } from '../../../core/contracts';
import type { OsmBuilding } from '../data';
import { BoxGrid, bounds, hash, pointInRing, ringArea, segDist } from '../shared/geometry';
import type { StreetSurface } from '../shared/street-surface';
import { Arch, Balcony, Flag, groundRow, Kind } from './archetypes';
import { DetailSink } from './details';
import { emitLining, emitPlane, type EmitContext, layoutFor, type Plane, planeFrom } from './facade';
import { cleanRing, footprintInfo, orientedBox } from './footprint';
import { bayWindow, type Edge, mouldings } from './massing';
import { FACADE_STATE, RecordList, ROOF_STATE, StateMesh } from './mesh';
import { clearanceOf, planBuilding, wallHeight } from './plan';
import { encodePrism } from './protocol';
import { passageArch, passageColliders, passageProfile, portalOnWall, portalWalls, wallHit, type Passage, type Wall } from '../shared/passages';
import { buildRoof, createPropSink, type PropSink } from './roofs';
import { ringTouchesLineBody, type LandmarkClaims } from '../../landmarks/claim-shapes';

/** building=* values that are not solid buildings (canopies, ruins, bridge decks). */
const SKIP_KINDS = new Set(['roof', 'ruins', 'collapsed', 'bridge', 'construction', 'no', 'carport']);

/** POI point kinds (x, z, kind triples): 1 shop, 2 food and drink (awnings), 3 services (banks, pharmacies). */
export const Poi = { Shop: 1, Food: 2, Service: 3, Hotel: 4 } as const;

export interface BuildInput {
  buildings: readonly OsmBuilding[];
  /** x, z, Poi kind triples. */
  pois: Float32Array;
  /** Ground claims of the modelled landmarks and neighbourhood mosques (landmarks/claims.ts). */
  claims: LandmarkClaims;
  /** Extra footprints (infill parcels) built like building=yes. */
  extra?: readonly OsmBuilding[];
  /** Building passages (shared/passages.ts findPassages): arched openings, a lined passage and a free collider. */
  passages?: readonly Passage[];
}

export interface BuildOutput {
  facade: StateMesh;
  roof: StateMesh;
  details: DetailSink;
  props: PropSink;
  /** Prism records (protocol.ts encodePrism). */
  colliders: Float32Array;
  /** OSM id per collider record (debug labels). */
  colliderIds: Float64Array;
  stats: Record<string, number>;
}

interface Solid {
  b: OsmBuilding;
  ring: number[];
  holes: number[][];
  id: number;
  infill: boolean;
}

/** Index of solid footprints for "is there another building right behind this wall" queries. */
class SolidIndex {
  private readonly grid = new BoxGrid(16);
  constructor(private readonly solids: readonly Solid[]) {
    solids.forEach((s, i) => {
      const bb = bounds(s.ring);
      this.grid.add(i, bb.minX, bb.minZ, bb.maxX, bb.maxZ);
    });
  }

  /** Index of a solid (other than `self`) containing (x, z), or -1. */
  other(x: number, z: number, self: number): number {
    for (const id of this.grid.at(x, z)) {
      if (id !== self && pointInRing(this.solids[id].ring, x, z)) {
        return id;
      }
    }
    return -1;
  }
}

/** POI grid: nearest POI kind within a distance of a wall segment. */
class PoiIndex {
  private readonly grid = new BoxGrid(24);
  constructor(private readonly pois: Float32Array) {
    for (let i = 0; i < pois.length; i += 3) {
      this.grid.add(i / 3, pois[i] - 8, pois[i + 1] - 8, pois[i] + 8, pois[i + 1] + 8);
    }
  }

  /** Poi kind of the POI nearest to segment a-b within `d` m, 0 for none. */
  near(ax: number, az: number, bx: number, bz: number, d: number): number {
    let best = 0;
    let bestD = d;
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / 12));
    const seen = new Set<number>();
    for (let s = 0; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps;
      const z = az + ((bz - az) * s) / steps;
      for (const id of this.grid.at(x, z)) {
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        const dist = segDist(this.pois[id * 3], this.pois[id * 3 + 1], ax, az, bx, bz);
        if (dist < bestD) {
          bestD = dist;
          best = this.pois[id * 3 + 2];
        }
      }
    }
    return best;
  }
}

function padHit(pads: Float32Array, x: number, z: number): boolean {
  for (let k = 0; k < pads.length; k += 3) {
    const dx = x - pads[k];
    const dz = z - pads[k + 1];
    if (dx * dx + dz * dz < pads[k + 2] * pads[k + 2]) {
      return true;
    }
  }
  return false;
}

/** Fraction of ring vertices (and the centroid) inside a landmark pad. */
function padCover(pads: Float32Array, r: readonly number[], cx: number, cz: number): number {
  let hit = padHit(pads, cx, cz) ? 1 : 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    hit += padHit(pads, r[i * 2], r[i * 2 + 1]) ? 1 : 0;
  }
  return hit / (n + 1);
}

/** building:part with the parent outline's tags filled in where the part leaves them open (S3DB inheritance). */
function inherit(part: OsmBuilding, parent: OsmBuilding): OsmBuilding {
  return {
    ...part,
    kind: part.kind === 'yes' ? parent.kind : part.kind,
    name: part.name ?? parent.name,
    amenity: part.amenity ?? parent.amenity,
    religion: part.religion ?? parent.religion,
    historic: part.historic ?? parent.historic,
    colour: part.colour ?? parent.colour,
    material: part.material ?? parent.material,
    roofColour: part.roofColour ?? parent.roofColour,
    roofMaterial: part.roofMaterial ?? parent.roofMaterial,
  };
}

export function buildBuildings(input: BuildInput, surface: StreetSurface, rect: WorldBounds): BuildOutput {
  const geo = surface.geo;
  const facade = new StateMesh(FACADE_STATE);
  const roof = new StateMesh(ROOF_STATE);
  const details = new DetailSink(rect);
  const props = createPropSink();
  const colliders: number[] = [];
  const colliderIds: number[] = [];
  const stats: Record<string, number> = {
    built: 0,
    infill: 0,
    parts: 0,
    skippedLandmark: 0,
    skippedWater: 0,
    party: 0,
    streetWalls: 0,
    shopWalls: 0,
    windows: 0,
    balconies: 0,
    signs: 0,
    awnings: 0,
    cornices: 0,
    cumba: 0,
    cikma: 0,
    pitched: 0,
    gabled: 0,
    domes: 0,
    minarets: 0,
    stairHouses: 0,
    courtyards: 0,
  };
  const archStats: Record<string, number> = {};

  // 1. Solids: parts replace outlines that have them (and inherit their tags and colour seed); everything outside
  // the rect, on water or on a landmark goes.
  const parents = input.buildings.filter((b) => b.hasParts);
  const parentOf = (b: OsmBuilding): OsmBuilding | null => {
    const n = b.ring.length / 2;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      cx += b.ring[i * 2];
      cz += b.ring[i * 2 + 1];
    }
    return parents.find((p) => pointInRing(p.ring, cx / n, cz / n)) ?? null;
  };
  const solids: Solid[] = [];
  const consider = (src: OsmBuilding, infill: boolean): void => {
    if (src.hasParts || SKIP_KINDS.has(src.kind)) {
      return;
    }
    const parent = src.part ? parentOf(src) : null;
    const b: OsmBuilding = parent ? inherit(src, parent) : src;
    let ring = cleanRing(b.ring);
    if (ring.length < 6) {
      return;
    }
    if (ringArea(ring) < 0) {
      const rev: number[] = [];
      for (let i = ring.length - 2; i >= 0; i -= 2) {
        rev.push(ring[i], ring[i + 1]);
      }
      ring = rev;
    }
    const n = ring.length / 2;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      cx += ring[i * 2];
      cz += ring[i * 2 + 1];
    }
    cx /= n;
    cz /= n;
    if (cx < rect.minX || cx > rect.maxX || cz < rect.minZ || cz > rect.maxZ) {
      return;
    }
    if (geo.isWater(cx, cz)) {
      stats.skippedWater++;
      return;
    }
    if (padCover(input.claims.pads, ring, cx, cz) > 0.5 || ringTouchesLineBody(input.claims.lines, ring)) {
      stats.skippedLandmark++;
      return;
    }
    const holes = (b.holes ?? [])
      .map((h) => cleanRing(h))
      .filter((h) => h.length >= 6)
      .map((h) => {
        if (ringArea(h) > 0) {
          const rev: number[] = [];
          for (let i = h.length - 2; i >= 0; i -= 2) {
            rev.push(h[i], h[i + 1]);
          }
          return rev;
        }
        return h;
      });
    solids.push({ b, ring, holes, id: parent ? parent.id : b.id, infill });
  };
  for (const b of input.buildings) {
    consider(b, false);
  }
  for (const b of input.extra ?? []) {
    consider(b, true);
  }
  const index = new SolidIndex(solids);
  const pois = new PoiIndex(input.pois);
  const passagesOf = new Map<number, Passage[]>();
  for (const p of input.passages ?? []) {
    passagesOf.set(p.building, [...(passagesOf.get(p.building) ?? []), p]);
  }
  stats.passages = 0;

  // 2. Build every solid.
  solids.forEach((s, si) => {
    const { b, ring: r, holes } = s;
    const n = r.length / 2;
    const box = orientedBox(r);
    const info = footprintInfo(r, box);
    const plan = planBuilding(b, info, s.id);
    if (holes.length && plan.roof !== 'flat') {
      plan.roof = 'flat';
      plan.parapet = 0.9;
      plan.bay = plan.bay === 'cikma' ? 'none' : plan.bay;
      plan.clearance = clearanceOf(plan);
    }
    archStats[plan.arch] = (archStats[plan.arch] ?? 0) + 1;

    const ground: number[] = [];
    let gMin = Infinity;
    let gMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const g = geo.height(r[i * 2], r[i * 2 + 1]);
      ground.push(g);
      gMin = Math.min(gMin, g);
      gMax = Math.max(gMax, g);
    }
    const gRef = gMin + 0.5 * (gMax - gMin);
    const rise = Math.min(5, box.hw * plan.pitch);
    const wallH = wallHeight(b, plan, rise);
    plan.wallH = wallH;
    const top = gRef + wallH;
    const yBase = plan.minH > 0.5 ? gRef + plan.minH : gMin - 1.5;
    const wallTopV = top - gMin;
    const pitched = plan.roof !== 'flat' && plan.roof !== 'domes';
    const ctx: EmitContext = { mesh: facade, details, plan, poi: 0, stats };
    // Passages through this building (rule walk.passage): the arch fits under the walls and both portal walls take it.
    const passages = s.infill
      ? []
      : (passagesOf.get(b.id) ?? []).flatMap((p) => {
          const walls = portalWalls(p, [r, ...holes]);
          const yA = surface.heightAt(p.ax, p.az);
          const yB = surface.heightAt(p.bx, p.bz);
          const arch = passageArch(p, top - Math.max(yA, yB));
          const len = Math.hypot(p.bx - p.ax, p.bz - p.az) || 1;
          return walls && arch ? [{ p, walls, arch, floorAt: (q: number): number => yA + (yB - yA) * Math.max(0, Math.min(1, q / len)) }] : [];
        });
    stats.passages += passages.length;
    /** Openings of the passages in wall edge `edge` of ring `ri`, in the coordinates of plane `pl`. */
    const portalsOf = (ri: number, edge: number, pl: Pick<Plane, 'ax' | 'az' | 'tx' | 'tz'>): NonNullable<Plane['portals']> => {
      const out: NonNullable<Plane['portals']> = [];
      for (const q of passages) {
        const prof = passageProfile(q.p, q.arch);
        for (const w of q.walls as readonly Wall[]) {
          if (w.ring !== ri || w.edge !== edge) {
            continue;
          }
          const po = portalOnWall(q.p, prof, w);
          const arc: [number, number][] = [];
          for (let k = prof.arc0; k <= prof.arc1; k++) {
            const x = w.ax + w.ux * po.t[k];
            const z = w.az + w.uz * po.t[k];
            arc.push([(x - pl.ax) * pl.tx + (z - pl.az) * pl.tz, q.floorAt(wallHit(q.p, prof.o[k], w)) + prof.h[k] - gMin]);
          }
          const us = arc.map((a) => a[0]);
          out.push({ u0: Math.min(...us), u1: Math.max(...us), arc, crownV: Math.max(...arc.map((a) => a[1])) });
        }
      }
      return out;
    };
    const baseFlags = (pitched ? Flag.Pitched : 0) | (plan.shutters ? Flag.Shutters : 0) | (plan.roller ? Flag.Roller : 0) | (plan.office ? Flag.Office : 0) | (plan.plinthOn ? Flag.Plinth : 0) | (plan.banded ? Flag.Banded : 0) | (plan.clapboard ? Flag.Clapboard : 0);

    // Walls of the outer ring and courtyards.
    const outerEdges: Edge[] = [];
    let bayDone = 0;
    const rings: [number[], boolean][] = [[r, false], ...holes.map((h): [number[], boolean] => [h, true])];
    for (const [ri, [ring, court]] of rings.entries()) {
      const m = ring.length / 2;
      const rg: number[] = court ? [] : ground;
      if (court) {
        stats.courtyards++;
        for (let i = 0; i < m; i++) {
          rg.push(geo.height(ring[i * 2], ring[i * 2 + 1]));
        }
      }
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const ax = ring[i * 2];
        const az = ring[i * 2 + 1];
        const bx = ring[j * 2];
        const bz = ring[j * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) {
          if (!court) {
            outerEdges.push({ ax, az, bx, bz, len, nx: 0, nz: 0, exposed: false, street: false, plane: null });
          }
          continue;
        }
        const nx = (bz - az) / len;
        const nz = -(bx - ax) / len;
        // Party wall: another footprint right behind it at two of three probes.
        let behind = 0;
        if (!court) {
          for (const t of [0.2, 0.5, 0.8]) {
            if (index.other(ax + (bx - ax) * t + nx * 0.7, az + (bz - az) * t + nz * 0.7, si) >= 0) {
              behind++;
            }
          }
        }
        const party = behind >= 2;
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        const street = !court && !party && surface.distance(mx + nx * 3, mz + nz * 3) < 1.5;
        const poi = street ? pois.near(ax + nx * 1.5, az + nz * 1.5, bx + nx * 1.5, bz + nz * 1.5, 6) : 0;
        const shop = street && len >= 2.4 && plan.arch !== Arch.Mosque && (poi > 0 || hash(plan.seed * 53.1 + i * 7.3) < plan.shopRate);
        if (party) {
          stats.party++;
        }
        if (street) {
          stats.streetWalls++;
        }
        if (shop) {
          stats.shopWalls++;
        }
        const geoPlane = planeFrom(ax, az, bx, bz, nx, nz);
        const ga = rg[i] - gMin;
        const gb = rg[j] - gMin;
        const g0 = geoPlane.ax === ax && geoPlane.az === az ? ga : gb;
        const g1 = g0 === ga ? gb : ga;
        const lay = layoutFor(plan, len, court);
        const windowed = len >= 1.6 && !party;
        let balcony = street || !court ? plan.balcony : Balcony.None;
        if (!street && balcony === Balcony.Centre) {
          balcony = Balcony.None;
        }
        const plane: Plane = {
          ...geoPlane,
          ...lay,
          yBot: yBase,
          yTop: top,
          gMin,
          g0: court ? Math.max(0, g0) : g0,
          g1: court ? Math.max(0, g1) : g1,
          wallTopV,
          kind: party ? Kind.Blank : windowed ? Kind.Wall : Kind.Trim,
          flags: baseFlags | (street ? Flag.Street : 0) | (shop ? Flag.Shop : 0) | (court ? Flag.Court : 0) | (poi > 0 ? Flag.Busy : 0),
          balcony: windowed ? balcony : Balcony.None,
        };
        ctx.poi = poi;
        const portals = portalsOf(ri, i, plane);
        if (portals.length) {
          // A passage opening: no shopfront or bay window on this wall.
          plane.portals = portals;
          plane.flags &= ~Flag.Shop;
        }
        if (!portals.length && !court && street && windowed && plan.bay !== 'none' && bayDone < (plan.bay === 'cikma' ? 1 : 2) && len >= 4.5) {
          const range = bayWindow(ctx, plane, top, pitched);
          if (range) {
            plane.skip = range;
            bayDone++;
          }
        }
        emitPlane(ctx, plane);
        if (!court) {
          outerEdges.push({ ax, az, bx, bz, len, nx, nz, exposed: !party, street, plane });
        }
      }
    }

    for (const q of passages) {
      emitLining(ctx, q.p, q.arch, q.walls, q.floorAt, gMin, wallTopV);
    }

    // Cornices and string courses along the exposed outer walls.
    if (plan.cornice !== 'none' || plan.courses) {
      const gMid = ground.reduce((a, g) => a + g, 0) / n - gMin;
      mouldings(ctx, outerEdges, gMin, top, groundRow(gMid, plan.floorH) * plan.floorH);
    }

    // Roof.
    const peak = buildRoof({ roof, facade, plan, ring: r, holes, box, top, gMin, props, stats });

    // The drawn footprint itself (an oriented box over an L-shaped or concave outline blocks streets and squares).
    if (passages.length) {
      // The passages stay free under their vaults (shared/passages.ts passageColliders).
      for (const piece of passageColliders([r, ...holes], passages.map((q) => q.p))) {
        const q = piece.vault ? passages.find((w) => w.p === piece.vault) : undefined;
        const bottom = q ? Math.max(q.floorAt(0), q.floorAt(Infinity)) + q.arch.crown : yBase;
        encodePrism(colliders, bottom, peak, piece.rings);
        colliderIds.push(s.id);
      }
    } else {
      encodePrism(colliders, yBase, peak, [r, ...holes]);
      colliderIds.push(s.id);
    }
    stats.built++;
    if (s.infill) {
      stats.infill++;
    }
    if (b.part) {
      stats.parts++;
    }
  });

  for (const [k, v] of Object.entries(archStats)) {
    stats[`arch${k}`] = v;
  }
  return { facade, roof, details, props, colliders: new Float32Array(colliders), colliderIds: new Float64Array(colliderIds), stats };
}
