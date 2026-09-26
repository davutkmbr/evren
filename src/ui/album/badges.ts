/**
 * Golden-hour badges ("Altın saat"): a photo taken while the sun is low (GOLDEN_HOUR_BAND) at one of these iconic
 * places earns that place's badge. The landmark must be in the picture, approximated by the camera being within the
 * place's radius of the landmark and one of its sample points (centre, or anchors such as bridge towers) lying inside
 * the view frustum. Occlusion is not tested. Pure: plain numbers, no THREE, no DOM (tools/headless/album-check.ts).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Sun elevation band (degrees) that counts as golden hour, around sunrise and sunset alike. */
export const GOLDEN_HOUR_BAND = { min: -4, max: 6 } as const;

export interface GoldenHourPlace {
  /** Badge id (stable, stored). */
  id: string;
  /** Turkish name shown in the album and the toast. */
  name: string;
  /** Landmark that has to be in frame (LandmarkDef.id). */
  landmarkId: string;
  /** Maximum camera distance (m) to the nearest sample point. */
  radius: number;
  /** Aim height as a fraction of the landmark's height above its ground. */
  aim: number;
  /** Also sample the landmark's anchors (bridge towers, cluster towers, outlines); at most `maxAnchors`. */
  anchors?: number;
}

/** The badge places, data-driven. Radii are generous: a photo from across the water still counts. */
export const GOLDEN_HOUR_PLACES: readonly GoldenHourPlace[] = [
  { id: 'galata-kulesi', name: 'Galata Kulesi', landmarkId: 'galata-kulesi', radius: 1200, aim: 0.7 },
  { id: 'kiz-kulesi', name: 'Kız Kulesi', landmarkId: 'kiz-kulesi', radius: 1200, aim: 0.6 },
  { id: 'suleymaniye', name: 'Süleymaniye Camii', landmarkId: 'suleymaniye', radius: 1500, aim: 0.5 },
  { id: 'ayasofya', name: 'Ayasofya', landmarkId: 'ayasofya', radius: 1300, aim: 0.5 },
  { id: 'sultanahmet', name: 'Sultanahmet Camii', landmarkId: 'sultanahmet', radius: 1300, aim: 0.5 },
  { id: 'sarayburnu', name: 'Sarayburnu', landmarkId: 'topkapi-sarayi', radius: 1500, aim: 0.5 },
  { id: 'galata-koprusu', name: 'Galata Köprüsü', landmarkId: 'galata-koprusu', radius: 1000, aim: 0.8, anchors: 2 },
  { id: 'ortakoy', name: 'Ortaköy Camii', landmarkId: 'ortakoy-camii', radius: 1000, aim: 0.5 },
  { id: 'bogazici-koprusu', name: '15 Temmuz Şehitler Köprüsü', landmarkId: 'bogazici-koprusu', radius: 2500, aim: 0.6, anchors: 2 },
  { id: 'rumeli-hisari', name: 'Rumeli Hisarı', landmarkId: 'rumeli-hisari', radius: 1300, aim: 0.6 },
  { id: 'fsm-koprusu', name: 'Fatih Sultan Mehmet Köprüsü', landmarkId: 'fsm-koprusu', radius: 2500, aim: 0.6, anchors: 2 },
  { id: 'camlica', name: 'Çamlıca', landmarkId: 'camlica-kulesi', radius: 3000, aim: 0.5 },
];

/** Closer than this the camera is inside or against the structure: no picture of it. */
export const BADGE_MIN_DISTANCE = 8;
/** A sample point must lie inside this share of the frame's half extents (not on the very edge). */
export const FRAME_MARGIN = 0.92;

/** The landmark fields the rules need (a subset of LandmarkDef). */
export interface BadgeLandmark {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  height: number;
  anchors?: readonly { x: number; z: number }[];
}

/** The camera at capture: position, unit forward and up vectors, vertical field of view and aspect. */
export interface CameraView {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
  fovDeg: number;
  aspect: number;
  near?: number;
}

const DEG = Math.PI / 180;

