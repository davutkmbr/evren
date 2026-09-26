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

export interface GateDef {
  lat: number;
  lon: number;
  /** Centre altitude, m above sea level. */
  alt: number;
  /** Ring radius (m): the disc the racer must fly through. */
  radius: number;
  /** Optional Turkish caption for the landmark this gate frames (split toasts). */
  label?: string;
}

export interface CourseDef {
  id: CourseId;
  /** Turkish course name shown in the game. */
  name: string;
  /** One sentence Turkish description. */
  description: string;
  gates: readonly GateDef[];
  /** Medal target times (s, whole seconds). Defaults come from defaultMedalTimes(); keep them in sync by hand. */
  medals: MedalTimes;
}

export type Medal = 'gold' | 'silver' | 'bronze';

/** Target times (s): a finish at or under a target earns that medal. gold < silver < bronze. */
export interface MedalTimes {
  gold: number;
  silver: number;
  bronze: number;
}

/** Average speeds (m/s) the default medal targets ask for, over the timed distance (course + rest of the lead-in). */
export const MEDAL_PACE: Readonly<Record<Medal, number>> = { gold: 44, silver: 38, bronze: 32 };

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
    description: 'Kız Kulesi’nden Boğaziçi Köprüsü’nün üstünden Fatih Sultan Mehmet Köprüsü’ne, Boğaz boyunca.',
    medals: { gold: 248, silver: 288, bronze: 342 },
    gates: [
      { lat: 41.0135, lon: 28.9996, alt: 70, radius: 32, label: 'Başlangıç' },
      { lat: 41.0216, lon: 28.9998, alt: 60, radius: 30, label: 'Kız Kulesi' },
      { lat: 41.0306, lon: 29.0039, alt: 70, radius: 30 },
      { lat: 41.0369, lon: 29.0117, alt: 85, radius: 30, label: 'Beşiktaş' },
      { lat: 41.0414, lon: 29.0236, alt: 130, radius: 30, label: 'Ortaköy' },
      { lat: 41.0455, lon: 29.0343, alt: 235, radius: 32, label: 'Boğaziçi Köprüsü' },
      { lat: 41.0531, lon: 29.0432, alt: 130, radius: 30 },
      { lat: 41.0621, lon: 29.0468, alt: 80, radius: 30, label: 'Kuleli' },
      { lat: 41.0711, lon: 29.0510, alt: 75, radius: 30, label: 'Bebek' },
      { lat: 41.0801, lon: 29.0593, alt: 90, radius: 30, label: 'Rumeli Hisarı' },
      { lat: 41.0914, lon: 29.0613, alt: 175, radius: 32, label: 'Fatih Sultan Mehmet Köprüsü' },
    ],
  },
  {
    id: 'halic',
    name: 'Haliç kıvrımı',
    description: 'Karaköy’den köprülerin üstünden Haliç’in kıvrımını izleyerek Eyüp’e.',
    medals: { gold: 120, silver: 139, bronze: 165 },
    gates: [
      { lat: 41.0202, lon: 28.9807, alt: 55, radius: 26, label: 'Başlangıç' },
      { lat: 41.022, lon: 28.97, alt: 95, radius: 24, label: 'Galata Köprüsü' },
      { lat: 41.0288, lon: 28.9664, alt: 90, radius: 24, label: 'Unkapanı' },
      { lat: 41.0328, lon: 28.9551, alt: 65, radius: 24, label: 'Hasköy' },
      { lat: 41.0387, lon: 28.9482, alt: 55, radius: 24, label: 'Balat' },
      { lat: 41.0428, lon: 28.9432, alt: 65, radius: 24, label: 'Ayvansaray' },
      { lat: 41.0491, lon: 28.9379, alt: 60, radius: 26, label: 'Eyüp' },
    ],
  },
  {
    id: 'adalar',
    name: 'Adalar turu',
    description: 'Kınalıada ile Burgaz arasından Heybeli’nin güneyinden dolaşıp Büyükada’nın çevresinden güney ucuna.',
    medals: { gold: 344, silver: 399, bronze: 473 },
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
    return { index: i, x: p.x, y: p.y, z: p.z, radius: g.radius, nx: d[0], ny: d[1], nz: d[2], label: g.label };
  });
  let length = 0;
  for (let i = 1; i < n; i++) {
    length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
  }
  // Lead-in: straight back from gate 0 along its (horizontal) normal, level with the gate.
  const g0 = gates[0];
  const h = Math.hypot(g0.nx, g0.nz) || 1;
  const fx = g0.nx / h;
  const fz = g0.nz / h;
  const headingDeg = ((Math.atan2(fx, -fz) * 180) / Math.PI + 360) % 360;
  const start: CourseStart = { x: g0.x - fx * LEAD_IN, y: g0.y, z: g0.z - fz * LEAD_IN, headingDeg, pitchDeg: 0, speed: RACE_PACE };
  return { def, gates, length, start };
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
