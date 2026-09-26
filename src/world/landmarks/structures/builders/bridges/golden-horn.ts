/**
 * Golden Horn road bridges.
 * - Galata Köprüsü (1994): 490 m, 42 m wide, 80 m double-leaf bascule; upper deck with 2x2 lanes, the T1 tram in the
 *   middle and wide sidewalks (fishermen); lower level with a continuous row of restaurants; four control towers at
 *   the bascule piers.
 * - Atatürk (Unkapanı) Köprüsü (1940): 477 m x 25 m steel deck on floating pontoons, central opening section.
 * - Haliç Köprüsü (1974): 995 m x 32 m steel box girder on twin-column piers, 22 m clearance.
 */
import * as THREE from 'three';
import type { StructureBuild } from '../../build/context';
import type { BridgeFrame } from '../../build/bridge-frame';
import { stations } from '../../build/bridge-frame';
import type { MeshBuilder } from '../../build/mesh-builder';
import { Emit, linearHex, LightMode, Surf } from '../../build/surfaces';
import { Color, mat, Pal, withEmit } from '../palette';
import { jointBreaks } from '../../build/deck-joint';
import { deckPoint, type DeckSection } from './deck';
import { buildGirderBridge, type GirderBridgeGeometry } from './girder-bridge';

const flatDeck = (hw: number, depth: number, inset = 0.6): DeckSection['girder'] => [
  [-hw, 0],
  [-hw, -depth * 0.55],
  [-hw + inset, -depth],
  [hw - inset, -depth],
  [hw, -depth * 0.55],
  [hw, 0],
];

/* ------------------------------------------------------------------ */
/* Galata                                                              */
/* ------------------------------------------------------------------ */

/** Lateral offset (m) of each T1 track centre on the Galata deck (OSM track positions). */
const GALATA_TRACK = 2.3;

const GALATA_SECTION: DeckSection = {
  girder: flatDeck(21, 1.25, 0.3),
  girderLow: flatDeck(21, 1.25, 0.3),
  girderMat: mat(0x6f7a7c, Surf.Steel, 0.55, 0, 12),
  // Matches the OSM ways it joins (fit-bridge-anchors.mjs centres the deck on them): T1 tracks 4.6 m apart, two
  // 11.4 m carriageways of 3 lanes centred 9.3 m off the axis, 6 m walkways.
  strips: [
    { x0: -3.6, x1: 3.6, kind: 'rail', surface: mat(0x77746d, Surf.Rail, 0.85, 0, GALATA_TRACK * 2) },
    { x0: 3.6, x1: 15, kind: 'road', lanes: 3, medianHalf: 3.25 },
    { x0: -15, x1: -3.6, kind: 'road', lanes: 3, medianHalf: 3.25 },
    { x0: 15, x1: 21, kind: 'walk', raise: 0.18, surface: mat(0x9b958a, Surf.Paving, 0.8, 0, 0.6) },
    { x0: -21, x1: -15, kind: 'walk', raise: 0.18, surface: mat(0x9b958a, Surf.Paving, 0.8, 0, 0.6) },
  ],
  barriers: [
    { x: 3.72, kind: 'steel' },
    { x: -3.72, kind: 'steel' },
  ],
  railings: [
    { x: 20.85, height: 1.1, raise: 0.18 },
    { x: -20.85, height: 1.1, raise: 0.18 },
  ],
  lamps: { lines: [{ x: 15.4, arm: -1 }, { x: -15.4, arm: 1 }], spacing: 26, phase: 13, height: 8, arm: 1.2, kelvin: 3000, intensity: 34, pool: 1.1 },
  traffic: { lanes: [5.7, 9.3, 13].flatMap((x) => [{ x, dir: 1 as const }, { x: -x, dir: -1 as const }]), spacing: 26, speed: 9 },
  depth: 1.25,
  halfWidth: 21,
};

const AWNINGS = [0x7a1f1f, 0x2d4f7a, 0x8a6b2c, 0x2f5a3a, 0x6b2c5a, 0xb7b0a3, 0x4a3226];
const SIGNS = [0xf2e6c8, 0xe8c070, 0xd8e8f0, 0xf0b8a0];

