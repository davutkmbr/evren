/**
 * Silhouette sheet of the ferry gull moment, headless (CPU raster, no GPU): the moment gull (the ambient bird with its
 * yellow bill) in the glide and flap poses of the bird shader from several views, the simit piece, and a plan / side
 * plot of the flock behind a vapur from the simulation.
 *
 *   npx tsx tools/headless/moments-gulls-sheet.ts
 *
 * Output: .shots/moments/gulls/gull-simit-sheet.png and flock-plot.png (not committed).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as THREE from 'three';
import { buildGullGeometry, buildSimitPieceGeometry } from '../../src/moments/gull-simit/geometry';
import { GullFlock, GullState, PieceState, type FerryFrame } from '../../src/moments/gull-simit/flock';
import { encodePng } from './pose/sheet';

const OUT = resolve('.shots/moments/gulls');
mkdirSync(OUT, { recursive: true });

type RGB = [number, number, number];
const BG: RGB = [236, 238, 240];

class Canvas {
  readonly rgba: Uint8ClampedArray;
  readonly depth: Float32Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.rgba = new Uint8ClampedArray(w * h * 4);
    this.depth = new Float32Array(w * h).fill(Infinity);
    for (let i = 0; i < w * h; i++) this.rgba.set([...BG, 255], i * 4);
  }
  px(x: number, y: number, c: RGB): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.rgba.set([c[0], c[1], c[2], 255], (y * this.w + x) * 4);
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.h, y1); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.w, x1); x++) this.px(x, y, c);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
    for (let i = 0; i <= n; i++) this.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  }
  disc(x: number, y: number, r: number, c: RGB): void {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) this.px(x + dx, y + dy, c);
  }
  /** z-buffered flat triangle (screen x, y, depth). */
  tri(a: number[], b: number[], c: number[], col: RGB, ox: number, oy: number, cw: number, ch: number): void {
    const minX = Math.max(ox, Math.floor(Math.min(a[0], b[0], c[0])));
    const maxX = Math.min(ox + cw - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(oy, Math.floor(Math.min(a[1], b[1], c[1])));
    const maxY = Math.min(oy + ch - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) return;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
        const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
        const i = y * this.w + x;
        if (z >= this.depth[i]) continue;
        this.depth[i] = z;
        this.rgba.set([col[0], col[1], col[2], 255], i * 4);
      }
    }
  }
}

/** The bird shader's wing fold (src/world/life/birds/bird-material.ts) on the CPU. */
function foldGull(g: THREE.BufferGeometry, amp: number, phase: number): Float32Array {
  const pos = g.getAttribute('position').array as Float32Array;
  const wing = g.getAttribute('aWing').array as Float32Array;
  const out = new Float32Array(pos.length);
  const th1 = (0.1 + (0.05 - 0.1) * amp) + amp * 0.8 * Math.sin(phase);
  const th2 = (-0.24 + 0.24 * amp) + amp * 0.55 * Math.sin(phase - 0.9);
  for (let i = 0; i < pos.length / 3; i++) {
    let x = pos[i * 3];
    let y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const side = wing[i * 4];
    const span = wing[i * 4 + 1];
    const seg = wing[i * 4 + 2];
    if (seg > 0.5) {
      const rw = 0.28;
      const r1 = Math.min(span, rw);
      let wx = 0.05 + r1 * Math.cos(th1);
      let wy = r1 * Math.sin(th1);
      if (seg > 1.5) {
        const r2 = span - rw;
        wx += r2 * Math.cos(th1 + th2);
        wy += r2 * Math.sin(th1 + th2);
      }
      x = side * wx;
      y = y + wy;
    }
    y -= 0.025 * amp * Math.sin(phase + 1.3);
    out.set([x, y, z], i * 3);
  }
  return out;
}

