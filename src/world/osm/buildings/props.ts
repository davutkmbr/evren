/**
 * Instanced geometries of the buildings layer.
 *
 * Rooftop props (unit scale, base at y = 0, front along local +X; see shared/props.ts): chimney, water tank, solar
 * heater, satellite dish, antenna, minaret.
 *
 * Near-LOD facade details (details.ts): local +Z is the wall normal, +X runs along the wall, the origin sits on the
 * wall plane at the bottom centre of the opening. Their vertices are "anchored": aAnchor = (ax, ay, az, aw) and the
 * metric offset `position` give the local point
 *   x = ax * sx + p.x,  y = ay * sy + az * sz + p.y,  z = aw * sz + p.z
 * with (sx, sy, sz) the instance scale (materials.ts DETAIL_VERTEX). Mouldings keep their metric profile while the
 * opening they frame has any size; arches use sz as their rise.
 */
import * as THREE from 'three';
import { merge, part } from '../shared/props';

export function chimneyGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const band = new THREE.BoxGeometry(1.14, 0.1, 1.14).translate(0, 0.86, 0);
  const cap = new THREE.BoxGeometry(1.25, 0.08, 1.25).translate(0, 1.04, 0);
  const pot = new THREE.CylinderGeometry(0.16, 0.18, 0.28, 8).translate(0.18, 1.2, 0);
  return merge([part(body, 0xffffff), part(band, 0xdddddd), part(cap, 0x8a8a8a), part(pot, 0x9c5a3c)]);
}

/** Upright plastic water tank on a small steel stand. */
export function tankGeometry(): THREE.BufferGeometry {
  const stand = new THREE.BoxGeometry(1.1, 0.3, 1.1).translate(0, 0.15, 0);
  const tank = new THREE.CylinderGeometry(0.55, 0.55, 1.25, 14).translate(0, 0.925, 0);
  const lid = new THREE.CylinderGeometry(0.22, 0.22, 0.08, 10).translate(0, 1.59, 0);
  const rib = new THREE.CylinderGeometry(0.565, 0.565, 0.05, 14).translate(0, 1.2, 0);
  return merge([part(stand, 0x5e5e5e), part(tank, 0xffffff), part(rib, 0xe6e6e6), part(lid, 0xdddddd)]);
}

/** Thermosiphon solar water heater: collector tilted 40° towards local +X, storage cylinder along its top edge. */
export function solarGeometry(): THREE.BufferGeometry {
  const tilt = (40 * Math.PI) / 180;
  const panel = new THREE.BoxGeometry(2.0, 0.06, 1.9).rotateZ(-tilt).translate(0, 0.8, 0);
  const tank = new THREE.CylinderGeometry(0.25, 0.25, 1.9, 10).rotateX(Math.PI / 2).translate(-0.8, 1.55, 0);
  const legA = new THREE.BoxGeometry(0.05, 1.4, 0.05).translate(-0.75, 0.7, 0.85);
  const legB = new THREE.BoxGeometry(0.05, 1.4, 0.05).translate(-0.75, 0.7, -0.85);
  return merge([part(panel, 0x14202e), part(tank, 0xc9c9c6), part(legA, 0x777777), part(legB, 0x777777)]);
}

/** Satellite dish on a short mast, facing local +X. */
export function dishGeometry(): THREE.BufferGeometry {
  const mast = new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6).translate(0, 0.45, 0);
  const dish = new THREE.CylinderGeometry(0.42, 0.06, 0.16, 12, 1, true).rotateZ(Math.PI / 2 + 0.35).translate(0.1, 0.95, 0);
  const lnb = new THREE.BoxGeometry(0.4, 0.03, 0.03).translate(0.35, 0.95, 0);
  return merge([part(mast, 0x777777), part(dish, 0xffffff), part(lnb, 0x555555)]);
}

