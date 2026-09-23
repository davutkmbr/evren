import * as THREE from 'three';
import { createRng } from '../../../../core/math/noise';
import { Detail, Emit, MeshBuilder, surf } from '../../util/mesh-builder';
import { buildHull, HullShape } from '../hull';
import type { ModelOptions, NavLightDef } from '../model-types';
import { band, flag, glassHouse, inflate, lifeRing, mast, PAL, planform, prism, railing, rect, roundRect, S, sheerBand, slab, tyreFender, windowsOnPolygon } from '../parts';
import { edgeLine, wallStrip, type BuiltModel } from './ferries';

const TR_RED = 0xc8102e;

/**
 * Bosphorus fishing boat (balıkçı teknesi, ~9.5 m), after the boats at Rumelikavağı and Sarıyer: white planked hull
 * with a rising sheer, a pastel sheer strake (instance paint) over a thin black rubbing strake, varnished cap rail, the
 * wheelhouse well aft with a window band and a door in its back, a lamp mast with a short derrick forward of it, the
 * net heaped midships under a faded canvas awning, tyre fenders and a small Turkish flag on the wheelhouse roof.
 */
export function buildFishingBoat(o: ModelOptions): BuiltModel {
  const b = new MeshBuilder();
  const near = o.lod === 0;
  const rng = createRng(0xf15);
  const shape = new HullShape({
    length: 9.5,
    beam: 3.2,
    depth: 1.5,
    draft: 0.8,
    sheerFwd: 0.7,
    sheerAft: 0.22,
    bowRake: 0.85,
    sternOverhang: 0.55,
    transom: 0,
    entrance: 0.4,
    run: 0.24,
    bowFullness: 1.55,
    bilge: 0.55,
    deadrise: 0.5,
    flare: 0.4,
    bulb: 0,
    camber: 0.06,
    roundStern: true,
  });
  const hullWhite = surf(0xeeebe2, { roughness: 0.6, detail: Detail.Wood });
  buildHull(b, shape, { side: hullWhite, deck: surf(0x8f7a60, { roughness: 0.85, detail: Detail.Deck }) }, near ? 20 : 8, near ? 6 : 3);
  const hb = (z: number): number => shape.deckHalfBreadthAtZ(z);
  const deckAt = (z: number): number => shape.deckYAtZ(z);
  const paint = surf(0xffffff, { paint: 1, roughness: 0.55, detail: Detail.Wood });
  const white = surf(0xf1eee6, { roughness: 0.6, detail: Detail.Super });
  const black = surf(0x17191b, { roughness: 0.6 });
  const varnish = surf(0x5c3f27, { roughness: 0.55, detail: Detail.Wood });
  const zb = -4.72;
  const zs = 4.7;
  // Pastel sheer strake with a black rubbing strake under it.
  sheerBand(b, hb, deckAt, zb + 0.1, zs - 0.1, near ? 16 : 6, -0.34, 0.3, paint, 0.012);
  sheerBand(b, hb, deckAt, zb + 0.15, zs - 0.15, near ? 16 : 6, -0.42, 0.08, black, 0.02);
  // Low bulwark with a varnished cap rail.
  for (const side of [-1, 1]) {
    const e = edgeLine(shape, zb + 0.12, zs - 0.12, near ? 14 : 5, side, 0.03);
    wallStrip(b, e, (p) => deckAt(p.z) - 0.02, 0.3, 0.06, white);
    if (near) wallStrip(b, e, (p) => deckAt(p.z) + 0.28, 0.06, 0.11, varnish);
  }
  // Wheelhouse well aft: white with a pastel waist band, windows all round except the door side.
  const whz = 2.35;
  const yd = deckAt(whz) - 0.04;
  const wh = roundRect(0, whz, 1.55, 1.75, 0.2, near ? 2 : 1);
  prism(b, wh, yd, 1.8, white, null, null, 50);
  band(b, wh, yd + 0.55, 0.14, paint, 0.012);
  windowsOnPolygon(b, wh, yd, { surf: S.glass(Emit.Crew), sill: 0.98, height: 0.55, width: 0.46, pitch: 0.56, margin: 0.1, minEdge: 0.6 }, (n) => n.z < 0.5);
  if (near) b.box(0.3, yd + 0.85, whz + 0.885, 0.55, 1.5, 0.03, surf(0x2b2d2f, { roughness: 0.6 }));
  slab(b, roundRect(0, whz - 0.05, 1.8, 2.05, 0.25, near ? 2 : 1), yd + 1.9, 0.09, surf(0xe6e3da, { roughness: 0.7 }), white);
  // Lamp mast forward of the wheelhouse with a short derrick, lamp on the roof for night fishing.
  const mh = mast(b, 0, deckAt(0.9), 0.9, 4.1, 0.055, varnish, 0);
  if (near) {
    b.tube(new THREE.Vector3(0, deckAt(0.9) + 0.9, 0.9), new THREE.Vector3(0.15, deckAt(-1.6) + 2.1, -1.8), 0.045, 5, varnish);
    b.tube(new THREE.Vector3(0, mh.y - 0.1, 0.9), new THREE.Vector3(0.15, deckAt(-1.6) + 2.1, -1.8), 0.012, 3, surf(0x6d6a63, { roughness: 0.6 }));
    b.box(0, mh.y - 0.55, 0.9, 0.6, 0.06, 0.06, varnish);
    // Lamp fixtures (lit through the light pool only while fishing).
    const fixture = surf(0xd9d6cc, { roughness: 0.35, metalness: 0.3 });
    b.box(0, mh.y - 0.62, 0.9, 0.34, 0.18, 0.28, fixture);
    b.box(0, yd + 2.02, whz - 0.5, 0.3, 0.16, 0.26, fixture);
    // Canvas awning over the working deck, on four stanchions.
    const cloth = surf([0xcbbfa9, 0x8fb2c4, 0xc79a8f][Math.floor(rng() * 3)], { roughness: 0.9, detail: Detail.Fabric });
    const ya = deckAt(0) + 1.95;
    for (const z of [-0.6, 1.35]) {
      for (const sx of [-1, 1]) b.cylinder(sx * (hb(z) - 0.15), deckAt(z), z, 0.025, 0.025, ya - deckAt(z), 4, varnish, false);
    }
    b.pushTRS(0, ya, 0.4, 0, 0.03);
    slab(b, roundRect(0, 0, hb(0.4) * 2 - 0.1, 2.3, 0.15, 1), 0.02, 0.03, cloth, cloth, cloth);
    b.pop();
    // Net heaped midships (orange monofilament over darker netting), a few floats and crates.
    const netA = surf([0xc4552a, 0x2e5b3a, 0xb24a2c][Math.floor(rng() * 3)], { roughness: 0.95, detail: Detail.Fabric });
    const netB = surf(0x39433d, { roughness: 0.95, detail: Detail.Fabric });
    b.ellipsoid(-0.15, deckAt(-0.6) + 0.1, -0.6, 0.95, 0.34, 1.1, 9, 4, netA);
    b.ellipsoid(0.35, deckAt(-1.4) + 0.08, -1.45, 0.6, 0.26, 0.7, 8, 3, netB);
    for (let k = 0; k < 5; k++) b.ellipsoid(-0.8 + k * 0.38, deckAt(-2.2) + 0.06, -2.15 + (k % 2) * 0.2, 0.09, 0.07, 0.13, 6, 3, surf(0xe9d64a, { roughness: 0.5 }));
    b.block(0.72, deckAt(3.7), 3.7, 0.5, 0.26, 0.38, surf(0x2a6fbe, { roughness: 0.6 }));
    b.block(-0.65, deckAt(3.6), 3.6, 0.5, 0.26, 0.38, surf(0xe4e1d6, { roughness: 0.6 }));
    b.ellipsoid(-0.95, deckAt(-3.1) + 0.2, -3.1, 0.18, 0.18, 0.18, 6, 4, surf(0xe8621c, { roughness: 0.6 }));
    // Stem head fitting and a line hauler on the rail.
    b.tube(new THREE.Vector3(0, deckAt(zb + 0.35), zb + 0.35), new THREE.Vector3(0, deckAt(zb + 0.3) + 0.5, zb + 0.1), 0.06, 5, varnish);
    b.cylinder(1.05, deckAt(-0.2), -0.2, 0.14, 0.14, 0.42, 8, surf(0x5a5f63, { roughness: 0.5, metalness: 0.6 }), true);
    flag(b, 0.55, yd + 1.94, whz + 0.6, 0.85, 0.42, varnish, surf(TR_RED, { roughness: 0.8, detail: Detail.Fabric }), Math.PI);
    const tyre = surf(0x121212, { roughness: 0.9 });
    for (const z of [-2.2, 0.6, 3.0]) {
      tyreFender(b, hb(z) + 0.08, deckAt(z) - 0.5, z, 0, 0.26, tyre, 7);
      tyreFender(b, -(hb(z) + 0.08), deckAt(z) - 0.5, z, Math.PI, 0.26, tyre, 7);
    }
  }
  const lights: NavLightDef[] = [
    { kind: 'mast', x: mh.x, y: mh.y - 0.1, z: mh.z },
    { kind: 'port', x: -0.8, y: yd + 1.5, z: whz - 0.9 },
    { kind: 'stbd', x: 0.8, y: yd + 1.5, z: whz - 0.9 },
    { kind: 'stern', x: 0, y: yd + 1.7, z: whz + 0.9 },
    { kind: 'anchor', x: mh.x, y: mh.y, z: mh.z },
    { kind: 'deck', x: 0, y: mh.y - 0.7, z: 0.9 },
  ];
  return { geometry: b.build(), lights, airDraft: mh.y };
}