/** Lower-level restaurant row on one side between stations a and b (road height via `height`). */
function restaurantRow(mb: MeshBuilder, frame: BridgeFrame, side: number, a: number, b: number, rng: () => number): void {
  const floor = 1.25;
  const ceil = 4.25;
  const inner = 11.2;
  const front = 18.6;
  const edge = 21;
  const st = stations(a, b, 40);
  const frames = frame.frames(st, () => floor, () => 0);
  // floor slab + walkway
  mb.surface(mat(0x8e877c, Surf.Paving, 0.8, 0, 0.5));
  mb.ribbon(frames, side > 0 ? inner : -edge, side > 0 ? edge : -inner);
  mb.surface(Pal.concreteDark);
  mb.sweep(
    side > 0
      ? [
          [edge, 0],
          [edge, -0.6],
          [inner, -0.6],
        ]
      : [
          [-inner, -0.6],
          [-edge, -0.6],
          [-edge, 0],
        ],
    frames,
    false,
  );
  // back wall (substructure behind the shops)
  mb.surface(mat(0x3b3e3f, Surf.Steel, 0.6, 0, 6));
  mb.sweep(
    [
      [side * inner, 0],
      [side * inner, ceil - floor],
    ],
    frames,
    false,
  );
  // shop units
  let s = a;
  while (s < b - 4) {
    const w = Math.min(9 + rng() * 7, b - s);
    const s1 = s + w;
    const awning = AWNINGS[Math.floor(rng() * AWNINGS.length)];
    const sign = SIGNS[Math.floor(rng() * SIGNS.length)];
    const n = frame.right.clone().multiplyScalar(side);
    const quad = (x0: number, y0: number, x1: number, y1: number, sa: number, sb: number, normal: THREE.Vector3): void => {
      const p0 = frame.point(sa, side * x0, y0);
      const p1 = frame.point(sb, side * x0, y0);
      const p2 = frame.point(sb, side * x1, y1);
      const p3 = frame.point(sa, side * x1, y1);
      const i0 = mb.vtx(p0, normal, sa, y0);
      const i1 = mb.vtx(p1, normal, sb, y0);
      const i2 = mb.vtx(p2, normal, sb, y1);
      const i3 = mb.vtx(p3, normal, sa, y1);
      mb.quad(i0, i1, i2, i3);
    };
    // glazed front with lit interior at night
    mb.surface({ ...Pal.window, emit: Emit.Windows, ea: 3.2, eb: rng() * 10, ec: 0.92 });
    quad(front, floor + 0.05, front, ceil - 0.75, s + 0.35, s1 - 0.35, n);
    // mullions / piers between units
    mb.surface(mat(0x5a5d5e, Surf.Steel, 0.45, 0.6, 0));
    for (const q of [s, s1]) {
      const c = frame.point(q, side * (front + 0.05), (floor + ceil) / 2);
      mb.box(c.x, c.y, c.z, 0.18, (ceil - floor) / 2, 0.12, frame.yaw, true, true);
    }
    // sign band
    mb.surface(withEmit(mat(sign, Surf.Plain, 0.5), Emit.Glow, 3.5));
    quad(front + 0.02, ceil - 0.72, front + 0.02, ceil - 0.02, s + 0.2, s1 - 0.2, n);
    // awning (sloping out over the walkway)
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(n, 0.5).normalize();
    mb.surface(mat(awning, Surf.Plain, 0.85));
    quad(front + 0.05, ceil - 0.8, front + 1.9, ceil - 1.45, s + 0.1, s1 - 0.1, up);
    s = s1;
  }
}

function galataTower(mb: MeshBuilder, frame: BridgeFrame, s: number, x: number, base: number, lod: number): void {
  const c = frame.point(s, x, 0);
  const h = 15.5;
  mb.vBase = base;
  mb.surface(mat(0xc9c2b2, Surf.Ashlar, 0.8, 0, 0.6));
  mb.box(c.x, base + (h - 4.5) / 2, c.z, 3.4, (h - 4.5) / 2, 3.4, frame.yaw, true, false);
  // glazed control room with a slim frame
  mb.surface({ ...Pal.window, emit: Emit.Windows, ea: 2.2, eb: 3, ec: 1 });
  mb.box(c.x, base + h - 2.6, c.z, 3.1, 1.9, 3.1, frame.yaw, true, true);
  if (lod === 0) {
    mb.surface(mat(0xd8d6cf, Surf.Plain, 0.5));
    for (const [dx, dz] of [
      [3.1, 3.1],
      [-3.1, 3.1],
      [3.1, -3.1],
      [-3.1, -3.1],
    ]) {
      const p = frame.point(s + dx, x + dz, 0);
      mb.box(p.x, base + h - 2.6, p.z, 0.2, 1.9, 0.2, frame.yaw, true, true);
    }
  }
  // overhanging pyramid roof
  mb.surface(mat(0x5f6a6b, Surf.Lead, 0.45, 0.3, 0.5));
  const y0 = base + h - 0.6;
  const r = 4.2;
  const corners = [
    [r, r],
    [-r, r],
    [-r, -r],
    [r, -r],
  ].map(([a, t]) => frame.point(s + a, x + t, y0));
  const apex = frame.point(s, x, y0 + 3.6);
  const inside = frame.point(s, x, y0 + 1.0);
  for (let i = 0; i < 4; i++) {
    mb.polygonOutward([corners[i], corners[(i + 1) % 4], apex], inside);
  }
  mb.polygonOutward(corners, inside);
  mb.vBase = 0;
}

