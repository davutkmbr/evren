import type { MeshBuilder } from '../builder';
import { Light, Mat, type LodLevel } from '../types';
import { corniceProfile, flatRoof, polyPath } from './details';
import { leadDome } from './dome';
import { rowOpenings, wallPanel, type Opening } from './wall';

export interface ArcadeOptions {
  /** Length along local +X (0..len), face at z = 0 looking +Z, bays extend to z = -depth. */
  len: number;
  bays: number;
  depth: number;
  /** Column height to the springing. */
  colH: number;
  /** Roof height (top of the spandrel wall). */
  roofH: number;
  lod: LodLevel;
  /** Small dome on every bay (Ottoman revak) or flat roof. */
  domes?: boolean;
  /** Pitched lean-to roof instead of domes (neighbourhood porticos). */
  pitched?: boolean;
  /** Skip the column at x = 0 / x = len (shared corners). */
  skipFirstColumn?: boolean;
  skipLastColumn?: boolean;
  /** Column indices (0..bays) left out, e.g. where a buttress passes through the arcade. */
  skipColumns?: readonly number[];
  /** Arch thickness (m). */
  arch?: number;
  /** Floor platform height. */
  floor?: number;
  domeScale?: number;
}

/** Colonnaded portico: marble columns, pointed arches, lead roof and bay domes. */
export function arcade(b: MeshBuilder, o: ArcadeOptions): void {
  const bw = o.len / o.bays;
  const t = o.arch ?? Math.min(0.9, bw * 0.16);
  const colR = Math.min(0.42, bw * 0.075);
  const floor = o.floor ?? 0.45;
  const base = b.worldY(0, 0, 0);
  // stylobate, the roof block over the arches and one collider per column: the bays stay open to walk and fly
  // through (a solid box stood as an invisible wall between the columns)
  const colR0 = Math.min(0.42, (o.len / o.bays) * 0.075);
  const t0 = o.arch ?? Math.min(0.9, (o.len / o.bays) * 0.16);
  b.colBox(0, 0, -o.depth, o.len, floor, 0.35);
  b.colBox(0, o.colH, -o.depth, o.len, o.roofH + (o.pitched ? o.depth * 0.25 : 0.1), 0.35, true);
  for (let i = 0; i <= o.bays; i++) {
    if ((i === 0 && o.skipFirstColumn) || (i === o.bays && o.skipLastColumn) || o.skipColumns?.includes(i)) {
      continue;
    }
    b.colCylinder((i * o.len) / o.bays, floor, -t0 / 2, colR0 * 1.4, o.colH - floor);
  }
  if (o.lod === 2) {
    arcadeMassing(b, o, bw, t, floor, base);
    return;
  }
  // Raised stylobate.
  b.with({ mat: Mat.Marble, light: Light.Ground, lightBase: base - 1, ao: 0.9 }, () => {
    b.box(0, -1.5, -o.depth, o.len, floor, 0.35, 'bn');
  });
  b.with({ mat: Mat.Paving, light: Light.Soffit, ao: 0.75 }, () => {
    b.quad([0, floor + 0.01, 0.3], [o.len, floor + 0.01, 0.3], [o.len, floor + 0.01, -o.depth], [0, floor + 0.01, -o.depth]);
  });
  // Columns.
  const colSeg = o.lod === 0 ? 12 : 6;
  for (let i = 0; i <= o.bays; i++) {
    if ((i === 0 && o.skipFirstColumn) || (i === o.bays && o.skipLastColumn) || o.skipColumns?.includes(i)) {
      continue;
    }
    const x = i * bw;
    b.at(x, floor, -t / 2, 0, () => {
      b.with({ mat: Mat.Marble, light: Light.Facade, lightBase: base }, () => {
        const top = o.colH - floor;
        const capH = Math.min(0.9, top * 0.14);
        b.box(-colR * 1.35, 0, -colR * 1.35, colR * 1.35, 0.45, colR * 1.35, 'b');
        b.lathe([colR * 1.12, 0.45, colR, 0.6, colR * 0.92, top - capH], { seg: colSeg });
        if (o.lod === 0) {
          b.lathe([colR * 0.92, top - capH, colR * 1.5, top - 0.12, colR * 1.5, top], { seg: 8, facets: true, phase: Math.PI / 8 });
        } else {
          b.lathe([colR * 0.92, top - capH, colR * 1.4, top], { seg: 4, facets: true, phase: Math.PI / 4 });
        }
        b.box(-colR * 1.55, top, -t / 2, colR * 1.55, top + 0.2, t / 2, 'b');
      });
    });
  }
  // Spandrel walls with open arches (front and back faces).
  const openings: Opening[] = [];
  for (let i = 0; i < o.bays; i++) {
    const x0 = i * bw + colR * 1.5;
    const x1 = (i + 1) * bw - colR * 1.5;
    const w = (x1 - x0) / 2;
    const rise = Math.min(w * 1.15, (o.roofH - o.colH) * 0.82);
    openings.push({ x0, x1, y0: o.colH, y1: o.colH, arch: 'pointed', rise, depth: t, back: 'open' });
  }
  b.with({ light: Light.Facade, lightBase: base }, () => {
    wallPanel(b, o.len, o.colH, o.roofH, openings, { lod: o.lod, archSeg: o.lod === 0 ? 10 : 5 });
    b.push();
    b.translate(o.len, 0, -t);
    b.rotateY(Math.PI);
    b.with({ light: Light.Soffit, ao: 0.7 }, () => {
      wallPanel(
        b,
        o.len,
        o.colH,
        o.roofH,
        openings.map((op) => ({ ...op, x0: o.len - op.x1, x1: o.len - op.x0 })),
        { lod: o.lod, archSeg: o.lod === 0 ? 10 : 5, reveals: false },
      );
    });
    b.pop();
  });
  // Ceiling of the bays.
  b.with({ mat: Mat.Plaster, color: [0.86, 0.82, 0.74], light: Light.Soffit, ao: 0.55 }, () => {
    b.quad([0, o.roofH - 0.25, -o.depth], [o.len, o.roofH - 0.25, -o.depth], [o.len, o.roofH - 0.25, -t], [0, o.roofH - 0.25, -t]);
  });
  // Eave cornice on the face.
  if (o.lod === 0) {
    const c = 0.35;
    const prof = corniceProfile(c);
    b.push();
    b.translate(0, o.roofH - c * 0.5, 0);
    for (let k = 0; k < prof.length / 2 - 1; k++) {
      const oa = prof[k * 2];
      const ya = prof[k * 2 + 1];
      const ob = prof[k * 2 + 2];
      const yb = prof[k * 2 + 3];
      b.quad([0, ya, oa], [o.len, ya, oa], [o.len, yb, ob], [0, yb, ob]);
    }
    b.pop();
  }
  // Roof and bay domes.
  if (o.pitched) {
    b.with({ mat: Mat.Lead, light: Light.None }, () => {
      b.quad([-0.3, o.roofH, 0.5], [o.len + 0.3, o.roofH, 0.5], [o.len + 0.3, o.roofH + o.depth * 0.25, -o.depth], [-0.3, o.roofH + o.depth * 0.25, -o.depth]);
    });
    return;
  }
  flatRoof(b, 0, -o.depth, o.len, 0.1, o.roofH);
  if (o.domes !== false) {
    const dr = Math.min(bw, o.depth) * 0.42 * (o.domeScale ?? 1);
    for (let i = 0; i < o.bays; i++) {
      const cx = (i + 0.5) * bw;
      const cz = -o.depth / 2;
      b.at(cx, 0, cz, 0, () => {
        b.with({ light: Light.Dome, lightBase: base + o.roofH }, () => {
          if (o.lod === 0) {
            b.lathe([dr * 1.12, o.roofH, dr * 1.12, o.roofH + 0.5, dr * 1.02, o.roofH + 0.55], { seg: 8, facets: true, phase: Math.PI / 8 });
          }
        });
        leadDome(b, { r: dr, y: o.roofH + (o.lod === 0 ? 0.5 : 0.1), lod: o.lod, shape: 'hemi', rise: dr * 0.85, ring: false, alem: o.lod === 0 ? dr * 0.35 : 0 });
      });
    }
  }
}

