/**
 * Bridge deck generator: girder cross-section swept along the vertical alignment, carriageway / track / walkway
 * strips with procedural markings, crash barriers, pedestrian railings (wires), lamp posts with lamp pools, fascia
 * LEDs and night traffic light streams. Split into culling parts of limited length, each with a detailed and a
 * simplified LOD.
 */
import * as THREE from 'three';
import type { StructureBuild } from '../../build/context';
import type { BridgeFrame } from '../../build/bridge-frame';
import { stations } from '../../build/bridge-frame';
import { type DeckLayout, jointBreaks, jointColumns, jointOffset, lateralShift, solveDeckJoints } from '../../build/deck-joint';
import type { MeshBuilder, SurfaceState, SweepFrame } from '../../build/mesh-builder';
import { Emit, kelvin, LightMode } from '../../build/surfaces';
import { Color, Pal, withEmit } from '../palette';
import { Surf } from '../../build/surfaces';
import type { DeckJoint, JointLine } from '../../types';

export interface DeckStrip {
  x0: number;
  x1: number;
  kind: 'road' | 'rail' | 'walk' | 'plain';
  lanes?: number;
  /** Half width of the median measured from the strip's lane reference line (road shader). */
  medianHalf?: number;
  /** Height of the strip surface above the road surface (walkway curbs). */
  raise?: number;
  surface?: SurfaceState;
}

export interface DeckBarrier {
  x: number;
  kind: 'jersey' | 'steel' | 'parapet';
}

export interface DeckLamps {
  /** Lamp lines: lateral position of the pole and signed arm direction (+1 = arm reaches toward +x). */
  lines: ReadonlyArray<{ x: number; arm: 1 | -1 }>;
  spacing: number;
  /** Station of one lamp (others at +-k * spacing). */
  phase: number;
  height: number;
  /** Arm length toward the carriageway (m). */
  arm: number;
  kelvin: number;
  /** Radiance of the luminaire sprite. */
  intensity: number;
  /** Lamp-pool strength on the road surface. */
  pool: number;
}

export interface DeckTraffic {
  lanes: ReadonlyArray<{ x: number; dir: 1 | -1 }>;
  /** Mean car spacing (m). */
  spacing: number;
  speed: number;
}

export interface DeckSection {
  /** Open girder profile (x right, y up; road surface at y = 0), from the left top edge around the soffit. */
  girder: ReadonlyArray<readonly [number, number]>;
  girderLow: ReadonlyArray<readonly [number, number]>;
  girderMat: SurfaceState;
  strips: readonly DeckStrip[];
  barriers: readonly DeckBarrier[];
  railings: ReadonlyArray<{ x: number; height: number; raise: number }>;
  lamps?: DeckLamps;
  traffic?: DeckTraffic;
  /** Depth of the girder below the road surface (for piers/colliders). */
  depth: number;
  halfWidth: number;
}

export interface DeckOptions {
  s0: number;
  s1: number;
  height: (s: number) => number;
  grade: (s: number) => number;
  /** Stations where the frames must break (tower faces, joints). */
  breaks?: readonly number[];
  partLength?: number;
  /** LED fascia strip: group, LED u at s0/s1, strength. */
  led?: { group: number; u0: number; u1: number; strength: number };
  /** Cull distance for the fine parts (m). */
  cullDistance?: number;
  /** Exclude lamps / traffic within these station ranges (e.g. bascule openings). */
  seed?: number;
}

const JERSEY: ReadonlyArray<readonly [number, number]> = [
  [-0.3, 0],
  [0.3, 0],
  [0.26, 0.08],
  [0.11, 0.33],
  [0.08, 0.84],
  [-0.08, 0.84],
  [-0.11, 0.33],
  [-0.26, 0.08],
];

const PARAPET: ReadonlyArray<readonly [number, number]> = [
  [-0.22, 0],
  [0.22, 0],
  [0.22, 1.05],
  [0.16, 1.12],
  [-0.16, 1.12],
  [-0.22, 1.05],
];

const STEEL_RAIL: ReadonlyArray<readonly [number, number]> = [
  [-0.09, 0.52],
  [0.09, 0.52],
  [0.09, 0.84],
  [-0.09, 0.84],
];

function offsetProfile(p: ReadonlyArray<readonly [number, number]>, dx: number, dy: number): Array<[number, number]> {
  return p.map(([x, y]) => [x + dx, y + dy]);
}

