export interface AreaBBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface AreaDef {
  id: string;
  bbox: AreaBBox;
  dataFile: string;
  profile: 'slice' | 'street';
  /** Set when the area is a landing spot of districts/landing-spots.json (its id). */
  spot?: string;
}

export interface LandingSpot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius: number;
  profile: string;
  placeWords: string[];
  area?: string;
  /** Landing point in world-local metres. */
  x: number;
  z: number;
  /** Compiled square (local metres) and its bbox in degrees. */
  rect: { minX: number; minZ: number; maxX: number; maxZ: number };
  bbox: AreaBBox;
}

export const ROOT: string;
export function parseConst(file: string, name: string, keys: string[]): Record<string, number>;
export function readAreas(): AreaDef[];
export function readArea(id: string): AreaDef;
export function readLandingSpots(): LandingSpot[];
export function readLandingSpot(id: string): LandingSpot | null;
export function readOrigin(): { lat: number; lon: number };
