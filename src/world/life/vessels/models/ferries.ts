import * as THREE from 'three';
import { Detail, Emit, MeshBuilder, surf } from '../../util/mesh-builder';
import type { P2 } from '../../util/path';
import { buildHull, HullShape } from '../hull';
import type { ModelOptions, NavLightDef } from '../model-types';
import { funnel, inflate, lifeboat, mast, PAL, planform, prism, railing, raftCanister, rect, S, slab, windowsOnPolygon, bollards } from '../parts';

export interface BuiltModel {
  geometry: THREE.BufferGeometry;
  lights: NavLightDef[];
  airDraft: number;
}

/** Solid bulwark / wall strip along a polyline. */
export function wallStrip(b: MeshBuilder, pts: readonly P2[], y0: (p: P2) => number, h: number, t: number, s: ReturnType<typeof S.superWhite>): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len < 0.02) continue;
    const yaw = Math.atan2(q.x - p.x, q.z - p.z);
    const ya = Math.min(y0(p), y0(q));
    b.pushTRS((p.x + q.x) / 2, ya, (p.z + q.z) / 2, yaw);
    b.box(0, h / 2, 0, t, h, len + t * 0.5, s, 63 & ~8);
    b.pop();
  }
}

function edgeLine(shape: HullShape, z0: number, z1: number, n: number, side: number, inset = 0): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    out.push({ x: side * Math.max(shape.deckHalfBreadthAtZ(z) - inset, 0.05), z });
  }
  return out;
}

/**
 * Şehir Hatları vapur (classic Bosphorus passenger ferry, ~72 m): white two-deck saloons with continuous windows,
 * black rubbing belt, wheelhouse forward on the boat deck, raked yellow funnel with a black top.
 */
