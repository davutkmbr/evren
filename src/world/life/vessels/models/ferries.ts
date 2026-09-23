import * as THREE from 'three';
import { createRng } from '../../../../core/math/noise';
import { Detail, Emit, MeshBuilder, surf, type SurfaceSpec } from '../../util/mesh-builder';
import type { P2 } from '../../util/path';
import { buildHull, HullShape } from '../hull';
import type { ModelOptions, NavLightDef } from '../model-types';
import {
  band,
  benchRow,
  bollards,
  crossedAnchors,
  crowd,
  flag,
  inflate,
  lifeRing,
  mast,
  PAL,
  planform,
  prism,
  raftCanister,
  railing,
  rect,
  S,
  sheerBand,
  slab,
  tyreFender,
  windowsOnPolygon,
} from '../parts';

export interface BuiltModel {
  geometry: THREE.BufferGeometry;
  lights: NavLightDef[];
  airDraft: number;
}

/** Şehir Hatları livery (sRGB): white hull and houses, ochre sheer stripe and masts, black rubbing belt. */
const SH = {
  white: 0xeeede7,
  ochre: 0xd88a1c,
  mast: 0xd99a22,
  black: 0x17181a,
  roof: 0xb4b8b3,
  deck: 0x8e8b82,
  emblem: 0xa3172a,
  ring: 0xe8521f,
  bench: 0x6a4a32,
  flagRed: 0xc8102e,
} as const;

/** Solid bulwark / wall strip along a polyline, following the base height y0(p) continuously (no steps). */
export function wallStrip(b: MeshBuilder, pts: readonly P2[], y0: (p: P2) => number, h: number | ((p: P2) => number), t: number, s: SurfaceSpec): void {
  const hAt = (p: P2): number => (typeof h === 'number' ? h : h(p));
  const n = pts.length;
  if (n < 2) return;
  // Per-vertex horizontal normal (averaged) so neighbouring segments share their corners.
  const nx: number[] = [];
  const nz: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(i - 1, 0)];
    const c = pts[Math.min(i + 1, n - 1)];
    const tx = c.x - a.x;
    const tz = c.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    nx.push(tz / l);
    nz.push(-tx / l);
  }
  const v = (i: number, side: number, top: boolean): THREE.Vector3 =>
    new THREE.Vector3(pts[i].x + nx[i] * side * t * 0.5, y0(pts[i]) + (top ? hAt(pts[i]) : 0), pts[i].z + nz[i] * side * t * 0.5);
  for (let i = 0; i < n - 1; i++) {
    for (const side of [1, -1]) {
      const f = new THREE.Vector3(nx[i] + nx[i + 1], 0, nz[i] + nz[i + 1]).multiplyScalar(side);
      b.quadFacing(v(i, side, false), v(i + 1, side, false), v(i + 1, side, true), v(i, side, true), f, s);
    }
    b.quadFacing(v(i, 1, true), v(i + 1, 1, true), v(i + 1, -1, true), v(i, -1, true), new THREE.Vector3(0, 1, 0), s);
  }
  // End caps.
  for (const i of [0, n - 1]) {
    const q = pts[i === 0 ? 1 : n - 2];
    const f = new THREE.Vector3(pts[i].x - q.x, 0, pts[i].z - q.z);
    b.quadFacing(v(i, 1, false), v(i, -1, false), v(i, -1, true), v(i, 1, true), f, s);
  }
}

export function edgeLine(shape: HullShape, z0: number, z1: number, n: number, side: number, inset = 0): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    out.push({ x: side * Math.max(shape.deckHalfBreadthAtZ(z) - inset, 0.05), z });
  }
  return out;
}

/** Life rings along both sides of a deck edge between z0 and z1. */
function ringsAlong(b: MeshBuilder, hb: (z: number) => number, z0: number, z1: number, y: number, pitch: number, inset: number): void {
  const ring = surf(SH.ring, { roughness: 0.55 });
  for (let z = z0; z <= z1; z += pitch) {
    const x = hb(z) - inset;
    lifeRing(b, x + 0.08, y, z, 0, ring, 8);
    lifeRing(b, -(x + 0.08), y, z, Math.PI, ring, 8);
  }
}

/** Anchor lying in its hawse on the bow flare (both sides). */
function bowAnchors(b: MeshBuilder, x: number, y: number, z: number, size: number): void {
  const dark = surf(0x151515, { roughness: 0.5, metalness: 0.5 });
  for (const s of [-1, 1]) {
    b.pushTRS(s * x, y, z, 0, 0, s * 0.18);
    b.box(s * 0.05, 0, 0, 0.12, size * 1.1, size * 0.18, dark);
    b.box(s * 0.05, -size * 0.5, 0, 0.14, size * 0.18, size * 0.85, dark);
    b.pop();
    b.cylinder(s * (x - 0.05), y + size * 0.62, z, size * 0.22, size * 0.22, 0.12, 8, dark, true);
  }
}

