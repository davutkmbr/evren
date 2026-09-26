/**
 * Ayasofya (Hagia Sophia, 537). Dimensions: main dome 31-32.8 m span on four great arches whose crowns carry the
 * dome base at ~41 m, 40-rib shallow dome with a 40-window ring, crown 55.6 m; east/west semi-domes of the same span
 * rising to the arch crowns, each flanked by two exedrae; north/south tympanum walls pierced by two window rows
 * between the four great buttress towers; aisles + galleries ~24 m high; inner and outer narthex to the west.
 * Four non-identical minarets: SE red brick (Mehmed II), NE slender stone (Bayezid II), SW/NW by Sinan.
 * Frame: -Z = apse (ESE), +Z = narthex (west), +X = south side.
 */
import type { MeshBuilder } from '../builder';
import { sadirvan } from '../parts/arcade';
import { corniceProfile, flatRoof, polyPath, rectPath } from '../parts/details';
import { archRing, leadDome, semiDome, windowDrum } from '../parts/dome';
import { minaret, minaretTop, type MinaretSpec } from '../parts/minaret';
import { rowOpenings, wallPanel, type Opening } from '../parts/wall';
import { Light, Mat, type LocalCollider, type LodLevel, type RGB } from '../types';
import { boxFacades, tympanumOpenings, type StyleResult } from './imperial';

const PLASTER: RGB = [0.85, 0.62, 0.48];
const TRIM: RGB = [0.88, 0.8, 0.7];
const OTTOMAN_STONE: RGB = [0.8, 0.76, 0.68];

const R = 16.4;
const BAY = 15.8;
const AISLE_H = 24;
const DOME_BASE = 41;
const DRUM_TOP = 45.2;
const CROWN = 56.2;
const CORE = { x0: -36, x1: 36, z0: -37, z1: 33 };

function galleryFacade(len: number, h: number, bay: number): Opening[] {
  const n = Math.max(1, Math.floor((len - 6) / bay));
  const out: Opening[] = [];
  out.push(...rowOpenings(len, { count: n, sill: 3, h: 3.4, w: 1.7, arch: 'round', back: 'glass', glazing: 'clear', depth: 0.9, frame: 0.18 }, 3));
  if (h > 14) {
    out.push(...rowOpenings(len, { count: n, sill: h * 0.52, h: 3.6, w: 2.1, arch: 'round', back: 'glass', glazing: 'clear', depth: 0.9, frame: 0.2 }, 3));
  }
  return out;
}

/**
 * Buttress tower running along +X from xi to xo, z in [zc - w/2, zc + w/2]; its lead-capped top slopes from yHigh
 * (against the dome piers) down to yLow at the outer face.
 */
function buttressTower(b: MeshBuilder, xi: number, xo: number, zc: number, w: number, yLow: number, yHigh: number, lod: LodLevel): void {
  const L = xo - xi;
  const topAt = (x: number): number => yHigh + ((yLow - yHigh) * (x - xi)) / L;
  const win = (len: number, top: number): Opening[] =>
    lod === 2 ? [] : rowOpenings(len, { count: Math.max(1, Math.floor(len / 5.5)), sill: top - 8.5, h: 2.6, w: 1.3, arch: 'round', back: 'glass', glazing: 'clear', depth: 0.8 }, 1.5);
  // the sloping top as four steps, each as high as its inner end
  for (let k = 0; k < 4; k++) {
    const x0 = xi + (L * k) / 4;
    b.colBox(x0, 0, zc - w / 2, x0 + L / 4, topAt(x0), zc + w / 2);
  }
  b.at(xi, 0, zc + w / 2, 0, () => wallPanel(b, L, -2, (x) => topAt(xi + x), win(L, yLow), { lod, seed: 11 }));
  b.at(xo, 0, zc - w / 2, Math.PI, () => wallPanel(b, L, -2, (x) => topAt(xo - x), win(L, yLow), { lod, seed: 12 }));
  b.at(xo, 0, zc + w / 2, Math.PI / 2, () => wallPanel(b, w, -2, yLow, win(w, yLow), { lod, seed: 13 }));
  b.at(xi, 0, zc - w / 2, -Math.PI / 2, () => wallPanel(b, w, AISLE_H - 1, yHigh, [], { lod, seed: 14 }));
  const e = 0.35;
  b.with({ mat: Mat.Lead, light: Light.None }, () => {
    b.quad([xi - e, yHigh + 0.05, zc + w / 2 + e], [xo + e, yLow - 0.05, zc + w / 2 + e], [xo + e, yLow - 0.05, zc - w / 2 - e], [xi - e, yHigh + 0.05, zc - w / 2 - e]);
  });
}

