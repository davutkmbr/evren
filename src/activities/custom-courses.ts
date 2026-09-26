/**
 * Player-built ring race courses (course editor): data model, share codes, validation and storage.
 *
 * A custom course is a list of gates and speed rings in local meters (whole meters, whole degrees), each with its own
 * facing (the flight direction when it was placed). The id is a hash of the geometry, so the same course imported
 * twice is recognised and records stay with the geometry they were flown on (editing a course gives it a new id).
 *
 * Share code: "EVR1." + base64url(UTF-8 JSON { v: 1, n: name, g: [[x, y, z, r, h, p], …], s: [[x, y, z, h, p], …] }).
 * decodeCourseCode() validates strictly (shape, counts, ranges, spacing) and never throws.
 *
 * Storage: localStorage 'evren.races.custom.v1' ({ v: 1, courses: [...] }), every access guarded; without storage
 * (private window, headless) the list lives in memory only. Pure apart from that storage access (no three.js).
 */
import { WORLD_CEILING, WORLD_HALF_SIZE, localToLatLon } from '../core/geo-coords';
import {
  CUSTOM_ID_PREFIX,
  SPEED_RING_RADIUS,
  compileCourse,
  defaultMedalTimes,
  timedDistance,
  type CompiledCourse,
  type CourseDef,
} from './courses';

/** Most custom courses kept. */
export const CUSTOM_LIMIT = 20;
export const MIN_GATES = 3;
/** Matches the ring renderer's instance count. */
export const MAX_GATES = 32;
export const MAX_SPEED_RINGS = 16;
/** Gate radius (m) per size choice in the editor. */
export const GATE_SIZES = { small: 14, medium: 22, large: 30 } as const;
export type GateSize = keyof typeof GATE_SIZES;
export const GATE_SIZE_ORDER: readonly GateSize[] = ['small', 'medium', 'large'];
/** Consecutive gates closer than this (m) are refused (a double press would stack two gates). */
export const MIN_GATE_SPACING = 60;
/** Steepest facing a gate can have (degrees). */
export const MAX_GATE_PITCH = 40;
export const NAME_MAX = 32;
/** Gates and rings stay this far inside the world edge (m). */
const EDGE_MARGIN = 500;
/** Lowest centre altitude accepted in data (m); the placement check is what keeps rings out of the ground. */
const MIN_ALT = 2;
const CODE_PREFIX = 'EVR1.';
const CODE_MAX = 4000;
const STORAGE_KEY = 'evren.races.custom.v1';

export interface CustomGate {
  x: number;
  y: number;
  z: number;
  /** Radius (m), one of GATE_SIZES. */
  r: number;
  /** Facing: compass heading and pitch (degrees). */
  h: number;
  p: number;
}

export interface CustomRing {
  x: number;
  y: number;
  z: number;
  h: number;
  p: number;
}

export interface CustomCourse {
  id: string;
  name: string;
  gates: CustomGate[];
  rings: CustomRing[];
  /** ISO date of the last save. */
  saved?: string;
}

/* ------------------------------------------------------------------ */
/* Normalisation and ids                                               */
/* ------------------------------------------------------------------ */

const RADII: ReadonlySet<number> = new Set(Object.values(GATE_SIZES));

/** Whole meters and degrees, heading in [0, 360), pitch clamped. */
export function roundGate(g: CustomGate): CustomGate {
  return { x: Math.round(g.x), y: Math.round(g.y), z: Math.round(g.z), r: g.r, h: Math.round(g.h + 360) % 360, p: clampPitch(g.p) };
}

export function roundRing(r: CustomRing): CustomRing {
  return { x: Math.round(r.x), y: Math.round(r.y), z: Math.round(r.z), h: Math.round(r.h + 360) % 360, p: clampPitch(r.p) };
}

function clampPitch(p: number): number {
  return Math.max(-MAX_GATE_PITCH, Math.min(MAX_GATE_PITCH, Math.round(p)));
}

/** 32-bit FNV-1a of a string, base 36. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Geometry id: the same gates and rings always give the same id. */
export function customCourseId(gates: readonly CustomGate[], rings: readonly CustomRing[]): string {
  const g = gates.map((v) => [v.x, v.y, v.z, v.r, v.h, v.p]);
  const s = rings.map((v) => [v.x, v.y, v.z, v.h, v.p]);
  return CUSTOM_ID_PREFIX + hash(JSON.stringify([g, s]));
}