export function buildVapur(o: ModelOptions): BuiltModel {
  const b = new MeshBuilder();
  const near = o.lod === 0;
  const L = 72;
  const shape = new HullShape({
    length: L,
    beam: 13,
    depth: 4.7,
    draft: 3.1,
    sheerFwd: 0.9,
    sheerAft: 0.5,
    bowRake: 3.8,
    sternOverhang: 4.5,
    transom: 0,
    entrance: 0.27,
    run: 0.2,
    bowFullness: 1.8,
    bilge: 0.32,
    deadrise: 0.15,
    flare: 0.45,
    bulb: 0,
    camber: 0.12,
    roundStern: true,
  });
  buildHull(
    b,
    shape,
    {
      side: surf(0xffffff, { paint: 1, roughness: 0.45, metalness: 0.05, detail: Detail.Hull }),
      deck: surf(PAL.woodDeck, { roughness: 0.8, detail: Detail.Deck }),
    },
    near ? 30 : 14,
    near ? 7 : 4,
  );
  const hb = (z: number): number => shape.deckHalfBreadthAtZ(z);
  const white = S.superWhite();
  const glassCabin = S.glass(Emit.Cabin);
  const glassCrew = S.glass(Emit.Crew);
  const roofGrey = S.roof(0xa7aca6);
  const dark = surf(PAL.black, { roughness: 0.7 });
  const n = near ? 16 : 7;

  // Rubbing belt (guard) around the hull at main-deck level.
  const guard = planform(-L / 2 + 0.9, L / 2 - 0.9, (z) => hb(z) + 0.32, near ? 24 : 10);
  prism(b, guard, 1.22, 0.42, dark, dark, dark);

  // Main saloon.
  const main = planform(-24, 25, (z) => hb(z) - 0.12, n);
  prism(b, main, 1.5, 2.72, white, null);
  windowsOnPolygon(b, main, 1.5, near ? { surf: glassCabin, sill: 1.3, height: 1.0, width: 1.05, pitch: 1.5 } : { surf: glassCabin, sill: 1.3, height: 1.0, width: 1, pitch: 1, band: true, minEdge: 3 });

  // Upper deck plate (overhanging), upper saloon, boat-deck roof.
  const upperDeck = planform(-30.5, 32, (z) => hb(z) + 0.22, near ? 20 : 8);
  slab(b, upperDeck, 4.45, 0.25, surf(0x9c9f9a, { roughness: 0.85, detail: Detail.Deck }), white, white);
  const upper = planform(-21, 13, (z) => hb(z) - 0.95, n);
  prism(b, upper, 4.45, 2.4, white, null);
  windowsOnPolygon(b, upper, 4.45, near ? { surf: glassCabin, sill: 0.75, height: 1.18, width: 1.25, pitch: 1.62 } : { surf: glassCabin, sill: 0.75, height: 1.15, width: 1, pitch: 1, band: true, minEdge: 3 });
  const roof = inflate(upper, 0.3);
  slab(b, roof, 7.05, 0.2, roofGrey, white, white);

  // Aft upper deck awning on posts.
  const awning = planform(13, 27, (z) => hb(z) - 0.6, near ? 8 : 4);
  slab(b, awning, 7.0, 0.14, roofGrey, white, white);
  if (near) {
    for (const z of [16.5, 20.5, 24.5]) {
      for (const s of [-1, 1]) b.cylinder(s * (hb(z) - 0.9), 4.45, z, 0.07, 0.07, 2.45, 5, white, false);
    }
  }

  // Wheelhouse with all-round windows + wings.
  const wh = rect(0, -18, 7.4, 5.2);
  prism(b, wh, 7.05, 2.35, white, null);
  windowsOnPolygon(b, wh, 7.05, { surf: glassCrew, sill: 1.0, height: 1.05, width: near ? 1.05 : 6.8, pitch: near ? 1.22 : 7, margin: 0.2 });
  slab(b, inflate(wh, 0.28), 9.55, 0.18, roofGrey, white, white);
  b.block(0, 7.05, -18.2, 12.2, 0.12, 2.4, white);

  // Funnel: raked, elliptical, yellow with black top.
  funnel(b, 0, 7.05, -2.5, 1.3, 2.2, 5.4, 7, surf(PAL.funnelYellow, { roughness: 0.45, detail: Detail.Super }), surf(PAL.black, { roughness: 0.6 }), 1.25, near ? 16 : 8);

  // Masts.
  const mastSurf = surf(0xd8d6cf, { roughness: 0.5 });
  const mh = mast(b, 0, 9.55, -18.5, 5.8, 0.12, mastSurf, near ? 2.6 : 0);
  mast(b, 0, 2.2, 34, 3.2, 0.06, mastSurf);

  if (near) {
    // Fore deck: bulwark, windlass, bollards.
    const bw = (side: number): P2[] => edgeLine(shape, -35.2, -24, 8, side, 0.08);
    wallStrip(b, bw(1), () => 2.0, 1.0, 0.1, white);
    wallStrip(b, bw(-1), () => 2.0, 1.0, 0.1, white);
    b.block(0, 2.0, -31, 2.6, 0.7, 1.2, dark);
    bollards(b, 2.6, 2.05, -27, dark);
    bollards(b, -2.6, 2.05, -27, dark);
    bollards(b, 3.2, 1.9, 29, dark);
    bollards(b, -3.2, 1.9, 29, dark);
    // Railings on the upper deck edge and around the boat deck.
    const railPts = edgeLine(shape, -30, 31.5, 22, 1, -0.2);
    railing(b, railPts, 4.45, white);
    railing(b, railPts.map((p) => ({ x: -p.x, z: p.z })), 4.45, white);
    railing(b, edgeLine(shape, 25.5, 35.5, 5, 1, 0.1), 1.95, white);
    railing(b, edgeLine(shape, 25.5, 35.5, 5, -1, 0.1), 1.95, white);
    // Life-raft canisters and lifeboats on the boat deck.
    const raft = surf(0xf1efe8, { roughness: 0.5 });
    for (let z = -12; z <= 9; z += 3.5) {
      raftCanister(b, hb(z) - 1.7, 7.45, z, raft);
      raftCanister(b, -(hb(z) - 1.7), 7.45, z, raft);
    }
    lifeboat(b, hb(6) - 2.2, 7.9, 6 + 3.5, 6.2, surf(0xf28a2e, { roughness: 0.5 }));
    lifeboat(b, -(hb(6) - 2.2), 7.9, 6 + 3.5, 6.2, surf(0xf28a2e, { roughness: 0.5 }));
    // Ventilator cowls.
    for (const [x, z] of [
      [2.2, 5],
      [-2.2, 5],
      [1.8, -9],
      [-1.8, -9],
    ]) {
      b.cylinder(x, 7.05, z, 0.3, 0.3, 1.1, 8, white, true);
    }
    // Deck lamps under the eaves (night).
    for (let z = -18; z <= 10; z += 7) {
      b.box(hb(z) - 0.75, 6.8, z, 0.3, 0.12, 0.3, S.lamp());
      b.box(-(hb(z) - 0.75), 6.8, z, 0.3, 0.12, 0.3, S.lamp());
    }
    // Searchlight on the wheelhouse roof.
    b.cylinder(0, 9.55, -20.1, 0.25, 0.25, 0.35, 8, surf(PAL.greyDark, { roughness: 0.4, metalness: 0.6 }), true);
  } else {
    const wallTop = edgeLine(shape, -35, -24, 4, 1, 0.08);
    wallStrip(b, wallTop, () => 2.0, 1.0, 0.1, white);
    wallStrip(b, wallTop.map((p) => ({ x: -p.x, z: p.z })), () => 2.0, 1.0, 0.1, white);
  }

  const lights: NavLightDef[] = [
    { kind: 'mast', x: mh.x, y: mh.y - 0.2, z: mh.z },
    { kind: 'port', x: -6.3, y: 8.6, z: -17 },
    { kind: 'stbd', x: 6.3, y: 8.6, z: -17 },
    { kind: 'stern', x: 0, y: 5.6, z: 35.6 },
    { kind: 'anchor', x: 0, y: 5.2, z: 36.5 },
    { kind: 'deck', x: 0, y: 7.4, z: 28 },
  ];
  return { geometry: b.build(), lights, airDraft: 15.4 };
}

