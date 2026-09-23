/**
 * Suspension / cable-stayed bridge towers:
 * - steel portal towers (15 Temmuz, FSM): two tapered box legs with chamfered corners, portal beams, saddle housings;
 * - concrete A towers (Yavuz Sultan Selim): inclined hollow legs meeting at the apex, lower cross beam under the deck.
 * Legs are lofted from chamfered rectangular rings; the cross-section tapers linearly with height.
 */
import * as THREE from 'three';
import type { StructureBuild } from '../../build/context';
import type { BridgeFrame } from '../../build/bridge-frame';
import type { MeshBuilder, SurfaceState } from '../../build/mesh-builder';
import { Emit } from '../../build/surfaces';
import { Pal, withEmit } from '../palette';

/** Chamfered rectangle ring (dimensions along the bridge axis `da` and across `dt`) centred at (s, x, y). */
function legRing(frame: BridgeFrame, s: number, x: number, y: number, da: number, dt: number, chamfer: number, simple: boolean): THREE.Vector3[] {
  const ha = da / 2;
  const ht = dt / 2;
  const c = Math.min(chamfer, ha * 0.4, ht * 0.4);
  const pts: Array<[number, number]> = simple
    ? [
        [ha, -ht],
        [ha, ht],
        [-ha, ht],
        [-ha, -ht],
      ]
    : [
        [ha, -ht + c],
        [ha, ht - c],
        [ha - c, ht],
        [-ha + c, ht],
        [-ha, ht - c],
        [-ha, -ht + c],
        [-ha + c, -ht],
        [ha - c, -ht],
      ];
  return pts.map(([a, t]) => frame.point(s + a, x + t, y));
}

export interface LegSpec {
  /** Station of the tower centre line. */
  s: number;
  /** Lateral position of the leg axis at the base and at the top. */
  xBase: number;
  xTop: number;
  yBase: number;
  yTop: number;
  /** Leg size along the bridge / across at base and top. */
  daBase: number;
  daTop: number;
  dtBase: number;
  dtTop: number;
  chamfer: number;
  surface: SurfaceState;
  /** LED wash: group, LED u coordinate, strength (0 = none). */
  led?: { group: number; u: number; strength: number };
}

function legAt(spec: LegSpec, y: number): { x: number; da: number; dt: number } {
  const t = (y - spec.yBase) / (spec.yTop - spec.yBase);
  return {
    x: spec.xBase + (spec.xTop - spec.xBase) * t,
    da: spec.daBase + (spec.daTop - spec.daBase) * t,
    dt: spec.dtBase + (spec.dtTop - spec.dtBase) * t,
  };
}

export function buildLeg(mb: MeshBuilder, frame: BridgeFrame, spec: LegSpec, lod: number, capTop = true): void {
  const rings: THREE.Vector3[][] = [];
  const levels = 1;
  for (let i = 0; i <= levels; i++) {
    const y = spec.yBase + ((spec.yTop - spec.yBase) * i) / levels;
    const l = legAt(spec, y);
    rings.push(legRing(frame, spec.s, l.x, y, l.da, l.dt, spec.chamfer, lod > 0));
  }
  mb.vBase = spec.yBase;
  const surf = spec.led ? withEmit(spec.surface, Emit.Led, spec.led.group, spec.led.u, spec.led.strength) : spec.surface;
  mb.surface(surf);
  mb.loft(rings, { closed: true, smooth: false, capEnd: capTop, vMode: 'y' });
  mb.vBase = 0;
}

/** Horizontal beam between two legs (box, chamfered bottom edges) at height y (centre), depth h, width along axis w. */
export function buildPortal(mb: MeshBuilder, frame: BridgeFrame, s: number, x0: number, x1: number, y: number, h: number, w: number, surface: SurfaceState, lod: number): void {
  mb.surface(surface);
  const cx = (x0 + x1) / 2;
  const half = Math.abs(x1 - x0) / 2;
  const c = frame.point(s, cx, y);
  if (lod > 0) {
    mb.box(c.x, c.y, c.z, w / 2, h / 2, half, frame.yaw, false, false);
    return;
  }
  // haunched portal: deeper at the legs, soffit arched between them
  const segs = 8;
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = x0 + (x1 - x0) * t;
    const arch = Math.sin(Math.PI * t);
    const bottom = y - h / 2 + h * 0.28 * arch;
    const top = y + h / 2;
    const hw = w / 2;
    const ch = Math.min(0.35, hw * 0.3);
    rings.push([
      frame.point(s + hw, x, bottom + ch),
      frame.point(s + hw, x, top),
      frame.point(s - hw, x, top),
      frame.point(s - hw, x, bottom + ch),
      frame.point(s - hw + ch, x, bottom),
      frame.point(s + hw - ch, x, bottom),
    ]);
  }
  mb.loft(rings, { closed: true, smooth: false, vMode: 'length', capStart: true, capEnd: true });
}

