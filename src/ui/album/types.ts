/**
 * Photo album types (pause menu → Albüm). Pure data: shared by the metadata builder, the storage policy, the
 * IndexedDB store and the album screen.
 */
import type { CameraMode, WeatherPreset } from '../../core/contracts';

export type PhotoWeather = WeatherPreset | 'custom' | 'unknown';

/** What the dragon was doing when the photo was taken. */
export type PhotoDragonState = 'perched' | 'flying' | 'ground' | 'water' | 'none';

/** Where the caption's place name came from. */
export type PhotoPlaceKind = 'landmark' | 'perch' | 'district' | 'water' | 'city';

export interface PhotoMeta {
  /** Unique id, sortable by time ("p-<ms>-<rand>"). */
  id: string;
  /** Real capture time, epoch ms. */
  takenAt: number;
  /** In-game local time of day, hours [0, 24). */
  timeOfDay: number;
  /** In-game day of year 1..365. */
  dayOfYear: number;
  weather: PhotoWeather;
  /** Camera position (local metres) and view angles (heading 0 = north, pitch + up). */
  x: number;
  y: number;
  z: number;
  headingDeg: number;
  pitchDeg: number;
  /** Turkish place name for the caption ("Galata Kulesi", "Beyoğlu", "İstanbul Boğazı"). */
  place: string;
  placeKind: PhotoPlaceKind;
  /** Landmark in frame or nearby that named the place, if any. */
  landmarkId?: string;
  /** Camera mode before photo mode (photo mode itself is always the free camera). */
  cameraMode: CameraMode;
  dragon: PhotoDragonState;
  /** Perch id while perched. */
  perchId?: string;
  /** Sun elevation above the horizon in degrees (negative below). */
  sunElevationDeg: number;
  /** Sun inside the golden-hour band. */
  golden: boolean;
  /** Golden-hour place (GOLDEN_HOUR_PLACES id) this photo qualifies for, if any. */
  badgeId?: string;
  /** Encoded image size in pixels, MIME type and stored bytes (image + thumbnail). */
  width: number;
  height: number;
  mime: string;
  bytes: number;
}

/** One stored photo: metadata, full image and a small thumbnail. */
export interface PhotoRecord {
  meta: PhotoMeta;
  image: Blob;
  thumb: Blob;
}

/** A thumbnail entry for the album grid (full images are loaded on demand). */
export interface PhotoEntry {
  meta: PhotoMeta;
  thumb: Blob;
}

/** Storage used by the album's save policy; the IndexedDB store implements it, the headless check fakes it. */
export interface PhotoStore {
  listMeta(): Promise<PhotoMeta[]>;
  put(record: PhotoRecord): Promise<void>;
  remove(id: string): Promise<void>;
  /** Origin storage estimate (navigator.storage.estimate), null when unknown. */
  estimate?(): Promise<{ usage: number; quota: number } | null>;
}
