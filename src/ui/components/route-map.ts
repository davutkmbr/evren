import { el } from '../dom';
import { legend, type LegendItem } from './legend';

/** A point on the map plane (world x, z: east right, north up since north is −z). */
export interface RoutePoint {
  x: number;
  y: number;
}

export interface RouteMapData {
  /** Identifies the route for the background cache (e.g. a course id). */
  key: string;
  /** The line flown, drawn dashed gold. */
  path: readonly RoutePoint[];
  /** Stops along it: the first is the start (white), the last the finish (larger); the rest gold dots. */
  stops: readonly RoutePoint[];
  /** Optional side targets, teal circles. */
  rings?: readonly RoutePoint[];
}

export interface RouteMapOptions {
  /** Width / height the frame is computed for (the card's design size). Default 776 / 330. */
  aspect?: number;
  /** Smallest span shown (map units), so a short route is not blown up. */
  minSpan?: number;
  /** Colour keys shown bottom left. */
  legend?: readonly LegendItem[];
  /** Accessible name of the map. */
  label?: string;
}

export interface RouteFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The view box that frames `points`: their bounding box centred, padded by `pad`, grown to `aspect` (w / h) and to at
 * least `minSpan` wide. Pure (headless tested).
 */
export function frameRoute(points: readonly RoutePoint[], aspect: number, pad = 1.35, minSpan = 0): RouteFrame {
  if (points.length === 0) {
    const w = Math.max(1, minSpan);
    return { x: -w / 2, y: -w / aspect / 2, w, h: w / aspect };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max((maxX - minX) * pad, (maxY - minY) * pad * aspect, minSpan, 1e-6);
  const h = w / aspect;
  return { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h };
}

/** Water coverage 0..1 at a map point; `cell` is the sample spacing (map units), for soft coast edges. */
export type WaterSampler = (x: number, y: number, cell: number) => number;

export interface RouteMap {
  readonly root: HTMLElement;
  set(data: RouteMapData): void;
  /** Sets (or clears) the water sampler for the land / water background; redraws on the next set(). */
  setWater(sampler: WaterSampler | null): void;
}

const NS = 'http://www.w3.org/2000/svg';
/** Design width (px) the marker sizes are given in. */
const DESIGN_W = 776;
/** Background raster width (samples). */
const BG_COLS = 176;
const LAND = [0x26, 0x2a, 0x31];
const WATER = [0x14, 0x1a, 0x22];

function node<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    n.setAttribute(k, typeof v === 'number' ? v.toFixed(2) : v);
  }
  return n;
}

/**
 * A route on a small map card: land and water from a sampler, the route as a dashed gold line, stops as dots (start
 * white), side targets as teal circles, and a legend. The frame fits the route (frameRoute) and fills the card
 * (slice), so it adapts to any card size.
 */
export function routeMap(opts: RouteMapOptions = {}): RouteMap {
  const aspect = opts.aspect ?? DESIGN_W / 330;
  const svgEl = node('svg', { class: 'ui-route-svg', preserveAspectRatio: 'xMidYMid slice', role: 'img', 'aria-label': opts.label ?? '' });
  const root = el('div', 'ui-route', [svgEl, opts.legend ? legend(opts.legend, 'ui-route-legend') : null]);
  let water: WaterSampler | null = null;
  const bgCache = new Map<string, string>();

  const background = (key: string, f: RouteFrame): string | null => {
    if (!water) {
      return null;
    }
    const id = `${key}|${f.x.toFixed(0)},${f.y.toFixed(0)},${f.w.toFixed(0)}`;
    const hit = bgCache.get(id);
    if (hit) {
      return hit;
    }
    const cols = BG_COLS;
    const rows = Math.max(1, Math.round(cols / aspect));
    const cell = f.w / cols;
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    const img = ctx.createImageData(cols, rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const c = Math.max(0, Math.min(1, water(f.x + (i + 0.5) * cell, f.y + (j + 0.5) * (f.h / rows), cell)));
        const o = (j * cols + i) * 4;
        img.data[o] = LAND[0] + (WATER[0] - LAND[0]) * c;
        img.data[o + 1] = LAND[1] + (WATER[1] - LAND[1]) * c;
        img.data[o + 2] = LAND[2] + (WATER[2] - LAND[2]) * c;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const url = canvas.toDataURL('image/png');
    if (bgCache.size > 32) {
      bgCache.clear();
    }
    bgCache.set(id, url);
    return url;
  };

  return {
    root,
    setWater: (s) => {
      water = s;
      bgCache.clear();
    },
    set: (data) => {
      const all = [...data.path, ...data.stops, ...(data.rings ?? [])];
      const f = frameRoute(all, aspect, 1.35, opts.minSpan ?? 0);
      const u = f.w / DESIGN_W;
      svgEl.setAttribute('viewBox', `${f.x.toFixed(1)} ${f.y.toFixed(1)} ${f.w.toFixed(1)} ${f.h.toFixed(1)}`);
      const parts: SVGElement[] = [node('rect', { x: f.x - f.w, y: f.y - f.h, width: f.w * 3, height: f.h * 3, class: 'ui-route-land' })];
      const bg = background(data.key, f);
      if (bg) {
        const image = node('image', { x: f.x, y: f.y, width: f.w, height: f.h, preserveAspectRatio: 'none' });
        image.setAttribute('href', bg);
        parts.push(image);
      }
      if (data.path.length > 1) {
        parts.push(
          node('path', {
            class: 'ui-route-line',
            d: data.path.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
            'stroke-width': 3 * u,
            'stroke-dasharray': `${(8 * u).toFixed(2)} ${(6 * u).toFixed(2)}`,
          }),
        );
      }
      for (const r of data.rings ?? []) {
        parts.push(node('circle', { class: 'ui-route-ring', cx: r.x, cy: r.y, r: 5 * u, 'stroke-width': 2 * u }));
      }
      const last = data.stops.length - 1;
      // Drawn back to front so the start dot stays on top where the route loops back.
      for (let i = last; i >= 0; i--) {
        const p = data.stops[i];
        const end = i === 0 || i === last;
        parts.push(node('circle', { class: i === 0 ? 'ui-route-start' : 'ui-route-stop', cx: p.x, cy: p.y, r: (end ? 7 : 5) * u, 'stroke-width': 2 * u }));
      }
      svgEl.replaceChildren(...parts);
    },
  };
}
