/**
 * Wall-mounted services as modules: the bundle of three cables clipped under the eaves of a street façade
 * (facade/build.ts streetWear), one slot per ~1.2 m span between two clips, sagging 2-5 cm (the variants differ in
 * the sag of each cable). Slot origin: the span's left clip on the upper cable's clip line; w = the span.
 */
import { lin } from '../facade/frame';
import type { AuthorCtx, FamilySpec, VariantSpec } from './spec';

const CABLE = lin(0x141414);

function cableBay(sags: [number, number, number]) {
  return (c: AuthorCtx): void => {
    const { b, w: W } = c;
    for (let q = 0; q < 3; q++) {
      const yq = -q * 0.035 - 0.012;
      const d0 = 0.03 + q * 0.012;
      const d1 = d0 + 0.015;
      const th = 0.018 + 0.008 * (q % 2);
      const m = W / 2;
      const sag = sags[q];
      for (const [ra, rb, ya, yb] of [
        [0, m, yq, yq - sag],
        [m, W, yq - sag, yq],
      ] as const) {
        b.quadF('fac_metal', 'N', [[ra, ya - th, d1], [rb, yb - th, d1], [rb, yb, d1], [ra, ya, d1]], CABLE);
        b.poly('fac_metal', b.f.dir('-Y'), [b.f.p(ra, ya - th, d0), b.f.p(rb, yb - th, d0), b.f.p(rb, yb - th, d1), b.f.p(ra, ya - th, d1)], CABLE);
      }
    }
  };
}

const SAGS: [number, number, number][] = [
  [0.025, 0.041, 0.033],
  [0.046, 0.022, 0.038],
  [0.031, 0.049, 0.024],
  [0.039, 0.028, 0.047],
];

export const WALL_FAMILIES: FamilySpec[] = [
  {
    name: 'wall.cables',
    doc: 'One span of the three cables clipped under the eaves, sagging between the clips (origin at the left clip).',
    variants: SAGS.map((s, k): VariantSpec => ({ id: `sag${k}`, ref: [1.2, 0, 0], author: cableBay(s) })),
  },
];
