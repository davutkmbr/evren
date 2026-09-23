/**
 * Geometry emission for building records.
 * - emitNear: full detail (overhanging roofs with soffits, balconies, çıkma, cumba, parapets, rooftop clutter,
 *   awnings, chimneys, tower crowns).
 * - emitCompact: shared-vertex boxes + simple roofs (mid LOD) or boxes only (far LOD); facade u is derived in the
 *   shader from world position (Face.WorldU).
 */
import { Face, Kind } from '../protocol';
import { BF, BType, Roof, roofTopOf, type BuildingRec } from './building';
import type { MeshWriter, PartState } from './mesh-writer';
import { AWNINGS } from './palettes';
import { Rng } from './rng';

export interface LampSink {
  pos: number[];
  col: number[];
}

const BEACON = 0xff200c03;

/** Building-local frame helper (local +x = (cos a, sin a), local +z = (-sin a, cos a)). */
class Frame {
  x = 0;
  z = 0;
  ca = 1;
  sa = 0;
  set(b: BuildingRec): this {
    this.x = b.x;
    this.z = b.z;
    this.ca = Math.cos(b.a);
    this.sa = Math.sin(b.a);
    return this;
  }
  X(lx: number, lz: number): number {
    return this.x + lx * this.ca - lz * this.sa;
  }
  Z(lx: number, lz: number): number {
    return this.z + lx * this.sa + lz * this.ca;
  }
  /** Local direction -> world x/z. */
  dx(lx: number, lz: number): number {
    return lx * this.ca - lz * this.sa;
  }
  dz(lx: number, lz: number): number {
    return lx * this.sa + lz * this.ca;
  }
}

const F = new Frame();
const part: PartState = { rgb: 0, kind: 0, seed: 0, floorH: 3, gfH: 3, style: 0, sx: 3, flags: 0 };

function styleByte(b: BuildingRec): number {
  return (b.winType & 15) | ((b.usage & 3) << 4) | ((roofTopOf(b) & 3) << 6);
}

function floorsBits(b: BuildingRec): number {
  return Math.min(127, b.floors) << Face.FloorsShift;
}

/** Face flags for side 0 (front), 1 (-x), 2 (back), 3 (+x). */
function faceFlags(b: BuildingRec, side: number, compact: boolean): number {
  let f = floorsBits(b);
  if (b.flags & BF.Old) {
    f |= Face.Old;
  }
  if (compact) {
    f |= Face.WorldU;
  }
  if (side === 0) {
    f |= Face.RoleFront;
    if (b.flags & BF.Shop) {
      f |= Face.Shop;
    } else {
      f |= Face.Door;
    }
    if (b.flags & BF.Balcony) {
      f |= Face.BalconyDoors | Face.Balconies;
    }
  } else if (side === 2) {
    f |= b.flags & BF.Party2 ? Face.RoleParty : Face.RoleBack;
    if (b.flags & BF.BackBalcony) {
      f |= Face.BalconyDoors | Face.Balconies;
    }
  } else if (side === 1) {
    f |= b.flags & BF.Party1 ? Face.RoleParty : Face.RoleSide;
  } else {
    f |= b.flags & BF.Party3 ? Face.RoleParty : Face.RoleSide;
  }
  return f;
}

function beginPart(w: MeshWriter, b: BuildingRec, kind: number, rgb: number, flags: number, sx = b.sx): void {
  part.rgb = rgb;
  part.kind = kind;
  part.seed = b.seed;
  part.floorH = b.floorH;
  part.gfH = b.gfH;
  part.style = styleByte(b);
  part.sx = sx;
  part.flags = flags;
  w.part(part);
}

/** Wall between two local points (seen from outside: p0 left, p1 right). */
function wallL(w: MeshWriter, lx0: number, lz0: number, lx1: number, lz1: number, yb: number, yt: number, vBase: number, u0: number): void {
  w.wall(F.X(lx0, lz0), F.Z(lx0, lz0), F.X(lx1, lz1), F.Z(lx1, lz1), yb, yt, vBase, u0);
}

/** Wall between two local points, oriented so its outward normal points along the local (nx, nz). */
function wallN(w: MeshWriter, ax: number, az: number, bx: number, bz: number, yb: number, yt: number, vBase: number, u0: number, nx: number, nz: number): void {
  const dx = bx - ax;
  const dz = bz - az;
  if (-dz * nx + dx * nz >= 0) {
    wallL(w, ax, az, bx, bz, yb, yt, vBase, u0);
  } else {
    wallL(w, bx, bz, ax, az, yb, yt, vBase, u0);
  }
}

function flatL(w: MeshWriter, lxs: number[], lzs: number[], y: number, dir: 1 | -1): void {
  const xs = lxs.map((lx, i) => F.X(lx, lzs[i]));
  const zs = lxs.map((lx, i) => F.Z(lx, lzs[i]));
  w.flat(xs, zs, y, dir);
}

/** Axis-aligned (in building frame) box: walls + optional top/bottom. */
function boxL(w: MeshWriter, cx: number, cz: number, hx: number, hz: number, yb: number, yt: number, vBase: number, top: boolean, bottom: boolean, sides = 15): void {
  const x0 = cx - hx;
  const x1 = cx + hx;
  const z0 = cz - hz;
  const z1 = cz + hz;
  if (sides & 1) wallL(w, x1, z0, x0, z0, yb, yt, vBase, 0);
  if (sides & 2) wallL(w, x0, z0, x0, z1, yb, yt, vBase, 0);
  if (sides & 4) wallL(w, x0, z1, x1, z1, yb, yt, vBase, 0);
  if (sides & 8) wallL(w, x1, z1, x1, z0, yb, yt, vBase, 0);
  if (top) flatL(w, [x1, x0, x0, x1], [z0, z0, z1, z1], yt, 1);
  if (bottom) flatL(w, [x1, x0, x0, x1], [z0, z0, z1, z1], yb, -1);
}

