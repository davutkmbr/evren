import type { MeshBuilder } from '../builder';
import { Light, Mat, type LodLevel, type V3 } from '../types';

/**
 * Golden alem finial standing on local y = 0: stacked bulbs on a rod, crowned by a crescent whose horns point up and
 * whose face looks along local ±Z (toward the qibla when the building frame is qibla-aligned).
 */
export function alem(b: MeshBuilder, height: number, lod: LodLevel): void {
  const h = height;
  const rodR = h * 0.022;
  const seg = lod === 0 ? 12 : 6;
  if (h >= 1.2) {
    // bulbs on the rod, then the crescent as a thin slab in its own plane (small finials on arcade domes get none)
    b.colCylinder(0, 0, 0, h * 0.1, h * 0.62);
    b.colBox(-h * 0.2, h * 0.6, -Math.max(0.12, h * 0.02), h * 0.2, h * 1.02, Math.max(0.12, h * 0.02));
  }
  b.with({ mat: Mat.Gold, light: Light.Cap, lightBase: b.worldY(0, 0, 0) - 1.5, ao: 1 }, () => {
    if (lod === 2) {
      b.lathe([rodR * 1.8, 0, h * 0.09, h * 0.12, rodR, h * 0.28, rodR, h * 0.75, 0, h * 0.8], { seg: 4, facets: true });
      return;
    }
    const bulb = (y: number, r: number, hh: number): number[] => {
      const pts: number[] = [];
      const n = lod === 0 ? 7 : 4;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const a = -Math.PI / 2 + Math.PI * t;
        pts.push(Math.max(rodR, r * Math.cos(a)), y + hh * 0.5 + hh * 0.5 * Math.sin(a));
      }
      return pts;
    };
    const prof: number[] = [rodR * 1.8, 0, rodR * 1.8, h * 0.04];
    prof.push(...bulb(h * 0.04, h * 0.1, h * 0.16));
    prof.push(rodR, h * 0.22);
    prof.push(...bulb(h * 0.23, h * 0.075, h * 0.12));
    prof.push(rodR, h * 0.37);
    prof.push(...bulb(h * 0.38, h * 0.055, h * 0.09));
    prof.push(rodR * 0.8, h * 0.62, 0, h * 0.62);
    b.lathe(prof, { seg });
    crescent(b, h * 0.62, h * 0.2, lod);
  });
}

