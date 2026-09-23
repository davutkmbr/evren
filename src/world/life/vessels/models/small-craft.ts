import * as THREE from 'three';
import { Detail, Emit, MeshBuilder, surf } from '../../util/mesh-builder';
import { buildHull, HullShape } from '../hull';
import type { ModelOptions, NavLightDef } from '../model-types';
import { inflate, mast, PAL, planform, prism, railing, rect, S, slab, windowsOnPolygon } from '../parts';
import { edgeLine, wallStrip, type BuiltModel } from './ferries';

/** Traditional wooden Bosphorus fishing boat (kayık, ~10 m) with a small wheelhouse. */
export function buildFishingBoat(o: ModelOptions): BuiltModel {
  const b = new MeshBuilder();
  const near = o.lod === 0;
  const shape = new HullShape({
    length: 10.5,
    beam: 3.3,
    depth: 1.75,
    draft: 0.85,
    sheerFwd: 0.55,
    sheerAft: 0.3,
    bowRake: 1.1,
    sternOverhang: 0.6,
    transom: 0,
    entrance: 0.4,
    run: 0.4,
    bowFullness: 1.5,
    bilge: 0.6,
    deadrise: 0.45,
    flare: 0.3,
    bulb: 0,
    camber: 0.05,
    doubleEnded: true,
  });
  buildHull(b, shape, { side: surf(0xffffff, { paint: 1, roughness: 0.6, detail: Detail.Wood }), deck: surf(0x9a8062, { roughness: 0.85, detail: Detail.Deck }) }, near ? 16 : 8, near ? 5 : 3);
  const hb = (z: number): number => shape.deckHalfBreadthAtZ(z);
  const gunwale = surf(0x2b5a9e, { roughness: 0.6, detail: Detail.Wood });
  const wood = surf(0x7d5a3a, { roughness: 0.7, detail: Detail.Wood });
  const white = surf(0xece6d6, { roughness: 0.6, detail: Detail.Super });
  wallStrip(b, edgeLine(shape, -5.0, 5.0, near ? 10 : 4, 1, 0.04), () => 0.85, 0.28, 0.08, gunwale);
  wallStrip(b, edgeLine(shape, -5.0, 5.0, near ? 10 : 4, -1, 0.04), () => 0.85, 0.28, 0.08, gunwale);
  // Wheelhouse.
  const wh = rect(0, 1.2, 1.9, 1.8);
  prism(b, wh, 0.85, 1.75, white, null);
  windowsOnPolygon(b, wh, 0.85, { surf: S.glass(Emit.Crew), sill: 0.95, height: 0.55, width: 0.6, pitch: 0.8, margin: 0.15 });
  slab(b, inflate(wh, 0.12), 2.68, 0.08, surf(0x2b5a9e, { roughness: 0.6 }), white);
  const mh = mast(b, 0, 2.68, 1.4, 2.4, 0.05, wood, near ? 0.9 : 0);
  if (near) {
    // Net pile and fish boxes aft, stem post.
    b.ellipsoid(0, 0.95, 3.4, 0.9, 0.3, 0.9, 7, 4, surf(PAL.net, { roughness: 0.95, detail: Detail.Fabric }));
    b.block(0.8, 0.85, -1.2, 0.6, 0.3, 0.45, surf(0x2a6fbe, { roughness: 0.6 }));
    b.block(-0.7, 0.85, -1.6, 0.6, 0.3, 0.45, surf(0xc9c2b0, { roughness: 0.6 }));
    b.tube(new THREE.Vector3(0, 0.6, -5.25), new THREE.Vector3(0, 1.75, -5.55), 0.07, 5, wood);
    b.box(0, 2.3, 0.3, 0.2, 0.12, 0.2, S.lamp());
  }
  const lights: NavLightDef[] = [
    { kind: 'mast', x: mh.x, y: mh.y, z: mh.z },
    { kind: 'port', x: -hb(1) - 0.02, y: 2.3, z: 0.4 },
    { kind: 'stbd', x: hb(1) + 0.02, y: 2.3, z: 0.4 },
    { kind: 'anchor', x: mh.x, y: mh.y, z: mh.z },
  ];
  return { geometry: b.build(), lights, airDraft: mh.y };
}

