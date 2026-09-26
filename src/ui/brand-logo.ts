/**
 * The Seventeen Skies title logo: carved, faceted capitals (a nod to the chiselled Orkhon inscriptions) in
 * metallic gold, SEVENTEEN set small above a large SKIES, with the rising creature's wings and the eight-pointed
 * star of the upper sky behind the title. Every letter is a set of strokes; each stroke is extruded into two facets
 * along its centre line and each facet is shaded by how it faces a light from the upper left, which gives the
 * bevelled, carved look without any font or raster texture.
 */

import { BRAND, BRAND_COLORS } from './brand';

type Pt = [number, number];
interface Stroke {
  pts: Pt[];
  /** Width at each point (same length as pts). */
  w: number[];
}

const f = (n: number): string => (Math.round(n * 100) / 100).toString();

/** Samples a cubic Bézier into n segments (n + 1 points, including both ends). */
function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number): Pt[] {
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

/** A stroke of width w whose two terminals flare out by `flare` (carved wedge ends). */
function stroke(pts: Pt[], w: number, flare = 1.28): Stroke {
  const n = pts.length;
  // Cumulative length so the flare fades over a fixed distance from each end.
  const len: number[] = [0];
  for (let i = 1; i < n; i++) {
    len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = len[n - 1];
  const fade = Math.min(28, total * 0.4);
  const ws = pts.map((_, i) => {
    const d = Math.min(len[i], total - len[i]);
    const k = Math.max(0, 1 - d / fade);
    return w * (1 + (flare - 1) * k * k);
  });
  return { pts, w: ws };
}

/** Glyphs on a 100-unit cap height, stroke centre lines; `w` is the base stroke width. */
function glyph(ch: string, w: number): { strokes: Stroke[]; adv: number } {
  const h = w / 2;
  const top = h;
  const bot = 100 - h;
  switch (ch) {
    case 'S': {
      const W = 64;
      const pts: Pt[] = [
        ...cubic([W - h + 2, 30], [W - h - 2, 14], [46, top], [32, top], 10),
        ...cubic([32, top], [14, top], [h + 1, 12], [h + 1, 27], 10).slice(1),
        ...cubic([h + 1, 27], [h + 1, 44], [18, 47], [32, 50], 10).slice(1),
        ...cubic([32, 50], [48, 53], [W - h - 1, 58], [W - h - 1, 73], 10).slice(1),
        ...cubic([W - h - 1, 73], [W - h - 1, 90], [48, bot], [31, bot], 10).slice(1),
        ...cubic([31, bot], [16, bot], [h - 2, 86], [h - 2, 70], 10).slice(1),
      ];
      return { strokes: [stroke(pts, w, 1)], adv: W };
    }
    case 'E':
      return {
        strokes: [stroke([[h, 50], [42, 50]], w * 0.9), stroke([[50, top], [h, top], [h, bot], [50, bot]], w)],
        adv: 50,
      };
    case 'V':
      return { strokes: [stroke([[h * 0.3, -12], [34, 106], [68 - h * 0.3, -12]], w)], adv: 68 };
    case 'N':
      return {
        strokes: [stroke([[h, 112], [h, -4], [62 - h, 104], [62 - h, -12]], w)],
        adv: 62,
      };
    case 'T':
      return { strokes: [stroke([[30, top], [30, 112]], w), stroke([[0, top], [60, top]], w)], adv: 60 };
    case 'K':
      return {
        strokes: [stroke([[27, 42], [67, 112]], w), stroke([[66, -12], [h, 64]], w * 0.95), stroke([[h, -12], [h, 112]], w)],
        adv: 68,
      };
    case 'I':
      return { strokes: [stroke([[h, -12], [h, 112]], w)], adv: w };
    default:
      return { strokes: [], adv: 40 };
  }
}

/** Miter-joined left / right offsets of a polyline with per-point widths. */
function offsets(s: Stroke): { l: Pt[]; r: Pt[] } {
  const { pts, w } = s;
  const n = pts.length;
  const l: Pt[] = [];
  const r: Pt[] = [];
  const dir = (a: Pt, b: Pt): Pt => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const m = Math.hypot(dx, dy) || 1;
    return [dx / m, dy / m];
  };
  for (let i = 0; i < n; i++) {
    const d0 = i > 0 ? dir(pts[i - 1], pts[i]) : dir(pts[i], pts[i + 1]);
    const d1 = i < n - 1 ? dir(pts[i], pts[i + 1]) : d0;
    let tx = d0[0] + d1[0];
    let ty = d0[1] + d1[1];
    const tm = Math.hypot(tx, ty) || 1;
    tx /= tm;
    ty /= tm;
    // Normal of the averaged tangent, scaled so the offset edges stay parallel to both segments.
    const nx = -ty;
    const ny = tx;
    const cos = Math.max(0.55, nx * -d0[1] + ny * d0[0]);
    const k = w[i] / 2 / cos;
    l.push([pts[i][0] + nx * k, pts[i][1] + ny * k]);
    r.push([pts[i][0] - nx * k, pts[i][1] - ny * k]);
  }
  return { l, r };
}

interface Facet {
  d: string;
  /** 0 = facing away from the light, 1 = facing it. */
  light: number;
}

const LIGHT: Pt = [-0.55, -0.83];

function facets(s: Stroke, ox: number, oy: number, scale: number): { facets: Facet[]; outline: string } {
  const { l, r } = offsets(s);
  const P = (p: Pt): string => `${f(ox + p[0] * scale)} ${f(oy + p[1] * scale)}`;
  const out: Facet[] = [];
  for (let i = 0; i < s.pts.length - 1; i++) {
    const a = s.pts[i];
    const b = s.pts[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const m = Math.hypot(dx, dy) || 1;
    const nL: Pt = [-dy / m, dx / m];
    for (const [side, sign] of [[l, 1], [r, -1]] as const) {
      const n: Pt = [nL[0] * sign, nL[1] * sign];
      const light = 0.5 + 0.5 * (n[0] * LIGHT[0] + n[1] * LIGHT[1]);
      out.push({ d: `M${P(a)}L${P(b)}L${P(side[i + 1])}L${P(side[i])}Z`, light });
    }
  }
  const ring = [...l, ...r.slice().reverse()];
  const outline = `M${ring.map(P).join('L')}Z`;
  return { facets: out, outline };
}

/** Interpolates the gold ramp: deep bronze in shadow, pale gold facing the light. */
function gold(t: number): string {
  const stops: [number, number, number][] = [
    [70, 38, 14],
    [140, 84, 32],
    [206, 146, 70],
    [240, 196, 120],
    [255, 236, 190],
  ];
  const x = Math.max(0, Math.min(0.999, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const k = x - i;
  const c = stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function setText(text: string, x: number, y: number, capH: number, weight: number, track: number) {
  const scale = capH / 100;
  let pen = 0;
  const facetsAll: Facet[] = [];
  const outlines: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const g = glyph(text[i], weight);
    for (const s of g.strokes) {
      const r = facets(s, x + pen * scale, y, scale);
      facetsAll.push(...r.facets);
      outlines.push(r.outline);
    }
    pen += g.adv + (i < text.length - 1 ? track : 0);
  }
  return { facets: facetsAll, outlines, width: pen * scale, y, capH };
}

function textWidth(text: string, capH: number, weight: number, track: number): number {
  let pen = 0;
  for (let i = 0; i < text.length; i++) {
    pen += glyph(text[i], weight).adv + (i < text.length - 1 ? track : 0);
  }
  return (pen * capH) / 100;
}

/** Eight-pointed star path. */
function star(cx: number, cy: number, r: number, inner = 0.42): string {
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * inner;
    pts.push(`${f(cx + Math.cos(a) * rr)} ${f(cy + Math.sin(a) * rr)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** One raised wing (right side), feathered trailing edge, anchored at 0,0 and reaching up-right. */
function wingPath(sx: number, s: number, ox: number, oy: number): string {
  const pts: [string, number[]][] = [
    ['M', [0, 0]],
    ['C', [60, -30, 170, -110, 300, -200]],
    ['C', [280, -170, 262, -150, 246, -136]],
    ['L', [286, -140]],
    ['C', [258, -108, 232, -88, 206, -74]],
    ['L', [250, -70]],
    ['C', [214, -40, 180, -24, 150, -14]],
    ['L', [196, -2]],
    ['C', [150, 16, 104, 22, 64, 22]],
    ['L', [98, 38]],
    ['C', [64, 44, 30, 40, 0, 30]],
  ];
  let d = '';
  for (const [c, p] of pts) {
    d += c + p.map((v, i) => f(i % 2 === 0 ? ox + v * s * sx : oy + v * s)).join(' ');
  }
  return d + 'Z';
}

type TextLine = ReturnType<typeof setText>;

const OUT = 3.5;

/** Clip paths for a carved line: letters cut flat at the cap and base lines, the outline a little outside them. */
function lineClips(t: TextLine, key: string, x0: number, x1: number): string {
  return (
    `<clipPath id="${key}-c"><rect x="${f(x0)}" y="${f(t.y)}" width="${f(x1 - x0)}" height="${f(t.capH)}"/></clipPath>` +
    `<clipPath id="${key}-o"><rect x="${f(x0)}" y="${f(t.y - OUT)}" width="${f(x1 - x0)}" height="${f(t.capH + OUT * 2)}"/></clipPath>`
  );
}

/** A carved line: dark outline underneath, then the shaded facets. */
function carvedLine(t: TextLine, key: string): string {
  return (
    `<g clip-path="url(#${key}-o)" fill="${BRAND_COLORS.outline}" stroke="${BRAND_COLORS.outline}" stroke-width="${OUT * 2}" stroke-linejoin="round">` +
    t.outlines.map((d) => `<path d="${d}"/>`).join('') +
    `</g><g clip-path="url(#${key}-c)">` +
    t.facets
      .map((fc) => {
        const c = gold(fc.light * 0.92 + 0.04);
        return `<path d="${fc.d}" fill="${c}" stroke="${c}" stroke-width="0.6"/>`;
      })
      .join('') +
    `</g>`
  );
}

/** Star with its glow and a thin inner highlight. */
function starBlock(id: string, cx: number, cy: number, r: number): string {
  return (
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 1.75)}" fill="url(#${id}-glow)"/>` +
    `<path d="${star(cx, cy, r)}" fill="url(#${id}-star)" stroke="#3a220e" stroke-width="${f(r * 0.075)}" stroke-linejoin="round"/>` +
    `<path d="${star(cx, cy, r * 0.97)}" fill="none" stroke="rgba(255,248,230,0.55)" stroke-width="${f(r * 0.03)}" transform="translate(${f(-r * 0.03)} ${f(-r * 0.03)})"/>`
  );
}

function sharedDefs(id: string): string {
  return (
    `<radialGradient id="${id}-glow"><stop offset="0" stop-color="#ffe7b8" stop-opacity="0.55"/><stop offset="1" stop-color="#ffe7b8" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${id}-star" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4d8"/><stop offset="0.5" stop-color="${BRAND_COLORS.gold}"/><stop offset="1" stop-color="#9a6228"/></linearGradient>` +
    `<filter id="${id}-drop" x="-10%" y="-20%" width="120%" height="150%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.55"/></filter>`
  );
}

export interface TitleLogoOptions {
  /** Rendered width in px; omit for a fluid SVG. */
  width?: number;
  /** Unique id prefix when several logos share a document. */
  id?: string;
  /** Draw the wings, star and strata around the title (the full logo). Off: the title alone, for small sizes. */
  crest?: boolean;
}

/** The title logo on a transparent background: SEVENTEEN over a large SKIES, optionally with its crest. */
export function titleLogoSvg(opts: TitleLogoOptions = {}): string {
  const id = opts.id ?? 'sst';
  const crest = opts.crest ?? true;
  const W = 1000;
  const bigCap = 210;
  const bigW = 24;
  const bigTrack = 16;
  const smallCap = 62;
  const smallW = 15;
  const smallTrack = 30;
  const bigWidth = textWidth('SKIES', bigCap, bigW, bigTrack);
  const smallWidth = textWidth('SEVENTEEN', smallCap, smallW, smallTrack);
  const top = crest ? 190 : 12;
  const smallY = top;
  const bigY = smallY + smallCap + 34;
  const small = setText('SEVENTEEN', (W - smallWidth) / 2, smallY, smallCap, smallW, smallTrack);
  const big = setText('SKIES', (W - bigWidth) / 2, bigY, bigCap, bigW, bigTrack);
  // Without the crest the box hugs the letters (plus the outline and the drop shadow).
  const x0 = crest ? 0 : (W - bigWidth) / 2 - 16;
  const x1 = crest ? W : (W + bigWidth) / 2 + 16;
  const H = bigY + bigCap + (crest ? 60 : 26);

  let decor = '';
  if (crest) {
    const cx = W / 2;
    const wingY = bigY + 30;
    // The layers of the sky as rules either side of SEVENTEEN: one strong line and two fine ones fading outwards.
    const ruleY = smallY + smallCap / 2;
    let rules = '';
    for (const side of [-1, 1]) {
      const a = cx + side * (smallWidth / 2 + 26);
      const b = cx + side * (W / 2 - 10);
      const g = `url(#${id}-rule${side > 0 ? 'r' : 'l'})`;
      rules += `<path d="M${f(a)} ${f(ruleY)}H${f(b)}" stroke="${g}" stroke-width="4"/>`;
      rules += `<path d="M${f(a)} ${f(ruleY - 11)}H${f(b - side * 90)}M${f(a)} ${f(ruleY + 11)}H${f(b - side * 90)}" stroke="${g}" stroke-width="1.6"/>`;
    }
    decor =
      `<g stroke="url(#${id}-wingline)" stroke-width="2.4" stroke-linejoin="round" fill="url(#${id}-wing)">` +
      `<path d="${wingPath(1, 1.12, cx + 30, wingY)}"/><path d="${wingPath(-1, 1.12, cx - 30, wingY)}"/></g>` +
      starBlock(id, cx, top - 92, 40) +
      `<g fill="none">${rules}</g>`;
  }

  const defs =
    sharedDefs(id) +
    `<linearGradient id="${id}-wing" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#c98a3e" stop-opacity="0"/><stop offset="0.6" stop-color="#c98a3e" stop-opacity="0.22"/><stop offset="1" stop-color="${BRAND_COLORS.goldPale}" stop-opacity="0.42"/></linearGradient>` +
    `<linearGradient id="${id}-wingline" x1="0" y1="1" x2="0" y2="0"><stop offset="0.2" stop-color="${BRAND_COLORS.gold}" stop-opacity="0"/><stop offset="1" stop-color="${BRAND_COLORS.goldPale}" stop-opacity="0.9"/></linearGradient>` +
    `<linearGradient id="${id}-rulel" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="${BRAND_COLORS.gold}"/><stop offset="1" stop-color="${BRAND_COLORS.gold}" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="${id}-ruler" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${BRAND_COLORS.gold}"/><stop offset="1" stop-color="${BRAND_COLORS.gold}" stop-opacity="0"/></linearGradient>` +
    lineClips(small, `${id}-l0`, x0, x1) +
    lineClips(big, `${id}-l1`, x0, x1);

  const vw = x1 - x0;
  const size = opts.width ? ` width="${opts.width}" height="${f((opts.width * H) / vw)}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} 0 ${f(vw)} ${f(H)}"${size} role="img" aria-label="${BRAND.name}">` +
    `<defs>${defs}</defs>` +
    decor +
    `<g filter="url(#${id}-drop)">${carvedLine(small, `${id}-l0`)}${carvedLine(big, `${id}-l1`)}</g>` +
    `</svg>`
  );
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

/** The app icon / favicon: a carved S under the star of the upper sky, over the seventeen layers. */
export function monogramSvg(opts: MonogramOptions = {}): string {
  const id = opts.id ?? 'ssm';
  const tile = opts.tile ?? true;
  const S = 512;
  const cap = 290;
  const weight = 26;
  const sw = textWidth('S', cap, weight, 0);
  const y = 158;
  const line = setText('S', (S - sw) / 2, y, cap, weight, 0);
  let strata = '';
  if (tile) {
    // Seventeen layers, denser towards the top, faint behind the letter.
    for (let i = 0; i < 17; i++) {
      const t = i / 16;
      const ly = 470 - 360 * (1 - Math.pow(1 - t, 1.6));
      strata += `<path d="M0 ${f(ly)}H${S}" stroke="${BRAND_COLORS.gold}" stroke-opacity="${f(0.2 - 0.12 * t)}" stroke-width="${f(3 - 1.6 * t)}"/>`;
    }
  }
  const r = (opts.radius ?? 0.22) * S;
  const bg = tile
    ? `<rect width="${S}" height="${S}" rx="${f(r)}" fill="url(#${id}-bg)"/>` +
      `<g clip-path="url(#${id}-tile)">${strata}</g>`
    : '';
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}"${size} role="img" aria-label="${BRAND.name}">` +
    `<defs>${sharedDefs(id)}` +
    `<radialGradient id="${id}-bg" cx="0.5" cy="0.18" r="0.95"><stop offset="0" stop-color="#2a3a58"/><stop offset="0.45" stop-color="${BRAND_COLORS.gok}"/><stop offset="1" stop-color="${BRAND_COLORS.night}"/></radialGradient>` +
    `<clipPath id="${id}-tile"><rect width="${S}" height="${S}" rx="${f(r)}"/></clipPath>` +
    lineClips(line, `${id}-l`, 0, S) +
    `</defs>` +
    bg +
    starBlock(id, S / 2, 92, 50) +
    `<g filter="url(#${id}-drop)">${carvedLine(line, `${id}-l`)}</g>` +
    `</svg>`
  );
}
