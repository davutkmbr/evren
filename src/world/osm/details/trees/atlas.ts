/**
 * Procedural foliage atlas (canvas-drawn, no external assets): 2 x 2 tiles of alpha-masked leaf clusters for the
 * card crowns of trees/models.ts. Transparent texels take the tile's mean leaf colour so mipmaps do not bleed dark
 * fringes; a small opaque white patch serves the vertex-coloured trunks and branches.
 */
import * as THREE from 'three';

export const ATLAS_SIZE = 1024;

/** UV rectangle [u0, v0, u1, v1] of each tile (v runs down the canvas; the texture is not flipped). */
export const Tile = {
  broadleaf: [0, 0, 0.5, 0.5],
  cypress: [0.5, 0, 1, 0.5],
  pine: [0, 0.5, 0.5, 1],
  palm: [0.5, 0.5, 1, 1],
} as const;

/** UV of the opaque white bark patch. */
export const BARK_UV: [number, number] = [0.5 + 24 / 1024, 1 - 24 / 1024];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

function leaf(g: Ctx, x: number, y: number, size: number, angle: number, fill: string, lobes: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.beginPath();
  if (lobes > 1) {
    // Palmate plane leaf: a few pointed lobes.
    for (let i = 0; i <= lobes * 2; i++) {
      const a = (i / (lobes * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? size : size * 0.55;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r * 0.9;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
  } else {
    g.ellipse(0, 0, size, size * 0.45, 0, 0, Math.PI * 2);
  }
  g.fillStyle = fill;
  g.fill();
  g.restore();
}

function green(r: () => number, base: [number, number, number], spread: number, light: number): string {
  const k = 0.75 + 0.5 * r() + light;
  const c = base.map((v, i) => Math.round(Math.min(255, v * k + (i === 0 ? r() * spread : i === 1 ? r() * spread * 0.8 : 0))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function drawBroadleaf(g: Ctx, x0: number, y0: number, s: number): void {
  const r = rng(11);
  const cx = x0 + s / 2;
  const cy = y0 + s / 2;
  g.strokeStyle = 'rgb(70,58,44)';
  g.lineWidth = 3;
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx, cy + s * 0.1);
    g.lineTo(cx + Math.cos(a) * s * 0.36, cy + Math.sin(a) * s * 0.36);
    g.stroke();
  }
  for (let i = 0; i < 520; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * s * 0.44;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d * 0.92;
    const light = (cy - y) / s;
    leaf(g, x, y, 11 + r() * 12, r() * Math.PI * 2, green(r, [74, 104, 44], 26, light * 0.5), r() < 0.7 ? 3 : 1);
  }
}

function drawCypress(g: Ctx, x0: number, y0: number, s: number): void {
  const r = rng(23);
  for (let i = 0; i < 1500; i++) {
    const x = x0 + s * (0.08 + 0.84 * r());
    const y = y0 + s * (0.04 + 0.92 * r());
    const edge = Math.abs(x - (x0 + s / 2)) / (s * 0.42);
    if (edge > 0.75 + r() * 0.3) continue;
    g.fillStyle = green(r, [34, 52, 30], 8, -0.1);
    g.beginPath();
    g.ellipse(x, y, 4 + r() * 6, 2 + r() * 3, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
}

function drawPine(g: Ctx, x0: number, y0: number, s: number): void {
  const r = rng(37);
  g.lineCap = 'round';
  for (let c = 0; c < 26; c++) {
    const cx = x0 + s * (0.18 + 0.64 * r());
    const cy = y0 + s * (0.18 + 0.64 * r());
    for (let n = 0; n < 44; n++) {
      const a = r() * Math.PI * 2;
      const l = s * (0.05 + 0.07 * r());
      g.strokeStyle = green(r, [52, 76, 42], 18, 0.05);
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l);
      g.stroke();
    }
  }
}

function drawPalm(g: Ctx, x0: number, y0: number, s: number): void {
  const r = rng(51);
  const cx = x0 + s / 2;
  g.strokeStyle = 'rgb(96,92,50)';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(cx, y0 + s * 0.02);
  g.lineTo(cx, y0 + s * 0.98);
  g.stroke();
  g.lineCap = 'round';
  for (let i = 0; i < 64; i++) {
    const t = i / 64;
    const y = y0 + s * (0.04 + 0.92 * t);
    const len = s * 0.42 * Math.sin(Math.PI * (0.15 + 0.85 * t)) * (0.85 + 0.2 * r());
    for (const side of [-1, 1]) {
      g.strokeStyle = green(r, [70, 96, 40], 20, 0.1);
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(cx, y);
      g.lineTo(cx + side * len, y + len * 0.35);
      g.stroke();
    }
  }
  // Opaque white bark patch in the tile's bottom-left corner.
  g.fillStyle = '#ffffff';
  g.fillRect(x0, y0 + s - 48, 48, 48);
}

/** Builds the atlas texture (sRGB, mipmapped). */
export function createFoliageAtlas(): THREE.DataTexture {
  const S = ATLAS_SIZE;
  const h = S / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.clearRect(0, 0, S, S);
  drawBroadleaf(g, 0, 0, h);
  drawCypress(g, h, 0, h);
  drawPine(g, 0, h, h);
  drawPalm(g, h, h, h);
  const img = g.getImageData(0, 0, S, S).data;
  const data = new Uint8Array(img.length);
  data.set(img);
  // Fill transparent texels of each tile with its mean opaque colour.
  for (const [tx, ty] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let n = 0;
    for (let y = ty * h; y < (ty + 1) * h; y++) {
      for (let x = tx * h; x < (tx + 1) * h; x++) {
        const o = (y * S + x) * 4;
        if (data[o + 3] > 200) {
          sr += data[o];
          sg += data[o + 1];
          sb += data[o + 2];
          n++;
        }
      }
    }
    const mr = n ? sr / n : 80;
    const mg = n ? sg / n : 100;
    const mb = n ? sb / n : 50;
    for (let y = ty * h; y < (ty + 1) * h; y++) {
      for (let x = tx * h; x < (tx + 1) * h; x++) {
        const o = (y * S + x) * 4;
        const a = data[o + 3] / 255;
        data[o] = Math.round(data[o] * a + mr * (1 - a));
        data[o + 1] = Math.round(data[o + 1] * a + mg * (1 - a));
        data[o + 2] = Math.round(data[o + 2] * a + mb * (1 - a));
      }
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
