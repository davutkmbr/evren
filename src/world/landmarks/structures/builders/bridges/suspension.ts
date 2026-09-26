/**
 * Suspension and hybrid (cable-stayed + suspension) bridge builder used for the three Bosphorus bridges.
 * Anchors: [towerA, towerB, endA, endB]. The bridge is centred on the midpoint of the tower anchors and uses the
 * real spans from the spec; the approaches continue past the end anchors until they meet the terrain.
 */
import * as THREE from 'three';
import type { StructureBuild } from '../../build/context';
import { BridgeFrame, stations } from '../../build/bridge-frame';
import type { SurfaceState } from '../../build/mesh-builder';
import type { Rgb } from '../../build/surfaces';
import { Color, Pal } from '../palette';
import { buildDeck, buildDeckColliders, type DeckSection } from './deck';
import { buildPiers } from './piers';
import { DeckProfile } from './profile';
import { buildATower, buildPortalTower, legAt, type LegSpec } from './towers';

/** Tower top (saddle) height, measured from the tower base, the road surface at the tower or sea level. */
export interface TowerHeight {
  ref: 'base' | 'deck' | 'sea';
  values: readonly [number, number];
}

export interface PortalTowerParams {
  kind: 'portal';
  height: TowerHeight;
  xTop: number;
  xBase: number;
  daBase: number;
  daTop: number;
  dtBase: number;
  dtTop: number;
  /** Portal beams above the deck: fractions of the height between deck and top (1 = top beam). */
  portals: readonly number[];
  surface: SurfaceState;
}

export interface ATowerParams {
  kind: 'A';
  height: TowerHeight;
  /** Height (fraction of the tower height above the base) where the legs merge. */
  mergeFraction: number;
  xBase: number;
  xMerge: number;
  daBase: number;
  daTop: number;
  dtBase: number;
  dtTop: number;
  surface: SurfaceState;
}

export interface StaySpec {
  /** Stays per fan (each tower has 4 fans: 2 planes x 2 sides). */
  perFan: number;
  /** Deck anchorage range measured from the tower (m), main-span side. */
  mainFrom: number;
  mainTo: number;
  /** Side-span side range. */
  sideFrom: number;
  sideTo: number;
  /** Tower anchorage heights (fraction of the leg height, lowest..highest). */
  towerFrom: number;
  towerTo: number;
  radius: number;
}

export interface SuspensionSpec {
  mainSpan: number;
  sideSpans: readonly [number, number];
  clearance: number;
  crestRadius: number;
  section: DeckSection;
  tower: PortalTowerParams | ATowerParams;
  cable: {
    /** Lateral position of the cable planes at midspan (+-). */
    x: number;
    radius: number;
    /** Cable centre above the road at midspan. */
    lowAboveRoad: number;
    color: Rgb;
  };
  hangers: {
    type: 'inclined' | 'vertical';
    spacing: number;
    radius: number;
    /** Two ropes per hanger point (FSM). */
    pair: boolean;
    /** Hangers only where |s| <= zone (hybrid bridges). */
    zone?: number;
    color: Rgb;
  };
  stays?: StaySpec;
  anchorage: { along: number; across: number; height: number };
  pierSpacing: number;
  pierSurface: SurfaceState;
  led?: { group: number; cable: number; hanger: number; tower: number; deck: number };
  maxGrade: number;
}

function parabola(sA: number, yA: number, sB: number, yB: number, yLow: number): (s: number) => number {
  // y = a s^2 + b s + c through (sA, yA), (sB, yB) with c = yLow (vertex near s = 0 for symmetric towers)
  const c = yLow;
  const a = ((yA - c) * sB - (yB - c) * sA) / (sA * sA * sB - sB * sB * sA);
  const b = (yA - c - a * sA * sA) / sA;
  return (s) => a * s * s + b * s + c;
}

