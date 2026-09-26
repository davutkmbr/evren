/**
 * Photo metadata: names the place in the picture, reads the sun and the weather, and words the calm caption
 * ("Galata Kulesi · 18:42 · açık hava"). Pure (no DOM, no THREE): the UI gathers the inputs from the engine
 * (photo-album.ts), tools/headless/album-check.ts feeds fakes.
 */
import type { CameraMode } from '../../core/contracts';
import { goldenHourBadge, inFrustum, isGoldenHour, sunElevationDeg, type BadgeLandmark, type CameraView } from './badges';
import type { PhotoDragonState, PhotoMeta, PhotoPlaceKind, PhotoWeather } from './types';

const RAD = 180 / Math.PI;

/** A landmark in frame names the photo up to this far (m): more for tall ones, never less / more than the bounds. */
export function landmarkNameRange(height: number): number {
  return Math.min(1800, Math.max(300, (Number.isFinite(height) ? height : 0) * 10));
}
/** Without a landmark in frame, the nearest landmark within this horizontal distance (m) names the photo. */
export const NEARBY_LANDMARK_M = 250;

export interface PlaceSources {
  landmarks: readonly BadgeLandmark[];
  landmark(id: string): BadgeLandmark | undefined;
  districtAt?(x: number, z: number): string | null | undefined;
  waterAt?(x: number, z: number): string | null | undefined;
  /** Name of the perch the dragon sits on, if any. */
  perchName?: string;
}

export interface PlaceName {
  place: string;
  kind: PhotoPlaceKind;
  landmarkId?: string;
}

/**
 * The place a photo shows, in order: a golden-hour badge place in frame (`badgeLandmarkId`), the closest landmark in
 * frame within its naming range, the perch the dragon sits on, the nearest landmark within NEARBY_LANDMARK_M, the
 * district under the camera, the water body, else "İstanbul".
 */
export function namePlace(view: CameraView, sources: PlaceSources, badgeLandmarkId?: string): PlaceName {
  const p = view.position;
  if (badgeLandmarkId) {
    const lm = sources.landmark(badgeLandmarkId);
    if (lm) {
      return { place: lm.name, kind: 'landmark', landmarkId: lm.id };
    }
  }
  let inFrame: BadgeLandmark | null = null;
  let inFrameD = Infinity;
  let near: BadgeLandmark | null = null;
  let nearD = Infinity;
  for (const lm of sources.landmarks) {
    if (!Number.isFinite(lm.x) || !Number.isFinite(lm.z)) {
      continue;
    }
    const aimY = (Number.isFinite(lm.y) ? lm.y : 0) + Math.max(0, lm.height || 0) * 0.5;
    const d = Math.hypot(lm.x - p.x, aimY - p.y, lm.z - p.z);
    if (d < inFrameD && d <= landmarkNameRange(lm.height) && d > 4 && inFrustum(view, { x: lm.x, y: aimY, z: lm.z })) {
      inFrame = lm;
      inFrameD = d;
    }
    const dh = Math.hypot(lm.x - p.x, lm.z - p.z);
    if (dh < nearD) {
      near = lm;
      nearD = dh;
    }
  }
  if (inFrame) {
    return { place: inFrame.name, kind: 'landmark', landmarkId: inFrame.id };
  }
  if (sources.perchName) {
    return { place: sources.perchName, kind: 'perch' };
  }
  if (near && nearD <= NEARBY_LANDMARK_M) {
    return { place: near.name, kind: 'landmark', landmarkId: near.id };
  }
  const district = sources.districtAt?.(p.x, p.z);
  if (district) {
    return { place: district, kind: 'district' };
  }
  const water = sources.waterAt?.(p.x, p.z);
  if (water) {
    return { place: water, kind: 'water' };
  }
  return { place: 'İstanbul', kind: 'city' };
}

export interface MetaInput {
  id: string;
  takenAt: number;
  timeOfDay: number;
  dayOfYear: number;
  weather: PhotoWeather;
  view: CameraView;
  cameraMode: CameraMode;
  dragon: PhotoDragonState;
  perchId?: string;
  /** y of the unit vector toward the sun. */
  sunDirY: number;
  sources: PlaceSources;
}