/** TV antenna: mast of unit height with two Yagi booms (vertical scale = mast height). */
export function antennaGeometry(): THREE.BufferGeometry {
  const mast = new THREE.CylinderGeometry(0.022, 0.03, 1, 5).translate(0, 0.5, 0);
  const parts = [part(mast, 0xffffff)];
  for (const [y, len] of [
    [0.82, 1.1],
    [0.97, 0.8],
  ]) {
    parts.push(part(new THREE.BoxGeometry(len, 0.012, 0.012).translate(0.1, y, 0), 0xbbbbbb));
    for (let i = 0; i < 5; i++) {
      parts.push(part(new THREE.BoxGeometry(0.01, 0.01, 0.34 - i * 0.03).translate(-len / 2 + 0.2 + i * (len / 5), y, 0), 0xbbbbbb));
    }
  }
  return merge(parts);
}

/**
 * Ottoman minaret of unit height (vertical scale = height, horizontal scale = shaft radius factor): square base,
 * polygonal shaft, one şerefe balcony with a stalactite corbel, upper shaft and a lead cone with a finial.
 */
export function minaretGeometry(): THREE.BufferGeometry {
  const stone = 0xffffff;
  const lead = 0x6e7479;
  const base = new THREE.BoxGeometry(2.6, 0.12, 2.6).translate(0, 0.06, 0);
  const trans = new THREE.CylinderGeometry(1.15, 1.35, 0.06, 12).translate(0, 0.15, 0);
  const shaft = new THREE.CylinderGeometry(0.95, 1.05, 0.6, 12).translate(0, 0.48, 0);
  const corbel = new THREE.CylinderGeometry(1.35, 0.95, 0.04, 16).translate(0, 0.8, 0);
  const balcony = new THREE.CylinderGeometry(1.42, 1.42, 0.02, 16).translate(0, 0.83, 0);
  const rail = new THREE.CylinderGeometry(1.4, 1.4, 0.03, 16, 1, true).translate(0, 0.855, 0);
  const upper = new THREE.CylinderGeometry(0.82, 0.9, 0.1, 12).translate(0, 0.88, 0);
  const cone = new THREE.ConeGeometry(0.95, 0.14, 12).translate(0, 1.0, 0);
  const alem = new THREE.CylinderGeometry(0.03, 0.05, 0.03, 6).translate(0, 1.08, 0);
  return merge([part(base, stone), part(trans, stone), part(shaft, stone), part(corbel, 0xe8e2d6), part(balcony, stone), part(rail, 0xd8d2c6), part(upper, stone), part(cone, lead), part(alem, 0xc9a24a)]);
}

/** Face mask of Anchored.box() (the back face touching the wall is a separate flag). */
const Face = { Front: 1, Top: 2, Bottom: 4, Left: 8, Right: 16, All: 31 } as const;

/** Collects anchored boxes / quads (see file header) into one geometry. */
class Anchored {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly anc: number[] = [];
  private readonly col: number[] = [];

  private vtx(a: [number, number, number, number], p: [number, number, number], n: [number, number, number], shade: number): void {
    this.anc.push(...a);
    this.pos.push(...p);
    this.nrm.push(...n);
    this.col.push(shade, shade, shade);
  }

  /** Quad from four (anchor, offset) corners, counter-clockwise seen from `n`. */
  quad(c: [[number, number, number, number], [number, number, number]][], n: [number, number, number], shade = 1): void {
    const ids = [0, 1, 2, 0, 2, 3];
    for (const i of ids) {
      this.vtx(c[i][0], c[i][1], n, shade);
    }
  }

  tri(c: [[number, number, number, number], [number, number, number]][], n: [number, number, number], shade = 1): void {
    for (const k of c) {
      this.vtx(k[0], k[1], n, shade);
    }
  }

