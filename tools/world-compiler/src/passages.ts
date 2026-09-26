/**
 * Building passages in the compiled tiles (rule walk.passage, src/world/osm/shared/passages.ts): the walk network
 * links a foot way through a building only where the building really opens, so every accepted passage gets
 * - a round-arched opening in both portal walls (the plain blocks, buildings.ts emitSolid, and the façade kit,
 *   facade/build.ts: a hole in the wall grid with the arch's spandrels filled), shop units and windows kept off it;
 * - a lining: side walls, a barrel vault and a paved floor from portal to portal (the ground is not drawn under
 *   emitted blocks).
 * The runtime OSM buildings (src/world/osm/buildings/build.ts) open the same passages from the same rule.
 */
import type { OsmData } from '../../../src/world/osm/data';
import { findPassages, passageArch, passagePoint, passageProfile, portalOnWall, portalWalls, wallHit, type Passage, type Wall } from '../../../src/world/osm/shared/passages';
import type { Solid } from './buildings';
import type { GroundHeights } from './ground';
import type { MaterialName } from './materials';
import type { EmitOptions, TileMesh, Vec3 } from './mesh';

/** An accepted passage of a solid: its arch and portal walls in the solid's rings, and the floor heights. */
export interface SolidPassage {
  p: Passage;
  arch: { spring: number; crown: number };
  walls: [Wall, Wall];
  len: number;
  /** Floor height (m) at the entry and exit. */
  yA: number;
  yB: number;
}

/** Vertical trapezoid of a wall edge: t along the edge, bottom / top heights at t0 and t1. */
export interface WallPiece {
  t0: number;
  t1: number;
  b0: number;
  b1: number;
  top0: number;
  top1: number;
}

/** A passage opening on one wall edge (edge coordinates t from the edge's start, absolute heights). */
export interface Portal {
  t0: number;
  t1: number;
  /** Arch points (t, y), springing to springing. */
  arc: [number, number][];
  /** Highest point of the arch. */
  crownY: number;
}

/**
 * Finds the passages of the area (shared rule) and attaches the ones that fit to their solids (`s.passages`): the
 * building is emitted in the rect, the arch fits under its top (passageArch) and both portal walls take the opening.
 * Returns the accepted passages (for the walk network).
 */
export function attachPassages(solids: Solid[], data: Pick<OsmData, 'buildings' | 'roads'>, heights: GroundHeights): Passage[] {
  const byOsm = new Map<number, Solid[]>();
  for (const s of solids) {
    byOsm.set(s.rec.osmId, [...(byOsm.get(s.rec.osmId) ?? []), s]);
  }
  const out: Passage[] = [];
  for (const p of findPassages(data.buildings, data.roads)) {
    const s = byOsm.get(p.building)?.find((q) => q.grounded);
    if (!s) {
      continue;
    }
    const walls = portalWalls(p, [s.ring, ...s.holes]);
    const yA = heights.at(p.ax, p.az);
    const yB = heights.at(p.bx, p.bz);
    const arch = passageArch(p, s.rec.topY - Math.max(yA, yB));
    if (!walls || !arch) {
      continue;
    }
    (s.passages ??= []).push({ p, arch, walls, len: Math.hypot(p.bx - p.ax, p.bz - p.az), yA, yB });
    out.push(p);
  }
  return out;
}

/** Floor height (m) of a passage at distance s from its entry. */
function floorAt(sp: SolidPassage, s: number): number {
  const f = Math.max(0, Math.min(1, s / (sp.len || 1)));
  return sp.yA + (sp.yB - sp.yA) * f;
}