/** Quad from four local points at explicit heights with a desired (local) normal direction. */
function quadL(
  w: MeshWriter,
  p: readonly (readonly [number, number, number])[],
  nlx: number,
  nly: number,
  nlz: number,
): void {
  w.quad(
    F.X(p[0][0], p[0][2]), p[0][1], F.Z(p[0][0], p[0][2]),
    F.X(p[1][0], p[1][2]), p[1][1], F.Z(p[1][0], p[1][2]),
    F.X(p[2][0], p[2][2]), p[2][1], F.Z(p[2][0], p[2][2]),
    F.X(p[3][0], p[3][2]), p[3][1], F.Z(p[3][0], p[3][2]),
    0, 0, 0, 0, 0, 0, 0, 0,
    F.dx(nlx, nlz), nly, F.dz(nlx, nlz),
  );
}

function triL(w: MeshWriter, p: readonly (readonly [number, number, number])[], nlx: number, nly: number, nlz: number, uv?: readonly number[]): void {
  const t = uv ?? [0, 0, 0, 0, 0, 0];
  w.triangle(
    F.X(p[0][0], p[0][2]), p[0][1], F.Z(p[0][0], p[0][2]),
    F.X(p[1][0], p[1][2]), p[1][1], F.Z(p[1][0], p[1][2]),
    F.X(p[2][0], p[2][2]), p[2][1], F.Z(p[2][0], p[2][2]),
    t[0], t[1], t[2], t[3], t[4], t[5],
    F.dx(nlx, nlz), nly, F.dz(nlx, nlz),
  );
}

/**
 * Hip roof over the local rectangle [x0,x1]x[z0,z1] at eave height ye with slope tan(pitch).
 * Returns the ridge height.
 */
function hipRoof(w: MeshWriter, x0: number, x1: number, z0: number, z1: number, ye: number, tanP: number): number {
  const cx = (x0 + x1) * 0.5;
  const cz = (z0 + z1) * 0.5;
  const hw = (x1 - x0) * 0.5;
  const hd = (z1 - z0) * 0.5;
  const H = ye + Math.min(hw, hd) * tanP;
  const e0: [number, number, number] = [x1, ye, z0];
  const e1: [number, number, number] = [x0, ye, z0];
  const e2: [number, number, number] = [x0, ye, z1];
  const e3: [number, number, number] = [x1, ye, z1];
  if (hw >= hd) {
    const ra: [number, number, number] = [cx - (hw - hd), H, cz];
    const rb: [number, number, number] = [cx + (hw - hd), H, cz];
    quadL(w, [e0, e1, ra, rb], 0, 1, -1);
    triL(w, [e1, e2, ra], -1, 1, 0);
    quadL(w, [e2, e3, rb, ra], 0, 1, 1);
    triL(w, [e3, e0, rb], 1, 1, 0);
  } else {
    const ra: [number, number, number] = [cx, H, cz - (hd - hw)];
    const rb: [number, number, number] = [cx, H, cz + (hd - hw)];
    triL(w, [e0, e1, ra], 0, 1, -1);
    quadL(w, [e1, e2, rb, ra], -1, 1, 0);
    triL(w, [e2, e3, rb], 0, 1, 1);
    quadL(w, [e3, e0, ra, rb], 1, 1, 0);
  }
  return H;
}

/** Gable roof with the ridge along local x. Gable wall triangles are emitted by the caller. */
function gableRoof(w: MeshWriter, x0: number, x1: number, z0: number, z1: number, ye: number, tanP: number): number {
  const cz = (z0 + z1) * 0.5;
  const hd = (z1 - z0) * 0.5;
  const H = ye + hd * tanP;
  quadL(w, [[x1, ye, z0], [x0, ye, z0], [x0, H, cz], [x1, H, cz]], 0, 1, -1);
  quadL(w, [[x0, ye, z1], [x1, ye, z1], [x1, H, cz], [x0, H, cz]], 0, 1, 1);
  return H;
}

/** Height of a hip roof surface at a local point (for chimneys / solar panels). */
function hipHeightAt(lx: number, lz: number, x0: number, x1: number, z0: number, z1: number, ye: number, tanP: number): number {
  const dxe = Math.min(lx - x0, x1 - lx);
  const dze = Math.min(lz - z0, z1 - lz);
  return ye + Math.max(0, Math.min(dxe, dze)) * tanP;
}

/** Soffit (roof underside) between the wall-top loop and the eave loop. */
function soffit(w: MeshWriter, wx0: number, wx1: number, wz0: number, wz1: number, yw: number, ex0: number, ex1: number, ez0: number, ez1: number, ye: number): void {
  quadL(w, [[wx1, yw, wz0], [wx0, yw, wz0], [ex0, ye, ez0], [ex1, ye, ez0]], 0, -1, 0.3);
  quadL(w, [[wx0, yw, wz0], [wx0, yw, wz1], [ex0, ye, ez1], [ex0, ye, ez0]], 0.3, -1, 0);
  quadL(w, [[wx0, yw, wz1], [wx1, yw, wz1], [ex1, ye, ez1], [ex0, ye, ez1]], 0, -1, -0.3);
  quadL(w, [[wx1, yw, wz1], [wx1, yw, wz0], [ex1, ye, ez0], [ex1, ye, ez1]], -0.3, -1, 0);
}

