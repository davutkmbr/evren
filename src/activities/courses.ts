/**
 * Ring race courses (phase 13 activities). Gates are authored at real coordinates (lat/lon, altitude in m above sea
 * level) and compiled into the local frame with latLonToLocal. Each gate's normal is the smoothed path direction (the
 * bisector of the incoming and outgoing legs), so the ring faces the racer on both sides of a turn.
 *
 * Pure data + math, no three.js: the headless check (tools/headless/races-check.ts) validates every course against the
 * real terrain and landmark volumes (clearance, spacing, turn angles).
 */
import { latLonToLocal } from '../core/geo-coords';

export type CourseId = 'bogaz' | 'halic' | 'adalar';

/** Custom (player-built) course ids start with this prefix (see custom-courses.ts). */
export const CUSTOM_ID_PREFIX = 'c-';

export interface GateDef {
  lat: number;
  lon: number;
  /** Centre altitude, m above sea level. */
  alt: number;
  /** Ring radius (m): the disc the racer must fly through. */
  radius: number;
  /** Optional Turkish caption for the landmark this gate frames (split toasts). */
  label?: string;
  /**
   * Explicit facing (custom courses: the flight direction when the gate was placed). Without it the normal is the
   * smoothed path direction.
   */
  headingDeg?: number;
  pitchDeg?: number;
}

/**
 * Speed ring (optional boost, not a gate): either a point on the straight leg from gate `leg` to gate `leg + 1` at
 * fraction `t` (built-in courses; faces along the leg) or an explicit position and facing (custom courses).
 */
export type SpeedRingDef =
  | { leg: number; t: number; radius?: number }
  | { lat: number; lon: number; alt: number; headingDeg: number; pitchDeg: number; radius?: number };

/** Default speed ring radius (m): smaller than any gate, so it reads as a bonus to aim for. */
export const SPEED_RING_RADIUS = 12;

export interface CourseDef {
  /** A CourseId for built-in courses, CUSTOM_ID_PREFIX + hash for player-built ones. */
  id: string;
  /** Turkish course name shown in the game. */
  name: string;
  /** One sentence Turkish description. */
  description: string;
  gates: readonly GateDef[];
  /** Optional boost rings (never required, not counted as gates). */
  speedRings?: readonly SpeedRingDef[];
  /** True for player-built courses. */
  custom?: boolean;
  /**
   * Medal target times (s, whole seconds). Defaults come from defaultMedalTimes(); built-in courses are tuned by
   * tools/headless/race-balance.ts (plain run: silver, chained run: gold), within 10 % of the defaults.
   */
  medals: MedalTimes;
}

export type Medal = 'gold' | 'silver' | 'bronze';

/** Target times (s): a finish at or under a target earns that medal. gold < silver < bronze. */
export interface MedalTimes {
  gold: number;
  silver: number;
  bronze: number;
}

/**
 * Average speeds (m/s) the default medal targets ask for, over the timed distance (course + rest of the lead-in).
 * Phase 20 stage D (flow and chain bursts): bronze is within reach of clean flying without moves (a scripted plain
 * racer averages ~48–51 m/s over the course, ~47–50 m/s over the timed distance); silver asks for some chaining; gold
 * for sustained flow, i.e. chained moves on every leg and the world used well (~58–61 m/s). See
 * tools/headless/race-balance.ts.
 */
export const MEDAL_PACE: Readonly<Record<Medal, number>> = { gold: 58, silver: 50, bronze: 43 };

/** Medals from best to worst. */
export const MEDAL_ORDER: readonly Medal[] = ['gold', 'silver', 'bronze'];

export interface Gate {
  index: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Unit normal: the direction the racer must cross the disc in. */
  nx: number;
  ny: number;
  nz: number;
  label?: string;
}

/** A compiled speed ring: same disc test as a gate (gateCrossing works on it). */
export interface SpeedRing {
  index: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  nx: number;
  ny: number;
  nz: number;
}

export interface CourseStart {
  x: number;
  y: number;
  z: number;
  headingDeg: number;
  pitchDeg: number;
  speed: number;
}

export interface CompiledCourse {
  def: CourseDef;
  gates: readonly Gate[];
  speedRings: readonly SpeedRing[];
  /** Sum of the straight legs gate to gate (m), without the lead-in. */
  length: number;
  /** Where a race start places the dragon: on the lead-in line before gate 0, flying at it. */
  start: CourseStart;
}

/** Nominal race pace (m/s) used for the lead-in distance and time estimates. */
export const RACE_PACE = 35;
/** Countdown before the clock starts (s). */
export const COUNTDOWN_SECONDS = 3;
/** Lead-in distance (m): the dragon covers the countdown and a little more before reaching the start gate. */
export const LEAD_IN = RACE_PACE * COUNTDOWN_SECONDS + 160;
/** Lead-in distance still ahead at GO when the dragon holds the race pace through the countdown (m): timed. */
export const TIMED_LEAD_IN = LEAD_IN - RACE_PACE * COUNTDOWN_SECONDS;