function stripSurface(strip: DeckStrip, lamps: DeckLamps | undefined): SurfaceState {
  if (strip.surface) {
    return strip.surface;
  }
  if (strip.kind === 'road') {
    const road = { ...Pal.road, param: strip.lanes ?? 2, metal: strip.medianHalf ?? 0.6 };
    return lamps ? withEmit(road, Emit.RoadLamps, lamps.spacing, lamps.phase, lamps.pool) : road;
  }
  if (strip.kind === 'rail') {
    return Pal.railTrack;
  }
  if (strip.kind === 'walk') {
    return Pal.walkway;
  }
  return Pal.concrete;
}

/** Frames offset vertically (strip raise) - the sweep frames are shared, so lift along each frame's up axis. */
function raised(frames: readonly SweepFrame[], dy: number): SweepFrame[] {
  if (dy === 0) {
    return frames as SweepFrame[];
  }
  return frames.map((f) => ({ ...f, p: f.p.clone().addScaledVector(f.up, dy) }));
}

/** Closes the girder cross-section at station s (road surface height y), facing `dir` along the axis. */
function endCap(mb: MeshBuilder, frame: BridgeFrame, section: DeckSection, lod: number, s: number, y: number, dir: number): void {
  const profile = lod === 0 ? section.girder : section.girderLow;
  const pts = profile.map(([x, dy]) => frame.point(s, x, y + dy));
  mb.surface(section.girderMat);
  mb.polygonOutward(pts, frame.point(s - dir, 0, y - section.depth / 2));
}

function buildGirder(mb: MeshBuilder, section: DeckSection, frames: readonly SweepFrame[], lod: number, led: DeckOptions['led'], s0: number, s1: number): void {
  const profile = lod === 0 ? section.girder : section.girderLow;
  mb.surface(section.girderMat);
  mb.sweep(profile, frames, false);
  if (led && lod === 0) {
    // LED strip on both fascias just under the deck edge
    const hw = section.halfWidth;
    for (const side of [-1, 1]) {
      const ledFrames = frames.map((f) => ({ ...f }));
      const u0 = led.u0;
      const u1 = led.u1;
      const x = side * (hw + 0.02);
      for (let i = 0; i < ledFrames.length - 1; i++) {
        const a = ledFrames[i];
        const b = ledFrames[i + 1];
        const ua = u0 + ((u1 - u0) * (a.s - s0)) / (s1 - s0);
        mb.surface(withEmit(Pal.bridgeSteelDark, Emit.Led, led.group, ua, led.strength * 0.5));
        const pa0 = a.p.clone().addScaledVector(a.right, x).addScaledVector(a.up, -0.35);
        const pa1 = a.p.clone().addScaledVector(a.right, x).addScaledVector(a.up, -0.15);
        const pb0 = b.p.clone().addScaledVector(b.right, x).addScaledVector(b.up, -0.35);
        const pb1 = b.p.clone().addScaledVector(b.right, x).addScaledVector(b.up, -0.15);
        const n = a.right.clone().multiplyScalar(side);
        const i0 = mb.vtx(pa0, n, 0, a.s);
        const i1 = mb.vtx(pa1, n, 0.2, a.s);
        const i2 = mb.vtx(pb1, n, 0.2, b.s);
        const i3 = mb.vtx(pb0, n, 0, b.s);
        mb.quad(i0, i1, i2, i3);
      }
    }
  }
}

function buildLampPost(mb: MeshBuilder, frame: BridgeFrame, s: number, x: number, armDir: number, y: number, lamps: DeckLamps): void {
  const side = -armDir;
  const base = frame.point(s, x, y);
  mb.surface(Pal.lampGrey);
  mb.cylinder(base.x, base.y, base.z, 0.13, 0.08, lamps.height, 8, false, false);
  mb.cylinder(base.x, base.y, base.z, 0.2, 0.18, 0.45, 8, true, false);
  // arm (tapered box) toward the road, slightly rising
  const armEnd = frame.point(s, x - side * lamps.arm, y + lamps.height + 0.25);
  const armStart = frame.point(s, x, y + lamps.height - 0.1);
  const mid = armStart.clone().add(armEnd).multiplyScalar(0.5);
  const len = armStart.distanceTo(armEnd);
  const pitch = Math.atan2(armEnd.y - armStart.y, len);
  const m = new THREE.Matrix4()
    .makeTranslation(mid.x, mid.y, mid.z)
    .multiply(new THREE.Matrix4().makeRotationY(frame.yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2)))
    .multiply(new THREE.Matrix4().makeRotationZ(pitch));
  mb.pushTransform(m);
  mb.box(0, 0, 0, len / 2, 0.06, 0.05, 0, false, false);
  mb.popTransform();
  // luminaire head
  const head = frame.point(s, x - side * lamps.arm, y + lamps.height + 0.2);
  mb.surface(Pal.darkMetal);
  mb.box(head.x, head.y, head.z, 0.18, 0.07, 0.35, frame.yaw + Math.PI / 2, false, false);
  mb.surface(withEmit(Pal.whitePaint, Emit.Glow, 6));
  mb.box(head.x, head.y - 0.075, head.z, 0.12, 0.006, 0.26, frame.yaw + Math.PI / 2, false, true);
}

