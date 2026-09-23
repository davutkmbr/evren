/**
 * Viaduct piers: twin rectangular columns with rounded-chamfer corners and a cap beam under the girder, founded on
 * the terrain (or on the sea bed with a splash-zone footing when standing in water).
 */
import type { StructureBuild } from '../../build/context';
import type { BridgeFrame } from '../../build/bridge-frame';
import type { SurfaceState } from '../../build/mesh-builder';
import type { DeckSection } from './deck';

export interface PierOptions {
  /** Number of columns (1 = single wall pier). */
  columns?: number;
  /** Column size along the axis / across. */
  along?: number;
  across?: number;
}

export function buildPiers(
  b: StructureBuild,
  frame: BridgeFrame,
  section: DeckSection,
  height: (s: number) => number,
  surface: SurfaceState,
  stationList: readonly number[],
  opts: PierOptions = {},
): void {
  const piers: Array<{ s: number; ground: number; top: number }> = [];
  for (const s of stationList) {
    const top = height(s) - section.depth - 0.05;
    let ground = Infinity;
    for (const x of [-section.halfWidth * 0.5, 0, section.halfWidth * 0.5]) {
      const p = frame.point(s, x, 0);
      ground = Math.min(ground, b.ground(p.x, p.z));
    }
    if (top - ground < 3) {
      continue;
    }
    piers.push({ s, ground, top });
  }
  if (piers.length === 0) {
    return;
  }
  const columns = opts.columns ?? (section.halfWidth > 9 ? 2 : 1);
  const along = opts.along ?? 2.6;
  const across = opts.across ?? (columns === 1 ? section.halfWidth * 1.1 : 3.6);
  const colX = columns === 1 ? [0] : [-section.halfWidth * 0.52, section.halfWidth * 0.52];
  b.opaque(
    (mb, lod) => {
      for (const p of piers) {
        const capH = 2.2;
        const bottom = Math.min(p.ground, 0) - 1;
        const colTop = p.top - capH;
        mb.vBase = bottom;
        mb.surface(surface);
        for (const x of colX) {
          const c = frame.point(p.s, x, 0);
          const hA = along / 2;
          const hT = across / 2;
          if (lod === 0) {
            const ch = Math.min(0.45, hA * 0.3);
            const ring: Array<[number, number]> = [
              [hA, -hT + ch],
              [hA, hT - ch],
              [hA - ch, hT],
              [-hA + ch, hT],
              [-hA, hT - ch],
              [-hA, -hT + ch],
              [-hA + ch, -hT],
              [hA - ch, -hT],
            ].map(([a, t]) => {
              const q = frame.point(p.s + a, x + t, 0);
              return [q.x, q.z] as [number, number];
            });
            mb.prismRing(ring, bottom, colTop, 0, false, false);
          } else {
            mb.box(c.x, (bottom + colTop) / 2, c.z, hA, (colTop - bottom) / 2, hT, frame.yaw, true, true);
          }
          if (p.ground < 0.5 && lod === 0) {
            // footing / pile cap in the splash zone
            mb.box(c.x, 0.4, c.z, hA + 1.6, 1.4, hT + 1.6, frame.yaw, true, false);
          }
        }
        const cap = frame.point(p.s, 0, 0);
        mb.box(cap.x, colTop + capH / 2, cap.z, along / 2 + 0.3, capH / 2, section.halfWidth * 0.8, frame.yaw, false, false);
        mb.vBase = 0;
      }
    },
    { detailScale: 0.8 },
  );
  for (const p of piers) {
    for (const x of colX) {
      const c = frame.point(p.s, x, 0);
      const bottom = Math.min(p.ground, 0) - 1;
      b.boxCollider(c.x, (bottom + p.top) / 2, c.z, along / 2, (p.top - bottom) / 2, across / 2, frame.yaw);
    }
  }
}
