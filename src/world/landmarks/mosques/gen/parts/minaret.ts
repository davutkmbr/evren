import type { MeshBuilder } from '../builder';
import { Light, Mat, type LocalCollider, type LodLevel } from '../types';
import { alem, corniceProfile } from './details';

export type MinaretStyle = 'classic' | 'baroque' | 'brick' | 'thick' | 'slim';

export interface MinaretSpec {
  x: number;
  z: number;
  /** Tip of the lead cap above the local floor (alem excluded). */
  h: number;
  serefe: 1 | 2 | 3;
  /** Shaft radius (default h / 30). */
  r?: number;
  /** Height of the square base block (default 0.15 h). */
  baseH?: number;
  /** Width of the square base block (default 2.5 r). */
  baseW?: number;
  style?: MinaretStyle;
  /** Ground level under the minaret (default 0). */
  y?: number;
  /** Stone tint override (brick minaret uses the brick material regardless). */
  color?: readonly [number, number, number];
}

interface Layout {
  r: number;
  baseH: number;
  baseW: number;
  capY: number;
  petekY: number;
  floors: number[];
  corbelH: number;
  ext: number;
  alemH: number;
}

function layout(m: MinaretSpec): Layout {
  const H = m.h;
  const style = m.style ?? 'classic';
  const r = m.r ?? H / (style === 'slim' || style === 'baroque' ? 34 : style === 'thick' || style === 'brick' ? 22 : 30);
  const capFrac = style === 'baroque' ? 0.14 : style === 'thick' || style === 'brick' ? 0.15 : 0.185;
  const capY = H * (1 - capFrac);
  const petekH = H * (style === 'baroque' ? 0.045 : 0.06);
  const petekY = capY - petekH;
  const spacing = H * (m.serefe === 3 ? 0.125 : 0.14);
  const floors: number[] = [];
  for (let k = m.serefe - 1; k >= 0; k--) {
    floors.push(petekY - spacing * k);
  }
  return {
    r,
    baseH: m.baseH ?? H * 0.15,
    baseW: m.baseW ?? r * 2.55,
    capY,
    petekY,
    floors,
    corbelH: Math.max(1.1, r * (style === 'baroque' ? 0.9 : 1.05)),
    ext: r * (style === 'baroque' ? 0.42 : 0.48),
    alemH: Math.max(1.4, H * 0.042),
  };
}