/**
 * Şehir Hatları vapur (after ŞH-Kadıköy / Paşabahçe, ~72 x 13 m): white hull flush with the main-deck saloon, black
 * rubbing belt and boot-top, ochre stripe along the upper-deck edge, enclosed upper saloon forward with an open benched
 * deck and awning aft, bridge forward on the boat deck, ochre masts fore and amidships, squat white funnel with ochre
 * bands, the red crossed-anchors emblem and a black cap; life rings along the rails, open stern deck.
 */
export function buildVapur(o: ModelOptions): BuiltModel {
  const b = new MeshBuilder();
  const near = o.lod === 0;
  const rng = createRng(0x7a9);
  const L = 72;
  const shape = new HullShape({
    length: L,
    beam: 13.2,
    depth: 4.7,
    draft: 3.1,
    sheerFwd: 0.9,
    sheerAft: 0.25,
    bowRake: 4.2,
    sternOverhang: 3.8,
    transom: 0,
    entrance: 0.3,
    run: 0.22,
    bowFullness: 1.9,
    bilge: 0.35,
    deadrise: 0.12,
    flare: 0.55,
    bulb: 0,
    camber: 0.1,
    roundStern: true,
  });
  buildHull(
    b,
    shape,
    {
      side: surf(0xffffff, { paint: 1, roughness: 0.42, metalness: 0.05, detail: Detail.Hull }),
      deck: surf(SH.deck, { roughness: 0.85, detail: Detail.Deck }),
    },
    near ? 34 : 14,
    near ? 7 : 4,
  );
  const hb = (z: number): number => shape.deckHalfBreadthAtZ(z);
  const white = surf(SH.white, { roughness: 0.5, detail: Detail.Super });
  const ochre = surf(SH.ochre, { roughness: 0.5, detail: Detail.Super });
  const mastS = surf(SH.mast, { roughness: 0.5 });
  const black = surf(SH.black, { roughness: 0.65 });
  const roof = surf(SH.roof, { roughness: 0.8, detail: Detail.Deck });
  const glassCabin = S.glass(Emit.Cabin);
  const glassCrew = S.glass(Emit.Crew);
  const n = near ? 20 : 8;
  const yMain = 1.55;
  const yUpper = 4.55;
  const yBoat = 7.3;

  // Rubbing belt around the hull at main-deck level.
  const belt = planform(-L / 2 + 1.2, L / 2 - 0.6, (z) => hb(z) + 0.26, near ? 28 : 10);
  prism(b, belt, 1.2, 0.42, black, black, black, 50);

  // Main-deck saloon, flush with the hull side, with its row of windows.
  const main = planform(-27.5, 25.5, (z) => hb(z) - 0.03, n);
  prism(b, main, yMain, yUpper - yMain, white, null);
  windowsOnPolygon(
    b,
    main,
    yMain,
    near ? { surf: glassCabin, sill: 0.85, height: 1.3, width: 1.2, pitch: 1.5, margin: 0.6 } : { surf: glassCabin, sill: 0.85, height: 1.25, width: 1, pitch: 1, band: true, minEdge: 3, margin: 0.8 },
    (nn) => Math.abs(nn.x) > 0.5,
  );

  // Forecastle: solid bow up to upper-deck level, bulwark on top, stripe at the edge.
  const fc = planform(-L / 2 + 0.05, -27.3, (z) => hb(z), near ? 10 : 5, 0.08);
  prism(b, fc, yMain, yUpper - yMain, white, surf(0x7d7b74, { roughness: 0.85, detail: Detail.Deck }));
  const bw = (side: number): P2[] => edgeLine(shape, -L / 2 + 0.3, -27.5, near ? 8 : 4, side, 0.05);
  // The sheer rises towards the stem.
  const rise = (p: P2): number => 0.95 + 0.85 * Math.pow(THREE.MathUtils.clamp((-27.5 - p.z) / 8.2, 0, 1), 2);
  wallStrip(b, bw(1), () => yUpper, rise, 0.12, white);
  wallStrip(b, bw(-1), () => yUpper, rise, 0.12, white);
  band(b, fc, yUpper - 0.3, 0.3, ochre, 0.03);

  // Upper deck plate: its rim is the ochre stripe.
  const upperDeck = planform(-27.6, 33.2, (z) => hb(z) + 0.1, near ? 24 : 10);
  slab(b, upperDeck, yUpper + 0.26, 0.3, surf(SH.deck, { roughness: 0.85, detail: Detail.Deck }), ochre, white);

  // Upper saloon (forward 60 %).
  const upper = planform(-24.5, 6.5, (z) => hb(z) - 0.55, n);
  const yU = yUpper + 0.26;
  prism(b, upper, yU, yBoat - yU, white, null);
  windowsOnPolygon(
    b,
    upper,
    yU,
    near ? { surf: glassCabin, sill: 0.7, height: 1.2, width: 1.35, pitch: 1.75, margin: 0.4 } : { surf: glassCabin, sill: 0.7, height: 1.15, width: 1, pitch: 1, band: true, minEdge: 3 },
  );
  const boat = inflate(upper, 0.3);
  slab(b, boat, yBoat + 0.2, 0.22, roof, white, white);

  // Awning over the open aft upper deck.
  const awning = planform(6.5, 28.5, (z) => hb(z) - 0.45, near ? 10 : 4);
  slab(b, awning, yBoat + 0.12, 0.14, roof, white, white);

  // Bridge on the boat deck with windows all round (except aft) and a visor.
  const yB = yBoat + 0.2;
  const bridge = rect(0, -20.5, 10.8, 5.6);
  prism(b, bridge, yB, 2.55, white, null);
  windowsOnPolygon(b, bridge, yB, { surf: glassCrew, sill: 1.05, height: 1.15, width: near ? 1.05 : 10, pitch: near ? 1.22 : 10.3, margin: 0.25 }, (nn) => nn.z < 0.5);
  slab(b, inflate(bridge, 0.35), yB + 2.75, 0.2, roof, white, white);
  b.block(0, yB + 2.3, -23.45, 10.9, 0.25, 0.4, black, 1 | 2 | 4 | 32);
  // Wing platforms.
  b.block(0, yB, -18.6, 13.4, 0.12, 1.6, white);

  // Funnel: ochre base, white band with the emblem, ochre ring and black cap.
  const fz = -4.5;
  const frx = 1.75;
  const frz = 2.7;
  const seg = near ? 18 : 10;
  b.cylinder(0, yB, fz, frx, frx * 0.97, 1.3, seg, ochre, false, false, 1, frz / frx);
  b.cylinder(0, yB + 1.3, fz, frx * 0.97, frx * 0.93, 2.1, seg, surf(SH.white, { roughness: 0.45, detail: Detail.Super }), false, false, 1, frz / frx);
  b.cylinder(0, yB + 3.4, fz, frx * 0.93, frx * 0.92, 0.4, seg, ochre, false, false, 1, frz / frx);
  b.cylinder(0, yB + 3.8, fz, frx * 0.92, frx * 0.9, 0.45, seg, black, true, false, 1, frz / frx);
  if (near) {
    const red = surf(SH.emblem, { roughness: 0.5 });
    crossedAnchors(b, frx * 0.94 + 0.03, yB + 2.3, fz, 0, 1.45, red);
    crossedAnchors(b, -(frx * 0.94 + 0.03), yB + 2.3, fz, Math.PI, 1.45, red);
  }

  // Masts: ochre main mast behind the bridge (radar, yards), foremast on the forecastle.
  const mz = -9.9;
  b.block(0, yB, mz, 1.3, 1.6, 1.3, mastS);
  const mainTop = mast(b, 0, yB + 1.6, mz, 10.2, 0.19, mastS, 0, -2);
  if (near) {
    b.box(0, yB + 8.2, mz + 0.3, 3.9, 0.14, 0.14, mastS);
    b.box(0, yB + 9.6, mz + 0.35, 2.4, 0.12, 0.12, mastS);
    b.box(0, yB + 5.2, mz + 0.2, 1.8, 0.1, 1.4, mastS);
    b.box(0, yB + 5.55, mz + 0.2, 2.5, 0.16, 0.34, surf(0x2a2c2e, { roughness: 0.5, metalness: 0.4 }));
    b.cylinder(0.85, yB + 3.0, mz + 0.2, 0.28, 0.28, 0.5, 8, white, true);
  }
  const foreTop = mast(b, 0, yUpper, -31.8, 11.5, 0.14, mastS, near ? 1.6 : 0, -3);

  // Stern flag staff with the Turkish ensign; a small flag at the main masthead.
  const flagRed = surf(SH.flagRed, { roughness: 0.8, detail: Detail.Fabric });
  if (near) {
    flag(b, 0, yUpper + 0.26, 33.0, 3.4, 1.5, surf(0xdddddd, { roughness: 0.5 }), flagRed, Math.PI);
    flag(b, 0.2, mainTop.y - 0.4, mainTop.z + 0.3, 1.0, 0.9, mastS, flagRed, Math.PI);
    // Stays from the main masthead to the foremast and the stern staff.
    const stay = surf(0x6d6f70, { roughness: 0.5, metalness: 0.6 });
    b.tube(mainTop, foreTop, 0.025, 3, stay);
    b.tube(mainTop, new THREE.Vector3(0, yUpper + 3.5, 33), 0.025, 3, stay);
    b.tube(foreTop, new THREE.Vector3(0, yUpper + 0.8, -35.2), 0.025, 3, stay);
  }

  if (near) {
    const rail = surf(0xf0efe9, { roughness: 0.45 });
    // Upper deck rail (open aft part and walkways) with life rings; boat deck rail.
    railing(b, edgeLine(shape, -27, 33, 26, 1, -0.05), yU, rail, 1.05, 1.5);
    railing(b, edgeLine(shape, -27, 33, 26, -1, -0.05), yU, rail, 1.05, 1.5);
    railing(b, [{ x: -hb(33) - 0.05, z: 33.1 }, { x: hb(33) + 0.05, z: 33.1 }], yU, rail, 1.05, 1.5);
    ringsAlong(b, hb, 7.5, 32, yU + 0.72, 2.3, -0.05);
    ringsAlong(b, hb, -26, -2, yU + 0.72, 3.6, -0.05);
    railing(b, boat.filter((_, i) => i % 1 === 0), yBoat + 0.2, rail, 1.0, 1.8, true);
    // Open stern on the main deck: bulwark rail, bollards, pillars under the upper deck.
    railing(b, edgeLine(shape, 25.5, 35.6, 6, 1, 0.15), yMain + 0.05, rail, 1.0, 1.4);
    railing(b, edgeLine(shape, 25.5, 35.6, 6, -1, 0.15), yMain + 0.05, rail, 1.0, 1.4);
    for (const z of [27.5, 31]) {
      for (const s of [-1, 1]) b.cylinder(s * (hb(z) - 0.5), yMain, z, 0.1, 0.1, yUpper - yMain, 6, white, false);
    }
    bollards(b, 3.4, yMain, 30, black);
    bollards(b, -3.4, yMain, 30, black);
    bollards(b, 2.2, yUpper, -30, black);
    bollards(b, -2.2, yUpper, -30, black);
    b.block(0, yUpper, -33.2, 2.4, 0.75, 1.3, surf(0x3b3d40, { roughness: 0.5, metalness: 0.5 }));
    // Benches and passengers on the open upper deck; a few on the stern.
    const bench = surf(SH.bench, { roughness: 0.75, detail: Detail.Wood });
    for (let z = 8.5; z <= 30.5; z += 1.6) {
      const hw = hb(z) - 1.3;
      if (hw < 1.2) continue;
      benchRow(b, -hw, -0.6, z, yU, bench, 1);
      benchRow(b, 0.6, hw, z, yU, bench, 1);
    }
    crowd(b, -hb(18) + 1.2, hb(18) - 1.2, 8.5, 30, yU, 26, rng, true);
    crowd(b, -hb(20) + 0.8, hb(20) - 0.8, 7, 31, yU, 8, rng);
    crowd(b, -4, 4, 27, 34, yMain, 7, rng);
    // Life-raft canisters and two rescue boats on the boat deck.
    const raft = surf(0xf3f1ea, { roughness: 0.5 });
    for (let z = -13; z <= 4; z += 3.4) {
      if (Math.abs(z - fz) < 3) continue;
      raftCanister(b, hb(z) - 1.4, yBoat + 0.62, z, raft);
      raftCanister(b, -(hb(z) - 1.4), yBoat + 0.62, z, raft);
    }
    const rescue = surf(SH.ring, { roughness: 0.5 });
    for (const s of [-1, 1]) {
      b.ellipsoid(s * (hb(3) - 1.6), yBoat + 1.0, 2.5, 0.85, 0.45, 2.3, 10, 4, rescue);
      b.box(s * (hb(3) - 1.6), yBoat + 0.7, 1.2, 0.12, 0.9, 0.12, white);
      b.box(s * (hb(3) - 1.6), yBoat + 0.7, 3.8, 0.12, 0.9, 0.12, white);
    }
    // Ventilators, searchlight and horn on the bridge roof, deck lamps under the eaves and the awning.
    for (const [x, z] of [
      [2.8, -9],
      [-2.8, -9],
      [2.4, 1.5],
      [-2.4, 1.5],
    ]) {
      b.cylinder(x, yBoat + 0.2, z, 0.28, 0.28, 1.0, 8, white, true);
    }
    b.cylinder(-1.8, yB + 2.95, -21.5, 0.24, 0.24, 0.35, 8, surf(PAL.greyDark, { roughness: 0.4, metalness: 0.6 }), true);
    b.cylinder(1.8, yB + 2.95, -21.5, 0.24, 0.24, 0.35, 8, surf(PAL.greyDark, { roughness: 0.4, metalness: 0.6 }), true);
    for (let z = -22; z <= 5; z += 5.4) {
      b.box(hb(z) - 0.75, yBoat - 0.05, z, 0.28, 0.1, 0.28, S.lamp());
      b.box(-(hb(z) - 0.75), yBoat - 0.05, z, 0.28, 0.1, 0.28, S.lamp());
    }
    for (let z = 9; z <= 27; z += 4.5) {
      b.box(2.5, yBoat, z, 0.28, 0.1, 0.28, S.lamp());
      b.box(-2.5, yBoat, z, 0.28, 0.1, 0.28, S.lamp());
    }
    for (let z = 26; z <= 34; z += 4) b.box(0, yUpper - 0.02, z, 0.3, 0.1, 0.3, S.lamp());
    bowAnchors(b, hb(-32.8) + 0.08, 3.3, -32.8, 0.85);
  }

  const lights: NavLightDef[] = [
    { kind: 'mast', x: mainTop.x, y: mainTop.y - 0.2, z: mainTop.z },
    { kind: 'mast', x: foreTop.x, y: foreTop.y - 0.2, z: foreTop.z },
    { kind: 'port', x: -6.6, y: yB + 1.6, z: -18.6 },
    { kind: 'stbd', x: 6.6, y: yB + 1.6, z: -18.6 },
    { kind: 'stern', x: 0, y: yUpper + 1.2, z: 33.4 },
    { kind: 'anchor', x: 0, y: yUpper + 3.2, z: 33 },
    { kind: 'deck', x: 0, y: yBoat - 0.2, z: 18 },
    { kind: 'deck', x: 0, y: yUpper - 0.2, z: 30 },
  ];
  return { geometry: b.build(), lights, airDraft: mainTop.y + 0.4 };
}

