/**
 * Textures the landmark export composes from approved sets, for patterns the web draws in its shaders:
 *
 * - `lm_byzantine`: the Theodosian walls' limestone courses with a five-course brick band (walls/render/material.ts
 *   wByzantine; period 2.4 m, band 0.5 m);
 * - `lm_banded`: the mosques' banded masonry (mosques/render/glsl.ts, Mat.Banded: per 1.25 m, the lower 52 % brick);
 * - `lm_facade_<style>`: the heritage facades' window grid (heritage/render/glsl/facade.glsl.ts hFacade, parameters
 *   from FACADE_STYLES): one bay wide, sill + rows x floor high, window outline, surround, sill, glazing bars.
 *
 * All are tinted materials: the colour stores (texel / mean of its source) x 0.5 in sRGB, the material factor is 2 and
 * COLOR_0 carries the builders' tint, like the other tinted landmark materials. Rows of the image run with the uv's v
 * (row 0 = v 0 = the base of the wall), which is how glTF uv maps onto the image.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { FacadeStyle } from '../../../src/world/landmarks/heritage/build/surfaces';
import type { LandmarkMaterial } from './materials';

export interface SetFiles {
  color: string;
  normal?: string;
  orm?: string;
  /** Metres per repeat of the set. */
  tiling: [number, number];
}

interface Raw {
  w: number;
  h: number;
  c: number;
  data: Buffer;
}

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const LIN = Array.from({ length: 256 }, (_, i) => toLinear(i / 255));
const SCALE = 0.5;
/** Composite resolution (px per metre). */
const PPM = 160;

async function load(file: string): Promise<Raw> {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, c: info.channels, data };
}

class Source {
  mean: [number, number, number] = [1, 1, 1];
  private constructor(
    readonly color: Raw,
    readonly normal: Raw | null,
    readonly orm: Raw | null,
    readonly tiling: [number, number],
  ) {}

  static async open(f: SetFiles): Promise<Source> {
    const s = new Source(await load(f.color), f.normal ? await load(f.normal) : null, f.orm ? await load(f.orm) : null, f.tiling);
    const sum = [0, 0, 0];
    const d = s.color.data;
    for (let i = 0; i < d.length; i += s.color.c) {
      sum[0] += LIN[d[i]];
      sum[1] += LIN[d[i + 1]];
      sum[2] += LIN[d[i + 2]];
    }
    const n = d.length / s.color.c;
    s.mean = [sum[0] / n, sum[1] / n, sum[2] / n];
    return s;
  }

  /** Pixel offset of (u, v) metres in an image of this set (wrapping; image row 0 = v 0). */
  private at(img: Raw, u: number, v: number): number {
    const x = Math.floor((((u / this.tiling[0]) % 1) + 1) % 1 * img.w) % img.w;
    const y = Math.floor((((v / this.tiling[1]) % 1) + 1) % 1 * img.h) % img.h;
    return (y * img.w + x) * img.c;
  }

  /** Linear colour relative to the set's mean. */
  rel(u: number, v: number, out: number[]): void {
    const o = this.at(this.color, u, v);
    out[0] = LIN[this.color.data[o]] / this.mean[0];
    out[1] = LIN[this.color.data[o + 1]] / this.mean[1];
    out[2] = LIN[this.color.data[o + 2]] / this.mean[2];
  }

  nrm(u: number, v: number, out: number[]): void {
    if (!this.normal) {
      out[0] = 128;
      out[1] = 128;
      out[2] = 255;
      return;
    }
    const o = this.at(this.normal, u, v);
    out[0] = this.normal.data[o];
    out[1] = this.normal.data[o + 1];
    out[2] = this.normal.data[o + 2];
  }

  orms(u: number, v: number, out: number[]): void {
    if (!this.orm) {
      out[0] = 255;
      out[1] = 230;
      out[2] = 0;
      return;
    }
    const o = this.at(this.orm, u, v);
    out[0] = this.orm.data[o];
    out[1] = this.orm.data[o + 1];
    out[2] = this.orm.data[o + 2];
  }
}

