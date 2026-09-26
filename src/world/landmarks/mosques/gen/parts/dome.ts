import type { MeshBuilder } from '../builder';
import { Light, Mat, type LodLevel } from '../types';
import { alem, corniceProfile, polyPath } from './details';
import { rowOpenings, wallPanel, type Opening } from './wall';

export type DomeShape = 'hemi' | 'raised' | 'shallow' | 'pumpkin' | 'onion';

export interface DomeOptions {
  /** Outer radius at the springing. */
  r: number;
  /** Springing height. */
  y: number;
  /** Crown height above the springing (default: r for hemi, 1.08 r raised). */
  rise?: number;
  shape?: DomeShape;
  lod: LodLevel;
  /** Alem height (0 = none). */
  alem?: number;
  /** Angular range (semi-domes use a half range). */
  a0?: number;
  a1?: number;
  /** Lead sheet width at the base (m). */
  sheetWidth?: number;
  /** Raised ribs (Ayasofya: 40). */
  ribs?: number;
  /** Base moulding ring. */
  ring?: boolean;
  /** Profile of a pumpkin dome (segment count). */
  lobes?: number;
}

function segCount(r: number, lod: LodLevel, fraction: number): number {
  const full =
    lod === 0 ? Math.min(96, Math.max(20, Math.round(r * 5.5))) : lod === 1 ? Math.min(36, Math.max(10, Math.round(r * 1.8))) : Math.min(20, Math.max(8, Math.round(r * 0.9)));
  return Math.max(4, Math.round(full * fraction));
}

/** Lead-covered dome (or semi-dome) springing at y. */
export function leadDome(b: MeshBuilder, o: DomeOptions): void {
  const shape = o.shape ?? 'raised';
  const r = o.r;
  const rise = o.rise ?? (shape === 'hemi' ? r : shape === 'raised' ? r * 1.06 : shape === 'onion' ? r * 1.5 : r * 0.45);
  const a0 = o.a0 ?? 0;
  const a1 = o.a1 ?? Math.PI * 2;
  const frac = (a1 - a0) / (Math.PI * 2);
  const rings =
    o.lod === 0 ? Math.max(8, Math.min(22, Math.round(r * 1.1))) : o.lod === 1 ? Math.max(4, Math.min(8, Math.round(r * 0.35))) : Math.max(3, Math.min(5, Math.round(r * 0.25)));
  const prof: number[] = [];
  if (shape === 'shallow') {
    const R = (r * r + rise * rise) / (2 * rise);
    const alpha0 = Math.asin(Math.min(1, r / R));
    const yc = o.y + rise - R;
    for (let i = 0; i <= rings; i++) {
      const a = alpha0 * (1 - i / rings);
      prof.push(R * Math.sin(a), yc + R * Math.cos(a));
    }
  } else if (shape === 'onion') {
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      const bulge = Math.sin(Math.PI * Math.min(1, t * 1.25)) * 0.18;
      const rr = r * (Math.cos((t * Math.PI) / 2) + bulge * (1 - t));
      prof.push(Math.max(0, rr), o.y + rise * t);
    }
  } else {
    for (let i = 0; i <= rings; i++) {
      const phi = (i / rings) * (Math.PI / 2);
      // Slight Ottoman point: the crown is drawn in a little.
      const pinch = shape === 'raised' ? 1 - 0.05 * Math.pow(Math.sin(phi), 6) : 1;
      prof.push(r * Math.cos(phi) * pinch, o.y + rise * Math.sin(phi));
    }
  }
  const sheets = Math.max(8, Math.round((Math.PI * 2 * r) / (o.sheetWidth ?? 0.95)));
  const seg = segCount(r, o.lod, frac);
  if (frac > 0.99) {
    domeCollider(b, o.y, r, rise, shape);
  } else {
    halfDomeCollider(b, prof, a0, a1);
  }
  b.with({ mat: Mat.Lead, light: Light.Dome, lightBase: b.worldY(0, o.y, 0), ao: 1 }, () => {
    if (shape === 'pumpkin' && o.lod === 0) {
      pumpkin(b, prof, o.lobes ?? 16, seg);
    } else {
      b.lathe(prof, { seg, a0, a1, uvMode: 'sheets', sheets, crease: 50 });
    }
    if (o.ring !== false && o.lod < 2) {
      const rr = r + 0.12;
      b.lathe([rr, o.y - 0.45, rr + 0.1, o.y - 0.3, rr + 0.1, o.y - 0.12, r, o.y + 0.02], { seg, a0, a1, uvMode: 'sheets', sheets });
    }
    if (o.ribs && o.lod === 0) {
      ribs(b, prof, o.ribs, r);
    }
  });
  if (o.alem && o.alem > 0 && frac > 0.99) {
    b.at(0, o.y + rise - 0.1, 0, 0, () => alem(b, o.alem!, o.lod));
  }
}