/**
 * Builds the deck between s0 and s1. Returns the frames of the finest LOD (for hanger anchorage etc.).
 */
/** Length (m) of one deck collider piece: short, so a sloped piece's box barely rises above the drawn road. */
const DECK_COLLIDER_PIECE = 10;

/**
 * Deck colliders of every bridge type, derived from the drawn deck: boxes along the axis whose top is the road surface
 * `height(s)` and whose bottom is the girder soffit (`section.depth` below), `halfWidth` wide, in DECK_COLLIDER_PIECE
 * pieces from s0 to s1. `sectionAt` switches sections along the deck (e.g. a wider station).
 */
export function buildDeckColliders(b: StructureBuild, frame: BridgeFrame, s0: number, s1: number, height: (s: number) => number, sectionAt: (s: number) => DeckSection): void {
  for (let s = s0; s < s1 - 1e-3; s += DECK_COLLIDER_PIECE) {
    const e = Math.min(s + DECK_COLLIDER_PIECE, s1);
    const section = sectionAt((s + e) / 2);
    const half = section.depth / 2;
    // segmentCollider adds half the rise of the piece on top of `half` around the midpoint of a and b.
    b.segmentCollider(frame.point(s, 0, height(s) - half), frame.point(e, 0, height(e) - half), section.halfWidth, half);
  }
}

/** Painted lane line pitch of the road shader (surface.glsl.ts structRoad). */
const ROAD_LANE_WIDTH = 3.65;

/**
 * The lines the deck's surface shaders draw (tram track centres of rail strips, dashed lane lines of road strips) and
 * the lateral positions that must not move under a joint's lateral warp (lamp lines, railings, walkway strips and the
 * deck edges).
 */
export function deckLayout(section: DeckSection): DeckLayout {
  const lines: JointLine[] = [];
  const inStrip = (st: DeckStrip, x: number): boolean => x > Math.min(st.x0, st.x1) && x < Math.max(st.x0, st.x1);
  for (const st of section.strips) {
    const surface = stripSurface(st, undefined);
    if (st.kind === 'rail' && surface.surf === Surf.Rail) {
      // structRail: track centres at |u| = spacing / 2 (one track at u = 0 without spacing).
      for (const x of surface.param > 0 ? [-surface.param / 2, surface.param / 2] : [0]) {
        if (inStrip(st, x)) {
          lines.push({ x, kind: 'track' });
        }
      }
    } else if (st.kind === 'road' && surface.surf === Surf.Road) {
      // structRoad: dashed lane lines at |u| = medianHalf + 0.6 + k lane widths, k = 1 .. lanes - 1.
      const inner = surface.metal + 0.6;
      for (let k = 1; k < surface.param; k++) {
        for (const x of [-(inner + k * ROAD_LANE_WIDTH), inner + k * ROAD_LANE_WIDTH]) {
          if (inStrip(st, x)) {
            lines.push({ x, kind: 'lane' });
          }
        }
      }
    }
  }
  // Barriers between carriageways and tracks move with the surface they divide; kerbed walkways and what stands on
  // them do not.
  const anchors = new Set<number>([-section.halfWidth, section.halfWidth]);
  for (const l of section.lamps?.lines ?? []) {
    anchors.add(l.x);
  }
  for (const r of section.railings) {
    anchors.add(r.x);
  }
  for (const st of section.strips) {
    if ((st.raise ?? 0) > 0 || st.kind === 'walk') {
      anchors.add(st.x0);
      anchors.add(st.x1);
    }
  }
  return { lines, anchors: [...anchors].sort((a, b) => a - b) };
}

/** Vertices this high (m) above the deck belong to fixtures (lamp arms and heads): they follow the walkway they stand on. */
const FIXTURE_HEIGHT = 2;