function lamp(sink: LampSink, lx: number, y: number, lz: number, col: number): void {
  sink.pos.push(F.X(lx, lz), y, F.Z(lx, lz));
  sink.col.push(col);
}

/* ------------------------------------------------------------------ */
/* Near (full detail)                                                  */
/* ------------------------------------------------------------------ */

export function emitNear(b: BuildingRec, w: MeshWriter, sink: LampSink): void {
  F.set(b);
  const rng = new Rng(b.rnd);
  if (b.type === BType.Tower) {
    emitTower(b, w, sink, rng, false);
    return;
  }
  if (b.type === BType.Industrial) {
    emitIndustrial(b, w, rng, false);
    return;
  }
  const hw = b.w * 0.5;
  const hd = b.d * 0.5;
  const g = b.groundY;
  const top = g + b.height;
  const yb = b.baseY;
  const gfTop = g + b.gfH;
  const cikma = (b.flags & BF.Cikma) !== 0 && b.floors >= 3 ? rng.range(0.9, 1.3) : 0;
  const parapet = b.roof === Roof.Flat && (b.flags & BF.Parapet) !== 0 ? rng.range(0.8, 1.1) : 0;
  const wallTop = top + parapet;
  const wallRgb = b.wallColor;
  const zf = -hd - cikma;

  // Walls.
  beginPart(w, b, b.wallKind, wallRgb, faceFlags(b, 0, false));
  if (cikma > 0) {
    wallL(w, hw, -hd, -hw, -hd, yb, gfTop, g, 0);
    wallL(w, hw, zf, -hw, zf, gfTop, wallTop, g, 0);
  } else {
    wallL(w, hw, -hd, -hw, -hd, yb, wallTop, g, 0);
  }
  w.setFace(b.sx, faceFlags(b, 1, false));
  if (cikma > 0) {
    wallL(w, -hw, -hd, -hw, hd, yb, gfTop, g, cikma);
    wallL(w, -hw, zf, -hw, hd, gfTop, wallTop, g, 0);
  } else {
    wallL(w, -hw, -hd, -hw, hd, yb, wallTop, g, 0);
  }
  w.setFace(b.sx, faceFlags(b, 2, false));
  wallL(w, -hw, hd, hw, hd, yb, wallTop, g, 0);
  w.setFace(b.sx, faceFlags(b, 3, false));
  if (cikma > 0) {
    wallL(w, hw, hd, hw, -hd, yb, gfTop, g, 0);
    wallL(w, hw, hd, hw, zf, gfTop, wallTop, g, 0);
    w.setKind(Kind.Slab);
    w.setFace(0, 0);
    flatL(w, [hw, -hw, -hw, hw], [zf, zf, -hd, -hd], gfTop, -1);
  } else {
    wallL(w, hw, hd, hw, -hd, yb, wallTop, g, 0);
  }

  if (b.type === BType.Mass && b.flags & BF.Accent) {
    w.detail = true;
    beginPart(w, b, Kind.Wall, b.accentColor, floorsBits(b), 0);
    const n = b.w > 34 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const x = n === 1 ? rng.range(-hw * 0.3, hw * 0.3) : (k === 0 ? -1 : 1) * hw * rng.range(0.35, 0.55);
      boxL(w, x, zf - 0.12, 0.7, 0.12, g + b.gfH, top, g, false, false, 1 | 2 | 8);
      boxL(w, x, hd + 0.12, 0.7, 0.12, g + b.gfH, top, g, false, false, 2 | 4 | 8);
    }
    w.detail = false;
  }

  // Cumba (bay windows) on the upper floors of the front.
  let cumbaDepth = 0;
  if (b.flags & BF.Cumba && b.floors >= 2 && cikma === 0) {
    cumbaDepth = b.type === BType.Yali ? rng.range(1.0, 1.4) : rng.range(0.7, 0.95);
    const count = b.w > 13 && b.type !== BType.Yali ? 2 : 1;
    const cw = count === 1 ? Math.min(b.w * (b.type === BType.Yali ? 0.42 : 0.5), 7.5) : Math.min(b.w * 0.3, 4.2);
    beginPart(w, b, b.wallKind, wallRgb, faceFlags(b, 0, false) & ~(Face.Shop | Face.Door), b.sx * 0.72);
    for (let k = 0; k < count; k++) {
      const cx = count === 1 ? 0 : (k === 0 ? -1 : 1) * (hw - cw * 0.5 - rng.range(0.6, 1.2));
      const yb2 = gfTop - 0.25;
      const x0 = cx - cw * 0.5;
      const x1 = cx + cw * 0.5;
      const z0 = -hd - cumbaDepth;
      wallL(w, x1, z0, x0, z0, yb2, top, g, 0);
      wallN(w, x0, -hd, x0, z0, yb2, top, g, 0, -1, 0);
      wallN(w, x1, z0, x1, -hd, yb2, top, g, 0, 1, 0);
      w.setKind(Kind.Soffit);
      flatL(w, [x1, x0, x0, x1], [z0, z0, -hd, -hd], yb2, -1);
      w.setKind(b.wallKind);
    }
  }

  // Balconies.
  if (b.flags & (BF.Balcony | BF.BackBalcony) && b.floors >= 2 && b.type !== BType.Mass) {
    emitBalconies(b, w, rng, zf, hd, cikma);
  }

  // Shop awnings.
  if (b.flags & BF.Awning) {
    w.detail = true;
    beginPart(w, b, Kind.Awning, rng.weighted(AWNINGS), 0, 0);
    const y0 = gfTop - 0.4;
    const out = rng.range(1.1, 1.5);
    const drop = rng.range(0.45, 0.7);
    const ax0 = -hw + 0.5;
    const ax1 = hw - 0.5;
    quadL(w, [[ax1, y0, -hd], [ax0, y0, -hd], [ax0, y0 - drop, -hd - out], [ax1, y0 - drop, -hd - out]], 0, 1, -0.5);
    quadL(w, [[ax0, y0 - 0.02, -hd], [ax1, y0 - 0.02, -hd], [ax1, y0 - drop - 0.02, -hd - out], [ax0, y0 - drop - 0.02, -hd - out]], 0, -1, 0.3);
    w.detail = false;
  }

  // Roof.
  const o = b.overhang;
  const tanP = Math.tan(b.pitch);
  const fz0 = zf - cumbaDepth;
  if (b.roof === Roof.Hip || b.roof === Roof.Gable) {
    const ye = top - o * tanP;
    const ex0 = -hw - o;
    const ex1 = hw + o;
    const ez0 = fz0 - o;
    const ez1 = hd + o;
    beginPart(w, b, Kind.RoofTile, b.roofColor, floorsBits(b), 0);
    let ridge: number;
    if (b.roof === Roof.Hip) {
      ridge = hipRoof(w, ex0, ex1, ez0, ez1, ye, tanP);
    } else if (b.w >= b.d) {
      ridge = gableRoof(w, ex0, ex1, ez0, ez1, ye, tanP);
      beginPart(w, b, b.wallKind, wallRgb, floorsBits(b), 0);
      const apex = top + ((hd - fz0) * 0.5) * tanP;
      const czm = (fz0 + hd) * 0.5;
      triL(w, [[-hw, top, fz0], [-hw, top, hd], [-hw, apex, czm]], -1, 0, 0);
      triL(w, [[hw, top, hd], [hw, top, fz0], [hw, apex, czm]], 1, 0, 0);
    } else {
      ridge = hipRoof(w, ex0, ex1, ez0, ez1, ye, tanP);
    }
    beginPart(w, b, Kind.Soffit, 0xe8e2d4, 0, 0);
    soffit(w, -hw, hw, fz0, hd, top, ex0, ex1, ez0, ez1, ye);
    w.detail = true;
    if (b.flags & BF.Chimney) {
      beginPart(w, b, Kind.Chimney, rng.chance(0.5) ? 0xb8b0a2 : 0x9a5a44, 0, 0);
      const n = rng.int(1, b.type === BType.HistoricHouse || b.type === BType.Yali ? 3 : 2);
      for (let k = 0; k < n; k++) {
        const lx = rng.range(-hw * 0.6, hw * 0.6);
        const lz = rng.range(fz0 * 0.5, hd * 0.5);
        const hs = hipHeightAt(lx, lz, ex0, ex1, ez0, ez1, ye, tanP);
        boxL(w, lx, lz, 0.28, 0.36, hs - 0.6, Math.min(hs + rng.range(0.9, 1.5), ridge + 1.2), g, true, false);
      }
    }
    if (b.flags & BF.Solar) {
      emitSolar(w, b, rng, 0, (fz0 + hd) * 0.5 + (hd - fz0) * 0.2, hipHeightAt(0, (fz0 + hd) * 0.5 + (hd - fz0) * 0.2, ex0, ex1, ez0, ez1, ye, tanP) + 0.1);
    }
    w.detail = false;
  } else {
    emitFlatRoof(b, w, rng, -hw, hw, zf, hd, top, parapet);
  }
}