/**
 * Collider of a dome springing at y: a sphere through the crown for hemispherical / raised / pumpkin shells, a low
 * cylinder for shallow caps (their large sphere would bulge out below the springing), a cylinder plus a sphere for
 * onion domes. Semi-domes get the full shape too: its back half lies inside the dome base they lean against.
 */
function domeCollider(b: MeshBuilder, y: number, r: number, rise: number, shape: DomeShape): void {
  if (r < 0.6) {
    return;
  }
  if (shape === 'shallow' || rise < r * 0.8) {
    // a flat cap: stacked cylinders following the spherical cap (a sphere through it would bulge out below the rim)
    const R = (r * r + rise * rise) / (2 * rise);
    const cy = y + rise - R;
    const tiers = Math.min(10, Math.max(2, Math.ceil(rise / 1.2)));
    for (let k = 0; k < tiers; k++) {
      const y0 = y + (rise * k) / tiers;
      const rr = Math.sqrt(Math.max(R * R - (y0 - cy) ** 2, 0));
      b.colCylinder(0, k === 0 ? y - 0.3 : y0, 0, Math.min(rr, r), rise / tiers + (k === 0 ? 0.3 : 0));
    }
  } else if (shape === 'onion') {
    b.colCylinder(0, y - 0.2, 0, r, rise * 0.45);
    b.colSphere(0, y + rise * 0.45, 0, Math.min(r, rise * 0.5));
  } else {
    b.colSphere(0, y + rise - r, 0, r);
  }
}

/** Footprint [x, z, ...] of a disc sector of radius r over lathe angles a0..a1 (point = (r sin a, r cos a)). */
function sector(r: number, a0: number, a1: number): number[] {
  const out = [0, 0];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push(r * Math.sin(a), r * Math.cos(a));
  }
  return out;
}

/**
 * Semi-domes and apses: stacked sector prisms following the shell profile, so nothing stands behind the open side
 * (a full sphere put a hidden bump over the roof behind an apse).
 */
function halfDomeCollider(b: MeshBuilder, prof: readonly number[], a0: number, a1: number): void {
  const y0 = prof[1];
  const y1 = prof[prof.length - 1];
  const radiusAt = (y: number): number => {
    for (let i = 0; i < prof.length - 2; i += 2) {
      const ya = prof[i + 1];
      const yb = prof[i + 3];
      if (y >= ya && y <= yb) {
        return prof[i] + ((prof[i + 2] - prof[i]) * (y - ya)) / Math.max(yb - ya, 1e-6);
      }
    }
    return prof[0];
  };
  if (prof[0] < 0.6) {
    return;
  }
  const tiers = Math.min(10, Math.max(3, Math.ceil((y1 - y0) / 1.4)));
  for (let k = 0; k < tiers; k++) {
    const ya = y0 + ((y1 - y0) * k) / tiers;
    const yb = y0 + ((y1 - y0) * (k + 1)) / tiers;
    b.colPrism(sector(radiusAt(ya), a0, a1), k === 0 ? ya - 0.3 : ya, yb);
  }
}