  /**
   * Box between two corners given per axis as (anchor, offset): x = [ax0, ox0, ax1, ox1], y = [ay0, oy0, ay1, oy1]
   * (+ optional sz coefficients az0 / az1 for y), z = [aw0, oz0, aw1, oz1]. Back face omitted (it touches the wall).
   */
  box(x: [number, number, number, number], y: [number, number, number, number], z: [number, number, number, number], shade = 1, yz: [number, number] = [0, 0], back = false, faces: number = Face.All): void {
    const X = (i: 0 | 1): [number, number] => (i === 0 ? [x[0], x[1]] : [x[2], x[3]]);
    const Y = (i: 0 | 1): [number, number, number] => (i === 0 ? [y[0], yz[0], y[1]] : [y[2], yz[1], y[3]]);
    const Z = (i: 0 | 1): [number, number] => (i === 0 ? [z[0], z[1]] : [z[2], z[3]]);
    const P = (i: 0 | 1, j: 0 | 1, k: 0 | 1): [[number, number, number, number], [number, number, number]] => {
      const [ax, ox] = X(i);
      const [ay, az, oy] = Y(j);
      const [aw, oz] = Z(k);
      return [
        [ax, ay, az, aw],
        [ox, oy, oz],
      ];
    };
    if (faces & Face.Front) {
      this.quad([P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)], [0, 0, 1], shade);
    }
    if (faces & Face.Top) {
      this.quad([P(0, 1, 0), P(0, 1, 1), P(1, 1, 1), P(1, 1, 0)], [0, 1, 0], shade * 1.05);
    }
    if (faces & Face.Bottom) {
      this.quad([P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)], [0, -1, 0], shade * 0.9);
    }
    if (faces & Face.Left) {
      this.quad([P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0)], [-1, 0, 0], shade);
    }
    if (faces & Face.Right) {
      this.quad([P(1, 0, 1), P(1, 0, 0), P(1, 1, 0), P(1, 1, 1)], [1, 0, 0], shade);
    }
    if (back) {
      this.quad([P(1, 0, 0), P(0, 0, 0), P(0, 1, 0), P(1, 1, 0)], [0, 0, -1], shade);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aAnchor', new THREE.Float32BufferAttribute(this.anc, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    return g;
  }
}

/** Projecting sill ledge. */
function sill(a: Anchored, lip = 0.2): void {
  a.box([-1, -lip, 1, lip], [0, -0.1, 0, 0.02], [0, 0, 0, 0.13], 1.08);
}

/** Architrave jambs from the sill line up to y = top (anchored), bar width w, depth d; hidden top / bottom faces skipped. */
function jambs(a: Anchored, w: number, d: number, topA: number, topZ: number, topO: number): void {
  a.box([-1, -w, -1, 0], [0, 0, topA, topO], [0, 0, 0, d], 1, [0, topZ], false, Face.Front | Face.Left | Face.Right);
  a.box([1, 0, 1, w], [0, 0, topA, topO], [0, 0, 0, d], 1, [0, topZ], false, Face.Front | Face.Left | Face.Right);
}

/** Levantine window: architrave, sill, frieze and cornice cap on consoles. */
export function surroundCapGeometry(): THREE.BufferGeometry {
  const a = new Anchored();
  sill(a);
  jambs(a, 0.13, 0.05, 1, 0, 0.13);
  a.box([-1, -0.13, 1, 0.13], [1, 0, 1, 0.13], [0, 0, 0, 0.05]);
  // Frieze, consoles, cornice cap and its drip.
  a.box([-1, -0.13, 1, 0.13], [1, 0.13, 1, 0.3], [0, 0, 0, 0.03], 0.97);
  a.box([-1, -0.27, -1, -0.15], [1, 0.02, 1, 0.3], [0, 0, 0, 0.12], 0.95);
  a.box([1, 0.15, 1, 0.27], [1, 0.02, 1, 0.3], [0, 0, 0, 0.12], 0.95);
  a.box([-1, -0.33, 1, 0.33], [1, 0.3, 1, 0.4], [0, 0, 0, 0.17], 1.1);
  a.box([-1, -0.36, 1, 0.36], [1, 0.4, 1, 0.45], [0, 0, 0, 0.2], 1.12);
  return a.build();
}

