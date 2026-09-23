import type { SkinAccumulator } from './buffers';

/**
 * Skin weights along a bone chain parametrized by arc length. Segment k spans [knots[k], knots[k+1]]
 * and is owned by bone owners[k]. Around every interior knot the two owners are cross-faded over
 * +-blend (clamped to half the neighbouring segment lengths) with a smooth Hermite ramp.
 */
export class ChainSkinner {
  private readonly halfWidths: number[];

  constructor(
    readonly knots: number[],
    readonly owners: number[],
    maxBlend: number | ((knotIndex: number) => number) = 0.5,
  ) {
    this.halfWidths = knots.map((_, k) => {
      if (k === 0 || k === knots.length - 1) {
        return 0;
      }
      const prev = knots[k] - knots[k - 1];
      const next = knots[k + 1] - knots[k];
      const limit = typeof maxBlend === 'function' ? maxBlend(k) : maxBlend;
      return Math.min(prev * 0.5, next * 0.5, limit);
    });
  }

  segmentAt(s: number): number {
    const k = this.knots;
    if (s <= k[0]) {
      return 0;
    }
    for (let i = 0; i < k.length - 1; i++) {
      if (s < k[i + 1]) {
        return i;
      }
    }
    return k.length - 2;
  }

  apply(s: number, acc: SkinAccumulator, scale = 1): void {
    const seg = this.segmentAt(s);
    const own = this.owners[seg];
    const start = this.knots[seg];
    const end = this.knots[seg + 1];
    let wOwn = 1;
    const w0 = this.halfWidths[seg];
    if (w0 > 0 && s - start < w0 && seg > 0) {
      const t = 0.5 + 0.5 * ((s - start) / w0);
      const h = t * t * (3 - 2 * t);
      acc.add(this.owners[seg - 1], (1 - h) * scale);
      wOwn = h;
    }
    const w1 = this.halfWidths[seg + 1];
    if (w1 > 0 && end - s < w1 && seg + 1 < this.owners.length) {
      const t = 0.5 + 0.5 * ((end - s) / w1);
      const h = t * t * (3 - 2 * t);
      acc.add(this.owners[seg + 1], (1 - h) * scale * wOwn);
      wOwn *= h;
    }
    acc.add(own, wOwn * scale);
  }
}
