import { createRng } from '../../../core/math/noise';

/** A wing bone (or the body flank line) in the wing texture plane: x = span (m), y = chord z (m). */
export interface PlaneBone {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Bones of one group (arm, one finger, flank) never stop each other's vessels. */
  group: number;
  /** Arc length from the bone start where vessels may begin (keeps the crowded wrist clear). */
  startClear: number;
}

export interface VeinCanvasOptions {
  width: number;
  height: number;
  /** Plane origin (m) of texel (0, 0) and plane size (m) covered by the texture. */
  originX: number;
  originY: number;
  sizeX: number;
  sizeY: number;
  bones: PlaneBone[];
  seed: number;
}

interface Vessel {
  x: number;
  y: number;
  hx: number;
  hy: number;
  /** Width in meters. */
  width: number;
  depth: number;
  group: number;
}

const STEP = 0.028;
const MIN_WIDTH = 0.003;
const MAX_VESSELS = 2600;
/** Strokes per vessel (the width tapers from run to run). */
const RUNS = 3;

function strokeVessel(
  ctx: CanvasRenderingContext2D,
  pts: number[],
  w0: number,
  w1: number,
  pxPerM: number,
  toPx: (x: number, y: number) => [number, number],
): void {
  const n = pts.length / 2;
  if (n < 2) {
    return;
  }
  for (let r = 0; r < RUNS; r++) {
    const i0 = Math.floor((r * (n - 1)) / RUNS);
    const i1 = Math.floor(((r + 1) * (n - 1)) / RUNS);
    if (i1 <= i0) {
      continue;
    }
    const w = w0 + (w1 - w0) * ((r + 0.5) / RUNS);
    const wPx = w * pxPerM;
    ctx.lineWidth = Math.max(wPx, 0.45);
    ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, 0.3 + wPx * 0.4).toFixed(3)})`;
    ctx.beginPath();
    const [sx, sy] = toPx(pts[i0 * 2], pts[i0 * 2 + 1]);
    ctx.moveTo(sx, sy);
    for (let i = i0 + 1; i <= i1; i++) {
      const [px, py] = toPx(pts[i * 2], pts[i * 2 + 1]);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

function segDistance(px: number, py: number, b: PlaneBone): number {
  const dx = b.bx - b.ax;
  const dy = b.by - b.ay;
  const len2 = dx * dx + dy * dy;
  const t = Math.min(Math.max(((px - b.ax) * dx + (py - b.ay) * dy) / len2, 0), 1);
  const ex = px - (b.ax + dx * t);
  const ey = py - (b.ay + dy * t);
  return Math.sqrt(ex * ex + ey * ey);
}

/**
 * Branching blood-vessel tree of a wing membrane, rasterised (anti-aliased) into a canvas: vessels leave the bones
 * at a steep angle, wander, bend toward the trailing edge and split dichotomously into ever finer capillaries until
 * they reach a neighbouring bone. Canvas row 0 = texture v 0 (upload with flipY = false).
 */
export function drawVeinCanvas(opts: VeinCanvasOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, opts.width, opts.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pxPerM = opts.width / opts.sizeX;
  const toPx = (x: number, y: number): [number, number] => [(x - opts.originX) * pxPerM, ((y - opts.originY) / opts.sizeY) * opts.height];
  const rng = createRng(opts.seed);
  const stack: Vessel[] = [];

  for (const bone of opts.bones) {
    const dx = bone.bx - bone.ax;
    const dy = bone.by - bone.ay;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    for (const side of [1, -1]) {
      const nx = -uy * side;
      const ny = ux * side;
      // The trailing side (toward +chord) carries the large membrane panels.
      const trailing = ny > 0 ? 1 : 0.5;
      let s = bone.startClear + rng() * 0.3;
      while (s < len - 0.1) {
        const lean = (rng() - 0.35) * 0.9;
        const hx = nx * Math.cos(lean) + ux * Math.sin(lean);
        const hy = ny * Math.cos(lean) + uy * Math.sin(lean);
        stack.push({
          x: bone.ax + ux * s + nx * 0.035,
          y: bone.ay + uy * s + ny * 0.035,
          hx,
          hy,
          width: (0.017 + rng() * 0.014) * (0.6 + 0.4 * trailing),
          depth: 0,
          group: bone.group,
        });
        s += (0.3 + rng() * 0.35) / trailing;
      }
    }
  }

  const pts: number[] = [];
  let budget = MAX_VESSELS;
  while (stack.length > 0) {
    const v = stack.pop()!;
    let { x, y, hx, hy, width } = v;
    let curl = (rng() - 0.5) * 0.08;
    const maxLen = 0.6 + width * 110;
    pts.length = 0;
    pts.push(x, y);
    let length = 0;
    let nextBranch = 0.15 + rng() * 0.4;
    let sinceBranch = 0;
    let alive = true;
    while (alive) {
      curl += (rng() - 0.5) * 0.035;
      curl *= 0.9;
      const c = Math.cos(curl);
      const s = Math.sin(curl);
      // Rotate by the wander angle, then bias gently toward the trailing edge (+y) and the tip (+x).
      let nhx = hx * c - hy * s + 0.004;
      let nhy = hx * s + hy * c + 0.011;
      const hl = Math.hypot(nhx, nhy);
      nhx /= hl;
      nhy /= hl;
      hx = nhx;
      hy = nhy;
      x += hx * STEP;
      y += hy * STEP;
      length += STEP;
      sinceBranch += STEP;
      width *= 0.992;
      pts.push(x, y);
      if (x < opts.originX || x > opts.originX + opts.sizeX || y < opts.originY || y > opts.originY + opts.sizeY) {
        break;
      }
      for (const b of opts.bones) {
        if (b.group !== v.group && segDistance(x, y, b) < 0.05 + width * 2) {
          alive = false;
          break;
        }
      }
      if (length > maxLen || width < MIN_WIDTH) {
        break;
      }
      if (sinceBranch > nextBranch && v.depth < 5 && budget > 0) {
        sinceBranch = 0;
        nextBranch = 0.2 + rng() * 0.45;
        const split = 0.35 + rng() * 0.4;
        const dir = rng() < 0.5 ? 1 : -1;
        const bc = Math.cos(split * dir);
        const bs = Math.sin(split * dir);
        const childWidth = width * (0.45 + rng() * 0.18);
        if (childWidth > MIN_WIDTH) {
          budget--;
          stack.push({ x, y, hx: hx * bc - hy * bs, hy: hx * bs + hy * bc, width: childWidth, depth: v.depth + 1, group: v.group });
        }
        width *= 0.85;
        const pc = Math.cos(-split * 0.35 * dir);
        const ps = Math.sin(-split * 0.35 * dir);
        const tx = hx * pc - hy * ps;
        hy = hx * ps + hy * pc;
        hx = tx;
      }
    }
    strokeVessel(ctx, pts, v.width, width, pxPerM, toPx);
  }
  return canvas;
}
