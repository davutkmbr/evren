/**
 * Phase 21 stage 6 tunables: the weather's hold on the sea. Storms raise the wind the waves are built from (so the 7c
 * whitecaps and spindrift follow), rain draws drop rings on the surface and damps the small waves. Units: metres,
 * seconds, m/s.
 */
export const SEA_WEATHER = {
  /**
   * The 10 m wind (U10, m/s) a full storm (weather `storm` = 1) holds the sea at, at least: the environment wind alone
   * tops out near U10 9.4 (12 m/s at 100 m), which leaves a storm with ~0.8 % whitecaps. At 15 the open sea carries
   * ~4 % (Monahan), whitecaps everywhere, and spindrift blows off the crests (from U10 12).
   */
  stormU10: 15,
  /** Squalls under rain: the wind the sea feels gusts this much higher at full rain (share of U10). */
  rainGust: 0.12,
  /** The highest U10 the sea is built from (the spectrum's range). */
  maxU10: 16,
  /**
   * Rain damps the short gravity waves (the detail bands) by up to this share at full rain (Tsimplis 1992: rain-induced
   * turbulence damps waves of a few decimetres to metres; the drop rings add their own mm-scale roughness).
   */
  rainDamp: 0.3,
  /** Rain intensity below which the rings are off entirely (the shader skips their branch). */
  rainOn: 0.01,
} as const;

/**
 * Drop rings on the water (water fragment, `RAIN_RING_GLSL`): two staggered layers of cells, each cell one drop per
 * cycle at a random point; its ring runs out to `ringMax` while it fades. No geometry: a procedural ripple normal,
 * faded into roughness where the ring is finer than the pixel.
 */
export const RAIN_RINGS = {
  /** Cell size (m): one drop per cell and cycle and layer. */
  cell: 0.8,
  /** Cycle length (s): a ring's life. */
  period: 1.1,
  /** Ring radius at the end of its life (m); stays inside the cell (the drop point keeps 0.3 of the cell off the edges). */
  ringMax: 0.22,
  /** Half width of the ring's crest-trough wavelet (m) and its height (m). */
  width: 0.018,
  amplitude: 0.0025,
  /** Share of the cells that get a drop each cycle at full rain (per layer). */
  density: 0.85,
  /** Mean square slope the rings add where they are finer than the pixel, at full rain. */
  unresolvedVar: 0.004,
  /** Resolved from 0.8 x width per pixel down, pure roughness beyond 3 x width per pixel (the branch is skipped). */
  fadeStart: 0.8,
  fadeEnd: 3,
  /** The shader's rain clock wraps after this many cycles (keeps fp32 time small). */
  wrapCycles: 200,
} as const;
