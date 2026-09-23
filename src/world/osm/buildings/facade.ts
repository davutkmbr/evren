/**
 * Facade planes (worker side). A plane is one flat wall rectangle with a window layout: outer walls, courtyard walls,
 * cumba and çıkma faces. emitPlane() writes the quad with the per-wall shader state (archetypes.ts encoding) and,
 * for windowed planes, the near-LOD detail instances of every opening, so geometry and shader agree bay by bay.
 */
import * as THREE from 'three';
import { hash } from '../shared/geometry';
import { Arch, ARCHETYPES, archRise, Balcony, balconyAt, Flag, groundRow, Head, Kind, nobileHalf, styleCode, topWindowRow } from './archetypes';
import type { DetailSink } from './details';
import { F, type StateMesh } from './mesh';
import { signDepth } from './signs';
import type { BuildingPlan } from './plan';

export interface Plane {
  /** u = 0 end of the wall. */
  ax: number;
  az: number;
  /** Unit tangent (direction of increasing u) = cross(normal, up). */
  tx: number;
  tz: number;
  /** Unit outward normal. */
  nx: number;
  nz: number;
  len: number;
  yBot: number;
  yTop: number;
  /** v origin (lowest footprint ground). */
  gMin: number;
  /** Local ground above gMin at u = 0 and u = len. */
  g0: number;
  g1: number;
  /** v of the building's wall top (window heads stay `top` below it). */
  wallTopV: number;
  kind: number;
  /** Flag bits without the kind. */
  flags: number;
  nb: number;
  halfW: number;
  sill: number;
  head: number;
  /** Clearance between the top window head and the wall top (BuildingPlan.clearance). */
  top: number;
  balcony: Balcony;
  /** Detail-free range [u0, u1] from v >= v0 (hidden behind a cumba / çıkma). */
  skip?: [number, number, number];
}

/** Plane from two points; the tangent follows cross(n, up), u starts at whichever end has the smaller u. */
export function planeFrom(x0: number, z0: number, x1: number, z1: number, nx: number, nz: number): Pick<Plane, 'ax' | 'az' | 'tx' | 'tz' | 'nx' | 'nz' | 'len'> {
  const tx = -nz;
  const tz = nx;
  const d = (x1 - x0) * tx + (z1 - z0) * tz;
  const len = Math.abs(d);
  return d >= 0 ? { ax: x0, az: z0, tx, tz, nx, nz, len } : { ax: x1, az: z1, tx, tz, nx, nz, len };
}

/** Window layout for a plane of length `len` (bays, half width, sill, head) from the plan's archetype. */
export function layoutFor(plan: BuildingPlan, len: number, court: boolean): Pick<Plane, 'nb' | 'halfW' | 'sill' | 'head' | 'top'> {
  const def = ARCHETYPES[plan.arch];
  const bayW = def.bayW * (0.92 + 0.16 * hash(plan.seed * 31.7)) * (court ? 1.25 : 1);
  const nb = Math.max(1, Math.floor(len / bayW + 0.3));
  const bw = len / nb;
  let halfW = plan.arch === Arch.Modern ? Math.max(0.5, bw / 2 - 0.32 - 0.25 * hash(plan.seed * 7.1)) : Math.min(def.halfW, bw / 2 - 0.32);
  if (court) {
    halfW *= 0.7;
  }
  halfW = Math.max(0.28, halfW);
  return { nb, halfW, sill: def.sill, head: Math.min(def.head, plan.floorH - 0.35), top: plan.clearance };
}

const SHUTTER_COLOURS = [0x2f4a36, 0x3d5a45, 0x5b3a26, 0x6e6a60, 0x2d3d4c, 0x7a4b2e];
const IRON_COLOURS = [0x1b1c1c, 0x1d2621, 0x2a211b, 0x26272b];
const SIGN_COLOURS = [0xf2f2f2, 0x1b1b1b, 0x1f3a5f, 0x8e1b1b, 0xc0392b, 0xe9c46a, 0x2e7d32, 0x0e6b6b, 0x5b2c6f, 0xd35400, 0x222831, 0xf5f0e1, 0x1b1b1b, 0xf2f2f2];
const AWNING_COLOURS = [0x7a2323, 0x2c4a34, 0x6b5238, 0x2f4058, 0x9c6a3a, 0x55524d, 0x7d3a4a, 0xb9ab8f];

/** Sign word category (signs.ts) per Poi kind in front of the shop: none / shop, food, service, hotel. */
const SIGN_CATEGORY = [0, 0, 1, 2, 3];

const tmp = new THREE.Color();

function lin(hex: number): THREE.Color {
  return tmp.setHex(hex, THREE.SRGBColorSpace);
}