/**
 * Surface level (m above the road surface) a deck vertex at lateral x, `dy` above the road surface belongs to: the
 * raise of the walkway strip it lies on or stands on (its curb face: the top edge), else 0.
 */
function levelOf(section: DeckSection, x: number, dy: number): number {
  let level = 0;
  for (const st of section.strips) {
    const r = st.raise ?? 0;
    if (r <= 0) {
      continue;
    }
    const inside = x > st.x0 + 1e-3 && x < st.x1 - 1e-3;
    const edge = !inside && x > st.x0 - 1e-3 && x < st.x1 + 1e-3;
    const near = dy > FIXTURE_HEIGHT && x > st.x0 - FIXTURE_HEIGHT && x < st.x1 + FIXTURE_HEIGHT;
    if (inside || (edge && dy > r * 0.5) || near) {
      level = Math.max(level, r);
    }
  }
  return level;
}

/** Point on the deck at station s, deck lateral x, `dy` above the road surface, with its joints' warp and twist applied. */
export function deckPoint(frame: BridgeFrame, joints: readonly DeckJoint[], height: (s: number) => number, s: number, x: number, dy: number): THREE.Vector3 {
  const l = x + lateralShift(joints, s, x);
  return frame.point(s, l, height(s) + dy + jointOffset(joints, s, l));
}