/**
 * Purse seiner (gırgır, ~28 m): high flared bow, two-tier house forward with a wheelhouse on top, tall mast with
 * lamps, coloured boom and power block over the net pile (under a tarp) aft, skiff on the stern, tyre fenders.
 */
export function buildSeiner(o: ModelOptions): BuiltModel {
  const b = new MeshBuilder();
  const near = o.lod === 0;
  const shape = new HullShape({
    length: 28,
    beam: 7.6,
    depth: 3.6,
    draft: 2.4,
    sheerFwd: 1.8,
    sheerAft: 0.3,
    bowRake: 2.6,
    sternOverhang: 1.6,
    transom: 0.6,
    entrance: 0.34,
    run: 0.2,
    bowFullness: 1.7,
    bilge: 0.35,
    deadrise: 0.35,
    flare: 0.6,
    bulb: 0,
    camber: 0.1,
  });
  buildHull(b, shape, { side: S.hullPaint(), deck: surf(0x6e6b62, { roughness: 0.8, detail: Detail.Deck }) }, near ? 22 : 10, near ? 6 : 3);
  const hb = (z: number): number => shape.deckHalfBreadthAtZ(z);
  const white = S.superWhite();
  const trim = surf(0xffffff, { paint: 1, roughness: 0.5, detail: Detail.Super });
  const yd = 1.2;
  for (const side of [-1, 1]) {
    wallStrip(b, edgeLine(shape, -13.6, 13.6, near ? 14 : 5, side, 0.06), (p) => shape.deckYAtZ(p.z) - 0.05, 1.0, 0.1, S.hullPaint());
    wallStrip(b, edgeLine(shape, -13.6, 13.6, near ? 14 : 5, side, 0.06), (p) => shape.deckYAtZ(p.z) + 0.95, 0.12, 0.14, white);
  }
  const house = planform(-10, -2.5, (z) => hb(z) - 0.6, near ? 6 : 3);
  prism(b, house, yd, 2.4, white, null);
  windowsOnPolygon(b, house, yd, { surf: S.glass(Emit.Crew), sill: 1.1, height: 0.75, width: 0.8, pitch: 1.35 });
  band(b, house, yd + 2.25, 0.15, trim, 0.02);
  const deck2 = planform(-9.6, -3.2, (z) => hb(z) - 1.0, near ? 5 : 3);
  prism(b, deck2, yd + 2.4, 2.1, white, null);
  windowsOnPolygon(b, deck2, yd + 2.4, { surf: S.glass(Emit.Crew), sill: 0.9, height: 0.8, width: 0.75, pitch: 1.1 });
  const wh = rect(0, -7.4, 4.2, 2.8);
  prism(b, wh, yd + 4.5, 2.0, white, null);
  windowsOnPolygon(b, wh, yd + 4.5, { surf: S.glass(Emit.Crew), sill: 0.85, height: 0.9, width: 0.85, pitch: 1.0, margin: 0.12 });
  slab(b, inflate(wh, 0.25), yd + 6.6, 0.12, S.roof(), trim);
  const mastSurf = surf(0xd4d2ca, { roughness: 0.5 });
  const mh = mast(b, 0, yd + 6.6, -7.2, 6.8, 0.15, mastSurf, near ? 2.6 : 0);
  // Net-hauling boom (company colour) raked aft over the net pile, power block at its head.
  const boom = S.accent();
  b.tube(new THREE.Vector3(0, yd + 2.5, -2.2), new THREE.Vector3(0, yd + 10.2, 8.4), 0.22, near ? 6 : 4, boom);
  b.cylinder(0, yd, -2.2, 0.35, 0.3, 2.6, near ? 8 : 5, boom, true);
  // Black rubbing line along the sheer.
  sheerBand(b, hb, (z) => shape.deckYAtZ(z), -13.4, 13.4, near ? 16 : 6, -0.3, 0.14, surf(0x17191b, { roughness: 0.6 }), 0.02);
  // Net pile under a tarp and a skiff on the stern ramp.
  b.ellipsoid(0.3, yd + 0.5, 7.2, 2.7, 1.0, 4.4, near ? 10 : 6, near ? 5 : 3, surf(0x283530, { roughness: 0.95, detail: Detail.Fabric }));
  b.ellipsoid(0.3, yd + 0.85, 7.0, 2.4, 0.75, 3.6, near ? 10 : 6, near ? 4 : 3, surf(0xe9ece8, { roughness: 0.85, detail: Detail.Fabric }));
  b.ellipsoid(0, yd + 1.4, 12.2, 1.1, 0.55, 2.3, near ? 8 : 5, 3, surf(0x2a6fbe, { roughness: 0.6 }));
  if (near) {
    b.pushTRS(0, yd + 9.9, 8.4, 0, 0, Math.PI / 2);
    b.cylinder(0, -0.25, 0, 0.6, 0.6, 0.5, 12, surf(PAL.greyDark, { roughness: 0.5, metalness: 0.4 }), true, true);
    b.pop();
    b.tube(new THREE.Vector3(0, yd + 9.6, 8.4), new THREE.Vector3(0.3, yd + 1.6, 7.6), 0.03, 3, surf(0x6d6a63, { roughness: 0.6 }));
    for (const y of [3.6, 5.2]) b.box(0, yd + 6.6 + y, -7.0, 1.6, 0.12, 0.25, S.lamp());
    b.box(0, yd + 4.3, -9.2, 0.3, 0.2, 0.3, S.lamp());
    railing(b, rect(0, -7.4, 4.6, 3.2), yd + 6.72, white, 0.8, 1.2, true);
    const tyre = surf(0x121212, { roughness: 0.9 });
    for (let z = -8; z <= 10; z += 4.5) {
      tyreFender(b, hb(z) + 0.2, shape.deckYAtZ(z) - 0.6, z, 0, 0.5, tyre, 8);
      tyreFender(b, -(hb(z) + 0.2), shape.deckYAtZ(z) - 0.6, z, Math.PI, 0.5, tyre, 8);
    }
    const ring = surf(0xe8521f, { roughness: 0.55 });
    lifeRing(b, hb(-6) - 0.55, yd + 3.4, -6, 0, ring);
    lifeRing(b, -(hb(-6) - 0.55), yd + 3.4, -6, Math.PI, ring);
    flag(b, 0, shape.deckYAtZ(13.5) + 0.9, 13.4, 2.0, 0.9, mastSurf, surf(TR_RED, { roughness: 0.8, detail: Detail.Fabric }), Math.PI);
  }
  const lights: NavLightDef[] = [
    { kind: 'mast', x: mh.x, y: mh.y, z: mh.z },
    { kind: 'port', x: -2.3, y: yd + 5.8, z: -7.4 },
    { kind: 'stbd', x: 2.3, y: yd + 5.8, z: -7.4 },
    { kind: 'stern', x: 0, y: yd + 1.4, z: 13.8 },
    { kind: 'anchor', x: mh.x, y: mh.y - 1, z: mh.z },
    { kind: 'deck', x: 0, y: yd + 10.4, z: -7 },
    { kind: 'deck', x: 0, y: yd + 8.8, z: -7 },
  ];
  return { geometry: b.build(), lights, airDraft: mh.y };
}