export const COURSES: readonly CourseDef[] = [
  {
    id: 'bogaz',
    name: 'Boğaz turu',
    description: 'Kız Kulesi’nden 15 Temmuz Şehitler Köprüsü’nün altından Fatih Sultan Mehmet Köprüsü’ne, Boğaz boyunca.',
    medals: { gold: 195, silver: 218, bronze: 252 },
    gates: [
      { lat: 41.0135, lon: 28.9996, alt: 70, radius: 32, label: 'Başlangıç' },
      { lat: 41.0216, lon: 28.9998, alt: 60, radius: 30, label: 'Kız Kulesi' },
      { lat: 41.0306, lon: 29.0039, alt: 70, radius: 30 },
      { lat: 41.0369, lon: 29.0117, alt: 75, radius: 30, label: 'Beşiktaş' },
      { lat: 41.0414, lon: 29.0236, alt: 60, radius: 30, label: 'Ortaköy' },
      // Under the deck at mid-span: the deck underside is ~64 m, so a small ring low over the water (see races-check).
      { lat: 41.0455, lon: 29.0343, alt: 26, radius: 11, label: '15 Temmuz Şehitler Köprüsü' },
      { lat: 41.0531, lon: 29.0432, alt: 60, radius: 30 },
      { lat: 41.0621, lon: 29.0468, alt: 80, radius: 30, label: 'Kuleli' },
      { lat: 41.0711, lon: 29.0510, alt: 75, radius: 30, label: 'Bebek' },
      { lat: 41.0801, lon: 29.0593, alt: 90, radius: 30, label: 'Rumeli Hisarı' },
      { lat: 41.0914, lon: 29.0613, alt: 175, radius: 32, label: 'Fatih Sultan Mehmet Köprüsü' },
    ],
    speedRings: [
      { leg: 0, t: 0.5 },
      { leg: 7, t: 0.5 },
      // On the long climb to the Fatih Sultan Mehmet deck (no room for a skim there); the other legs are skim-friendly.
      { leg: 9, t: 0.5 },
    ],
  },
  {
    id: 'halic',
    name: 'Haliç kıvrımı',
    description: 'Karaköy’den köprülerin üstünden Haliç’in kıvrımını izleyerek Eyüp’e.',
    medals: { gold: 90, silver: 102, bronze: 117 },
    gates: [
      { lat: 41.0202, lon: 28.9807, alt: 55, radius: 26, label: 'Başlangıç' },
      { lat: 41.022, lon: 28.97, alt: 95, radius: 24, label: 'Galata Köprüsü' },
      { lat: 41.0288, lon: 28.9664, alt: 90, radius: 24, label: 'Unkapanı' },
      { lat: 41.0328, lon: 28.9551, alt: 65, radius: 24, label: 'Hasköy' },
      { lat: 41.0387, lon: 28.9482, alt: 55, radius: 24, label: 'Balat' },
      { lat: 41.0428, lon: 28.9432, alt: 65, radius: 24, label: 'Ayvansaray' },
      { lat: 41.0491, lon: 28.9379, alt: 60, radius: 26, label: 'Eyüp' },
    ],
    speedRings: [
      { leg: 2, t: 0.5 },
      { leg: 4, t: 0.5 },
    ],
  },
  {
    id: 'adalar',
    name: 'Adalar turu',
    description: 'Kınalıada ile Burgaz arasından Heybeli’nin güneyinden dolaşıp Büyükada’nın çevresinden güney ucuna.',
    medals: { gold: 260, silver: 305, bronze: 353 },
    gates: [
      { lat: 40.8919, lon: 29.0569, alt: 55, radius: 32, label: 'Başlangıç' },
      { lat: 40.8802, lon: 29.0498, alt: 55, radius: 30, label: 'Burgazada' },
      { lat: 40.8685, lon: 29.0593, alt: 50, radius: 30 },
      { lat: 40.8631, lon: 29.076, alt: 50, radius: 30, label: 'Heybeliada' },
      { lat: 40.8649, lon: 29.0974, alt: 55, radius: 30 },
      { lat: 40.8721, lon: 29.1105, alt: 60, radius: 30 },
      { lat: 40.8802, lon: 29.1189, alt: 60, radius: 30, label: 'Büyükada' },
      { lat: 40.8811, lon: 29.1355, alt: 60, radius: 30 },
      { lat: 40.8694, lon: 29.1463, alt: 55, radius: 30, label: 'Sedef Adası' },
      { lat: 40.8577, lon: 29.1332, alt: 55, radius: 30 },
      { lat: 40.8442, lon: 29.1308, alt: 60, radius: 32, label: 'Büyükada güney ucu' },
    ],
    speedRings: [
      { leg: 0, t: 0.5 },
      { leg: 3, t: 0.5 },
      { leg: 5, t: 0.5 },
      { leg: 9, t: 0.5 },
    ],
  },
];

