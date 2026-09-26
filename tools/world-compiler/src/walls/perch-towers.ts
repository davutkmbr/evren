/**
 * Wall-tower perch candidates (phase 03 viewpoints): every placed tower whose top is flat enough to stand on, measured
 * on its own LOD 0 mesh and collider, with the tallest thing around it. Written to
 * src/world/landmarks/walls/data/towers.json (committed: the perch service resolves the wall perches from it without
 * the gitignored bake); src/world/perches/walls.ts picks the perches from these candidates with the perch rules.
 *
 * Per candidate: the grip point (the highest surface of the top platform within GRIP_R of its centre), the tower's
 * outward direction, the ground at its centre and the neighbour top: the tallest building within NEIGHBOUR_R (mapped
 * OSM buildings by height / levels, and the procedural city's own building colliders from its worker code at full
 * density, as if no OSM region replaced it) and the tallest other wall piece (collider tops). Trees are not counted:
 * perches clear the trees around them (src/world/perches/clearings.ts).
 */
import type { GeoQuery } from '../../../../src/core/contracts';
import { buildInitMessage, GeoWindowCutter } from '../../../../src/world/city/geo-window';
import { COLLIDER_STRIDE, LEVEL_SIZES } from '../../../../src/world/city/protocol';
import { buildColliders } from '../../../../src/world/city/worker/tile';
import { WorldData } from '../../../../src/world/city/worker/world-data';
import { MeshBuilder } from '../../../../src/world/landmarks/heritage/build/mesh-builder';
import { gate, tower, type GroundFn, type KitCollider } from '../../../../src/world/landmarks/walls/kit/kit';
import type { Footprints } from './buildings';
import type { Piece, TowerPiece } from './plan';

/** Radius (m) around the platform centre the grip is measured over (the dragon's feet). */
const GRIP_R = 2.5;
/** Largest drop (m) from the collider top to the grip: more and the broken top is too jagged to stand on. */
const MAX_JAG = 0.9;
/** Neighbourhood radius (m), as PERCH_RULES.neighbourRadius. */
const NEIGHBOUR_R = 40;
/** Storey height (m) and roof allowance for buildings without a height tag (levels default 4). */
const STOREY = 3.2;
const ROOF = 3;
const DEFAULT_LEVELS = 4;

/** [osm id of the tower or its wall line, x, z, grip y, ground y, outward x, outward z, neighbour top]. */
export type TowerCandidate = [number, number, number, number, number, number, number, number];

/** Highest triangle hit by a vertical ray at (x, z) in an indexed mesh (world coordinates), or -Infinity. */
function rayTop(pos: Float32Array, index: ArrayLike<number>, x: number, z: number): number {
  let best = -Infinity;
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3;
    const b = index[i + 1] * 3;
    const c = index[i + 2] * 3;
    const ax = pos[a];
    const az = pos[a + 2];
    const bx = pos[b];
    const bz = pos[b + 2];
    const cx = pos[c];
    const cz = pos[c + 2];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) {
      continue;
    }
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) {
      continue;
    }
    best = Math.max(best, l1 * pos[a + 1] + l2 * pos[b + 1] + l3 * pos[c + 1]);
  }
  return best;
}

function colliderTop(cols: readonly KitCollider[]): number {
  return cols.reduce((m, c) => Math.max(m, c.cy + c.hy), -Infinity);
}

/**
 * Collider boxes of the towers and gates as (x, z, radius, top) for the neighbour test (the curtains stand lower than
 * the towers on them).
 */
function pieceTops(pieces: readonly Piece[], ground: GroundFn): { x: number; z: number; r: number; top: number; n: number }[] {
  const out: { x: number; z: number; r: number; top: number; n: number }[] = [];
  pieces.forEach((piece, n) => {
    const cols: KitCollider[] = [];
    const mb = new MeshBuilder(0, 0);
    if (piece.kind === 'tower') {
      tower({ mb, lod: 0, colliders: cols }, piece.at, piece.dir, ground, piece.p);
    } else if (piece.kind === 'gate') {
      gate({ mb, lod: 0, colliders: cols }, piece.a, piece.b, ground, piece.p);
    }
    for (const c of cols) {
      out.push({ x: c.cx, z: c.cz, r: Math.hypot(c.hx, c.hz), top: c.cy + c.hy, n });
    }
  });
  return out;
}

/** The procedural city's building colliders (the game's city worker code), per collider tile, cached. */
class CityProbe {
  private readonly world: WorldData;
  private readonly cutter: GeoWindowCutter;
  private readonly tiles = new Map<string, Float32Array>();
  private static readonly HALF = 24000; // city worker WORLD_HALF
  private static readonly SIZE = LEVEL_SIZES[0];
  private static readonly MARGIN = 130; // city-system COLLIDER_MARGIN

