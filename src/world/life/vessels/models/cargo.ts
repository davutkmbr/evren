import * as THREE from 'three';
import { createRng } from '../../../../core/math/noise';
import { Detail, Emit, MeshBuilder, srgb, surf, type SurfaceSpec } from '../../util/mesh-builder';
import { buildHull, HullShape } from '../hull';
import type { ModelOptions, NavLightDef } from '../model-types';
import { inflate, lifeboat, mast, PAL, planform, prism, railing, rect, roundRect, S, slab, windowsOnPolygon } from '../parts';
import type { BuiltModel } from './ferries';

export type CargoType = 'tanker' | 'container' | 'bulk';

export interface CargoDesign {
  type: CargoType;
  length: number;
  beam: number;
  depth: number;
  draft: number;
  /** Accommodation tiers above the main deck (incl. bridge deck). */
  tiers: number;
  seed: number;
}

const CONTAINER_COLORS = [0x3a6fa5, 0x9c2a24, 0x6d1f1d, 0x2f6b3a, 0x8b8f91, 0xd9d6cc, 0xd5712a, 0xd7a52b, 0x6e4b32, 0x2d6e73, 0x1f2d52, 0x2b7ec1, 0x3f4447, 0x2f5e3e, 0x2b4d8f, 0xb8b3a6];

/**
 * Seagoing merchant ship (product tanker, feeder container ship or handysize bulker) with aft accommodation,
 * forecastle, bulbous bow and type-specific deck gear.
 */
