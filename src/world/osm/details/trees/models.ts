/**
 * Tree models of the details layer (unit instance scale, base at y = 0): vertex-coloured trunks and branches plus
 * crowns of alpha-tested foliage cards from the procedural atlas (trees/atlas.ts). Card normals are bent towards the
 * crown's radial direction and vertex colours carry crown occlusion, so crowns shade as soft volumes.
 */
import * as THREE from 'three';
import { BARK_UV, Tile } from './atlas';
import type { TreeSpecies } from './species';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type V3 = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0): V3 => new THREE.Vector3(x, y, z);

class TreeBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly idx: number[] = [];

  private vert(p: V3, n: V3, u: number, v: number, c: THREE.Color): number {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }

  /** Tapered cylinder from a to b (bark, vertex coloured). */
  limb(a: V3, b: V3, r0: number, r1: number, seg: number, color: number): void {
    const axis = b.clone().sub(a).normalize();
    const t = Math.abs(axis.y) < 0.9 ? v3(0, 1, 0).cross(axis).normalize() : v3(1, 0, 0).cross(axis).normalize();
    const s = axis.clone().cross(t).normalize();
    const c = new THREE.Color(color);
    const dark = c.clone().multiplyScalar(0.8);
    const base = this.pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const ang = (i / seg) * Math.PI * 2;
      const n = t.clone().multiplyScalar(Math.cos(ang)).addScaledVector(s, Math.sin(ang));
      this.vert(a.clone().addScaledVector(n, r0), n, BARK_UV[0], BARK_UV[1], dark);
      this.vert(b.clone().addScaledVector(n, r1), n, BARK_UV[0], BARK_UV[1], c);
    }
    for (let i = 0; i < seg; i++) {
      const k = base + i * 2;
      this.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }

  /**
   * Foliage card: square of half size `h` at `p` facing `n`, textured with `tile`; normals blend towards `radial`
   * (the crown's outward direction at p) and `ao` darkens it.
   */
  card(p: V3, n: V3, h: number, tile: readonly number[], radial: V3, ao: number, spin: number, tint: number, stretch = 1): void {
    const up = Math.abs(n.y) < 0.95 ? v3(0, 1, 0) : v3(1, 0, 0);
    let t = up.clone().cross(n).normalize();
    let b = n.clone().cross(t).normalize();
    const cs = Math.cos(spin);
    const sn = Math.sin(spin);
    const t2 = t.clone().multiplyScalar(cs).addScaledVector(b, sn);
    b = b.clone().multiplyScalar(cs).addScaledVector(t, -sn);
    t = t2;
    const shade = new THREE.Color(tint).multiplyScalar(ao);
    const bent = n.clone().multiplyScalar(0.3).addScaledVector(radial, 0.7).normalize();
    const [u0, v0, u1, v1] = tile;
    const base = this.pos.length / 3;
    const corners: [number, number, number, number][] = [
      [-1, -1, u0, v1],
      [1, -1, u1, v1],
      [1, 1, u1, v0],
      [-1, 1, u0, v0],
    ];
    for (const [a, c, u, v] of corners) {
      const q = p.clone().addScaledVector(t, a * h).addScaledVector(b, c * h * stretch);
      this.vert(q, bent, u, v, shade);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Curved strip (palm frond) through `pts`, width tapering from w0 to w1, textured along the tile. */
  strip(pts: V3[], side: V3, w0: number, w1: number, tile: readonly number[], ao: number, tint: number): void {
    const [u0, v0, u1, v1] = tile;
    const base = this.pos.length / 3;
    const c = new THREE.Color(tint).multiplyScalar(ao);
    for (let i = 0; i < pts.length; i++) {
      const f = i / (pts.length - 1);
      const w = w0 + (w1 - w0) * f;
      const dir = (i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
      const n = side.clone().cross(dir).normalize();
      if (n.y < 0) n.negate();
      const v = v0 + (v1 - v0) * f;
      this.vert(pts[i].clone().addScaledVector(side, -w), n, u0, v, c);
      this.vert(pts[i].clone().addScaledVector(side, w), n, u1, v, c);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const k = base + i * 2;
      this.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }

  /** Solid lathe (cypress core) around the y axis, radius profile r(t) from y0 to y1. */
  lathe(y0: number, y1: number, rings: number, seg: number, r: (t: number) => number, color: number, jitter: () => number): void {
    const base = this.pos.length / 3;
    const c = new THREE.Color(color);
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const y = y0 + (y1 - y0) * t;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const rr = r(t) * (i === seg ? 1 : 0.85 + 0.3 * jitter());
        const n = v3(Math.cos(a), 0.25, Math.sin(a)).normalize();
        this.vert(v3(Math.cos(a) * rr, y, Math.sin(a) * rr), n, BARK_UV[0], BARK_UV[1], c.clone().multiplyScalar(0.55 + 0.45 * t));
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = base + j * (seg + 1) + i;
        const b = a + seg + 1;
        this.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function randomDir(r: () => number): V3 {
  const z = r() * 2 - 1;
  const a = r() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return v3(Math.cos(a) * s, z, Math.sin(a) * s);
}

/** Crown of cards inside an ellipsoid (centre c, radii rad), biased to the shell. */
function crown(tb: TreeBuilder, r: () => number, c: V3, rad: V3, cards: number, size: [number, number], tile: readonly number[], tint: number, flat = 0): void {
  for (let i = 0; i < cards; i++) {
    const d = randomDir(r);
    d.y = d.y * (1 - flat) + (d.y >= 0 ? flat * 0.3 : 0);
    d.normalize();
    const k = i < cards * 0.2 ? 0.25 + 0.35 * r() : 0.62 + 0.38 * Math.sqrt(r());
    const p = c.clone().add(v3(d.x * rad.x * k, d.y * rad.y * k, d.z * rad.z * k));
    const radial = v3((p.x - c.x) / rad.x, (p.y - c.y) / rad.y, (p.z - c.z) / rad.z);
    const rl = radial.length();
    radial.normalize();
    const n = radial.clone().multiplyScalar(0.6).add(randomDir(r).multiplyScalar(0.8)).normalize();
    if (flat > 0) {
      n.y = Math.abs(n.y) * 0.6 + 0.6;
      n.normalize();
    }
    const height = (p.y - (c.y - rad.y)) / (2 * rad.y);
    const ao = 0.42 + 0.4 * Math.min(1, rl) + 0.25 * height;
    tb.card(p, n, size[0] + (size[1] - size[0]) * r(), tile, radial, Math.min(1.1, ao), r() * Math.PI * 2, tint);
  }
}

/** Çınar: short stout trunk, a few heavy limbs, broad rounded crown (~14 m). */
function plane(): THREE.BufferGeometry {
  const r = rng(101);
  const tb = new TreeBuilder();
  const top = v3(0.25, 4.0, 0.1);
  tb.limb(v3(0, -0.3, 0), top, 0.45, 0.32, 9, 0xa39a86);
  const c = v3(0.25, 8.9, 0.1);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + r();
    const end = v3(top.x + Math.cos(a) * (2.2 + r() * 1.3), 6.6 + r() * 1.8, top.z + Math.sin(a) * (2.2 + r() * 1.3));
    tb.limb(top, end, 0.2, 0.09, 6, 0x8f8672);
  }
  crown(tb, r, c, v3(5.9, 4.4, 5.9), 64, [1.5, 2.3], Tile.broadleaf, 0xffffff);
  return tb.build();
}

/** Servi: narrow dark column on a short trunk (~13 m). */
function cypress(): THREE.BufferGeometry {
  const r = rng(202);
  const tb = new TreeBuilder();
  tb.limb(v3(0, -0.3, 0), v3(0, 1.2, 0), 0.2, 0.16, 6, 0x6b5a48);
  const prof = (t: number): number => 1.25 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.95)), 0.8) * (1 - 0.35 * t) + 0.05;
  tb.lathe(0.8, 13.2, 10, 8, prof, 0x2f4a2c, r);
  for (let i = 0; i < 34; i++) {
    const t = 0.06 + 0.88 * r();
    const y = 0.8 + 12.4 * t;
    const a = r() * Math.PI * 2;
    const rr = prof(t) * 0.95;
    const p = v3(Math.cos(a) * rr, y, Math.sin(a) * rr);
    const radial = v3(Math.cos(a), 0.15, Math.sin(a)).normalize();
    tb.card(p, radial.clone().add(randomDir(r).multiplyScalar(0.4)).normalize(), 0.75 + 0.5 * (1 - t), Tile.cypress, radial, 0.65 + 0.4 * t, (r() - 0.5) * 0.5, 0xffffff, 1.7);
  }
  return tb.build();
}

/** Fıstık çamı: tall leaning trunk forking under a flat umbrella crown (~13 m). */
function pine(): THREE.BufferGeometry {
  const r = rng(303);
  const tb = new TreeBuilder();
  const fork = v3(0.7, 7.2, 0.3);
  tb.limb(v3(0, -0.3, 0), fork, 0.36, 0.24, 8, 0x7a5a44);
  const c = v3(0.9, 10.6, 0.35);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r();
    tb.limb(fork, v3(fork.x + Math.cos(a) * 3, 9.6 + r(), fork.z + Math.sin(a) * 3), 0.18, 0.08, 5, 0x6d5140);
  }
  crown(tb, r, c, v3(6.2, 1.6, 6.2), 46, [1.5, 2.3], Tile.pine, 0xffffff, 0.6);
  return tb.build();
}