function emitBalconies(b: BuildingRec, w: MeshWriter, rng: Rng, zf: number, hd: number, cikma: number): void {
  const hw = b.w * 0.5;
  const g = b.groundY;
  const glazed = (b.flags & BF.BalconyGlazed) !== 0;
  const depth = rng.range(1.05, 1.4);
  const pattern = rng.next();
  const spans: [number, number][] = [];
  if (pattern < 0.45 || b.w < 9) {
    spans.push([-hw + 0.35, hw - 0.35]);
  } else if (pattern < 0.8) {
    const bw = Math.min(hw * 0.8, rng.range(3.2, 4.6));
    spans.push([-hw + 0.5, -hw + 0.5 + bw], [hw - 0.5 - bw, hw - 0.5]);
  } else {
    const bw = Math.min(b.w - 1, rng.range(3.6, 5.5));
    spans.push([-bw * 0.5, bw * 0.5]);
  }
  const railRgb = rng.chance(0.55) ? b.wallColor : rng.chance(0.5) ? 0x3a3b3c : 0xeeeeea;
  const faces: [number, number][] = [];
  if (b.flags & BF.Balcony) {
    faces.push([0, zf]);
  }
  if (b.flags & BF.BackBalcony) {
    faces.push([2, hd]);
  }
  void cikma;
  for (const [side, zPlane] of faces) {
    const s = side === 0 ? -1 : 1;
    for (let f = 1; f < b.floors; f++) {
      const yf = g + b.gfH + (f - 1) * b.floorH;
      const ys = yf - 0.17;
      const zo = zPlane + s * depth;
      for (const [x0, x1] of spans) {
        // Slab underside + deck.
        beginPart(w, b, Kind.Slab, 0xd9d4ca, 0, 0);
        flatL(w, [x1, x0, x0, x1], [zPlane, zPlane, zo, zo], ys, -1);
        if (glazed) {
          beginPart(w, b, Kind.Glazed, 0xf2f2ee, floorsBits(b), 0.9);
          const yt = yf + b.floorH - 0.17;
          const uLen = x1 - x0;
          wallN(w, x0, zo, x1, zo, ys, yt, yf, 0, 0, s);
          wallN(w, x0, zPlane, x0, zo, ys, yt, yf, uLen, -1, 0);
          wallN(w, x1, zPlane, x1, zo, ys, yt, yf, uLen, 1, 0);
          if (f === b.floors - 1) {
            beginPart(w, b, Kind.Slab, 0xd9d4ca, 0, 0);
            flatL(w, [x1, x0, x0, x1], [zPlane, zPlane, zo, zo], yt, 1);
          }
        } else {
          flatL(w, [x1, x0, x0, x1], [zPlane, zPlane, zo, zo], yf, 1);
          w.detail = true;
          beginPart(w, b, Kind.Railing, railRgb, 0, 0);
          const yr = yf + 1.02;
          wallN(w, x0, zo, x1, zo, ys, yr, ys, 0, 0, s);
          wallN(w, x0, zPlane, x0, zo, ys, yr, ys, 0, -1, 0);
          wallN(w, x1, zPlane, x1, zo, ys, yr, ys, 0, 1, 0);
          wallN(w, x0, zo - s * 0.06, x1, zo - s * 0.06, yf, yr, ys, 0, 0, -s);
          w.detail = false;
        }
      }
    }
  }
}

