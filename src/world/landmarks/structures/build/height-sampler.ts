/**
 * Terrain heights for the worker: oriented patches sampled on the main thread from geo.heightAt().
 */
import type { HeightPatch } from '../types';

export interface PatchSpec {
  ox: number;
  oz: number;
  /** Heading of the patch's u axis in radians around +Y measured from +X toward +Z. */
  ux: number;
  uz: number;
  u0: number;
  lenU: number;
  v0: number;
  lenV: number;
  cell: number;
}

/** Main thread: samples a patch from a ground height function (geo.heightAt, or the visible ground). */
export function samplePatch(heightAt: (x: number, z: number) => number, spec: PatchSpec): HeightPatch {
  const nu = Math.max(2, Math.ceil(spec.lenU / spec.cell) + 1);
  const nv = Math.max(2, Math.ceil(spec.lenV / spec.cell) + 1);
  const data = new Float32Array(nu * nv);
  const vx = -spec.uz;
  const vz = spec.ux;
  for (let j = 0; j < nv; j++) {
    const v = spec.v0 + (j * spec.lenV) / (nv - 1);
    for (let i = 0; i < nu; i++) {
      const u = spec.u0 + (i * spec.lenU) / (nu - 1);
      const x = spec.ox + spec.ux * u + vx * v;
      const z = spec.oz + spec.uz * u + vz * v;
      data[j * nu + i] = heightAt(x, z);
    }
  }
  return { ...spec, nu, nv, data };
}

/** Worker side: bilinear lookups across a set of patches (first containing patch wins, else nearest clamp). */
export class HeightSampler {
  constructor(private readonly patches: readonly HeightPatch[]) {}

  heightAt(x: number, z: number): number {
    let best: HeightPatch | null = null;
    let bestOut = Infinity;
    let bu = 0;
    let bv = 0;
    for (const p of this.patches) {
      const dx = x - p.ox;
      const dz = z - p.oz;
      const u = dx * p.ux + dz * p.uz;
      const v = -dx * p.uz + dz * p.ux;
      const fu = (u - p.u0) / p.lenU;
      const fv = (v - p.v0) / p.lenV;
      const out = Math.max(0, -fu, fu - 1) * p.lenU + Math.max(0, -fv, fv - 1) * p.lenV;
      if (out < bestOut) {
        bestOut = out;
        best = p;
        bu = fu;
        bv = fv;
        if (out === 0) {
          break;
        }
      }
    }
    if (!best) {
      return 0;
    }
    const gu = Math.min(Math.max(bu, 0), 1) * (best.nu - 1);
    const gv = Math.min(Math.max(bv, 0), 1) * (best.nv - 1);
    const i0 = Math.min(Math.floor(gu), best.nu - 2);
    const j0 = Math.min(Math.floor(gv), best.nv - 2);
    const tu = gu - i0;
    const tv = gv - j0;
    const d = best.data;
    const n = best.nu;
    const h00 = d[j0 * n + i0];
    const h10 = d[j0 * n + i0 + 1];
    const h01 = d[(j0 + 1) * n + i0];
    const h11 = d[(j0 + 1) * n + i0 + 1];
    return (h00 * (1 - tu) + h10 * tu) * (1 - tv) + (h01 * (1 - tu) + h11 * tu) * tv;
  }

  /** Max terrain height within a disc (coarse ring sampling). */
  maxInDisc(x: number, z: number, r: number): number {
    let h = this.heightAt(x, z);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      h = Math.max(h, this.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r));
      h = Math.max(h, this.heightAt(x + Math.cos(a) * r * 0.5, z + Math.sin(a) * r * 0.5));
    }
    return h;
  }

  minInDisc(x: number, z: number, r: number): number {
    let h = this.heightAt(x, z);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      h = Math.min(h, this.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r));
    }
    return h;
  }
}