function pumpkin(b: MeshBuilder, prof: number[], lobes: number, seg: number): void {
  const n = Math.max(lobes * 3, seg);
  const P = prof.length / 2;
  const base = b.vCount;
  for (let i = 0; i < P; i++) {
    for (let j = 0; j <= n; j++) {
      const a = (j / n) * Math.PI * 2;
      const lobe = Math.abs(Math.sin((a * lobes) / 2));
      const k = 1 - 0.06 * (1 - lobe) * (1 - i / (P - 1));
      const r = prof[i * 2] * k;
      const y = prof[i * 2 + 1];
      const t = i / (P - 1);
      const nx = Math.sin(a) * Math.cos((t * Math.PI) / 2);
      const nz = Math.cos(a) * Math.cos((t * Math.PI) / 2);
      b.vertex(r * Math.sin(a), y, r * Math.cos(a), nx, Math.sin((t * Math.PI) / 2), nz, (j / n) * lobes * 2, y);
    }
  }
  for (let i = 0; i < P - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = base + i * (n + 1) + j;
      const c = a + n + 1;
      b.quadIdx(a, a + 1, c + 1, c);
    }
  }
}

function ribs(b: MeshBuilder, prof: number[], count: number, r: number): void {
  const w = Math.max(0.18, r * 0.018);
  const hgt = w * 0.9;
  const P = prof.length / 2;
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const base = b.vCount;
    for (let i = 0; i < P - 1; i++) {
      const rr = prof[i * 2];
      const y = prof[i * 2 + 1];
      const t = i / (P - 1);
      const fade = 1 - t * 0.85;
      const nx = sa * Math.cos((t * Math.PI) / 2);
      const nz = ca * Math.cos((t * Math.PI) / 2);
      const ny = Math.sin((t * Math.PI) / 2);
      const off = hgt * fade;
      const px = rr * sa + nx * off;
      const py = y + ny * off;
      const pz = rr * ca + nz * off;
      const tx = ca * w * fade;
      const tz = -sa * w * fade;
      b.vertex(px - tx, py, pz - tz, nx - ca * 0.6, ny, nz + sa * 0.6, 0, y);
      b.vertex(px, py, pz, nx, ny, nz, 0.5, y);
      b.vertex(px + tx, py, pz + tz, nx + ca * 0.6, ny, nz - sa * 0.6, 1, y);
    }
    for (let i = 0; i < P - 2; i++) {
      const a0 = base + i * 3;
      const a1 = a0 + 3;
      b.quadIdx(a0, a0 + 1, a1 + 1, a1);
      b.quadIdx(a0 + 1, a0 + 2, a1 + 2, a1 + 1);
    }
  }
}

export interface DrumOptions {
  /** Circumradius of the polygonal drum. */
  r: number;
  y0: number;
  y1: number;
  windows: number;
  lod: LodLevel;
  /** Window width as a fraction of the facet width. */
  winFrac?: number;
  /** Sill above y0. */
  sill?: number;
  /** Small buttresses at the polygon corners. */
  buttress?: number;
  /** Angular range for half drums under semi-domes. */
  half?: boolean;
  /** Rotation phase of the polygon. */
  phase?: number;
  cornice?: number;
  arch?: 'round' | 'pointed';
  glazing?: 'lattice' | 'clear' | 'stained';
}