function emitSolar(w: MeshWriter, b: BuildingRec, rng: Rng, lx: number, lz: number, y: number): void {
  // Flat-plate collector + horizontal tank, tilted ~40° facing south (+z world) regardless of the building.
  const cx = F.X(lx, lz);
  const cz = F.Z(lx, lz);
  const tilt = 0.68;
  const cs = Math.cos(tilt);
  const sn = Math.sin(tilt);
  const hw = 1.0;
  const hl = 0.55;
  // Slope axis goes up toward north (-z).
  const sy = sn * hl;
  const sz = -cs * hl;
  const yb = y + 0.35;
  part.rgb = 0x1c2a3a;
  part.kind = Kind.Solar;
  part.seed = b.seed;
  part.floorH = b.floorH;
  part.gfH = b.gfH;
  part.style = 0;
  part.sx = 0;
  part.flags = 0;
  w.part(part);
  const nY = cs;
  const nZ = sn;
  w.quad(cx + hw, yb - sy, cz - sz, cx - hw, yb - sy, cz - sz, cx - hw, yb + sy, cz + sz, cx + hw, yb + sy, cz + sz, 0, 0, 0, 0, 0, 0, 0, 0, 0, nY, nZ);
  w.setKind(Kind.Metal, 0xc8c8c4);
  w.quad(cx - hw, yb - sy - 0.05, cz - sz, cx + hw, yb - sy - 0.05, cz - sz, cx + hw, yb + sy - 0.05, cz + sz, cx - hw, yb + sy - 0.05, cz + sz, 0, 0, 0, 0, 0, 0, 0, 0, 0, -nY, -nZ);
  // Tank along the top edge.
  const ty = yb + sy + 0.2;
  const tz = cz + sz - 0.05;
  const r = 0.22;
  w.quad(cx + hw, ty + r, tz - r, cx - hw, ty + r, tz - r, cx - hw, ty + r, tz + r, cx + hw, ty + r, tz + r, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0);
  w.quad(cx - hw, ty - r, tz + r, cx + hw, ty - r, tz + r, cx + hw, ty + r, tz + r, cx - hw, ty + r, tz + r, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1);
  w.quad(cx + hw, ty - r, tz - r, cx - hw, ty - r, tz - r, cx - hw, ty + r, tz - r, cx + hw, ty + r, tz - r, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1);
  void rng;
}