export function courseDef(id: string): CourseDef | undefined {
  return COURSES.find((c) => c.id === id);
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** Converts a course to local meters and derives the gate normals, total length and start pose. */
export function compileCourse(def: CourseDef): CompiledCourse {
  const pts = def.gates.map((g) => {
    const p = latLonToLocal(g.lat, g.lon);
    return { x: p.x, y: g.alt, z: p.z };
  });
  const n = pts.length;
  const legDir = (i: number): [number, number, number] => normalize(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y, pts[i + 1].z - pts[i].z);
  const gates: Gate[] = pts.map((p, i) => {
    const out = i < n - 1 ? legDir(i) : null;
    const inn = i > 0 ? legDir(i - 1) : null;
    let d: [number, number, number];
    if (out && inn) {
      d = normalize(out[0] + inn[0], out[1] + inn[1], out[2] + inn[2]);
    } else {
      d = (out ?? inn)!;
    }
    const g = def.gates[i];
    if (g.headingDeg !== undefined) {
      d = facing(g.headingDeg, g.pitchDeg ?? 0);
    }
    return { index: i, x: p.x, y: p.y, z: p.z, radius: g.radius, nx: d[0], ny: d[1], nz: d[2], label: g.label };
  });
  const speedRings: SpeedRing[] = [];
  for (const r of def.speedRings ?? []) {
    const radius = r.radius ?? SPEED_RING_RADIUS;
    if ('leg' in r) {
      if (r.leg < 0 || r.leg >= n - 1) {
        continue;
      }
      const a = pts[r.leg];
      const b = pts[r.leg + 1];
      const d = legDir(r.leg);
      speedRings.push({
        index: speedRings.length,
        x: a.x + (b.x - a.x) * r.t,
        y: a.y + (b.y - a.y) * r.t,
        z: a.z + (b.z - a.z) * r.t,
        radius,
        nx: d[0],
        ny: d[1],
        nz: d[2],
      });
    } else {
      const p = latLonToLocal(r.lat, r.lon);
      const d = facing(r.headingDeg, r.pitchDeg);
      speedRings.push({ index: speedRings.length, x: p.x, y: r.alt, z: p.z, radius, nx: d[0], ny: d[1], nz: d[2] });
    }
  }
  let length = 0;
  for (let i = 1; i < n; i++) {
    length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
  }
  // Lead-in: straight back from gate 0 along its (horizontal) normal, level with the gate.
  const g0 = gates[0];
  const h = Math.hypot(g0.nx, g0.nz) || 1;
  const fx = g0.nx / h;
  const fz = g0.nz / h;
  const headingDeg = headingOf(fx, fz);
  const start: CourseStart = { x: g0.x - fx * LEAD_IN, y: g0.y, z: g0.z - fz * LEAD_IN, headingDeg, pitchDeg: 0, speed: RACE_PACE };
  return { def, gates, speedRings, length, start };
}

/** Unit direction of a compass heading (0 = north = -z, 90 = east = +x) and a pitch (+ up), degrees. */
export function facing(headingDeg: number, pitchDeg: number): [number, number, number] {
  const h = (headingDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const c = Math.cos(p);
  return [Math.sin(h) * c, Math.sin(p), -Math.cos(h) * c];
}

/** Compass heading (degrees, 0..360) of a horizontal direction. */
export function headingOf(x: number, z: number): number {
  return ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;
}

/** Default medal targets for a timed distance (m): MEDAL_PACE averages, rounded to whole seconds. */
export function defaultMedalTimes(timedDistance: number): MedalTimes {
  return {
    gold: Math.round(timedDistance / MEDAL_PACE.gold),
    silver: Math.round(timedDistance / MEDAL_PACE.silver),
    bronze: Math.round(timedDistance / MEDAL_PACE.bronze),
  };
}

/** Timed distance of a course (m): the rest of the lead-in after GO plus the gate-to-gate legs. */
export function timedDistance(course: CompiledCourse): number {
  return TIMED_LEAD_IN + course.length;
}

/** Medal earned by a finish time, or null when slower than bronze. */
export function medalFor(time: number, medals: MedalTimes): Medal | null {
  if (!Number.isFinite(time)) {
    return null;
  }
  for (const m of MEDAL_ORDER) {
    if (time <= medals[m]) {
      return m;
    }
  }
  return null;
}

/** The better of two medals (null = none). */
export function betterMedal(a: Medal | null | undefined, b: Medal | null | undefined): Medal | null {
  const rank = (m: Medal | null | undefined): number => (m ? MEDAL_ORDER.indexOf(m) : MEDAL_ORDER.length);
  const best = Math.min(rank(a), rank(b));
  return best < MEDAL_ORDER.length ? MEDAL_ORDER[best] : null;
}

const compiled = new Map<string, CompiledCourse>();

/** Compiled course by id (cached), or undefined for an unknown id. */
export function getCourse(id: string): CompiledCourse | undefined {
  let c = compiled.get(id);
  if (!c) {
    const def = courseDef(id);
    if (!def) {
      return undefined;
    }
    c = compileCourse(def);
    compiled.set(id, c);
  }
  return c;
}
