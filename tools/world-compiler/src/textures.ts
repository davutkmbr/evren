/**
 * Approved texture sources and texture processing for format 1.
 *
 * Sources (nothing else is read):
 * - approved assets: tools/assets/approved.json, raw files cached by scripts/data/fetch-assets.mjs in
 *   assets-src/<kind>/<id>/ (Poly Haven `<id>_diff|nor_gl|nor_dx|rough|ao|metal|opacity_<res>.jpg`, ambientCG
 *   `<id>_<res>-JPG_Color|NormalGL|NormalDX|Roughness|AmbientOcclusion|Metalness|Opacity.jpg`, cgbookcase names).
 *   An asset with conditions is used only when every condition is honoured: by this module (a DirectX normal map is
 *   flipped to OpenGL) or by a `conditions.json` next to the raw files (`{ "met": ["<condition text>", ...] }`),
 *   written by whoever did the manual work. Assets that are not downloaded yet are skipped.
 * - the Poly Haven sets in public/textures/ listed in public/textures/LICENSES.md (albedo, OpenGL normal, rough).
 *
 * Processing (macOS `sips` for decoding, resizing and JPEG encoding; channel work in Node; PNG written with node:zlib):
 * - base colour: sRGB JPEG, or RGBA PNG when an opacity map is used;
 * - normal: OpenGL convention (+Y up), JPEG; DirectX maps get their green channel flipped;
 * - ORM: R = ambient occlusion (255 without one), G = roughness, B = metalness (0 without one), JPEG — used both as
 *   glTF occlusionTexture (R) and metallicRoughnessTexture (G, B).
 * Results are cached in node_modules/.cache/evren-world/textures (keyed by the sources and settings) and copied to
 * <out>/textures/ once per compile; every tile and prop references them by relative URI (no per-tile copies).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { ROOT } from '../lib/areas.mjs';
import { hasMaterial, materialDef, type MaterialName, type TextureSetRef } from './materials';

/** Bump when the processing changes (invalidates the cache). */
const PIPELINE_VERSION = 1;
export const CACHE_DIR = resolve(ROOT, 'node_modules/.cache/evren-world/textures');

export interface ApprovedAsset {
  id: string;
  name: string;
  source: string;
  source_id: string;
  url: string;
  licence: string;
  licence_url: string;
  author: string;
  attribution: string | null;
  kind: 'texture' | 'decal' | 'model';
  repeat_m: [number, number] | null;
  conditions: string[];
}

export interface AssetCredit {
  id: string;
  name: string;
  kind: string;
  source: string;
  url: string;
  licence: string;
  author: string;
  attribution: string | null;
  /** Conditions of the approval and how each was met. */
  conditions?: { text: string; met: string }[];
}

let approvedCache: Map<string, ApprovedAsset> | null = null;
export function approvedAssets(): Map<string, ApprovedAsset> {
  if (!approvedCache) {
    const json = JSON.parse(readFileSync(resolve(ROOT, 'tools/assets/approved.json'), 'utf8')) as { assets: ApprovedAsset[] };
    approvedCache = new Map(json.assets.map((a) => [a.id, a]));
  }
  return approvedCache;
}

interface PublicSet {
  folder: string;
  source: string;
  url: string;
  repeat: number;
}

let publicCache: Map<string, PublicSet> | null = null;
/** Rows of the table in public/textures/LICENSES.md: | `folder/` | [name](url) | res | repeat m | licence |. */
export function publicSets(): Map<string, PublicSet> {
  if (!publicCache) {
    publicCache = new Map();
    const md = readFileSync(resolve(ROOT, 'public/textures/LICENSES.md'), 'utf8');
    for (const line of md.split('\n')) {
      const m = line.match(/^\|\s*`([\w-]+)\/`\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|[^|]*\|\s*([\d.]+)\s*m\s*\|\s*CC0/);
      if (m) {
        publicCache.set(m[1], { folder: m[1], source: m[2], url: m[3], repeat: Number(m[4]) });
      }
    }
  }
  return publicCache;
}