/** Window with a triangular pediment (apex height follows the width through sz = half width). */
export function surroundPedimentGeometry(): THREE.BufferGeometry {
  const a = new Anchored();
  sill(a);
  jambs(a, 0.13, 0.05, 1, 0, 0.13);
  a.box([-1, -0.13, 1, 0.13], [1, 0, 1, 0.13], [0, 0, 0, 0.05]);
  a.box([-1, -0.34, 1, 0.34], [1, 0.2, 1, 0.3], [0, 0, 0, 0.16], 1.1);
  // Raking cornices: front triangle and two sloped tops.
  const L: [[number, number, number, number], [number, number, number]] = [
    [-1, 1, 0, 0],
    [-0.34, 0.3, 0.15],
  ];
  const R: [[number, number, number, number], [number, number, number]] = [
    [1, 1, 0, 0],
    [0.34, 0.3, 0.15],
  ];
  const T: [[number, number, number, number], [number, number, number]] = [
    [0, 1, 0.34, 0],
    [0, 0.42, 0.15],
  ];
  a.tri([L, R, T], [0, 0, 1], 1.05);
  const back = (c: [[number, number, number, number], [number, number, number]]): [[number, number, number, number], [number, number, number]] => [c[0], [c[1][0], c[1][1], 0]];
  a.quad([back(L), L, T, back(T)], [-0.34, 0.94, 0], 1.12);
  a.quad([R, back(R), back(T), T], [0.34, 0.94, 0], 1.12);
  return a.build();
}

/** Arched architrave with keystone; sz = arch rise (the crown is at y = sy). */
export function surroundArchGeometry(): THREE.BufferGeometry {
  const a = new Anchored();
  sill(a);
  const w = 0.15;
  const d = 0.05;
  // Jambs up to the springing line (y = sy - rise).
  a.box([-1, -w, -1, 0], [0, 0, 1, 0], [0, 0, 0, d], 1, [0, -1], false, Face.Front | Face.Left | Face.Right);
  a.box([1, 0, 1, w], [0, 0, 1, 0], [0, 0, 0, d], 1, [0, -1], false, Face.Front | Face.Left | Face.Right);
  const seg = 8;
  for (let i = 0; i < seg; i++) {
    const t0 = (i / seg) * Math.PI;
    const t1 = ((i + 1) / seg) * Math.PI;
    const P = (t: number, r: number, z: number): [[number, number, number, number], [number, number, number]] => [
      [Math.cos(t), 1, Math.sin(t) - 1, 0],
      [Math.cos(t) * r, Math.sin(t) * r, z],
    ];
    const nx = Math.cos((t0 + t1) / 2);
    const ny = Math.sin((t0 + t1) / 2);
    a.quad([P(t1, 0, d), P(t0, 0, d), P(t0, w, d), P(t1, w, d)], [0, 0, 1]);
    a.quad([P(t0, w, 0), P(t1, w, 0), P(t1, w, d), P(t0, w, d)], [nx, ny, 0], 1.05);
    a.quad([P(t1, 0, 0), P(t0, 0, 0), P(t0, 0, d), P(t1, 0, d)], [-nx, -ny, 0], 0.8);
  }
  // Keystone.
  a.box([0, -0.11, 0, 0.11], [1, -0.06, 1, 0.24], [0, 0, 0, 0.09], 1.1);
  return a.build();
}

/** Timber house window: flat board jambs, a head board with a drip cap, a board sill. */
export function frameGeometry(): THREE.BufferGeometry {
  const a = new Anchored();
  a.box([-1, -0.12, 1, 0.12], [0, -0.06, 0, 0.0], [0, 0, 0, 0.07], 1.05);
  a.box([-1, -0.11, -1, 0], [0, 0, 1, 0], [0, 0, 0, 0.03], 1, [0, 0], false, Face.Front | Face.Left | Face.Right);
  a.box([1, 0, 1, 0.11], [0, 0, 1, 0], [0, 0, 0, 0.03], 1, [0, 0], false, Face.Front | Face.Left | Face.Right);
  a.box([-1, -0.14, 1, 0.14], [1, 0, 1, 0.16], [0, 0, 0, 0.035], 1);
  a.box([-1, -0.18, 1, 0.18], [1, 0.16, 1, 0.2], [0, 0, 0, 0.08], 1.1);
  return a.build();
}

/** Sill ledge alone (post-war windows). */
export function sillGeometry(): THREE.BufferGeometry {
  const a = new Anchored();
  a.box([-1, -0.08, 1, 0.08], [0, -0.07, 0, 0.02], [0, 0, 0, 0.09], 1.08);
  return a.build();
}