/** Removes control characters and extra spaces, trims to NAME_MAX; empty → the fallback. */
export function sanitizeName(name: string, fallback = 'Parkurum'): string {
  // eslint-disable-next-line no-control-regex
  const clean = name
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  return Array.from(clean).slice(0, NAME_MAX).join('').trim() || fallback;
}

/* ------------------------------------------------------------------ */
/* Validation of data (codes and storage)                              */
/* ------------------------------------------------------------------ */

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function inWorld(x: number, y: number, z: number): boolean {
  const lim = WORLD_HALF_SIZE - EDGE_MARGIN;
  return Math.abs(x) <= lim && Math.abs(z) <= lim && y >= MIN_ALT && y <= WORLD_CEILING;
}

function parseGate(v: unknown): CustomGate | null {
  if (!Array.isArray(v) || v.length !== 6 || !v.every(isInt)) {
    return null;
  }
  const [x, y, z, r, h, p] = v as number[];
  if (!inWorld(x, y, z) || !RADII.has(r) || h < 0 || h >= 360 || Math.abs(p) > MAX_GATE_PITCH) {
    return null;
  }
  return { x, y, z, r, h, p };
}

function parseRing(v: unknown): CustomRing | null {
  if (!Array.isArray(v) || v.length !== 5 || !v.every(isInt)) {
    return null;
  }
  const [x, y, z, h, p] = v as number[];
  if (!inWorld(x, y, z) || h < 0 || h >= 360 || Math.abs(p) > MAX_GATE_PITCH) {
    return null;
  }
  return { x, y, z, h, p };
}

/** Consecutive gates at least MIN_GATE_SPACING apart. */
export function spacingOk(gates: readonly CustomGate[]): boolean {
  for (let i = 1; i < gates.length; i++) {
    const a = gates[i - 1];
    const b = gates[i];
    if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < MIN_GATE_SPACING) {
      return false;
    }
  }
  return true;
}

interface Payload {
  v: 1;
  n: string;
  g: number[][];
  s?: number[][];
}

/** Validates a parsed payload strictly; null when anything is off. */
function parsePayload(raw: unknown): { name: string; gates: CustomGate[]; rings: CustomRing[] } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (Object.keys(o).some((k) => k !== 'v' && k !== 'n' && k !== 'g' && k !== 's')) {
    return null;
  }
  if (o.v !== 1 || typeof o.n !== 'string' || o.n.length > NAME_MAX * 4 || !Array.isArray(o.g)) {
    return null;
  }
  if (o.g.length < MIN_GATES || o.g.length > MAX_GATES) {
    return null;
  }
  const gates: CustomGate[] = [];
  for (const g of o.g) {
    const p = parseGate(g);
    if (!p) {
      return null;
    }
    gates.push(p);
  }
  const rings: CustomRing[] = [];
  if (o.s !== undefined) {
    if (!Array.isArray(o.s) || o.s.length > MAX_SPEED_RINGS) {
      return null;
    }
    for (const r of o.s) {
      const p = parseRing(r);
      if (!p) {
        return null;
      }
      rings.push(p);
    }
  }
  if (!spacingOk(gates)) {
    return null;
  }
  return { name: sanitizeName(o.n), gates, rings };
}