/** Per pixel: fills colour (linear, relative to the tint), normal and ORM bytes for (u, v) metres. */
type Shader = (u: number, v: number, col: number[], nrm: number[], orm: number[]) => void;

async function render(dir: string, id: string, widthM: number, heightM: number, shade: Shader, roughness: number): Promise<LandmarkMaterial> {
  const w = Math.max(64, Math.round(widthM * PPM));
  const h = Math.max(64, Math.round(heightM * PPM));
  const col = Buffer.alloc(w * h * 3);
  const nrm = Buffer.alloc(w * h * 3);
  const orm = Buffer.alloc(w * h * 3);
  const c = [0, 0, 0];
  const n = [0, 0, 0];
  const o = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const v = ((y + 0.5) / h) * heightM;
    for (let x = 0; x < w; x++) {
      const u = ((x + 0.5) / w) * widthM;
      shade(u, v, c, n, o);
      const p = (y * w + x) * 3;
      for (let k = 0; k < 3; k++) {
        col[p + k] = Math.round(toSrgb(Math.min(1, Math.max(0, c[k] * SCALE))) * 255);
        nrm[p + k] = n[k];
        orm[p + k] = o[k];
      }
    }
  }
  mkdirSync(dir, { recursive: true });
  const files = { baseColor: join(dir, `${id}_color.jpg`), normal: join(dir, `${id}_normal.jpg`), orm: join(dir, `${id}_orm.jpg`) };
  const raw = { raw: { width: w, height: h, channels: 3 as const } };
  await sharp(col, raw).jpeg({ quality: 88 }).toFile(files.baseColor);
  await sharp(nrm, raw).jpeg({ quality: 92 }).toFile(files.normal);
  await sharp(orm, raw).jpeg({ quality: 92 }).toFile(files.orm);
  return { id, generated: { ...files, scale: SCALE }, tiling: [widthM, heightM], tinted: true, roughness };
}

/** Byzantine banded wall: limestone facing with a brick band of five courses at the top of each 2.4 m period. */
export async function byzantine(dir: string, stone: SetFiles, brick: SetFiles): Promise<LandmarkMaterial> {
  const s = await Source.open(stone);
  const b = await Source.open(brick);
  const period = 2.4;
  const band = 0.5;
  // Brick relative to the stone tint (walls/render/material.ts: band brick x (1.25, 0.92, 0.8) of the facing).
  const tintK = [1.25, 0.82, 0.68];
  return render(dir, 'lm_byzantine', 4.8, period, (u, v, c, n, o) => {
    if (v > period - band) {
      b.rel(u, v * 0.9, c);
      c[0] *= tintK[0];
      c[1] *= tintK[1];
      c[2] *= tintK[2];
      b.nrm(u, v * 0.9, n);
      b.orms(u, v * 0.9, o);
    } else {
      s.rel(u, v, c);
      s.nrm(u, v, n);
      s.orms(u, v, o);
    }
  }, 1);
}

/** Mosque banded masonry: per 1.25 m, the lower 52 % brick, the rest stone. */
export async function banded(dir: string, stone: SetFiles, brick: SetFiles): Promise<LandmarkMaterial> {
  const s = await Source.open(stone);
  const b = await Source.open(brick);
  const period = 1.25;
  // Brick (about 0.38, 0.15, 0.075 linear in the web) relative to a limestone tint (about 0.6, 0.55, 0.45).
  const tintK = [0.64, 0.28, 0.17];
  return render(dir, 'lm_banded', 2.2, period, (u, v, c, n, o) => {
    if (v < period * 0.52) {
      b.rel(u, v, c);
      c[0] *= tintK[0];
      c[1] *= tintK[1];
      c[2] *= tintK[2];
      b.nrm(u, v, n);
      b.orms(u, v, o);
    } else {
      s.rel(u, v, c);
      s.nrm(u, v, n);
      s.orms(u, v, o);
    }
  }, 1);
}