export function buildSuspensionBridge(b: StructureBuild, spec: SuspensionSpec): void {
  const anchors = b.def.anchors ?? [];
  if (anchors.length < 4) {
    throw new Error('suspension bridge needs 4 anchors');
  }
  const frame = BridgeFrame.fromAnchors(anchors);
  const half = spec.mainSpan / 2;
  const sTowerA = -half;
  const sTowerB = half;
  const sEndA = sTowerA - spec.sideSpans[0];
  const sEndB = sTowerB + spec.sideSpans[1];
  const section = spec.section;
  const hMid = spec.clearance + section.depth + 0.1;
  const profile = new DeckProfile(
    { hMid, crestRadius: spec.crestRadius, sTowerA, sTowerB, sEndA, sEndB, maxApproach: 700, maxGrade: spec.maxGrade, depth: section.depth, halfWidth: section.halfWidth },
    frame,
    b.terrain,
  );
  const height = (s: number): number => profile.height(s);
  const grade = (s: number): number => profile.grade(s);
  const s0 = profile.startS;
  const s1 = profile.endS;
  const uOf = (s: number): number => (s - s0) / (s1 - s0);
  const led = spec.led;

  // deck
  buildDeck(b, frame, section, {
    s0,
    s1,
    height,
    grade,
    breaks: [sTowerA, sTowerB, sEndA, sEndB, 0],
    led: led ? { group: led.group, u0: 0, u1: 1, strength: led.deck } : undefined,
  });
  buildDeckColliders(b, frame, s0, s1, height, () => section);

  // towers
  const tw = spec.tower;
  const towerBase = (s: number): number => {
    const p = frame.point(s, 0, 0);
    const hw = tw.xBase + tw.dtBase;
    let lo = Infinity;
    for (const x of [-hw, 0, hw]) {
      for (const ds of [-tw.daBase / 2, 0, tw.daBase / 2]) {
        const q = frame.point(s + ds, x, 0);
        lo = Math.min(lo, b.ground(q.x, q.z));
      }
    }
    void p;
    return lo;
  };
  const saddles: THREE.Vector3[][] = [];
  const aLegs: LegSpec[][] = [];
  [sTowerA, sTowerB].forEach((s, i) => {
    const ground = towerBase(s);
    const yBase = Math.max(ground, 0) + 2.5;
    // foundation / pier cap down to the ground (or sea bed)
    b.opaque(
      (mb) => {
        mb.surface(Pal.concreteDark);
        const c = frame.point(s, 0, 0);
        const bottom = Math.min(ground, 0) - 3;
        mb.vBase = bottom;
        mb.box(c.x, (bottom + yBase) / 2, c.z, tw.daBase * 0.9 + 3, (yBase - bottom) / 2, tw.xBase + tw.dtBase / 2 + 3, frame.yaw, true, false);
        mb.vBase = 0;
      },
      { lods: 1 },
    );
    const ledTower = led ? { group: led.group, u: uOf(s), strength: led.tower } : undefined;
    const hv = tw.height.values[i];
    const top = tw.height.ref === 'base' ? yBase + hv : tw.height.ref === 'deck' ? height(s) + hv : hv;
    if (tw.kind === 'portal') {
      const deckTop = height(s);
      const portals = tw.portals.map((f) => {
        const y = f >= 1 ? top - 3.5 : deckTop + (top - deckTop) * f;
        return { y, h: f >= 1 ? 6.5 : 4.5, w: tw.daTop };
      });
      portals.push({ y: deckTop - section.depth - 2.8, h: 4.2, w: tw.daBase * 0.9 });
      saddles.push(
        buildPortalTower(b, frame, {
          s,
          yBase,
          yTop: top,
          xTop: tw.xTop,
          xBase: tw.xBase,
          daBase: tw.daBase,
          daTop: tw.daTop,
          dtBase: tw.dtBase,
          dtTop: tw.dtTop,
          portals,
          surface: tw.surface,
          led: ledTower,
          aviationPhase: i * 0.37,
        }),
      );
    } else {
      const yMerge = yBase + (top - yBase) * tw.mergeFraction;
      const res = buildATower(b, frame, {
        s,
        yBase,
        yTop: top,
        yMerge,
        xBase: tw.xBase,
        xMerge: tw.xMerge,
        daBase: tw.daBase,
        daTop: tw.daTop,
        dtBase: tw.dtBase,
        dtTop: tw.dtTop,
        beamY: height(s) - section.depth - 3,
        beamH: 6,
        surface: tw.surface,
        led: ledTower,
        aviationPhase: i * 0.41,
      });
      saddles.push(res.saddles);
      aLegs.push(res.legs);
    }
  });

  // main cables
  const cable = spec.cable;
  const yLow = height(0) + cable.lowAboveRoad;
  const cableWires = (side: number): void => {
    const sA = saddles[0][side > 0 ? 1 : 0];
    const sB = saddles[1][side > 0 ? 1 : 0];
    const ys = parabola(sTowerA, sA.y, sTowerB, sB.y, yLow);
    const xSaddle = Math.abs(frame.xOf(sA));
    const xAt = (y: number): number => side * (cable.x + (xSaddle - cable.x) * THREE.MathUtils.clamp((y - yLow) / (sA.y - yLow), 0, 1));
    const pts = stations(sTowerA, sTowerB, 12, [0]).map((s) => frame.point(s, xAt(ys(s)), ys(s)));
    const ledCable = led ? { group: led.group, u0: uOf(sTowerA), u1: uOf(sTowerB), strength: led.cable } : undefined;
    b.wires.polyline(pts, cable.radius, cable.color, { led: ledCable });
    // backstays to the anchorages
    for (const [saddle, sEnd, dir] of [
      [sA, sEndA, -1],
      [sB, sEndB, 1],
    ] as const) {
      const sSad = frame.sOf(saddle);
      const sAnchor = sEnd + dir * 6;
      const yAnchor = height(sEnd) - section.depth - 1.5;
      const back: THREE.Vector3[] = [];
      const n = 12;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const s = sSad + (sAnchor - sSad) * t;
        const sag = 4 * 0.012 * Math.abs(sAnchor - sSad) * t * (1 - t);
        const y = saddle.y + (yAnchor - saddle.y) * t - sag;
        const x = frame.xOf(saddle) + (side * (cable.x + 0.8) - frame.xOf(saddle)) * t;
        back.push(frame.point(s, x, y));
      }
      const ledBack = led ? { group: led.group, u0: uOf(sSad), u1: uOf(sAnchor), strength: led.cable } : undefined;
      b.wires.polyline(back, cable.radius, cable.color, { led: ledBack });
    }
    // hangers
    const h = spec.hangers;
    const zone = h.zone ?? half - 8;
    const clampAt = (s: number): THREE.Vector3 => {
      const y = ys(s);
      return frame.point(s, xAt(y), y - cable.radius);
    };
    const deckAt = (s: number): THREE.Vector3 => frame.point(s, side * cable.x, height(s) + 0.2);
    const hangerLed = (s: number) => (led ? { group: led.group, u0: uOf(s), u1: uOf(s), strength: led.hanger } : undefined);
    if (h.type === 'inclined') {
      const nMax = Math.floor(zone / h.spacing);
      for (let j = -nMax; j <= nMax; j++) {
        const c = j * h.spacing;
        for (const d of [c - h.spacing / 2, c + h.spacing / 2]) {
          if (Math.abs(d) > zone) {
            continue;
          }
          b.wires.add(clampAt(c), deckAt(d), h.radius, h.color, { led: hangerLed(c), fade: [9000, 16000] });
        }
      }
    } else {
      const nMax = Math.floor(zone / h.spacing);
      for (let j = -nMax; j <= nMax; j++) {
        const s = j * h.spacing;
        const offsets = h.pair ? [-0.35, 0.35] : [0];
        for (const o of offsets) {
          b.wires.add(clampAt(s + o), deckAt(s + o), h.radius, h.color, { led: hangerLed(s), fade: [9000, 16000] });
        }
      }
    }
    // obstruction light at the lowest point of the cable
    b.lights.obstruction(frame.point(0, xAt(yLow), yLow + cable.radius + 0.3));
  };
  cableWires(-1);
  cableWires(1);

  // stays (hybrid)
  if (spec.stays && tw.kind === 'A') {
    const st = spec.stays;
    [sTowerA, sTowerB].forEach((sT, ti) => {
      const legs = aLegs[ti];
      for (const leg of legs) {
        const side = Math.sign(leg.xBase);
        for (const dir of [-1, 1]) {
          const towardMain = dir === -Math.sign(sT);
          const from = towardMain ? st.mainFrom : st.sideFrom;
          const to = towardMain ? st.mainTo : st.sideTo;
          for (let k = 0; k < st.perFan; k++) {
            const t = k / (st.perFan - 1);
            const sDeck = sT + dir * (from + (to - from) * t);
            if (sDeck < s0 || sDeck > s1) {
              // The side span landed on a hillside short of its nominal end (profile.ts): no deck to anchor to.
              continue;
            }
            const yAnchor = leg.yBase + (leg.yTop - leg.yBase) * (st.towerFrom + (st.towerTo - st.towerFrom) * t);
            const l = legAt(leg, yAnchor);
            const top = frame.point(sT + dir * l.da * 0.3, l.x - side * l.dt * 0.1, yAnchor);
            const bottom = frame.point(sDeck, side * (section.halfWidth - 1.2), height(sDeck) + 0.3);
            b.wires.add(top, bottom, st.radius, Color.stay, {
              led: led ? { group: led.group, u0: uOf(sT), u1: uOf(sDeck), strength: led.hanger * 0.6 } : undefined,
              fade: [12000, 20000],
            });
          }
        }
      }
    });
  }

  // anchorages
  for (const [sEnd, dir] of [
    [sEndA, -1],
    [sEndB, 1],
  ] as const) {
    const a = spec.anchorage;
    const top = height(sEnd) - section.depth - 0.3;
    const c = frame.point(sEnd + (dir * a.along) / 2, 0, 0);
    const ground = Math.min(b.ground(c.x, c.z), top - 4);
    const bottom = Math.max(ground, -8) - 2;
    b.opaque(
      (mb) => {
        mb.surface(Pal.concrete);
        mb.vBase = bottom;
        mb.box(c.x, (top + bottom) / 2, c.z, a.along / 2, (top - bottom) / 2, a.across / 2, frame.yaw, true, false);
        // cable entry housings
        for (const side of [-1, 1]) {
          const e = frame.point(sEnd + dir * 3, side * (spec.cable.x + 0.8), top - 1.5);
          mb.box(e.x, e.y, e.z, 4, 2.5, 2.2, frame.yaw, true, false);
        }
        mb.vBase = 0;
      },
      { lods: 1 },
    );
    b.boxCollider(c.x, (top + bottom) / 2, c.z, a.along / 2, (top - bottom) / 2, a.across / 2, frame.yaw);
  }

  // piers under the unsuspended side spans and the approaches
  buildPiers(b, frame, section, height, spec.pierSurface, pierStations(sTowerA, s0, spec.pierSpacing, [sEndA]));
  buildPiers(b, frame, section, height, spec.pierSurface, pierStations(sTowerB, s1, spec.pierSpacing, [sEndB]));
}

/** Pier stations from a tower outward to the approach end (excluding the tower and the anchorage itself). */
function pierStations(sTower: number, sEnd: number, spacing: number, skip: readonly number[]): number[] {
  const dir = Math.sign(sEnd - sTower);
  const len = Math.abs(sEnd - sTower);
  const out: number[] = [];
  const n = Math.floor(len / spacing);
  for (let k = 1; k <= n; k++) {
    const s = sTower + dir * (len * k) / (n + 0.5);
    if (skip.some((q) => Math.abs(q - s) < spacing * 0.35)) {
      continue;
    }
    out.push(s);
  }
  return out;
}