/** Silhouette-level arcade: stylobate, spandrel band on end piers, roof and bay domes. */
function arcadeMassing(b: MeshBuilder, o: ArcadeOptions, bw: number, t: number, floor: number, base: number): void {
  b.with({ mat: Mat.Marble, light: Light.Ground, lightBase: base - 1, ao: 0.9 }, () => b.box(0, -1.5, -o.depth, o.len, floor, 0.35, 'b'));
  b.with({ light: Light.Facade, lightBase: base }, () => {
    const pier = Math.min(0.9, bw * 0.18);
    b.box(0, floor, -t, pier, o.colH, 0, 'bt');
    b.box(o.len - pier, floor, -t, o.len, o.colH, 0, 'bt');
    b.box(0, o.colH, -t, o.len, o.roofH, 0, 't');
  });
  if (o.pitched) {
    b.with({ mat: Mat.Lead, light: Light.None }, () => {
      b.quad([-0.3, o.roofH, 0.5], [o.len + 0.3, o.roofH, 0.5], [o.len + 0.3, o.roofH + o.depth * 0.25, -o.depth], [-0.3, o.roofH + o.depth * 0.25, -o.depth]);
    });
    return;
  }
  flatRoof(b, 0, -o.depth, o.len, 0.1, o.roofH);
  if (o.domes !== false) {
    const dr = Math.min(bw, o.depth) * 0.42 * (o.domeScale ?? 1);
    for (let i = 0; i < o.bays; i++) {
      b.at((i + 0.5) * bw, 0, -o.depth / 2, 0, () => leadDome(b, { r: dr, y: o.roofH + 0.1, lod: 2, shape: 'hemi', rise: dr * 0.85, ring: false }));
    }
  }
}

