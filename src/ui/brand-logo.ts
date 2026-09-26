/**
 * The Seventeen Skies logo, drawn in code (no font, sharp at any size).
 *
 * Letters are written with a broad nib: every stroke is a centre line whose width follows its direction (thick
 * stems, hairline bars) and flares slightly at the terminals, a calm, calligraphic capital in the spirit of hat
 * rather than a typeface. The crest is the Turkic sky of seventeen layers: seventeen hairlines forming the dome of
 * the sky behind the title, parting around the letters, with the eight-pointed star of the upper sky at the top.
 * Rules: .docs/brand/README.md.
 */

import { BRAND, BRAND_COLORS } from './brand';

type Pt = [number, number];

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 18): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

function line(a: Pt, b: Pt, n = 12): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Pt);
}

interface Pen {
  /** Width across the nib edge (stems). */
  thick: number;
  /** Width along the nib edge (hairlines). */
  thin: number;
  /** Nib edge angle in degrees; -28 gives thick stems and down-strokes, hairline bars and up-strokes. */
  angle: number;
  /** Extra width at the terminals (0.25 = 25 % wider at the very end). */
  flare: number;
}

/** Outline of one nib stroke along `pts` (already in output units). */
function nibStroke(pts: Pt[], pen: Pen, scale: number): string {
  const nib = (pen.angle * Math.PI) / 180;
  const n = pts.length;
  const len: number[] = [0];
  for (let i = 1; i < n; i++) {
    len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = len[n - 1];
  const reach = Math.min(total * 0.3, 16 * scale);
  const l: Pt[] = [];
  const r: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const m = Math.hypot(dx, dy) || 1;
    let w = pen.thin + (pen.thick - pen.thin) * Math.abs(Math.sin(Math.atan2(dy, dx) - nib));
    const d = Math.min(len[i], total - len[i]);
    const k = Math.max(0, 1 - d / reach);
    w *= 1 + pen.flare * k * k;
    const nx = -dy / m;
    const ny = dx / m;
    l.push([pts[i][0] + (nx * w * scale) / 2, pts[i][1] + (ny * w * scale) / 2]);
    r.push([pts[i][0] - (nx * w * scale) / 2, pts[i][1] - (ny * w * scale) / 2]);
  }
  const ring = [...l, ...r.reverse()];
  return `M${ring.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}Z`;
}

interface Glyph {
  strokes: Pt[][];
  adv: number;
  /** Side bearings: straight sides need more room than round or open ones. */
  lsb: number;
  rsb: number;
}

/** Centre lines on a 100-unit cap height, classical proportions. */
function glyph(ch: string): Glyph {
  switch (ch) {
    case 'S':
      return {
        adv: 50,
        lsb: 4,
        rsb: 4,
        strokes: [
          [
            ...cubic([46, 15], [41, 5], [32, 1.5], [24.5, 1.5]),
            ...cubic([24.5, 1.5], [12, 1.5], [4.5, 10], [4.5, 23]).slice(1),
            ...cubic([4.5, 23], [4.5, 38], [17, 44], [26, 48.5]).slice(1),
            ...cubic([26, 48.5], [38, 54.5], [47.5, 61], [47.5, 75.5]).slice(1),
            ...cubic([47.5, 75.5], [47.5, 90.5], [36.5, 98.5], [24, 98.5]).slice(1),
            ...cubic([24, 98.5], [13, 98.5], [5, 93], [2, 83]).slice(1),
          ],
        ],
      };
    case 'E':
      return {
        adv: 44,
        lsb: 9,
        rsb: 3,
        strokes: [line([4, 0], [4, 100]), line([4, 1], [41, 1], 4), line([4, 50], [33, 50], 4), line([4, 99], [44, 99], 4)],
      };
    case 'V':
      return { adv: 62, lsb: 1, rsb: 1, strokes: [line([1, 0], [31, 100]), line([31, 100], [61, 0])] };
    case 'N':
      return { adv: 58, lsb: 9, rsb: 9, strokes: [line([3.5, 0], [3.5, 100]), line([3.5, 0], [54.5, 100]), line([54.5, 0], [54.5, 100])] };
    case 'T':
      return { adv: 54, lsb: 2, rsb: 2, strokes: [line([27, 1], [27, 100]), line([0, 1], [54, 1], 4)] };
    case 'K':
      return { adv: 54, lsb: 9, rsb: 1, strokes: [line([4, 0], [4, 100]), line([51, 0], [5, 57]), line([21, 38], [54, 100])] };
    case 'I':
      return { adv: 8, lsb: 9, rsb: 9, strokes: [line([4, 0], [4, 100])] };
    default:
      return { adv: 30, lsb: 0, rsb: 0, strokes: [] };
  }
}