/** The gull plumage of the bird shader by region and facing. */
function gullColour(region: number, span: number, top: boolean): RGB {
  const white: RGB = [199, 201, 204];
  const mantle: RGB = [77, 84, 94];
  let c: RGB = white;
  if (region > 1.5 && region < 3.5 && top) c = mantle;
  if (region > 2.5 && region < 4.5) {
    const k = Math.min(1, Math.max(0, (span - 0.42) / 0.08));
    const t = k * (top ? 1 : 0.85);
    c = [c[0] * (1 - t) + 5 * t, c[1] * (1 - t) + 5 * t, c[2] * (1 - t) + 5 * t];
  }
  if (region > 4.5) c = span > 0.5 ? [158, 20, 13] : [219, 168, 31];
  return c;
}

interface View {
  name: string;
  /** Camera direction (from the camera toward the model) and up. */
  dir: THREE.Vector3;
  up: THREE.Vector3;
}

const VIEWS: View[] = [
  { name: 'top', dir: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, -1) },
  { name: 'side', dir: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
  { name: 'front (from slightly above)', dir: new THREE.Vector3(0, -0.35, 1).normalize(), up: new THREE.Vector3(0, 1, 0) },
  { name: 'three-quarter', dir: new THREE.Vector3(-0.6, -0.45, 0.65).normalize(), up: new THREE.Vector3(0, 1, 0) },
  { name: 'from below', dir: new THREE.Vector3(0.2, 1, 0.3).normalize(), up: new THREE.Vector3(0, 0, -1) },
];
const LIGHT = new THREE.Vector3(0.3, 1, 0.4).normalize();

function drawMesh(cv: Canvas, pos: Float32Array, index: ArrayLike<number>, colourOf: (tri: number[], top: boolean) => RGB, view: View, scale: number, ox: number, oy: number, cw: number, ch: number): void {
  const d = view.dir.clone().normalize();
  const right = new THREE.Vector3().crossVectors(d, view.up).normalize();
  const up = new THREE.Vector3().crossVectors(right, d).normalize();
  const cx = ox + cw / 2;
  const cy = oy + ch / 2;
  const project = (i: number): number[] => {
    const p = new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    return [cx + p.dot(right) * scale, cy - p.dot(up) * scale, p.dot(d)];
  };
  for (let t = 0; t < index.length; t += 3) {
    const ia = index[t];
    const ib = index[t + 1];
    const ic = index[t + 2];
    const a = new THREE.Vector3(pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2]);
    const b = new THREE.Vector3(pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2]);
    const c = new THREE.Vector3(pos[ic * 3], pos[ic * 3 + 1], pos[ic * 3 + 2]);
    const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    // Front facing toward the camera (the shader's gl_FrontFacing for the top of the wings).
    const facing = n.dot(d) < 0;
    const col = colourOf([ia, ib, ic], facing);
    const nn = facing ? n : n.clone().negate();
    const shade = 0.45 + 0.55 * Math.max(0, nn.dot(LIGHT));
    cv.tri(project(ia), project(ib), project(ic), [col[0] * shade, col[1] * shade, col[2] * shade], ox, oy, cw, ch);
  }
}