  constructor(geo: GeoQuery) {
    this.world = new WorldData(buildInitMessage(geo));
    this.cutter = new GeoWindowCutter(geo);
  }

  private tile(ix: number, iz: number): Float32Array {
    const key = `${ix}_${iz}`;
    let boxes = this.tiles.get(key);
    if (!boxes) {
      const S = CityProbe.SIZE;
      const M = CityProbe.MARGIN;
      const x0 = -CityProbe.HALF + ix * S;
      const z0 = -CityProbe.HALF + iz * S;
      const win = this.cutter.cut(x0 - M, z0 - M, x0 + S + M, z0 + S + M);
      boxes = buildColliders({ type: 'colliders', id: 0, ix, iz, size: S, densityScale: 1, win }, this.world).boxes;
      this.tiles.set(key, boxes);
    }
    return boxes;
  }

  /** Highest procedural building top whose box comes within r of (x, z), or -Infinity. */
  top(x: number, z: number, r: number): number {
    const S = CityProbe.SIZE;
    let best = -Infinity;
    for (let iz = Math.floor((z - r + CityProbe.HALF) / S); iz <= Math.floor((z + r + CityProbe.HALF) / S); iz++) {
      for (let ix = Math.floor((x - r + CityProbe.HALF) / S); ix <= Math.floor((x + r + CityProbe.HALF) / S); ix++) {
        const b = this.tile(ix, iz);
        for (let k = 0; k < b.length; k += COLLIDER_STRIDE) {
          if (Math.hypot(b[k] - x, b[k + 2] - z) - Math.hypot(b[k + 3], b[k + 5]) < r) {
            best = Math.max(best, b[k + 1] + b[k + 4]);
          }
        }
      }
    }
    return best;
  }
}

export function towerCandidates(pieces: readonly Piece[], ground: GroundFn, footprints: Footprints, owned: ReadonlySet<number>, geo: GeoQuery): { candidates: TowerCandidate[]; towers: number; jagged: number } {
  const others = pieceTops(pieces, ground);
  const city = new CityProbe(geo);
  const candidates: TowerCandidate[] = [];
  let towers = 0;
  let jagged = 0;
  pieces.forEach((piece, n) => {
    if (piece.kind !== 'tower') {
      return;
    }
    towers++;
    const t = piece as TowerPiece;
    const mb = new MeshBuilder(0, 0);
    const cols: KitCollider[] = [];
    tower({ mb, lod: 0, colliders: cols }, t.at, t.dir, ground, t.p);
    const mesh = mb.finalize(ground);
    // Platform centre: halfway between the back (inner face) and the front of the projection, along the outward normal.
    const [ax, az] = t.dir;
    const ox = -az;
    const oz = ax;
    const back = -t.p.wallThickness / 2 - 0.4;
    const front = t.p.wallThickness / 2 + t.p.projection;
    const vc = (back + front) / 2;
    const cx = t.at[0] + ox * vc;
    const cz = t.at[1] + oz * vc;
    let grip = rayTop(mesh.positions, mesh.index, cx, cz);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      grip = Math.max(grip, rayTop(mesh.positions, mesh.index, cx + Math.cos(a) * GRIP_R, cz + Math.sin(a) * GRIP_R));
    }
    const top = colliderTop(cols);
    if (!Number.isFinite(grip) || top - grip > MAX_JAG) {
      jagged++;
      return;
    }
    let neighbour = -Infinity;
    for (const o of others) {
      if (o.n !== n && Math.hypot(o.x - cx, o.z - cz) - o.r < NEIGHBOUR_R) {
        neighbour = Math.max(neighbour, o.top);
      }
    }
    for (const f of footprints.near(cx, cz, NEIGHBOUR_R)) {
      if (f.road || owned.has(f.id)) {
        continue;
      }
      const fx = (f.minX + f.maxX) / 2;
      const fz = (f.minZ + f.maxZ) / 2;
      const h = f.height ?? (f.levels ?? DEFAULT_LEVELS) * STOREY + ROOF;
      neighbour = Math.max(neighbour, ground(fx, fz) + h);
    }
    neighbour = Math.max(neighbour, city.top(cx, cz, NEIGHBOUR_R));
    const r1 = (v: number): number => Math.round(v * 10) / 10;
    candidates.push([t.src, r1(cx), r1(cz), Math.round(grip * 100) / 100, r1(ground(cx, cz)), Math.round(ox * 1000) / 1000, Math.round(oz * 1000) / 1000, Number.isFinite(neighbour) ? r1(neighbour) : -1]);
  });
  return { candidates, towers, jagged };
}
