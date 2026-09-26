/**
 * Core 'roadSurface' service built from the road decks the structures worker generated (DeckData): the exact road
 * surface profile of every bridge deck, including its approach viaducts, as drawn (crest curve, side-span ramps,
 * raised walkways, the twist of landed ends into the street ground).
 */
import type { RoadSurfaceService } from '../../../../core/contracts';
import { jointOffset } from '../build/deck-joint';
import type { DeckData } from '../types';

/** A published deck: carriageway centre line with per-point surface heights, plus its traffic lanes. */
export interface PublishedDeck {
  id: string;
  points: { x: number; y: number; z: number }[];
  /** Carriageway width (m). */
  width: number;
  /** Half width of the whole deck top (walkways included, m). */
  halfWidth: number;
  /**
   * Lane centres: lateral offset (m, right of the point order, relative to `points`) and travel direction
   * (+1 along the point order).
   */
  lanes: { x: number; dir: 1 | -1 }[];
}

interface DeckEntry {
  data: DeckData;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export class RoadSurface implements RoadSurfaceService {
  readonly decks: PublishedDeck[];
  private readonly entries: DeckEntry[];

  constructor(decks: readonly DeckData[]) {
    this.entries = decks.map((d) => {
      const s1 = d.s0 + d.step * (d.heights.length - 1);
      const xs: number[] = [];
      const zs: number[] = [];
      for (const s of [d.s0, s1]) {
        for (const l of [-d.halfWidth, d.halfWidth]) {
          xs.push(d.ox + d.ax * s - d.az * l);
          zs.push(d.oz + d.az * s + d.ax * l);
        }
      }
      return { data: d, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    });
    this.decks = decks.map((d) => {
      const c = (d.roadX0 + d.roadX1) / 2;
      const points: PublishedDeck['points'] = [];
      for (let i = 0; i < d.heights.length; i++) {
        const s = d.s0 + i * d.step;
        points.push({ x: d.ox + d.ax * s - d.az * c, y: d.heights[i] + jointOffset(d.joints, s, c), z: d.oz + d.az * s + d.ax * c });
      }
      return {
        id: d.id,
        points,
        width: d.roadX1 - d.roadX0,
        halfWidth: d.halfWidth,
        lanes: d.lanes.map((l) => ({ x: l.x - c, dir: l.dir })),
      };
    });
  }

  deckHeightAt(x: number, z: number): number | null {
    let best: number | null = null;
    for (const e of this.entries) {
      if (x < e.minX || x > e.maxX || z < e.minZ || z > e.maxZ) {
        continue;
      }
      const d = e.data;
      const dx = x - d.ox;
      const dz = z - d.oz;
      const l = -dx * d.az + dz * d.ax;
      if (Math.abs(l) > d.halfWidth) {
        continue;
      }
      const s = dx * d.ax + dz * d.az;
      const f = (s - d.s0) / d.step;
      const last = d.heights.length - 1;
      if (f < 0 || f > last) {
        continue;
      }
      const i = Math.min(Math.floor(f), last - 1);
      const t = f - i;
      let h = d.heights[i] + (d.heights[i + 1] - d.heights[i]) * t;
      let level = 0;
      for (let k = 0; k < d.raised.length; k += 3) {
        if (l >= d.raised[k] && l <= d.raised[k + 1]) {
          level = d.raised[k + 2];
          break;
        }
      }
      h += level + jointOffset(d.joints, s, l, level);
      if (best === null || h > best) {
        best = h;
      }
    }
    return best;
  }
}