/** İDO sea bus: aluminium catamaran (~39 m) with a dark window band and a blue stripe. */
export function buildSeabus(o: ModelOptions): BuiltModel {
  const b = new MeshBuilder();
  const near = o.lod === 0;
  const demi = new HullShape({
    length: 38.5,
    beam: 2.9,
    depth: 3.5,
    draft: 1.35,
    sheerFwd: 0.5,
    sheerAft: 0,
    bowRake: 3.2,
    sternOverhang: 0.2,
    transom: 0.85,
    entrance: 0.38,
    run: 0.06,
    bowFullness: 1.3,
    bilge: 0.5,
    deadrise: 0.65,
    flare: 0.25,
    bulb: 0,
    camber: 0,
  });
  const hullSurf = { side: surf(0xffffff, { paint: 1, roughness: 0.35, metalness: 0.2, detail: Detail.Hull }), deck: surf(PAL.greyLight, { roughness: 0.8 }) };
  for (const s of [-1, 1]) {
    b.pushTRS(s * 4.15, 0, 0);
    buildHull(b, demi, hullSurf, near ? 22 : 10, near ? 5 : 3);
    b.pop();
  }
  const white = surf(0xf2f2ef, { roughness: 0.35, metalness: 0.1, detail: Detail.Super });
  const navy = surf(PAL.navy, { roughness: 0.35, metalness: 0.1 });
  const glass = surf(0x10161d, { roughness: 0.06, emit: Emit.Cabin, detail: Detail.Glass });
  const noseHalf = (z: number, zf: number, half: number, taper: number): number => half * Math.sqrt(THREE.MathUtils.clamp((z - zf) / taper, 0.02, 1));
  const n = near ? 12 : 6;

  // Bridging structure (wet deck) with the navy stripe.
  const cross = planform(-16.5, 19.2, (z) => noseHalf(z, -16.5, 5.6, 6), n);
  prism(b, cross, 1.15, 1.35, white, null, navy);
  const stripe = inflate(cross, 0.03);
  prism(b, stripe, 1.55, 0.45, navy, null);

  // Main cabin with a continuous dark window band.
  const cabin = planform(-14.8, 15.2, (z) => noseHalf(z, -14.8, 5.4, 6.5), n);
  prism(b, cabin, 2.5, 2.45, white, null);
  windowsOnPolygon(b, cabin, 2.5, { surf: glass, sill: 0.72, height: 1.15, width: 1, pitch: 1, band: true, minEdge: 1.2, margin: 0.25 });
  slab(b, inflate(cabin, 0.12), 5.0, 0.12, S.roof(0xc9ccca), white);

  // Upper saloon / wheelhouse.
  const upper = planform(-9.5, 6.5, (z) => noseHalf(z, -9.5, 3.9, 4.5), n);
  prism(b, upper, 5.0, 2.1, white, null);
  windowsOnPolygon(b, upper, 5.0, { surf: glass, sill: 0.62, height: 1.05, width: 1, pitch: 1, band: true, minEdge: 1.0, margin: 0.2 });
  slab(b, inflate(upper, 0.2), 7.25, 0.15, S.roof(0xc9ccca), white);

  // Radar mast + radome.
  const mastSurf = surf(0xe6e6e2, { roughness: 0.4, metalness: 0.2 });
  b.block(0, 7.25, -3.5, 3.4, 0.9, 0.5, mastSurf);
  const mh = mast(b, 0, 8.1, -3.5, 2.8, 0.09, mastSurf, near ? 1.6 : 0);
  if (near) {
    b.cylinder(0, 8.15, -1.8, 0.45, 0.45, 0.35, 10, mastSurf, true);
    railing(b, edgeLine(demi, 14, 19, 3, 1, -3.9).map((p) => ({ x: 5.2, z: p.z })), 2.5, white, 1.0);
    railing(b, edgeLine(demi, 14, 19, 3, 1, -3.9).map((p) => ({ x: -5.2, z: p.z })), 2.5, white, 1.0);
    // Exhaust outlets and deck lamps.
    for (const s of [-1, 1]) {
      b.block(s * 4.15, 2.45, 17.8, 0.9, 0.5, 1.2, surf(PAL.greyDark, { roughness: 0.6 }));
      b.box(s * 5.0, 4.9, 12, 0.25, 0.1, 0.25, S.lamp());
    }
  }
  const lights: NavLightDef[] = [
    { kind: 'mast', x: mh.x, y: mh.y, z: mh.z },
    { kind: 'port', x: -4.1, y: 6.5, z: -8 },
    { kind: 'stbd', x: 4.1, y: 6.5, z: -8 },
    { kind: 'stern', x: 0, y: 4.6, z: 19.2 },
    { kind: 'anchor', x: 0, y: 7.5, z: 6 },
  ];
  return { geometry: b.build(), lights, airDraft: 11 };
}

