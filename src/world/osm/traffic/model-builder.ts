/**
 * Geometry builder for the procedural vehicles: indexed triangles with position, normal, colour and a per-vertex
 * material id (aMat, see materials.ts VehicleMat). Vehicle frame: forward -Z, right +X, up +Y, wheels on y = 0.
 *
 * The body is a loft of closed cross-sections along z; smoothing groups (crease stations / section points and
 * material changes) split vertices so rounded panels shade smoothly while creases and panel borders stay sharp.
 */
import * as THREE from 'three';

export const VehicleMat = {
  Paint: 0,
  Glass: 1,
  Chrome: 2,
  Rubber: 3,
  Trim: 4,
  Head: 5,
  Tail: 6,
  /** Fixed livery colour (vertex colour), satin. */
  Fixed: 7,
  /** Passenger window lit from inside at night (buses, trams). */
  Lit: 8,
  /** Self-lit sign (taxi roof sign, destination display). */
  Sign: 9,
  Plate: 10,
  Cloth: 11,
  /** Amber indicators / side markers. */
  Amber: 12,
} as const;
export type VehicleMat = (typeof VehicleMat)[keyof typeof VehicleMat];

export type Rgb = readonly [number, number, number];

export interface Face {
  mat: number;
  color: Rgb;
}

const WHITE: Rgb = [1, 1, 1];

