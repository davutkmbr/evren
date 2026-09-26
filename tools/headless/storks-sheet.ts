/**
 * Pose / silhouette sheet of the procedural white stork (src/moments/storks/stork-model.ts): the exact vertices the
 * game draws, posed with the CPU mirror of the vertex shader and shaded with the plumage of the fragment shader,
 * rasterised on the CPU (no browser, no GPU).
 *
 *   npx tsx tools/headless/storks-sheet.ts
 *
 * Writes .shots/moments/storks/stork-poses.png (views × poses) and stork-lod.png (near vs far LOD). Not committed.
 */
import { mkdirSync } from 'node:fs';
import { buildStorkMesh, deformStorkVertex, REGION, storkColor, storkJoints, type StorkJoints, type StorkMesh, type StorkPose } from '../../src/moments/storks/stork-model';
import { StorkFlockSim } from '../../src/moments/storks/flock-sim';
import { fillStorkInstances, type StorkInstanceStats, type StorkInstanceTarget } from '../../src/moments/storks/stork-instances';
import type { Cell } from './pose/raster';
import { writeSheet, type SheetFrame } from './pose/sheet';

type V3 = [number, number, number];
const OUT = '.shots/moments/storks';

interface View {
  name: string;
  /** Direction the camera looks along (into the screen). */
  dir: V3;
  up: V3;
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const VIEWS: View[] = [
  { name: 'side', dir: [-1, 0, 0], up: [0, 1, 0] },
  { name: 'top', dir: [0, -1, 0], up: [0, 0, -1] },
  { name: 'front', dir: [0, 0, 1], up: [0, 1, 0] },
  { name: 'below (sky view)', dir: norm([0.25, 1, -0.35]), up: [0, 0, -1] },
  { name: 'three-quarter', dir: norm([-0.8, -0.55, 0.7]), up: [0, 1, 0] },
];

const POSES: { name: string; pose: StorkPose }[] = [
  { name: 'soaring (kettle)', pose: { phase: 0, amp: 0, flex: 0, tint: 0.62 } },
  { name: 'gliding (stream)', pose: { phase: 0, amp: 0, flex: 1, tint: 0.62 } },
  { name: 'flap: top of stroke', pose: { phase: Math.PI / 2, amp: 1, flex: 0.3, tint: 0.62 } },
  { name: 'flap: mid downstroke', pose: { phase: Math.PI, amp: 1, flex: 0.3, tint: 0.62 } },
  { name: 'flap: bottom of stroke', pose: { phase: -Math.PI / 2, amp: 1, flex: 0.3, tint: 0.62 } },
  { name: 'juvenile, soaring', pose: { phase: 0, amp: 0, flex: 0, tint: 0.12 } },
];

/** Sun from above-left-front, sky fill from above, a little bounce from below (a bird seen against the sky). */
const SUN = norm([-0.4, 0.8, -0.45]);

function toSrgb(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
}

interface Instance {
  pose: StorkPose;
  /** Column-major instance matrix (identity when omitted). */
  m?: Float32Array;
}

function render(mesh: StorkMesh, pose: StorkPose, view: View, W: number, H: number, scale: number): Cell {
  return renderInstances(mesh, [{ pose }], view, W, H, scale, [0, 0, -0.02]);
}

function renderInstances(mesh: StorkMesh, instances: readonly Instance[], view: View, W: number, H: number, scale: number, center: V3, fovDeg = 0): Cell {
  // fovDeg > 0: a perspective camera at `center` looking along view.dir (scale unused).
  const focal = fovDeg > 0 ? W / 2 / Math.tan((fovDeg * Math.PI) / 360) : 0;
  const ss = 3;
  const w = W * ss;
  const h = H * ss;
  const right = norm(cross(view.dir, view.up));
  const up = cross(right, view.dir);
  const depth = new Float32Array(w * h).fill(Infinity);
  const col = new Float32Array(w * h * 3);
  const n = mesh.vertexCount;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sz = new Float32Array(n);
  const p: number[] = [0, 0, 0];
  const nn: number[] = [0, 0, 0];
  const j: StorkJoints = { th1: 0, th2: 0, sweepArm: 0, sweepHand: 0, spread: 0, curl: 0, bob: 0 };
  for (const inst of instances) {
    const pose = inst.pose;
    storkJoints(pose, 0, j);
    const m = inst.m;
    for (let i = 0; i < n; i++) {
      deformStorkVertex(mesh, i, j, p, nn);
      let v: V3 = [p[0], p[1], p[2]];
      let q: V3 = [nn[0], nn[1], nn[2]];
      if (m) {
        v = [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
        q = norm([m[0] * nn[0] + m[4] * nn[1] + m[8] * nn[2], m[1] * nn[0] + m[5] * nn[1] + m[9] * nn[2], m[2] * nn[0] + m[6] * nn[1] + m[10] * nn[2]]);
      }
      P.set(v, i * 3);
      N.set(q, i * 3);
      const r: V3 = [v[0] - center[0], v[1] - center[1], v[2] - center[2]];
      const zc = dot(r, view.dir);
      const k = focal > 0 ? (zc > 0.5 ? focal / zc : Number.NaN) : scale;
      sx[i] = w / 2 + dot(r, right) * k * ss;
      sy[i] = h / 2 - dot(r, up) * k * ss;
      sz[i] = zc;
    }
    rasterize(mesh, pose, view, sx, sy, sz, N, depth, col, w, h);
  }
  return resolveCell(depth, col, W, H, ss);
}

function rasterize(mesh: StorkMesh, pose: StorkPose, view: View, sx: Float32Array, sy: Float32Array, sz: Float32Array, N: Float32Array, depth: Float32Array, col: Float32Array, w: number, h: number): void {
  const idx = mesh.index;
  const toCam: V3 = [-view.dir[0], -view.dir[1], -view.dir[2]];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    const minX = Math.max(0, Math.floor(Math.min(sx[a], sx[b], sx[c])));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(sx[a], sx[b], sx[c])));
    const minY = Math.max(0, Math.floor(Math.min(sy[a], sy[b], sy[c])));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(sy[a], sy[b], sy[c])));
    const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a]);
    if (Math.abs(area) < 1e-9) continue;
    const region = Math.round(mesh.wing[a * 4 + 2]);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((sx[b] - px) * (sy[c] - py) - (sx[c] - px) * (sy[b] - py)) / area;
        const w1 = ((sx[c] - px) * (sy[a] - py) - (sx[a] - px) * (sy[c] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const d = w0 * sz[a] + w1 * sz[b] + w2 * sz[c];
        const k = y * w + x;
        if (d >= depth[k]) continue;
        depth[k] = d;
        let nrm: V3 = norm([
          w0 * N[a * 3] + w1 * N[b * 3] + w2 * N[c * 3],
          w0 * N[a * 3 + 1] + w1 * N[b * 3 + 1] + w2 * N[c * 3 + 1],
          w0 * N[a * 3 + 2] + w1 * N[b * 3 + 2] + w2 * N[c * 3 + 2],
        ]);
        const isWing = region >= REGION.arm || region === REGION.tail;
        const top = dot(nrm, toCam) >= 0;
        if (isWing && !top) nrm = [-nrm[0], -nrm[1], -nrm[2]];
        const s = w0 * mesh.wing[a * 4 + 1] + w1 * mesh.wing[b * 4 + 1] + w2 * mesh.wing[c * 4 + 1];
        const cc = w0 * mesh.wing[a * 4 + 3] + w1 * mesh.wing[b * 4 + 3] + w2 * mesh.wing[c * 4 + 3];
        const reg = region === REGION.bill || region === REGION.head ? (w0 >= w1 && w0 >= w2 ? region : Math.round(mesh.wing[(w1 > w2 ? b : c) * 4 + 2])) : region;
        const alb = storkColor(reg, s, cc, pose.tint, isWing ? top : true);
        const lam = Math.max(0, dot(nrm, SUN));
        const sky = 0.32 + 0.18 * nrm[1];
        const light = 1.9 * lam + sky;
        col[k * 3] = alb[0] * light * 1.0;
        col[k * 3 + 1] = alb[1] * light * 1.0;
        col[k * 3 + 2] = alb[2] * light * 1.06;
      }
    }
  }
}