export interface PortalTowerSpec {
  s: number;
  yBase: number;
  yTop: number;
  /** Leg axis lateral offset (+-), top and base. */
  xTop: number;
  xBase: number;
  daBase: number;
  daTop: number;
  dtBase: number;
  dtTop: number;
  /** Portal beams: centre height, depth, width along axis. */
  portals: ReadonlyArray<{ y: number; h: number; w: number }>;
  surface: SurfaceState;
  led?: { group: number; u: number; strength: number };
  aviationPhase: number;
}

/** Steel portal tower; returns the saddle points (cable centreline at the top of each leg). */
export function buildPortalTower(b: StructureBuild, frame: BridgeFrame, t: PortalTowerSpec): THREE.Vector3[] {
  const legs: LegSpec[] = [-1, 1].map((side) => ({
    s: t.s,
    xBase: side * t.xBase,
    xTop: side * t.xTop,
    yBase: t.yBase,
    yTop: t.yTop,
    daBase: t.daBase,
    daTop: t.daTop,
    dtBase: t.dtBase,
    dtTop: t.dtTop,
    chamfer: 0.6,
    surface: t.surface,
    led: t.led,
  }));
  b.opaque(
    (mb, lod) => {
      for (const leg of legs) {
        buildLeg(mb, frame, leg, lod);
        // saddle housing
        const top = legAt(leg, leg.yTop);
        const c = frame.point(t.s, leg.xTop, leg.yTop + 1.2);
        mb.surface(t.surface);
        mb.box(c.x, c.y, c.z, top.da * 0.42, 1.2, top.dt * 0.42, frame.yaw, true, false);
      }
      for (const p of t.portals) {
        const l = legAt(legs[1], p.y);
        const inner = l.x - l.dt / 2 + 0.2;
        const surf = t.led ? withEmit(t.surface, Emit.Led, t.led.group, t.led.u, t.led.strength) : t.surface;
        buildPortal(mb, frame, t.s, -inner, inner, p.y, p.h, Math.min(l.da * 0.8, p.w), surf, lod);
      }
    },
    { detailScale: 1.2 },
  );
  for (const leg of legs) {
    const a = frame.point(t.s, leg.xBase, t.yBase);
    const c = frame.point(t.s, leg.xTop, t.yTop);
    const segments = 4;
    for (let i = 0; i < segments; i++) {
      const y0 = t.yBase + ((t.yTop - t.yBase) * i) / segments;
      const y1 = t.yBase + ((t.yTop - t.yBase) * (i + 1)) / segments;
      const l0 = legAt(leg, y0);
      const p0 = frame.point(t.s, l0.x, y0);
      const p1 = frame.point(t.s, legAt(leg, y1).x, y1);
      b.columnCollider(p0, p1, l0.da / 2, l0.dt / 2, frame.yaw);
    }
    void a;
    void c;
  }
  for (const p of t.portals) {
    const l = legAt(legs[1], p.y);
    const c = frame.point(t.s, 0, p.y);
    b.boxCollider(c.x, c.y, c.z, p.w / 2, p.h / 2, l.x, frame.yaw);
  }
  const saddles = legs.map((leg) => frame.point(t.s, leg.xTop, leg.yTop + 1.4));
  saddles.forEach((p, i) => b.lights.aviation(p.clone().setY(p.y + 1.3), t.aviationPhase + i * 0.02));
  return saddles;
}

