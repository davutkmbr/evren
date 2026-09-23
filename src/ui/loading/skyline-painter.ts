/**
 * Procedural dusk panorama of the historic peninsula seen from Üsküdar across the Bosphorus mouth:
 * Kız Kulesi in the foreground, Sultanahmet, Ayasofya and Topkapı on the first ridge, Süleymaniye and
 * Galata behind. Everything is drawn with canvas 2D paths; no images.
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

interface MinaretSpec {
  dx: number;
  height: number;
  balconies: number;
}

interface MosqueSpec {
  x: number;
  ground: number;
  scale: number;
  domeFlatness?: number;
  semiDomes?: boolean;
  bodyWidth?: number;
  minarets: MinaretSpec[];
  buttresses?: boolean;
}

const NEAR_INK = '#0b0911';
const FAR_INK = 'rgba(38, 27, 44, 0.92)';
const MID_INK = '#15101b';

/** Ridge profile: returns the ground height (px above horizon) for a normalized x. */
type Profile = (t: number) => number;

function bump(t: number, center: number, width: number, height: number): number {
  const d = (t - center) / width;
  return height * Math.exp(-d * d);
}

export function paintSky(ctx: CanvasRenderingContext2D, layout: SkylineLayout): void {
  const { width: w, height: h, horizon } = layout;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#060917');
  sky.addColorStop(0.32, '#121634');
  sky.addColorStop(0.58, '#2f2446');
  sky.addColorStop(0.78, '#6e3b4c');
  sky.addColorStop(0.9, '#b8604a');
  sky.addColorStop(0.97, '#e39458');
  sky.addColorStop(1, '#f2b774');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon + 1);

  const glow = ctx.createRadialGradient(layout.sunX, horizon + h * 0.01, 0, layout.sunX, horizon, w * 0.42);
  glow.addColorStop(0, 'rgba(255, 214, 160, 0.85)');
  glow.addColorStop(0.18, 'rgba(255, 170, 110, 0.45)');
  glow.addColorStop(0.5, 'rgba(210, 110, 90, 0.14)');
  glow.addColorStop(1, 'rgba(120, 60, 90, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, horizon + 1);

  const rng = createRng(1453);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const y = horizon * (0.55 + rng() * 0.36);
    const x = w * (rng() * 1.1 - 0.05);
    const len = w * (0.18 + rng() * 0.3);
    const thick = h * (0.004 + rng() * 0.01);
    const near = 1 - Math.min(1, Math.abs(x - layout.sunX) / (w * 0.6));
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(len / thick, 1);
    const band = ctx.createRadialGradient(0, 0, 0, 0, 0, thick);
    band.addColorStop(0, `rgba(255, 160, 120, ${0.05 + near * 0.1})`);
    band.addColorStop(1, 'rgba(255, 160, 120, 0)');
    ctx.fillStyle = band;
    ctx.beginPath();
    ctx.arc(0, 0, thick, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

export function createStars(layout: SkylineLayout, count: number): Light[] {
  const rng = createRng(29);
  const stars: Light[] = [];
  for (let i = 0; i < count; i++) {
    const y = Math.pow(rng(), 1.6) * layout.horizon * 0.62;
    stars.push({ x: rng() * layout.width, y, size: 0.4 + Math.pow(rng(), 3) * 1.3, phase: rng() * Math.PI * 2, warmth: rng() });
  }
  return stars;
}

function fillProfile(ctx: CanvasRenderingContext2D, layout: SkylineLayout, from: number, to: number, profile: Profile, baseY: number): void {
  const { width: w } = layout;
  const steps = Math.max(8, Math.round((to - from) * 160));
  ctx.beginPath();
  ctx.moveTo(from * w, baseY);
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    ctx.lineTo(t * w, layout.horizon - profile(t));
  }
  ctx.lineTo(to * w, baseY);
  ctx.closePath();
  ctx.fill();
}

function drawMinaret(ctx: CanvasRenderingContext2D, x: number, ground: number, s: number, spec: MinaretSpec): void {
  const shaftW = Math.max(1.2, s * 0.1);
  const top = ground - spec.height * s;
  ctx.fillRect(x - shaftW / 2, top, shaftW, ground - top);
  const base = shaftW * 1.35;
  ctx.fillRect(x - base / 2, ground - s * 0.9, base, s * 0.9);
  for (let b = 0; b < spec.balconies; b++) {
    const y = top + s * (0.28 + b * 0.62);
    const bw = shaftW * 2.3;
    ctx.fillRect(x - bw / 2, y, bw, Math.max(1, s * 0.055));
    ctx.beginPath();
    ctx.moveTo(x - bw / 2, y + s * 0.055);
    ctx.lineTo(x + bw / 2, y + s * 0.055);
    ctx.lineTo(x + shaftW / 2, y + s * 0.2);
    ctx.lineTo(x - shaftW / 2, y + s * 0.2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(x - shaftW * 0.62, top);
  ctx.lineTo(x, top - s * 0.72);
  ctx.lineTo(x + shaftW * 0.62, top);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x - 0.4, top - s * 0.95, 0.8, s * 0.25);
}

function drawDome(ctx: CanvasRenderingContext2D, x: number, springY: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, springY, rx, ry, 0, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
}

function drawAlem(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillRect(x - 0.5, y - s * 0.32, 1, s * 0.32);
  ctx.beginPath();
  ctx.arc(x, y - s * 0.2, Math.max(0.9, s * 0.045), 0, Math.PI * 2);
  ctx.fill();
}

function drawMosque(ctx: CanvasRenderingContext2D, m: MosqueSpec): void {
  const s = m.scale;
  const x = m.x;
  const g = m.ground;
  const bodyW = (m.bodyWidth ?? 3.3) * s;
  const bodyTop = g - 1.05 * s;
  ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, g - bodyTop + 2);
  if (m.buttresses) {
    ctx.fillRect(x - bodyW * 0.36, bodyTop - s * 0.42, bodyW * 0.14, s * 0.46);
    ctx.fillRect(x + bodyW * 0.22, bodyTop - s * 0.42, bodyW * 0.14, s * 0.46);
  }
  if (m.semiDomes !== false) {
    drawDome(ctx, x - s * 0.95, bodyTop + 1, s * 0.62, s * 0.5);
    drawDome(ctx, x + s * 0.95, bodyTop + 1, s * 0.62, s * 0.5);
    drawDome(ctx, x - bodyW / 2 + s * 0.22, bodyTop + 1, s * 0.22, s * 0.2);
    drawDome(ctx, x + bodyW / 2 - s * 0.22, bodyTop + 1, s * 0.22, s * 0.2);
  }
  const drumTop = bodyTop - s * 0.34;
  ctx.fillRect(x - s * 0.74, drumTop, s * 1.48, s * 0.36);
  const ry = s * 0.78 * (m.domeFlatness ?? 1);
  drawDome(ctx, x, drumTop + 1, s * 0.8, ry);
  drawAlem(ctx, x, drumTop - ry + 1, s);
  for (const minaret of m.minarets) {
    drawMinaret(ctx, x + minaret.dx * s, g, s, minaret);
  }
}

function drawGalataTower(ctx: CanvasRenderingContext2D, x: number, ground: number, s: number): void {
  const bodyW = s * 0.95;
  const top = ground - s * 4.1;
  ctx.fillRect(x - bodyW / 2, top, bodyW, ground - top);
  ctx.fillRect(x - bodyW * 0.62, top - s * 0.12, bodyW * 1.24, s * 0.22);
  ctx.fillRect(x - bodyW * 0.44, top - s * 0.5, bodyW * 0.88, s * 0.4);
  ctx.beginPath();
  ctx.moveTo(x - bodyW * 0.56, top - s * 0.48);
  ctx.lineTo(x, top - s * 1.75);
  ctx.lineTo(x + bodyW * 0.56, top - s * 0.48);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x - 0.5, top - s * 2.05, 1, s * 0.34);
}

