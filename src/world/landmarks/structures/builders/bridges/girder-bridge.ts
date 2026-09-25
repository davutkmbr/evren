/**
 * Generic girder bridge on piers (Golden Horn bridges). Anchors: [mainPierA, mainPierB, endA, endB]; the frame is
 * centred between the main piers, the deck runs from end to end (plus approaches until the terrain is met).
 * Bridge-specific details are added through the `extras` callback with the solved geometry.
 */
import type { StructureBuild } from '../../build/context';
import { BridgeFrame } from '../../build/bridge-frame';
import type { SurfaceState } from '../../build/mesh-builder';
import { buildDeck, type DeckSection } from './deck';
import { buildPiers, type PierOptions } from './piers';
import { DeckProfile } from './profile';

export interface GirderBridgeSpec {
  section: DeckSection;
  /** Road height at the centre of the main span. */
  hMid: number;
  crestRadius: number;
  minEnd: number;
  maxApproach: number;
  maxGrade: number;
  pierSpacing: number;
  pierSurface: SurfaceState;
  pier?: PierOptions;
  /** Skip regular piers within this distance of the main piers (main piers are built by extras). */
  mainPierClear: number;
  led?: { group: number; strength: number };
}

export interface GirderBridgeGeometry {
  frame: BridgeFrame;
  profile: DeckProfile;
  height: (s: number) => number;
  sPierA: number;
  sPierB: number;
  sEndA: number;
  sEndB: number;
  s0: number;
  s1: number;
}

export function buildGirderBridge(b: StructureBuild, spec: GirderBridgeSpec, extras?: (g: GirderBridgeGeometry) => void): GirderBridgeGeometry {
  const anchors = b.def.anchors ?? [];
  if (anchors.length < 4) {
    throw new Error('girder bridge needs 4 anchors');
  }
  const frame = BridgeFrame.fromPoints(anchors[0], anchors[1]);
  const sPierA = frame.sOf(anchors[0]);
  const sPierB = frame.sOf(anchors[1]);
  const sEndA = frame.sOf(anchors[2]);
  const sEndB = frame.sOf(anchors[3]);
  const section = spec.section;
  const profile = new DeckProfile(
    {
      hMid: spec.hMid,
      crestRadius: spec.crestRadius,
      sTowerA: sPierA,
      sTowerB: sPierB,
      sEndA,
      sEndB,
      maxApproach: spec.maxApproach,
      maxGrade: spec.maxGrade,
      depth: section.depth,
      minEnd: spec.minEnd,
    },
    frame,
    b.terrain,
  );
  const height = (s: number): number => profile.height(s);
  const grade = (s: number): number => profile.grade(s);
  const s0 = profile.startS;
  const s1 = profile.endS;
  buildDeck(b, frame, section, {
    s0,
    s1,
    height,
    grade,
    breaks: [sPierA, sPierB, sEndA, sEndB, 0],
    partLength: 200,
    led: spec.led ? { group: spec.led.group, u0: 0, u1: 1, strength: spec.led.strength } : undefined,
  });
  // Deck colliders: top at the drawn road surface (segmentCollider adds half the rise of each piece on top, so the
  // pieces stay short); taller or longer boxes left invisible kerbs on the deck and a step at each abutment.
  for (let s = s0; s < s1 - 1; s += 10) {
    const e = Math.min(s + 10, s1);
    const pa = frame.point(s, 0, height(s) - section.depth / 2);
    const pb = frame.point(e, 0, height(e) - section.depth / 2);
    b.segmentCollider(pa, pb, section.halfWidth, section.depth / 2);
  }
  const piers: number[] = [];
  for (const [from, to] of [
    [sPierA, s0],
    [sPierB, s1],
  ] as const) {
    const dir = Math.sign(to - from);
    const len = Math.abs(to - from);
    const n = Math.floor(len / spec.pierSpacing);
    for (let k = 1; k <= n; k++) {
      const s = from + (dir * len * k) / (n + 0.5);
      if (Math.abs(s - from) > spec.mainPierClear) {
        piers.push(s);
      }
    }
  }
  const mid = (sPierA + sPierB) / 2;
  const span = Math.abs(sPierB - sPierA);
  const inner = Math.max(0, Math.floor(span / spec.pierSpacing) - 1);
  for (let k = 1; k <= inner; k++) {
    piers.push(sPierA + ((sPierB - sPierA) * k) / (inner + 1));
  }
  void mid;
  buildPiers(b, frame, section, height, spec.pierSurface, piers.filter((s) => s < 0), spec.pier);
  buildPiers(b, frame, section, height, spec.pierSurface, piers.filter((s) => s >= 0), spec.pier);
  const geometry: GirderBridgeGeometry = { frame, profile, height, sPierA, sPierB, sEndA, sEndB, s0, s1 };
  extras?.(geometry);
  return geometry;
}