export class ModelBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly mat: number[] = [];
  readonly idx: number[] = [];

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, f: Face): number {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.col.push(f.color[0], f.color[1], f.color[2]);
    this.mat.push(f.mat);
    return this.pos.length / 3 - 1;
  }

  /** Flat polygon (convex, counter-clockwise seen from the side the normal points to). */
  polygon(pts: readonly (readonly [number, number, number])[], f: Face): void {
    const [a, b, c] = pts;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const base = this.pos.length / 3;
    for (const p of pts) {
      this.vertex(p[0], p[1], p[2], nx, ny, nz, f);
    }
    for (let i = 1; i < pts.length - 1; i++) {
      this.idx.push(base, base + i, base + i + 1);
    }
  }

  /** Axis-aligned box (optionally rotated about X by `tilt`, about Y by `yaw`); `skip` bits omit faces: 1 -X, 2 +X, 4 -Y, 8 +Y, 16 -Z, 32 +Z. */
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, f: Face, skip = 0, tilt = 0, yaw = 0): void {
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const cyw = Math.cos(yaw);
    const syw = Math.sin(yaw);
    const tr = (x: number, y: number, z: number): [number, number, number] => {
      const y1 = y * ct - z * st;
      const z1 = y * st + z * ct;
      const x2 = x * cyw + z1 * syw;
      const z2 = -x * syw + z1 * cyw;
      return [cx + x2, cy + y1, cz + z2];
    };
    const c = (sx: number, sy: number, sz: number): [number, number, number] => tr(sx * hx, sy * hy, sz * hz);
    const faces: [number, [number, number, number][]][] = [
      [1, [c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1)]],
      [2, [c(1, -1, 1), c(1, -1, -1), c(1, 1, -1), c(1, 1, 1)]],
      [4, [c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1)]],
      [8, [c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1), c(-1, 1, -1)]],
      [16, [c(1, -1, -1), c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1)]],
      [32, [c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)]],
    ];
    for (const [bit, q] of faces) {
      if (!(skip & bit)) {
        this.polygon(q, f);
      }
    }
  }

  /**
   * Cylinder along X (wheels, axles) from x0 to x1, radius r, centre (cy, cz), `seg` segments; caps: 1 at x0, 2 at x1.
   * `capFace` shades the caps (rims), `side` the mantle.
   */
  cylinderX(x0: number, x1: number, cy: number, cz: number, r: number, seg: number, side: Face, capFace: Face, caps = 3, phase = 0): void {
    const base = this.pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const a = phase + (i / seg) * Math.PI * 2;
      const ny = Math.cos(a);
      const nz = Math.sin(a);
      this.vertex(x0, cy + ny * r, cz + nz * r, 0, ny, nz, side);
      this.vertex(x1, cy + ny * r, cz + nz * r, 0, ny, nz, side);
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    for (const [bit, x, s] of [
      [1, x0, -1],
      [2, x1, 1],
    ] as const) {
      if (!(caps & bit)) {
        continue;
      }
      const c = this.vertex(x, cy, cz, s, 0, 0, capFace);
      const first = this.pos.length / 3;
      for (let i = 0; i < seg; i++) {
        const a = phase + (i / seg) * Math.PI * 2;
        this.vertex(x, cy + Math.cos(a) * r, cz + Math.sin(a) * r, s, 0, 0, capFace);
      }
      for (let i = 0; i < seg; i++) {
        const p = first + i;
        const q = first + ((i + 1) % seg);
        if (s > 0) {
          this.idx.push(c, p, q);
        } else {
          this.idx.push(c, q, p);
        }
      }
    }
  }

  /** Disc / ring in the plane x = const facing `s` (±1), between radii r0 and r1. */
  ringX(x: number, cy: number, cz: number, r0: number, r1: number, seg: number, s: number, f: Face): void {
    const base = this.pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      this.vertex(x, cy + c * r0, cz + sn * r0, s, 0, 0, f);
      this.vertex(x, cy + c * r1, cz + sn * r1, s, 0, 0, f);
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      if (s > 0) {
        this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      } else {
        this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }

  /** Low-poly ellipsoid (rider heads, helmets). */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, f: Face, seg = 6): void {
    const rings = Math.max(3, seg >> 1);
    const base = this.pos.length / 3;
    for (let j = 0; j <= rings; j++) {
      const v = (j / rings) * Math.PI;
      for (let i = 0; i <= seg; i++) {
        const u = (i / seg) * Math.PI * 2;
        const nx = Math.sin(v) * Math.cos(u);
        const ny = Math.cos(v);
        const nz = Math.sin(v) * Math.sin(u);
        this.vertex(cx + nx * rx, cy + ny * ry, cz + nz * rz, nx, ny, nz, f);
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = base + j * (seg + 1) + i;
        const b = a + seg + 1;
        this.idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }

  /**
   * Lofted closed body: `rings[i]` is the closed cross-section (x, y pairs, counter-clockwise seen from +Z... any
   * consistent order) at z = `zs[i]`. `face(i, j)` shades the quad between stations i, i+1 and ring points j, j+1.
   * `creaseZ[i]` / `creaseJ[j]` mark sharp station / ring lines. Ends are closed with fans (`capFront`, `capBack`).
   */
  loft(zs: readonly number[], rings: readonly (readonly number[])[], face: (i: number, j: number) => Face, creaseZ: readonly boolean[], creaseJ: readonly boolean[], capFront: Face | null, capBack: Face | null): void {
    const nS = zs.length;
    const m = rings[0].length / 2;
    const regZ: number[] = [];
    let rz = 0;
    for (let i = 0; i < nS - 1; i++) {
      if (i > 0 && creaseZ[i]) {
        rz++;
      }
      regZ.push(rz);
    }
    const regJ: number[] = [];
    let rj = 0;
    for (let j = 0; j < m; j++) {
      if (j > 0 && creaseJ[j]) {
        rj++;
      }
      regJ.push(rj);
    }
    // smoothing: vertex key = station, ring point, material, region
    const keyIndex = new Map<string, number>();
    const accum: number[] = [];
    const tris: number[] = [];
    const vtxFace: Face[] = [];
    const vtxPos: number[] = [];
    const P = (i: number, j: number): [number, number, number] => [rings[i][(j % m) * 2], rings[i][(j % m) * 2 + 1], zs[i]];
    const vid = (i: number, j: number, f: Face, region: string): number => {
      const key = `${i}|${j % m}|${f.mat}|${f.color[0]}|${f.color[1]}|${f.color[2]}|${region}`;
      let v = keyIndex.get(key);
      if (v === undefined) {
        v = vtxFace.length;
        keyIndex.set(key, v);
        vtxFace.push(f);
        vtxPos.push(...P(i, j));
        accum.push(0, 0, 0);
      }
      return v;
    };
    for (let i = 0; i < nS - 1; i++) {
      for (let j = 0; j < m; j++) {
        const f = face(i, j);
        const region = `${regZ[i]}:${regJ[j]}`;
        const a = P(i, j);
        const b = P(i + 1, j);
        const c = P(i + 1, j + 1);
        const d = P(i, j + 1);
        // face normal from the quad diagonals
        const e1x = c[0] - a[0];
        const e1y = c[1] - a[1];
        const e1z = c[2] - a[2];
        const e2x = b[0] - d[0];
        const e2y = b[1] - d[1];
        const e2z = b[2] - d[2];
        let nx = e1y * e2z - e1z * e2y;
        let ny = e1z * e2x - e1x * e2z;
        let nz = e1x * e2y - e1y * e2x;
        const l = Math.hypot(nx, ny, nz);
        if (l < 1e-10) {
          continue;
        }
        nx /= l;
        ny /= l;
        nz /= l;
        const ia = vid(i, j, f, region);
        const ib = vid(i + 1, j, f, region);
        const ic = vid(i + 1, j + 1, f, region);
        const id = vid(i, j + 1, f, region);
        for (const v of [ia, ib, ic, id]) {
          accum[v * 3] += nx * l;
          accum[v * 3 + 1] += ny * l;
          accum[v * 3 + 2] += nz * l;
        }
        tris.push(ia, ic, ib, ia, id, ic);
      }
    }
    const base = this.pos.length / 3;
    for (let v = 0; v < vtxFace.length; v++) {
      const l = Math.hypot(accum[v * 3], accum[v * 3 + 1], accum[v * 3 + 2]) || 1;
      this.vertex(vtxPos[v * 3], vtxPos[v * 3 + 1], vtxPos[v * 3 + 2], accum[v * 3] / l, accum[v * 3 + 1] / l, accum[v * 3 + 2] / l, vtxFace[v]);
    }
    for (const t of tris) {
      this.idx.push(base + t);
    }
    for (const [cap, i, s] of [
      [capFront, 0, -1],
      [capBack, nS - 1, 1],
    ] as const) {
      if (!cap) {
        continue;
      }
      let cx = 0;
      let cy = 0;
      for (let j = 0; j < m; j++) {
        cx += rings[i][j * 2];
        cy += rings[i][j * 2 + 1];
      }
      cx /= m;
      cy /= m;
      const c = this.vertex(cx, cy, zs[i], 0, 0, s, cap);
      const first = this.pos.length / 3;
      for (let j = 0; j < m; j++) {
        this.vertex(rings[i][j * 2], rings[i][j * 2 + 1], zs[i], 0, 0, s, cap);
      }
      // orientation: make the fan face outward (+s along z)
      const ax = rings[i][0] - cx;
      const ay = rings[i][1] - cy;
      const bx = rings[i][2] - cx;
      const by = rings[i][3] - cy;
      const crossZ = ax * by - ay * bx;
      const flip = crossZ * s < 0;
      for (let j = 0; j < m; j++) {
        const p = first + j;
        const q = first + ((j + 1) % m);
        if (flip) {
          this.idx.push(c, q, p);
        } else {
          this.idx.push(c, p, q);
        }
      }
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export function face(mat: number, color: Rgb = WHITE): Face {
  return { mat, color };
}