/**
 * Small motorboat / water taxi (~8.5 m): deep-V planing hull with a coloured bottom band (instance paint), cuddy cabin
 * with a raked windscreen, cockpit seats, bow rail and twin outboards.
 */
export function buildMotorboat(o: ModelOptions): BuiltModel {
  const b = new MeshBuilder();
  const near = o.lod === 0;
  const shape = new HullShape({
    length: 8.5,
    beam: 2.8,
    depth: 1.35,
    draft: 0.55,
    sheerFwd: 0.35,
    sheerAft: 0,
    bowRake: 1.4,
    sternOverhang: 0.05,
    transom: 0.9,
    entrance: 0.5,
    run: 0.04,
    bowFullness: 1.35,
    bilge: 0.55,
    deadrise: 0.75,
    flare: 0.55,
    bulb: 0,
    camber: 0.06,
  });
  const white = surf(0xf6f6f3, { roughness: 0.2, detail: Detail.Paint });
  buildHull(b, shape, { side: white, deck: surf(0xe8e4da, { roughness: 0.55 }), transom: white }, near ? 16 : 8, near ? 5 : 3);
  const hb = (z: number): number => shape.deckHalfBreadthAtZ(z);
  const paint = surf(0xffffff, { paint: 1, roughness: 0.25, detail: Detail.Paint });
  const wl = planform(-3.4, 4.25, (z) => shape.halfBreadth(shape.tAtZ(z), 0.6) + 0.012, near ? 12 : 6);
  band(b, wl, -0.2, 0.62, paint, 0.012);
  const sheer = planform(-3.9, 4.25, (z) => hb(z) + 0.01, near ? 12 : 6);
  band(b, sheer, shape.deckYAtZ(0) - 0.18, 0.08, paint, 0.005);
  const yd = shape.deckYAtZ(0);
  const cabin = planform(-2.6, 0.3, (z) => (hb(z) - 0.2) * (0.55 + 0.45 * THREE.MathUtils.clamp((z + 2.6) / 2, 0, 1)), near ? 6 : 3);
  prism(b, cabin, yd - 0.05, 0.5, white, white);
  // Raked windscreen.
  const glass = surf(0x0f151b, { roughness: 0.05, emit: Emit.Crew, detail: Detail.Glass });
  b.pushTRS(0, yd + 0.45, 0.35, 0, -0.75);
  b.box(0, 0.25, 0, 2.1, 0.55, 0.04, glass);
  b.pop();
  // Cockpit seats and console, outboards on the transom.
  b.block(0, yd - 0.3, 2.7, 2.0, 0.55, 1.1, surf(0xe7e1d4, { roughness: 0.7, detail: Detail.Fabric }));
  b.block(0.55, yd - 0.3, 1.2, 0.6, 0.9, 0.5, white);
  const motor = surf(0x1d1f22, { roughness: 0.4, metalness: 0.3 });
  for (const x of [-0.45, 0.45]) {
    b.block(x, yd - 0.35, 4.45, 0.42, 0.75, 0.55, motor);
    b.box(x, yd - 0.75, 4.5, 0.12, 0.8, 0.2, motor);
  }
  if (near) {
    const rail = surf(0xcfd3d6, { roughness: 0.2, metalness: 0.9 });
    railing(b, edgeLine(shape, -4.0, -2.2, 4, 1, 0.1), shape.deckYAtZ(-3.2), rail, 0.6);
    railing(b, edgeLine(shape, -4.0, -2.2, 4, -1, 0.1), shape.deckYAtZ(-3.2), rail, 0.6);
    b.tube(new THREE.Vector3(-1.0, yd + 0.3, 1.9), new THREE.Vector3(-1.0, yd + 1.6, 2.4), 0.03, 4, rail);
    b.tube(new THREE.Vector3(1.0, yd + 0.3, 1.9), new THREE.Vector3(1.0, yd + 1.6, 2.4), 0.03, 4, rail);
    b.block(0, yd + 1.6, 2.6, 2.1, 0.05, 1.5, surf(0x1f3f75, { roughness: 0.85, detail: Detail.Fabric }));
    flag(b, 0.3, yd, 4.3, 1.1, 0.45, rail, surf(TR_RED, { roughness: 0.8, detail: Detail.Fabric }), Math.PI);
  }
  const lights: NavLightDef[] = [
    { kind: 'mast', x: -1.0, y: yd + 1.75, z: 2.4 },
    { kind: 'port', x: -0.3, y: shape.deckYAtZ(-3.6) + 0.1, z: -3.7 },
    { kind: 'stbd', x: 0.3, y: shape.deckYAtZ(-3.6) + 0.1, z: -3.7 },
    { kind: 'stern', x: 0, y: yd + 0.2, z: 4.3 },
    { kind: 'anchor', x: -1.0, y: yd + 1.75, z: 2.4 },
  ];
  return { geometry: b.build(), lights, airDraft: yd + 1.8 };
}