/** Square pier turret at a corner of the dome base with a low pyramidal lead cap. */
function pierTurret(b: MeshBuilder, x: number, z: number, s: number, y0: number, y1: number, lod: LodLevel): void {
  b.at(x, 0, z, 0, () => {
    boxFacades(b, s, s, y0, y1, lod, (_side, len) =>
      lod === 2 ? [] : rowOpenings(len, { count: 1, sill: y1 - 4.5, h: 1.6, w: 1.1, arch: 'round', back: 'glass', glazing: 'clear', depth: 0.6 }),
    );
    if (lod < 2) {
      b.with({ color: TRIM, mat: Mat.Smooth }, () => b.sweep(rectPath(-s / 2, -s / 2, s / 2, s / 2), corniceProfile(0.45).map((v, k) => (k % 2 === 1 ? v + y1 - 0.2 : v))));
    }
    flatRoof(b, -s / 2 - 0.3, -s / 2 - 0.3, s / 2 + 0.3, s / 2 + 0.3, y1 + 0.02, s * 0.35);
  });
}

function turbe(b: MeshBuilder, x: number, z: number, r: number, h: number, lod: LodLevel): void {
  b.at(x, 0, z, 0, () => {
    b.with({ light: Light.Facade, lightBase: 0 }, () => {
      const n = 8;
      const step = (Math.PI * 2) / n;
      const side = 2 * r * Math.sin(step / 2);
      for (let i = 0; i < n; i++) {
        b.push();
        b.rotateY((i + 0.5) * step);
        b.translate(-side / 2, 0, r * Math.cos(step / 2));
        wallPanel(b, side, -1, h, rowOpenings(side, { count: 1, sill: 1.4, h: 2.2, w: 1.1, arch: 'flat', back: 'glass', glazing: 'grille', depth: 0.5, frame: 0.14 }), { lod, seed: i });
        b.pop();
      }
      if (lod < 2) {
        b.sweep(polyPath(r, 8), corniceProfile(0.35).map((v, k) => (k % 2 === 1 ? v + h - 0.2 : v)));
      }
    });
    leadDome(b, { r: r * 0.92, y: h + 0.2, lod, shape: 'raised', alem: r * 0.28 });
  });
}

