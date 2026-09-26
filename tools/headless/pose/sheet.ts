/**
 * Contact sheet writers: PNG through @napi-rs/canvas when it can be loaded (dev dependency), otherwise an SVG with
 * one embedded PNG per frame (encoded here with node:zlib, no dependencies) and vector labels.
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import type { Cell } from './raster';

export interface SheetFrame {
  cell: Cell;
  label: string;
  sublabel: string;
}

export interface SheetSpec {
  title: string;
  subtitle: string;
  columns: number;
  frames: SheetFrame[];
}

const HEADER = 34;
const GAP = 2;

function layout(spec: SheetSpec): { cols: number; rows: number; cw: number; ch: number; width: number; height: number } {
  const cols = Math.max(1, Math.min(spec.columns, spec.frames.length));
  const rows = Math.ceil(spec.frames.length / cols);
  const cw = spec.frames[0].cell.width;
  const ch = spec.frames[0].cell.height;
  return { cols, rows, cw, ch, width: cols * cw + (cols - 1) * GAP, height: HEADER + rows * ch + (rows - 1) * GAP };
}

type CanvasModule = typeof import('@napi-rs/canvas');

async function loadCanvas(): Promise<CanvasModule | null> {
  try {
    return await import('@napi-rs/canvas');
  } catch {
    return null;
  }
}

/** Writes `<base>.png` (or `<base>.svg` without the canvas module); returns the path written. */
export async function writeSheet(spec: SheetSpec, base: string, forceSvg = false): Promise<string> {
  const mod = forceSvg ? null : await loadCanvas();
  if (mod) {
    const path = `${base}.png`;
    writeFileSync(path, renderPng(mod, spec));
    return path;
  }
  const path = `${base}.svg`;
  writeFileSync(path, renderSvg(spec));
  return path;
}

function renderPng(mod: CanvasModule, spec: SheetSpec): Buffer {
  const L = layout(spec);
  const canvas = mod.createCanvas(L.width, L.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b1d21';
  ctx.fillRect(0, 0, L.width, L.height);
  ctx.fillStyle = '#f2f2f2';
  ctx.font = 'bold 15px "DejaVu Sans", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(spec.title, 10, HEADER / 2);
  const tw = ctx.measureText(spec.title).width;
  ctx.fillStyle = '#a9adb5';
  ctx.font = '12px "DejaVu Sans", sans-serif';
  ctx.fillText(spec.subtitle, 22 + tw, HEADER / 2 + 1);
  spec.frames.forEach((f, i) => {
    const x = (i % L.cols) * (L.cw + GAP);
    const y = HEADER + Math.floor(i / L.cols) * (L.ch + GAP);
    const img = ctx.createImageData(L.cw, L.ch);
    img.data.set(f.cell.rgba);
    ctx.putImageData(img, x, y);
    ctx.fillStyle = 'rgba(240, 236, 227, 0.78)';
    ctx.fillRect(x, y, L.cw, 34);
    ctx.textBaseline = 'top';
    ctx.font = 'bold 12px "DejaVu Sans", sans-serif';
    ctx.fillStyle = '#23262c';
    ctx.fillText(f.label, x + 6, y + 5);
    ctx.font = '10px "DejaVu Sans Mono", monospace';
    ctx.fillStyle = '#555a63';
    ctx.fillText(f.sublabel, x + 6, y + 21);
  });
  return canvas.toBuffer('image/png');
}

/* ------------------------------------------------------------------ */
/* Dependency-free fallback                                            */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Minimal RGBA8 PNG encoder. */
export function encodePng(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderSvg(spec: SheetSpec): string {
  const L = layout(spec);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}">`,
    `<rect width="100%" height="100%" fill="#1b1d21"/>`,
    `<text x="10" y="${HEADER / 2 + 5}" font-family="sans-serif" font-size="15" font-weight="bold" fill="#f2f2f2">${esc(spec.title)} <tspan font-size="12" font-weight="normal" fill="#a9adb5">${esc(spec.subtitle)}</tspan></text>`,
  ];
  spec.frames.forEach((f, i) => {
    const x = (i % L.cols) * (L.cw + GAP);
    const y = HEADER + Math.floor(i / L.cols) * (L.ch + GAP);
    const png = encodePng(f.cell.width, f.cell.height, f.cell.rgba).toString('base64');
    parts.push(`<image x="${x}" y="${y}" width="${L.cw}" height="${L.ch}" href="data:image/png;base64,${png}"/>`);
    parts.push(`<rect x="${x}" y="${y}" width="${L.cw}" height="34" fill="#f0ece3" fill-opacity="0.78"/>`);
    parts.push(`<text x="${x + 6}" y="${y + 16}" font-family="sans-serif" font-size="12" font-weight="bold" fill="#23262c">${esc(f.label)}</text>`);
    parts.push(`<text x="${x + 6}" y="${y + 30}" font-family="monospace" font-size="10" fill="#555a63">${esc(f.sublabel)}</text>`);
  });
  parts.push('</svg>');
  return parts.join('\n');
}