/** Advance of the word in cap-height units: glyphs plus side bearings plus uniform tracking. */
function wordUnits(text: string, track: number): number {
  let pen = 0;
  for (let i = 0; i < text.length; i++) {
    const g = glyph(text[i]);
    pen += (i > 0 ? g.lsb : 0) + g.adv + (i < text.length - 1 ? g.rsb + track : 0);
  }
  return pen;
}

function setWord(text: string, x: number, y: number, cap: number, track: number, pen: Pen): string {
  const s = cap / 100;
  let at = 0;
  let d = '';
  for (let i = 0; i < text.length; i++) {
    const g = glyph(text[i]);
    at += i > 0 ? g.lsb : 0;
    for (const st of g.strokes) {
      d += nibStroke(
        st.map((p) => [x + (at + p[0]) * s, y + p[1] * s] as Pt),
        pen,
        s,
      );
    }
    at += g.adv + (i < text.length - 1 ? g.rsb + track : 0);
  }
  return d;
}

/** Eight-pointed star. */
function star(cx: number, cy: number, r: number, inner = 0.4): string {
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * inner;
    pts.push(`${f(cx + Math.cos(a) * rr)} ${f(cy + Math.sin(a) * rr)}`);
  }
  return `M${pts.join('L')}Z`;
}

const BIG_PEN: Pen = { thick: 14.5, thin: 2.2, angle: -28, flare: 0.12 };
const SMALL_PEN: Pen = { thick: 9, thin: 2.2, angle: -28, flare: 0.1 };

export interface TitleLogoOptions {
  /** Rendered width in px; omit for a fluid SVG. */
  width?: number;
  /** Unique id prefix when several logos share a document. */
  id?: string;
  /** Draw the sky dome of seventeen layers and the star (the full logo). Off: the title alone, for small sizes. */
  crest?: boolean;
}

