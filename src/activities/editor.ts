/**
 * Course editor state (pure logic, no three.js / DOM): the gates and speed rings placed so far, the placement kind
 * (gate or speed ring) and gate size, undo, and building the CustomCourse on save.
 *
 * A placement takes the dragon's pose: position, and the flight direction (velocity) as the facing, pitch clamped to
 * MAX_GATE_PITCH; a hovering dragon uses its heading and a level facing. Each placement is checked against the world
 * right away (the colliders around the dragon are loaded then); an invalid one is still shown (red) so the player sees
 * why, and is skipped on save.
 */
import { SPEED_RING_RADIUS, compileCourse, facing, headingOf, type Gate, type SpeedRing } from './courses';
import {
  GATE_SIZES,
  GATE_SIZE_ORDER,
  MAX_GATES,
  MAX_GATE_PITCH,
  MAX_SPEED_RINGS,
  MIN_GATES,
  MIN_GATE_SPACING,
  customCourseDef,
  customCourseId,
  leadInClear,
  roundGate,
  roundRing,
  sanitizeName,
  validateRingPlacement,
  type CustomCourse,
  type CustomGate,
  type CustomRing,
  type GateSize,
  type PlacementProbe,
  type PlacementProblem,
} from './custom-courses';

export type EditorKind = 'gate' | 'ring';

export interface EditorPose {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Compass heading of the body (used when the dragon is nearly still). */
  headingDeg: number;
}

export interface EditorGate extends CustomGate {
  problem: PlacementProblem | null;
}

export interface EditorRing extends CustomRing {
  problem: PlacementProblem | null;
}

export type PlaceResult =
  | { ok: true; kind: EditorKind; index: number; problem: PlacementProblem | null }
  | { ok: false; kind: EditorKind; reason: 'limit' | 'spacing' | 'bounds' };

export type BuildResult =
  | { ok: true; course: CustomCourse; skippedGates: number; skippedRings: number }
  | { ok: false; error: 'tooFew' | 'leadIn'; valid: number; skippedGates: number };

/** Below this speed (m/s) the facing comes from the body heading instead of the velocity. */
const STILL_SPEED = 3;

/** Facing (heading, pitch in degrees) for a placement at this pose. */
export function poseFacing(pose: EditorPose): { h: number; p: number } {
  const hs = Math.hypot(pose.vx, pose.vz);
  if (Math.hypot(hs, pose.vy) < STILL_SPEED) {
    return { h: pose.headingDeg, p: 0 };
  }
  const p = (Math.atan2(pose.vy, hs) * 180) / Math.PI;
  return { h: hs > 1e-3 ? headingOf(pose.vx, pose.vz) : pose.headingDeg, p: Math.max(-MAX_GATE_PITCH, Math.min(MAX_GATE_PITCH, p)) };
}

export class CourseEditor {
  readonly gates: EditorGate[] = [];
  readonly rings: EditorRing[] = [];
  kind: EditorKind = 'gate';
  size: GateSize = 'medium';
  /** The saved course being edited (undefined for a new one). */
  sourceId?: string;
  sourceName?: string;
  /** Changed since the last load / save. */
  dirty = false;
  /** Placement order, for undo. */
  private readonly order: EditorKind[] = [];

  /** Starts over, empty or from a saved course. */
  reset(from?: CustomCourse): void {
    this.gates.length = 0;
    this.rings.length = 0;
    this.order.length = 0;
    this.kind = 'gate';
    this.dirty = false;
    this.sourceId = from?.id;
    this.sourceName = from?.name;
    if (from) {
      for (const g of from.gates) {
        this.gates.push({ ...g, problem: null });
        this.order.push('gate');
      }
      for (const r of from.rings) {
        this.rings.push({ ...r, problem: null });
        this.order.push('ring');
      }
    }
  }

  toggleKind(): EditorKind {
    this.kind = this.kind === 'gate' ? 'ring' : 'gate';
    return this.kind;
  }

  cycleSize(): GateSize {
    this.size = GATE_SIZE_ORDER[(GATE_SIZE_ORDER.indexOf(this.size) + 1) % GATE_SIZE_ORDER.length];
    return this.size;
  }

  get radius(): number {
    return this.kind === 'ring' ? SPEED_RING_RADIUS : GATE_SIZES[this.size];
  }