function drawMaidensTower(ctx: CanvasRenderingContext2D, x: number, water: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x - s * 3.4, water);
  ctx.quadraticCurveTo(x - s * 2.6, water - s * 0.5, x - s * 1.4, water - s * 0.62);
  ctx.lineTo(x + s * 1.9, water - s * 0.6);
  ctx.quadraticCurveTo(x + s * 2.9, water - s * 0.45, x + s * 3.3, water);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x - s * 1.5, water - s * 1.7, s * 2.9, s * 1.12);
  ctx.beginPath();
  ctx.moveTo(x - s * 1.62, water - s * 1.68);
  ctx.lineTo(x - s * 0.1, water - s * 2.25);
  ctx.lineTo(x + s * 1.52, water - s * 1.68);
  ctx.closePath();
  ctx.fill();
  const tw = s * 0.95;
  const top = water - s * 3.9;
  ctx.fillRect(x + s * 0.2, top, tw, water - top - s * 0.5);
  ctx.fillRect(x + s * 0.08, top - s * 0.1, tw + s * 0.24, s * 0.18);
  ctx.fillRect(x + s * 0.32, top - s * 0.72, tw * 0.75, s * 0.64);
  drawDome(ctx, x + s * 0.2 + tw / 2, top - s * 0.7, tw * 0.42, s * 0.52);
  ctx.fillRect(x + s * 0.2 + tw / 2 - 0.5, top - s * 1.62, 1, s * 0.42);
}