export interface CourtOptions {
  /** Court rectangle: x in [-w/2, w/2], z in [z0, z0 + d]. */
  w: number;
  d: number;
  z0: number;
  /** Bays along x and z. */
  nx: number;
  nz: number;
  h: number;
  lod: LodLevel;
  fountain: 'hex' | 'oct' | 'none';
  /** Height of the portico adjoining the prayer hall (son cemaat yeri). */
  porticoH?: number;
}

/** Arcaded courtyard (avlu) with outer walls, gates, domed revak on four sides and a central şadırvan. */
export function courtyard(b: MeshBuilder, o: CourtOptions): void {
  const bx = o.w / o.nx;
  const bz = o.d / o.nz;
  const depth = Math.min(bx, bz) * 0.95;
  const x0 = -o.w / 2;
  const x1 = o.w / 2;
  const z0 = o.z0;
  const z1 = o.z0 + o.d;
  const h = o.h;
  const colH = h * 0.62;
  const wallH = h + 0.4;
  const lod = o.lod;
  const base = b.worldY(0, 0, 0);

  // Outer walls (outside faces, inner faces) with a gate in the middle of the far side and the long sides.
  b.with({ light: Light.Facade, lightBase: base }, () => {
    const sides: { x: number; z: number; yaw: number; len: number; gate: boolean }[] = [
      { x: x1, z: z1, yaw: 0, len: o.w, gate: true },
      { x: x1, z: z0, yaw: Math.PI / 2, len: o.d, gate: true },
      { x: x0, z: z1, yaw: -Math.PI / 2, len: o.d, gate: true },
    ];
    for (const s of sides) {
      b.push();
      b.translate(s.x, 0, s.z);
      b.rotateY(s.yaw);
      b.translate(-s.len, 0, 0);
      const bays = Math.max(1, Math.round(s.len / bx));
      const win = rowOpenings(s.len, { count: bays, sill: 1.3, h: 2.0, w: 1.15, arch: 'flat', back: 'glass', glazing: 'grille', tympanum: lod === 0, depth: 0.5 }, bx * 0.5);
      const gateW = Math.min(5, s.len * 0.12);
      const gx0 = s.len / 2 - gateW / 2;
      const openings: Opening[] = win.filter((w) => w.x1 < gx0 - 0.5 || w.x0 > gx0 + gateW + 0.5);
      if (s.gate) {
        openings.push({ x0: gx0, x1: gx0 + gateW, y0: 0, y1: h * 0.55, arch: 'pointed', depth: 0.9, back: 'door' });
      }
      wallPanel(b, s.len, -0.5, wallH, openings, { lod, seed: Math.round(s.len * 13) });
      // the gates are drawn with closed door leaves, so the wall collider runs through them
      b.colBox(0, 0, -0.9, s.len, wallH + 0.2, 0);
      b.push();
      b.translate(s.len, 0, -0.9);
      b.rotateY(Math.PI);
      b.with({ light: Light.Soffit, ao: 0.6 }, () => wallPanel(b, s.len, 0, wallH - 0.3, [], { lod }));
      b.pop();
      // wall-top cornice
      if (lod === 0) {
        const c = 0.4;
        const prof = corniceProfile(c);
        for (let k = 0; k < prof.length / 2 - 1; k++) {
          b.quad(
            [0, wallH - c * 0.5 + prof[k * 2 + 1], prof[k * 2]],
            [s.len, wallH - c * 0.5 + prof[k * 2 + 1], prof[k * 2]],
            [s.len, wallH - c * 0.5 + prof[k * 2 + 3], prof[k * 2 + 2]],
            [0, wallH - c * 0.5 + prof[k * 2 + 3], prof[k * 2 + 2]],
          );
        }
      }
      b.pop();
    }
    // Monumental portal block on the far side.
    const gatePw = Math.min(9, o.w * 0.18);
    b.colBox(-gatePw / 2, 0, z1 - 0.2, -gatePw / 2 + 1.2, h + 2.2, z1 + 1.1);
    b.colBox(gatePw / 2 - 1.2, 0, z1 - 0.2, gatePw / 2, h + 2.2, z1 + 1.1);
    b.colBox(-gatePw / 2, h * 0.55 + 2.2, z1 - 0.2, gatePw / 2, h + 2.2, z1 + 1.1);
    if (lod === 0) {
      const pw = gatePw;
      b.box(-pw / 2, -0.5, z1 - 0.2, -pw / 2 + 1.2, h + 2.2, z1 + 1.1, 'b');
      b.box(pw / 2 - 1.2, -0.5, z1 - 0.2, pw / 2, h + 2.2, z1 + 1.1, 'b');
      b.box(-pw / 2, h * 0.55 + 2.2, z1 - 0.2, pw / 2, h + 2.2, z1 + 1.1, 'b');
    }
  });

  // Revak arcades facing the court interior.
  const ix0 = x0 + depth;
  const ix1 = x1 - depth;
  const iz0 = z0 + depth;
  const iz1 = z1 - depth;
  const portH = o.porticoH ?? h * 1.35;
  const run = (px: number, pz: number, yaw: number, len: number, bays: number, rh: number, ch: number, skipFirst: boolean, skipLast: boolean, dscale = 1): void => {
    b.at(px, 0, pz, yaw, () => arcade(b, { len, bays, depth, colH: ch, roofH: rh, lod, skipFirstColumn: skipFirst, skipLastColumn: skipLast, domeScale: dscale }));
  };
  // far side (z1): faces -Z (toward hall) -> yaw pi, starts at x1
  run(ix1 + depth, iz1, Math.PI, o.w, o.nx, h, colH, false, false);
  // hall side (z0): the taller son cemaat portico facing +Z, runs from x0
  run(x0, iz0, 0, o.w, o.nx, portH, portH * 0.62, false, false, 1.15);
  // west side (x0): faces +X, runs from z1-depth toward z0+depth
  run(ix0, iz1, Math.PI / 2, iz1 - iz0, Math.max(1, o.nz - 2), h, colH, true, true);
  // east side (x1): faces -X
  run(ix1, iz0, -Math.PI / 2, iz1 - iz0, Math.max(1, o.nz - 2), h, colH, true, true);

  // Court paving.
  b.with({ mat: Mat.Paving, light: Light.Ground, lightBase: base - 2, ao: 1 }, () => {
    b.quad([ix0, 0.05, iz1], [ix1, 0.05, iz1], [ix1, 0.05, iz0], [ix0, 0.05, iz0]);
  });
  if (o.fountain !== 'none') {
    b.at(0, 0, (z0 + z1) / 2, 0, () => sadirvan(b, Math.min(o.w, o.d) * 0.075, o.fountain === 'hex' ? 6 : 8, lod));
  }
}

