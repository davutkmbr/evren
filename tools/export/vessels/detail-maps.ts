/**
 * Tileable detail maps of the vessel material, baked on the CPU from the web shader's own patterns
 * (src/world/life/render/life-material.glsl.ts: plate seams, deck plates, container ribs, planking, window mullions and
 * the grime / wear / rust / streak noise) for runtimes that shade vessels with textures instead of that shader.
 *
 * Every map tiles in metres: a material samples it at the vertex's TEXCOORD_0 (surface coordinates in metres) divided
 * by the map's `tiling`. The noise is the shader's value noise (hash12 of render/shaders/common.glsl.ts) on a lattice
 * that wraps with the tile, octaves doubling without the shader's rotation (a rotated lattice cannot tile), so the
 * statistics match and the edges meet. Normal maps are in the glTF convention (green points to the top of the image);
 * masks are linear data.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

export interface MapRecord {
  file: string;
  width: number;
  height: number;
  /** Metres covered by one repeat along TEXCOORD_0 (u, v). */
  tiling: [number, number];
  /** 'normal' (tangent space, glTF convention) or 'mask' (linear, channels described in `channels`). */
  type: 'normal' | 'mask';
  channels?: Record<string, string>;
  hash: string;
}

const fract = (x: number): number => x - Math.floor(x);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Distance (m) to the nearest line of a 1D lattice with the given period (lifeLine of the shader). */
const lifeLine = (x: number, period: number): number => Math.abs(fract(x / period + 0.5) - 0.5) * period;

/** hash12 of render/shaders/common.glsl.ts. */
function hash12(x: number, y: number): number {
  let ax = fract(x * 0.1031);
  let ay = fract(y * 0.1031);
  let az = fract(x * 0.1031);
  const d = ax * (ay + 33.33) + ay * (az + 33.33) + az * (ax + 33.33);
  ax += d;
  ay += d;
  az += d;
  return fract((ax + ay) * az);
}

const wrap = (i: number, p: number): number => ((i % p) + p) % p;

/** The shader's vnoise2 on a lattice of (px, py) cells that wraps (x, y in cells). */
function vnoise(x: number, y: number, px: number, py: number, salt = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = wrap(ix, px) + salt * 131;
  const x1 = wrap(ix + 1, px) + salt * 131;
  const y0 = wrap(iy, py);
  const y1 = wrap(iy + 1, py);
  const a = hash12(x0, y0);
  const b = hash12(x1, y0);
  const c = hash12(x0, y1);
  const d = hash12(x1, y1);
  const top = a + (b - a) * ux;
  const bottom = c + (d - c) * ux;
  return top + (bottom - top) * uy;
}

/**
 * A tileable noise field over a tile of (tu, tv) metres at the shader's frequencies (fu, fv per metre): the lattice
 * is rounded to whole cells per tile. `octaves` > 1 sums the shader's fbm2 weights (0.5, 0.25, ...).
 */
function field(tu: number, tv: number, fu: number, fv: number, octaves = 1, salt = 0): (u: number, v: number) => number {
  const cu = Math.max(1, Math.round(tu * fu));
  const cv = Math.max(1, Math.round(tv * fv));
  return (u, v) => {
    let x = (u / tu) * cu;
    let y = (v / tv) * cv;
    let px = cu;
    let py = cv;
    let s = 0;
    let a = 0.5;
    for (let o = 0; o < octaves; o++) {
      s += a * vnoise(x, y, px, py, salt + o * 17);
      x *= 2;
      y *= 2;
      px *= 2;
      py *= 2;
      a *= 0.5;
    }
    return octaves === 1 ? s * 2 : s;
  };
}

interface Bake {
  id: string;
  type: 'normal' | 'mask';
  width: number;
  height: number;
  tiling: [number, number];
  channels?: Record<string, string>;
  /** Mask: up to four channels in 0..1 at (u, v) metres. Normal: the surface height (m). */
  sample: (u: number, v: number) => number[] | number;
}

const tileHull: [number, number] = [30.4, 26];
const tileDeck: [number, number] = [32, 32];
const tileContainer: [number, number] = [32, 25.9];
const tileSuper: [number, number] = [32, 25];
const tileWood: [number, number] = [16, 16];
const tileGlass: [number, number] = [8.8, 7.6];
const tileFabric: [number, number] = [8, 8];