/** Polygonal drum with one arched window per facet, optional corner buttresses and a top cornice. */
export function windowDrum(b: MeshBuilder, o: DrumOptions): void {
  const n = o.windows;
  const half = !!o.half;
  const facets = half ? Math.ceil(n / 2) : n;
  const step = (Math.PI * 2) / n;
  const phase = o.phase ?? 0;
  const side = 2 * o.r * Math.sin(step / 2);
  const apo = o.r * Math.cos(step / 2);
  const h = o.y1 - o.y0;
  const winW = side * (o.winFrac ?? 0.46);
  const sill = o.sill ?? Math.min(0.6, h * 0.12);
  const archRise = winW * 0.62;
  const winH = Math.max(0.3, h - sill - archRise - Math.max(0.25, h * 0.09));
  if (half) {
    b.colPrism(sector(o.r + (o.buttress ?? 0) * 0.5, phase - Math.PI / 2, phase + Math.PI / 2), o.y0, o.y1);
  } else {
    b.colCylinder(0, o.y0, 0, o.r + (o.buttress ?? 0) * 0.5, h);
  }
  b.with({ light: Light.Facade, lightBase: b.worldY(0, o.y0, 0) - 2 }, () => {
    if (o.lod === 2) {
      const n2 = Math.min(n, 16);
      b.lathe([o.r, o.y0, o.r, o.y1], { seg: half ? Math.ceil(n2 / 2) : n2, facets: true, phase: phase + (half ? -Math.PI / 2 : 0), a1: half ? Math.PI : Math.PI * 2 });
      return;
    }
    for (let i = 0; i < facets; i++) {
      const a = phase + (i + 0.5) * step - (half ? Math.PI / 2 : 0);
      b.push();
      b.rotateY(a);
      b.translate(-side / 2, 0, apo);
      const open: Opening[] =
        o.lod === 0 || side > 1.2
          ? [
              {
                x0: side / 2 - winW / 2,
                x1: side / 2 + winW / 2,
                y0: o.y0 + sill,
                y1: o.y0 + sill + winH,
                arch: o.arch ?? 'round',
                depth: Math.min(0.5, side * 0.12),
                back: 'glass',
                glazing: o.glazing ?? 'lattice',
                frame: o.lod === 0 && winW > 0.9 ? 0.12 : 0,
              },
            ]
          : [];
      wallPanel(b, side, o.y0, o.y1, open, { lod: o.lod, archSeg: o.lod === 0 ? 8 : 4, seed: i * 97 + 13 });
      b.pop();
      if (o.buttress && o.buttress > 0) {
        const ba = phase + i * step - (half ? Math.PI / 2 : 0);
        buttressPier(b, ba, o.r, o.y0, o.y1 - 0.2, o.buttress);
      }
    }
    if (o.buttress && o.buttress > 0 && half) {
      buttressPier(b, phase + facets * step - Math.PI / 2, o.r, o.y0, o.y1 - 0.2, o.buttress);
    }
    const c = o.cornice ?? Math.max(0.35, o.r * 0.045);
    if (!half) {
      b.sweep(polyPath(o.r, n, phase), corniceProfile(c).map((v, k) => (k % 2 === 1 ? v + o.y1 - c * 0.5 : v)));
    }
  });
}

function buttressPier(b: MeshBuilder, a: number, r: number, y0: number, y1: number, depth: number): void {
  const w = depth * 0.7;
  b.push();
  b.rotateY(a);
  b.translate(0, 0, r - 0.05);
  const slope = depth * 1.2;
  b.box(-w / 2, y0, 0, w / 2, y1 - slope, depth, 'bnt');
  b.quad([-w / 2, y1 - slope, depth], [w / 2, y1 - slope, depth], [w / 2, y1, 0], [-w / 2, y1, 0]);
  b.poly([
    [w / 2, y1 - slope, depth],
    [w / 2, y1 - slope, 0],
    [w / 2, y1, 0],
  ]);
  b.poly([
    [-w / 2, y1 - slope, 0],
    [-w / 2, y1 - slope, depth],
    [-w / 2, y1, 0],
  ]);
  b.pop();
}

export interface SemiDomeOptions {
  /** Centre of the semi-dome base circle (local), facing direction yaw (0 = +Z). */
  x: number;
  z: number;
  yaw: number;
  r: number;
  /** Springing of the window band. */
  y0: number;
  /** Window band height (0 = none). */
  band: number;
  windows: number;
  lod: LodLevel;
  /** Stone arch ring framing the open side (thickness m, 0 = none). */
  arch?: number;
  archDepth?: number;
}