export interface ATowerSpec {
  s: number;
  yBase: number;
  /** Apex (top of the concrete) height. */
  yTop: number;
  /** Height where the legs merge into the head. */
  yMerge: number;
  /** Leg axis lateral offset at the base (+-) and at the merge height. */
  xBase: number;
  xMerge: number;
  daBase: number;
  daTop: number;
  dtBase: number;
  dtTop: number;
  /** Cross beam under the deck (centre height, depth). */
  beamY: number;
  beamH: number;
  surface: SurfaceState;
  led?: { group: number; u: number; strength: number };
  aviationPhase: number;
}

/** Concrete A tower. Returns the leg description (for stay anchorages) and the saddle points. */
export function buildATower(b: StructureBuild, frame: BridgeFrame, t: ATowerSpec): { legs: LegSpec[]; saddles: THREE.Vector3[] } {
  const legs: LegSpec[] = [-1, 1].map((side) => ({
    s: t.s,
    xBase: side * t.xBase,
    xTop: side * t.xMerge,
    yBase: t.yBase,
    yTop: t.yMerge,
    daBase: t.daBase,
    daTop: t.daTop,
    dtBase: t.dtBase,
    dtTop: t.dtTop,
    chamfer: 1.2,
    surface: t.surface,
    led: t.led,
  }));
  const headW = t.xMerge * 2 + t.dtTop;
  b.opaque(
    (mb, lod) => {
      for (const leg of legs) {
        buildLeg(mb, frame, leg, lod, false);
      }
      // head: the legs merge into a single block that tapers to the apex
      const rings: THREE.Vector3[][] = [];
      const hs = [t.yMerge - 6, t.yMerge + (t.yTop - t.yMerge) * 0.55, t.yTop];
      const ws = [headW, headW * 0.82, headW * 0.5];
      const ds = [t.daTop, t.daTop * 0.95, t.daTop * 0.8];
      for (let i = 0; i < hs.length; i++) {
        rings.push(legRing(frame, t.s, 0, hs[i], ds[i], ws[i], 1.0, lod > 0));
      }
      mb.vBase = t.yBase;
      mb.surface(t.led ? withEmit(t.surface, Emit.Led, t.led.group, t.led.u, t.led.strength) : t.surface);
      mb.loft(rings, { closed: true, capEnd: true, vMode: 'y' });
      mb.vBase = 0;
      const l = legAt(legs[1], t.beamY);
      const inner = l.x - l.dt / 2 + 0.3;
      buildPortal(mb, frame, t.s, -inner, inner, t.beamY, t.beamH, l.da * 0.9, t.surface, lod);
    },
    { detailScale: 1.4 },
  );
  for (const leg of legs) {
    const segments = 8;
    for (let i = 0; i < segments; i++) {
      const y0 = t.yBase + ((t.yMerge - t.yBase) * i) / segments;
      const y1 = t.yBase + ((t.yMerge - t.yBase) * (i + 1)) / segments;
      const l0 = legAt(leg, (y0 + y1) / 2);
      b.columnCollider(frame.point(t.s, legAt(leg, y0).x, y0), frame.point(t.s, legAt(leg, y1).x, y1), l0.da / 2, l0.dt / 2, frame.yaw);
    }
  }
  const head = frame.point(t.s, 0, (t.yMerge + t.yTop) / 2);
  b.boxCollider(head.x, head.y, head.z, t.daTop / 2, (t.yTop - t.yMerge) / 2 + 6, headW / 2, frame.yaw);
  const beam = frame.point(t.s, 0, t.beamY);
  b.boxCollider(beam.x, beam.y, beam.z, t.daTop / 2, t.beamH / 2, legAt(legs[1], t.beamY).x, frame.yaw);
  const saddles = [-1, 1].map((side) => frame.point(t.s, side * headW * 0.22, t.yTop - 4));
  b.lights.aviation(frame.point(t.s, 0, t.yTop + 1.5), t.aviationPhase);
  b.lights.aviation(frame.point(t.s, -headW * 0.2, t.yTop - 2), t.aviationPhase + 0.03);
  b.lights.aviation(frame.point(t.s, headW * 0.2, t.yTop - 2), t.aviationPhase + 0.05);
  b.lights.obstruction(frame.point(t.s, -legAt(legs[1], t.yTop * 0.55).x - 3, t.yTop * 0.55));
  b.lights.obstruction(frame.point(t.s, legAt(legs[1], t.yTop * 0.55).x + 3, t.yTop * 0.55));
  return { legs, saddles };
}

export { legAt };