  /** Places the current kind at the pose. */
  place(pose: EditorPose, probe: PlacementProbe): PlaceResult {
    const kind = this.kind;
    const { h, p } = poseFacing(pose);
    if (kind === 'gate') {
      if (this.gates.length >= MAX_GATES) {
        return { ok: false, kind, reason: 'limit' };
      }
      const g = roundGate({ x: pose.x, y: pose.y, z: pose.z, r: GATE_SIZES[this.size], h, p });
      const last = this.gates[this.gates.length - 1];
      if (last && Math.hypot(g.x - last.x, g.y - last.y, g.z - last.z) < MIN_GATE_SPACING) {
        return { ok: false, kind, reason: 'spacing' };
      }
      const problem = validateRingPlacement(g.x, g.y, g.z, g.r, g.h, g.p, probe);
      if (problem === 'bounds') {
        return { ok: false, kind, reason: 'bounds' };
      }
      this.gates.push({ ...g, problem });
      this.order.push('gate');
      this.dirty = true;
      return { ok: true, kind, index: this.gates.length - 1, problem };
    }
    if (this.rings.length >= MAX_SPEED_RINGS) {
      return { ok: false, kind, reason: 'limit' };
    }
    const r = roundRing({ x: pose.x, y: pose.y, z: pose.z, h, p });
    const problem = validateRingPlacement(r.x, r.y, r.z, SPEED_RING_RADIUS, r.h, r.p, probe);
    if (problem === 'bounds') {
      return { ok: false, kind, reason: 'bounds' };
    }
    this.rings.push({ ...r, problem });
    this.order.push('ring');
    this.dirty = true;
    return { ok: true, kind, index: this.rings.length - 1, problem };
  }

  /** Removes the last placed gate or ring; returns what was removed (null when empty). */
  undo(): EditorKind | null {
    const kind = this.order.pop();
    if (!kind) {
      return null;
    }
    if (kind === 'gate') {
      this.gates.pop();
    } else {
      this.rings.pop();
    }
    this.dirty = true;
    return kind;
  }

  get validGates(): number {
    return this.gates.filter((g) => !g.problem).length;
  }

  /** Length of the gate-to-gate legs placed so far (m, all gates in order). */
  get length(): number {
    let sum = 0;
    for (let i = 1; i < this.gates.length; i++) {
      const a = this.gates[i - 1];
      const b = this.gates[i];
      sum += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    return sum;
  }

  /**
   * Builds the course to save: gates and rings are re-checked with `probe` (terrain everywhere; colliders only where
   * they are loaded, so the placement-time result is kept too) and invalid ones are skipped. Needs MIN_GATES valid
   * gates and a clear lead-in behind the first one.
   */
  build(name: string, probe: PlacementProbe): BuildResult {
    const recheck = <T extends CustomGate | CustomRing>(v: T & { problem: PlacementProblem | null }, r: number): boolean =>
      !v.problem && !validateRingPlacement(v.x, v.y, v.z, r, v.h, v.p, probe);
    const gates: CustomGate[] = [];
    let skippedGates = 0;
    for (const g of this.gates) {
      const last = gates[gates.length - 1];
      const spaced = !last || Math.hypot(g.x - last.x, g.y - last.y, g.z - last.z) >= MIN_GATE_SPACING;
      if (recheck(g, g.r) && spaced) {
        gates.push({ x: g.x, y: g.y, z: g.z, r: g.r, h: g.h, p: g.p });
      } else {
        g.problem ??= 'terrain';
        skippedGates++;
      }
    }
    const rings: CustomRing[] = [];
    let skippedRings = 0;
    for (const r of this.rings) {
      if (recheck(r, SPEED_RING_RADIUS)) {
        rings.push({ x: r.x, y: r.y, z: r.z, h: r.h, p: r.p });
      } else {
        skippedRings++;
      }
    }
    if (gates.length < MIN_GATES) {
      return { ok: false, error: 'tooFew', valid: gates.length, skippedGates };
    }
    const course: CustomCourse = { id: customCourseId(gates, rings), name: sanitizeName(name), gates, rings };
    if (!leadInClear(compileCourse(customCourseDef(course)), probe.terrainAt)) {
      return { ok: false, error: 'leadIn', valid: gates.length, skippedGates };
    }
    return { ok: true, course, skippedGates, skippedRings };
  }

  /** Gates as ring-renderer input (index order; invalid ones included). */
  previewGates(): Gate[] {
    return this.gates.map((g, i) => {
      const d = facing(g.h, g.p);
      return { index: i, x: g.x, y: g.y, z: g.z, radius: g.r, nx: d[0], ny: d[1], nz: d[2] };
    });
  }

  previewRings(): SpeedRing[] {
    return this.rings.map((r, i) => {
      const d = facing(r.h, r.p);
      return { index: i, x: r.x, y: r.y, z: r.z, radius: SPEED_RING_RADIUS, nx: d[0], ny: d[1], nz: d[2] };
    });
  }
}
