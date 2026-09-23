import type { MeshBuilder } from '../builder';
import { arcade } from '../parts/arcade';
import { corniceProfile, flatRoof, rectPath } from '../parts/details';
import { leadDome, windowDrum } from '../parts/dome';
import { minaret } from '../parts/minaret';
import { rowOpenings } from '../parts/wall';
import { Light, Mat, type LocalCollider, type LodLevel, type RGB } from '../types';
import { buildAyasofya } from './ayasofya';
import { boxFacades, type StyleResult } from './imperial';

export interface ByzantineSpec {
  style: 'byzantine';
  variant: 'ayasofya' | 'kucuk';
}

const OTTOMAN_STONE: RGB = [0.8, 0.76, 0.68];

function shiftCollider(c: LocalCollider, dz: number): LocalCollider {
  if (c.kind === 'box') {
    return { ...c, cz: c.cz + dz };
  }
  return { ...c, z: c.z + dz };
}

function buildKucukAyasofya(b: MeshBuilder, lod: LodLevel): StyleResult {
  const cols: LocalCollider[] = [];
  const w = 30;
  const d = 30;
  const h = 12.5;
  const brickStone: RGB = [0.78, 0.72, 0.62];
  b.set({ mat: Mat.Banded, color: brickStone, light: Light.Facade, lightBase: 0, ao: 1 });
  b.push();
  b.translate(0, 0, -3);
  b.with({ mat: Mat.Stone, ao: 0.85 }, () => b.box(-w / 2 - 2, -6, -d / 2 - 2, w / 2 + 2, 0.3, d / 2 + 9, 'b'));
  boxFacades(b, w, d, 0.3, h, lod, (_side, len) =>
    rowOpenings(len, { count: 4, sill: 2.4, h: 2.6, w: 1.6, arch: 'round', back: 'glass', glazing: 'clear', depth: 0.7 }, 2.5).concat(
      rowOpenings(len, { count: 4, sill: 7.6, h: 2.2, w: 1.5, arch: 'round', back: 'glass', glazing: 'clear', depth: 0.7 }, 2.5),
    ),
  );
  b.with({ mat: Mat.Stone }, () => b.sweep(rectPath(-w / 2, -d / 2, w / 2, d / 2), corniceProfile(0.45).map((v, k) => (k % 2 === 1 ? v + h - 0.2 : v))));
  flatRoof(b, -w / 2, -d / 2, w / 2, d / 2, h + 0.02, 1.2);
  // Octagonal drum and 16-lobed pumpkin dome.
  b.with({ mat: Mat.Banded }, () => windowDrum(b, { r: 10.2, y0: h + 0.6, y1: h + 4.4, windows: 8, lod, winFrac: 0.35, arch: 'round', glazing: 'clear', cornice: 0.4, phase: Math.PI / 8 }));
  leadDome(b, { r: 9.4, y: h + 4.6, rise: 5.2, lod, shape: 'pumpkin', lobes: 16, alem: 2.4 });
  cols.push({ kind: 'box', cx: 0, cy: h / 2, cz: -3, hx: w / 2, hy: h / 2, hz: d / 2, yaw: 0 });
  cols.push({ kind: 'cylinder', x: 0, y: h, z: -3, r: 10.2, h: 10 });
  // Ottoman portico and minaret.
  b.with({ mat: Mat.Stone, color: OTTOMAN_STONE }, () => {
    b.at(-w / 2 + 2, 0, d / 2 + 6, 0, () => arcade(b, { len: w - 4, bays: 5, depth: 5.6, colH: 4.6, roofH: 7.2, lod }));
    cols.push(...minaret(b, { x: w / 2 + 1.2, z: d / 2 - 1, h: 24, serefe: 1, r: 1.05, baseH: 7 }, lod).map((c) => shiftCollider(c, -3)));
  });
  b.pop();
  return { colliders: cols, radius: 28, height: 26 };
}

export function buildByzantine(b: MeshBuilder, s: ByzantineSpec, lod: LodLevel): StyleResult {
  return s.variant === 'ayasofya' ? buildAyasofya(b, lod) : buildKucukAyasofya(b, lod);
}