export function buildCargoShip(d: CargoDesign, o: ModelOptions): BuiltModel {
  const b = new MeshBuilder();
  const near = o.lod === 0;
  const rng = createRng(d.seed);
  const L = d.length;
  const B = d.beam;
  const shape = new HullShape({
    length: L,
    beam: B,
    depth: d.depth,
    draft: d.draft,
    sheerFwd: 2.2,
    sheerAft: 0.5,
    bowRake: L * 0.032,
    sternOverhang: L * 0.04,
    transom: d.type === 'container' ? 0.8 : 0.7,
    entrance: d.type === 'container' ? 0.24 : 0.19,
    run: 0.24,
    bowFullness: d.type === 'container' ? 1.75 : d.type === 'bulk' ? 2.7 : 2.4,
    bilge: 0.07,
    deadrise: 0.02,
    flare: d.type === 'container' ? 0.85 : 0.5,
    bulb: L * 0.022,
    camber: B * 0.012,
  });
  const deckHex = d.type === 'container' ? 0x5b6560 : rng() < 0.55 ? PAL.deckRed : PAL.deckGreen;
  buildHull(b, shape, { side: S.hullPaint(), deck: surf(deckHex, { roughness: 0.8, metalness: 0.1, detail: Detail.Deck }) }, near ? 34 : 14, near ? 8 : 4);
  const hb = (z: number): number => shape.deckHalfBreadthAtZ(z);
  const deckY = (z: number): number => shape.deckYAtZ(z);
  const yMain = -d.draft + d.depth;
  const white = surf(0xe9e7df, { roughness: 0.55, detail: Detail.Super });
  const deckSurf = surf(deckHex, { roughness: 0.8, metalness: 0.1, detail: Detail.Deck });
  const hullWall = S.hullPaint();
  const glass = S.glass(Emit.Crew);
  const dark = surf(PAL.greyDark, { roughness: 0.6, metalness: 0.3 });

  // Forecastle.
  const fcEnd = -L / 2 + L * 0.1;
  const fc = planform(-L / 2 + 0.6, fcEnd, (z) => hb(z), near ? 10 : 4);
  prism(b, fc, yMain + 0.5, deckY(-L / 2 + 2) - yMain + 2.2, hullWall, deckSurf);
  const fcTop = yMain + 0.5 + deckY(-L / 2 + 2) - yMain + 2.2;

  // Accommodation block aft.
  const accFront = L / 2 - L * 0.2;
  const accBack = L / 2 - L * 0.085;
  const accDepth = accBack - accFront;
  const accW = Math.min(B - 2.2, 26);
  const tierH = 2.8;
  const lower = rect(0, (accFront + accBack) / 2, accW, accDepth);
  // Poop deck (raised aft deck).
  const poop = planform(accFront - 2, L / 2 - 0.4, (z) => hb(z), near ? 8 : 4);
  prism(b, poop, yMain, 2.6, hullWall, deckSurf);
  const y0 = yMain + 2.6;
  const houseTiers = d.tiers - 1;
  let y = y0;
  for (let t = 0; t < houseTiers; t++) {
    const inset = t >= houseTiers - 2 ? 0.8 : 0;
    const poly = rect(0, (accFront + accBack) / 2 + inset * 0.5, accW - inset * 2, accDepth - inset);
    prism(b, poly, y, tierH, white, t === houseTiers - 1 ? S.roof(0xb7bab4) : null);
    windowsOnPolygon(b, poly, y, near ? { surf: glass, sill: 1.05, height: 1.05, width: 1.1, pitch: 2.4 } : { surf: glass, sill: 1.05, height: 1.0, width: 1, pitch: 1, band: true, minEdge: 3 });
    y += tierH;
  }
  // Bridge deck with wings spanning the beam.
  const bridgeDepth = Math.min(accDepth * 0.55, 11);
  const bridge = rect(0, accFront + bridgeDepth / 2 + 0.5, accW, bridgeDepth);
  prism(b, bridge, y, tierH, white, null);
  windowsOnPolygon(b, bridge, y, { surf: glass, sill: 1.0, height: 1.25, width: near ? 1.2 : accW - 1, pitch: near ? 1.4 : accW, margin: 0.3 });
  const wings = rect(0, accFront + 2.2, B + 0.6, 3.2);
  slab(b, wings, y + 0.1, 0.35, S.roof(0xb7bab4), white, white);
  prism(b, rect(0, accFront + 2.2, B + 0.6, 3.2), y + 0.1, 1.1, white, null);
  slab(b, inflate(bridge, 0.5), y + tierH + 0.2, 0.2, S.roof(0xb7bab4), white, white);
  const bridgeTop = y + tierH + 0.2;

  // Funnel (company colours) with black top.
  const fz = accBack - 3.2;
  const fh = Math.max(6, d.depth * 0.45);
  const fp = roundRect(0, fz, Math.min(accW * 0.32, 7), 5.2, 1.1, near ? 3 : 1);
  prism(b, fp, y, fh - 1.2, S.accent(), null);
  prism(b, fp, y + fh - 1.2, 1.2, surf(PAL.black, { roughness: 0.6 }), surf(0x151515, { roughness: 0.8 }));
  if (near) {
    b.cylinder(0.8, y + fh, fz + 0.6, 0.45, 0.45, 1.0, 8, dark, true);
    b.cylinder(-0.8, y + fh, fz + 0.6, 0.35, 0.35, 0.8, 8, dark, true);
  }

  // Radar mast on the bridge roof, foremast on the forecastle.
  const mastSurf = surf(0xdcdad2, { roughness: 0.5 });
  const aftMast = mast(b, 0, bridgeTop, accFront + bridgeDepth * 0.5, 6.5, 0.2, mastSurf, near ? 4.5 : 0);
  const foreMast = mast(b, 0, fcTop, -L / 2 + L * 0.045, 9, 0.25, surf(0xd1a326, { roughness: 0.5 }), 0);
  if (near) {
    b.cylinder(2.2, bridgeTop, accFront + bridgeDepth * 0.5, 0.9, 0.9, 0.5, 12, mastSurf, true);
    b.box(-2.4, bridgeTop + 3.5, accFront + bridgeDepth * 0.5, 3.4, 0.25, 0.4, mastSurf);
  }

  // Freefall lifeboat on the stern ramp + deck floodlights on the house front.
  const lbSurf = surf(PAL.lifeboat, { roughness: 0.45 });
  const lbLen = Math.min(8.5, B * 0.3);
  b.pushTRS(0, y0 + tierH * 1.6, accBack + lbLen * 0.35, 0, 0.5);
  lifeboat(b, 0, 0, 0, lbLen, lbSurf, near ? 10 : 6);
  b.pop();
  if (near) {
    b.block(0, y0, accBack + lbLen * 0.2, 3.2, tierH * 1.2, lbLen * 0.9, surf(0xcfcfcb, { roughness: 0.6, metalness: 0.3 }), 1 | 2 | 4);
    for (let t = 0; t < houseTiers; t += 2) {
      for (const s of [-1, 1]) b.box(s * (accW / 2 - 1), y0 + t * tierH + 2.5, accFront - 0.2, 0.4, 0.3, 0.3, S.lamp());
    }
    b.box(0, bridgeTop - 0.4, accFront - 0.3, 0.5, 0.35, 0.3, S.lamp());
    b.box(0, fcTop + 6, -L / 2 + L * 0.045 + 0.4, 0.4, 0.3, 0.3, S.lamp());
  }

  const cargoStart = fcEnd + 3;
  const cargoEnd = accFront - 4;

  if (d.type === 'tanker') {
    const pipe = surf(0x9b9f9a, { roughness: 0.5, metalness: 0.5 });
    const pipeRed = surf(0x7e2f22, { roughness: 0.6, metalness: 0.3 });
    const py = yMain + 0.9;
    if (near) {
      for (const x of [-1.8, -0.9, 0, 0.9]) {
        b.tube(new THREE.Vector3(x, py, cargoStart), new THREE.Vector3(x, py, cargoEnd), 0.3, 6, x === 0 ? pipeRed : pipe);
      }
      // Catwalk on posts.
      b.box(2.4, yMain + 2.3, (cargoStart + cargoEnd) / 2, 1.0, 0.12, cargoEnd - cargoStart, surf(0x6f7572, { roughness: 0.6, metalness: 0.4 }));
      for (let z = cargoStart; z <= cargoEnd; z += 9) b.box(2.4, yMain + 1.15, z, 0.18, 2.3, 0.18, pipe);
      // Manifold with cross pipes and hose cranes.
      const mz = L * 0.04;
      for (let k = 0; k < 4; k++) {
        b.tube(new THREE.Vector3(-B / 2 + 1.5, py + 0.3, mz + k * 1.3), new THREE.Vector3(B / 2 - 1.5, py + 0.3, mz + k * 1.3), 0.25, 6, pipe);
      }
      for (const s of [-1, 1]) {
        b.cylinder(s * (B / 2 - 3.5), yMain, mz - 4, 0.6, 0.5, 5, 8, white, true);
        b.tube(new THREE.Vector3(s * (B / 2 - 3.5), yMain + 5, mz - 4), new THREE.Vector3(s * (B / 2 - 1), yMain + 8, mz + 5), 0.25, 6, white);
      }
      // Tank hatches / vents along the deck.
      for (let z = cargoStart + 5; z < cargoEnd; z += L * 0.075) {
        for (const s of [-1, 1]) {
          b.block(s * B * 0.22, yMain, z, 1.4, 0.7, 1.4, deckSurf);
          b.cylinder(s * B * 0.34, yMain, z + 2, 0.2, 0.2, 2.2, 6, pipe, true);
        }
      }
    } else {
      b.block(0, yMain, (cargoStart + cargoEnd) / 2, 4.2, 1.2, cargoEnd - cargoStart, pipe);
    }
  } else if (d.type === 'bulk') {
    const holds = Math.max(4, Math.round((cargoEnd - cargoStart) / (L * 0.12)));
    const pitch = (cargoEnd - cargoStart) / holds;
    const hatchLen = pitch * 0.72;
    const hatchW = B * 0.62;
    const cover = surf(rng() < 0.5 ? 0x8b3b24 : 0x4d6a4f, { roughness: 0.65, metalness: 0.2, detail: Detail.Deck });
    const craneSurf = surf(rng() < 0.5 ? 0xd6ae35 : 0xe3e1d8, { roughness: 0.5, metalness: 0.2 });
    for (let k = 0; k < holds; k++) {
      const zc = cargoStart + pitch * (k + 0.5);
      b.block(0, yMain, zc, hatchW, 1.6, hatchLen, cover);
      // Ridged cover panels.
      b.pushTRS(0, yMain + 1.6, zc);
      b.extrudeZY(
        [
          [-hatchLen / 2, 0],
          [hatchLen / 2, 0],
          [hatchLen / 2, 0.25],
          [0, 0.6],
          [-hatchLen / 2, 0.25],
        ],
        -hatchW / 2,
        hatchW / 2,
        cover,
      );
      b.pop();
      if (near) {
        for (let r = -hatchLen / 2 + 1; r < hatchLen / 2; r += 2.2) b.box(0, yMain + 1.75, zc + r, hatchW + 0.1, 0.2, 0.12, cover);
      }
      if (k < holds - 1 && k % 1 === 0 && holds >= 5 && k > 0 && k < holds - 1) {
        const cz = cargoStart + pitch * (k + 1);
        b.cylinder(0, yMain, cz, 1.3, 1.1, 9, near ? 10 : 6, craneSurf, true);
        b.block(0, yMain + 9, cz, 2.6, 2.6, 3.2, craneSurf);
        if (near) b.box(0.9, yMain + 10.6, cz - 1.62, 0.8, 0.9, 0.05, glass);
        const dir = k % 2 === 0 ? -1 : 1;
        b.tube(new THREE.Vector3(0, yMain + 10, cz), new THREE.Vector3(0, yMain + 10 + 20 * Math.sin(0.45), cz + dir * 20 * Math.cos(0.45)), 0.45, near ? 6 : 4, craneSurf);
      }
    }
  } else {
    // Containers: 40 ft bays, stacks of varying height, per-box colours biased towards 2-3 dominant lines.
    const bayLen = 12.19;
    const bayGap = 0.9;
    const rows = Math.floor((B - 1.6) / 2.44);
    const bays = Math.floor((cargoEnd - cargoStart) / (bayLen + bayGap));
    const dominant = [CONTAINER_COLORS[Math.floor(rng() * CONTAINER_COLORS.length)], CONTAINER_COLORS[Math.floor(rng() * CONTAINER_COLORS.length)]];
    const pick = (): SurfaceSpec => {
      const r = rng();
      const hex = r < 0.3 ? dominant[0] : r < 0.45 ? dominant[1] : CONTAINER_COLORS[Math.floor(rng() * CONTAINER_COLORS.length)];
      const c = srgb(hex).multiplyScalar(0.85 + rng() * 0.25);
      return { color: c, roughness: 0.6, metalness: 0.25, detail: Detail.Container };
    };
    const coaming = yMain + 1.2;
    for (let k = 0; k < bays; k++) {
      const zc = cargoStart + (bayLen + bayGap) * k + bayLen / 2;
      const fwd = k / Math.max(bays - 1, 1);
      const maxTiers = Math.round(THREE.MathUtils.lerp(3, 6, Math.min(1, fwd * 1.6)));
      const rowsHere = Math.min(rows, Math.floor((hb(zc - bayLen / 2) * 2 - 1.0) / 2.44));
      b.block(0, yMain, zc, rowsHere * 2.44 + 0.4, 1.2, bayLen + 0.2, deckSurf);
      for (let r = 0; r < rowsHere; r++) {
        const x = (r - (rowsHere - 1) / 2) * 2.44;
        const tiers = Math.max(1, maxTiers - Math.floor(rng() * rng() * 3.5));
        if (near) {
          for (let t = 0; t < tiers; t++) {
            b.block(x, coaming + t * 2.59, zc, 2.42, 2.57, bayLen, pick(), t === tiers - 1 ? 63 & ~8 : 1 | 2 | 16 | 32);
          }
        } else {
          b.block(x, coaming, zc, 2.44, tiers * 2.59, bayLen, pick());
        }
      }
      if (near && k % 1 === 0) {
        // Lashing bridge between bays.
        b.block(0, yMain + 1.2, zc + bayLen / 2 + bayGap / 2, rowsHere * 2.44, 3.2, 0.35, surf(0xc7c5bd, { roughness: 0.6, metalness: 0.4 }), 1 | 2 | 4 | 16 | 32);
      }
    }
  }

  if (near) {
    // Deck railings along the main deck.
    const rail = surf(0xd9d7cf, { roughness: 0.5 });
    const pts = [];
    for (let z = fcEnd; z <= accFront - 2; z += (accFront - 2 - fcEnd) / 12) pts.push({ x: hb(z) - 0.15, z });
    railing(b, pts, yMain, rail, 1.05, 2.2);
    railing(b, pts.map((p) => ({ x: -p.x, z: p.z })), yMain, rail, 1.05, 2.2);
    // Anchor hawse + mooring winches on the forecastle.
    b.block(2.5, fcTop, -L / 2 + L * 0.06, 2.0, 1.1, 2.4, dark);
    b.block(-2.5, fcTop, -L / 2 + L * 0.06, 2.0, 1.1, 2.4, dark);
  }

  const wingY = y - tierH + 2.2;
  const lights: NavLightDef[] = [
    { kind: 'mast', x: foreMast.x, y: foreMast.y, z: foreMast.z },
    { kind: 'mast', x: aftMast.x, y: aftMast.y, z: aftMast.z },
    { kind: 'port', x: -(B / 2 + 0.3), y: wingY + tierH, z: accFront + 2.2 },
    { kind: 'stbd', x: B / 2 + 0.3, y: wingY + tierH, z: accFront + 2.2 },
    { kind: 'stern', x: 0, y: y0 + 1.2, z: L / 2 - 0.5 },
    { kind: 'anchor', x: 0, y: fcTop + 5, z: -L / 2 + L * 0.04 },
    { kind: 'anchor', x: 0, y: y0 + 2.5, z: L / 2 - 1 },
    { kind: 'deck', x: 0, y: bridgeTop - 0.5, z: accFront - 1 },
    { kind: 'deck', x: 0, y: yMain + 6, z: 0 },
  ];
  return { geometry: b.build(), lights, airDraft: Math.max(aftMast.y, y + fh) };
}
