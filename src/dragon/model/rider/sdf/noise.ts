/** Hashed 3D value noise and fbm for SDF displacement (cloth folds, hair clumps). Plain numbers: runs in workers. */

function hash(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h & 0xffffff) / 0xffffff;
}

/** Value noise in [0, 1] with smooth (quintic) interpolation. */
export function vnoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
  const a = hash(xi, yi, zi);
  const b = hash(xi + 1, yi, zi);
  const c = hash(xi, yi + 1, zi);
  const d = hash(xi + 1, yi + 1, zi);
  const e = hash(xi, yi, zi + 1);
  const f = hash(xi + 1, yi, zi + 1);
  const g = hash(xi, yi + 1, zi + 1);
  const h = hash(xi + 1, yi + 1, zi + 1);
  const x0 = a + (b - a) * u;
  const x1 = c + (d - c) * u;
  const x2 = e + (f - e) * u;
  const x3 = g + (h - g) * u;
  const y0 = x0 + (x1 - x0) * v;
  const y1 = x2 + (x3 - x2) * v;
  return y0 + (y1 - y0) * w;
}

/** Three-octave fbm, centred on 0 (about -0.5 .. 0.5). */
export function fbm3(x: number, y: number, z: number): number {
  return (
    (vnoise3(x, y, z) - 0.5) * 0.57 +
    (vnoise3(x * 2.03 + 17.1, y * 2.03 + 3.3, z * 2.03 + 9.7) - 0.5) * 0.29 +
    (vnoise3(x * 4.1 + 5.2, y * 4.1 + 21.4, z * 4.1 + 1.9) - 0.5) * 0.14
  );
}