export interface EmitContext {
  mesh: StateMesh;
  details: DetailSink;
  plan: BuildingPlan;
  /** Poi kind in front of this plane (build.ts): 0 none, 1 shop, 2 food and drink (awnings), 3 service, 4 hotel. */
  poi: number;
  stats: Record<string, number>;
}

/** Writes the quad of `p` and, for windowed planes, its detail instances. */
export function emitPlane(c: EmitContext, p: Plane): void {
  const { mesh, plan } = c;
  const wallTop = p.wallTopV;
  mesh.set(F.Color, plan.tint.r, plan.tint.g, plan.tint.b);
  mesh.set(F.Fac, p.len, wallTop, plan.seed, plan.wear);
  mesh.set(F.Gnd, p.g0, p.g1);
  mesh.set(F.Sty, plan.floorH, styleCode(plan.arch, plan.wall, plan.plinth), p.flags + p.kind + p.balcony * Flag.BalconyShift + plan.head * Flag.HeadShift, p.top);
  mesh.set(F.Win, p.nb, p.halfW, p.sill, p.head);
  const x0 = p.ax;
  const z0 = p.az;
  const x1 = p.ax + p.tx * p.len;
  const z1 = p.az + p.tz * p.len;
  const vb = p.yBot - p.gMin;
  const vt = p.yTop - p.gMin;
  const a0 = mesh.v(x0, p.yBot, z0, p.nx, 0, p.nz, 0, vb);
  const a1 = mesh.v(x0, p.yTop, z0, p.nx, 0, p.nz, 0, vt);
  const b1 = mesh.v(x1, p.yTop, z1, p.nx, 0, p.nz, p.len, vt);
  const b0 = mesh.v(x1, p.yBot, z1, p.nx, 0, p.nz, p.len, vb);
  // Front face is counter-clockwise seen from +n.
  if ((x1 - x0) * p.nz - (z1 - z0) * p.nx > 0) {
    mesh.quad(a0, b0, b1, a1);
  } else {
    mesh.quad(a0, a1, b1, b0);
  }
  if (p.kind === Kind.Wall) {
    windowDetails(c, p);
  }
}