/** Builds a minaret at (x, y, z) and returns its colliders (local building space). */
export function minaret(b: MeshBuilder, m: MinaretSpec, lod: LodLevel): LocalCollider[] {
  const L = layout(m);
  const style = m.style ?? 'classic';
  const y0 = m.y ?? 0;
  const facets = lod === 0 ? 16 : lod === 1 ? 8 : 6;
  const shaftMat = style === 'brick' ? Mat.Brick : Mat.Smooth;
  const stoneColor = m.color ?? b.s.color;
  const r = L.r;

  b.at(m.x, y0, m.z, 0, () => {
    const baseY = b.worldY(0, 0, 0);
    b.with({ color: stoneColor, light: Light.Facade, lightBase: baseY }, () => {
      // Square base block with plinth and cornice.
      const hw = L.baseW / 2;
      b.box(-hw - 0.15, -3, -hw - 0.15, hw + 0.15, 0.6, hw + 0.15, 'b');
      b.box(-hw, 0.6, -hw, hw, L.baseH, hw, 'b');
      if (lod === 0) {
        const c = Math.max(0.25, r * 0.16);
        b.sweep(
          [
            [-hw, -hw],
            [hw, -hw],
            [hw, hw],
            [-hw, hw],
          ],
          corniceProfile(c).map((v, k) => (k % 2 === 1 ? v + L.baseH - c * 0.5 : v)),
        );
      }
      // Pabuç: square -> polygon transition.
      const pabH = Math.max(1.2, r * 0.9);
      b.lathe([hw * 1.08, L.baseH, r * 1.12, L.baseH + pabH], { seg: facets, facets: true, phase: Math.PI / facets });
    });

    let yCur = L.baseH + Math.max(1.2, r * 0.9);
    let rCur = r;
    L.floors.forEach((floorY, k) => {
      const corbel0 = floorY - L.corbelH;
      b.with({ mat: shaftMat, color: stoneColor, light: Light.Minaret, lightBase: baseY, lightTop: baseY + floorY }, () => {
        b.lathe([rCur * 1.12, yCur, rCur, yCur + 0.5, rCur, corbel0], { seg: facets, facets: true, phase: Math.PI / facets });
        if (lod === 0 && style !== 'brick') {
          // thin moulding rings every few metres give the shaft its banded look
          for (let yy = yCur + 6; yy < corbel0 - 2; yy += Math.max(6, (corbel0 - yCur) / 3)) {
            b.lathe([rCur, yy, rCur * 1.03, yy + 0.08, rCur * 1.03, yy + 0.22, rCur, yy + 0.3], { seg: facets, facets: true, phase: Math.PI / facets });
          }
        }
      });
      serefe(b, L, rCur, corbel0, floorY, lod, style, stoneColor, baseY);
      yCur = floorY;
      rCur *= style === 'baroque' ? 0.97 : 0.955;
    });

    // Petek (drum above the top balcony) and cap.
    const pr = rCur * 0.93;
    b.with({ mat: shaftMat, color: stoneColor, light: Light.Minaret, lightBase: baseY + L.petekY - 6, lightTop: baseY + L.capY + 1 }, () => {
      b.lathe([pr, yCur, pr, L.capY - 0.5, pr * 1.12, L.capY - 0.3, pr * 1.12, L.capY], { seg: facets, facets: true, phase: Math.PI / facets });
    });
    const capR = pr * 1.18;
    b.with({ mat: Mat.Lead, light: Light.Cap, lightBase: baseY + L.capY - 0.5 }, () => {
      const capSeg = lod === 0 ? 20 : lod === 1 ? 8 : 6;
      b.lathe([pr * 1.1, L.capY, capR, L.capY], { seg: capSeg });
      if (style === 'baroque') {
        b.lathe([capR, L.capY, capR * 1.02, L.capY + 0.3, capR * 0.82, L.capY + (m.h - L.capY) * 0.25, capR * 0.3, L.capY + (m.h - L.capY) * 0.8, 0.02, m.h], {
          seg: capSeg,
          uvMode: 'sheets',
          sheets: 16,
        });
      } else {
        b.lathe([capR, L.capY, capR * 1.02, L.capY + 0.25, capR * 0.9, L.capY + 0.6, 0.02, m.h], {
          seg: capSeg,
          uvMode: 'sheets',
          sheets: 16,
          crease: 20,
        });
      }
    });
    b.at(0, m.h - 0.15, 0, 0, () => alem(b, L.alemH, lod));
  });

  const cols: LocalCollider[] = [
    { kind: 'box', cx: m.x, cy: y0 + L.baseH / 2, cz: m.z, hx: L.baseW / 2, hy: L.baseH / 2 + 0.3, hz: L.baseW / 2, yaw: 0 },
    { kind: 'cylinder', x: m.x, y: y0 + L.baseH, z: m.z, r: r * 1.15, h: m.h - L.baseH },
  ];
  for (const f of L.floors) {
    cols.push({ kind: 'cylinder', x: m.x, y: y0 + f - L.corbelH, z: m.z, r: r + L.ext + 0.2, h: L.corbelH + 1.3 });
  }
  return cols;
}

