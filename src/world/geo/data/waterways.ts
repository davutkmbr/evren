/**
 * Centre lines of the two great waterways (flat lat, lon pairs), shared by the land-use partition and the
 * shore-flat relief pass.
 */

/** Mid-channel line of the Bosphorus, south (Marmara) to north (Black Sea); separates the two shores. */
export const BOSPHORUS_AXIS: readonly number[] = [
  41.0, 28.995, 41.008, 28.9983, 41.016, 28.9987, 41.024, 28.998, 41.028, 29.0017, 41.032, 29.0068, 41.036, 29.0113, 41.04, 29.0206,
  41.044, 29.0305, 41.048, 29.04, 41.056, 29.0441, 41.064, 29.048, 41.072, 29.0504, 41.08, 29.0587, 41.088, 29.0615, 41.096, 29.0595,
  41.104, 29.0624, 41.112, 29.0716, 41.12, 29.08, 41.128, 29.08, 41.136, 29.0737, 41.144, 29.068, 41.152, 29.068, 41.16, 29.066,
  41.168, 29.0703, 41.176, 29.0803, 41.184, 29.09, 41.192, 29.1, 41.2, 29.1045, 41.208, 29.1177, 41.216, 29.13, 41.224, 29.1367,
  41.27, 29.137,
];

/** Golden Horn (Haliç) centre line, mouth (Sarayburnu) to the Alibeyköy/Kağıthane creek mouths. */
export const GOLDEN_HORN_AXIS: readonly number[] = [
  41.0195, 28.9795, 41.0215, 28.9725, 41.0235, 28.9665, 41.0265, 28.9605, 41.0305, 28.9555, 41.0345, 28.9515, 41.0385, 28.9475,
  41.0425, 28.9435, 41.0465, 28.9415, 41.0505, 28.9405, 41.0545, 28.9425, 41.0575, 28.9445,
];

/** Returns the Bosphorus axis points between two latitudes, in the requested direction. */
export function bosphorusAxis(fromLat: number, toLat: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < BOSPHORUS_AXIS.length; i += 2) {
    const lat = BOSPHORUS_AXIS[i];
    if (lat >= Math.min(fromLat, toLat) - 1e-9 && lat <= Math.max(fromLat, toLat) + 1e-9) {
      pts.push(lat, BOSPHORUS_AXIS[i + 1]);
    }
  }
  if (fromLat > toLat) {
    const rev: number[] = [];
    for (let i = pts.length - 2; i >= 0; i -= 2) {
      rev.push(pts[i], pts[i + 1]);
    }
    return rev;
  }
  return pts;
}