const tilingCache = new Map<MaterialName, [number, number]>();
/** Metres per texture repeat of a material (def.tiling, approved repeat_m, public repeat, else 2 m). */
export function tilingOf(id: MaterialName): [number, number] {
  let t = tilingCache.get(id);
  if (t) {
    return t;
  }
  t = [2, 2];
  if (hasMaterial(id)) {
    const d = materialDef(id);
    if (d.tiling) {
      t = d.tiling;
    } else if (d.textures?.asset) {
      const a = approvedAssets().get(d.textures.asset);
      if (a?.repeat_m) {
        t = a.repeat_m;
      }
    } else if (d.textures?.public) {
      const p = publicSets().get(d.textures.public);
      if (p) {
        t = [p.repeat, p.repeat];
      }
    }
  }
  tilingCache.set(id, t);
  return t;
}

export interface ResolvedSet {
  /** Output key: the asset id, or ph_<folder>. */
  key: string;
  color?: string;
  normal?: string;
  /** The normal map is DirectX (green flipped when processed). */
  normalDX?: boolean;
  rough?: string;
  ao?: string;
  metal?: string;
  opacity?: string;
  credit: AssetCredit;
}

/** Why an approved set could not be used (not downloaded, unmet conditions). */
export type SetProblem = { key: string; reason: string };

const PATTERNS: { role: keyof Omit<ResolvedSet, 'key' | 'credit' | 'normalDX'> | 'normalDX'; re: RegExp }[] = [
  { role: 'color', re: /(_diff_|_Color\.|albedo|base_?colou?r|_diffuse)/i },
  { role: 'normal', re: /(_nor_gl_|NormalGL|normal_gl|^normal\.)/i },
  { role: 'normalDX', re: /(_nor_dx_|NormalDX|normal_dx|_normal\.)/i },
  { role: 'rough', re: /(_rough_|Roughness|rough\.)/i },
  { role: 'ao', re: /(_ao_|AmbientOcclusion|_ao\.)/i },
  { role: 'metal', re: /(_metal_|Metalness|metallic)/i },
  { role: 'opacity', re: /(_opacity_|Opacity|_alpha)/i },
];

/** Conditions this module honours itself, with how. */
const HONOURED: { re: RegExp; how: string }[] = [{ re: /normal map is directx/i, how: 'green channel flipped to OpenGL by the world compiler (textures.ts)' }];

/** Conditions of an asset and whether each is met (by this module or by conditions.json in its folder). */
export function conditionStatus(a: ApprovedAsset, dir: string): { text: string; met: string | null }[] {
  let metFile: string[] = [];
  const f = join(dir, 'conditions.json');
  if (existsSync(f)) {
    metFile = (JSON.parse(readFileSync(f, 'utf8')) as { met?: string[] }).met ?? [];
  }
  return a.conditions.map((text) => {
    const h = HONOURED.find((x) => x.re.test(text));
    if (h) {
      return { text, met: h.how };
    }
    return { text, met: metFile.includes(text) ? `recorded in assets-src/${a.kind}/${a.id}/conditions.json` : null };
  });
}

export function assetDir(a: ApprovedAsset): string {
  return resolve(ROOT, 'assets-src', a.kind, a.id);
}

