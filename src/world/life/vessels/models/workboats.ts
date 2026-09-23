import * as THREE from 'three';
import { Detail, Emit, MeshBuilder, surf } from '../../util/mesh-builder';
import { buildHull, HullShape } from '../hull';
import type { ModelOptions, NavLightDef } from '../model-types';
import { band, flag, glassHouse, inflate, lifeRing, mast, PAL, planform, prism, raftCanister, railing, roundRect, S, slab, windowsOnPolygon } from '../parts';
import { edgeLine, wallStrip, type BuiltModel } from './ferries';

const TR_RED = 0xc8102e;

/**
 * Harbour / escort tug (~26 x 9.5 m, KEGM style): beamy red hull (instance paint) with a heavy black fender belt and
 * bow fender, white house forward with a tall all-round wheelhouse, twin stacks, mast, fire monitors, towing winch
 * and H-bitt on the low aft deck.
 */
export function buildTug(o: ModelOptions): BuiltModel {
  const b = new MeshBuilder();
  const near = o.lod === 0;
  const shape = new HullShape({
    length: 26,
    beam: 9.5,
    depth: 4.4,
    draft: 3.4,
    sheerFwd: 1.5,
    sheerAft: 0.1,
    bowRake: 2.2,
    sternOverhang: 1.6,
    transom: 0.6,
    entrance: 0.36,
    run: 0.28,
    bowFullness: 2.0,
    bilge: 0.45,
    deadrise: 0.25,
    flare: 0.6,
    bulb: 0,
    camber: 0.12,
  });
  buildHull(b, shape, { side: S.hullPaint(), deck: surf(0x5b5f5c, { roughness: 0.8, detail: Detail.Deck }) }, near ? 22 : 10, near ? 6 : 3);
  const hb = (z: number): number => shape.deckHalfBreadthAtZ(z);
  const white = S.superWhite();
  const black = surf(0x141414, { roughness: 0.85 });
  const yd = shape.deckYAtZ(0);
  // Fender belt all round, heavy cylindrical fender at the bow.
  const belt = planform(-12.9, 12.7, (z) => hb(z) + 0.35, near ? 18 : 8);
  prism(b, belt, yd - 0.75, 0.6, black, black, black, 50);
  b.pushTRS(0, shape.deckYAtZ(-12) - 0.6, -12.6, 0, 0, Math.PI / 2);
  b.cylinder(0, -2.2, 0, 0.55, 0.55, 4.4, near ? 10 : 6, black, true, true);
  b.pop();
  for (const side of [-1, 1]) wallStrip(b, edgeLine(shape, -12.8, 12.6, near ? 14 : 5, side, 0.05), (p) => shape.deckYAtZ(p.z) - 0.05, 0.95, 0.14, S.hullPaint());
  // Low deckhouse forward of midships, tall wheelhouse on top with raked all-round windows (ASD harbour tug).
  const house = planform(-8.8, 1.2, (z) => hb(z) - 1.0, near ? 6 : 3);
  prism(b, house, yd, 2.5, white, null);
  windowsOnPolygon(b, house, yd, { surf: S.glass(Emit.Crew), sill: 1.25, height: 0.62, width: 0.62, pitch: 1.7, margin: 0.6 });
  slab(b, inflate(house, 0.25), yd + 2.65, 0.15, S.roof(), white);
  const whPoly = roundRect(0, -4.6, 5.6, 4.2, 0.9, near ? 2 : 1);
  const yW = yd + 2.65;
  const whTop = glassHouse(b, whPoly, yW, 0.95, 1.55, 0.28, white, S.glass(Emit.Crew), white, near);
  slab(b, inflate(whTop, 0.3), yW + 2.62, 0.16, S.roof(0xc9cbc7), white, white);
  const mastSurf = surf(0xe8e6de, { roughness: 0.5 });
  const mh = mast(b, 0, yW + 2.62, -3.9, 4.6, 0.13, mastSurf, near ? 2.0 : 0);
  // Exhaust casing aft of the wheelhouse in hull colour, twin black-topped uptakes.
  prism(b, roundRect(0, -0.6, 3.6, 2.0, 0.5, near ? 2 : 1), yd + 2.65, 1.6, S.hullPaint(), null);
  for (const sx of [-1, 1]) {
    b.cylinder(sx * 1.05, yd + 4.25, -0.6, 0.38, 0.36, 1.1, near ? 10 : 6, white, false);
    b.cylinder(sx * 1.05, yd + 5.35, -0.6, 0.36, 0.35, 0.4, near ? 10 : 6, black, true);
  }
  if (near) {
    // Towing winch forward (ASD tugs tow over the bow), staple and H-bitt aft, fire monitors on the wheelhouse roof.
    const winch = surf(0x3c4144, { roughness: 0.5, metalness: 0.5 });
    b.pushTRS(0, yd + 0.8, -10.2, 0, 0, Math.PI / 2);
    b.cylinder(0, -1.4, 0, 0.75, 0.75, 2.8, 12, winch, true, true);
    b.pop();
    b.block(0, yd, -10.2, 3.4, 0.4, 1.8, winch);
    const yellow = surf(0xd6b12a, { roughness: 0.5 });
    b.block(0, yd, 8.4, 3.0, 1.1, 0.45, yellow);
    b.block(-1.3, yd, 8.4, 0.4, 1.45, 0.45, yellow);
    b.block(1.3, yd, 8.4, 0.4, 1.45, 0.45, yellow);
    b.tube(new THREE.Vector3(-2.6, yd, 5.8), new THREE.Vector3(-1.8, yd + 2.2, 5.8), 0.12, 6, yellow);
    b.tube(new THREE.Vector3(2.6, yd, 5.8), new THREE.Vector3(1.8, yd + 2.2, 5.8), 0.12, 6, yellow);
    b.tube(new THREE.Vector3(-1.8, yd + 2.2, 5.8), new THREE.Vector3(1.8, yd + 2.2, 5.8), 0.12, 6, yellow);
    const red = surf(0xb3261e, { roughness: 0.5 });
    for (const sx of [-1, 1]) {
      b.cylinder(sx * 1.5, yW + 2.78, -5.8, 0.2, 0.16, 0.55, 8, red, true);
      b.tube(new THREE.Vector3(sx * 1.5, yW + 3.3, -5.8), new THREE.Vector3(sx * 1.5, yW + 3.5, -6.9), 0.1, 6, red);
    }
    railing(b, inflate(whTop, 0.3), yW + 2.78, white, 0.9, 1.2, true);
    const ring = surf(0xe8521f, { roughness: 0.55 });
    lifeRing(b, hb(-2) - 0.95, yd + 1.7, -2, 0, ring);
    lifeRing(b, -(hb(-2) - 0.95), yd + 1.7, -2, Math.PI, ring);
    raftCanister(b, 3.0, yd + 2.95, 0.4, surf(0xf3f1ea, { roughness: 0.5 }));
    b.box(0, yd + 2.3, -9.1, 0.35, 0.25, 0.3, S.lamp());
    b.box(0, yW + 2.4, -2.3, 0.4, 0.3, 0.3, S.lamp());
    flag(b, 0, shape.deckYAtZ(12) + 0.9, 12.3, 1.6, 0.7, mastSurf, surf(TR_RED, { roughness: 0.8, detail: Detail.Fabric }), Math.PI);
  }
  const lights: NavLightDef[] = [
    { kind: 'mast', x: mh.x, y: mh.y, z: mh.z },
    { kind: 'mast', x: mh.x, y: mh.y - 1.2, z: mh.z },
    { kind: 'port', x: -3.1, y: yW + 2.2, z: -4.6 },
    { kind: 'stbd', x: 3.1, y: yW + 2.2, z: -4.6 },
    { kind: 'stern', x: 0, y: yd + 1.2, z: 12.6 },
    { kind: 'anchor', x: mh.x, y: mh.y - 2.4, z: mh.z },
    { kind: 'deck', x: 0, y: yW + 2.3, z: -2.3 },
  ];
  return { geometry: b.build(), lights, airDraft: mh.y };
}

