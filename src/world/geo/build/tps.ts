import type { GridSpec } from './grid';

/** Thin-plate spline f(p) = a0 + a1·x + a2·z + Σ wᵢ φ(|p − pᵢ|), φ(r) = r² ln r, coordinates in km. */
export interface ThinPlateSpline {
  cx: Float64Array;
  cz: Float64Array;
  w: Float64Array;
  a0: number;
  a1: number;
  a2: number;
}

const KM = 0.001;

function phi(r2: number): number {
  return r2 > 1e-12 ? 0.5 * r2 * Math.log(r2) : 0;
}

/**
 * Fits a smoothing thin-plate spline through flat [x, z, value] triples (meters).
 * `smoothing` is added to the kernel diagonal (km² units) and trades exactness for smoothness.
 */
export function fitThinPlateSpline(points: Float64Array, smoothing: number): ThinPlateSpline {
  const n = points.length / 3;
  const m = n + 3;
  const A = new Float64Array(m * m);
  const b = new Float64Array(m);
  const cx = new Float64Array(n);
  const cz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    cx[i] = points[i * 3] * KM;
    cz[i] = points[i * 3 + 1] * KM;
    b[i] = points[i * 3 + 2];
  }
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const dx = cx[i] - cx[j];
      const dz = cz[i] - cz[j];
      const v = i === j ? smoothing : phi(dx * dx + dz * dz);
      A[i * m + j] = v;
      A[j * m + i] = v;
    }
    A[i * m + n] = 1;
    A[i * m + n + 1] = cx[i];
    A[i * m + n + 2] = cz[i];
    A[n * m + i] = 1;
    A[(n + 1) * m + i] = cx[i];
    A[(n + 2) * m + i] = cz[i];
  }
  solveInPlace(A, b, m);
  return { cx, cz, w: b.slice(0, n), a0: b[n], a1: b[n + 1], a2: b[n + 2] };
}

/** Gaussian elimination with partial pivoting; the solution replaces `b`. */
function solveInPlace(A: Float64Array, b: Float64Array, m: number): void {
  for (let col = 0; col < m; col++) {
    let piv = col;
    let best = Math.abs(A[col * m + col]);
    for (let r = col + 1; r < m; r++) {
      const v = Math.abs(A[r * m + col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (piv !== col) {
      for (let c = col; c < m; c++) {
        const t = A[col * m + c];
        A[col * m + c] = A[piv * m + c];
        A[piv * m + c] = t;
      }
      const t = b[col];
      b[col] = b[piv];
      b[piv] = t;
    }
    const d = A[col * m + col];
    if (Math.abs(d) < 1e-12) {
      continue;
    }
    for (let r = col + 1; r < m; r++) {
      const f = A[r * m + col] / d;
      if (f === 0) {
        continue;
      }
      const ro = r * m;
      const co = col * m;
      for (let c = col; c < m; c++) {
        A[ro + c] -= f * A[co + c];
      }
      b[r] -= f * b[col];
    }
  }
  for (let r = m - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < m; c++) {
      s -= A[r * m + c] * b[c];
    }
    const d = A[r * m + r];
    b[r] = Math.abs(d) < 1e-12 ? 0 : s / d;
  }
}

/** Evaluates the spline at every cell center of `g` (only where `mask` is non-zero, when given). */
export function evaluateOnGrid(tps: ThinPlateSpline, g: GridSpec, mask?: Uint8Array): Float32Array {
  const n = g.size;
  const out = new Float32Array(n * n);
  const { cx, cz, w } = tps;
  const count = w.length;
  for (let r = 0; r < n; r++) {
    const z = (g.origin + r * g.cell) * KM;
    for (let c = 0; c < n; c++) {
      if (mask && !mask[r * n + c]) {
        continue;
      }
      const x = (g.origin + c * g.cell) * KM;
      let s = tps.a0 + tps.a1 * x + tps.a2 * z;
      for (let i = 0; i < count; i++) {
        const dx = x - cx[i];
        const dz = z - cz[i];
        const r2 = dx * dx + dz * dz;
        if (r2 > 1e-12) {
          s += w[i] * 0.5 * r2 * Math.log(r2);
        }
      }
      out[r * n + c] = s;
    }
  }
  return out;
}