const grime = (t: [number, number]): ((u: number, v: number) => number) => field(t[0], t[1], 0.45, 0.9, 3, 1);

const BAKES: readonly Bake[] = [
  {
    id: 'hull_normal',
    type: 'normal',
    width: 1024,
    height: 256,
    tiling: [8.5, 2.6],
    // Plate seams: horizontal every 2.6 m (y = 0.35 on a seam), vertical every 8.5 m; 4 mm deep.
    sample: (u, v) => (1 - smoothstep(0.012, 0.04, lifeLine(v - 0.35, 2.6)) + 1 - smoothstep(0.012, 0.04, lifeLine(u, 8.5))) * 0.004,
  },
  (() => {
    const g = grime(tileHull);
    const blotch = field(tileHull[0], tileHull[1], 0.16, 0.4, 4, 2);
    const cells = Math.round(tileHull[0] / 1.9);
    const runsV = Math.max(1, Math.round(tileHull[1] * 0.16));
    return {
      id: 'hull_mask',
      type: 'mask',
      width: 1024,
      height: 1024,
      tiling: tileHull,
      channels: { r: 'grime', g: 'blotch', b: 'rust streak shape', a: 'rust cell hash' },
      sample: (u: number, v: number) => {
        // Rust streaks: one candidate per 1.9 m cell, offset and width by cell hash, running where the noise says.
        const c = wrap(Math.floor(u / 1.9), cells);
        const xin = fract(u / 1.9) - 0.5 - (hash12(c, 7.1) - 0.5) * 0.6;
        const width = 0.05 + 0.1 * hash12(c, 3.1);
        const runs = smoothstep(0.42, 0.72, vnoise(c * 3.7, (v / tileHull[1]) * runsV, cells * 4, runsV, 3));
        const streak = (1 - smoothstep(width * 0.3, width, Math.abs(xin) * 1.9)) * runs;
        return [g(u, v), blotch(u, v), streak, hash12(c, 1.3)];
      },
    } satisfies Bake;
  })(),
  {
    id: 'deck_normal',
    type: 'normal',
    width: 512,
    height: 1024,
    tiling: [2.2, 6],
    // Deck plates 2.2 x 6 m (x, z), 3 mm lines.
    sample: (u, v) => (1 - smoothstep(0.01, 0.035, Math.min(lifeLine(u, 2.2), lifeLine(v, 6)))) * 0.003,
  },
  (() => {
    const wear = field(tileDeck[0], tileDeck[1], 0.35, 0.35, 4, 4);
    const fine = field(tileDeck[0], tileDeck[1], 1.7, 1.7, 1, 5);
    return {
      id: 'deck_mask',
      type: 'mask',
      width: 1024,
      height: 1024,
      tiling: tileDeck,
      channels: { r: 'wear', g: 'fine variation' },
      sample: (u: number, v: number) => [wear(u, v), fine(u, v), 0, 1],
    } satisfies Bake;
  })(),
  {
    id: 'container_normal',
    type: 'normal',
    width: 128,
    height: 128,
    tiling: [0.28, 0.28],
    // Trapezoid corrugation every 0.28 m along the wall, 2 cm deep.
    sample: (u) => smoothstep(0.18, 0.3, lifeLine(u + 0.07, 0.28) / 0.28) * 0.02,
  },
  (() => {
    const g = grime(tileContainer);
    const dents = field(tileContainer[0], tileContainer[1], 0.6, 0.6, 1, 6);
    return {
      id: 'container_mask',
      type: 'mask',
      width: 1024,
      height: 1024,
      tiling: tileContainer,
      channels: { r: 'grime', g: 'dents', b: 'dirt towards the foot of each 2.59 m box' },
      sample: (u: number, v: number) => [g(u, v), dents(u, v), smoothstep(0.8, 0, v - Math.floor(v / 2.59) * 2.59), 1],
    } satisfies Bake;
  })(),
  (() => {
    const g = grime(tileSuper);
    const streak = field(tileSuper[0], tileSuper[1], 2.3, 0.12, 1, 7);
    return {
      id: 'super_mask',
      type: 'mask',
      width: 1024,
      height: 1024,
      tiling: tileSuper,
      channels: { r: 'grime', g: 'rain streak noise (the shader raises it to the 5th power)' },
      sample: (u: number, v: number) => [g(u, v), streak(u, v), 0, 1],
    } satisfies Bake;
  })(),
  {
    id: 'wood_normal',
    type: 'normal',
    width: 64,
    height: 256,
    tiling: [1, 0.17],
    // Planking: strakes every 0.17 m up the side, 3 mm.
    sample: (_u, v) => (1 - smoothstep(0.004, 0.015, lifeLine(v, 0.17))) * 0.003,
  },
  (() => {
    const g = grime(tileWood);
    const wear = field(tileWood[0], tileWood[1], 1.5, 4, 3, 8);
    return {
      id: 'wood_mask',
      type: 'mask',
      width: 1024,
      height: 1024,
      tiling: tileWood,
      channels: { r: 'grime', g: 'paint wear' },
      sample: (u: number, v: number) => [g(u, v), wear(u, v), 0, 1],
    } satisfies Bake;
  })(),
  {
    id: 'glass_mask',
    type: 'mask',
    width: 1024,
    height: 1024,
    tiling: tileGlass,
    channels: { r: 'mullion', g: 'pane hash (tint, lit or dark at night)' },
    sample: (u, v) => {
      const mull = 1 - smoothstep(0.02, 0.05, Math.min(lifeLine(u, 1.1), lifeLine(v, 1.9)));
      return [mull, hash12(wrap(Math.floor(u / 1.1), 8), wrap(Math.floor(v / 1.9), 4)), 0, 1];
    },
  },
  (() => {
    const weave = field(tileFabric[0], tileFabric[1], 3, 3, 1, 9);
    return {
      id: 'fabric_mask',
      type: 'mask',
      width: 512,
      height: 512,
      tiling: tileFabric,
      channels: { r: 'variation' },
      sample: (u: number, v: number) => [weave(u, v), 0, 0, 1],
    } satisfies Bake;
  })(),
];

