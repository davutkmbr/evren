/**
 * Procedural low-poly dolphin (unit length, nose at z = -0.5, fluke tips at z = +0.5, back up): a lofted body of
 * elliptical rings (beak, melon, the deepest point a third back, a laterally flattened tail stock), a falcate dorsal fin,
 * two pectoral fins and horizontal flukes. Two levels of detail; the instance matrix scales it to the body length.
 *
 * Per vertex `aBody` = (t along the body 0..1, region, v): region 0 body, 1 dorsal fin, 2 pectoral fin, 3 flukes; v the
 * height within the body's cross-section (-1 belly .. 1 back) for the countershading and the flank pattern. The tail
 * beat bends everything behind mid-body in the vertex shader (./dolphin-material.ts).
 */

export const DOLPHIN_REGION = { body: 0, dorsal: 1, pectoral: 2, fluke: 3 } as const;

export interface DolphinMesh {
  position: Float32Array;
  body: Float32Array;
  index: Uint16Array;
  triangles: number;
}

/** Body half-height (fraction of the length) at t (0 nose .. 1 tail end). */
export function bodyRadius(t: number): number {
  const table: readonly (readonly [number, number])[] = [
    [0, 0.004],
    [0.03, 0.014],
    [0.07, 0.022],
    [0.1, 0.05],
    [0.15, 0.072],
    [0.24, 0.092],
    [0.34, 0.1],
    [0.45, 0.096],
    [0.56, 0.082],
    [0.66, 0.062],
    [0.75, 0.043],
    [0.83, 0.028],
    [0.88, 0.02],
    [0.9, 0.012],
  ];
  for (let i = 0; i + 1 < table.length; i++) {
    const [t0, r0] = table[i];
    const [t1, r1] = table[i + 1];
    if (t <= t1) return r0 + ((r1 - r0) * (t - t0)) / (t1 - t0);
  }
  return table[table.length - 1][1];
}

/** Width over height of the cross-section: round in front, flattened sideways toward the tail stock. */
function widthScale(t: number): number {
  return t < 0.5 ? 0.9 : 0.9 - 0.5 * Math.min(1, (t - 0.5) / 0.35);
}

class Builder {
  readonly pos: number[] = [];
  readonly body: number[] = [];
  readonly idx: number[] = [];
  vertex(x: number, y: number, t: number, region: number, v: number): number {
    this.pos.push(x, y, t - 0.5);
    this.body.push(t, region, v);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  build(): DolphinMesh {
    return { position: new Float32Array(this.pos), body: new Float32Array(this.body), index: new Uint16Array(this.idx), triangles: this.idx.length / 3 };
  }
}

/** Builds the near (`near`) or far (`far`) level of detail. */
export function buildDolphinMesh(lod: 'near' | 'far'): DolphinMesh {
  const b = new Builder();
  const near = lod === 'near';
  const rings = near ? [0.03, 0.07, 0.11, 0.16, 0.24, 0.34, 0.45, 0.56, 0.66, 0.75, 0.83, 0.88] : [0.08, 0.3, 0.6, 0.85];
  const seg = near ? 10 : 5;
  const R = DOLPHIN_REGION;
  const ringStart: number[] = [];
  for (const t of rings) {
    const h = bodyRadius(t);
    const w = h * widthScale(t);
    // The belly is a little flatter than the back: the centre sits slightly low in front.
    const yc = t < 0.3 ? -0.2 * h * (1 - t / 0.3) : 0;
    ringStart.push(b.pos.length / 3);
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      b.vertex(sn * w, yc + c * h, t, R.body, c);
    }
  }
  // Nose and tail tips; winding: outward faces counter-clockwise.
  const nose = b.vertex(0, -0.004, 0, R.body, 0);
  const tail = b.vertex(0, 0, 0.9, R.body, 0);
  for (let s = 0; s < seg; s++) {
    const s1 = (s + 1) % seg;
    b.tri(nose, ringStart[0] + s, ringStart[0] + s1);
  }
  for (let r = 0; r + 1 < rings.length; r++) {
    const a0 = ringStart[r];
    const a1 = ringStart[r + 1];
    for (let s = 0; s < seg; s++) {
      const s1 = (s + 1) % seg;
      b.tri(a0 + s, a1 + s, a0 + s1);
      b.tri(a0 + s1, a1 + s, a1 + s1);
    }
  }
  const last = ringStart[rings.length - 1];
  for (let s = 0; s < seg; s++) {
    const s1 = (s + 1) % seg;
    b.tri(tail, last + s1, last + s);
  }

  // Dorsal fin: falcate, swept back, on the back between t 0.40 and 0.58.
  const top = (t: number): number => bodyRadius(t) * 0.95;
  {
    const f = b.vertex(0, top(0.4), 0.4, R.dorsal, 1);
    const bk = b.vertex(0, top(0.58), 0.58, R.dorsal, 1);
    const tip = b.vertex(0, top(0.58) + 0.088, 0.64, R.dorsal, 1);
    if (near) {
      const mid = b.vertex(0, top(0.47) + 0.055, 0.5, R.dorsal, 1);
      b.tri(f, mid, bk);
      b.tri(mid, tip, bk);
    } else {
      b.tri(f, tip, bk);
    }
  }
  // Pectoral fins (near only): low on the flanks behind the head, swept back and down.
  if (near) {
    for (const side of [-1, 1]) {
      const h = bodyRadius(0.24);
      const w = h * widthScale(0.24);
      const r0 = b.vertex(side * w * 0.75, -h * 0.45, 0.22, R.pectoral, 0);
      const r1 = b.vertex(side * w * 0.7, -h * 0.5, 0.29, R.pectoral, 0);
      const tip = b.vertex(side * (w + 0.075), -h * 1.05, 0.36, R.pectoral, 0);
      if (side > 0) b.tri(r0, r1, tip);
      else b.tri(r0, tip, r1);
    }
  }
  // Flukes: horizontal, swept back, notched in the middle.
  {
    const root = b.vertex(0, 0, 0.855, R.fluke, 1);
    const notch = b.vertex(0, 0, 0.965, R.fluke, 1);
    const tipL = b.vertex(-0.135, 0, 1.0, R.fluke, 1);
    const tipR = b.vertex(0.135, 0, 1.0, R.fluke, 1);
    if (near) {
      const leL = b.vertex(-0.07, 0, 0.9, R.fluke, 1);
      const leR = b.vertex(0.07, 0, 0.9, R.fluke, 1);
      b.tri(root, leL, tipL);
      b.tri(root, tipL, notch);
      b.tri(root, notch, tipR);
      b.tri(root, tipR, leR);
    } else {
      b.tri(root, tipL, notch);
      b.tri(root, notch, tipR);
    }
  }
  return b.build();
}