/** Adds a band of small buildings along a ridge; returns window lights inside it. */
function drawFabric(
  ctx: CanvasRenderingContext2D,
  layout: SkylineLayout,
  from: number,
  to: number,
  profile: Profile,
  seed: number,
  heightScale: number,
  lights: Light[],
  lightChance: number,
): void {
  const { width: w, height: h, horizon } = layout;
  const rng = createRng(seed);
  let t = from;
  while (t < to) {
    const bw = w * (0.004 + rng() * 0.009);
    const bh = h * (0.006 + Math.pow(rng(), 2) * 0.018) * heightScale;
    const gx = t * w;
    const gy = horizon - profile(t + bw / w / 2) + h * 0.004;
    ctx.fillRect(gx, gy - bh, bw + 0.6, bh + h * 0.02);
    if (rng() < 0.35) {
      ctx.beginPath();
      ctx.moveTo(gx - 0.5, gy - bh);
      ctx.lineTo(gx + bw / 2, gy - bh - bh * 0.28);
      ctx.lineTo(gx + bw + 0.8, gy - bh);
      ctx.closePath();
      ctx.fill();
    }
    const rows = Math.max(1, Math.floor(bh / (h * 0.0055)));
    for (let r = 0; r < rows; r++) {
      if (rng() < lightChance) {
        lights.push({
          x: gx + bw * (0.2 + rng() * 0.6),
          y: gy - bh + (r + 0.5) * (bh / rows),
          size: Math.max(1, h * 0.0016),
          phase: rng() * Math.PI * 2,
          warmth: rng(),
        });
      }
    }
    t += bw / w + rng() * 0.0012;
  }
}

