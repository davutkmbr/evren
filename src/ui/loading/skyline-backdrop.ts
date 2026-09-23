/**
 * Animated loading backdrop: the static panorama (sky, silhouettes, water with rippled reflections) is baked
 * once per resize into an offscreen canvas; each frame (≈30 fps) only composites it and draws a few hundred
 * tiny dynamic marks (stars, glitter on the water, windows, gulls, a gliding dragon).
 */
import { createRng } from '../../core/math/noise';
import { prefersReducedMotion } from '../dom';
import { createStars, drawDragon, drawGull, paintSky, paintSkyline, type Light, type SkylineLayout } from './skyline-painter';

interface Glint {
  x: number;
  y: number;
  len: number;
  phase: number;
  speed: number;
}

const FRAME_INTERVAL = 1000 / 30;

export class SkylineBackdrop {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private layout: SkylineLayout = { width: 1, height: 1, horizon: 1, sunX: 1 };
  private stars: Light[] = [];
  private windows: Light[] = [];
  private glints: Glint[] = [];
  private raf = 0;
  private lastDraw = 0;
  private startTime = performance.now();
  private readonly reducedMotion = prefersReducedMotion();
  private dpr = 1;
  private readonly onResize = (): void => this.rebuild();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ld-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    window.addEventListener('resize', this.onResize);
  }

  start(): void {
    this.rebuild();
    if (this.reducedMotion) {
      return;
    }
    const loop = (now: number): void => {
      this.raf = requestAnimationFrame(loop);
      if (now - this.lastDraw < FRAME_INTERVAL) {
        return;
      }
      this.lastDraw = now;
      this.draw(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.base = null;
    this.canvas.width = 1;
    this.canvas.height = 1;
  }

  private rebuild(): void {
    const cssW = Math.max(320, window.innerWidth);
    const cssH = Math.max(240, window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.round(cssW * this.dpr);
    const h = Math.round(cssH * this.dpr);
    this.canvas.width = w;
    this.canvas.height = h;
    this.layout = { width: w, height: h, horizon: Math.round(h * 0.665), sunX: w * 0.615 };
    this.stars = createStars(this.layout, Math.round(160 * (w / 1600)));
    this.windows = [];
    this.base = this.bake();
    this.glints = this.createGlints();
    this.draw(performance.now());
  }

  private bake(): HTMLCanvasElement {
    const { width: w, height: h, horizon } = this.layout;
    const base = document.createElement('canvas');
    base.width = w;
    base.height = h;
    const ctx = base.getContext('2d')!;
    paintSky(ctx, this.layout);

    const city = document.createElement('canvas');
    city.width = w;
    city.height = h;
    const cityCtx = city.getContext('2d')!;
    paintSkyline(cityCtx, this.layout, this.windows);

    const water = ctx.createLinearGradient(0, horizon, 0, h);
    water.addColorStop(0, '#5a3446');
    water.addColorStop(0.1, '#2c1f36');
    water.addColorStop(0.45, '#111325');
    water.addColorStop(1, '#05070f');
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon, w, h - horizon);

    const column = ctx.createRadialGradient(this.layout.sunX, horizon, 0, this.layout.sunX, horizon, h * 0.4);
    column.addColorStop(0, 'rgba(255, 190, 130, 0.5)');
    column.addColorStop(0.4, 'rgba(230, 130, 100, 0.14)');
    column.addColorStop(1, 'rgba(120, 60, 90, 0)');
    ctx.save();
    ctx.translate(this.layout.sunX, horizon);
    ctx.scale(0.45, 1);
    ctx.translate(-this.layout.sunX, -horizon);
    ctx.fillStyle = column;
    ctx.fillRect(0, horizon, w * 3, h - horizon);
    ctx.restore();

    const rng = createRng(77);
    const band = Math.max(2, Math.round(h * 0.004));
    ctx.save();
    for (let y = 0; y < h - horizon; y += band) {
      const depth = y / (h - horizon);
      const wobble = Math.sin(y * 0.09 + rng() * 2.5) * (1.5 + depth * 9) * this.dpr + (rng() - 0.5) * 2 * this.dpr;
      ctx.globalAlpha = 0.5 * (1 - depth * 0.7);
      ctx.drawImage(city, 0, horizon - y - band, w, band, wobble, horizon + y, w, band);
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const light of this.windows) {
      const len = (horizon - light.y) * 0.9 + h * 0.01;
      const grad = ctx.createLinearGradient(0, horizon + (horizon - light.y) * 0.85, 0, horizon + (horizon - light.y) * 0.85 + len * 0.5);
      grad.addColorStop(0, 'rgba(255, 190, 120, 0.12)');
      grad.addColorStop(1, 'rgba(255, 190, 120, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(light.x - light.size * 0.5, horizon + (horizon - light.y) * 0.85, light.size, len * 0.5);
    }
    ctx.restore();

    ctx.drawImage(city, 0, 0);

    const haze = ctx.createLinearGradient(0, horizon - h * 0.05, 0, horizon + h * 0.012);
    haze.addColorStop(0, 'rgba(230, 140, 110, 0)');
    haze.addColorStop(0.8, 'rgba(230, 140, 110, 0.07)');
    haze.addColorStop(1, 'rgba(230, 140, 110, 0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon - h * 0.05, w, h * 0.062);

    const vignette = ctx.createRadialGradient(w * 0.5, h * 0.55, h * 0.3, w * 0.5, h * 0.55, w * 0.75);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
    return base;
  }

  private createGlints(): Glint[] {
    const { width: w, height: h, horizon, sunX } = this.layout;
    const rng = createRng(5);
    const glints: Glint[] = [];
    for (let i = 0; i < 90; i++) {
      const depth = Math.pow(rng(), 1.5);
      const y = horizon + 3 + depth * (h - horizon) * 0.45;
      const spread = w * (0.02 + depth * 0.12);
      glints.push({
        x: sunX + (rng() - 0.5) * 2 * spread * (0.3 + rng()),
        y,
        len: w * (0.004 + depth * 0.018) * (0.5 + rng()),
        phase: rng() * Math.PI * 2,
        speed: 0.8 + rng() * 2.2,
      });
    }
    return glints;
  }

  private draw(now: number): void {
    if (!this.base) {
      return;
    }
    const ctx = this.ctx;
    const { width: w, height: h, horizon, sunX } = this.layout;
    const t = this.reducedMotion ? 12 : (now - this.startTime) / 1000;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.base, 0, 0);

    ctx.fillStyle = '#fff';
    for (const star of this.stars) {
      const tw = 0.55 + 0.45 * Math.sin(t * (0.6 + star.warmth) + star.phase);
      ctx.globalAlpha = (0.25 + 0.6 * tw) * (1 - star.y / (horizon * 0.7));
      const size = star.size * this.dpr;
      ctx.fillRect(star.x, star.y, size, size);
    }

    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffc98f';
    for (const g of this.glints) {
      const a = Math.max(0, Math.sin(t * g.speed + g.phase));
      if (a < 0.2) {
        continue;
      }
      const falloff = 1 - Math.min(1, Math.abs(g.x - sunX) / (w * 0.16));
      ctx.globalAlpha = a * a * 0.55 * (0.35 + falloff * 0.65) * (1 - Math.min(1, (g.y - horizon) / ((h - horizon) * 0.5)) * 0.6);
      const drift = Math.sin(t * 0.5 + g.phase) * 3 * this.dpr;
      ctx.fillRect(g.x - g.len / 2 + drift, g.y, g.len, Math.max(1, this.dpr));
    }

    ctx.fillStyle = '#ffb870';
    for (let i = 0; i < this.windows.length; i++) {
      const light = this.windows[i];
      const flicker = 0.75 + 0.25 * Math.sin(t * 0.7 + light.phase * 3);
      ctx.globalAlpha = (0.35 + light.warmth * 0.5) * flicker;
      ctx.fillRect(light.x, light.y, light.size * 1.2, light.size);
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(14, 11, 20, 0.85)';
    ctx.lineWidth = Math.max(1, 1.1 * this.dpr);
    for (let i = 0; i < 6; i++) {
      const cycle = (t * (0.012 + i * 0.002) + i * 0.17) % 1;
      const gx = w * (1.05 - cycle * 1.2);
      const gy = h * (0.46 + i * 0.022) + Math.sin(t * 0.7 + i) * h * 0.006;
      drawGull(ctx, gx, gy, w * 0.0045, 0.5 + 0.5 * Math.sin(t * 7 + i * 1.7));
    }

    const cross = 46;
    const phase = ((t + 14) % cross) / cross;
    const dx = w * (1.12 - phase * 1.3);
    const dy = h * (0.395 + 0.025 * Math.sin(phase * Math.PI * 1.4)) + Math.sin(t * 0.9) * h * 0.004;
    const burst = Math.max(0, Math.sin(t * 0.45));
    const flap = 0.25 + burst * Math.sin(t * 2.6) * 0.75;
    ctx.fillStyle = 'rgba(11, 9, 17, 0.94)';
    drawDragon(ctx, dx, dy, w * 0.027, flap);
  }
}