function emitFlatRoof(b: BuildingRec, w: MeshWriter, rng: Rng, x0: number, x1: number, z0: number, z1: number, top: number, parapet: number): void {
  const g = b.groundY;
  const t = 0.25;
  if (parapet > 0) {
    beginPart(w, b, Kind.Slab, b.wallColor, 0, 0);
    const pt = top + parapet;
    // Inner parapet faces (facing inward) and the rim.
    wallL(w, x0 + t, z0 + t, x1 - t, z0 + t, top, pt, top, 0);
    wallL(w, x1 - t, z0 + t, x1 - t, z1 - t, top, pt, top, 0);
    wallL(w, x1 - t, z1 - t, x0 + t, z1 - t, top, pt, top, 0);
    wallL(w, x0 + t, z1 - t, x0 + t, z0 + t, top, pt, top, 0);
    w.setKind(Kind.Slab, 0xd8d3c8);
    flatL(w, [x1, x0, x0 + t, x1 - t], [z0, z0, z0 + t, z0 + t], pt, 1);
    flatL(w, [x0, x0, x0 + t, x0 + t], [z0, z1, z1 - t, z0 + t], pt, 1);
    flatL(w, [x0, x1, x1 - t, x0 + t], [z1, z1, z1 - t, z1 - t], pt, 1);
    flatL(w, [x1, x1, x1 - t, x1 - t], [z1, z0, z0 + t, z1 - t], pt, 1);
  }
  beginPart(w, b, Kind.RoofFlat, b.roofColor, 0, 0);
  const i = parapet > 0 ? t : 0;
  flatL(w, [x1 - i, x0 + i, x0 + i, x1 - i], [z0 + i, z0 + i, z1 - i, z1 - i], top, 1);

  const iw = x1 - x0 - 2 * i;
  const id = z1 - z0 - 2 * i;
  if (iw < 5 || id < 5) {
    return;
  }
  // Stair / lift housing or penthouse.
  if (b.flags & BF.Penthouse && iw > 10 && id > 9) {
    const pw = iw * rng.range(0.45, 0.7);
    const pd = id * rng.range(0.4, 0.55);
    const pcx = rng.range(x0 + i + pw * 0.5, x1 - i - pw * 0.5);
    const pcz = z1 - i - pd * 0.5 - rng.range(0, 1.5);
    const saved = { gf: b.gfH };
    beginPart(w, b, b.wallKind, b.wallColor, (1 << Face.FloorsShift) | Face.RoleBack, b.sx);
    boxL(w, pcx, pcz, pw * 0.5, pd * 0.5, top, top + 2.9, top, false, false);
    beginPart(w, b, Kind.RoofFlat, b.roofColor, 0, 0);
    boxL(w, pcx, pcz, pw * 0.5 + 0.15, pd * 0.5 + 0.15, top + 2.9, top + 3.05, top, true, false);
    void saved;
  } else if (b.type !== BType.House && rng.chance(0.75)) {
    beginPart(w, b, Kind.Wall, b.wallColor, 0, 0);
    const sw = rng.range(2.4, 3.2);
    const sd = rng.range(2.8, 4.2);
    const scx = rng.range(x0 + i + sw, x1 - i - sw);
    const scz = rng.range(z0 + i + sd, z1 - i - sd);
    boxL(w, scx, scz, sw * 0.5, sd * 0.5, top, top + rng.range(2.4, 3.0), top, true, false);
  }
  w.detail = true;
  if (b.flags & BF.Tanks) {
    beginPart(w, b, Kind.Metal, rng.chance(0.7) ? 0xdedcd6 : 0x8a8f94, 0, 0);
    const n = rng.int(1, iw * id > 250 ? 4 : 2);
    for (let k = 0; k < n; k++) {
      const tw = rng.range(0.55, 0.8);
      const td = rng.range(0.45, 0.6);
      const tx = rng.range(x0 + i + 1.2, x1 - i - 1.2);
      const tz = rng.range(z0 + i + 1.2, z1 - i - 1.2);
      boxL(w, tx, tz, tw, td, top + 0.35, top + 0.35 + rng.range(0.9, 1.3), top, true, false);
    }
  }
  if (b.flags & BF.Solar) {
    const n = rng.int(1, 3);
    for (let k = 0; k < n; k++) {
      emitSolar(w, b, rng, rng.range(x0 + i + 1.5, x1 - i - 1.5), rng.range(z0 + i + 1.5, z1 - i - 1.5), top);
    }
  }
  // Antennas / masts.
  if (rng.chance(0.45)) {
    beginPart(w, b, Kind.Dark, 0x3a3a3a, 0, 0);
    const ax = rng.range(x0 + i + 0.5, x1 - i - 0.5);
    const az = rng.range(z0 + i + 0.5, z1 - i - 0.5);
    boxL(w, ax, az, 0.05, 0.05, top, top + rng.range(2.5, 4.5), g, true, false);
  }
  w.detail = false;
}

function emitTower(b: BuildingRec, w: MeshWriter, sink: LampSink, rng: Rng, compact: boolean): void {
  const g = b.groundY;
  const hw = b.w * 0.5;
  const hd = b.d * 0.5;
  const top = g + b.height;
  const segs: [number, number, number][] = [];
  if (b.flags & BF.Setback) {
    const h1 = g + b.height * rng.range(0.55, 0.7);
    const h2 = g + b.height * rng.range(0.8, 0.9);
    const s1 = rng.range(0.78, 0.88);
    const s2 = s1 * rng.range(0.72, 0.85);
    segs.push([b.baseY, h1, 1], [h1, h2, s1], [h2, top, s2]);
  } else {
    segs.push([b.baseY, top, 1]);
  }
  for (let k = 0; k < segs.length; k++) {
    const [y0, y1, s] = segs[k];
    const sw = hw * s;
    const sd = hd * s;
    const fl = faceFlags(b, 0, compact);
    beginPart(w, b, Kind.Curtain, b.wallColor, fl);
    if (compact) {
      compactBox(w, b, -sw, sw, -sd, sd, y0, y1, fl);
    } else {
      boxL(w, 0, 0, sw, sd, y0, y1, g, false, false);
    }
    beginPart(w, b, Kind.RoofFlat, 0x8e8e8a, 0, 0);
    if (!compact) {
      flatL(w, [sw, -sw, -sw, sw], [-sd, -sd, sd, sd], y1, 1);
    }
  }
  const s = segs[segs.length - 1][2];
  const cw = hw * s * 0.72;
  const cd = hd * s * 0.72;
  const crownTop = top + rng.range(3.5, 6);
  beginPart(w, b, Kind.Dark, 0x4a4d50, floorsBits(b), 0);
  if (compact) {
    compactBox(w, b, -cw, cw, -cd, cd, top, crownTop, floorsBits(b));
  } else {
    boxL(w, 0, 0, cw, cd, top, crownTop, g, true, false);
  }
  let peak = crownTop;
  if (rng.chance(0.35)) {
    w.detail = !compact;
    beginPart(w, b, Kind.Metal, 0xb8bcc0, 0, 0);
    const spire = rng.range(10, 30);
    if (compact) {
      compactBox(w, b, -0.5, 0.5, -0.5, 0.5, crownTop, crownTop + spire, 0);
    } else {
      boxL(w, 0, 0, 0.45, 0.45, crownTop, crownTop + spire, g, true, false);
    }
    peak = crownTop + spire;
    lamp(sink, 0, peak + 0.5, 0, BEACON);
    w.detail = false;
  }
  lamp(sink, cw, crownTop + 0.4, cd, BEACON);
  lamp(sink, -cw, crownTop + 0.4, -cd, BEACON);
  if (b.height > 120) {
    lamp(sink, -cw, crownTop + 0.4, cd, BEACON);
    lamp(sink, cw, crownTop + 0.4, -cd, BEACON);
  }
}

