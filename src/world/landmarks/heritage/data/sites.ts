/**
 * Point facts for the remaining sites (OpenStreetMap © OpenStreetMap contributors, ODbL; heights from public references).
 */
import type { GeoPoint } from './types';

export interface WallGate extends GeoPoint {
  name: string;
  /** Main gates get a pair of flanking towers and a tall arch; posterns stay small. */
  major: boolean;
}

/** Theodosian land wall gates, south → north. */
export const LAND_WALL_GATES: readonly WallGate[] = [
  { name: 'Belgrad Kapı', lat: 40.99983, lon: 28.92051, major: true },
  { name: 'Silivrikapı', lat: 41.00608, lon: 28.92183, major: true },
  { name: 'Mevlevihanekapı', lat: 41.01418, lon: 28.92203, major: true },
  { name: 'Topkapı', lat: 41.02169, lon: 28.92617, major: true },
  { name: 'Sulukule Kapı', lat: 41.02610, lon: 28.93092, major: false },
  { name: 'Edirnekapı', lat: 41.02878, lon: 28.93401, major: true },
  { name: 'Eğrikapı', lat: 41.03647, lon: 28.9394, major: false },
];

/** Point where the double Theodosian walls end and the single Blachernae wall begins (Tekfur Sarayı). */
export const BLACHERNAE_START: GeoPoint = { lat: 41.0306, lon: 28.9357 };

/** Hippodrome monuments (spina line). */
export const HIPODROM = {
  alman: { lat: 41.007114, lon: 28.976676 },
  dikilitas: { lat: 41.005925, lon: 28.9754 },
  yilanli: { lat: 41.005664, lon: 28.97511 },
  orme: { lat: 41.005402, lon: 28.97484 },
} as const;

/** Selimiye Kışlası outer corners (≈ 257 × 191 m). */
export const SELIMIYE_CORNERS: readonly number[] = [41.00945, 29.015164, 41.008315, 29.017832, 41.006812, 29.016736, 41.007928, 29.01408];

/** Sirkeci Garı main building (≈ 96 × 20 m, main facade to the north). */
export const SIRKECI_RECT: readonly number[] = [41.015338, 28.976456, 41.015353, 28.977599, 41.01518, 28.977599, 41.015154, 28.97646];

/** Anadolu Hisarı keep centre (real site, ~250 m NW of the geo pad). */
export const ANADOLU_SITE: GeoPoint = { lat: 41.08212, lon: 29.06706 };