function num(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

/** Builds a photo's metadata (image size and bytes are filled in once encoded). No field is NaN. */
export function buildPhotoMeta(input: MetaInput): PhotoMeta {
  const { view } = input;
  const sun = sunElevationDeg(input.sunDirY);
  const badge = goldenHourBadge(sun, view, input.sources.landmark);
  const name = namePlace(view, input.sources, badge?.place.landmarkId);
  const f = view.forward;
  const horiz = Math.hypot(f.x, f.z);
  let heading = horiz > 1e-6 ? Math.atan2(f.x, -f.z) * RAD : 0;
  if (heading < 0) {
    heading += 360;
  }
  const pitch = Math.atan2(num(f.y), Math.max(1e-9, horiz)) * RAD;
  const tod = ((num(input.timeOfDay, 12) % 24) + 24) % 24;
  const meta: PhotoMeta = {
    id: input.id,
    takenAt: num(input.takenAt),
    timeOfDay: tod,
    dayOfYear: Math.min(366, Math.max(1, Math.round(num(input.dayOfYear, 1)))),
    weather: input.weather,
    x: num(view.position.x),
    y: num(view.position.y),
    z: num(view.position.z),
    headingDeg: num(heading),
    pitchDeg: num(pitch),
    place: name.place,
    placeKind: name.kind,
    cameraMode: input.cameraMode,
    dragon: input.dragon,
    sunElevationDeg: num(sun),
    golden: isGoldenHour(sun),
    width: 0,
    height: 0,
    mime: '',
    bytes: 0,
  };
  if (name.landmarkId) {
    meta.landmarkId = name.landmarkId;
  }
  if (input.perchId) {
    meta.perchId = input.perchId;
  }
  if (badge) {
    meta.badgeId = badge.place.id;
  }
  return meta;
}

/* ---------------- wording ---------------- */

const WEATHER_LABEL: Record<PhotoWeather, string> = {
  clear: 'açık hava',
  haze: 'puslu',
  fog: 'sisli',
  rain: 'yağmurlu',
  storm: 'fırtınalı',
  custom: 'değişken hava',
  unknown: '',
};

export function weatherLabel(w: PhotoWeather): string {
  return WEATHER_LABEL[w] ?? '';
}

const DRAGON_LABEL: Record<PhotoDragonState, string> = {
  perched: 'seyir noktasında',
  flying: 'uçarken',
  ground: 'yerde',
  water: 'suda',
  none: '',
};

export function dragonLabel(d: PhotoDragonState): string {
  return DRAGON_LABEL[d] ?? '';
}

/** "18:42" from hours. */
export function formatClock(hours: number): string {
  const total = Math.round(((((Number.isFinite(hours) ? hours : 0) % 24) + 24) % 24) * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

/** "26 Eylül 2026" (local time). */
export function formatDate(ms: number): string {
  const d = new Date(Number.isFinite(ms) ? ms : 0);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** The calm caption: "Galata Kulesi · 18:42 · açık hava". */
export function photoCaption(meta: PhotoMeta): string {
  return [meta.place, formatClock(meta.timeOfDay), weatherLabel(meta.weather)].filter(Boolean).join(' · ');
}

/** The quieter second line: "26 Eylül 2026 · uçarken · güneş 3°". */
export function photoSubline(meta: PhotoMeta): string {
  const sun = `güneş ${Math.round(meta.sunElevationDeg).toLocaleString('tr-TR')}°`;
  return [formatDate(meta.takenAt), dragonLabel(meta.dragon), sun].filter(Boolean).join(' · ');
}

/** A new photo id, sortable by time. */
export function newPhotoId(now: number, rand: number = Math.random()): string {
  const r = Math.floor(Math.min(0.999999, Math.max(0, Number.isFinite(rand) ? rand : 0)) * 36 ** 4).toString(36).padStart(4, '0');
  return `p-${Math.max(0, Math.floor(Number.isFinite(now) ? now : 0)).toString(36)}-${r}`;
}