/** Texel row j covers v = (j + 0.5) / height x tiling (glTF: v grows down the image), column i likewise in u. */
function render(b: Bake): Uint8Array {
  const { width: w, height: h } = b;
  const [tu, tv] = b.tiling;
  const du = tu / w;
  const dv = tv / h;
  if (b.type === 'mask') {
    const out = new Uint8Array(w * h * 4);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const c = b.sample((i + 0.5) * du, (j + 0.5) * dv) as number[];
        const o = (j * w + i) * 4;
        for (let k = 0; k < 4; k++) out[o + k] = Math.round(clamp01(c[k] ?? 0) * 255);
      }
    }
    return out;
  }
  // Tangent-space normal from the height (m): n = (-dh/du, -dh/d(up), 1) with "up" the top of the image (-v).
  const hgt = (u: number, v: number): number => b.sample(u, v) as number;
  const out = new Uint8Array(w * h * 3);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const u = (i + 0.5) * du;
      const v = (j + 0.5) * dv;
      const dhdu = (hgt(u + du, v) - hgt(u - du, v)) / (2 * du);
      const dhdv = (hgt(u, v + dv) - hgt(u, v - dv)) / (2 * dv);
      let nx = -dhdu;
      let ny = dhdv;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const o = (j * w + i) * 3;
      out[o] = Math.round((nx * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

/** Bakes every detail map into `<out>/textures/` (a file is rewritten only when its bytes change). */
export async function bakeDetailMaps(out: string): Promise<{ maps: Record<string, MapRecord>; written: number }> {
  const dir = join(out, 'textures');
  mkdirSync(dir, { recursive: true });
  const maps: Record<string, MapRecord> = {};
  let written = 0;
  for (const b of BAKES) {
    const raw = render(b);
    const png = await sharp(Buffer.from(raw), { raw: { width: b.width, height: b.height, channels: b.type === 'mask' ? 4 : 3 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const hash = createHash('sha1').update(png).digest('hex').slice(0, 16);
    const file = `textures/vessel_${b.id}.png`;
    const path = join(out, file);
    if (!existsSync(path) || createHash('sha1').update(readFileSync(path)).digest('hex').slice(0, 16) !== hash) {
      writeFileSync(path, png);
      written++;
    }
    maps[b.id] = { file, width: b.width, height: b.height, tiling: b.tiling, type: b.type, ...(b.channels ? { channels: b.channels } : {}), hash };
  }
  return { maps, written };
}