function drawTrees(ctx: CanvasRenderingContext2D, layout: SkylineLayout, from: number, to: number, profile: Profile, seed: number): void {
  const { width: w, height: h, horizon } = layout;
  const rng = createRng(seed);
  for (let t = from; t < to; t += 0.003 + rng() * 0.004) {
    const r = h * (0.006 + rng() * 0.008);
    const y = horizon - profile(t) - r * 0.4;
    ctx.beginPath();
    if (rng() < 0.3) {
      ctx.ellipse(t * w, y - r * 1.2, r * 0.45, r * 2.1, 0, 0, Math.PI * 2);
    } else {
      ctx.arc(t * w, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

/** Paints the city silhouettes (far ridge, main ridge, foreground tower) and collects window lights. */
export function paintSkyline(ctx: CanvasRenderingContext2D, layout: SkylineLayout, lights: Light[]): void {
  const { width: w, height: h, horizon } = layout;
  const u = Math.min(w / 1600, h / 900) * 1600;
  const s = (k: number): number => (u / 1600) * k;

  const farProfile: Profile = (t) =>
    h * 0.012 + bump(t, 0.12, 0.16, h * 0.035) + bump(t, 0.67, 0.08, h * 0.06) + bump(t, 0.92, 0.12, h * 0.075) - bump(t, 0.79, 0.025, h * 0.05);
  const nearProfile: Profile = (t) => {
    if (t > 0.64) {
      return 0;
    }
    const shore = Math.min(1, (0.64 - t) / 0.06);
    return (h * 0.012 + bump(t, 0.27, 0.12, h * 0.03) + bump(t, 0.47, 0.09, h * 0.036)) * Math.sqrt(shore);
  };

  ctx.fillStyle = 'rgba(64, 40, 64, 0.55)';
  fillProfile(ctx, layout, 0, 1, (t) => farProfile(t) * 0.55 + h * 0.012, horizon + 2);

  ctx.fillStyle = FAR_INK;
  fillProfile(ctx, layout, 0, 1, farProfile, horizon + 2);
  drawFabric(ctx, layout, 0.0, 0.77, farProfile, 7, 0.8, lights, 0.2);
  drawFabric(ctx, layout, 0.8, 1.0, farProfile, 8, 1.0, lights, 0.26);
  ctx.fillStyle = FAR_INK;
  drawMosque(ctx, {
    x: w * 0.665,
    ground: horizon - farProfile(0.665) + 2,
    scale: s(21),
    minarets: [
      { dx: -2.1, height: 4.4, balconies: 3 },
      { dx: 2.1, height: 4.4, balconies: 3 },
      { dx: -3.3, height: 3.4, balconies: 2 },
      { dx: 3.3, height: 3.4, balconies: 2 },
    ],
  });
  drawMosque(ctx, {
    x: w * 0.12,
    ground: horizon - farProfile(0.12) + 2,
    scale: s(12),
    minarets: [
      { dx: -2, height: 4, balconies: 2 },
      { dx: 2, height: 4, balconies: 2 },
    ],
  });
  drawGalataTower(ctx, w * 0.872, horizon - farProfile(0.872) + 2, s(14));

  ctx.fillStyle = MID_INK;
  drawMosque(ctx, {
    x: w * 0.715,
    ground: horizon + 1,
    scale: s(15),
    minarets: [
      { dx: -2.3, height: 4, balconies: 2 },
      { dx: 2.3, height: 4, balconies: 2 },
    ],
  });
  fillProfile(ctx, layout, 0.64, 0.8, () => h * 0.006, horizon + 2);

  ctx.fillStyle = NEAR_INK;
  fillProfile(ctx, layout, 0, 0.64, nearProfile, horizon + 2);
  drawFabric(ctx, layout, 0.0, 0.2, nearProfile, 11, 1.1, lights, 0.3);
  drawFabric(ctx, layout, 0.2, 0.44, nearProfile, 12, 0.6, lights, 0.22);
  ctx.fillStyle = NEAR_INK;
  drawTrees(ctx, layout, 0.43, 0.62, nearProfile, 13);

  const sultanahmetX = 0.285;
  drawMosque(ctx, {
    x: w * sultanahmetX,
    ground: horizon - nearProfile(sultanahmetX) + 2,
    scale: s(27),
    minarets: [
      { dx: -2.2, height: 4.2, balconies: 3 },
      { dx: 2.2, height: 4.2, balconies: 3 },
      { dx: -3.1, height: 4.0, balconies: 3 },
      { dx: 3.1, height: 4.0, balconies: 3 },
      { dx: -4.6, height: 3.5, balconies: 2 },
      { dx: 4.6, height: 3.5, balconies: 2 },
    ],
  });
  const ayasofyaX = 0.425;
  drawMosque(ctx, {
    x: w * ayasofyaX,
    ground: horizon - nearProfile(ayasofyaX) + 2,
    scale: s(31),
    domeFlatness: 0.62,
    bodyWidth: 3.9,
    buttresses: true,
    minarets: [
      { dx: -2.3, height: 3.3, balconies: 1 },
      { dx: 2.3, height: 3.1, balconies: 1 },
      { dx: -1.9, height: 2.9, balconies: 1 },
      { dx: 1.9, height: 3.0, balconies: 1 },
    ],
  });
  const topkapiX = 0.54;
  const tg = horizon - nearProfile(topkapiX);
  ctx.fillRect(w * topkapiX - s(8), tg - s(68), s(16), s(70));
  ctx.beginPath();
  ctx.moveTo(w * topkapiX - s(11), tg - s(66));
  ctx.lineTo(w * topkapiX, tg - s(102));
  ctx.lineTo(w * topkapiX + s(11), tg - s(66));
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(w * topkapiX - s(46), tg - s(20), s(120), s(24));

  drawMaidensTower(ctx, w * 0.17, horizon + h * 0.095, s(14));
}

/** Tiny gull silhouette (two arcs). */
export function drawGull(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, flap: number): void {
  const lift = size * (0.25 + 0.35 * flap);
  ctx.beginPath();
  ctx.moveTo(x - size, y - lift);
  ctx.quadraticCurveTo(x - size * 0.45, y - lift * 1.25, x, y);
  ctx.quadraticCurveTo(x + size * 0.45, y - lift * 1.25, x + size, y - lift);
  ctx.stroke();
}

/** Dragon silhouette gliding to the left; `flap` in [-1, 1] raises/lowers the wings. */
export function drawDragon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, flap: number): void {
  const s = size;
  ctx.save();
  ctx.translate(x, y);

  ctx.beginPath();
  ctx.moveTo(-s * 1.05, -s * 0.06);
  ctx.quadraticCurveTo(-s * 0.95, -s * 0.12, -s * 0.8, -s * 0.09);
  ctx.quadraticCurveTo(-s * 0.55, -s * 0.05, -s * 0.3, -s * 0.07);
  ctx.quadraticCurveTo(0, -s * 0.12, s * 0.28, -s * 0.03);
  ctx.quadraticCurveTo(s * 0.7, s * 0.06, s * 1.1, s * 0.02);
  ctx.quadraticCurveTo(s * 1.4, -s * 0.02, s * 1.55, -s * 0.12);
  ctx.lineTo(s * 1.64, -s * 0.05);
  ctx.lineTo(s * 1.52, -s * 0.03);
  ctx.quadraticCurveTo(s * 1.36, s * 0.06, s * 1.08, s * 0.06);
  ctx.quadraticCurveTo(s * 0.62, s * 0.11, s * 0.24, s * 0.07);
  ctx.quadraticCurveTo(-s * 0.05, s * 0.07, -s * 0.32, s * 0.02);
  ctx.quadraticCurveTo(-s * 0.6, s * 0.0, -s * 0.82, -s * 0.02);
  ctx.quadraticCurveTo(-s * 0.98, -s * 0.0, -s * 1.05, -s * 0.06);
  ctx.closePath();
  ctx.fill();

  const wing = (reach: number, lift: number, alpha: number): void => {
    const tipX = -s * 0.15 + s * 0.2 * reach;
    const tipY = -s * (0.95 * lift);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(-s * 0.18, -s * 0.06);
    ctx.quadraticCurveTo(-s * 0.35, tipY * 0.55 - s * 0.05, tipX - s * 0.25, tipY);
    ctx.quadraticCurveTo(tipX - s * 0.02, tipY * 0.6, tipX + s * 0.12, tipY * 0.72);
    ctx.quadraticCurveTo(tipX + s * 0.18, tipY * 0.38, tipX + s * 0.4, tipY * 0.46);
    ctx.quadraticCurveTo(tipX + s * 0.38, tipY * 0.16, tipX + s * 0.62, tipY * 0.2);
    ctx.quadraticCurveTo(s * 0.45, -s * 0.02, s * 0.22, -s * 0.04);
    ctx.closePath();
    ctx.fill();
  };
  wing(1, 0.2 + 0.85 * flap, 0.78);
  wing(0.6, 0.35 + 1.05 * flap, 1);
  ctx.globalAlpha = 1;
  ctx.restore();
}