function serefe(
  b: MeshBuilder,
  L: Layout,
  r: number,
  y0: number,
  floorY: number,
  lod: LodLevel,
  style: MinaretStyle,
  color: readonly [number, number, number],
  baseY: number,
): void {
  const R = r + L.ext;
  const seg = lod === 0 ? 24 : lod === 1 ? 10 : 6;
  b.with({ mat: Mat.Smooth, color, light: Light.Minaret, lightBase: baseY, lightTop: baseY + floorY }, () => {
    if (style === 'baroque') {
      // Bell-shaped capital: concave flare.
      const prof: number[] = [];
      const n = lod === 0 ? 8 : 3;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        prof.push(r + (R - r) * Math.pow(t, 2.2), y0 + (floorY - y0) * t);
      }
      b.lathe(prof, { seg, crease: 60 });
    } else if (lod === 0) {
      // Muqarnas corbel: stepped tiers of alternating niches.
      const tiers = 4;
      const th = (floorY - y0) / tiers;
      const niches = 16;
      for (let t = 0; t < tiers; t++) {
        const ra = r + ((R - r) * t) / tiers;
        const rb = r + ((R - r) * (t + 1)) / tiers;
        muqarnasTier(b, ra, rb, y0 + t * th, y0 + (t + 1) * th, niches, t % 2 === 1);
      }
    } else {
      b.lathe([r, y0, R * 0.98, floorY - 0.05], { seg });
    }
  });
  // Balcony slab, lamp ring and carved parapet.
  const slabT = Math.max(0.22, r * 0.1);
  const parH = style === 'baroque' ? 1.0 : 1.1;
  const parT = 0.14;
  b.with({ mat: Mat.Smooth, color, light: Light.Minaret, lightBase: baseY, lightTop: baseY + floorY + 0.6 }, () => {
    b.lathe([R, floorY - 0.02, R + 0.12, floorY + 0.02, R + 0.12, floorY + slabT, R + 0.05, floorY + slabT], { seg });
  });
  b.with({ mat: Mat.Lamp, light: Light.Lamp, ao: 1 }, () => {
    b.lathe([R + 0.125, floorY + slabT * 0.3, R + 0.125, floorY + slabT * 0.8], { seg });
    b.lathe([R + 0.075, floorY + slabT + parH - 0.26, R + 0.075, floorY + slabT + parH - 0.06], { seg });
  });
  b.with({ mat: lod === 0 ? Mat.Carved : Mat.Smooth, color, light: Light.Minaret, lightBase: baseY + floorY - 8, lightTop: baseY + floorY + parH + 1.5 }, () => {
    b.lathe(
      [
        R + 0.05,
        floorY + slabT,
        R + 0.05,
        floorY + slabT + parH,
        R - parT,
        floorY + slabT + parH + 0.04,
        R - parT,
        floorY + slabT + 0.1,
        r * 0.97,
        floorY + slabT + 0.05,
      ],
      { seg, crease: 30 },
    );
  });
}

/** One muqarnas tier: a zig-zag ring whose inner points stay at ra and outer points reach rb (niche hoods). */
function muqarnasTier(b: MeshBuilder, ra: number, rb: number, y0: number, y1: number, niches: number, offset: boolean): void {
  const n = niches * 2;
  const ph = offset ? Math.PI / niches : 0;
  // vertical niche faces (zig-zag prism) from y0 to y1 - hood, then sloped hoods to the next radius
  const hood = (y1 - y0) * 0.45;
  for (let i = 0; i < n; i++) {
    const a0 = ph + (i / n) * Math.PI * 2;
    const a1 = ph + ((i + 1) / n) * Math.PI * 2;
    const r0 = i % 2 === 0 ? ra * 0.95 : ra;
    const r1 = i % 2 === 0 ? ra : ra * 0.95;
    const p0: [number, number, number] = [r0 * Math.sin(a0), y0, r0 * Math.cos(a0)];
    const p1: [number, number, number] = [r1 * Math.sin(a1), y0, r1 * Math.cos(a1)];
    const p2: [number, number, number] = [r1 * Math.sin(a1), y1 - hood, r1 * Math.cos(a1)];
    const p3: [number, number, number] = [r0 * Math.sin(a0), y1 - hood, r0 * Math.cos(a0)];
    b.with({ ao: 0.75 }, () => b.quad(p0, p1, p2, p3));
    const q0: [number, number, number] = [rb * Math.sin(a1), y1, rb * Math.cos(a1)];
    const q1: [number, number, number] = [rb * Math.sin(a0), y1, rb * Math.cos(a0)];
    b.quad(p3, p2, q0, q1);
  }
}

/** Height of the minaret's top (including the alem) for bounds. */
export function minaretTop(m: MinaretSpec): number {
  return (m.y ?? 0) + m.h + layout(m).alemH;
}