/** Motor yacht (~24 m): fine bow, dark window bands, flybridge with a radar arch. */
export function buildYacht(o: ModelOptions): BuiltModel {
  const b = new MeshBuilder();
  const near = o.lod === 0;
  const shape = new HullShape({
    length: 24,
    beam: 6.0,
    depth: 3.1,
    draft: 1.6,
    sheerFwd: 0.9,
    sheerAft: 0,
    bowRake: 3.4,
    sternOverhang: 0.6,
    transom: 0.92,
    entrance: 0.45,
    run: 0.05,
    bowFullness: 1.35,
    bilge: 0.5,
    deadrise: 0.6,
    flare: 0.6,
    bulb: 0,
    camber: 0.05,
  });
  buildHull(b, shape, { side: surf(0xffffff, { paint: 1, roughness: 0.18, metalness: 0.05, detail: Detail.Paint }), deck: surf(0xb89a72, { roughness: 0.6, detail: Detail.Deck }) }, near ? 22 : 10, near ? 6 : 3);
  const hb = (z: number): number => shape.deckHalfBreadthAtZ(z);
  const white = surf(0xf4f4f1, { roughness: 0.2, metalness: 0.05, detail: Detail.Paint });
  const glass = surf(0x0d1116, { roughness: 0.04, emit: Emit.Crew, detail: Detail.Glass });
  const deck = 1.5;
  // Main deckhouse: low vertical skirt, then a window band sloping inwards (sleek motor-yacht profile).
  const mainHouse = planform(-6.5, 8.5, (z) => (hb(z) - 0.55) * (z < -3 ? 0.72 + (0.28 * (z + 6.5)) / 3.5 : 1), near ? 10 : 5);
  const houseTop = glassHouse(b, mainHouse, deck, 0.75, 1.3, -0.3, white, glass, white, near);
  // Dark hull window band for the lower-deck cabins.
  const hullBand = planform(-6, 6, (z) => hb(z) + 0.01, near ? 8 : 4);
  windowsOnPolygon(b, hullBand, 0, { surf: glass, sill: 0.6, height: 0.35, width: 1, pitch: 1, band: true, minEdge: 3, margin: 0.8 }, (n) => Math.abs(n.x) > 0.8);
  slab(b, inflate(houseTop, 0.35), deck + 2.2, 0.16, surf(0xf4f4f1, { roughness: 0.3 }), white);
  // Flybridge: low windscreen forward, helm, sun pad.
  const fly = planform(-2.6, 6.5, (z) => hb(z) - 1.4, near ? 6 : 3);
  const flyTop = glassHouse(b, fly, deck + 2.2, 0.55, 0.35, -0.08, white, surf(0x1a2229, { roughness: 0.05, detail: Detail.Glass }), white, false);
  slab(b, inflate(flyTop, 0.02), deck + 3.13, 0.04, surf(0xcfc6b8, { roughness: 0.6, detail: Detail.Fabric }), white);
  // Radar arch: two raked legs and a cross beam (tubes), radar and domes on top.
  const archSurf = surf(0xf4f4f1, { roughness: 0.25, metalness: 0.1 });
  const legZ0 = 4.2;
  for (const sx of [-1, 1]) b.tube(new THREE.Vector3(sx * 1.55, deck + 3.1, legZ0), new THREE.Vector3(sx * 1.25, deck + 4.9, legZ0 - 0.9), 0.14, near ? 6 : 4, archSurf);
  b.tube(new THREE.Vector3(-1.3, deck + 4.9, legZ0 - 0.9), new THREE.Vector3(1.3, deck + 4.9, legZ0 - 0.9), 0.15, near ? 6 : 4, archSurf);
  const mh = new THREE.Vector3(0, deck + 5.3, 3.3);
  if (near) {
    b.box(0, deck + 5.08, 3.3, 1.4, 0.1, 0.3, surf(0x2a2c2e, { roughness: 0.5, metalness: 0.4 }));
    b.cylinder(0.75, deck + 5.0, 3.3, 0.25, 0.22, 0.25, 10, white, true);
    const rail = surf(0xcfd3d6, { roughness: 0.2, metalness: 0.9 });
    railing(b, edgeLine(shape, -11.5, -6.8, 5, 1, 0.15), shape.deckYAtZ(-9), rail, 0.8);
    railing(b, edgeLine(shape, -11.5, -6.8, 5, -1, 0.15), shape.deckYAtZ(-9), rail, 0.8);
    b.block(0, deck, -8.5, 2.2, 0.35, 2.4, surf(0xe8e2d6, { roughness: 0.8, detail: Detail.Fabric }));
  }
  const lights: NavLightDef[] = [
    { kind: 'mast', x: 0, y: mh.y, z: mh.z },
    { kind: 'port', x: -(hb(-4) - 0.5), y: deck + 2.1, z: -4.5 },
    { kind: 'stbd', x: hb(-4) - 0.5, y: deck + 2.1, z: -4.5 },
    { kind: 'stern', x: 0, y: deck + 0.3, z: 12 },
    { kind: 'anchor', x: 0, y: mh.y, z: mh.z },
    { kind: 'deck', x: 0, y: deck + 2.3, z: 9.5 },
  ];
  return { geometry: b.build(), lights, airDraft: mh.y };
}