/**
 * ŞH-Küçüksu class double-ended ferry (41.7 x 9.6 m, 2015): symmetric hull and houses with panoramic windows, open
 * ends on both decks, a wheelhouse at each end of the top deck and an ochre mast amidships. Built mirror-symmetric in z
 * so the vessel can reverse its direction at a pier by simply swapping bow and stern.
 */
export function buildDoubleEnder(o: ModelOptions): BuiltModel {
  const b = new MeshBuilder();
  const near = o.lod === 0;
  const rng = createRng(0x51c);
  const L = 41.7;
  const shape = new HullShape({
    length: L,
    beam: 9.6,
    depth: 3.5,
    draft: 2.0,
    sheerFwd: 0.55,
    sheerAft: 0.55,
    bowRake: 2.4,
    sternOverhang: 2.4,
    transom: 0,
    entrance: 0.3,
    run: 0.3,
    bowFullness: 1.8,
    bilge: 0.35,
    deadrise: 0.15,
    flare: 0.45,
    bulb: 0,
    camber: 0.08,
    doubleEnded: true,
  });
  buildHull(b, shape, { side: surf(0xffffff, { paint: 1, roughness: 0.42, metalness: 0.05, detail: Detail.Hull }), deck: surf(SH.deck, { roughness: 0.85, detail: Detail.Deck }) }, near ? 26 : 12, near ? 6 : 4);
  const hb = (z: number): number => shape.deckHalfBreadthAtZ(z);
  const white = surf(SH.white, { roughness: 0.5, detail: Detail.Super });
  const ochre = surf(SH.ochre, { roughness: 0.5, detail: Detail.Super });
  const black = surf(SH.black, { roughness: 0.65 });
  const roof = surf(SH.roof, { roughness: 0.8, detail: Detail.Deck });
  const mastS = surf(SH.mast, { roughness: 0.5 });
  const glassCabin = S.glass(Emit.Cabin);
  const glassCrew = S.glass(Emit.Crew);
  const n = near ? 14 : 6;
  const yMain = 1.5;
  const yUpper = 4.35;
  const yTop = 6.95;

  prism(b, planform(-L / 2 + 0.8, L / 2 - 0.8, (z) => hb(z) + 0.24, near ? 22 : 10), 1.15, 0.38, black, black, black, 50);
  const main = planform(-15.5, 15.5, (z) => hb(z) - 0.03, n);
  prism(b, main, yMain, yUpper - yMain, white, null);
  windowsOnPolygon(b, main, yMain, near ? { surf: glassCabin, sill: 0.8, height: 1.45, width: 1.7, pitch: 2.0, margin: 0.5 } : { surf: glassCabin, sill: 0.8, height: 1.4, width: 1, pitch: 1, band: true, minEdge: 3 }, (nn) => Math.abs(nn.x) > 0.5);
  // Ends: bulwark around the open main deck.
  for (const e of [-1, 1]) {
    const z0 = e * 15.5;
    const z1 = e * (L / 2 - 0.2);
    for (const side of [-1, 1]) wallStrip(b, edgeLine(shape, Math.min(z0, z1), Math.max(z0, z1), near ? 6 : 3, side, 0.05), (p) => shape.deckYAtZ(p.z) - 0.05, 1.05, 0.12, white);
  }
  const upperDeck = planform(-19.8, 19.8, (z) => hb(z) + 0.08, near ? 18 : 8);
  slab(b, upperDeck, yUpper + 0.25, 0.28, surf(SH.deck, { roughness: 0.85, detail: Detail.Deck }), ochre, white);
  for (const e of [-1, 1]) {
    for (const s of [-1, 1]) b.cylinder(s * (hb(e * 17.5) - 0.6), shape.deckYAtZ(e * 17.5), e * 17.5, 0.1, 0.1, yUpper - shape.deckYAtZ(e * 17.5), 6, white, false);
  }
  const yU = yUpper + 0.25;
  const upper = planform(-10, 10, (z) => hb(z) - 0.5, n);
  prism(b, upper, yU, yTop - yU, white, null);
  windowsOnPolygon(b, upper, yU, near ? { surf: glassCabin, sill: 0.55, height: 1.45, width: 1.75, pitch: 2.0, margin: 0.4 } : { surf: glassCabin, sill: 0.55, height: 1.4, width: 1, pitch: 1, band: true, minEdge: 2.5 });
  slab(b, inflate(upper, 0.25), yTop + 0.2, 0.2, roof, white, white);
  // Wheelhouses at both ends of the top deck.
  const yW = yTop + 0.2;
  for (const e of [-1, 1]) {
    const wh = rect(0, e * 7.6, 6.2, 3.0);
    prism(b, wh, yW, 2.3, white, null);
    windowsOnPolygon(b, wh, yW, { surf: glassCrew, sill: 0.95, height: 1.1, width: near ? 1.0 : 5.8, pitch: near ? 1.18 : 6, margin: 0.2 }, (nn) => nn.z * e > -0.5);
    slab(b, inflate(wh, 0.3), yW + 2.5, 0.18, roof, white, white);
    b.block(0, yW + 2.05, e * 9.15, 6.3, 0.22, 0.35, black, 1 | 2 | 4 | 16 | 32);
  }
  // Mast amidships with radar; two slim exhaust stacks.
  const mt = mast(b, 0, yW, 0, 8.8, 0.16, mastS, near ? 2.6 : 0);
  for (const s of [-1, 1]) {
    b.cylinder(s * 2.1, yW, 0, 0.55, 0.52, 1.0, near ? 12 : 8, ochre, false);
    b.cylinder(s * 2.1, yW + 1.0, 0, 0.52, 0.5, 1.5, near ? 12 : 8, white, false);
    b.cylinder(s * 2.1, yW + 2.5, 0, 0.5, 0.49, 0.35, near ? 12 : 8, black, true);
  }
  if (near) {
    b.box(0, yW + 5.4, 0, 1.9, 0.14, 0.32, surf(0x2a2c2e, { roughness: 0.5, metalness: 0.4 }));
    const rail = surf(0xf0efe9, { roughness: 0.45 });
    railing(b, edgeLine(shape, -19.6, 19.6, 18, 1, -0.05), yU, rail, 1.05, 1.5);
    railing(b, edgeLine(shape, -19.6, 19.6, 18, -1, -0.05), yU, rail, 1.05, 1.5);
    ringsAlong(b, hb, -19, -11, yU + 0.72, 2.4, -0.05);
    ringsAlong(b, hb, 11.5, 19.5, yU + 0.72, 2.4, -0.05);
    const bench = surf(SH.bench, { roughness: 0.75, detail: Detail.Wood });
    for (const e of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const z = e * (11.5 + k * 1.6);
        const hw = hb(z) - 1.2;
        if (hw < 1) continue;
        benchRow(b, -hw, hw, z, yU, bench, e);
      }
      crowd(b, -hb(e * 14) + 1, hb(e * 14) - 1, Math.min(e * 11, e * 17.5), Math.max(e * 11, e * 17.5), yU, 7, rng);
      crowd(b, -2.5, 2.5, Math.min(e * 16, e * 19), Math.max(e * 16, e * 19), shape.deckYAtZ(e * 17), 4, rng);
      bollards(b, 2.4, shape.deckYAtZ(e * 18.5), e * 18.5, black);
      bollards(b, -2.4, shape.deckYAtZ(e * 18.5), e * 18.5, black);
      flag(b, 0, yW + 2.7, e * 7.6, 1.4, 0.8, surf(0xdddddd, { roughness: 0.5 }), surf(SH.flagRed, { roughness: 0.8, detail: Detail.Fabric }), e > 0 ? Math.PI : 0);
    }
    const raft = surf(0xf3f1ea, { roughness: 0.5 });
    for (const z of [-4.5, 4.5]) {
      raftCanister(b, hb(z) - 1.3, yTop + 0.62, z, raft);
      raftCanister(b, -(hb(z) - 1.3), yTop + 0.62, z, raft);
    }
    for (let z = -9; z <= 9; z += 4.5) {
      b.box(hb(z) - 0.7, yTop - 0.05, z, 0.26, 0.1, 0.26, S.lamp());
      b.box(-(hb(z) - 0.7), yTop - 0.05, z, 0.26, 0.1, 0.26, S.lamp());
    }
    for (const e of [-1, 1]) b.box(0, yUpper - 0.02, e * 17.5, 0.3, 0.1, 0.3, S.lamp());
  }
  const lights: NavLightDef[] = [
    { kind: 'mast', x: mt.x, y: mt.y - 0.2, z: mt.z },
    { kind: 'port', x: -3.3, y: yW + 1.6, z: -7.6 },
    { kind: 'stbd', x: 3.3, y: yW + 1.6, z: -7.6 },
    { kind: 'stern', x: 0, y: yU + 1.1, z: 19.6 },
    { kind: 'anchor', x: 0, y: mt.y - 1.2, z: 0.3 },
    { kind: 'deck', x: 0, y: yTop - 0.2, z: 0 },
  ];
  return { geometry: b.build(), lights, airDraft: mt.y + 0.3 };
}