function emitIndustrial(b: BuildingRec, w: MeshWriter, rng: Rng, compact: boolean): void {
  const hw = b.w * 0.5;
  const hd = b.d * 0.5;
  const g = b.groundY;
  const top = g + b.height;
  const fl = faceFlags(b, 0, compact);
  beginPart(w, b, Kind.Wall, b.wallColor, fl);
  if (compact) {
    compactBox(w, b, -hw, hw, -hd, hd, b.baseY, top, fl);
  } else {
    boxL(w, 0, 0, hw, hd, b.baseY, top, g, false, false);
  }
  if (b.roof === Roof.Flat) {
    if (!compact) {
      beginPart(w, b, Kind.RoofFlat, b.roofColor, 0, 0);
      flatL(w, [hw, -hw, -hw, hw], [-hd, -hd, hd, hd], top, 1);
    }
    return;
  }
  if (b.roof === Roof.Sawtooth && !compact) {
    const n = Math.max(2, Math.round(b.w / rng.range(7, 10)));
    const tw = b.w / n;
    const th = Math.min(3.2, tw * 0.45);
    for (let k = 0; k < n; k++) {
      const xa = -hw + k * tw;
      const xb = xa + tw;
      beginPart(w, b, Kind.RoofMetal, b.roofColor, 0, 0);
      quadL(w, [[xa, top, -hd], [xa, top, hd], [xb, top + th, hd], [xb, top + th, -hd]], -1, 2, 0);
      beginPart(w, b, Kind.Glazed, 0xe0e4e6, floorsBits(b), 1.2);
      wallL(w, xb, hd, xb, -hd, top, top + th, top, 0);
      beginPart(w, b, Kind.Wall, b.wallColor, 0, 0);
      triL(w, [[xa, top, -hd], [xb, top, -hd], [xb, top + th, -hd]], 0, 0, -1);
      triL(w, [[xb, top, hd], [xa, top, hd], [xb, top + th, hd]], 0, 0, 1);
    }
    return;
  }
  // Low metal gable along the long axis.
  const tanP = Math.tan(b.pitch);
  beginPart(w, b, Kind.RoofMetal, b.roofColor, 0, 0);
  if (compact) {
    compactGable(w, b, hw, hd, top, tanP);
    return;
  }
  const o = 0.3;
  if (b.w >= b.d) {
    gableRoof(w, -hw - o, hw + o, -hd - o, hd + o, top - o * tanP, tanP);
    beginPart(w, b, Kind.Wall, b.wallColor, 0, 0);
    triL(w, [[-hw, top, -hd], [-hw, top, hd], [-hw, top + hd * tanP, 0]], -1, 0, 0);
    triL(w, [[hw, top, hd], [hw, top, -hd], [hw, top + hd * tanP, 0]], 1, 0, 0);
  } else {
    hipRoof(w, -hw - o, hw + o, -hd - o, hd + o, top - o * tanP, tanP);
  }
}

/* ------------------------------------------------------------------ */
/* Compact (mid / far)                                                 */
/* ------------------------------------------------------------------ */

/** Shared-vertex box: 8 vertices, 4 walls + top (10 triangles). */
function compactBox(w: MeshWriter, b: BuildingRec, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, flags: number): void {
  w.reserve(8, 30);
  w.setFace(b.sx, flags | Face.WorldU);
  const g = b.groundY;
  const base = w.vcount;
  const cx = [x1, x0, x0, x1];
  const cz = [z0, z0, z1, z1];
  const k = 0.7071;
  for (let level = 0; level < 2; level++) {
    const y = level === 0 ? y0 : y1;
    for (let c = 0; c < 4; c++) {
      const lx = cx[c];
      const lz = cz[c];
      const sx = Math.sign(lx - (x0 + x1) * 0.5);
      const sz = Math.sign(lz - (z0 + z1) * 0.5);
      const ny = level === 0 ? 0 : 0.6;
      const nx = F.dx(sx * k, sz * k) * (level === 0 ? 1 : 0.57);
      const nz = F.dz(sx * k, sz * k) * (level === 0 ? 1 : 0.57);
      w.vertex(F.X(lx, lz), y, F.Z(lx, lz), nx, ny, nz, 0, y - g);
    }
  }
  for (let c = 0; c < 4; c++) {
    const n = (c + 1) % 4;
    w.tri(base + c, base + n, base + 4 + n);
    w.tri(base + c, base + 4 + n, base + 4 + c);
  }
  w.tri(base + 4, base + 5, base + 6);
  w.tri(base + 4, base + 6, base + 7);
}

