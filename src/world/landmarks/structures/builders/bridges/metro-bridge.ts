/**
 * Haliç Metro Köprüsü (2014, Virlogeux): single-plane harp cable-stayed bridge carrying the M2 line.
 * 180 m main span between two slender white "horn" pylons 65 m above the water, nine stays each side of each pylon
 * anchored from 47 m up, 460 m cable-stayed section over the water, 4.45 m deep box girder ~13 m above the water and
 * the Haliç station on the main span (180 m platforms under a 90 m canopy with vertical sun-shading blades).
 */
import * as THREE from 'three';
import type { StructureBuild } from '../../build/context';
import { BridgeFrame, stations } from '../../build/bridge-frame';
import type { MeshBuilder } from '../../build/mesh-builder';
import { Emit, Surf } from '../../build/surfaces';
import { Color, mat, Pal, withEmit } from '../palette';
import { buildDeck, buildDeckColliders, type DeckSection } from './deck';
import { buildPiers } from './piers';
import { DeckProfile } from './profile';

const WHITE_STEEL = mat(0xe4e4df, Surf.Steel, 0.42, 0, 5);

function metroSection(hw: number, platforms: boolean): DeckSection {
  const strips: Array<DeckSection['strips'][number]> = [
    { x0: -1.4, x1: 1.4, kind: 'plain', surface: mat(0xa9a59c, Surf.Concrete, 0.8, 0, 6) },
    { x0: 1.4, x1: 5.6, kind: 'rail', surface: mat(0x7d7a72, Surf.Rail, 0.85, 0, 0) },
    { x0: -5.6, x1: -1.4, kind: 'rail', surface: mat(0x7d7a72, Surf.Rail, 0.85, 0, 0) },
  ];
  if (platforms) {
    strips.push(
      { x0: 5.6, x1: hw, kind: 'walk', raise: 1.05, surface: mat(0xb8b3a8, Surf.Paving, 0.7, 0, 0.6) },
      { x0: -hw, x1: -5.6, kind: 'walk', raise: 1.05, surface: mat(0xb8b3a8, Surf.Paving, 0.7, 0, 0.6) },
    );
  } else {
    strips.push({ x0: 5.6, x1: hw, kind: 'walk', raise: 0.25 }, { x0: -hw, x1: -5.6, kind: 'walk', raise: 0.25 });
  }
  return {
    girder: [
      [-hw, 0],
      [-hw, -0.7],
      [-hw + 1.6, -1.6],
      [-4.2, -4.45],
      [4.2, -4.45],
      [hw - 1.6, -1.6],
      [hw, -0.7],
      [hw, 0],
    ],
    girderLow: [
      [-hw, 0],
      [-4.2, -4.45],
      [4.2, -4.45],
      [hw, 0],
    ],
    girderMat: WHITE_STEEL,
    strips,
    barriers: [],
    railings: platforms
      ? [
          { x: hw - 0.1, height: 1.2, raise: 1.05 },
          { x: -hw + 0.1, height: 1.2, raise: 1.05 },
        ]
      : [
          { x: hw - 0.1, height: 1.2, raise: 0.25 },
          { x: -hw + 0.1, height: 1.2, raise: 0.25 },
        ],
    lamps: platforms ? undefined : { lines: [{ x: hw - 0.4, arm: -1 }, { x: -hw + 0.4, arm: 1 }], spacing: 30, phase: 15, height: 6, arm: 0.8, kelvin: 4000, intensity: 22, pool: 0 },
    depth: 4.45,
    halfWidth: hw,
  };
}

const SIDE = metroSection(7.0, false);
const STATION = metroSection(10.4, true);

/** Pylon cross-section (along the bridge `a`, across `t`) as a function of height fraction. */
function pylonRing(frame: BridgeFrame, s: number, y: number, a: number, t: number, lean: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const n = 12;
  for (let k = 0; k < n; k++) {
    const ang = (k / n) * Math.PI * 2;
    // lens-shaped section: pointed along the bridge axis
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const pa = Math.sign(ca) * Math.pow(Math.abs(ca), 0.8) * a;
    const pt = Math.sign(sa) * Math.pow(Math.abs(sa), 1.2) * t;
    pts.push(frame.point(s + lean + pa, pt, y));
  }
  return pts;
}

function buildPylon(mb: MeshBuilder, frame: BridgeFrame, s: number, dirMain: number, yBase: number, yTop: number, lod: number): void {
  const levels = lod === 0 ? 14 : 5;
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= levels; i++) {
    const f = i / levels;
    const y = yBase + (yTop - yBase) * f;
    // horn: the tip curves back away from the main span
    const lean = -dirMain * 3.2 * Math.pow(f, 3);
    const a = 2.9 * (1 - f) + 0.5 * f;
    const t = 1.7 * (1 - f) + 0.35 * f;
    rings.push(pylonRing(frame, s, y, a, t, lean));
  }
  mb.vBase = yBase;
  mb.surface(withEmit(WHITE_STEEL, Emit.Flood, 1.4, 2, yTop - yBase));
  mb.loft(rings, { closed: true, smooth: true, hardAngleDeg: 70, capEnd: true, vMode: 'y' });
  mb.vBase = 0;
}