/** İDO sea bus (Kvaerner-type fast catamaran, ~38.5 m): navy demihulls, white superstructure, dark window bands. */
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
  const red = surf(0xc0262c, { roughness: 0.4 });
  const glass = surf(0x10161d, { roughness: 0.06, emit: Emit.Cabin, detail: Detail.Glass });
  const noseHalf = (z: number, zf: number, half: number, taper: number): number => half * Math.sqrt(THREE.MathUtils.clamp((z - zf) / taper, 0.02, 1));
  const n = near ? 12 : 6;

  // Bridging structure (wet deck) with navy and red stripes.
  const cross = planform(-16.5, 19.2, (z) => noseHalf(z, -16.5, 5.6, 6), n);
  prism(b, cross, 1.15, 1.35, white, null, navy);
  band(b, cross, 1.5, 0.5, navy, 0.03);
  band(b, cross, 2.05, 0.12, red, 0.03);

  const cabin = planform(-14.8, 15.2, (z) => noseHalf(z, -14.8, 5.4, 6.5), n);
  prism(b, cabin, 2.5, 2.45, white, null);
  windowsOnPolygon(b, cabin, 2.5, { surf: glass, sill: 0.72, height: 1.15, width: 1, pitch: 1, band: true, minEdge: 1.2, margin: 0.25 });
  slab(b, inflate(cabin, 0.12), 5.0, 0.12, S.roof(0xc9ccca), white);

  const upper = planform(-9.5, 6.5, (z) => noseHalf(z, -9.5, 3.9, 4.5), n);
  prism(b, upper, 5.0, 2.1, white, null);
  windowsOnPolygon(b, upper, 5.0, { surf: glass, sill: 0.62, height: 1.05, width: 1, pitch: 1, band: true, minEdge: 1.0, margin: 0.2 });
  slab(b, inflate(upper, 0.2), 7.25, 0.15, S.roof(0xc9ccca), white);

  const mastSurf = surf(0xe6e6e2, { roughness: 0.4, metalness: 0.2 });
  b.block(0, 7.25, -3.5, 3.4, 0.9, 0.5, mastSurf);
  const mh = mast(b, 0, 8.1, -3.5, 2.8, 0.09, mastSurf, near ? 1.6 : 0);
  if (near) {
    b.cylinder(0, 8.15, -1.8, 0.45, 0.45, 0.35, 10, mastSurf, true);
    railing(b, [{ x: 5.2, z: 14 }, { x: 5.2, z: 19 }], 2.5, white, 1.0);
    railing(b, [{ x: -5.2, z: 14 }, { x: -5.2, z: 19 }], 2.5, white, 1.0);
    for (const s of [-1, 1]) {
      b.block(s * 4.15, 2.45, 17.8, 0.9, 0.5, 1.2, surf(PAL.greyDark, { roughness: 0.6 }));
      b.box(s * 5.0, 4.9, 12, 0.25, 0.1, 0.25, S.lamp());
    }
    flag(b, 0, 5.0, 18.4, 1.6, 0.8, surf(0xdddddd, { roughness: 0.5 }), surf(SH.flagRed, { roughness: 0.8, detail: Detail.Fabric }), Math.PI);
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

/**
 * Bosphorus excursion / private ferry (Turyol, Dentur style, ~30 m): white hull with an instance-coloured boot-top and
 * sheer stripe, black tyre fenders, windowed saloon, open upper deck with benches under a canopy, wheelhouse forward,
 * orange life rings along the rail.
 */
export function buildTourBoat(o: ModelOptions): BuiltModel {
  const b = new MeshBuilder();
  const near = o.lod === 0;
  const rng = createRng(0x70b);
  const shape = new HullShape({
    length: 30,
    beam: 7.2,
    depth: 3.0,
    draft: 1.6,
    sheerFwd: 0.9,
    sheerAft: 0.2,
    bowRake: 2.8,
    sternOverhang: 1.0,
    transom: 0.72,
    entrance: 0.36,
    run: 0.14,
    bowFullness: 1.6,
    bilge: 0.4,
    deadrise: 0.35,
    flare: 0.45,
    bulb: 0,
    camber: 0.08,
  });
  const hullWhite = surf(0xf1f0eb, { roughness: 0.4, metalness: 0.05, detail: Detail.Hull });
  buildHull(b, shape, { side: hullWhite, deck: surf(PAL.woodDeck, { roughness: 0.8, detail: Detail.Deck }), transom: hullWhite }, near ? 22 : 10, near ? 5 : 3);
  const hb = (z: number): number => shape.deckHalfBreadthAtZ(z);
  const white = surf(0xf2f1ec, { roughness: 0.5, detail: Detail.Super });
  const stripe = surf(0xffffff, { paint: 1, roughness: 0.45 });
  const glass = S.glass(Emit.Cabin);
  const n = near ? 12 : 5;
  const deckY = 1.4;
  // Boot-top and sheer stripe in the company colour (instance paint).
  const wlPoly = planform(-14.2, 14.6, (z) => shape.halfBreadth(shape.tAtZ(z), 0.62) + 0.01, near ? 16 : 8);
  band(b, wlPoly, -0.15, 0.6, stripe, 0.02);
  const deckAt = (z: number): number => shape.deckYAtZ(z);
  sheerBand(b, hb, deckAt, -14.6, 14.9, near ? 20 : 8, -0.42, 0.16, stripe, 0.012);
  sheerBand(b, hb, deckAt, -14.6, 14.9, near ? 20 : 8, -0.2, 0.07, surf(0x2b8a4a, { roughness: 0.45 }), 0.012);

  const saloon = planform(-9.5, 12, (z) => hb(z) - 0.2, n);
  prism(b, saloon, deckY, 2.4, white, null);
  windowsOnPolygon(b, saloon, deckY, near ? { surf: glass, sill: 0.75, height: 1.2, width: 1.25, pitch: 1.5 } : { surf: glass, sill: 0.75, height: 1.15, width: 1, pitch: 1, band: true, minEdge: 2.5 });
  const upperDeck = planform(-11.5, 14.4, (z) => hb(z) - 0.02, n);
  const yU = deckY + 2.6;
  slab(b, upperDeck, yU, 0.2, surf(0x9ea39f, { roughness: 0.85, detail: Detail.Deck }), white);
  const wh = rect(0, -8.4, 3.4, 2.8);
  prism(b, wh, yU, 2.05, white, null);
  windowsOnPolygon(b, wh, yU, { surf: S.glass(Emit.Crew), sill: 0.9, height: 0.9, width: near ? 0.9 : 3.1, pitch: near ? 1.05 : 3.2, margin: 0.15 });
  slab(b, inflate(wh, 0.2), yU + 2.2, 0.12, S.roof(), white);
  const canopyY = yU + 2.25;
  const canopy = planform(-6.6, 13.6, (z) => hb(z) - 0.15, n);
  slab(b, canopy, canopyY, 0.1, surf(0xf1efe8, { roughness: 0.85, detail: Detail.Fabric }), white, surf(0xe4e1d8, { roughness: 0.9 }));
  const mastSurf = surf(0xd8d6cf, { roughness: 0.5 });
  const mh = mast(b, 0, yU + 2.2, -8.4, 2.2, 0.06, mastSurf);
  if (near) {
    for (const z of [-5.5, -1, 3.5, 8, 12.8]) {
      for (const s of [-1, 1]) b.cylinder(s * (hb(z) - 0.3), yU, z, 0.05, 0.05, 2.25, 5, white, false);
    }
    const rail = surf(0xf0efe9, { roughness: 0.45 });
    const rl = edgeLine(shape, -11, 14.2, 12, 1, 0.08);
    railing(b, rl, yU, rail, 1.0);
    railing(b, rl.map((p) => ({ x: -p.x, z: p.z })), yU, rail, 1.0);
    const ring = surf(SH.ring, { roughness: 0.55 });
    for (let z = -5; z <= 13; z += 1.7) {
      lifeRing(b, hb(z) + 0.02, yU + 0.65, z, 0, ring, 8);
      lifeRing(b, -(hb(z) + 0.02), yU + 0.65, z, Math.PI, ring, 8);
    }
    const bench = surf(0x2c4f86, { roughness: 0.7 });
    for (let z = -4.5; z <= 12.5; z += 1.6) {
      const hw = hb(z) - 0.9;
      benchRow(b, -hw, -0.5, z, yU, bench, 1);
      benchRow(b, 0.5, hw, z, yU, bench, 1);
    }
    crowd(b, -hb(4) + 1, hb(4) - 1, -4, 12.5, yU, 18, rng, true);
    const tyre = surf(0x121212, { roughness: 0.9 });
    for (let z = -9; z <= 12; z += 3.5) {
      tyreFender(b, hb(z) + 0.2, 0.75, z, 0, 0.42, tyre);
      tyreFender(b, -(hb(z) + 0.2), 0.75, z, Math.PI, 0.42, tyre);
    }
    for (let z = -6; z <= 12; z += 4.5) {
      b.box(hb(z) - 0.5, canopyY - 0.1, z, 0.24, 0.08, 0.24, S.lamp());
      b.box(-(hb(z) - 0.5), canopyY - 0.1, z, 0.24, 0.08, 0.24, S.lamp());
    }
    flag(b, 0, canopyY, 13.2, 1.5, 0.9, surf(0xdddddd, { roughness: 0.5 }), surf(SH.flagRed, { roughness: 0.8, detail: Detail.Fabric }), Math.PI);
    b.box(0, deckY + 0.02, -12.5, 1.2, 0.08, 1.2, surf(0x3b3d40, { roughness: 0.5, metalness: 0.5 }));
  }
  const lights: NavLightDef[] = [
    { kind: 'mast', x: mh.x, y: mh.y, z: mh.z },
    { kind: 'port', x: -1.9, y: yU + 1.7, z: -8.4 },
    { kind: 'stbd', x: 1.9, y: yU + 1.7, z: -8.4 },
    { kind: 'stern', x: 0, y: yU + 1.0, z: 14.4 },
    { kind: 'anchor', x: 0, y: canopyY + 0.4, z: 10 },
    { kind: 'deck', x: 0, y: canopyY - 0.2, z: 3 },
  ];
  return { geometry: b.build(), lights, airDraft: canopyY + 1.6 };
}