/** Canary date palm: thick trunk and arching fronds (~9 m). */
function palm(): THREE.BufferGeometry {
  const r = rng(404);
  const tb = new TreeBuilder();
  const pts = [v3(0, -0.3, 0), v3(0.15, 2.5, 0), v3(0.35, 5.2, 0.1), v3(0.45, 7.6, 0.15)];
  for (let i = 1; i < pts.length; i++) {
    tb.limb(pts[i - 1], pts[i], 0.42 - i * 0.03, 0.4 - i * 0.03, 9, 0x8a7457);
  }
  const top = pts[pts.length - 1].clone();
  top.y += 0.2;
  const fronds = 18;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + r() * 0.3;
    const dir = v3(Math.cos(a), 0, Math.sin(a));
    const rise = i % 3 === 0 ? 0.9 : 0.45 + r() * 0.3;
    const L = 3.8 + r() * 1.2;
    const seg: V3[] = [];
    for (let k = 0; k <= 5; k++) {
      const f = k / 5;
      seg.push(top.clone().addScaledVector(dir, L * f).add(v3(0, L * (rise * f - 0.75 * f * f), 0)));
    }
    const side = v3(0, 1, 0).cross(dir).normalize();
    tb.strip(seg, side, 0.55, 0.15, Tile.palm, 0.85 + 0.2 * r(), 0xffffff);
  }
  return tb.build();
}

export function treeGeometries(): Record<TreeSpecies, THREE.BufferGeometry> {
  return { plane: plane(), cypress: cypress(), pine: pine(), palm: palm() };
}