/** The title logo on a transparent background. */
export function titleLogoSvg(opts: TitleLogoOptions = {}): string {
  const id = opts.id ?? 'sst';
  const crest = opts.crest ?? true;
  const W = 1000;
  const cx = W / 2;
  const bigCap = 176;
  const bigTrack = 20;
  const smallCap = 34;
  const smallTrack = 58;
  const bigW = (wordUnits('SKIES', bigTrack) * bigCap) / 100;
  const smallW = (wordUnits('SEVENTEEN', smallTrack) * smallCap) / 100;
  const smallY = crest ? 214 : 10;
  const bigY = smallY + smallCap + 30;
  const baseY = bigY + bigCap;
  const small = setWord('SEVENTEEN', cx - smallW / 2, smallY, smallCap, smallTrack, SMALL_PEN);
  const big = setWord('SKIES', cx - bigW / 2, bigY, bigCap, bigTrack, BIG_PEN);

  let x0 = cx - bigW / 2 - 14;
  let x1 = cx + bigW / 2 + 14;
  let y0 = 0;
  let y1 = baseY + 14;
  let crestSvg = '';
  let defs = '';
  if (crest) {
    // The dome of the sky: seventeen hairlines from the horizon (the base line of SKIES) up to the star, closer
    // together as they rise, each as long as the dome is wide at its height, fading out at both ends.
    const R = 330;
    const horizon = baseY + 6;
    const starY = horizon - R + 2;
    let lines = '';
    for (let i = 0; i < 17; i++) {
      const t = i / 16;
      const h = R * (1 - Math.pow(1 - t, 1.3)) * 0.93;
      const y = horizon - h;
      const half = Math.sqrt(Math.max(0, R * R - h * h));
      const op = 0.95 - 0.55 * t;
      const sw = 2.2 - 1.2 * t;
      lines += `<path d="M${f(cx - half)} ${f(y)}H${f(cx + half)}" stroke="url(#${id}-ln${i})" stroke-width="${f(sw)}" stroke-opacity="${f(op)}"/>`;
      defs +=
        `<linearGradient id="${id}-ln${i}" gradientUnits="userSpaceOnUse" x1="${f(cx - half)}" y1="0" x2="${f(cx + half)}" y2="0">` +
        `<stop offset="0" stop-color="${lineColor(t)}" stop-opacity="0"/><stop offset="0.3" stop-color="${lineColor(t)}"/>` +
        `<stop offset="0.7" stop-color="${lineColor(t)}"/><stop offset="1" stop-color="${lineColor(t)}" stop-opacity="0"/></linearGradient>`;
    }
    const cut =
      `<mask id="${id}-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${f(y1 + 40)}">` +
      `<rect width="${W}" height="${f(y1 + 40)}" fill="#fff"/>` +
      `<rect x="0" y="${f(smallY - 12)}" width="${W}" height="${f(smallCap + 24)}" fill="#000"/>` +
      `<g fill="#000" stroke="#000" stroke-linejoin="round"><path d="${big}" stroke-width="18"/>` +
      `<path d="${star(cx, starY, 34, 0.4)}" stroke-width="10"/></g></mask>`;
    defs += cut + `<radialGradient id="${id}-glow"><stop offset="0" stop-color="#ffe9c4" stop-opacity="0.75"/><stop offset="1" stop-color="#ffe9c4" stop-opacity="0"/></radialGradient>`;
    crestSvg =
      `<g fill="none" mask="url(#${id}-cut)">${lines}</g>` +
      `<circle cx="${cx}" cy="${f(starY)}" r="46" fill="url(#${id}-glow)"/>` +
      `<path d="${star(cx, starY, 17)}" fill="${BRAND_COLORS.ivory}"/>`;
    x0 = cx - R - 4;
    x1 = cx + R + 4;
    y0 = starY - 50;
    y1 = horizon + 22;
  }

  const vw = x1 - x0;
  const vh = y1 - y0;
  const size = opts.width ? ` width="${opts.width}" height="${f((opts.width * vh) / vw)}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(vw)} ${f(vh)}"${size} role="img" aria-label="${BRAND.name}">` +
    `<defs>${defs}` +
    `<linearGradient id="${id}-ink" gradientUnits="userSpaceOnUse" x1="0" y1="${f(smallY)}" x2="0" y2="${f(baseY)}">` +
    `<stop offset="0" stop-color="#fffaf0"/><stop offset="0.45" stop-color="${BRAND_COLORS.goldPale}"/><stop offset="1" stop-color="${BRAND_COLORS.ember}"/></linearGradient>` +
    `<filter id="${id}-glowf" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="7" result="b"/>` +
    `<feFlood flood-color="#ffd9a0" flood-opacity="0.45"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `</defs>` +
    crestSvg +
    `<g fill="url(#${id}-ink)" filter="url(#${id}-glowf)"><path d="${small}"/><path d="${big}"/></g>` +
    `</svg>`
  );
}

/** Hairline colour by height in the dome: warm ember at the horizon, pale gold, ivory near the star. */
function lineColor(t: number): string {
  const stops: [number, number, number][] = [
    [229, 138, 78],
    [243, 211, 160],
    [255, 246, 230],
  ];
  const x = Math.min(0.999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const k = x - i;
  const c = stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export interface MonogramOptions {
  /** Rendered size in px; omit for a fluid SVG. */
  size?: number;
  id?: string;
  /** Rounded-square night background (app icons). Off: transparent. */
  tile?: boolean;
  /** Corner radius as a fraction of the size (iOS masks its own corners: use 0 there). */
  radius?: number;
}

/** App icon / favicon: the nib S inside the dome of seventeen layers, under the star. */
export function monogramSvg(opts: MonogramOptions = {}): string {
  const id = opts.id ?? 'ssm';
  const tile = opts.tile ?? true;
  const S = 512;
  const cx = S / 2;
  const cap = 224;
  const sw = (wordUnits('S', 0) * cap) / 100;
  const y = 214;
  const base = y + cap;
  const s = setWord('S', cx - sw / 2, y, cap, 0, { thick: 21, thin: 4, angle: -28, flare: 0.12 });
  const R = 300;
  const horizon = base + 8;
  let lines = '';
  let defs = '';
  for (let i = 0; i < 17; i++) {
    const t = i / 16;
    const h = R * (1 - Math.pow(1 - t, 1.3)) * 0.93;
    const half = Math.sqrt(Math.max(0, R * R - h * h));
    lines += `<path d="M${f(cx - half)} ${f(horizon - h)}H${f(cx + half)}" stroke="url(#${id}-ln${i})" stroke-width="${f(4.2 - 2.2 * t)}" stroke-opacity="${f(0.95 - 0.5 * t)}"/>`;
    defs +=
      `<linearGradient id="${id}-ln${i}" gradientUnits="userSpaceOnUse" x1="${f(cx - half)}" y1="0" x2="${f(cx + half)}" y2="0">` +
      `<stop offset="0" stop-color="${lineColor(t)}" stop-opacity="0"/><stop offset="0.3" stop-color="${lineColor(t)}"/>` +
      `<stop offset="0.7" stop-color="${lineColor(t)}"/><stop offset="1" stop-color="${lineColor(t)}" stop-opacity="0"/></linearGradient>`;
  }
  const starY = horizon - R + 10;
  const r = (opts.radius ?? 0.22) * S;
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}"${size} role="img" aria-label="${BRAND.name}">` +
    `<defs>${defs}` +
    `<radialGradient id="${id}-bg" cx="0.5" cy="0.9" r="1"><stop offset="0" stop-color="#5a3a4e"/><stop offset="0.5" stop-color="${BRAND_COLORS.gok}"/><stop offset="1" stop-color="${BRAND_COLORS.night}"/></radialGradient>` +
    `<radialGradient id="${id}-glow"><stop offset="0" stop-color="#ffe9c4" stop-opacity="0.8"/><stop offset="1" stop-color="#ffe9c4" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${id}-ink" gradientUnits="userSpaceOnUse" x1="0" y1="${y}" x2="0" y2="${base}"><stop offset="0" stop-color="#fffaf0"/><stop offset="0.5" stop-color="${BRAND_COLORS.goldPale}"/><stop offset="1" stop-color="${BRAND_COLORS.ember}"/></linearGradient>` +
    `<mask id="${id}-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="${S}" height="${S}"><rect width="${S}" height="${S}" fill="#fff"/>` +
    `<path d="${s}" fill="#000" stroke="#000" stroke-width="26" stroke-linejoin="round"/><path d="${star(cx, starY, 44)}" fill="#000"/></mask>` +
    `</defs>` +
    (tile ? `<rect width="${S}" height="${S}" rx="${f(r)}" fill="url(#${id}-bg)"/>` : '') +
    `<g fill="none" mask="url(#${id}-cut)">${lines}</g>` +
    `<circle cx="${cx}" cy="${f(starY)}" r="54" fill="url(#${id}-glow)"/>` +
    `<path d="${star(cx, starY, 21)}" fill="${BRAND_COLORS.ivory}"/>` +
    `<path d="${s}" fill="url(#${id}-ink)"/>` +
    `</svg>`
  );
}
