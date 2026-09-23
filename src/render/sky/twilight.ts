import * as THREE from 'three';

/**
 * Twilight compression of the sun's sky light.
 *
 * Between sunset and astronomical night the real sky dims ~10^6 while the post exposure only adapts ~6 EV (and the
 * night is compressed: full moon ~1/18 of the sun), so the sun's contribution to the sky-view LUT (and through it the
 * ambient, fog and environment light) is rescaled after sunset:
 *
 *   boost(e) = target(e) / physical(max(e, TWILIGHT_SKY_MIN_ELEVATION_DEG))
 *
 * `physical` is the mean luminance of the LUT (zenith, 3 deg horizon ring, 30 deg ring) rendered with boost 1 at haze
 * 0.55, measured in the sky sandbox. `target` follows the physical curve down to +0.5 deg, then falls with a log-slope
 * of 0.14 dex/deg through civil twilight, ~0.19 through nautical twilight and 0.3-0.4 towards astronomical night, so
 * the sky gets monotonically darker (verified for haze 0.4-1.15 on each of the three rings) and fades into the
 * city/moon floor around -9..-11 deg. Below -7 deg the model's own twilight vanishes (the whole 100 km atmosphere is in
 * the planet's shadow at -10.1 deg), so the LUT keeps rendering the late-nautical sky shape and only dims it.
 */
export const TWILIGHT_SKY_MIN_ELEVATION_DEG = -7;

/** [sun elevation deg, boost, target sky level relative to sunset]. */
const BOOST_TABLE: ReadonlyArray<readonly [number, number, number]> = [
  [0.5, 1, 1.497],
  [0.25, 1.002, 1.212],
  [0, 1.014, 1],
  [-0.25, 1.043, 0.8436],
  [-0.5, 1.091, 0.7263],
  [-0.75, 1.164, 0.6425],
  [-1, 1.268, 0.5754],
  [-1.25, 1.41, 0.5268],
  [-1.5, 1.605, 0.4849],
  [-1.75, 1.828, 0.4475],
  [-2, 2.04, 0.4128],
  [-2.25, 2.216, 0.381],
  [-2.5, 2.379, 0.3514],
  [-2.75, 2.557, 0.324],
  [-3, 2.757, 0.2989],
  [-3.25, 2.981, 0.276],
  [-3.5, 3.246, 0.2547],
  [-3.75, 3.56, 0.2346],
  [-4, 3.928, 0.2168],
  [-4.25, 4.399, 0.2],
  [-4.5, 5.04, 0.1844],
  [-4.75, 5.939, 0.1704],
  [-5, 7.359, 0.157],
  [-5.25, 9.845, 0.1441],
  [-5.5, 13.75, 0.1307],
  [-5.75, 17.97, 0.1173],
  [-6, 19.89, 0.105],
  [-6.25, 21.65, 0.09385],
  [-6.5, 23.3, 0.08436],
  [-6.75, 25.08, 0.07598],
  [-7, 27.08, 0.06927],
  [-7.25, 24.66, 0.06313],
  [-7.5, 22.39, 0.05698],
  [-7.75, 20.28, 0.05179],
  [-8, 18.31, 0.04676],
  [-8.5, 14.79, 0.03777],
  [-9, 11.82, 0.03017],
  [-9.5, 9.321, 0.0238],
  [-10, 7.246, 0.01849],
  [-11, 4.194, 0.01073],
  [-12, 2.291, 0.005866],
  [-13, 1.182, 0.003017],
  [-14, 0.5789, 0.00148],
  [-16, 0.1209, 0.0003089],
  [-18, 0.02102, 5.369e-05],
];

/** Multiplier on the sun's sky light for the given (apparent) sun elevation in degrees. */
export function twilightSkyBoost(elevationDeg: number): number {
  return elevationDeg >= BOOST_TABLE[0][0] ? 1 : interpolateLog(elevationDeg, 1);
}

/**
 * Weight (0..1) with which the night-sky sources (moonlit sky, city skyglow) fade in after sunset: the complement of
 * the normalised twilight target, so (twilight + floor) keeps falling as long as the floor is below the sunset sky.
 */
export function nightSkyWeight(elevationDeg: number): number {
  if (elevationDeg >= 0) {
    return 0;
  }
  return THREE.MathUtils.clamp(1 - twilightSkyLevel(elevationDeg), 0, 1);
}

/** Target sky brightness relative to sunset (1 at 0 deg, falling monotonically below). */
export function twilightSkyLevel(elevationDeg: number): number {
  return interpolateLog(elevationDeg, 2);
}

function interpolateLog(elevationDeg: number, column: 1 | 2): number {
  if (elevationDeg >= BOOST_TABLE[0][0]) {
    return BOOST_TABLE[0][column];
  }
  for (let i = 1; i < BOOST_TABLE.length; i++) {
    const row = BOOST_TABLE[i];
    if (elevationDeg >= row[0]) {
      const prev = BOOST_TABLE[i - 1];
      const t = (elevationDeg - prev[0]) / (row[0] - prev[0]);
      return Math.exp(THREE.MathUtils.lerp(Math.log(prev[column]), Math.log(row[column]), t));
    }
  }
  return BOOST_TABLE[BOOST_TABLE.length - 1][column];
}

/** Sun direction used for the sky LUT: same azimuth, elevation clamped to TWILIGHT_SKY_MIN_ELEVATION_DEG. */
export function twilightSkyDirection(sunDirection: THREE.Vector3, elevationDeg: number, out: THREE.Vector3): THREE.Vector3 {
  if (elevationDeg >= TWILIGHT_SKY_MIN_ELEVATION_DEG) {
    return out.copy(sunDirection);
  }
  const horizontal = Math.hypot(sunDirection.x, sunDirection.z);
  const el = THREE.MathUtils.degToRad(TWILIGHT_SKY_MIN_ELEVATION_DEG);
  if (horizontal < 1e-6) {
    return out.set(Math.cos(el), Math.sin(el), 0);
  }
  const k = Math.cos(el) / horizontal;
  return out.set(sunDirection.x * k, Math.sin(el), sunDirection.z * k);
}