/* ---------------------------------------------------------------- */
/* Sheet 1: gull poses and the simit piece                           */
/* ---------------------------------------------------------------- */
{
  const gull = buildGullGeometry();
  const wing = gull.getAttribute('aWing').array as Float32Array;
  const index = gull.getIndex()!.array as ArrayLike<number>;
  const poses: Array<[string, number, number]> = [
    ['glide (hanging in the slipstream)', 0, 0],
    ['wing adjustment (amp 0.3)', 0.3, Math.PI / 2],
    ['flap up (amp 1)', 1, Math.PI / 2],
    ['flap down (amp 1)', 1, -Math.PI / 2],
  ];
  const CW = 260;
  const CH = 200;
  const cols = VIEWS.length;
  const rows = poses.length + 1;
  const cv = new Canvas(CW * cols, CH * rows);
  poses.forEach(([, amp, phase], r) => {
    const pos = foldGull(gull, amp, phase);
    VIEWS.forEach((v, c) => {
      const ox = c * CW;
      const oy = r * CH;
      cv.rect(ox, oy, ox + CW - 2, oy + CH - 2, r % 2 ? [228, 231, 234] : BG);
      drawMesh(cv, pos, index, (tri, top) => {
        const reg = Math.max(...tri.map((i) => wing[i * 4 + 3]));
        const span = tri.reduce((s, i) => s + wing[i * 4 + 1], 0) / 3;
        return gullColour(reg, span, top);
      }, v, 170, ox, oy, CW - 2, CH - 2);
    });
  });
  // Last row: the simit piece (drawn 1.5x of a real ~14 cm ring) from three views, a close-up of the bill, and scale.
  const simit = buildSimitPieceGeometry();
  const spos = simit.getAttribute('position').array as Float32Array;
  const scol = simit.getAttribute('color').array as Float32Array;
  const sidx = simit.getIndex()!.array as ArrayLike<number>;
  const simitColour = (tri: number[]): RGB => {
    const c = [0, 1, 2].map((k) => (tri.reduce((s, i) => s + scol[i * 3 + k], 0) / 3) * 255);
    return [c[0], c[1], c[2]];
  };
  const r = poses.length;
  [VIEWS[0], VIEWS[3], VIEWS[1]].forEach((v, c) => {
    const ox = c * CW;
    const oy = r * CH;
    cv.rect(ox, oy, ox + CW - 2, oy + CH - 2, [226, 222, 214]);
    drawMesh(cv, spos, sidx, simitColour, v, 1300, ox, oy, CW - 2, CH - 2);
  });
  {
    // Bill close-up (side view, 4x).
    const ox = 3 * CW;
    const oy = r * CH;
    cv.rect(ox, oy, ox + CW - 2, oy + CH - 2, BG);
    const pos = foldGull(gull, 0, 0);
    const shifted = new Float32Array(pos);
    for (let i = 0; i < shifted.length; i += 3) shifted[i + 2] += 0.27;
    drawMesh(cv, shifted, index, (tri, top) => gullColour(Math.max(...tri.map((i) => wing[i * 4 + 3])), tri.reduce((s, i) => s + wing[i * 4 + 1], 0) / 3, top), VIEWS[1], 900, ox, oy, CW - 2, CH - 2);
  }
  {
    // Gull and simit piece at the same scale (top view).
    const ox = 4 * CW;
    const oy = r * CH;
    cv.rect(ox, oy, ox + CW - 2, oy + CH - 2, BG);
    drawMesh(cv, foldGull(gull, 0, 0), index, (tri, top) => gullColour(Math.max(...tri.map((i) => wing[i * 4 + 3])), tri.reduce((s, i) => s + wing[i * 4 + 1], 0) / 3, top), VIEWS[0], 170, ox - 40, oy, CW - 2, CH - 2);
    const moved = new Float32Array(spos);
    for (let i = 0; i < moved.length; i += 3) moved[i] += 0.62;
    drawMesh(cv, moved, sidx, simitColour, VIEWS[0], 170, ox - 40, oy, CW + 38, CH - 2);
  }
  const file = join(OUT, 'gull-simit-sheet.png');
  writeFileSync(file, encodePng(cv.w, cv.h, cv.rgba));
  console.log(`wrote ${file} (rows: ${poses.map((p) => p[0]).join(' | ')} | simit top, 3/4, side, bill close-up, gull + simit to scale; columns: ${VIEWS.map((v) => v.name).join(', ')})`);
}