/** Resolves a texture set to source files, or a problem (never an unapproved source: that throws). */
export function resolveSet(ref: TextureSetRef): ResolvedSet | SetProblem {
  if (ref.asset) {
    const a = approvedAssets().get(ref.asset);
    if (!a) {
      throw new Error(`texture set '${ref.asset}' is not in tools/assets/approved.json`);
    }
    if (a.kind === 'model') {
      throw new Error(`asset '${ref.asset}' is a model, not a texture set`);
    }
    const dir = assetDir(a);
    if (!existsSync(dir) || !readdirSync(dir).some((f) => /\.(jpe?g|png)$/i.test(f))) {
      return { key: a.id, reason: `not downloaded (see .docs/assets/manual-downloads.md)` };
    }
    const cond = conditionStatus(a, dir);
    const unmet = cond.filter((c) => !c.met);
    if (unmet.length) {
      return { key: a.id, reason: `unmet conditions: ${unmet.map((c) => c.text).join('; ')}` };
    }
    const files = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f) && f !== `${a.id}.png`);
    const out: ResolvedSet = {
      key: a.id,
      credit: { id: a.id, name: a.name, kind: a.kind, source: a.source, url: a.url, licence: a.licence, author: a.author, attribution: a.attribution, ...(cond.length ? { conditions: cond.map((c) => ({ text: c.text, met: c.met! })) } : {}) },
    };
    for (const f of files.sort()) {
      for (const p of PATTERNS) {
        if (p.re.test(f)) {
          if (p.role === 'normalDX') {
            if (!out.normal || out.normalDX) {
              out.normal = join(dir, f);
              out.normalDX = true;
            }
          } else if (p.role === 'normal') {
            out.normal = join(dir, f);
            out.normalDX = false;
          } else if (!out[p.role]) {
            out[p.role] = join(dir, f);
          }
          break;
        }
      }
    }
    // A condition that names the normal map as DirectX wins over the file name.
    if (a.conditions.some((c) => /normal map is directx/i.test(c)) && out.normal) {
      out.normalDX = true;
    }
    return out;
  }
  if (ref.public) {
    const p = publicSets().get(ref.public);
    if (!p) {
      throw new Error(`public texture set '${ref.public}' is not listed in public/textures/LICENSES.md`);
    }
    const dir = resolve(ROOT, 'public/textures', p.folder);
    const has = (f: string): string | undefined => (existsSync(join(dir, f)) ? join(dir, f) : undefined);
    return {
      key: `ph_${p.folder}`,
      color: has('albedo.jpg'),
      normal: has('normal.jpg'),
      normalDX: false,
      rough: has('rough.jpg'),
      credit: { id: `ph_${p.folder}`, name: p.source, kind: 'texture', source: 'polyhaven', url: p.url, licence: 'CC0-1.0', author: 'Poly Haven', attribution: null },
    };
  }
  throw new Error('texture set needs an asset or a public folder');
}

export const isProblem = (r: ResolvedSet | SetProblem): r is SetProblem => 'reason' in r;

/* ------------------------------------------------------------------------------------------------------------- */
/* Pixels                                                                                                          */
/* ------------------------------------------------------------------------------------------------------------- */

interface Image {
  w: number;
  h: number;
  /** RGB, 3 bytes per pixel, rows top to bottom. */
  rgb: Uint8Array;
}