/** Purse seiner (gırgır, ~28 m): high bow, wheelhouse forward, net pile and power block aft. */
export function buildSeiner(o: ModelOptions): BuiltModel {
  const b = new MeshBuilder();
  const near = o.lod === 0;
  const shape = new HullShape({
    length: 28,
    beam: 7.6,
    depth: 3.6,
    draft: 2.4,
    sheerFwd: 1.6,
    sheerAft: 0.3,
    bowRake: 2.4,
    sternOverhang: 1.6,
    transom: 0.55,
    entrance: 0.34,
    run: 0.2,
    bowFullness: 1.7,
    bilge: 0.35,
    deadrise: 0.35,
    flare: 0.55,
    bulb: 0,
    camber: 0.1,
  });
  buildHull(b, shape, { side: S.hullPaint(), deck: surf(0x6e6b62, { roughness: 0.8, detail: Detail.Deck }) }, near ? 22 : 10, near ? 6 : 3);
  const hb = (z: number): number => shape.deckHalfBreadthAtZ(z);
  const white = S.superWhite();
  const yd = 1.2;
  wallStrip(b, edgeLine(shape, -13.6, 13.6, near ? 14 : 5, 1, 0.06), (p) => shape.deckYAtZ(p.z) - 0.05, 0.9, 0.1, S.hullPaint());
  wallStrip(b, edgeLine(shape, -13.6, 13.6, near ? 14 : 5, -1, 0.06), (p) => shape.deckYAtZ(p.z) - 0.05, 0.9, 0.1, S.hullPaint());
  const house = planform(-9.5, -2.5, (z) => hb(z) - 0.6, near ? 6 : 3);
  prism(b, house, yd, 2.4, white, null);
  windowsOnPolygon(b, house, yd, { surf: S.glass(Emit.Crew), sill: 1.1, height: 0.8, width: 0.9, pitch: 1.4 });
  const wh = rect(0, -6.5, 4.2, 3.2);
  prism(b, wh, yd + 2.4, 2.1, white, null);
  windowsOnPolygon(b, wh, yd + 2.4, { surf: S.glass(Emit.Crew), sill: 0.95, height: 0.85, width: 0.85, pitch: 1.05, margin: 0.15 });
  slab(b, inflate(wh, 0.2), yd + 4.6, 0.12, S.roof(), white);
  const mastSurf = surf(0xd4d2ca, { roughness: 0.5 });
  const mh = mast(b, 0, yd + 4.6, -6.5, 6.5, 0.15, mastSurf, near ? 2.4 : 0);
  // Boom from the mast foot aft + power block.
  b.tube(new THREE.Vector3(0, yd + 2.5, -2.4), new THREE.Vector3(0, yd + 9.0, 8.0), 0.18, near ? 6 : 4, surf(0xc9a23a, { roughness: 0.5 }));
  // Net pile.
  b.ellipsoid(0.4, yd + 0.45, 7.5, 2.6, 0.9, 4.2, near ? 10 : 6, near ? 5 : 3, surf(0x283530, { roughness: 0.95, detail: Detail.Fabric }));
  if (near) {
    b.ellipsoid(0.4, yd + 1.05, 6.9, 1.2, 0.35, 1.6, 8, 3, surf(0xd9a13a, { roughness: 0.9, detail: Detail.Fabric }));
    b.cylinder(0, yd + 8.8, 8.0, 0.5, 0.5, 0.35, 10, surf(PAL.greyDark, { roughness: 0.5 }), true);
    b.box(0, yd + 4.35, -8.2, 0.3, 0.2, 0.3, S.lamp());
    b.box(0, yd + 8.5, -6.4, 0.3, 0.2, 0.3, S.lamp());
    railing(b, edgeLine(shape, -9.2, -3, 4, 1, 0.5).map((p) => ({ x: p.x, z: p.z })), yd + 4.6, white, 0.9);
  }
  const lights: NavLightDef[] = [
    { kind: 'mast', x: mh.x, y: mh.y, z: mh.z },
    { kind: 'port', x: -2.3, y: yd + 4.0, z: -6.5 },
    { kind: 'stbd', x: 2.3, y: yd + 4.0, z: -6.5 },
    { kind: 'stern', x: 0, y: yd + 1.4, z: 13.8 },
    { kind: 'anchor', x: mh.x, y: mh.y - 1, z: mh.z },
    { kind: 'deck', x: 0, y: yd + 8.5, z: 0 },
  ];
  return { geometry: b.build(), lights, airDraft: mh.y };
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
  const mainHouse = planform(-6.5, 8.5, (z) => (hb(z) - 0.55) * (z < -3 ? 0.75 + 0.25 * (z + 6.5) / 3.5 : 1), near ? 10 : 5);
  prism(b, mainHouse, deck, 2.2, white, null);
  windowsOnPolygon(b, mainHouse, deck, { surf: glass, sill: 0.6, height: 1.2, width: 1, pitch: 1, band: true, minEdge: 1.2, margin: 0.2 });
  // Hull window band (lower deck cabins).
  const hullBand = planform(-6, 6, (z) => hb(z) + 0.01, near ? 8 : 4);
  windowsOnPolygon(b, hullBand, 0, { surf: glass, sill: 0.6, height: 0.35, width: 1, pitch: 1, band: true, minEdge: 3, margin: 0.8 }, (n) => Math.abs(n.x) > 0.8);
  slab(b, inflate(mainHouse, 0.25), deck + 2.4, 0.18, surf(0xf4f4f1, { roughness: 0.3 }), white);
  const fly = planform(-3.2, 6.5, (z) => hb(z) - 1.3, near ? 6 : 3);
  prism(b, fly, deck + 2.4, 1.0, white, null);
  slab(b, fly, deck + 3.45, 0.05, surf(0xcfc6b8, { roughness: 0.6 }), white);
  // Radar arch.
  b.pushTRS(0, deck + 3.4, 3.0, 0, -0.35);
  b.block(1.6, 0, 0, 0.35, 1.9, 0.9, white);
  b.block(-1.6, 0, 0, 0.35, 1.9, 0.9, white);
  b.block(0, 1.9, 0, 3.55, 0.35, 0.9, white);
  b.pop();
  const mh = new THREE.Vector3(0, deck + 5.8, 3.6);
  if (near) {
    b.cylinder(0, deck + 5.2, 3.6, 0.35, 0.35, 0.3, 10, white, true);
    b.cylinder(0.9, deck + 5.2, 3.6, 0.25, 0.25, 0.25, 10, white, true);
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
