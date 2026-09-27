/**
 * Pose sheet of the Aya Yorgi knight statue (src/moments/aya-yorgi): the exact meshes the game draws, posed by the
 * moment's timeline (pose.ts) and rasterised on the CPU (no browser, no GPU).
 *
 *   npx tsx tools/headless/aya-yorgi-sheet.ts
 *
 * Writes .shots/moments/aya-yorgi/statue-poses.png (rows: moments of the timeline, columns: views). Not committed.
 */
import { mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { buildKnightStatue, STATUE_HEIGHT } from '../../src/moments/aya-yorgi/statue-model';
import { knightPose } from '../../src/moments/aya-yorgi/pose';
import type { Cell } from './pose/raster';
import { writeSheet, type SheetFrame } from './pose/sheet';

type V3 = [number, number, number];
const OUT = '.shots/moments/aya-yorgi';
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const SUN = norm([0.5, 0.8, 0.6]);
const VIEWS: { name: string; dir: V3 }[] = [
  { name: 'front', dir: [0, 0, -1] },
  { name: 'side', dir: [-1, 0, 0] },
  { name: 'three-quarter (dragon eye)', dir: norm([-0.6, 0.15, -0.8]) },
];
const MOMENTS: { t: number; name: string }[] = [
  { t: 0, name: 'rest' },
  { t: 3, name: '"Dur orada, ejderha!"' },
  { t: 9.6, name: 'lowering (stall)' },
  { t: 11.8, name: 'shrug' },
  { t: 15, name: 'after (spear droops)' },
];
const toSrgb = (x: number): number => {
  const c = Math.max(0, Math.min(1, x));
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
};

function render(root: THREE.Object3D, viewDir: V3, W: number, H: number): Cell {
  const ss = 3;
  const w = W * ss;
  const h = H * ss;
  const up0: V3 = [0, 1, 0];
  const right = norm(cross(viewDir, up0));
  const up = cross(right, viewDir);
  const center: V3 = [0, STATUE_HEIGHT * 0.58, 0];
  const scale = (H * 0.78) / STATUE_HEIGHT;
  const depth = new Float32Array(w * h).fill(Infinity);
  const col = new Float32Array(w * h * 3);
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const nv = new THREE.Vector3();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = o.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const color = g.getAttribute('color');
    const idx = g.getIndex()!;
    nm.getNormalMatrix(o.matrixWorld);
    const n = pos.count;
    const sx = new Float32Array(n);
    const sy = new Float32Array(n);
    const sz = new Float32Array(n);
    const N = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const r: V3 = [v.x - center[0], v.y - center[1], v.z - center[2]];
      sx[i] = w / 2 + dot(r, right) * scale * ss;
      sy[i] = h / 2 - dot(r, up) * scale * ss;
      sz[i] = dot(r, viewDir);
      nv.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
      N[i * 3] = nv.x;
      N[i * 3 + 1] = nv.y;
      N[i * 3 + 2] = nv.z;
    }
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t);
      const b = idx.getX(t + 1);
      const c = idx.getX(t + 2);
      const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a]);
      if (Math.abs(area) < 1e-9) continue;
      const minX = Math.max(0, Math.floor(Math.min(sx[a], sx[b], sx[c])));
      const maxX = Math.min(w - 1, Math.ceil(Math.max(sx[a], sx[b], sx[c])));
      const minY = Math.max(0, Math.floor(Math.min(sy[a], sy[b], sy[c])));
      const maxY = Math.min(h - 1, Math.ceil(Math.max(sy[a], sy[b], sy[c])));
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
          const nn = norm([0, 1, 2].map((j) => w0 * N[a * 3 + j] + w1 * N[b * 3 + j] + w2 * N[c * 3 + j]) as V3);
          const light = 1.6 * Math.max(0, dot(nn, SUN)) + 0.3 + 0.15 * nn[1];
          for (let j = 0; j < 3; j++) {
            col[k * 3 + j] = (w0 * color.getComponent(a, j) + w1 * color.getComponent(b, j) + w2 * color.getComponent(c, j)) * light;
          }
        }
      }
    }
  });
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const acc = [0, 0, 0];
      for (let yy = 0; yy < ss; yy++) {
        for (let xx = 0; xx < ss; xx++) {
          const k = (y * ss + yy) * w + x * ss + xx;
          const sky = 0.35 + 0.25 * (1 - y / H);
          const c = depth[k] === Infinity ? [0.2 * sky, 0.36 * sky, 0.62 * sky] : [col[k * 3], col[k * 3 + 1], col[k * 3 + 2]];
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
        }
      }
      const q = (y * W + x) * 4;
      rgba[q] = toSrgb(acc[0] / (ss * ss));
      rgba[q + 1] = toSrgb(acc[1] / (ss * ss));
      rgba[q + 2] = toSrgb(acc[2] / (ss * ss));
      rgba[q + 3] = 255;
    }
  }
  return { width: W, height: H, rgba, lowest: 0 };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const s = buildKnightStatue();
  const frames: SheetFrame[] = [];
  for (const m of MOMENTS) {
    const p = knightPose(m.t);
    s.spearArm.rotation.x = p.spear;
    s.shieldArm.rotation.z = p.shieldOut;
    s.shoulders.position.y = 1.47 + p.shrug;
    s.head.rotation.set(0, 0, p.headTilt);
    for (const view of VIEWS) {
      frames.push({ cell: render(s.root, view.dir, 260, 300), label: `${m.t} s: ${m.name}`, sublabel: view.name });
    }
  }
  const path = await writeSheet({ title: 'Aya Yorgi knight statue (procedural)', subtitle: `${STATUE_HEIGHT.toFixed(1)} m with the plinth · rows: timeline · columns: views`, columns: VIEWS.length, frames }, `${OUT}/statue-poses`);
  console.log(`wrote ${path}`);
  s.dispose();
}

void main();