function sips(args: string[]): void {
  execFileSync('nice', ['-n', '10', 'sips', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
}

function pixelSize(file: string): [number, number] {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
  const w = Number(out.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const h = Number(out.match(/pixelHeight:\s*(\d+)/)?.[1]);
  return [w, h];
}

/** Decodes any image sips reads into RGB, resized so the larger side is at most `max`. */
function decode(file: string, max: number, tmp: string): Image {
  const bmp = join(tmp, `${createHash('sha1').update(file).digest('hex').slice(0, 12)}.bmp`);
  const [w, h] = pixelSize(file);
  sips(['-s', 'format', 'bmp', ...(Math.max(w, h) > max ? ['-Z', String(max)] : []), file, '--out', bmp]);
  const buf = readFileSync(bmp);
  rmSync(bmp, { force: true });
  const off = buf.readUInt32LE(10);
  const bw = buf.readInt32LE(18);
  const bhRaw = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const bh = Math.abs(bhRaw);
  const topDown = bhRaw < 0;
  const bytes = bpp / 8;
  if (bytes !== 3 && bytes !== 4) {
    throw new Error(`${file}: unsupported ${bpp}-bit BMP from sips`);
  }
  const stride = Math.ceil((bw * bytes) / 4) * 4;
  const rgb = new Uint8Array(bw * bh * 3);
  for (let y = 0; y < bh; y++) {
    const row = off + (topDown ? y : bh - 1 - y) * stride;
    for (let x = 0; x < bw; x++) {
      const s = row + x * bytes;
      const d = (y * bw + x) * 3;
      rgb[d] = buf[s + 2];
      rgb[d + 1] = buf[s + 1];
      rgb[d + 2] = buf[s];
    }
  }
  return { w: bw, h: bh, rgb };
}

function writeBmp(img: Image, file: string): void {
  const stride = Math.ceil((img.w * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + stride * img.h);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(img.w, 18);
  buf.writeInt32LE(img.h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(stride * img.h, 34);
  for (let y = 0; y < img.h; y++) {
    const row = 54 + (img.h - 1 - y) * stride;
    for (let x = 0; x < img.w; x++) {
      const s = (y * img.w + x) * 3;
      buf[row + x * 3] = img.rgb[s + 2];
      buf[row + x * 3 + 1] = img.rgb[s + 1];
      buf[row + x * 3 + 2] = img.rgb[s];
    }
  }
  writeFileSync(file, buf);
}

function encodeJpeg(img: Image, file: string, quality: number, tmp: string): void {
  const bmp = join(tmp, `${basename(file)}.bmp`);
  writeBmp(img, bmp);
  sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), bmp, '--out', file]);
  rmSync(bmp, { force: true });
}

/** RGBA PNG (8 bit, no interlace) with node:zlib. */
function encodePng(w: number, h: number, rgba: Uint8Array, file: string): void {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

/* ------------------------------------------------------------------------------------------------------------- */
/* Baker                                                                                                           */
/* ------------------------------------------------------------------------------------------------------------- */

export interface TextureSettings {
  /** Largest side (px) of base colour, normal and ORM maps. */
  colorMax: number;
  normalMax: number;
  ormMax: number;
  /** JPEG quality (sips percent). */
  colorQuality: number;
  dataQuality: number;
}

export const DEFAULT_TEXTURES: TextureSettings = { colorMax: 2048, normalMax: 2048, ormMax: 1024, colorQuality: 85, dataQuality: 90 };

export interface BakedTexture {
  /** File name under <out>/textures/. */
  file: string;
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  bytes: number;
}

export interface BakedSet {
  key: string;
  baseColor?: BakedTexture;
  normal?: BakedTexture;
  orm?: BakedTexture;
  /** The base colour carries an alpha channel from the opacity map. */
  alpha: boolean;
  credit: AssetCredit;
}

/**
 * Processes texture sets once per compile into <outDir>/textures/, through the cache. Files are named after the set
 * and role (`<key>_color.jpg`, `<key>_normal.jpg`, `<key>_orm.jpg`, `<key>_color.png` with alpha) plus a size suffix
 * when a set is baked at a non-default size.
 */
export class TextureBaker {
  private readonly sets = new Map<string, Promise<BakedSet | SetProblem>>();
  private readonly files = new Map<string, BakedTexture>();
  readonly problems = new Map<string, string>();
  private readonly tmp: string;
  cacheHits = 0;
  cacheMisses = 0;

  constructor(
    readonly outDir: string,
    readonly settings: TextureSettings = DEFAULT_TEXTURES,
  ) {
    mkdirSync(CACHE_DIR, { recursive: true });
    mkdirSync(join(outDir, 'textures'), { recursive: true });
    this.tmp = join(CACHE_DIR, 'tmp');
    mkdirSync(this.tmp, { recursive: true });
  }

  /** Every output texture file written so far. */
  written(): BakedTexture[] {
    return [...this.files.values()].sort((a, b) => a.file.localeCompare(b.file));
  }

  /** Bakes the maps of a material's texture set (null: flat colour, or the set is unusable -> problems). */
  async material(id: MaterialName): Promise<BakedSet | null> {
    const d = materialDef(id);
    if (!d.textures) {
      return null;
    }
    const r = resolveSet(d.textures);
    if (isProblem(r)) {
      this.problems.set(r.key, r.reason);
      return null;
    }
    const maps = d.maps ?? {};
    const wantOpacity = maps.opacity ?? (!!r.opacity && d.alphaMode !== undefined && d.alphaMode !== 'OPAQUE');
    const key = `${r.key}|${maps.baseColor !== false}|${maps.normal !== false}|${maps.orm !== false}|${wantOpacity}`;
    let p = this.sets.get(key);
    if (!p) {
      p = this.bakeSet(r, { baseColor: maps.baseColor !== false, normal: maps.normal !== false, orm: maps.orm !== false, opacity: wantOpacity });
      this.sets.set(key, p);
    }
    const out = await p;
    return 'reason' in out ? null : out;
  }

  private async bakeSet(r: ResolvedSet, want: { baseColor: boolean; normal: boolean; orm: boolean; opacity: boolean }): Promise<BakedSet> {
    const s = this.settings;
    const out: BakedSet = { key: r.key, alpha: false, credit: r.credit };
    if (want.baseColor && r.color) {
      if (want.opacity && r.opacity) {
        out.baseColor = this.bake(`${r.key}_color`, 'png', [r.color, r.opacity], s.colorMax, (file) => {
          const c = decode(r.color!, s.colorMax, this.tmp);
          const a = decode(r.opacity!, s.colorMax, this.tmp);
          if (a.w !== c.w || a.h !== c.h) {
            throw new Error(`${r.key}: opacity size differs from colour`);
          }
          const rgba = new Uint8Array(c.w * c.h * 4);
          for (let i = 0; i < c.w * c.h; i++) {
            rgba[i * 4] = c.rgb[i * 3];
            rgba[i * 4 + 1] = c.rgb[i * 3 + 1];
            rgba[i * 4 + 2] = c.rgb[i * 3 + 2];
            rgba[i * 4 + 3] = a.rgb[i * 3];
          }
          encodePng(c.w, c.h, rgba, file);
          return [c.w, c.h];
        });
        out.alpha = true;
      } else {
        out.baseColor = this.bake(`${r.key}_color`, 'jpg', [r.color], s.colorMax, (file) => {
          const [w, h] = pixelSize(r.color!);
          const scale = Math.min(1, s.colorMax / Math.max(w, h));
          sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', String(s.colorQuality), ...(scale < 1 ? ['-Z', String(s.colorMax)] : []), r.color!, '--out', file]);
          return [Math.round(w * scale), Math.round(h * scale)];
        });
      }
    }
    if (want.normal && r.normal) {
      out.normal = this.bake(`${r.key}_normal`, 'jpg', [r.normal, r.normalDX ? 'dx' : 'gl'], s.normalMax, (file) => {
        const img = decode(r.normal!, s.normalMax, this.tmp);
        if (r.normalDX) {
          for (let i = 1; i < img.rgb.length; i += 3) {
            img.rgb[i] = 255 - img.rgb[i];
          }
        }
        encodeJpeg(img, file, s.dataQuality, this.tmp);
        return [img.w, img.h];
      });
    }
    if (want.orm && (r.rough || r.ao || r.metal)) {
      out.orm = this.bake(`${r.key}_orm`, 'jpg', [r.ao ?? '-', r.rough ?? '-', r.metal ?? '-'], s.ormMax, (file) => {
        const ref = r.rough ?? r.ao ?? r.metal!;
        const base = decode(ref, s.ormMax, this.tmp);
        const n = base.w * base.h;
        const orm: Image = { w: base.w, h: base.h, rgb: new Uint8Array(n * 3) };
        const chan = (src: string | undefined, c: number, fill: number): void => {
          const img = src === ref ? base : src ? decode(src, s.ormMax, this.tmp) : null;
          if (img && (img.w !== base.w || img.h !== base.h)) {
            throw new Error(`${r.key}: ${src} size differs`);
          }
          for (let i = 0; i < n; i++) {
            orm.rgb[i * 3 + c] = img ? img.rgb[i * 3] : fill;
          }
        };
        chan(r.ao, 0, 255);
        chan(r.rough, 1, 255);
        chan(r.metal, 2, 0);
        encodeJpeg(orm, file, s.dataQuality, this.tmp);
        return [orm.w, orm.h];
      });
    }
    return out;
  }

  /**
   * Copies an already processed image (e.g. a prop texture) through the cache: re-encoded JPEG at `max` px, or a
   * PNG kept as PNG. Returns the output file record.
   */
  image(name: string, src: string, max: number): BakedTexture {
    const png = /\.png$/i.test(src);
    return this.bake(name, png ? 'png' : 'jpg', [src], max, (file) => {
      const [w, h] = pixelSize(src);
      const scale = Math.min(1, max / Math.max(w, h));
      sips(['-s', 'format', png ? 'png' : 'jpeg', ...(png ? [] : ['-s', 'formatOptions', String(this.settings.colorQuality)]), ...(scale < 1 ? ['-Z', String(max)] : []), src, '--out', file]);
      return [Math.round(w * scale), Math.round(h * scale)];
    });
  }

  /** Builds an RGBA PNG from a colour source (or a flat colour) and an alpha source (R channel). */
  alphaImage(name: string, colorSrc: string | [number, number, number], alphaSrc: string, max: number): BakedTexture {
    return this.bake(name, 'png', [typeof colorSrc === 'string' ? colorSrc : colorSrc.join(','), alphaSrc], max, (file) => {
      const a = decode(alphaSrc, max, this.tmp);
      const c = typeof colorSrc === 'string' ? decode(colorSrc, max, this.tmp) : null;
      const rgba = new Uint8Array(a.w * a.h * 4);
      for (let i = 0; i < a.w * a.h; i++) {
        for (let k = 0; k < 3; k++) {
          rgba[i * 4 + k] = c ? c.rgb[i * 3 + k] : (colorSrc as number[])[k];
        }
        rgba[i * 4 + 3] = a.rgb[i * 3];
      }
      encodePng(a.w, a.h, rgba, file);
      return [a.w, a.h];
    });
  }

  private bake(name: string, ext: 'jpg' | 'png', sources: string[], max: number, make: (file: string) => [number, number]): BakedTexture {
    const stamp = sources.map((s) => {
      if (!existsSync(s)) {
        return s;
      }
      const st = statSync(s);
      return `${s}:${st.size}:${Math.round(st.mtimeMs)}`;
    });
    const settingsKey = JSON.stringify([PIPELINE_VERSION, name, ext, max, this.settings.colorQuality, this.settings.dataQuality, stamp]);
    const h = createHash('sha256').update(settingsKey).digest('hex').slice(0, 16);
    const cached = join(CACHE_DIR, `${h}.${ext}`);
    const meta = join(CACHE_DIR, `${h}.json`);
    let dims: [number, number];
    if (existsSync(cached) && existsSync(meta)) {
      dims = JSON.parse(readFileSync(meta, 'utf8')) as [number, number];
      this.cacheHits++;
    } else {
      dims = make(cached);
      writeFileSync(meta, JSON.stringify(dims));
      this.cacheMisses++;
    }
    const file = `${name}.${ext}`;
    const known = this.files.get(file);
    if (known) {
      return known;
    }
    copyFileSync(cached, join(this.outDir, 'textures', file));
    const rec: BakedTexture = { file, mimeType: ext === 'png' ? 'image/png' : 'image/jpeg', width: dims[0], height: dims[1], bytes: statSync(cached).size };
    this.files.set(file, rec);
    return rec;
  }
}