/** Flat crescent (thickness ~ 8 % of radius) centred at height y, horns up, in the local XY plane. */
export function crescent(b: MeshBuilder, y: number, radius: number, lod: LodLevel): void {
  const n = lod === 0 ? 14 : 6;
  const R = radius;
  const r2 = R * 0.8;
  const off = R * 0.32;
  const t = R * 0.09;
  const cy = y + R * 0.95;
  const outer: [number, number][] = [];
  const inner: [number, number][] = [];
  const hornA = 0.52;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI * 0.5 + hornA + ((Math.PI * 2 - hornA * 2) * i) / n;
    outer.push([R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  const tipL = outer[0];
  const tipR = outer[n];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const a = Math.PI * 0.5 + (hornA + 0.35) + ((Math.PI * 2 - (hornA + 0.35) * 2) * s);
    const px = r2 * Math.cos(a);
    const py = cy + off + r2 * Math.sin(a);
    const w = Math.pow(Math.abs(s - 0.5) * 2, 6);
    const tip = s < 0.5 ? tipL : tipR;
    inner.push([px * (1 - w) + tip[0] * w, py * (1 - w) + tip[1] * w]);
  }
  for (const side of [1, -1]) {
    const z = (t / 2) * side;
    for (let i = 0; i < n; i++) {
      const a: V3 = [outer[i][0], outer[i][1], z];
      const c: V3 = [outer[i + 1][0], outer[i + 1][1], z];
      const d: V3 = [inner[i + 1][0], inner[i + 1][1], z];
      const e: V3 = [inner[i][0], inner[i][1], z];
      if (side > 0) {
        b.quad(a, c, d, e);
      } else {
        b.quad(e, d, c, a);
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const p = outer[i];
    const q = outer[i + 1];
    b.quad([p[0], p[1], t / 2], [p[0], p[1], -t / 2], [q[0], q[1], -t / 2], [q[0], q[1], t / 2]);
    const pi = inner[i];
    const qi = inner[i + 1];
    b.quad([qi[0], qi[1], t / 2], [qi[0], qi[1], -t / 2], [pi[0], pi[1], -t / 2], [pi[0], pi[1], t / 2]);
  }
}

/** Classic Ottoman cornice profile [out, y]: fascia, cavetto, drip; `s` scales it. */
export function corniceProfile(s: number): number[] {
  return [0, 0, 0.06 * s, 0.02 * s, 0.1 * s, 0.14 * s, 0.22 * s, 0.26 * s, 0.34 * s, 0.34 * s, 0.36 * s, 0.46 * s, 0, 0.5 * s];
}

/** String course: a thin projecting band. */
export function bandProfile(s: number): number[] {
  return [0, 0, 0.1 * s, 0.03 * s, 0.12 * s, 0.14 * s, 0, 0.2 * s];
}

/** Rectangular XZ path helper for sweeps. */
export function rectPath(x0: number, z0: number, x1: number, z1: number): [number, number][] {
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
}

export function polyPath(r: number, n: number, phase = 0): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    out.push([r * Math.sin(a), r * Math.cos(a)]);
  }
  return out;
}

/**
 * Lead roof slab over a rectangle at height y with a thin edge; `pitch` > 0 raises the middle into a low hipped roof.
 */
export function flatRoof(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, y: number, pitch = 0): void {
  if (pitch > 0.3) {
    // the hipped roof as stacked boxes, each inset to where the slopes reach its top (the walls below register
    // their own box)
    const inset = Math.min(x1 - x0, z1 - z0) / 2;
    const tiers = Math.max(2, Math.ceil(pitch / 0.8));
    for (let k = 0; k < tiers; k++) {
      const d = (inset * k) / tiers;
      b.colBox(x0 + d, y - 0.1 + (pitch * k) / tiers, z0 + d, x1 - d, y + (pitch * (k + 1)) / tiers, z1 - d);
    }
  }
  b.with({ mat: Mat.Lead, light: Light.None, ao: 0.95 }, () => {
    if (pitch <= 0) {
      b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);
      return;
    }
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const inset = Math.min(x1 - x0, z1 - z0) / 2;
    const rx0 = Math.min(cx, x0 + inset);
    const rx1 = Math.max(cx, x1 - inset);
    const rz0 = Math.min(cz, z0 + inset);
    const rz1 = Math.max(cz, z1 - inset);
    const yt = y + pitch;
    b.quad([x0, y, z1], [x1, y, z1], [rx1, yt, rz1], [rx0, yt, rz1]);
    b.quad([x1, y, z0], [x0, y, z0], [rx0, yt, rz0], [rx1, yt, rz0]);
    b.quad([x1, y, z1], [x1, y, z0], [rx1, yt, rz0], [rx1, yt, rz1]);
    b.quad([x0, y, z0], [x0, y, z1], [rx0, yt, rz1], [rx0, yt, rz0]);
    if (rx1 - rx0 > 1e-3 && rz1 - rz0 > 1e-3) {
      b.quad([rx0, yt, rz1], [rx1, yt, rz1], [rx1, yt, rz0], [rx0, yt, rz0]);
    }
  });
}

/** Terracotta hipped roof with eaves over a rectangle (neighbourhood mescits). */
export function tileRoof(b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, y: number, pitchDeg: number, eave: number): void {
  const ex0 = x0 - eave;
  const ex1 = x1 + eave;
  const ez0 = z0 - eave;
  const ez1 = z1 + eave;
  const half = Math.min(ex1 - ex0, ez1 - ez0) / 2;
  const rise = half * Math.tan((pitchDeg * Math.PI) / 180);
  const cx = (ex0 + ex1) / 2;
  const cz = (ez0 + ez1) / 2;
  const rx0 = Math.min(cx, ex0 + half);
  const rx1 = Math.max(cx, ex1 - half);
  const rz0 = Math.min(cz, ez0 + half);
  const rz1 = Math.max(cz, ez1 - half);
  const yt = y + rise;
  const ye = y - eave * Math.tan((pitchDeg * Math.PI) / 180) * 0.6;
  b.with({ mat: Mat.Tile, light: Light.Dome, lightBase: y, ao: 1 }, () => {
    b.quad([ex0, ye, ez1], [ex1, ye, ez1], [rx1, yt, rz1], [rx0, yt, rz1]);
    b.quad([ex1, ye, ez0], [ex0, ye, ez0], [rx0, yt, rz0], [rx1, yt, rz0]);
    b.quad([ex1, ye, ez1], [ex1, ye, ez0], [rx1, yt, rz0], [rx1, yt, rz1]);
    b.quad([ex0, ye, ez0], [ex0, ye, ez1], [rx0, yt, rz1], [rx0, yt, rz0]);
  });
  b.with({ mat: Mat.Dark, color: [0.3, 0.24, 0.18], ao: 0.5, light: Light.Soffit }, () => {
    b.quad([ex1, ye, ez1], [ex0, ye, ez1], [ex0, ye, ez0], [ex1, ye, ez0]);
  });
}
