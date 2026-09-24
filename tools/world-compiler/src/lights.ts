/**
 * Light list of a tile (format 1). Physical units: point and spot `intensity` in candela, area lights in nits;
 * `lumens` is the source's output; colours come from a colour temperature. Night-only lights (street lamps, signs,
 * windows) have `night: true`; runtimes switch them with their emissive materials (material extras.emissive.night).
 */
import type { LightRec, XYZ } from './format';

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Linear RGB (max channel 1) of a black body at `kelvin` (Tanner Helland's fit in sRGB, then linearised). */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const lin = (c: number): number => {
    const s = Math.min(255, Math.max(0, c)) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const rgb = [lin(r), lin(g), lin(b)];
  const m = Math.max(...rgb) || 1;
  return [r3(rgb[0] / m), r3(rgb[1] / m), r3(rgb[2] / m)];
}

/** Candela of a spot of `lumens` spread evenly over a cone of half-angle `outerDeg`. */
export function spotCandela(lumens: number, outerDeg: number): number {
  return lumens / (2 * Math.PI * (1 - Math.cos((outerDeg * Math.PI) / 180)));
}

/** Candela of an isotropic point light. */
export const pointCandela = (lumens: number): number => lumens / (4 * Math.PI);

/** Distance (m) at which `candela` falls to `lux` (inverse square), clamped to [minM, maxM]. */
export function lightRange(candela: number, lux = 0.3, minM = 6, maxM = 45): number {
  return Math.min(maxM, Math.max(minM, Math.sqrt(candela / lux)));
}

export type LightInput = Omit<LightRec, 'id' | 'color' | 'intensity' | 'range'> & { intensity?: number; range?: number };

/** Lights of one tile; ids are "<tile>/l<k>" in insertion order. */
export class LightSink {
  readonly list: LightRec[] = [];

  constructor(readonly tile: string) {}

  /** Adds a light; intensity (cd) and range default from lumens and the cone. */
  add(l: LightInput): LightRec {
    const intensity = l.intensity ?? (l.type === 'spot' ? spotCandela(l.lumens, l.cone?.outer ?? 60) : l.type === 'point' ? pointCandela(l.lumens) : l.lumens / (Math.PI * (l.size ? l.size[0] * l.size[1] : 1)));
    const rec: LightRec = {
      id: `${this.tile}/l${this.list.length}`,
      type: l.type,
      position: l.position.map(r2) as XYZ,
      kelvin: l.kelvin,
      color: kelvinToRgb(l.kelvin),
      intensity: r2(intensity),
      lumens: Math.round(l.lumens),
      range: r2(l.range ?? lightRange(l.type === 'area' ? l.lumens / (4 * Math.PI) : intensity)),
      night: l.night,
      source: l.source,
    };
    if (l.direction) {
      rec.direction = l.direction.map(r3) as XYZ;
    }
    if (l.cone) {
      rec.cone = l.cone;
    }
    if (l.size) {
      rec.size = l.size;
    }
    if (l.ref) {
      rec.ref = l.ref;
    }
    if (l.castShadow) {
      rec.castShadow = true;
    }
    this.list.push(rec);
    return rec;
  }
}

/** Colour temperature of the street lighting classes of the flight slice (src/world/osm/streets/kinds.ts). */
export const LAMP_KELVIN = { sodium: 2000, led: 4000, warm: 3000 } as const;
