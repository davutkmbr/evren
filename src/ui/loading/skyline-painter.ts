/**
 * Procedural dusk panorama of the historic peninsula, seen from Salacak across the Bosphorus mouth: Kız Kulesi in
 * the foreground water, Sultanahmet, Ayasofya and the Topkapı point on the near shore, Süleymaniye on its hill behind,
 * and Galata across the Golden Horn on the far right, in three layers of haze. Everything is canvas 2D paths drawn
 * in "design units" (a 1600 × 900 frame, scaled by the screen height and centred), so the composition keeps its
 * proportions on any aspect ratio while the ridges and the sea run on to the screen edges.
 */
import { createRng } from '../../core/math/noise';

export interface SkylineLayout {
  width: number;
  height: number;
  horizon: number;
  sunX: number;
}

export interface Light {
  x: number;
  y: number;
  size: number;
  phase: number;
  warmth: number;
}

/** Design frame: x in units of the 1600-wide frame, heights in units above the horizon. */
interface Frame {
  /** Screen x of a design x. */
  x(u: number): number;
  /** Screen y of a height above the horizon. */
  y(h: number): number;
  /** Screen length of a design length. */
  s(u: number): number;
  /** Design x of the left and right screen edges. */
  left: number;
  right: number;
}

/** Design x of the sun (behind the Süleymaniye hill, right of the dome). */
export const SUN_DESIGN_X = 1112;

/** Design units per screen pixel at a 900 px tall screen (the landmarks' size on screen). */
const ZOOM = 1.5;

export function designFrame(layout: SkylineLayout): Frame {
  // Height sets the scale; on portrait screens the width limits it so the whole peninsula stays in view.
  const k = Math.min(layout.height / 900, layout.width / 1000) * ZOOM;
  const x0 = layout.width / 2 - 800 * k;
  return {
    x: (u) => x0 + u * k,
    y: (h) => layout.horizon - h * k,
    s: (u) => u * k,
    left: -x0 / k,
    right: (layout.width - x0) / k,
  };
}

/* ------------------------------------------------------------------ */
/* Sky                                                                 */
/* ------------------------------------------------------------------ */

export function paintSky(ctx: CanvasRenderingContext2D, layout: SkylineLayout): void {
  const { width: w, height: h, horizon } = layout;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#070a18');
  sky.addColorStop(0.3, '#111633');
  sky.addColorStop(0.55, '#2a2244');
  sky.addColorStop(0.74, '#5c3550');
  sky.addColorStop(0.87, '#a0544c');
  sky.addColorStop(0.95, '#dc8a55');
  sky.addColorStop(1, '#f0b273');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon + 1);

  // The sun has just set: a low warm glow, wider than tall.
  ctx.save();
  ctx.translate(layout.sunX, horizon);
  ctx.scale(1.9, 1);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 0.42);
  glow.addColorStop(0, 'rgba(255, 216, 160, 0.8)');
  glow.addColorStop(0.16, 'rgba(255, 176, 112, 0.42)');
  glow.addColorStop(0.45, 'rgba(214, 112, 90, 0.13)');
  glow.addColorStop(1, 'rgba(120, 60, 90, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-w, -horizon, w * 2, horizon + 1);
  ctx.restore();
}

export function createStars(layout: SkylineLayout, count: number): Light[] {
  const rng = createRng(29);
  const stars: Light[] = [];
  for (let i = 0; i < count; i++) {
    const y = Math.pow(rng(), 1.7) * layout.horizon * 0.6;
    stars.push({ x: rng() * layout.width, y, size: 0.5 + Math.pow(rng(), 3) * 1.2, phase: rng() * Math.PI * 2, warmth: rng() });
  }
  return stars;
}

/* ------------------------------------------------------------------ */
/* Building blocks (all in screen space, sizes from the frame)          */
/* ------------------------------------------------------------------ */

/** Smooth ground line: sum of gaussian bumps plus a base, in design heights. */
type Ridge = (u: number) => number;

function ridge(base: number, bumps: ReadonlyArray<[center: number, width: number, height: number]>): Ridge {
  return (u) => {
    let h = base;
    for (const [c, wd, ht] of bumps) {
      const d = (u - c) / wd;
      h += ht * Math.exp(-d * d);
    }
    return h;
  };
}