export function buildGalataBridge(b: StructureBuild): void {
  buildGirderBridge(
    b,
    {
      section: GALATA_SECTION,
      hMid: 5.6,
      crestRadius: 1e7,
      minEnd: 2.6,
      maxApproach: 80,
      maxGrade: 0.03,
      pierSpacing: 42,
      pierSurface: Pal.concreteDark,
      pier: { columns: 1, along: 3.2, across: 24 },
      mainPierClear: 18,
    },
    (g) => galataExtras(b, g),
  );
}

function galataExtras(b: StructureBuild, g: GirderBridgeGeometry): void {
  const { frame, height, sPierA, sPierB, sEndA, sEndB } = g;
  const rng = b.rng;
  const lo = Math.min(sPierA, sPierB);
  const hi = Math.max(sPierA, sPierB);
  const endLo = Math.min(sEndA, sEndB);
  const endHi = Math.max(sEndA, sEndB);
  // lower level restaurant rows between the bascule piers and the quays
  for (const [a, c] of [
    [endLo + 22, lo - 8],
    [hi + 8, endHi - 22],
  ] as const) {
    b.opaque(
      (mb, lod) => {
        if (lod > 0) {
          mb.surface(Pal.window);
          for (const side of [-1, 1]) {
            const f = frame.frames(stations(a, c, 60), () => 1.25, () => 0);
            mb.sweep(
              [
                [side * 18.6, 0],
                [side * 18.6, 3.0],
              ],
              f,
              false,
            );
          }
          return;
        }
        for (const side of [-1, 1]) {
          restaurantRow(mb, frame, side, a, c, rng);
        }
      },
      { detailScale: 0.5 },
    );
    for (const side of [-1, 1]) {
      const st = stations(a, c, 12);
      b.wires.polyline(
        st.map((s) => frame.point(s, side * 20.9, 2.35)),
        0.03,
        Color.railing,
        { fade: [1500, 3000] },
      );
      for (let s = a; s <= c; s += 2.2) {
        b.wires.add(frame.point(s, side * 20.9, 1.25), frame.point(s, side * 20.9, 2.35), 0.02, Color.railing, { fade: [250, 500] });
      }
    }
  }
  // bascule piers (counterweight chambers) and the four control towers
  for (const s of [sPierA, sPierB]) {
    const c = frame.point(s, 0, 0);
    const top = height(s) - GALATA_SECTION.depth;
    b.opaque(
      (mb) => {
        mb.surface(mat(0x8f8a80, Surf.Concrete, 0.85, 0, 2));
        mb.vBase = -12;
        mb.box(c.x, (top - 12) / 2, c.z, 8, (top + 12) / 2, 28, frame.yaw, true, false);
        mb.vBase = 0;
      },
      { lods: 1 },
    );
    b.boxCollider(c.x, (top - 12) / 2, c.z, 8, (top + 12) / 2, 28, frame.yaw);
    for (const side of [-1, 1]) {
      const x = side * 24.6;
      const base = height(s) - 0.2;
      b.opaque((mb, lod) => galataTower(mb, frame, s, x, base, lod), { detailScale: 0.6 });
      const tc = frame.point(s, x, base + 9);
      b.boxCollider(tc.x, tc.y, tc.z, 4.2, 9.5, 4.2, frame.yaw);
      // deck extension to the tower
      b.opaque(
        (mb) => {
          mb.surface(mat(0x9b958a, Surf.Paving, 0.8, 0, 0.6));
          const p = frame.point(s, side * 23.4, height(s) - 0.4);
          mb.box(p.x, p.y, p.z, 5, 0.6, 2.8, frame.yaw, false, false);
        },
        { lods: 1 },
      );
      b.lights.add(frame.point(s, x, base + 19.6), [60, 2, 1], 0.2, LightMode.Blink, [2.0, side * 0.25, 0.4, 0]);
    }
  }
  // bascule leaf joints: dark gaps across the deck at the piers and at midspan
  b.opaque(
    (mb) => {
      mb.surface(Pal.darkMetal);
      for (const s of [sPierA, sPierB, (sPierA + sPierB) / 2]) {
        const p = frame.point(s, 0, height(s) + 0.012);
        mb.box(p.x, p.y, p.z, 0.12, 0.012, 21, frame.yaw, true, false);
      }
    },
    { lods: 1, cullDistance: 1500 },
  );
  // tram catenary: centre poles with twin brackets, contact wires over both tracks (following the deck's tracks where
  // a landed end moves them onto the street's, deck.ts deckPoint())
  const at = (s: number, x: number, dy: number): THREE.Vector3 => deckPoint(frame, g.joints, height, s, x, dy);
  const poleColor = linearHex(0x4f5558);
  const st: number[] = [];
  for (let s = endLo + 10; s < endHi - 10; s += 34) {
    st.push(s);
  }
  b.opaque(
    (mb, lod) => {
      if (lod > 0) {
        return;
      }
      mb.surface(mat(0x4f5558, Surf.Steel, 0.5, 0.5, 0));
      for (const s of st) {
        const p = at(s, 0, 0);
        mb.cylinder(p.x, p.y, p.z, 0.14, 0.1, 7.2, 8, true, false);
      }
    },
    { detailScale: 0.3, cullDistance: 3000 },
  );
  for (const s of st) {
    for (const side of [-1, 1]) {
      b.wires.add(at(s, 0, 6.9), at(s, side * (GALATA_TRACK + 0.6), 6.6), 0.04, poleColor, { fade: [600, 1200] });
    }
  }
  for (const side of [-1, 1]) {
    const wire = stations(endLo + 10, endHi - 10, 17, jointBreaks(g.joints)).map((s) => at(s, side * GALATA_TRACK, 6.1));
    b.wires.polyline(wire, 0.012, Color.catenary, { fade: [500, 900] });
  }
}