/** Signed distance to a window outline (negative inside): facade.glsl.ts hWindowSdf. */
function windowSdf(lx: number, ly: number, hw: number, wh: number, arch: number): number {
  const d = Math.max(Math.abs(lx) - hw, -ly);
  if (arch < 0.5) {
    return Math.max(d, ly - wh);
  }
  if (arch < 1.5) {
    const yr = wh - hw;
    return ly > yr ? Math.max(d, Math.hypot(lx, ly - yr) - hw) : d;
  }
  if (arch < 2.5) {
    const rise = hw * 0.38;
    const R = (hw * hw + rise * rise) / (2 * rise);
    const cy = wh - R;
    return ly > cy ? Math.max(d, Math.hypot(lx, ly - cy) - R) : d;
  }
  if (arch < 3.5) {
    const w = hw * 2;
    const yr = wh - w * 0.866;
    return ly > yr ? Math.max(d, Math.max(Math.hypot(lx + hw, ly - yr), Math.hypot(lx - hw, ly - yr)) - w) : d;
  }
  const yr = wh - hw * 1.1;
  const circ = Math.hypot(lx, ly - yr) - hw * 1.12;
  return ly > yr - hw * 0.45 ? Math.max(-ly, circ) : d;
}

const grid = (x: number, period: number, half: number): boolean => {
  const f = (((x / period) % 1) + 1) % 1;
  return Math.min(f, 1 - f) * period < half;
};

/**
 * A heritage facade style as a texture: one bay (spacing) wide and sill + rows x floorH high, so the window grid lands
 * where the web shader draws it (u = 0 at the first bay's edge, v = 0 at the facade base).
 */
export async function facade(dir: string, style: FacadeStyle, base: SetFiles, baseRoughness: number): Promise<LandmarkMaterial> {
  const s = await Source.open(base);
  const hw = style.winW / 2;
  const heightM = style.sill + style.rows * style.floorH;
  // Glazing relative to a typical wall tint (~0.6): the web's glass is ~0.03 linear, its bars 0.55 or 0.03.
  const glass = 0.045;
  const bar = style.mullion > 2.5 ? 0.05 : 0.85;
  return render(dir, `lm_facade_${style.name}`, style.spacing, heightM, (u, v, c, n, o) => {
    s.rel(u, v, c);
    s.nrm(u, v, n);
    s.orms(u, v, o);
    const lx = u - style.spacing / 2;
    const yy = v - style.sill;
    const row = Math.floor(yy / style.floorH);
    const ly = yy - row * style.floorH;
    // Pilasters: a lighter strip at the bay edges.
    if (style.pilaster > 0 && Math.abs(Math.abs(lx) - style.spacing / 2) < 0.26) {
      const k = 1 + 0.06 * style.pilaster;
      c[0] *= k;
      c[1] *= k;
      c[2] *= k;
    }
    if (row < 0 || row >= style.rows) {
      return;
    }
    const d = windowSdf(lx, ly, hw, style.winH, style.arch);
    const sill = ly >= -0.14 && ly <= 0 && Math.abs(lx) <= hw + style.frame + 0.12;
    if (d > 0) {
      if (d < style.frame || sill) {
        const k = style.surround;
        c[0] = c[0] * k + 0.03;
        c[1] = c[1] * k + 0.03;
        c[2] = c[2] * k + 0.03;
        o[0] = Math.round(o[0] * (d < 0.03 ? 0.8 : 1));
      }
      return;
    }
    let bars = false;
    if (style.mullion === 1) {
      bars = Math.abs(lx) < 0.03 || Math.abs(ly - style.winH * 0.62) < 0.03;
    } else if (style.mullion === 2) {
      bars = grid(lx + hw, hw, 0.025) || grid(ly, 0.55, 0.025);
    } else if (style.mullion === 3) {
      bars = grid(lx + hw, 0.14, 0.0125) || grid(ly, 0.14, 0.0125);
    }
    // Reveal shadow near the outline.
    const reveal = Math.min(1, -d / 0.22);
    const g = bars ? bar : glass * (0.55 + 0.45 * reveal);
    c[0] = g;
    c[1] = g * 1.05;
    c[2] = g * 1.12;
    n[0] = 128;
    n[1] = 128;
    n[2] = 255;
    o[0] = Math.round(255 * (0.7 + 0.3 * reveal));
    o[1] = bars ? 128 : 22;
    o[2] = 0;
  }, baseRoughness);
}
