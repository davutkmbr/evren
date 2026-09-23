/**
 * Projecting masses of a facade (worker side): cornices and string courses along the exposed walls, and bay
 * windows: timber / stone cumbas over one or two bays and the post-war çıkma (upper floors projecting over the
 * street). Bay faces are facade planes with their own window layout, so they get windows, sills and balconies.
 */
import * as THREE from 'three';
import { Arch, Balcony, Flag, groundRow, Kind, styleCode } from './archetypes';
import { emitPlane, type EmitContext, layoutFor, type Plane, planeFrom } from './facade';
import { F, type StateMesh } from './mesh';
import { type BuildingPlan, CORNICE_PROFILES, corniceDrop } from './plan';

type V3 = [number, number, number];

export interface Edge {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  len: number;
  nx: number;
  nz: number;
  exposed: boolean;
  street: boolean;
  plane: Plane | null;
}

function setTrim(m: StateMesh, plan: BuildingPlan, topV: number, tint: THREE.Color): void {
  m.set(F.Color, tint.r, tint.g, tint.b);
  m.set(F.Fac, 1, topV, plan.seed, plan.wear);
  m.set(F.Gnd, 0, 0);
  m.set(F.Sty, plan.floorH, styleCode(plan.arch, plan.wall, plan.plinth), Kind.Trim, 0);
  m.set(F.Win, 1, 0.3, 1, 2);
}

/**
 * One horizontal moulding band [y0, y1] projecting `proj` from the exposed edges of a ring; mitred where two
 * exposed edges meet, cut square next to party walls.
 */
export function band(m: StateMesh, edges: readonly Edge[], y0: number, y1: number, proj: number, gMin: number): void {
  const n = edges.length;
  for (let i = 0; i < n; i++) {
    const e = edges[i];
    if (!e.exposed || e.len < 0.4) {
      continue;
    }
    const prev = edges[(i + n - 1) % n];
    const next = edges[(i + 1) % n];
    const corner = (ox: number, oz: number, other: Edge): [number, number] => {
      if (!other.exposed) {
        return [ox + e.nx * proj, oz + e.nz * proj];
      }
      let mx = e.nx + other.nx;
      let mz = e.nz + other.nz;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml;
      mz /= ml;
      const cosHalf = Math.max(0.5, mx * e.nx + mz * e.nz);
      return [ox + (mx * proj) / cosHalf, oz + (mz * proj) / cosHalf];
    };
    const [p0x, p0z] = corner(e.ax, e.az, prev);
    const [p1x, p1z] = corner(e.bx, e.bz, next);
    const w0b: V3 = [e.ax, y0, e.az];
    const w1b: V3 = [e.bx, y0, e.bz];
    const p0b: V3 = [p0x, y0, p0z];
    const p1b: V3 = [p1x, y0, p1z];
    const p0t: V3 = [p0x, y1, p0z];
    const p1t: V3 = [p1x, y1, p1z];
    const uvWall = (x: number, y: number, z: number): [number, number] => [(x - e.ax) * -e.nz + (z - e.az) * e.nx, y - gMin];
    m.poly([w0b, w1b, p1b, p0b], 0, -1, 0, (x, _y, z) => [x, z]);
    m.poly([p0b, p1b, p1t, p0t], e.nx, 0, e.nz, uvWall);
    m.poly([p0t, p1t, [e.bx, y1, e.bz], [e.ax, y1, e.az]], 0, 1, 0, (x, _y, z) => [x, z]);
    // Square ends against party walls.
    if (!prev.exposed) {
      m.poly([w0b, p0b, p0t, [e.ax, y1, e.az]], -e.nz, 0, e.nx, (x, y, z) => [(x - e.ax) * e.nx + (z - e.az) * e.nz, y - gMin]);
    }
    if (!next.exposed) {
      m.poly([w1b, p1b, p1t, [e.bx, y1, e.bz]], e.nz, 0, -e.nx, (x, y, z) => [(x - e.bx) * e.nx + (z - e.bz) * e.nz, y - gMin]);
    }
  }
}

/** Cornice under the eave / at the roof slab, and string courses at the upper floor lines. */
export function mouldings(c: EmitContext, edges: readonly Edge[], gMin: number, top: number, gRowV: number): void {
  const { mesh, plan } = c;
  const topV = top - gMin;
  setTrim(mesh, plan, topV, plan.trim);
  const profile = CORNICE_PROFILES[plan.cornice];
  const drop = corniceDrop(plan);
  if (profile.length) {
    const pitched = plan.roof !== 'flat' && plan.roof !== 'domes';
    const maxProj = pitched ? 0.3 : 10;
    let y = top - drop;
    for (const [h, proj] of profile) {
      band(mesh, edges, y, y + h, Math.min(proj, maxProj), gMin);
      y += h;
    }
    c.stats.cornices++;
  }
  if (plan.courses) {
    const FH = plan.floorH;
    const lastRow = Math.floor((topV - drop - 0.25) / FH);
    const firstRow = Math.max(1, Math.round(gRowV / FH) + 1);
    // Heavier shop-floor cornice on Levantine blocks, light courses above.
    for (let r = firstRow; r <= lastRow; r++) {
      const y = gMin + r * FH;
      const heavy = r === firstRow && (plan.arch === Arch.Levantine || plan.arch === Arch.Civic);
      band(mesh, edges, y - (heavy ? 0.18 : 0.06), y + (heavy ? 0.16 : 0.12), heavy ? 0.16 : 0.07, gMin);
    }
  }
}