export function buildAyasofya(b: MeshBuilder, lod: LodLevel): StyleResult {
  const cols: LocalCollider[] = [];
  const shift = -4;
  b.set({ mat: Mat.Plaster, color: PLASTER, light: Light.Facade, lightBase: 0, ao: 1 });
  b.push();
  b.translate(0, 0, shift);

  b.with({ mat: Mat.Stone, color: OTTOMAN_STONE, ao: 0.85 }, () => b.box(CORE.x0 - 6, -8, CORE.z0 - 14, CORE.x1 + 16, 0.3, CORE.z1 + 24, 'b'));
  if (lod === 0) {
    b.with({ mat: Mat.Paving, light: Light.Ground, lightBase: -2 }, () => {
      b.quad([CORE.x0 - 6, 0.31, CORE.z1 + 24], [CORE.x1 + 16, 0.31, CORE.z1 + 24], [CORE.x1 + 16, 0.31, CORE.z0 - 14], [CORE.x0 - 6, 0.31, CORE.z0 - 14]);
    });
  }

  // Aisles and galleries.
  const cw = CORE.x1 - CORE.x0;
  const cd = CORE.z1 - CORE.z0;
  b.at(0, 0, (CORE.z0 + CORE.z1) / 2, 0, () => {
    boxFacades(b, cw, cd, 0.3, AISLE_H, lod, (side, len) => (side === 'front' ? [] : galleryFacade(len, AISLE_H, 6.2)));
    if (lod < 2) {
      b.with({ color: TRIM, mat: Mat.Smooth }, () => b.sweep(rectPath(-cw / 2, -cd / 2, cw / 2, cd / 2), corniceProfile(0.7).map((v, k) => (k % 2 === 1 ? v + AISLE_H - 0.35 : v))));
    }
  });
  flatRoof(b, CORE.x0, CORE.z0, -BAY - 1.5, CORE.z1, AISLE_H + 0.02, 2.2);
  flatRoof(b, BAY + 1.5, CORE.z0, CORE.x1, CORE.z1, AISLE_H + 0.02, 2.2);
  flatRoof(b, -BAY - 1.5, CORE.z0, BAY + 1.5, CORE.z1, AISLE_H + 0.02);

  // North/south tympana under the great arches, with their arch rings.
  const springY = DOME_BASE - BAY;
  for (const sx of [-1, 1]) {
    b.at(sx * BAY, 0, sx * BAY, sx > 0 ? Math.PI / 2 : -Math.PI / 2, () => {
      const len = BAY * 2;
      const top = (x: number): number => springY + Math.sqrt(Math.max(0, BAY * BAY - (x - BAY) ** 2));
      const ops = lod === 2 ? [] : tympanumOpenings(len, AISLE_H + 0.8, DOME_BASE - 1.2, 'clear');
      wallPanel(b, len, AISLE_H - 1, top, ops, { lod, seed: 3 + sx });
    });
    b.with({ color: TRIM }, () => b.at(sx * (BAY + 1.8), 0, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, () => archRing(b, BAY - 0.2, BAY + 1.4, springY, 1.8, lod)));
  }

  // Dome base platform, corner pier turrets and the buttress towers.
  const plat = BAY + 1.8;
  b.with({ light: Light.Dome, lightBase: DOME_BASE - 6 }, () => {
    wallPanelRing(b, plat, DOME_BASE - 2.4, DOME_BASE + 0.3, lod);
  });
  flatRoof(b, -plat, -plat, plat, plat, DOME_BASE + 0.32);
  // core between the great arches: the tympana stand at +-BAY, the arch rings reach 1.8 m beyond them
  b.colBox(-BAY - 1, AISLE_H - 1, -plat, BAY + 1, DOME_BASE - 2.4, plat);
  b.colBox(-plat, DOME_BASE - 2.4, -plat, plat, DOME_BASE + 0.32, plat);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      pierTurret(b, sx * (BAY + 1.2), sz * (BAY + 1.2), 5.2, AISLE_H - 1, DOME_BASE + 3.2, lod);
    }
  }
  for (const sx of [-1, 1]) {
    b.at(0, 0, 0, sx > 0 ? 0 : Math.PI, () => {
      for (const sz of [-1, 1]) {
        buttressTower(b, BAY + 3.8, CORE.x1 + 5, sz * (BAY + 2.4), 8.2, 29, 36.5, lod);
      }
    });
  }

  // East and west semi-domes (same span as the dome, crowns at the dome base) with two exedrae each; the apse east.
  for (const sz of [-1, 1]) {
    const yaw = sz > 0 ? 0 : Math.PI;
    semiDome(b, { x: 0, z: sz * BAY, yaw, r: R * 0.95, y0: 24.2, band: 1.6, windows: 5, lod, arch: 1.5, archDepth: 2.2 });
    for (const sgn of [-1, 1]) {
      const a = yaw + sgn * 0.98;
      semiDome(b, { x: Math.sin(a) * R * 0.74, z: sz * BAY + Math.cos(a) * R * 0.74, yaw: a, r: 6.4, y0: 19.2, band: 1.8, windows: 3, lod });
    }
  }
  b.at(0, 0, CORE.z0 + 1, Math.PI, () => {
    const ar = 7.4;
    const walls = 3;
    b.colCylinder(0, 0.3, 0, ar, 20.8);
    for (let i = 0; i < walls; i++) {
      const a0 = -Math.PI / 2 + (i * Math.PI) / walls;
      const side = 2 * ar * Math.sin(Math.PI / (walls * 2));
      b.push();
      b.rotateY(a0 + Math.PI / (walls * 2));
      b.translate(-side / 2, 0, ar * Math.cos(Math.PI / (walls * 2)));
      wallPanel(b, side, 0.3, 21, lod === 2 ? [] : rowOpenings(side, { count: 1, sill: 9, h: 5, w: 2.4, arch: 'round', back: 'glass', glazing: 'clear', depth: 0.9, frame: 0.2 }), { lod, seed: 40 + i });
      b.pop();
    }
    leadDome(b, { r: ar, y: 21, lod, a0: -Math.PI / 2, a1: Math.PI / 2, shape: 'hemi', ring: false });
  });

  // East corner buttresses (Ottoman additions) as sloping masses.
  for (const sx of [-1, 1]) {
    b.push();
    b.rotateY(Math.PI / 2);
    buttressTower(b, -CORE.z0 - 2, -CORE.z0 + 9, sx * (CORE.x1 - 6), 9, 9, 19, lod);
    b.pop();
  }

  // Drum with 40 windows between 40 buttresses, shallow ribbed dome.
  windowDrum(b, { r: R * 1.03, y0: DOME_BASE, y1: DRUM_TOP, windows: 40, lod, buttress: 1.15, winFrac: 0.52, cornice: 0.45, arch: 'round', glazing: 'clear' });
  leadDome(b, { r: R, y: DRUM_TOP, rise: CROWN - DRUM_TOP, lod, shape: 'shallow', ribs: 40, alem: 4.4, sheetWidth: (Math.PI * 2 * R) / 40 });

  // Inner (taller) and outer narthex to the west.
  const n0 = CORE.z1;
  const n1 = n0 + 11;
  const n2 = n1 + 7;
  b.at(0, 0, (n0 + n1) / 2, 0, () => boxFacades(b, 60, n1 - n0, 0.3, 17, lod, (side, len) => (side === 'back' ? [] : galleryFacade(len, 17, 5.6))));
  flatRoof(b, -30, n0, 30, n1, 17.02, 2.6);
  b.at(0, 0, (n1 + n2) / 2, 0, () => boxFacades(b, 58, n2 - n1, 0.3, 10.5, lod, (side, len) => (side === 'back' ? [] : galleryFacade(len, 10.5, 5))));
  flatRoof(b, -29, n1, 29, n2, 10.52, 1.4);

  // Ottoman tombs to the south-west, ablution fountain by the south entrance.
  b.with({ mat: Mat.Stone, color: OTTOMAN_STONE }, () => {
    const tombs = [
      { x: 46, z: 30, r: 7.6, h: 10 },
      { x: 51, z: 12, r: 6.4, h: 9 },
      { x: 47, z: -4, r: 5.4, h: 8 },
    ];
    for (const t of tombs) {
      turbe(b, t.x, t.z, t.r, t.h, lod);
      cols.push({ kind: 'cylinder', x: t.x, y: 0, z: t.z + shift, r: t.r, h: t.h + 0.3 });
    }
    b.at(44, 0, -22, 0, () => sadirvan(b, 3, 8, lod));
  });

  // Minarets.
  const mins: MinaretSpec[] = [
    { x: 39.5, z: -41, h: 57, serefe: 1, style: 'brick', r: 2.1, baseH: 9, color: [0.62, 0.36, 0.26] },
    { x: -40, z: -40, h: 55, serefe: 1, style: 'slim', r: 1.55, baseH: 13, color: OTTOMAN_STONE },
    { x: 34, z: n2 + 3, h: 58, serefe: 2, style: 'thick', r: 2.35, baseH: 12, color: OTTOMAN_STONE },
    { x: -34, z: n2 + 3, h: 58, serefe: 2, style: 'thick', r: 2.35, baseH: 12, color: OTTOMAN_STONE },
  ];
  let top = CROWN + 4.4;
  b.with({ mat: Mat.Stone, color: OTTOMAN_STONE }, () => {
    for (const m of mins) {
      cols.push(...minaret(b, m, lod).map((c) => (c.kind === 'box' ? { ...c, cz: c.cz + shift } : { ...c, z: c.z + shift })));
      top = Math.max(top, minaretTop(m));
    }
  });
  b.pop();
  // parts registered theirs in the shifted frame already
  return { colliders: [...cols, ...b.colliders], radius: 82, height: top };
}

/** Four plain walls around the square dome base (the pendentive block seen above the tympana). */
function wallPanelRing(b: MeshBuilder, half: number, y0: number, y1: number, lod: LodLevel): void {
  const sides: [number, number, number][] = [
    [-half, half, 0],
    [half, half, Math.PI / 2],
    [half, -half, Math.PI],
    [-half, -half, -Math.PI / 2],
  ];
  for (const [x, z, yaw] of sides) {
    b.at(x, 0, z, yaw, () => wallPanel(b, half * 2, y0, y1, [], { lod }));
  }
  if (lod < 2) {
    b.with({ color: TRIM, mat: Mat.Smooth }, () => b.sweep(rectPath(-half, -half, half, half), corniceProfile(0.55).map((v, k) => (k % 2 === 1 ? v + y1 - 0.3 : v))));
  }
}