/** Builds the deck and returns its joints (deckPoint() places fixtures of other builders on the twisted deck). */
export function buildDeck(b: StructureBuild, frame: BridgeFrame, section: DeckSection, opts: DeckOptions): DeckJoint[] {
  const partLength = opts.partLength ?? 320;
  const n = Math.max(1, Math.round((opts.s1 - opts.s0) / partLength));
  const cull = opts.cullDistance ?? 30000;
  // Landed ends twist into the drawn ground (build/deck-joint.ts): denser frames there, lateral vertex columns where
  // the ground profile bends, and every vertex of the part raised by the joint offset of the surface it belongs to.
  const surfaceLevel = (x: number): number => Math.max(0, ...section.strips.filter((st) => x >= st.x0 && x <= st.x1).map((st) => st.raise ?? 0));
  const layout = deckLayout(section);
  const joints = solveDeckJoints(frame, b.terrain, opts.height, opts.s0, opts.s1, section.halfWidth, b.jointGrounds, surfaceLevel, layout);
  const breaks = [...(opts.breaks ?? []), ...jointBreaks(joints)];
  const lamps = section.lamps;
  const surfaceAt = (s: number, x: number, dy = 0): number => opts.height(s) + dy + jointOffset(joints, s, x, levelOf(section, x, dy));
  for (let k = 0; k < n; k++) {
    const a = opts.s0 + ((opts.s1 - opts.s0) * k) / n;
    const c = opts.s0 + ((opts.s1 - opts.s0) * (k + 1)) / n;
    const partJoints = joints.filter((j) => (j.s - a) * (j.s - c) <= 0 || Math.min(Math.abs(j.s - a), Math.abs(j.s - c)) < Math.max(j.length, j.lateral?.length ?? 0));
    const cuts = jointColumns(partJoints);
    b.opaque(
      (mb, lod) => {
        const st = stations(a, c, lod === 0 ? 8 : 40, breaks);
        const frames = frame.frames(st, opts.height, opts.grade);
        mb.vBase = 0;
        buildGirder(mb, section, frames, lod, opts.led, opts.s0, opts.s1);
        // End faces: a deck end never shows an open girder, whether it stands free or meets sloping ground.
        for (const [s, first] of [
          [opts.s0, k === 0],
          [opts.s1, k === n - 1],
        ] as const) {
          if (first) {
            endCap(mb, frame, section, lod, s, opts.height(s), s === opts.s0 ? -1 : 1);
          }
        }
        for (const strip of section.strips) {
          mb.surface(stripSurface(strip, lamps));
          const f = raised(frames, strip.raise ?? 0);
          mb.ribbon(f, strip.x0, strip.x1, 0, cuts);
          if ((strip.raise ?? 0) > 0.02 && lod === 0) {
            // curb faces
            mb.surface(Pal.barrier);
            const r = strip.raise ?? 0;
            for (const x of [strip.x0, strip.x1]) {
              mb.sweep(
                [
                  [x, 0],
                  [x, r],
                ],
                frames,
                false,
              );
            }
          }
        }
        if (lod === 0) {
          for (const bar of section.barriers) {
            if (bar.kind === 'jersey') {
              mb.surface(Pal.barrier);
              mb.sweep(offsetProfile(JERSEY, bar.x, 0), frames, true);
            } else if (bar.kind === 'parapet') {
              mb.surface(Pal.barrier);
              mb.sweep(offsetProfile(PARAPET, bar.x, 0), frames, true);
            } else {
              mb.surface(Pal.galvanized);
              mb.sweep(offsetProfile(STEEL_RAIL, bar.x, 0), frames, true);
            }
          }
          if (lamps) {
            const first = Math.ceil((a - lamps.phase) / lamps.spacing);
            for (let i = first; lamps.phase + i * lamps.spacing < c; i++) {
              const s = lamps.phase + i * lamps.spacing;
              for (const line of lamps.lines) {
                buildLampPost(mb, frame, s, line.x, line.arm, opts.height(s), lamps);
              }
            }
          }
        } else {
          for (const bar of section.barriers) {
            mb.surface(Pal.barrier);
            mb.sweep(
              [
                [bar.x - 0.25, 0],
                [bar.x, 0.85],
                [bar.x + 0.25, 0],
              ],
              frames,
              false,
            );
          }
        }
        if (partJoints.length > 0) {
          const p = { x: 0, z: 0 };
          if (partJoints.some((j) => j.lateral)) {
            // Lateral warp first: the height offsets follow the ground at each vertex's final position.
            mb.displaceAlong(frame.rx, frame.rz, (x, _y, z) => {
              p.x = x;
              p.z = z;
              return lateralShift(partJoints, frame.sOf(p), frame.xOf(p));
            });
          }
          mb.displaceY((x, y, z) => {
            p.x = x;
            p.z = z;
            const s = frame.sOf(p);
            const l = frame.xOf(p);
            return jointOffset(partJoints, s, l, levelOf(section, l, y - opts.height(s)));
          });
        }
      },
      { cullDistance: cull, detailScale: 0.6 },
    );
  }

  // railings (wires)
  const st = stations(opts.s0, opts.s1, 10, breaks);
  for (const r of section.railings) {
    const top = st.map((s) => frame.point(s, r.x, surfaceAt(s, r.x, r.raise) + r.height));
    const mid = st.map((s) => frame.point(s, r.x, surfaceAt(s, r.x, r.raise) + r.height * 0.5));
    b.wires.polyline(top, 0.035, Color.railing, { fade: [2500, 5000] });
    b.wires.polyline(mid, 0.02, Color.railing, { fade: [600, 1200] });
    for (let s = opts.s0; s <= opts.s1; s += 2.4) {
      const p0 = frame.point(s, r.x, surfaceAt(s, r.x, r.raise));
      const p1 = frame.point(s, r.x, surfaceAt(s, r.x, r.raise) + r.height);
      b.wires.add(p0, p1, 0.022, Color.railing, { fade: [250, 500] });
    }
  }

  if (lamps) {
    const warm = kelvin(lamps.kelvin);
    const first = Math.ceil((opts.s0 - lamps.phase) / lamps.spacing);
    for (let i = first; lamps.phase + i * lamps.spacing <= opts.s1; i++) {
      const s = lamps.phase + i * lamps.spacing;
      for (const line of lamps.lines) {
        const p = frame.point(s, line.x + line.arm * lamps.arm, surfaceAt(s, line.x, lamps.height + 0.05));
        b.lights.add(p, [warm[0] * lamps.intensity, warm[1] * lamps.intensity, warm[2] * lamps.intensity], 0.22);
      }
    }
  }

  if (section.traffic) {
    addTraffic(b, frame, section.traffic, opts);
  }
  publishRoadDeck(b, frame, section, opts, joints);
  recordEnds(b, frame, section, opts, joints);
  return joints;
}

/** Both ends of the deck with its strips (joint checks: window.__structures.ends in dev). */
function recordEnds(b: StructureBuild, frame: BridgeFrame, section: DeckSection, opts: DeckOptions, joints: readonly DeckJoint[]): void {
  const strips = section.strips.map((st) => ({
    x0: st.x0,
    x1: st.x1,
    kind: st.kind,
    raise: st.raise ?? 0,
    lanes: st.lanes ?? 0,
    medianHalf: st.medianHalf ?? 0,
    param: stripSurface(st, undefined).param,
  }));
  for (const [s, dir] of [
    [opts.s0, -1],
    [opts.s1, 1],
  ] as const) {
    const landed = joints.some((j) => j.s === s);
    const fixtures = [...section.barriers.map((q) => q.x), ...(section.lamps?.lines.map((q) => q.x) ?? [])].map((x) => x + lateralShift(joints, s, x));
    const lines = deckLayout(section).lines.map((l) => ({ x: l.x + lateralShift(joints, s, l.x), kind: l.kind }));
    const ground = b.jointGrounds.find((g) => Math.abs(g.s - s) < 1e-3 && Math.abs(g.ox - frame.ox) < 1e-3 && Math.abs(g.oz - frame.oz) < 1e-3)?.lines ?? [];
    b.ends.push({ id: b.def.id, ox: frame.ox, oz: frame.oz, ax: frame.ax, az: frame.az, s, dir, height: opts.height(s), halfWidth: section.halfWidth, landed, strips, fixtures, lines, groundLines: ground });
  }
}