/** Plane state shared with the parent wall, for a bay face at (x0, z0)-(x1, z1). */
function bayPlane(parent: Plane, plan: BuildingPlan, x0: number, z0: number, x1: number, z1: number, nx: number, nz: number, yBot: number, yTop: number, side: boolean): Plane {
  const geo = planeFrom(x0, z0, x1, z1, nx, nz);
  const lay = layoutFor(plan, geo.len, false);
  if (side) {
    lay.nb = 1;
    lay.halfW = Math.min(lay.halfW, geo.len / 2 - 0.16);
  }
  const windowed = geo.len >= (side ? 0.62 : 1.4) && lay.halfW > 0.14;
  const t0 = ((x0 + x1) / 2 - parent.ax) * parent.tx + ((z0 + z1) / 2 - parent.az) * parent.tz;
  const g = parent.g0 + (parent.g1 - parent.g0) * Math.min(1, Math.max(0, t0 / parent.len));
  return {
    ...geo,
    ...lay,
    yBot,
    yTop,
    gMin: parent.gMin,
    g0: g,
    g1: g,
    wallTopV: parent.wallTopV,
    kind: windowed ? Kind.Wall : Kind.Trim,
    flags: (parent.flags & ~(Flag.Shop | Flag.Court)) | Flag.Street,
    balcony: side ? Balcony.None : parent.balcony === Balcony.All || parent.balcony === Balcony.Alternate ? parent.balcony : Balcony.None,
  };
}

/**
 * Cumba / çıkma on a street wall: returns the [u0, u1] range and the bottom v it covers on the parent wall (the
 * parent's details are skipped there), or null when the wall does not fit.
 */
export function bayWindow(c: EmitContext, parent: Plane, top: number, pitched: boolean): [number, number, number] | null {
  const { plan, mesh } = c;
  const FH = plan.floorH;
  const len = parent.len;
  let u0: number;
  let u1: number;
  let depth: number;
  if (plan.bay === 'cikma') {
    if (len < 6) {
      return null;
    }
    u0 = 0.6;
    u1 = len - 0.6;
    depth = 0.95 + 0.25 * Math.abs(Math.sin(plan.seed * 91));
  } else {
    const bw = len / parent.nb;
    const span = plan.arch === Arch.Levantine ? Math.min(len - 1.4, bw + 0.5) : plan.arch === Arch.Wood ? Math.min(len - 1.2, Math.max(2.6, bw * 2)) : Math.min(len - 1.4, bw * 2);
    if (span < 2.2) {
      return null;
    }
    u0 = len / 2 - span / 2;
    u1 = len / 2 + span / 2;
    depth = plan.arch === Arch.Levantine ? 0.65 : plan.arch === Arch.Wood ? 0.8 : 0.95;
  }
  const gMid = parent.g0 + (parent.g1 - parent.g0) * 0.5;
  const gRow = Math.max(groundRow(parent.g0, FH), groundRow(parent.g1, FH), groundRow(gMid, FH));
  const y0 = parent.gMin + (gRow + 1) * FH - 0.12;
  const y1 = pitched ? top - 0.3 : top;
  if (y1 - y0 < FH * 1.2) {
    return null;
  }
  const P = (u: number, d: number): [number, number] => [parent.ax + parent.tx * u + parent.nx * d, parent.az + parent.tz * u + parent.nz * d];
  const [a0x, a0z] = P(u0, 0);
  const [b0x, b0z] = P(u1, 0);
  const [a1x, a1z] = P(u0, depth);
  const [b1x, b1z] = P(u1, depth);
  const tint = plan.tint;
  emitPlane(c, bayPlane(parent, plan, a1x, a1z, b1x, b1z, parent.nx, parent.nz, y0, y1, false));
  emitPlane(c, bayPlane(parent, plan, a0x, a0z, a1x, a1z, -parent.tx, -parent.tz, y0, y1, true));
  emitPlane(c, bayPlane(parent, plan, b1x, b1z, b0x, b0z, parent.tx, parent.tz, y0, y1, true));
  setTrim(mesh, plan, top - parent.gMin, plan.bay === 'cumba' && plan.arch === Arch.Wood ? new THREE.Color().copy(tint).multiplyScalar(0.8) : plan.trim);
  mesh.poly(
    [
      [a0x, y0, a0z],
      [b0x, y0, b0z],
      [b1x, y0, b1z],
      [a1x, y0, a1z],
    ],
    0,
    -1,
    0,
    (x, _y, z) => [x, z],
  );
  mesh.poly(
    [
      [a0x, y1, a0z],
      [b0x, y1, b0z],
      [b1x, y1, b1z],
      [a1x, y1, a1z],
    ],
    0,
    1,
    0,
    (x, _y, z) => [x, z],
  );
  // Slab edge / bracket band under the bay.
  const edges: Edge[] = [
    { ax: a1x, az: a1z, bx: b1x, bz: b1z, len: u1 - u0, nx: parent.nx, nz: parent.nz, exposed: true, street: true, plane: null },
    { ax: b1x, az: b1z, bx: b0x, bz: b0z, len: depth, nx: parent.tx, nz: parent.tz, exposed: true, street: true, plane: null },
    { ax: b0x, az: b0z, bx: a0x, bz: a0z, len: u1 - u0, nx: -parent.nx, nz: -parent.nz, exposed: false, street: false, plane: null },
    { ax: a0x, az: a0z, bx: a1x, bz: a1z, len: depth, nx: -parent.tx, nz: -parent.tz, exposed: true, street: true, plane: null },
  ];
  band(mesh, edges, y0 - 0.02, y0 + 0.2, 0.06, parent.gMin);
  if (!pitched) {
    band(mesh, edges, y1 - 0.25, y1, 0.05, parent.gMin);
  }
  c.stats[plan.bay === 'cikma' ? 'cikma' : 'cumba']++;
  return [u0, u1, y0 - parent.gMin];
}