function fillRidge(ctx: CanvasRenderingContext2D, f: Frame, from: number, to: number, r: Ridge, bottom: number): void {
  ctx.beginPath();
  ctx.moveTo(f.x(from), bottom);
  for (let u = from; u <= to; u += 3) {
    ctx.lineTo(f.x(u), f.y(r(u)));
  }
  ctx.lineTo(f.x(to), f.y(r(to)));
  ctx.lineTo(f.x(to), bottom);
  ctx.closePath();
  ctx.fill();
}

/**
 * Ottoman minaret: a slender shaft, one to three şerefe (balconies), a tall pencil cap and the alem.
 * `h` is the height from `ground` to the cap tip (design units), `w` the shaft width.
 */
function minaret(ctx: CanvasRenderingContext2D, f: Frame, u: number, ground: number, h: number, w: number, balconies: number): void {
  const cap = h * 0.17;
  const shaftTop = ground + h - cap;
  const x = f.x(u);
  const hw = f.s(w / 2);
  ctx.beginPath();
  // Shaft, slightly wider at the base (the pedestal).
  ctx.moveTo(x - hw * 1.35, f.y(ground));
  ctx.lineTo(x - hw * 1.35, f.y(ground + h * 0.06));
  ctx.lineTo(x - hw, f.y(ground + h * 0.08));
  ctx.lineTo(x - hw * 0.9, f.y(shaftTop));
  ctx.lineTo(x, f.y(ground + h));
  ctx.lineTo(x + hw * 0.9, f.y(shaftTop));
  ctx.lineTo(x + hw, f.y(ground + h * 0.08));
  ctx.lineTo(x + hw * 1.35, f.y(ground + h * 0.06));
  ctx.lineTo(x + hw * 1.35, f.y(ground));
  ctx.closePath();
  ctx.fill();
  // Balconies: a corbelled ring (wider at the top), evenly up the upper shaft.
  for (let i = 0; i < balconies; i++) {
    const t = balconies === 1 ? 0.72 : 0.5 + (i / (balconies - 1)) * 0.3;
    const by = ground + h * t;
    const bw = hw * 2.3;
    ctx.beginPath();
    ctx.moveTo(x - hw, f.y(by - h * 0.018));
    ctx.lineTo(x - bw, f.y(by));
    ctx.lineTo(x - bw, f.y(by + h * 0.012));
    ctx.lineTo(x + bw, f.y(by + h * 0.012));
    ctx.lineTo(x + bw, f.y(by));
    ctx.lineTo(x + hw, f.y(by - h * 0.018));
    ctx.closePath();
    ctx.fill();
  }
  // Alem: a thin finial above the cap.
  ctx.fillRect(x - Math.max(0.5, f.s(0.35)), f.y(ground + h + h * 0.035), Math.max(1, f.s(0.7)), f.s(h * 0.035));
}

