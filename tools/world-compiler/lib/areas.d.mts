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
}

export const ROOT: string;
export function parseConst(file: string, name: string, keys: string[]): Record<string, number>;
export function readAreas(): AreaDef[];
export function readArea(id: string): AreaDef;
export function readOrigin(): { lat: number; lon: number };