/** Pair of open louvred shutters folded against the wall beside the opening. */
export function shutterGeometry(): THREE.BufferGeometry {
  const a = new Anchored();
  a.box([-2, -0.12, -1, -0.12], [0, 0.02, 1, -0.02], [0, 0.02, 0, 0.05]);
  a.box([1, 0.12, 2, 0.12], [0, 0.02, 1, -0.02], [0, 0.02, 0, 0.05]);
  return a.build();
}

/** Balcony slab (sx half width, sy thickness, sz depth) with two corbels. */
export function balconyGeometry(): THREE.BufferGeometry {
  const a = new Anchored();
  a.box([-1, 0, 1, 0], [-1, 0, 0, 0], [0, 0, 1, 0], 1);
  a.box([-1, 0.12, -1, 0.3], [-1, -0.4, -1, 0], [0, 0, 0.7, 0], 0.9);
  a.box([1, -0.3, 1, -0.12], [-1, -0.4, -1, 0], [0, 0, 0.7, 0], 0.9);
  return a.build();
}

/** Railing / parapet: front panel at z = sz and two returns, height sy, with a handrail. */
export function railingGeometry(thick: number): THREE.BufferGeometry {
  const a = new Anchored();
  a.box([-1, 0, 1, 0], [0, 0, 1, 0], [1, -thick, 1, 0], 1, [0, 0], true);
  a.box([-1, 0, -1, thick], [0, 0, 1, 0], [0, 0, 1, -thick], 1, [0, 0], true);
  a.box([1, -thick, 1, 0], [0, 0, 1, 0], [0, 0, 1, -thick], 1, [0, 0], true);
  a.box([-1, -0.02, 1, 0.02], [1, -0.03, 1, 0.03], [1, -0.05, 1, 0.02], 1.2);
  return a.build();
}

/** Shop fascia sign: box of half size (sx, sy), depth sz. */
export function signGeometry(): THREE.BufferGeometry {
  const a = new Anchored();
  a.box([-1, 0, 1, 0], [-1, 0, 1, 0], [0, 0, 1, 0], 1);
  return a.build();
}

/** Canvas awning: slope from the wall down to the valance at z = sz, drop sy. */
export function awningGeometry(): THREE.BufferGeometry {
  const a = new Anchored();
  const C = (ax: number, ay: number, aw: number, ox = 0, oy = 0, oz = 0): [[number, number, number, number], [number, number, number]] => [
    [ax, ay, 0, aw],
    [ox, oy, oz],
  ];
  const nl = Math.hypot(1, 1.6);
  a.quad([C(-1, 0, 0), C(-1, -0.55, 1), C(1, -0.55, 1), C(1, 0, 0)], [0, 1.6 / nl, 1 / nl], 1);
  a.quad([C(-1, 0, 0), C(1, 0, 0), C(1, -0.55, 1), C(-1, -0.55, 1)], [0, -1.6 / nl, -1 / nl], 0.7);
  a.quad([C(-1, -0.55, 1), C(-1, -1, 1), C(1, -1, 1), C(1, -0.55, 1)], [0, 0, 1], 1);
  a.quad([C(1, -0.55, 1), C(1, -1, 1), C(-1, -1, 1), C(-1, -0.55, 1)], [0, 0, -1], 0.7);
  a.tri([C(-1, 0, 0), C(-1, -0.55, 1), C(-1, -1, 1)], [-1, 0, 0], 0.85);
  a.tri([C(1, 0, 0), C(1, -1, 1), C(1, -0.55, 1)], [1, 0, 0], 0.85);
  return a.build();
}

/** Split air-conditioner outdoor unit on wall brackets (metric, no anchors). */
export function acGeometry(): THREE.BufferGeometry {
  const a = new Anchored();
  a.box([0, -0.4, 0, 0.4], [0, 0, 0, 0.55], [0, 0.06, 0, 0.34], 1);
  a.box([0, -0.34, 0, -0.3], [0, -0.06, 0, 0.02], [0, 0, 0, 0.36], 0.6);
  a.box([0, 0.3, 0, 0.34], [0, -0.06, 0, 0.02], [0, 0, 0, 0.36], 0.6);
  return a.build();
}