/** Ablution fountain: marble basin, slender columns and a wide-eaved lead canopy. */
export function sadirvan(b: MeshBuilder, r: number, sides: number, lod: LodLevel): void {
  const base = b.worldY(0, 0, 0);
  const R = r * 1.9;
  const colH = r * 1.35;
  // basin, eave ring and canopy; the space between the columns stays open
  b.colCylinder(0, 0, 0, R * 0.9, 1.3);
  b.colCylinder(0, colH, 0, R * 1.18, 0.45);
  b.colCylinder(0, colH + 0.45, 0, R * 0.95, R * 0.18);
  b.colCylinder(0, colH + 0.45 + R * 0.18, 0, R * 0.6, R * 0.44 - 0.45);
  b.with({ mat: Mat.Marble, light: Light.Soffit }, () => {
    b.lathe([R * 0.9, 0, R * 0.9, 0.35, r * 1.02, 0.4, r, 1.2, r * 1.05, 1.28, 0, 1.3], { seg: sides, facets: true });
    if (lod === 0) {
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        b.at(Math.sin(a) * R * 0.82, 0.35, Math.cos(a) * R * 0.82, 0, () => {
          b.lathe([0.16, 0, 0.14, colH], { seg: 8 });
        });
      }
    }
  });
  b.with({ mat: Mat.Lead, light: Light.Dome, lightBase: base + colH }, () => {
    const eave = R * 1.18;
    b.lathe([eave, colH + 0.1, eave, colH + 0.45, R * 0.55, colH + R * 0.5, r * 0.5, colH + R * 0.62], { seg: sides, facets: true, uvMode: 'sheets', sheets: sides * 3 });
    b.lathe([r * 0.2, colH + 0.1, eave, colH + 0.1], { seg: sides, facets: true });
  });
  b.with({ mat: Mat.Plaster, color: [0.7, 0.62, 0.5], light: Light.Soffit, ao: 0.6 }, () => {
    b.sweep(polyPath(R * 0.95, sides, Math.PI / sides), [0, colH - 0.3, 0.2, colH + 0.1]);
  });
  leadDome(b, { r: r * 0.55, y: colH + R * 0.62, lod, shape: 'hemi', ring: false, alem: lod === 0 ? r * 0.5 : 0 });
}