/** Sailing yacht (~13 m) under engine: tall mast, furled mainsail under a blue cover. */
export function buildSailboat(o: ModelOptions): BuiltModel {
  const b = new MeshBuilder();
  const near = o.lod === 0;
  const shape = new HullShape({
    length: 13,
    beam: 4.1,
    depth: 2.0,
    draft: 0.8,
    sheerFwd: 0.35,
    sheerAft: 0.1,
    bowRake: 1.2,
    sternOverhang: 0.9,
    transom: 0.8,
    entrance: 0.45,
    run: 0.1,
    bowFullness: 1.4,
    bilge: 0.55,
    deadrise: 0.55,
    flare: 0.2,
    bulb: 0,
    camber: 0.08,
  });
  buildHull(b, shape, { side: surf(0xffffff, { paint: 1, roughness: 0.2, detail: Detail.Paint }), deck: surf(0xe9e6de, { roughness: 0.6 }) }, near ? 18 : 8, near ? 5 : 3);
  const white = surf(0xf2f1ec, { roughness: 0.3 });
  const cabin = planform(-2.2, 2.6, (z) => 1.3 - Math.max(0, -z - 1) * 0.25, near ? 6 : 3);
  prism(b, cabin, 1.1, 0.55, white, surf(0xeceae4, { roughness: 0.5 }));
  windowsOnPolygon(b, cabin, 1.1, { surf: surf(0x10151a, { roughness: 0.05, emit: Emit.Crew, detail: Detail.Glass }), sill: 0.18, height: 0.22, width: 1, pitch: 1, band: true, minEdge: 1.2, margin: 0.3 }, (n) => Math.abs(n.x) > 0.7);
  const alu = surf(0xc8cdd0, { roughness: 0.3, metalness: 0.8 });
  const mh = mast(b, 0, 1.2, -1.0, 16.5, 0.1, alu, 0);
  b.tube(new THREE.Vector3(0, 2.6, -1.0), new THREE.Vector3(0, 2.7, 4.2), 0.07, 5, alu);
  b.ellipsoid(0, 2.85, 1.6, 0.22, 0.3, 2.7, near ? 8 : 5, 3, surf(0x1f3f75, { roughness: 0.85, detail: Detail.Fabric }));
  if (near) {
    const wire = surf(0x9aa0a4, { roughness: 0.4, metalness: 0.8 });
    b.tube(new THREE.Vector3(0, 17.6, -1.0), new THREE.Vector3(0, 1.25, -6.3), 0.025, 3, wire);
    b.tube(new THREE.Vector3(0, 17.6, -1.0), new THREE.Vector3(0, 1.15, 6.3), 0.025, 3, wire);
    b.tube(new THREE.Vector3(0, 14, -1.0), new THREE.Vector3(1.9, 1.15, -0.5), 0.02, 3, wire);
    b.tube(new THREE.Vector3(0, 14, -1.0), new THREE.Vector3(-1.9, 1.15, -0.5), 0.02, 3, wire);
    // Furled genoa around the forestay.
    b.tube(new THREE.Vector3(0, 12, -2.6), new THREE.Vector3(0, 1.6, -6.1), 0.12, 5, surf(0xe6e2d8, { roughness: 0.8, detail: Detail.Fabric }));
  }
  const lights: NavLightDef[] = [
    { kind: 'mast', x: 0, y: 8, z: -1.0 },
    { kind: 'port', x: -0.4, y: 1.3, z: -6.0 },
    { kind: 'stbd', x: 0.4, y: 1.3, z: -6.0 },
    { kind: 'stern', x: 0, y: 1.2, z: 6.5 },
    { kind: 'anchor', x: mh.x, y: mh.y + 0.2, z: mh.z },
  ];
  return { geometry: b.build(), lights, airDraft: mh.y };
}