/* ---------------------------------------------------------------- */
/* Sheet 2: the flock behind a vapur (plan and side), from the sim    */
/* ---------------------------------------------------------------- */
{
  const ferry: FerryFrame = { x: 0, z: 0, yaw: 0, heave: 0, speed: 7.2, length: 72, beam: 13.2, draft: 3.1, airDraft: 19.7 };
  const flock = new GullFlock(3);
  flock.start(ferry, 'vapur', 30, null, 0, { x: 150, y: 20, z: 60 });
  const W = 900;
  const H = 520;
  const cv = new Canvas(W, H * 3);
  const times = [20, 33, 47];
  let t = 0;
  times.forEach((until, row) => {
    while (t < until) {
      t += 1 / 24;
      ferry.x += 0;
      ferry.z -= ferry.speed / 24;
      flock.update(1 / 24, ferry, null);
    }
    const oy = row * H;
    // Plan (left): ship frame, stern up; side (right).
    const s = 7;
    const planCx = 230;
    const planCy = oy + 80;
    const sideX0 = 480;
    const sideY0 = oy + 420;
    const toPlan = (x: number, z: number): [number, number] => [planCx + (x - ferry.x) * s, planCy + (z - ferry.z - ferry.length / 2) * s];
    cv.rect(0, oy, W, oy + H - 3, row % 2 ? [228, 231, 234] : BG);
    // Hull outline (plan) and box (side).
    const [hx0, hy0] = toPlan(-ferry.beam / 2, ferry.z - ferry.length / 2);
    const [hx1, hy1] = toPlan(ferry.beam / 2, ferry.z + ferry.length / 2);
    cv.rect(Math.min(hx0, hx1), Math.max(oy, Math.min(hy0, hy1)), Math.max(hx0, hx1), Math.max(hy0, hy1), [150, 150, 150]);
    const toSide = (z: number, y: number): [number, number] => [sideX0 + (z - (ferry.z + ferry.length / 2)) * 9 + 20, sideY0 - y * 9];
    const [sx0, sy0] = toSide(ferry.z + ferry.length / 2 - 12, ferry.airDraft);
    const [sx1] = toSide(ferry.z + ferry.length / 2, 0);
    cv.rect(sx0 - 200, sy0, sx1, sideY0, [150, 150, 150]);
    cv.line(sideX0 - 200, sideY0, W - 10, sideY0, [90, 120, 150]);
    for (let i = 0; i < flock.count; i++) {
      if (flock.state[i] === GullState.Gone) continue;
      const col: RGB = flock.state[i] === GullState.Chase ? [200, 60, 30] : flock.state[i] === GullState.Water || flock.state[i] === GullState.Pick ? [30, 110, 200] : [30, 30, 36];
      const [px, py] = toPlan(flock.px[i], flock.pz[i]);
      // Wingspan to scale (1.35 m) across the heading.
      const hx = Math.cos(flock.yaw[i]) * 0.675 * s;
      const hz = -Math.sin(flock.yaw[i]) * 0.675 * s;
      cv.line(px - hx, py + hz, px + hx, py - hz, col);
      cv.disc(px, py, 1, col);
      const [qx, qy] = toSide(flock.pz[i], flock.py[i]);
      cv.line(qx - 3, qy, qx + 3, qy, col);
      cv.disc(qx, qy, 1, col);
    }
    for (let q = 0; q < flock.qState.length; q++) {
      if (flock.qState[q] === PieceState.Free) continue;
      const [px, py] = toPlan(flock.qx[q], flock.qz[q]);
      cv.disc(px, py, 2, [170, 100, 30]);
      const [qx, qy] = toSide(flock.qz[q], flock.qy[q]);
      cv.disc(qx, qy, 2, [170, 100, 30]);
    }
  });
  const file = join(OUT, 'flock-plot.png');
  writeFileSync(file, encodePng(cv.w, cv.h, cv.rgba));
  console.log(`wrote ${file} (t = ${times.join(', ')} s; plan left, stern at the top edge of the grey hull, 7 px/m; side right, 9 px/m; black hovering, red chasing, blue at the water, brown simit)`);
}