export function buildHalicMetroBridge(b: StructureBuild): void {
  const anchors = b.def.anchors ?? [];
  const frame = BridgeFrame.fromAnchors(anchors);
  const half = 90;
  const sA = -half;
  const sB = half;
  const sideSpan = 140;
  const sEndA = Math.min(frame.sOf(anchors[2]), sA - sideSpan);
  const sEndB = Math.max(frame.sOf(anchors[3]), sB + sideSpan);
  const hMid = 13 + 4.45 + 0.3;
  const profile = new DeckProfile(
    { hMid, crestRadius: 1e7, sTowerA: sA, sTowerB: sB, sEndA, sEndB, maxApproach: 400, maxGrade: 0.035, depth: 4.45, minEnd: hMid - 2 },
    frame,
    b.terrain,
  );
  const height = (s: number): number => profile.height(s);
  const grade = (s: number): number => profile.grade(s);
  const s0 = profile.startS;
  const s1 = profile.endS;

  buildDeck(b, frame, SIDE, { s0, s1: sA - 0.01, height, grade, partLength: 220 });
  buildDeck(b, frame, SIDE, { s0: sB + 0.01, s1, height, grade, partLength: 220 });
  buildDeck(b, frame, STATION, { s0: sA, s1: sB, height, grade, partLength: 200 });
  buildDeckColliders(b, frame, s0, s1, height, (s) => (s > sA && s < sB ? STATION : SIDE));

  // pylons with their pier caps
  const yTop = 65;
  for (const [s, dirMain] of [
    [sA, 1],
    [sB, -1],
  ] as const) {
    b.opaque((mb, lod) => buildPylon(mb, frame, s, dirMain, 2.5, yTop, lod), { detailScale: 1.2 });
    b.opaque(
      (mb) => {
        const c = frame.point(s, 0, 0);
        mb.surface(Pal.concrete);
        mb.vBase = -14;
        mb.box(c.x, -5.5, c.z, 7, 8.2, 10, frame.yaw, true, false);
        mb.vBase = 0;
      },
      { lods: 1 },
    );
    const base = frame.point(s, 0, 2.5);
    b.cylinderCollider(base.x, 2.5, base.z, 3.0, yTop - 2.5);
    b.lights.aviation(frame.point(s - dirMain * 3.2, 0, yTop + 0.6), s > 0 ? 0.3 : 0);
    // harp stays: 9 per side from 47 m upward, parallel within each fan
    for (const dir of [-1, 1]) {
      for (let k = 0; k < 9; k++) {
        const yAnchor = 47 + k * 1.95;
        const f = (yAnchor - 2.5) / (yTop - 2.5);
        const lean = -dirMain * 3.2 * Math.pow(Math.min(f, 1), 3);
        const top = frame.point(s + lean + dir * 0.4, 0, yAnchor);
        const reach = 50 + k * 4.6;
        const sd = s + dir * reach;
        const bottom = frame.point(sd, 0, height(sd) + 0.4);
        b.wires.add(top, bottom, 0.075, Color.stay, { fade: [9000, 15000] });
      }
    }
  }

  // station canopy with vertical sun-shading blades
  const cy = height(0) + 1.05;
  const canopyHalf = 45;
  b.opaque(
    (mb, lod) => {
      const st = stations(-canopyHalf, canopyHalf, lod === 0 ? 5 : 30);
      const roofY = (s: number): number => cy + 7.6 + 0.8 * (1 - (s / canopyHalf) ** 2);
      const frames = frame.frames(st, roofY, (s) => (-2 * 0.8 * s) / (canopyHalf * canopyHalf));
      mb.surface(withEmit(mat(0xefefea, Surf.Plain, 0.4), Emit.Glow, 0.0));
      mb.sweep(
        [
          [-11.2, 0.45],
          [11.2, 0.45],
          [11.2, 0],
          [-11.2, 0],
        ],
        frames,
        true,
      );
      // lit soffit strip at night
      mb.surface(withEmit(mat(0xf4f1e8, Surf.Plain, 0.5), Emit.Glow, 2.2));
      mb.ribbon(
        frames.map((f) => ({ ...f, up: f.up.clone().negate(), p: f.p.clone().addScaledVector(f.up, -0.02) })),
        -9.5,
        9.5,
      );
      if (lod === 0) {
        mb.surface(WHITE_STEEL);
        for (let s = -canopyHalf + 0.6; s < canopyHalf; s += 1.25) {
          for (const side of [-1, 1]) {
            const p = frame.point(s, side * 10.9, (cy + roofY(s)) / 2 + 0.2);
            mb.box(p.x, p.y, p.z, 0.06, (roofY(s) - cy) / 2 - 0.2, 0.55, frame.yaw, true, true);
          }
        }
        // columns
        mb.surface(mat(0xd9d9d3, Surf.Steel, 0.45, 0.3, 0));
        for (let s = -canopyHalf + 7.5; s < canopyHalf; s += 15) {
          for (const side of [-1, 1]) {
            const p = frame.point(s, side * 7.2, cy);
            mb.cylinder(p.x, p.y, p.z, 0.28, 0.24, roofY(s) - cy, 10, false, false);
          }
        }
      }
    },
    { detailScale: 0.6 },
  );
  // platform lights under the canopy
  const warm: [number, number, number] = [18, 17, 15.5];
  for (let s = -canopyHalf + 5; s < canopyHalf; s += 10) {
    for (const side of [-1, 1]) {
      b.lights.add(frame.point(s, side * 8.2, cy + 7.2), warm, 0.3);
    }
  }

  // approach viaduct piers (none inside the pylon zones)
  const pierList: number[] = [];
  for (let s = sA - 36; s > s0 + 10; s -= 42) {
    pierList.push(s);
  }
  buildPiers(b, frame, SIDE, height, Pal.concrete, pierList, { columns: 1, along: 3.0, across: 5.5 });
  const pierListB: number[] = [];
  for (let s = sB + 36; s < s1 - 10; s += 42) {
    pierListB.push(s);
  }
  buildPiers(b, frame, SIDE, height, Pal.concrete, pierListB, { columns: 1, along: 3.0, across: 5.5 });
}