/** Height sample spacing of the published road surface (m); the rendered LOD0 deck is linear over <= 8 m. */
const SURFACE_STEP = 4;

/** Records the carriageway of a road deck (height profile, lanes, raised walkways) for the 'roadSurface' service. */
function publishRoadDeck(b: StructureBuild, frame: BridgeFrame, section: DeckSection, opts: DeckOptions, joints: DeckJoint[]): void {
  const roads = section.strips.filter((st) => st.kind === 'road');
  if (roads.length === 0 || opts.s1 - opts.s0 < 1) {
    return;
  }
  const n = Math.max(2, Math.ceil((opts.s1 - opts.s0) / SURFACE_STEP) + 1);
  const step = (opts.s1 - opts.s0) / (n - 1);
  const heights = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    heights[i] = opts.height(opts.s0 + i * step);
  }
  const raised: number[] = [];
  for (const st of section.strips) {
    if ((st.raise ?? 0) > 0) {
      raised.push(st.x0, st.x1, st.raise ?? 0);
    }
  }
  const lanes = section.traffic ? section.traffic.lanes.map((l) => ({ x: l.x, dir: l.dir })) : [];
  b.decks.push({
    id: b.decks.length === 0 ? b.def.id : `${b.def.id}#${b.decks.length}`,
    ox: frame.ox,
    oz: frame.oz,
    ax: frame.ax,
    az: frame.az,
    s0: opts.s0,
    step,
    heights,
    halfWidth: section.halfWidth,
    roadX0: Math.min(...roads.map((st) => st.x0)),
    roadX1: Math.max(...roads.map((st) => st.x1)),
    raised,
    lanes,
    joints,
  });
}

/**
 * Vehicle light streams. Every lane is cut into equal chunks whose length is a whole number of car spacings, so the
 * cars of chunk k leave exactly when those of chunk k+1 appear (see LightMode.Traffic in render/lights.ts).
 */
function addTraffic(b: StructureBuild, frame: BridgeFrame, traffic: DeckTraffic, opts: DeckOptions): void {
  const rng = b.rng;
  const total = opts.s1 - opts.s0;
  for (const lane of traffic.lanes) {
    const spacing = traffic.spacing * (0.7 + rng() * 0.8);
    const perChunk = Math.max(1, Math.round(90 / spacing));
    const chunk = perChunk * spacing;
    const chunks = Math.max(1, Math.round(total / chunk));
    const len = total / chunks;
    const speed = traffic.speed * (0.8 + rng() * 0.35);
    const lanePhase = rng();
    const present: boolean[] = [];
    for (let j = 0; j < perChunk; j++) {
      present.push(rng() > 0.18);
    }
    for (let c = 0; c < chunks; c++) {
      let sa = opts.s0 + c * len;
      let sb = sa + len;
      if (lane.dir < 0) {
        [sa, sb] = [sb, sa];
      }
      const pa = frame.point(sa, lane.x, opts.height(sa) + 0.75);
      const pb = frame.point(sb, lane.x, opts.height(sb) + 0.75);
      const sm = (sa + sb) / 2;
      const bulge = opts.height(sm) - (opts.height(sa) + opts.height(sb)) / 2;
      const vec = pb.clone().sub(pa);
      for (let j = 0; j < perChunk; j++) {
        if (!present[j]) {
          continue;
        }
        const phase = (j + lanePhase) / perChunk;
        for (const off of [-0.75, 0.75]) {
          const p = pa.clone().addScaledVector(frame.right, off);
          b.lights.add(p, [2.2, 0, 0], 0.09, LightMode.Traffic, [speed, phase, 0, 0], [vec.x, vec.y, vec.z, bulge]);
        }
      }
    }
  }
}