/* ------------------------------------------------------------------ */
/* Atatürk                                                             */
/* ------------------------------------------------------------------ */

const ATATURK_SECTION: DeckSection = {
  girder: [
    [-12.5, 0],
    [-12.5, -0.9],
    [-11.8, -0.9],
    [-11.8, -2.6],
    [11.8, -2.6],
    [11.8, -0.9],
    [12.5, -0.9],
    [12.5, 0],
  ],
  girderLow: flatDeck(12.5, 2.6, 0.7),
  girderMat: mat(0x5e6a70, Surf.Steel, 0.55, 0, 8),
  strips: [
    { x0: -10.1, x1: 10.1, kind: 'road', lanes: 2, medianHalf: 0.9 },
    { x0: 10.1, x1: 12.5, kind: 'walk', raise: 0.2 },
    { x0: -12.5, x1: -10.1, kind: 'walk', raise: 0.2 },
  ],
  barriers: [{ x: 0, kind: 'steel' }],
  railings: [
    { x: 12.4, height: 1.15, raise: 0.2 },
    { x: -12.4, height: 1.15, raise: 0.2 },
  ],
  lamps: { lines: [{ x: 10.4, arm: -1 }, { x: -10.4, arm: 1 }], spacing: 30, phase: 0, height: 9, arm: 1.4, kelvin: 3000, intensity: 30, pool: 1.0 },
  traffic: { lanes: [2.7, 6.3].flatMap((x) => [{ x, dir: 1 as const }, { x: -x, dir: -1 as const }]), spacing: 30, speed: 11 },
  depth: 2.6,
  halfWidth: 12.5,
};

export function buildAtaturkBridge(b: StructureBuild): void {
  buildGirderBridge(
    b,
    {
      section: ATATURK_SECTION,
      hMid: 6.4,
      crestRadius: 1e7,
      minEnd: 3,
      maxApproach: 60,
      maxGrade: 0.035,
      pierSpacing: 1e6,
      pierSurface: Pal.concreteDark,
      mainPierClear: 0,
    },
    (g) => ataturkExtras(b, g),
  );
}