/** Shared-vertex hip roof (6 vertices) over the footprint at wall top `y`. */
function compactHip(w: MeshWriter, b: BuildingRec, hw: number, hd: number, y: number, tanP: number): void {
  w.reserve(6, 18);
  const base = w.vcount;
  const H = y + Math.min(hw, hd) * tanP;
  const ex = [hw, -hw, -hw, hw];
  const ez = [-hd, -hd, hd, hd];
  for (let c = 0; c < 4; c++) {
    w.vertex(F.X(ex[c], ez[c]), y, F.Z(ex[c], ez[c]), F.dx(Math.sign(ex[c]) * 0.5, Math.sign(ez[c]) * 0.5), 0.7, F.dz(Math.sign(ex[c]) * 0.5, Math.sign(ez[c]) * 0.5), 0, 0);
  }
  if (hw >= hd) {
    w.vertex(F.X(-(hw - hd), 0), H, F.Z(-(hw - hd), 0), 0, 1, 0, 0, 0);
    w.vertex(F.X(hw - hd, 0), H, F.Z(hw - hd, 0), 0, 1, 0, 0, 0);
    const ra = base + 4;
    const rb = base + 5;
    w.tri(base, base + 1, ra);
    w.tri(base, ra, rb);
    w.tri(base + 1, base + 2, ra);
    w.tri(base + 2, base + 3, rb);
    w.tri(base + 2, rb, ra);
    w.tri(base + 3, base, rb);
  } else {
    w.vertex(F.X(0, -(hd - hw)), H, F.Z(0, -(hd - hw)), 0, 1, 0, 0, 0);
    w.vertex(F.X(0, hd - hw), H, F.Z(0, hd - hw), 0, 1, 0, 0, 0);
    const ra = base + 4;
    const rb = base + 5;
    w.tri(base, base + 1, ra);
    w.tri(base + 1, base + 2, rb);
    w.tri(base + 1, rb, ra);
    w.tri(base + 2, base + 3, rb);
    w.tri(base + 3, base, ra);
    w.tri(base + 3, ra, rb);
  }
  void b;
}

function compactGable(w: MeshWriter, b: BuildingRec, hw: number, hd: number, y: number, tanP: number): void {
  if (b.w < b.d) {
    compactHip(w, b, hw, hd, y, tanP);
    return;
  }
  w.reserve(6, 12);
  const base = w.vcount;
  const H = y + hd * tanP;
  const ex = [hw, -hw, -hw, hw];
  const ez = [-hd, -hd, hd, hd];
  for (let c = 0; c < 4; c++) {
    w.vertex(F.X(ex[c], ez[c]), y, F.Z(ex[c], ez[c]), 0, 0.8, F.dz(0, Math.sign(ez[c]) * 0.6), 0, 0);
  }
  w.vertex(F.X(-hw, 0), H, F.Z(-hw, 0), 0, 1, 0, 0, 0);
  w.vertex(F.X(hw, 0), H, F.Z(hw, 0), 0, 1, 0, 0, 0);
  const ra = base + 4;
  const rb = base + 5;
  w.tri(base, base + 1, ra);
  w.tri(base, ra, rb);
  w.tri(base + 2, base + 3, rb);
  w.tri(base + 2, rb, ra);
  // Gable ends (roof-coloured at distance; they are small).
  w.tri(base + 1, base + 2, ra);
  w.tri(base + 3, base, rb);
}

/**
 * Compact emission. level 1 = mid (roofs as geometry), level 2 = far (boxes; roof colour from style bits).
 */
export function emitCompact(b: BuildingRec, w: MeshWriter, level: number, sink: LampSink): void {
  F.set(b);
  const rng = new Rng(b.rnd);
  if (b.type === BType.Tower) {
    emitTower(b, w, sink, rng, true);
    return;
  }
  const hw = b.w * 0.5;
  const hd = b.d * 0.5;
  const top = b.groundY + b.height;
  const cikma = (b.flags & BF.Cikma) !== 0 && b.floors >= 3 ? 1.1 : 0;
  const fl = faceFlags(b, 0, true);
  beginPart(w, b, b.wallKind, b.wallColor, fl);
  if (b.type === BType.Industrial) {
    compactBox(w, b, -hw, hw, -hd, hd, b.baseY, top, fl);
    if (level === 1 && b.roof !== Roof.Flat) {
      beginPart(w, b, Kind.RoofMetal, b.roofColor, 0, 0);
      compactGable(w, b, hw, hd, top, b.roof === Roof.Sawtooth ? 0.25 : Math.tan(b.pitch));
    }
    return;
  }
  compactBox(w, b, -hw, hw, -hd - cikma, hd, b.baseY, top, fl);
  if (level === 1 && (b.roof === Roof.Hip || b.roof === Roof.Gable)) {
    beginPart(w, b, Kind.RoofTile, b.roofColor, 0, 0);
    const o = Math.min(b.overhang, 0.5);
    const ye = top - o * Math.tan(b.pitch);
    // Shift so the roof covers the çıkma.
    const zc = -cikma * 0.5;
    const saveZ = F.z;
    const saveX = F.x;
    const shiftedX = F.X(0, zc);
    const shiftedZ = F.Z(0, zc);
    F.x = shiftedX;
    F.z = shiftedZ;
    if (b.roof === Roof.Gable) {
      compactGable(w, b, hw + o, hd + cikma * 0.5 + o, ye, Math.tan(b.pitch));
    } else {
      compactHip(w, b, hw + o, hd + cikma * 0.5 + o, ye, Math.tan(b.pitch));
    }
    F.x = saveX;
    F.z = saveZ;
  }
}