/** The openings the solid's passages cut into wall edge `edge` of ring `ring` (0 outer, 1.. holes). */
export function portalsOn(s: Solid, ring: number, edge: number): Portal[] {
  const out: Portal[] = [];
  for (const sp of s.passages ?? []) {
    const prof = passageProfile(sp.p, sp.arch);
    for (const w of sp.walls) {
      if (w.ring !== ring || w.edge !== edge) {
        continue;
      }
      const po = portalOnWall(sp.p, prof, w);
      const arc: [number, number][] = [];
      for (let k = prof.arc0; k <= prof.arc1; k++) {
        arc.push([po.t[k], floorAt(sp, wallHit(sp.p, prof.o[k], w)) + prof.h[k]]);
      }
      out.push({ t0: po.t0, t1: po.t1, arc, crownY: Math.max(...arc.map((q) => q[1])) });
    }
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

/**
 * The wall of an edge [0, len] x [bottom, top] with its portals left open: full-height pieces between the openings
 * and, over each opening, one piece per arch segment from the arch up to the top.
 */
export function wallPieces(len: number, bottom: number, top: number, portals: readonly Portal[]): WallPiece[] {
  const out: WallPiece[] = [];
  let t = 0;
  for (const po of portals) {
    if (po.t0 > t) {
      out.push({ t0: t, t1: po.t0, b0: bottom, b1: bottom, top0: top, top1: top });
    }
    out.push(...spandrels(po, top));
    t = Math.max(t, po.t1);
  }
  if (t < len) {
    out.push({ t0: t, t1: len, b0: bottom, b1: bottom, top0: top, top1: top });
  }
  return out;
}

/** The wall pieces over a portal's arch, up to `top`. */
export function spandrels(po: Portal, top: number): WallPiece[] {
  const out: WallPiece[] = [];
  for (let k = 1; k < po.arc.length; k++) {
    const [ta, ya] = po.arc[k - 1];
    const [tb, yb] = po.arc[k];
    if (Math.abs(tb - ta) < 1e-4) {
      continue;
    }
    const [t0, b0, t1, b1] = ta < tb ? [ta, ya, tb, yb] : [tb, yb, ta, ya];
    out.push({ t0, t1, b0, b1, top0: top, top1: top });
  }
  return out;
}

/** Emits a wall piece of the edge starting at (ax, az) along (ux, uz), outward normal `n`. */
export function emitPiece(mesh: TileMesh, m: MaterialName, ax: number, az: number, ux: number, uz: number, n: Vec3, q: WallPiece): void {
  mesh.wall(m, ax + ux * q.t0, az + uz * q.t0, ax + ux * q.t1, az + uz * q.t1, q.b0, q.top0, q.b1, q.top1, n);
}

/**
 * The lining of the solid's passages: side walls and barrel vault (`wall`), facing into the passage, and the paved
 * floor (`floor`), each running from the entry wall's plane to the exit wall's.
 */
export function emitLining(mesh: TileMesh, s: Solid, wall: MaterialName, floor: MaterialName, opts?: EmitOptions): void {
  for (const sp of s.passages ?? []) {
    const { p } = sp;
    const prof = passageProfile(p, sp.arch);
    const [wa, wb] = sp.walls;
    const pt = (k: number, end: 0 | 1): Vec3 => {
      const s0 = wallHit(p, prof.o[k], end === 0 ? wa : wb);
      const [x, z] = passagePoint(p, prof.o[k], s0);
      return [x, floorAt(sp, s0) + prof.h[k], z];
    };
    // Shading normals follow the vault's curve (smooth); UVs run along the passage and round the profile (metres).
    const nrm = (k: number): Vec3 => [-p.dz * prof.nl[k], prof.nh[k], p.dx * prof.nl[k]];
    const round: number[] = [0];
    for (let k = 1; k < prof.o.length; k++) {
      round.push(round[k - 1] + Math.hypot(prof.o[k] - prof.o[k - 1], prof.h[k] - prof.h[k - 1]));
    }
    const along = (q: Vec3): number => (q[0] - p.ax) * p.dx + (q[2] - p.az) * p.dz;
    for (let k = 1; k < prof.o.length; k++) {
      // Face normal of the strip between profile points k-1 and k (into the passage): winding and texture frame.
      const nl = (prof.nl[k - 1] + prof.nl[k]) / 2;
      const nh = (prof.nh[k - 1] + prof.nh[k]) / 2;
      const l = Math.hypot(nl, nh) || 1;
      const n: Vec3 = [(-p.dz * nl) / l, nh / l, (p.dx * nl) / l];
      const a0 = pt(k - 1, 0);
      const a1 = pt(k, 0);
      const b0 = pt(k - 1, 1);
      const b1 = pt(k, 1);
      const tri = (q: [Vec3, number][]): void =>
        mesh.flatPolygon(wall, q.map((v) => v[0]), n, { ...opts, normals: q.map((v) => nrm(v[1])), uvm: q.map((v): [number, number] => [along(v[0]), round[v[1]]]) });
      tri([[a0, k - 1], [a1, k], [b1, k]]);
      tri([[a0, k - 1], [b1, k], [b0, k - 1]]);
    }
    const last = prof.o.length - 1;
    const f = (k: number, end: 0 | 1): Vec3 => {
      const q = end === 0 ? pt(k, 0) : pt(k, 1);
      return [q[0], q[1] + 0.01, q[2]];
    };
    mesh.flatPolygon(floor, [f(0, 0), f(last, 0), f(last, 1), f(0, 1)], [0, 1, 0]);
  }
}