/** Downsamples onto a sky-blue backdrop. */
function resolveCell(depth: Float32Array, col: Float32Array, W: number, H: number, ss: number): Cell {
  const w = W * ss;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let bl = 0;
      for (let yy = 0; yy < ss; yy++) {
        for (let xx = 0; xx < ss; xx++) {
          const k = (y * ss + yy) * w + x * ss + xx;
          if (depth[k] === Infinity) {
            const sky = 0.35 + 0.25 * (1 - y / H);
            r += 0.2 * sky;
            g += 0.36 * sky;
            bl += 0.62 * sky;
          } else {
            r += col[k * 3];
            g += col[k * 3 + 1];
            bl += col[k * 3 + 2];
          }
        }
      }
      const q = (y * W + x) * 4;
      rgba[q] = toSrgb(r / (ss * ss));
      rgba[q + 1] = toSrgb(g / (ss * ss));
      rgba[q + 2] = toSrgb(bl / (ss * ss));
      rgba[q + 3] = 255;
    }
  }
  return { width: W, height: H, rgba, lowest: 0 };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const near = buildStorkMesh('near');
  const far = buildStorkMesh('far');
  console.log(`stork mesh: near ${near.triangleCount} triangles / ${near.vertexCount} vertices, far ${far.triangleCount} / ${far.vertexCount}`);
  const frames: SheetFrame[] = [];
  for (const pz of POSES) {
    for (const v of VIEWS) {
      frames.push({ cell: render(near, pz.pose, v, 300, 220, 135), label: pz.name, sublabel: v.name });
    }
  }
  const path = await writeSheet({ title: 'White stork (procedural)', subtitle: 'wingspan 2.0 m · rows: poses · columns: views', columns: VIEWS.length, frames }, `${OUT}/stork-poses`);
  console.log(`wrote ${path}`);
  const lod: SheetFrame[] = [];
  for (const [mesh, name] of [
    [near, 'near LOD'],
    [far, 'far LOD'],
  ] as const) {
    for (const v of [VIEWS[3], VIEWS[4], VIEWS[1]]) {
      lod.push({ cell: render(mesh, POSES[0].pose, v, 300, 220, 135), label: `${name} (${mesh.triangleCount} tris)`, sublabel: v.name });
    }
  }
  // Tiny: how it reads at game distances (~150 m and ~400 m with a 60° FOV at 1080p: ~12 px and ~5 px wingspan).
  for (const px of [40, 14]) {
    lod.push({ cell: render(near, POSES[0].pose, VIEWS[3], 300, 220, px / 2), label: `near at ${px} px span`, sublabel: 'below' });
  }
  const p2 = await writeSheet({ title: 'White stork LODs', subtitle: 'soaring pose', columns: 3, frames: lod }, `${OUT}/stork-lod`);
  console.log(`wrote ${p2}`);

  // The flock: a kettle after 40 s and 110 s (wind 2.5 / 1.5 m/s), seen from the side (south), from above and obliquely.
  const flock: SheetFrame[] = [];
  const sim = new StorkFlockSim({ count: 400, seed: 11, x: 0, z: 0, baseY: 380, topY: 680, courseX: -0.1, courseZ: 1, turn: 1 });
  sim.windX = 2.5;
  sim.windZ = 1.5;
  sim.updraft = 3;
  const target = (): StorkInstanceTarget => ({ matrices: new Float32Array(400 * 16), poses: new Float32Array(400 * 4), capacity: 400, count: 0 });
  const tn = target();
  const tf = target();
  const st: StorkInstanceStats = { near: 0, far: 0, hidden: 0, nearest: 0 };
  for (const [seconds, label] of [
    [40, 'kettle at 40 s'],
    [70, 'kettle + stream at 110 s'],
  ] as const) {
    for (let f = 0; f < seconds * 24; f++) sim.update(1 / 24, null);
    // Camera far away so every bird lands in one target (the far LOD band does not matter for the sheet).
    fillStorkInstances(sim, 0, 0, 0, 1, tn, tf, st);
    const inst: Instance[] = [];
    for (const t of [tn, tf]) {
      for (let k = 0; k < t.count; k++) {
        inst.push({ pose: { phase: t.poses[k * 4], amp: t.poses[k * 4 + 1], flex: t.poses[k * 4 + 2], tint: t.poses[k * 4 + 3] }, m: t.matrices.slice(k * 16, k * 16 + 16) });
      }
    }
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < sim.count; i++) {
      cx += sim.px[i];
      cy += sim.py[i];
      cz += sim.pz[i];
    }
    const c: V3 = [cx / sim.count, cy / sim.count, cz / sim.count];
    const side: View = { name: 'side (from the south)', dir: [0, 0, -1], up: [0, 1, 0] };
    const top: View = { name: 'top', dir: [0, -1, 0], up: [0, 0, -1] };
    const oblique: View = { name: 'oblique, from below', dir: norm([0.3, 0.45, -1]), up: [0, 1, 0] };
    const scale = seconds === 40 ? 1.1 : 0.45;
    flock.push({ cell: renderInstances(near, inst, side, 520, 380, scale, c), label, sublabel: `${side.name}, ${scale} px/m` });
    flock.push({ cell: renderInstances(near, inst, top, 520, 380, scale, c), label, sublabel: `${top.name}, ${scale} px/m` });
    flock.push({ cell: renderInstances(near, inst, oblique, 520, 380, scale * 2.2, c), label, sublabel: `${oblique.name}, ${scale * 2.2} px/m` });
    // Perspective, as the player sees it: from 450 m (the moment's spawn distance) and from inside the kettle's rim.
    for (const [dist, below, fov] of [
      [450, 60, 60],
      [110, 40, 60],
    ] as const) {
      const eye: V3 = [c[0] - dist * 0.6, c[1] - below, c[2] + dist * 0.8];
      const dir = norm([c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]]);
      const persp: View = { name: `player view from ${dist} m`, dir, up: [0, 1, 0] };
      flock.push({ cell: renderInstances(near, inst, persp, 520, 380, 1, eye, fov), label, sublabel: `${persp.name}, ${fov}° FOV` });
    }
    flock.push({ cell: renderInstances(near, inst.slice(0, 1), side, 520, 380, 60, [inst[0].m![12], inst[0].m![13], inst[0].m![14]]), label: 'one bird of the flock', sublabel: 'side, 60 px/m' });
  }
  const p3 = await writeSheet({ title: 'Stork kettle (flock simulation)', subtitle: '400 birds, wind from the north-west', columns: 3, frames: flock }, `${OUT}/stork-kettle`);
  console.log(`wrote ${p3}`);
}

void main();