function toPayload(c: CustomCourse): Payload {
  const p: Payload = { v: 1, n: c.name, g: c.gates.map((g) => [g.x, g.y, g.z, g.r, g.h, g.p]) };
  if (c.rings.length) {
    p.s = c.rings.map((r) => [r.x, r.y, r.z, r.h, r.p]);
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* Share codes                                                         */
/* ------------------------------------------------------------------ */

function bytesToBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text: string): Uint8Array | null {
  try {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      out[i] = s.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

/** Share code of a course. */
export function encodeCourseCode(c: CustomCourse): string {
  return CODE_PREFIX + bytesToBase64Url(new TextEncoder().encode(JSON.stringify(toPayload(c))));
}

export type CodeError = 'empty' | 'format' | 'size' | 'data';
export type DecodeResult = { ok: true; course: CustomCourse } | { ok: false; error: CodeError };

/** Parses a share code (surrounding whitespace allowed). Never throws; any malformed input is an error. */
export function decodeCourseCode(code: unknown): DecodeResult {
  if (typeof code !== 'string') {
    return { ok: false, error: 'format' };
  }
  const text = code.replace(/\s+/g, '');
  if (!text) {
    return { ok: false, error: 'empty' };
  }
  if (text.length > CODE_MAX) {
    return { ok: false, error: 'size' };
  }
  if (!text.startsWith(CODE_PREFIX)) {
    return { ok: false, error: 'format' };
  }
  const body = text.slice(CODE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body) || body.length % 4 === 1) {
    return { ok: false, error: 'format' };
  }
  const bytes = base64UrlToBytes(body);
  if (!bytes) {
    return { ok: false, error: 'format' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, error: 'data' };
  }
  const p = parsePayload(raw);
  if (!p) {
    return { ok: false, error: 'data' };
  }
  return { ok: true, course: { id: customCourseId(p.gates, p.rings), name: p.name, gates: p.gates, rings: p.rings } };
}

/* ------------------------------------------------------------------ */
/* Course definition                                                   */
/* ------------------------------------------------------------------ */

const compiledCache = new Map<string, CompiledCourse>();

/** CourseDef of a custom course (gates at their own facing, default medal targets from the length). */
export function customCourseDef(c: CustomCourse, description = ''): CourseDef {
  const gates = c.gates.map((g) => {
    const ll = localToLatLon(g.x, g.z);
    return { lat: ll.lat, lon: ll.lon, alt: g.y, radius: g.r, headingDeg: g.h, pitchDeg: g.p };
  });
  const speedRings = c.rings.map((r) => {
    const ll = localToLatLon(r.x, r.z);
    return { lat: ll.lat, lon: ll.lon, alt: r.y, headingDeg: r.h, pitchDeg: r.p, radius: SPEED_RING_RADIUS };
  });
  const def: CourseDef = { id: c.id, name: c.name, description, gates, speedRings, custom: true, medals: { gold: 1, silver: 2, bronze: 3 } };
  const compiled = compileCourse(def);
  def.medals = defaultMedalTimes(timedDistance(compiled));
  return def;
}

/** Compiled custom course (cached by id: the id is the geometry hash, the name is refreshed). */
export function compileCustomCourse(c: CustomCourse, description = ''): CompiledCourse {
  const hit = compiledCache.get(c.id);
  if (hit) {
    hit.def.name = c.name;
    hit.def.description = description;
    return hit;
  }
  const compiled = compileCourse(customCourseDef(c, description));
  compiledCache.set(c.id, compiled);
  return compiled;
}

/* ------------------------------------------------------------------ */
/* Placement validation (editor)                                       */
/* ------------------------------------------------------------------ */

/**
 * World queries for placement checks. `terrainAt` is the terrain height (geo heightAt; below 0 = sea floor).
 * `surfaceAt` is the highest surface including collider tops (collision surfaceHeight); `solidAt` tells whether a
 * small sphere at a point touches a collider, which separates "under a bridge deck" from "inside a building".
 */
export interface PlacementProbe {
  terrainAt(x: number, z: number): number;
  surfaceAt?(x: number, z: number): number;
  solidAt?(x: number, y: number, z: number, radius: number): boolean;
}

export type PlacementProblem = 'bounds' | 'terrain' | 'structure';

/** Ring clearance above the ground / water at every sampled rim point (m). */
const RIM_GROUND_CLEARANCE = 2;
const RIM_SAMPLES = 8;

/** Centre plus RIM_SAMPLES points on the ring (radius r, facing h/p) in world space. */
export function ringSamplePoints(x: number, y: number, z: number, r: number, h: number, p: number): Array<[number, number, number]> {
  const hr = (h * Math.PI) / 180;
  const pr = (p * Math.PI) / 180;
  // Ring plane basis: right (horizontal) and up (perpendicular to the facing).
  const rx = Math.cos(hr);
  const rz = Math.sin(hr);
  const ux = -Math.sin(hr) * Math.sin(pr);
  const uy = Math.cos(pr);
  const uz = Math.cos(hr) * Math.sin(pr);
  const out: Array<[number, number, number]> = [[x, y, z]];
  for (let k = 0; k < RIM_SAMPLES; k++) {
    const a = (k / RIM_SAMPLES) * Math.PI * 2;
    const c = Math.cos(a) * r;
    const s = Math.sin(a) * r;
    out.push([x + rx * c + ux * s, y + uy * s, z + rz * c + uz * s]);
  }
  return out;
}

/** Checks one ring against the world; null when it is clear. */
export function validateRingPlacement(x: number, y: number, z: number, r: number, h: number, p: number, probe: PlacementProbe): PlacementProblem | null {
  if (![x, y, z, r, h, p].every(Number.isFinite) || !inWorld(x, y, z)) {
    return 'bounds';
  }
  for (const [px, py, pz] of ringSamplePoints(x, y, z, r, h, p)) {
    const ground = Math.max(0, probe.terrainAt(px, pz));
    if (py < ground + RIM_GROUND_CLEARANCE) {
      return 'terrain';
    }
    const surface = probe.surfaceAt?.(px, pz);
    if (surface !== undefined && surface > py - 1) {
      // Something is above this point: a bridge deck overhead is fine, being inside a collider is not. Without a
      // solid test the conservative answer is "inside".
      if (!probe.solidAt || probe.solidAt(px, py, pz, 2)) {
        return 'structure';
      }
    }
  }
  return null;
}

/** The lead-in line (LEAD_IN m level behind gate 0) stays above the terrain; false when the start would be buried. */
export function leadInClear(course: CompiledCourse, terrainAt: (x: number, z: number) => number, clearance = 10): boolean {
  const s = course.start;
  const g = course.gates[0];
  for (let k = 0; k <= 20; k++) {
    const t = k / 20;
    const x = s.x + (g.x - s.x) * t;
    const z = s.z + (g.z - s.z) * t;
    const y = s.y + (g.y - s.y) * t;
    if (y < Math.max(0, terrainAt(x, z)) + clearance * (1 - t)) {
      return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

let memory: CustomCourse[] | null = null;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadCustomCourses(): readonly CustomCourse[] {
  if (memory) {
    return memory;
  }
  const list: CustomCourse[] = [];
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { v?: unknown; courses?: unknown };
      if (parsed && parsed.v === 1 && Array.isArray(parsed.courses)) {
        for (const entry of parsed.courses as Array<{ p?: unknown; saved?: unknown }>) {
          const p = parsePayload(entry?.p);
          if (!p || list.length >= CUSTOM_LIMIT) {
            continue;
          }
          const id = customCourseId(p.gates, p.rings);
          if (list.some((c) => c.id === id)) {
            continue;
          }
          list.push({ id, name: p.name, gates: p.gates, rings: p.rings, saved: typeof entry.saved === 'string' ? entry.saved : undefined });
        }
      }
    }
  } catch {
    // Corrupt or blocked storage: start empty.
  }
  memory = list;
  return list;
}

function persist(list: CustomCourse[]): void {
  memory = list;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify({ v: 1, courses: list.map((c) => ({ p: toPayload(c), saved: c.saved })) }));
  } catch {
    // Quota or blocked storage: keep the in-memory copy.
  }
}

export function getCustomCourse(id: string): CustomCourse | undefined {
  return loadCustomCourses().find((c) => c.id === id);
}

export type SaveResult = { ok: true; course: CustomCourse; replaced?: string } | { ok: false; error: 'limit' | 'duplicate' };

/**
 * Stores a course. `replaceId` is the course being edited: it is replaced in place (its records belong to the old
 * geometry; the caller clears them when the id changed). A new course over the limit, or a geometry that already
 * exists under another entry, is refused.
 */
export function saveCustomCourse(course: CustomCourse, replaceId?: string): SaveResult {
  const list = loadCustomCourses().slice();
  const entry: CustomCourse = { ...course, saved: new Date().toISOString() };
  const at = replaceId ? list.findIndex((c) => c.id === replaceId) : -1;
  const dup = list.findIndex((c) => c.id === course.id);
  if (dup >= 0 && dup !== at) {
    return { ok: false, error: 'duplicate' };
  }
  if (at >= 0) {
    list[at] = entry;
    persist(list);
    return { ok: true, course: entry, replaced: replaceId };
  }
  if (list.length >= CUSTOM_LIMIT) {
    return { ok: false, error: 'limit' };
  }
  list.push(entry);
  persist(list);
  return { ok: true, course: entry };
}

export function deleteCustomCourse(id: string): boolean {
  const list = loadCustomCourses().slice();
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) {
    return false;
  }
  list.splice(i, 1);
  persist(list);
  return true;
}