/** Detail instances of one windowed plane (mirrors the facade shader's layout). */
function windowDetails(c: EmitContext, p: Plane): void {
  const { details, plan } = c;
  const FH = plan.floorH;
  const nb = p.nb;
  const bw = p.len / nb;
  const yaw = Math.atan2(p.nx, p.nz);
  const topRow = topWindowRow(p.wallTopV, p.top, p.head, FH);
  const vBot = p.yBot - p.gMin;
  const vTop = p.yTop - p.gMin;
  const court = (p.flags & Flag.Court) !== 0;
  const street = (p.flags & Flag.Street) !== 0;
  const trim = plan.trim;
  const seed = plan.seed;
  const shutterCol = lin(SHUTTER_COLOURS[Math.floor(hash(seed * 5.3) * SHUTTER_COLOURS.length)]).clone();
  const ironCol = lin(IRON_COLOURS[Math.floor(hash(seed * 8.9) * IRON_COLOURS.length)]).clone();
  const isArch = plan.head === Head.Segmental || plan.head === Head.Round;
  const rise = archRise(plan.head, p.halfW);
  const balconyDepth = plan.arch === Arch.Levantine ? 0.75 + 0.2 * hash(seed * 3.1) : 1.0 + 0.3 * hash(seed * 3.1);
  const solidBalcony = plan.arch === Arch.Plain || plan.arch === Arch.Modern ? hash(seed * 4.7) < 0.4 : false;
  const nobileDone = new Set<number>();

  for (let cu = 0; cu < nb; cu++) {
    const uc = (cu + 0.5) * bw;
    const gBay = p.g0 + (p.g1 - p.g0) * (uc / p.len);
    const gRow = groundRow(gBay, FH);
    const x = p.ax + p.tx * uc;
    const z = p.az + p.tz * uc;
    const hidden = p.skip && uc > p.skip[0] - 0.2 && uc < p.skip[1] + 0.2;
    for (let r = gRow + 1; r <= topRow; r++) {
      const rowV = r * FH;
      if (rowV + p.sill < vBot - 0.01 || rowV + p.head > vTop + 0.01 || (hidden && rowV + p.head > p.skip![2])) {
        continue;
      }
      const k = r - gRow - 1;
      const hw = hash(seed * 13.1 + cu * 7.7 + r * 3.3);
      const balcony = !court && balconyAt(p.balcony, cu, nb, k, 99);
      const bottom = balcony ? 0.04 : p.sill;
      const openH = p.head - bottom;
      const y = p.gMin + rowV + bottom;
      c.stats.windows++;
      if (!court) {
        if (plan.arch === Arch.Levantine || plan.arch === Arch.Civic || plan.arch === Arch.Han || plan.arch === Arch.Mosque) {
          const kind = isArch ? 'surroundArch' : plan.head === Head.Pediment ? 'surroundPediment' : 'surroundCap';
          details.add(kind, x, y, z, yaw, p.halfW, openH, isArch ? rise : 1, trim.r, trim.g, trim.b);
        } else if (plan.arch === Arch.Wood) {
          details.add('frame', x, y, z, yaw, p.halfW, openH, 1, trim.r, trim.g, trim.b);
        } else if (!balcony && plan.arch === Arch.Plain) {
          details.add('sill', x, y, z, yaw, p.halfW, openH, 1, trim.r, trim.g, trim.b);
        }
        if (plan.shutters && !balcony && hw > 0.15) {
          details.add('shutter', x, y, z, yaw, p.halfW, openH, 1, shutterCol.r, shutterCol.g, shutterCol.b);
        }
      }
      if (balcony) {
        const fy = p.gMin + rowV;
        if (p.balcony === Balcony.Nobile) {
          if (!nobileDone.has(r)) {
            nobileDone.add(r);
            const mx = p.ax + p.tx * p.len * 0.5;
            const mz = p.az + p.tz * p.len * 0.5;
            const half = Math.min(p.len / 2 - 0.35, nobileHalf(nb) * bw - 0.15);
            details.add('balcony', mx, fy, mz, yaw, half, 0.16, balconyDepth, trim.r, trim.g, trim.b);
            details.add('railing', mx, fy, mz, yaw, half, 1.0, balconyDepth, ironCol.r, ironCol.g, ironCol.b);
            c.stats.balconies++;
          }
        } else {
          const half = plan.arch === Arch.Levantine ? p.halfW + 0.3 : Math.min(bw / 2 - 0.12, p.halfW + 0.55);
          details.add('balcony', x, fy, z, yaw, half, solidBalcony ? 0.2 : 0.15, balconyDepth, trim.r, trim.g, trim.b);
          if (solidBalcony) {
            details.add('parapet', x, fy, z, yaw, half, 1.0, balconyDepth, plan.tint.r, plan.tint.g, plan.tint.b);
          } else {
            details.add('railing', x, fy, z, yaw, half, 1.0, balconyDepth, ironCol.r, ironCol.g, ironCol.b);
          }
          c.stats.balconies++;
        }
      }
      // Air-conditioner units: mostly on back and side walls, below a window or on a balcony.
      const acRate = street ? 0.05 : 0.12;
      if (plan.arch !== Arch.Mosque && plan.arch !== Arch.Civic && hash(seed * 17.9 + cu * 3.1 + r * 5.9) < acRate) {
        const side = hw < 0.5 ? -1 : 1;
        const off = balcony ? side * (p.halfW * 0.6) : side * (p.halfW + 0.55);
        const ax = x + p.tx * off;
        const az = z + p.tz * off;
        const ay = balcony ? p.gMin + rowV + 0.2 : p.gMin + rowV + p.sill - 0.75;
        const dz = balcony ? 0.35 : 0.0;
        details.add('ac', ax + p.nx * dz, ay, az + p.nz * dz, yaw, 1, 1, 1, 0.86, 0.86, 0.84);
      }
    }
  }

  // Shop fronts: fascia signs and awnings over each shop unit (one or two bays).
  if ((p.flags & Flag.Shop) !== 0) {
    let cu = 0;
    while (cu < nb) {
      const span = nb - cu >= 2 && hash(seed * 23.3 + cu) < 0.35 ? 2 : 1;
      const uc = (cu + span / 2) * bw;
      const gBay = p.g0 + (p.g1 - p.g0) * (uc / p.len);
      const gRow = groundRow(gBay, FH);
      const line = (gRow + 1) * FH;
      const x = p.ax + p.tx * uc;
      const z = p.az + p.tz * uc;
      const hs = hash(seed * 29.7 + cu * 1.3);
      if (line > vBot + 2.4 && line < vTop + 0.1 && hs > 0.08) {
        const half = (span * bw) / 2 - 0.18;
        const sc = lin(SIGN_COLOURS[Math.floor(hash(seed * 3.7 + cu * 9.1) * SIGN_COLOURS.length)]);
        details.add('sign', x, p.gMin + line - 0.62, z, yaw, half, 0.34, signDepth(SIGN_CATEGORY[c.poi] ?? 0), sc.r, sc.g, sc.b);
        c.stats.signs++;
        const awning = c.poi === 2 ? hs < 0.62 : hs < 0.07;
        if (awning) {
          const ac = lin(AWNING_COLOURS[Math.floor(hash(seed * 6.1 + cu * 4.3) * AWNING_COLOURS.length)]);
          details.add('awning', x, p.gMin + line - 1.02, z, yaw, half, 0.75, 1.3 + 0.5 * hs, ac.r, ac.g, ac.b);
          c.stats.awnings++;
        }
      }
      cu += span;
    }
  }
}