function ataturkExtras(b: StructureBuild, g: GirderBridgeGeometry): void {
  const { frame, height, sPierA, sPierB, sEndA, sEndB } = g;
  const endLo = Math.min(sEndA, sEndB);
  const endHi = Math.max(sEndA, sEndB);
  const lo = Math.min(sPierA, sPierB);
  const hi = Math.max(sPierA, sPierB);
  // floating pontoons with steel trestles under the deck; the central opening section rests on two larger pontoons
  const pontoons: number[] = [];
  for (let s = endLo + 36; s < endHi - 30; s += 38) {
    if (s > lo - 10 && s < hi + 10) {
      continue;
    }
    pontoons.push(s);
  }
  pontoons.push(lo, hi);
  for (const side of [-1, 1]) {
    const list = pontoons.filter((s) => Math.sign(s) === side || (side > 0 && s === 0));
    b.opaque(
      (mb, lod) => {
        for (const s of list) {
          const big = s === lo || s === hi;
          const c = frame.point(s, 0, 0);
          mb.surface(mat(0x3d4446, Surf.Steel, 0.6, 0, 3));
          mb.vBase = -2;
          mb.box(c.x, 0.25, c.z, big ? 9 : 6.5, 2.25, 11.5, frame.yaw, true, false);
          // waterline band
          if (lod === 0) {
            mb.surface(mat(0x6b2e24, Surf.Steel, 0.7, 0, 3));
            mb.box(c.x, -0.15, c.z, (big ? 9 : 6.5) + 0.03, 0.35, 11.53, frame.yaw, true, true);
          }
          const top = height(s) - ATATURK_SECTION.depth;
          mb.surface(mat(0x55605f, Surf.Steel, 0.55, 0.2, 4));
          for (const x of [-8, -2.7, 2.7, 8]) {
            const p = frame.point(s, x, 0);
            mb.box(p.x, (2.5 + top) / 2, p.z, 0.45, (top - 2.5) / 2, 0.45, frame.yaw, true, true);
          }
          if (lod === 0) {
            // cross bracing
            for (const x0 of [-8, 2.7]) {
              const pa = frame.point(s, x0, 2.6);
              const pb = frame.point(s, x0 + 5.3, top - 0.1);
              b.wires.add(pa, pb, 0.08, Color.hanger, { fade: [800, 1600] });
            }
          }
          mb.vBase = 0;
        }
      },
      { detailScale: 0.6 },
    );
  }
  for (const s of pontoons) {
    const c = frame.point(s, 0, 0);
    b.boxCollider(c.x, 0.25, c.z, 7, 2.25, 11.5, frame.yaw);
  }
}

/* ------------------------------------------------------------------ */
/* Haliç highway bridge                                                */
/* ------------------------------------------------------------------ */

const HALIC_SECTION: DeckSection = {
  girder: [
    [-16, 0],
    [-16, -0.6],
    [-14.6, -1.0],
    [-10.5, -3.4],
    [10.5, -3.4],
    [14.6, -1.0],
    [16, -0.6],
    [16, 0],
  ],
  girderLow: flatDeck(16, 3.4, 5),
  girderMat: mat(0x8a9294, Surf.Steel, 0.6, 0, 12),
  strips: [
    { x0: -14.4, x1: 14.4, kind: 'road', lanes: 3, medianHalf: 1.1 },
    { x0: 14.4, x1: 16, kind: 'walk', raise: 0.2 },
    { x0: -16, x1: -14.4, kind: 'walk', raise: 0.2 },
  ],
  barriers: [
    { x: 0, kind: 'jersey' },
    { x: 14.6, kind: 'jersey' },
    { x: -14.6, kind: 'jersey' },
  ],
  railings: [
    { x: 15.9, height: 1.1, raise: 0.2 },
    { x: -15.9, height: 1.1, raise: 0.2 },
  ],
  lamps: { lines: [{ x: 0, arm: 1 }, { x: 0, arm: -1 }], spacing: 38, phase: 0, height: 11, arm: 2.2, kelvin: 3400, intensity: 38, pool: 0.8 },
  traffic: { lanes: [3.5, 7.2, 10.8].flatMap((x) => [{ x, dir: 1 as const }, { x: -x, dir: -1 as const }]), spacing: 30, speed: 16 },
  depth: 3.4,
  halfWidth: 16,
};

export function buildHalicBridge(b: StructureBuild): void {
  buildGirderBridge(b, {
    section: HALIC_SECTION,
    hMid: 22 + 3.5,
    crestRadius: 9000,
    minEnd: 4,
    maxApproach: 500,
    maxGrade: 0.045,
    pierSpacing: 55,
    pierSurface: Pal.concrete,
    mainPierClear: 0,
  });
}
