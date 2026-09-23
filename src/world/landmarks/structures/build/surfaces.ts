/**
 * Surface / emission ids shared by the geometry builders (worker) and the shaders (render/glsl).
 * Keep the numbers in sync with the #defines emitted by render/glsl/surface.glsl.ts (they are generated from here).
 */

/** Opaque batch surface types (aSurf.x). */
export const Surf = {
  /** Painted structural steel (bridge towers, box girders): panel seams every `param` m. */
  Steel: 0,
  /** Cast concrete with formwork lifts. */
  Concrete: 1,
  /** Dressed ashlar masonry, course height `param` m. */
  Ashlar: 2,
  /** Coursed rubble stone (Galata). */
  Rubble: 3,
  /** Asphalt carriageway with lane markings: param = lanes per direction. */
  Road: 4,
  /** Lead / zinc sheet roofing with standing seams. */
  Lead: 5,
  /** Plain painted surface (plaster, cladding, rendered walls). */
  Plain: 6,
  /** Ballastless rail / tram track slab: param = track gauge centre spacing. */
  Rail: 7,
  /** Paving stones / walkway. */
  Paving: 8,
  /** Dark window glazing inside opaque buildings (small towers). */
  Window: 9,
} as const;

/** Emission modes (aEmit.x). */
export const Emit = {
  None: 0,
  /** Floodlit at night: a = intensity, b = colour temperature index, c = height (m) the washers reach. */
  Flood: 1,
  /** RGB LED show: a = LED group, b = u along the structure (0..1), c = intensity. */
  Led: 2,
  /** Lit windows: a = intensity, b = seed, c = probability a window is lit. */
  Windows: 3,
  /** Street-lamp pools on a road: a = lamp spacing (m), b = phase (m), c = intensity. */
  RoadLamps: 4,
  /** Constant self-emission at night (albedo * a): signage, shop fronts, lanterns. */
  Glow: 5,
  /** Glass batch: crown lighting above height a (m), colour index b, intensity c. */
  Crown: 6,
} as const;

/** LED show groups (colour programs are offset per group). */
export const LedGroup = {
  None: 0,
  Bogazici: 1,
  Fsm: 2,
  Yss: 3,
  Camlica: 4,
  Sapphire: 5,
  Skyland: 6,
  Metropol: 7,
} as const;

/** Glass facade styles (glass batch aSurf.x). */
export const Facade = {
  /** Blue-green reflective glass, frit spandrel bands. */
  BlueBand: 0,
  /** Silver reflective glass with vertical aluminium fins. */
  SilverFins: 1,
  /** Dark grey glass with a strong light mullion grid. */
  DarkGrid: 2,
  /** Residential: clear glass, white slab edges, balcony rails. */
  Residential: 3,
  /** Green tinted glass with horizontal bands. */
  GreenBand: 4,
  /** Bronze reflective glass. */
  Bronze: 5,
  /** Çamlıca bud: glass with white vertical ribs. */
  Ribbed: 6,
} as const;

/** Crown light colour indices (glass batch Emit.Crown b). */
export const CrownColor = {
  WarmWhite: 0,
  CoolWhite: 1,
  Blue: 2,
  Led: 3,
  Red: 4,
} as const;

/** Light sprite modes. */
export const LightMode = {
  /** Steady, on at night. */
  Night: 0,
  /** Aviation obstruction light: p0 period (s), p1 phase (0..1), p2 duty. */
  Blink: 1,
  /** LED show point: p0 group, p1 u, p2 v. */
  Led: 2,
  /** Always on (day and night). */
  Always: 3,
  /** Vehicle light stream along a lane: a0..a2 lane vector, a3 vertical bulge (m), p0 speed (m/s), p1 phase, p2 spacing. */
  Traffic: 4,
  /** Slow lighthouse pulse: p0 period. */
  Beacon: 5,
} as const;

export type Rgb = readonly [number, number, number];

/** sRGB hex -> linear rgb. */
export function linearHex(hex: number): [number, number, number] {
  const c = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
}

/** Approximate blackbody colour (linear, luminance ~1) for a colour temperature in kelvin. */
export function kelvin(k: number): [number, number, number] {
  const t = k / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const lin = (v: number): number => {
    const s = Math.min(Math.max(v, 0), 255) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const out: [number, number, number] = [lin(r), lin(g), lin(b)];
  const lum = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  return [out[0] / lum, out[1] / lum, out[2] / lum];
}
