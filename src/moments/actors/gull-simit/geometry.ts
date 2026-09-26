import * as THREE from 'three';
import { buildBirdGeometry } from '../../../world/life/birds/bird-geometry';

/**
 * The ambient gull (world/life/birds, wingspan 1.35 m, forward -Z) with a yellow bill added: a small four-sided
 * wedge from the face, region 5 in the bird shader (yellow, red gonys spot toward the tip, marked by aWing.y > 0.5).
 */
export function buildGullGeometry(): THREE.BufferGeometry {
  const base = buildBirdGeometry();
  const pos = Array.from(base.getAttribute('position').array as Float32Array);
  const wing = Array.from(base.getAttribute('aWing').array as Float32Array);
  const idx = Array.from(base.getIndex()!.array as ArrayLike<number>);
  const v = (x: number, y: number, z: number, spot: number): number => {
    pos.push(x, y, z);
    wing.push(0, spot, 0, 5);
    return pos.length / 3 - 1;
  };
  const top = v(0, 0.03, -0.25, 0);
  const left = v(-0.013, 0.012, -0.252, 0);
  const right = v(0.013, 0.012, -0.252, 0);
  const chin = v(0, -0.004, -0.25, 0);
  const tip = v(0, 0.01, -0.345, 1);
  const gonys = v(0, 0.0, -0.325, 1);
  idx.push(top, left, tip, top, tip, right, left, gonys, tip, right, tip, gonys, left, chin, gonys, right, gonys, chin);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  base.dispose();
  return g;
}

/** Colours of a simit: baked crust, sesame seeds, the crumb inside a broken end. */
export const SIMIT_COLORS = {
  crust: [0.46, 0.22, 0.08] as const,
  crustLight: [0.62, 0.34, 0.13] as const,
  sesame: [0.9, 0.8, 0.56] as const,
  crumb: [0.86, 0.72, 0.5] as const,
};

/**
 * A broken piece of simit: a ~100 degree arc of a sesame ring (outer diameter ~14 cm, drawn 1.5x so it reads at
 * gull distance), crust with scattered seeds on the outside and top, pale crumb on the two broken ends. Vertex colours,
 * centred on its middle.
 */
export function buildSimitPieceGeometry(scale = 1.5, seed = 7): THREE.BufferGeometry {
  const R = 0.052 * scale;
  const r = 0.018 * scale;
  const arc = (100 * Math.PI) / 180;
  const segA = 10;
  const segB = 8;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const mid = arc / 2;
  const cx = Math.cos(mid) * R;
  const cz = Math.sin(mid) * R;
  const push = (x: number, y: number, z: number, c: readonly number[]): number => {
    pos.push(x - cx, y, z - cz);
    col.push(c[0], c[1], c[2]);
    return pos.length / 3 - 1;
  };
  for (let a = 0; a <= segA; a++) {
    const t = (a / segA) * arc;
    for (let b = 0; b < segB; b++) {
      const p = (b / segB) * Math.PI * 2;
      const rr = R + Math.cos(p) * r;
      const y = Math.sin(p) * r * 0.85;
      // Seeds on the outer / upper half, a slightly lighter bake on top.
      const outer = Math.cos(p) * 0.6 + Math.sin(p) * 0.8;
      let c: readonly number[] = outer > 0.2 ? SIMIT_COLORS.crustLight : SIMIT_COLORS.crust;
      if (outer > -0.1 && rnd() < 0.38) c = SIMIT_COLORS.sesame;
      push(Math.cos(t) * rr, y, Math.sin(t) * rr, c);
    }
  }
  for (let a = 0; a < segA; a++) {
    for (let b = 0; b < segB; b++) {
      const i0 = a * segB + b;
      const i1 = a * segB + ((b + 1) % segB);
      const j0 = i0 + segB;
      const j1 = i1 + segB;
      idx.push(i0, j0, i1, i1, j0, j1);
    }
  }
  // Broken ends: crumb discs (fan).
  for (const end of [0, segA]) {
    const t = (end / segA) * arc;
    const centre = push(Math.cos(t) * R, 0, Math.sin(t) * R, SIMIT_COLORS.crumb);
    const ring: number[] = [];
    for (let b = 0; b < segB; b++) {
      const p = (b / segB) * Math.PI * 2;
      const rr = R + Math.cos(p) * r * 0.92;
      ring.push(push(Math.cos(t) * rr, Math.sin(p) * r * 0.8, Math.sin(t) * rr, SIMIT_COLORS.crumb));
    }
    for (let b = 0; b < segB; b++) {
      const a0 = ring[b];
      const a1 = ring[(b + 1) % segB];
      if (end === 0) idx.push(centre, a0, a1);
      else idx.push(centre, a1, a0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