/** Half dome over a half-polygon window band, opening toward local -Z of its own frame (i.e. facing the centre). */
export function semiDome(b: MeshBuilder, o: SemiDomeOptions): void {
  b.at(o.x, 0, o.z, o.yaw, () => {
    if (o.band > 0.2) {
      windowDrum(b, { r: o.r, y0: o.y0, y1: o.y0 + o.band, windows: o.windows * 2, lod: o.lod, half: true, buttress: o.lod === 0 ? Math.max(0.35, o.r * 0.045) : 0, winFrac: 0.42 });
      // flat roof ring between band and dome base
    }
    const ys = o.y0 + o.band;
    leadDome(b, { r: o.r, y: ys, lod: o.lod, a0: -Math.PI / 2, a1: Math.PI / 2, shape: 'hemi', ring: true });
    if (o.arch && o.arch > 0) {
      archRing(b, o.r, o.r + o.arch, ys, o.archDepth ?? o.arch * 1.2, o.lod);
    }
  });
}

/** Half annulus in the local XY plane (z from -depth..0) centred at (0, y): the great arch over a semi-dome. */
export function archRing(b: MeshBuilder, rIn: number, rOut: number, y: number, depth: number, lod: LodLevel): void {
  const n = lod === 0 ? 24 : lod === 1 ? 10 : 6;
  b.with({ mat: Mat.Stone, light: Light.Dome, lightBase: y - 4 }, () => {
    for (let i = 0; i < n; i++) {
      const t0 = Math.PI * (i / n);
      const t1 = Math.PI * ((i + 1) / n);
      const c0 = Math.cos(t0);
      const s0 = Math.sin(t0);
      const c1 = Math.cos(t1);
      const s1 = Math.sin(t1);
      // outer top surface (lead-capped extrados)
      b.with({ mat: Mat.Lead }, () =>
        b.quad([rOut * c1, y + rOut * s1, 0], [rOut * c0, y + rOut * s0, 0], [rOut * c0, y + rOut * s0, -depth], [rOut * c1, y + rOut * s1, -depth]),
      );
      // front face
      b.quad([rIn * c1, y + rIn * s1, 0], [rIn * c0, y + rIn * s0, 0], [rOut * c0, y + rOut * s0, 0], [rOut * c1, y + rOut * s1, 0]);
      // back face
      b.quad([rOut * c1, y + rOut * s1, -depth], [rOut * c0, y + rOut * s0, -depth], [rIn * c0, y + rIn * s0, -depth], [rIn * c1, y + rIn * s1, -depth]);
    }
  });
}

export interface TurretOptions {
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
  lod: LodLevel;
  sides?: number;
  alem?: number;
  windows?: boolean;
}

/** Octagonal buttress weight-tower with a small lead cupola and alem. */
export function turret(b: MeshBuilder, o: TurretOptions): void {
  const n = o.sides ?? 8;
  b.at(o.x, 0, o.z, 0, () => {
    b.colCylinder(0, o.y0, 0, o.r, o.y1 - o.y0 + Math.max(0.25, o.r * 0.22) * 0.5);
    b.with({ light: Light.Facade, lightBase: b.worldY(0, o.y0, 0) - 3 }, () => {
      if (o.windows && o.lod === 0) {
        const step = (Math.PI * 2) / n;
        const side = 2 * o.r * Math.sin(step / 2);
        const apo = o.r * Math.cos(step / 2);
        const h = o.y1 - o.y0;
        for (let i = 0; i < n; i++) {
          b.push();
          b.rotateY((i + 0.5) * step);
          b.translate(-side / 2, 0, apo);
          const op = rowOpenings(side, { count: 1, sill: o.y1 - h * 0.45, h: h * 0.18, w: side * 0.42, arch: 'round', depth: 0.25, back: 'blind' });
          wallPanel(b, side, o.y0, o.y1, op, { lod: o.lod, archSeg: 6 });
          b.pop();
        }
      } else {
        b.lathe([o.r, o.y0, o.r, o.y1], { seg: n, facets: true });
      }
      if (o.lod < 2) {
        b.sweep(polyPath(o.r, n, 0), corniceProfile(Math.max(0.25, o.r * 0.22)).map((v, k) => (k % 2 === 1 ? v + o.y1 : v)));
      }
    });
    const top = o.y1 + Math.max(0.25, o.r * 0.22) * 0.5;
    leadDome(b, { r: o.r * 0.92, y: top, lod: o.lod, shape: 'raised', alem: o.alem ?? o.r * 1.1, ring: false });
  });
}