function finite(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

/** Sun elevation in degrees from the unit vector toward the sun (its y component). */
export function sunElevationDeg(sunDirY: number): number {
  if (!Number.isFinite(sunDirY)) {
    // Unknown sun: treated as deep night, never golden hour.
    return -90;
  }
  const y = Math.min(1, Math.max(-1, sunDirY));
  return Math.asin(y) / DEG;
}

export function isGoldenHour(elevationDeg: number): boolean {
  return Number.isFinite(elevationDeg) && elevationDeg >= GOLDEN_HOUR_BAND.min && elevationDeg <= GOLDEN_HOUR_BAND.max;
}

function normalize(v: Vec3): Vec3 | null {
  const l = Math.hypot(v.x, v.y, v.z);
  return Number.isFinite(l) && l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : null;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Is the point inside the camera's view frustum (within `margin` of the half extents)? The up vector is
 * re-orthogonalised against forward, so a slightly off up still gives the right frame.
 */
export function inFrustum(view: CameraView, point: Vec3, margin = FRAME_MARGIN): boolean {
  const f = normalize(view.forward);
  const upIn = normalize(view.up);
  if (!f || !upIn) {
    return false;
  }
  const r = normalize(cross(f, upIn));
  if (!r) {
    return false;
  }
  const u = cross(r, f);
  const d = { x: point.x - view.position.x, y: point.y - view.position.y, z: point.z - view.position.z };
  const depth = dot(d, f);
  if (!Number.isFinite(depth) || depth <= Math.max(0.05, view.near ?? 0.1)) {
    return false;
  }
  const tanV = Math.tan(Math.min(179, Math.max(1, finite(view.fovDeg, 60))) * 0.5 * DEG);
  const aspect = Math.max(0.1, finite(view.aspect, 16 / 9));
  const tanH = tanV * aspect;
  return Math.abs(dot(d, r)) <= depth * tanH * margin && Math.abs(dot(d, u)) <= depth * tanV * margin;
}

/** The points of a landmark that count as "in the picture" for a place. */
export function samplePoints(place: GoldenHourPlace, lm: BadgeLandmark): Vec3[] {
  const h = Math.max(0, finite(lm.height)) * place.aim;
  const y = finite(lm.y) + h;
  const pts: Vec3[] = [{ x: lm.x, y, z: lm.z }];
  const n = Math.min(place.anchors ?? 0, lm.anchors?.length ?? 0);
  for (let i = 0; i < n; i++) {
    const a = lm.anchors![i];
    pts.push({ x: a.x, y, z: a.z });
  }
  return pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
}

export interface PlaceInView {
  place: GoldenHourPlace;
  /** Distance (m) from the camera to the nearest sample point. */
  distance: number;
}

/** Is the place's landmark in the picture (distance and frustum rules)? Returns the distance, or null. */
export function placeInView(place: GoldenHourPlace, lm: BadgeLandmark | undefined, view: CameraView): PlaceInView | null {
  if (!lm) {
    return null;
  }
  const pts = samplePoints(place, lm);
  let nearest = Infinity;
  for (const p of pts) {
    nearest = Math.min(nearest, Math.hypot(p.x - view.position.x, p.y - view.position.y, p.z - view.position.z));
  }
  if (!Number.isFinite(nearest) || nearest > place.radius || nearest < BADGE_MIN_DISTANCE) {
    return null;
  }
  if (!pts.some((p) => inFrustum(view, p))) {
    return null;
  }
  return { place, distance: nearest };
}

/**
 * The golden-hour badge a photo qualifies for: sun in the band and a badge place in the picture; the closest one
 * (relative to its radius) wins when several are in frame. Null otherwise.
 */
export function goldenHourBadge(
  sunElevation: number,
  view: CameraView,
  landmark: (id: string) => BadgeLandmark | undefined,
  places: readonly GoldenHourPlace[] = GOLDEN_HOUR_PLACES,
): PlaceInView | null {
  if (!isGoldenHour(sunElevation)) {
    return null;
  }
  let best: PlaceInView | null = null;
  for (const place of places) {
    const hit = placeInView(place, landmark(place.landmarkId), view);
    if (hit && (!best || hit.distance / place.radius < best.distance / best.place.radius)) {
      best = hit;
    }
  }
  return best;
}

export function badgePlace(id: string | undefined): GoldenHourPlace | undefined {
  return id ? GOLDEN_HOUR_PLACES.find((p) => p.id === id) : undefined;
}