/** Dome on its drum: `rx` half width, `rise` dome height, `drum` drum height, all design units. */
function dome(ctx: CanvasRenderingContext2D, f: Frame, u: number, spring: number, rx: number, rise: number, drum: number, alem = true): void {
  const x = f.x(u);
  const drumRx = rx * 1.02;
  ctx.fillRect(x - f.s(drumRx), f.y(spring + drum), f.s(drumRx * 2), f.s(drum) + 1);
  ctx.beginPath();
  ctx.ellipse(x, f.y(spring + drum), f.s(rx), f.s(rise), 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  if (alem) {
    const top = spring + drum + rise;
    ctx.fillRect(x - Math.max(0.5, f.s(0.4)), f.y(top + rx * 0.28), Math.max(1, f.s(0.8)), f.s(rx * 0.28) + 1);
    ctx.beginPath();
    ctx.arc(x, f.y(top + rx * 0.12), Math.max(0.8, f.s(rx * 0.05)), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Half dome leaning against the main structure (open side toward `dir`: -1 left, 1 right). */
function semiDome(ctx: CanvasRenderingContext2D, f: Frame, u: number, spring: number, rx: number, rise: number): void {
  ctx.beginPath();
  ctx.ellipse(f.x(u), f.y(spring), f.s(rx), f.s(rise), 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
}

function block(ctx: CanvasRenderingContext2D, f: Frame, u0: number, u1: number, bottom: number, top: number): void {
  ctx.fillRect(f.x(u0), f.y(top), f.s(u1 - u0), f.s(top - bottom) + 1);
}

/** Small weight turret with a domelet, at the corners of a mosque's central block. */
function turret(ctx: CanvasRenderingContext2D, f: Frame, u: number, base: number, h: number, r: number): void {
  block(ctx, f, u - r, u + r, base, base + h);
  dome(ctx, f, u, base + h, r * 1.1, r * 1.15, 0, false);
}

/** Row of low houses with pitched roofs along a ridge (the city fabric), plus window lights. */
function fabric(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  from: number,
  to: number,
  r: Ridge,
  bottom: number,
  seed: number,
  maxH: number,
  lights: Light[] | null,
  scale = 1,
): void {
  const rng = createRng(seed);
  let u = from;
  while (u < to) {
    const wd = (5 + rng() * 9) * scale;
    const g = r(u + wd / 2) - 1;
    const hh = (2 + rng() * maxH) * scale;
    // Mostly low hipped roofs, some flat roofs (apartments), rarely a steeper gable.
    const kind = rng();
    const roof = (kind < 0.3 ? 0 : kind < 0.9 ? 1 + rng() * 1.5 : 2.5 + rng() * 1.5) * scale;
    const x0 = f.x(u);
    const x1 = f.x(u + wd);
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    ctx.lineTo(x0, f.y(g + hh));
    if (roof > 0) {
      ctx.lineTo(x0 + (x1 - x0) * 0.3, f.y(g + hh + roof));
      ctx.lineTo(x0 + (x1 - x0) * 0.7, f.y(g + hh + roof));
    }
    ctx.lineTo(x1, f.y(g + hh));
    ctx.lineTo(x1, bottom);
    ctx.closePath();
    ctx.fill();
    if (lights && rng() < 0.45) {
      const n = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) {
        lights.push({
          x: f.x(u + 2 + rng() * (wd - 4)),
          y: f.y(g + 1.5 + rng() * (hh - 2.5)),
          size: Math.max(1, f.s(1.1)),
          phase: rng() * Math.PI * 2,
          warmth: rng(),
        });
      }
    }
    u += wd + (rng() < 0.15 ? rng() * 4 * scale : 0);
  }
}

/** Cypresses (tall narrow) and umbrella pines (round crowns) along a ridge. */
function trees(ctx: CanvasRenderingContext2D, f: Frame, from: number, to: number, r: Ridge, seed: number, density: number): void {
  const rng = createRng(seed);
  for (let u = from; u < to; u += 4 + rng() * (10 / density)) {
    const g = r(u) - 0.5;
    if (rng() < 0.62) {
      const hh = 12 + rng() * 14;
      const ww = 2.2 + rng() * 1.4;
      ctx.beginPath();
      ctx.moveTo(f.x(u), f.y(g + hh));
      ctx.quadraticCurveTo(f.x(u + ww), f.y(g + hh * 0.55), f.x(u + ww * 0.6), f.y(g));
      ctx.lineTo(f.x(u - ww * 0.6), f.y(g));
      ctx.quadraticCurveTo(f.x(u - ww), f.y(g + hh * 0.55), f.x(u), f.y(g + hh));
      ctx.fill();
    } else {
      const cr = 5 + rng() * 5;
      ctx.fillRect(f.x(u) - f.s(0.6), f.y(g + cr), f.s(1.2), f.s(cr));
      ctx.beginPath();
      ctx.ellipse(f.x(u), f.y(g + cr + cr * 0.35), f.s(cr), f.s(cr * 0.5), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Landmarks                                                           */
/* ------------------------------------------------------------------ */

/** Sultanahmet Camii: cascading half domes and six minarets (four at the prayer hall, two at the courtyard). */
function sultanahmet(ctx: CanvasRenderingContext2D, f: Frame, u: number, g: number): void {
  block(ctx, f, u - 36, u + 36, g - 2, g + 22);
  block(ctx, f, u - 100, u - 36, g - 2, g + 11); // courtyard arcade
  for (let i = 0; i < 6; i++) {
    dome(ctx, f, u - 92 + i * 10.5, g + 11, 4.4, 3.8, 0.8, false);
  }
  semiDome(ctx, f, u - 22, g + 22, 16, 11);
  semiDome(ctx, f, u + 22, g + 22, 16, 11);
  semiDome(ctx, f, u - 34, g + 22, 7, 6);
  semiDome(ctx, f, u + 34, g + 22, 7, 6);
  turret(ctx, f, u - 21, g + 22, 9, 3);
  turret(ctx, f, u + 21, g + 22, 9, 3);
  dome(ctx, f, u, g + 22, 20, 16, 9);
  minaret(ctx, f, u - 41, g - 2, 76, 2.8, 3);
  minaret(ctx, f, u + 41, g - 2, 76, 2.8, 3);
  minaret(ctx, f, u - 31, g - 2, 70, 2.5, 3);
  minaret(ctx, f, u + 31, g - 2, 70, 2.5, 3);
  minaret(ctx, f, u - 102, g - 2, 64, 2.4, 2);
  minaret(ctx, f, u - 70, g - 2, 62, 2.3, 2);
}

/** Ayasofya: the broad, flat dome on massive buttresses, and four unlike minarets. */
function ayasofya(ctx: CanvasRenderingContext2D, f: Frame, u: number, g: number): void {
  // Low aisles, then the cascade: exedrae, the two great half domes, the central dome on its window drum.
  block(ctx, f, u - 46, u + 46, g - 2, g + 13);
  semiDome(ctx, f, u - 33, g + 13, 10, 6.5);
  semiDome(ctx, f, u + 33, g + 13, 10, 6.5);
  block(ctx, f, u - 30, u + 30, g + 13, g + 19);
  semiDome(ctx, f, u - 15, g + 19, 17, 12);
  semiDome(ctx, f, u + 15, g + 19, 17, 12);
  // Buttress towers with sloping tops, flanking the dome.
  for (const side of [-1, 1]) {
    const bx = u + side * 23;
    ctx.beginPath();
    ctx.moveTo(f.x(bx - 4), f.y(g + 13));
    ctx.lineTo(f.x(bx - 4), f.y(g + 31 + (side < 0 ? 0 : 2)));
    ctx.lineTo(f.x(bx + 4), f.y(g + 31 + (side < 0 ? 2 : 0)));
    ctx.lineTo(f.x(bx + 4), f.y(g + 13));
    ctx.closePath();
    ctx.fill();
  }
  dome(ctx, f, u, g + 19, 21, 12.5, 11);
  // The minarets differ: a stout brick one, a thin early one and two Sinan-era ones.
  minaret(ctx, f, u - 50, g - 2, 60, 3.6, 1);
  minaret(ctx, f, u - 41, g - 2, 64, 2.4, 1);
  minaret(ctx, f, u + 44, g - 2, 70, 2.9, 2);
  minaret(ctx, f, u + 53, g - 2, 70, 2.9, 2);
}

/** Süleymaniye: the tallest crown of the peninsula, on its hill; two tall and two shorter minarets. */
function suleymaniye(ctx: CanvasRenderingContext2D, f: Frame, u: number, g: number): void {
  block(ctx, f, u - 34, u + 34, g - 3, g + 21);
  block(ctx, f, u - 84, u - 34, g - 3, g + 10);
  for (let i = 0; i < 5; i++) {
    dome(ctx, f, u - 78 + i * 10, g + 10, 4, 3.4, 0.6, false);
  }
  semiDome(ctx, f, u - 21, g + 21, 14, 10);
  semiDome(ctx, f, u + 21, g + 21, 14, 10);
  turret(ctx, f, u - 20, g + 21, 8, 2.8);
  turret(ctx, f, u + 20, g + 21, 8, 2.8);
  dome(ctx, f, u, g + 21, 19, 17, 9);
  minaret(ctx, f, u - 38, g - 3, 80, 2.8, 3);
  minaret(ctx, f, u + 38, g - 3, 80, 2.8, 3);
  minaret(ctx, f, u - 86, g - 3, 64, 2.4, 2);
  minaret(ctx, f, u - 60, g - 3, 64, 2.4, 2);
}

/** Topkapı point: low palace roofs, chimneys, the Adalet Kulesi (Tower of Justice) with its pointed roof. */
function topkapi(ctx: CanvasRenderingContext2D, f: Frame, u: number, g: Ridge): void {
  const rng = createRng(1478);
  for (let x = u - 60; x < u + 90; x += 14 + rng() * 10) {
    const gg = g(x);
    const hh = 6 + rng() * 5;
    const wd = 12 + rng() * 10;
    block(ctx, f, x, x + wd, gg - 1, gg + hh);
    ctx.beginPath();
    ctx.moveTo(f.x(x - 1.5), f.y(gg + hh));
    ctx.lineTo(f.x(x + wd / 2), f.y(gg + hh + 3.5));
    ctx.lineTo(f.x(x + wd + 1.5), f.y(gg + hh));
    ctx.closePath();
    ctx.fill();
    if (rng() < 0.5) {
      block(ctx, f, x + wd * 0.3, x + wd * 0.3 + 1.6, gg + hh, gg + hh + 6);
      dome(ctx, f, x + wd * 0.3 + 0.8, gg + hh + 6, 1.4, 1.4, 0, false);
    }
  }
  const tg = g(u + 8);
  block(ctx, f, u + 4, u + 12, tg, tg + 34);
  block(ctx, f, u + 3, u + 13, tg + 34, tg + 36);
  block(ctx, f, u + 5, u + 11, tg + 36, tg + 41);
  ctx.beginPath();
  ctx.moveTo(f.x(u + 4), f.y(tg + 41));
  ctx.lineTo(f.x(u + 8), f.y(tg + 55));
  ctx.lineTo(f.x(u + 12), f.y(tg + 41));
  ctx.closePath();
  ctx.fill();
}

/** Galata Kulesi: a round tower with a corbelled gallery and a conical cap. */
function galata(ctx: CanvasRenderingContext2D, f: Frame, u: number, g: number): void {
  block(ctx, f, u - 5.5, u + 5.5, g - 2, g + 34);
  block(ctx, f, u - 7, u + 7, g + 34, g + 37);
  block(ctx, f, u - 5, u + 5, g + 37, g + 41);
  ctx.beginPath();
  ctx.moveTo(f.x(u - 6.2), f.y(g + 41));
  ctx.lineTo(f.x(u), f.y(g + 56));
  ctx.lineTo(f.x(u + 6.2), f.y(g + 41));
  ctx.closePath();
  ctx.fill();
}

/** Kız Kulesi on its islet, in the foreground water (the base sits on `water`, a design height below 0). */
function kizKulesi(ctx: CanvasRenderingContext2D, f: Frame, u: number, water: number, lights: Light[]): void {
  // Islet and the low terrace walls.
  ctx.beginPath();
  ctx.ellipse(f.x(u), f.y(water), f.s(34), f.s(2.4), 0, Math.PI, 0);
  ctx.fill();
  block(ctx, f, u - 26, u + 24, water, water + 5);
  block(ctx, f, u - 14, u + 18, water + 5, water + 13);
  ctx.beginPath();
  ctx.moveTo(f.x(u - 15), f.y(water + 13));
  ctx.lineTo(f.x(u + 2), f.y(water + 17));
  ctx.lineTo(f.x(u + 19), f.y(water + 13));
  ctx.closePath();
  ctx.fill();
  // The tower: square shaft, gallery, lantern and lead cap.
  block(ctx, f, u - 5, u + 5, water + 13, water + 34);
  block(ctx, f, u - 6.5, u + 6.5, water + 34, water + 36);
  block(ctx, f, u - 4, u + 4, water + 36, water + 42);
  ctx.beginPath();
  ctx.moveTo(f.x(u - 4.8), f.y(water + 42));
  ctx.quadraticCurveTo(f.x(u - 3.5), f.y(water + 49), f.x(u), f.y(water + 53));
  ctx.quadraticCurveTo(f.x(u + 3.5), f.y(water + 49), f.x(u + 4.8), f.y(water + 42));
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(f.x(u) - Math.max(0.5, f.s(0.35)), f.y(water + 57), Math.max(1, f.s(0.7)), f.s(4));
  // Lantern light and a few lit windows.
  lights.push({ x: f.x(u - 1.5), y: f.y(water + 40.5), size: Math.max(1.5, f.s(3)), phase: 1.2, warmth: 1 });
  lights.push({ x: f.x(u - 11), y: f.y(water + 9), size: Math.max(1, f.s(1.6)), phase: 0.3, warmth: 0.8 });
  lights.push({ x: f.x(u + 9), y: f.y(water + 9), size: Math.max(1, f.s(1.6)), phase: 2.1, warmth: 0.6 });
}

/* ------------------------------------------------------------------ */
/* Composition                                                         */
/* ------------------------------------------------------------------ */

/**
 * Paints the city (everything that stands on or above the horizon, plus Kız Kulesi) on a transparent canvas and
 * collects window lights for the animated layer.
 */
export function paintSkyline(ctx: CanvasRenderingContext2D, layout: SkylineLayout, lights: Light[]): void {
  const f = designFrame(layout);
  const bottom = layout.horizon + 1;
  const L = f.left - 20;
  const R = f.right + 20;

  // Far: Beyoğlu across the Golden Horn (right) and the low Marmara shore (left), deep in the haze.
  const farRidge = ridge(4, [
    [1235, 90, 44],
    [1360, 110, 30],
    [1500, 160, 20],
    [1118, 30, 6],
  ]);
  const far = ctx.createLinearGradient(0, f.y(80), 0, bottom);
  far.addColorStop(0, '#433045');
  far.addColorStop(1, '#553648');
  ctx.fillStyle = far;
  fillRidge(ctx, f, 1095, R, farRidge, bottom);
  fabric(ctx, f, 1100, R, farRidge, bottom, 11, 5, null, 0.55);
  galata(ctx, f, 1228, farRidge(1228) + 1.5);

  // Middle: the Süleymaniye hill and the city climbing to it.
  const midRidge = ridge(7, [
    [995, 95, 26],
    [860, 80, 12],
    [700, 140, 8],
    [420, 200, 5],
  ]);
  const edgeMid = (u: number): number => (u > 1070 ? midRidge(u) * Math.max(0, 1 - (u - 1070) / 30) : midRidge(u));
  const mid = ctx.createLinearGradient(0, f.y(70), 0, bottom);
  mid.addColorStop(0, '#34253a');
  mid.addColorStop(1, '#45303e');
  ctx.fillStyle = mid;
  fillRidge(ctx, f, L, 1100, edgeMid, bottom);
  fabric(ctx, f, L, 1095, edgeMid, bottom, 23, 6, null, 0.7);
  suleymaniye(ctx, f, 1000, midRidge(1000) + 1.5);

  // Near: the peninsula shore, Sultanahmet, Ayasofya and the wooded Topkapı point.
  const nearRidge = ridge(3, [
    [650, 110, 11],
    [820, 70, 10],
    [940, 60, 8],
    [420, 160, 3],
  ]);
  const shore = (u: number): number => (u > 1010 ? Math.max(0, nearRidge(u) * (1 - (u - 1010) / 60)) : nearRidge(u));
  const near = ctx.createLinearGradient(0, f.y(60), 0, bottom);
  near.addColorStop(0, '#110d18');
  near.addColorStop(1, '#16101b');
  ctx.fillStyle = near;
  fillRidge(ctx, f, L, 1075, shore, bottom);
  fabric(ctx, f, L, 532, shore, bottom, 37, 5, lights, 0.85);
  fabric(ctx, f, 690, 740, shore, bottom, 41, 5, lights, 0.85);
  trees(ctx, f, 880, 1045, shore, 5, 1.4);
  trees(ctx, f, 525, 545, shore, 9, 1);
  sultanahmet(ctx, f, 640, shore(640));
  ayasofya(ctx, f, 805, shore(805));
  topkapi(ctx, f, 925, shore);
  // The sea walls along the shore.
  ctx.fillRect(f.x(L), f.y(2.4), f.x(1040) - f.x(L), f.s(2.4) + 1);
}

/** Design position of Kız Kulesi: x, and the water line (a design height below the horizon). */
const KIZ_X = 452;
const KIZ_WATER = -34;

/** Screen y of the foreground water line (Kız Kulesi's islet), for its reflection. */
export function foregroundWaterY(layout: SkylineLayout): number {
  return designFrame(layout).y(KIZ_WATER);
}

/** Paints the foreground (Kız Kulesi on the water) on a transparent canvas; its base sits on foregroundWaterY. */
export function paintForeground(ctx: CanvasRenderingContext2D, layout: SkylineLayout, lights: Light[]): void {
  ctx.fillStyle = '#0c0a12';
  // Nearer than the shore, so drawn a third larger than the landmarks' scale.
  const base = designFrame(layout);
  const k = 1.35;
  const near: Frame = {
    x: (u) => base.x(KIZ_X + (u - KIZ_X) * k),
    y: (h) => base.y(KIZ_WATER + (h - KIZ_WATER) * k),
    s: (u) => base.s(u * k),
    left: base.left,
    right: base.right,
  };
  kizKulesi(ctx, near, KIZ_X, KIZ_WATER, lights);
}

/* ------------------------------------------------------------------ */
/* Animated silhouettes                                                */
/* ------------------------------------------------------------------ */

/** Tiny gull silhouette (two arcs). */
export function drawGull(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, flap: number): void {
  const lift = size * (0.25 + 0.35 * flap);
  ctx.beginPath();
  ctx.moveTo(x - size, y - lift);
  ctx.quadraticCurveTo(x - size * 0.45, y - lift * 1.25, x, y);
  ctx.quadraticCurveTo(x + size * 0.45, y - lift * 1.25, x + size, y - lift);
  ctx.stroke();
}

/**
 * Dragon flying to the LEFT, seen from slightly below: both bat wings spread to the sides (scalloped membrane between
 * three finger bones), head and neck leading, a long tapering tail with a spade tip. `size` is half the wingspan;
 * `flap` in [-1, 1] sweeps the wings from down (-1) through level (0) to raised (1).
 */
export function drawDragon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, flap: number): void {
  const s = size;
  ctx.save();
  ctx.translate(x, y);

  const wing = (d: number, lift: number): void => {
    // d = -1 left (the head side), 1 right; lift > 0 raises the wing. Fingers radiate from the wrist; the membrane
    // between their tips sags toward the wrist (concave arcs), which is what makes it read as a bat wing.
    const L = lift;
    const rootX = d < 0 ? -0.08 : 0.04;
    const wx = 0.36 * d;
    const wy = -(0.42 * L + 0.05);
    const tips: Array<[number, number]> = [
      [1.0 * d, -(0.3 * L) - 0.02],
      [0.8 * d, 0.06 - 0.06 * L],
      [0.55 * d, 0.14 - 0.02 * L],
      [0.22 * d, 0.05],
    ];
    ctx.beginPath();
    ctx.moveTo(s * rootX, -s * 0.03);
    ctx.quadraticCurveTo(s * 0.14 * d, s * (wy * 0.8), s * wx, s * wy);
    ctx.quadraticCurveTo(s * 0.7 * d, s * (wy - 0.04), s * tips[0][0], s * tips[0][1]);
    for (let i = 1; i < tips.length; i++) {
      const [ax, ay] = tips[i - 1];
      const [bx, by] = tips[i];
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      ctx.quadraticCurveTo(s * (mx + (wx - mx) * 0.32), s * (my + (wy - my) * 0.32), s * bx, s * by);
    }
    ctx.lineTo(s * (rootX + 0.1), s * 0.02);
    ctx.closePath();
    ctx.fill();
  };

  const lift = 0.25 + 0.75 * flap;
  // Far wing a touch smaller and lighter reads as depth.
  ctx.globalAlpha = 0.82;
  ctx.save();
  ctx.scale(0.9, 0.92);
  wing(1, lift * 0.9);
  ctx.restore();
  ctx.globalAlpha = 1;

  // Body, neck and head (with a swept-back horn), tail.
  ctx.beginPath();
  ctx.moveTo(-s * 0.8, -s * 0.105);
  ctx.lineTo(-s * 0.7, -s * 0.14);
  ctx.lineTo(-s * 0.6, -s * 0.2);
  ctx.lineTo(-s * 0.62, -s * 0.14);
  ctx.quadraticCurveTo(-s * 0.56, -s * 0.13, -s * 0.5, -s * 0.1);
  ctx.quadraticCurveTo(-s * 0.36, -s * 0.07, -s * 0.2, -s * 0.05);
  ctx.quadraticCurveTo(0, -s * 0.07, s * 0.2, -s * 0.03);
  ctx.quadraticCurveTo(s * 0.5, s * 0.01, s * 0.72, s * 0.07);
  ctx.quadraticCurveTo(s * 0.9, s * 0.11, s * 1.02, s * 0.06);
  ctx.lineTo(s * 1.1, s * 0.03);
  ctx.lineTo(s * 1.09, s * 0.1);
  ctx.lineTo(s * 1.02, s * 0.09);
  ctx.quadraticCurveTo(s * 0.88, s * 0.14, s * 0.7, s * 0.1);
  ctx.quadraticCurveTo(s * 0.46, s * 0.05, s * 0.18, s * 0.04);
  ctx.quadraticCurveTo(-s * 0.05, s * 0.04, -s * 0.22, s * 0.0);
  ctx.quadraticCurveTo(-s * 0.38, -s * 0.03, -s * 0.54, -s * 0.06);
  ctx.quadraticCurveTo(-s * 0.66, -s * 0.07, -s * 0.8, -s * 0.085);
  ctx.closePath();
  ctx.fill();

  wing(-1, lift);
  ctx.restore();
}