/** Bosphorus excursion boat (~30 m): saloon with big windows, open upper deck under a canopy. */
export function buildTourBoat(o: ModelOptions): BuiltModel {
  const b = new MeshBuilder();
  const near = o.lod === 0;
  const shape = new HullShape({
    length: 30,
    beam: 7.2,
    depth: 3.0,
    draft: 1.6,
    sheerFwd: 0.8,
    sheerAft: 0.2,
    bowRake: 2.6,
    sternOverhang: 1.2,
    transom: 0.72,
    entrance: 0.34,
    run: 0.14,
    bowFullness: 1.6,
    bilge: 0.4,
    deadrise: 0.35,
    flare: 0.4,
    bulb: 0,
    camber: 0.08,
  });
  buildHull(b, shape, { side: S.hullPaint(), deck: surf(PAL.woodDeck, { roughness: 0.8, detail: Detail.Deck }) }, near ? 22 : 10, near ? 5 : 3);
  const hb = (z: number): number => shape.deckHalfBreadthAtZ(z);
  const white = S.superWhite();
  const glass = S.glass(Emit.Cabin);
  const n = near ? 10 : 5;
  const deckY = 1.35;
  const saloon = planform(-9.5, 11.5, (z) => hb(z) - 0.25, n);
  prism(b, saloon, deckY, 2.35, white, null);
  windowsOnPolygon(b, saloon, deckY, near ? { surf: glass, sill: 0.8, height: 1.15, width: 1.3, pitch: 1.6 } : { surf: glass, sill: 0.8, height: 1.1, width: 1, pitch: 1, band: true, minEdge: 2.5 });
  const upperDeck = planform(-11.5, 14.2, (z) => hb(z) - 0.05, n);
  slab(b, upperDeck, deckY + 2.55, 0.2, surf(0x9ea39f, { roughness: 0.85, detail: Detail.Deck }), white);
  // Small wheelhouse at the front of the upper deck.
  const wh = rect(0, -8.2, 3.2, 2.6);
  prism(b, wh, deckY + 2.55, 2.0, white, null);
  windowsOnPolygon(b, wh, deckY + 2.55, { surf: S.glass(Emit.Crew), sill: 0.9, height: 0.85, width: 2.9, pitch: 3, margin: 0.12, minEdge: 2.2 });
  slab(b, inflate(wh, 0.15), deckY + 4.7, 0.12, S.roof(), white);
  // Canopy on posts over the aft upper deck.
  const canopyY = deckY + 2.55 + 2.25;
  const canopy = planform(-6.2, 13.2, (z) => hb(z) - 0.2, n);
  slab(b, canopy, canopyY, 0.1, surf(0xe8e4d8, { roughness: 0.9, detail: Detail.Fabric }), surf(0x2a4f8f, { roughness: 0.8, detail: Detail.Fabric }), surf(0xe0dccf, { roughness: 0.9 }));
  const mastSurf = surf(0xd8d6cf, { roughness: 0.5 });
  const mh = mast(b, 0, canopyY, -4.5, 2.2, 0.06, mastSurf);
  if (near) {
    for (const z of [-5.5, -0.5, 4.5, 9.5, 12.8]) {
      for (const s of [-1, 1]) b.cylinder(s * (hb(z) - 0.45), deckY + 2.55, z, 0.05, 0.05, 2.25, 5, white, false);
    }
    const rail = edgeLine(shape, -11, 14, 12, 1, 0.1);
    railing(b, rail, deckY + 2.55, white, 1.0);
    railing(b, rail.map((p) => ({ x: -p.x, z: p.z })), deckY + 2.55, white, 1.0);
    // Rows of benches (dark blue) on the open deck.
    const bench = surf(0x28406e, { roughness: 0.7 });
    for (let z = -4; z <= 12; z += 1.6) {
      b.block(0, deckY + 2.55, z, hb(z) * 1.4, 0.45, 0.5, bench);
    }
    for (let z = -6; z <= 12; z += 4.5) {
      b.box(hb(z) - 0.6, canopyY - 0.18, z, 0.25, 0.08, 0.25, S.lamp());
      b.box(-(hb(z) - 0.6), canopyY - 0.18, z, 0.25, 0.08, 0.25, S.lamp());
    }
  }
  const lights: NavLightDef[] = [
    { kind: 'mast', x: mh.x, y: mh.y, z: mh.z },
    { kind: 'port', x: -1.8, y: deckY + 4.2, z: -8.2 },
    { kind: 'stbd', x: 1.8, y: deckY + 4.2, z: -8.2 },
    { kind: 'stern', x: 0, y: deckY + 3.2, z: 14.4 },
    { kind: 'anchor', x: 0, y: canopyY + 0.4, z: 10 },
  ];
  return { geometry: b.build(), lights, airDraft: canopyY + 2.4 };
}

export { edgeLine };