/**
 * Pilot boat (~16 m): planing hull in pilot orange (instance paint) with a black fender belt, white cabin forward with
 * a wrap-around window band, radar arch and rails.
 */
export function buildPilotBoat(o: ModelOptions): BuiltModel {
  const b = new MeshBuilder();
  const near = o.lod === 0;
  const shape = new HullShape({
    length: 16,
    beam: 4.8,
    depth: 2.3,
    draft: 1.2,
    sheerFwd: 0.7,
    sheerAft: 0,
    bowRake: 2.4,
    sternOverhang: 0.1,
    transom: 0.9,
    entrance: 0.48,
    run: 0.05,
    bowFullness: 1.4,
    bilge: 0.5,
    deadrise: 0.7,
    flare: 0.6,
    bulb: 0,
    camber: 0.06,
  });
  buildHull(b, shape, { side: S.hullPaint(), deck: surf(0x5f6360, { roughness: 0.8, detail: Detail.Deck }) }, near ? 18 : 8, near ? 5 : 3);
  const hb = (z: number): number => shape.deckHalfBreadthAtZ(z);
  const white = surf(0xf2f1ec, { roughness: 0.4, detail: Detail.Super });
  const black = surf(0x141414, { roughness: 0.85 });
  const yd = shape.deckYAtZ(0);
  prism(b, planform(-7.6, 7.9, (z) => hb(z) + 0.22, near ? 14 : 6), yd - 0.35, 0.32, black, black, black, 50);
  const cabin = planform(-4.8, 2.2, (z) => hb(z) - 0.45, near ? 6 : 3);
  const cabinTop = glassHouse(b, cabin, yd, 1.0, 1.05, 0.16, white, S.glass(Emit.Crew), white, near);
  slab(b, inflate(cabinTop, 0.15), yd + 2.17, 0.12, S.roof(0xdadbd6), white);
  band(b, cabin, yd + 0.05, 0.3, surf(0xffffff, { paint: 1, roughness: 0.45 }), 0.02);
  // Radar arch.
  b.block(1.5, yd + 2.15, 0.6, 0.18, 1.3, 0.5, white);
  b.block(-1.5, yd + 2.15, 0.6, 0.18, 1.3, 0.5, white);
  b.block(0, yd + 3.4, 0.6, 3.2, 0.15, 0.5, white);
  const mh = new THREE.Vector3(0, yd + 4.2, 0.6);
  if (near) {
    b.cylinder(0, yd + 3.5, 0.6, 0.06, 0.05, 0.7, 5, white, true);
    b.box(0, yd + 3.6, -0.2, 1.4, 0.1, 0.25, surf(0x2a2c2e, { roughness: 0.5, metalness: 0.4 }));
    const rail = surf(0xcfd3d6, { roughness: 0.2, metalness: 0.9 });
    railing(b, edgeLine(shape, -7.6, -4.9, 4, 1, 0.1), shape.deckYAtZ(-6), rail, 0.8);
    railing(b, edgeLine(shape, -7.6, -4.9, 4, -1, 0.1), shape.deckYAtZ(-6), rail, 0.8);
    railing(b, edgeLine(shape, 2.4, 7.8, 4, 1, 0.1), yd, rail, 0.8);
    railing(b, edgeLine(shape, 2.4, 7.8, 4, -1, 0.1), yd, rail, 0.8);
    flag(b, 0.3, yd, 7.6, 1.3, 0.6, rail, surf(TR_RED, { roughness: 0.8, detail: Detail.Fabric }), Math.PI);
    b.box(0, yd + 2.25, -4.6, 0.3, 0.12, 0.3, S.lamp());
  }
  const lights: NavLightDef[] = [
    { kind: 'mast', x: 0, y: mh.y, z: mh.z },
    { kind: 'red', x: 0, y: mh.y - 0.6, z: mh.z },
    { kind: 'port', x: -1.9, y: yd + 1.9, z: -3.8 },
    { kind: 'stbd', x: 1.9, y: yd + 1.9, z: -3.8 },
    { kind: 'stern', x: 0, y: yd + 0.3, z: 7.8 },
  ];
  return { geometry: b.build(), lights, airDraft: mh.y };
}

export { PAL };
