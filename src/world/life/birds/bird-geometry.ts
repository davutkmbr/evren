import * as THREE from 'three';

/**
 * Low-poly gull (wingspan 1.35 m, forward -Z). Wing vertices carry aWing = (side, span distance from the shoulder,
 * segment 0 body / 1 inner / 2 outer, region) so the vertex shader can fold the wing at shoulder and wrist.
 * Regions: 0 body, 1 head/bill, 2 inner wing, 3 outer wing / primaries, 4 tail.
 */
export function buildBirdGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const wing: number[] = [];
  const idx: number[] = [];
  const v = (x: number, y: number, z: number, side: number, span: number, seg: number, region: number): number => {
    pos.push(x, y, z);
    wing.push(side, span, seg, region);
    return pos.length / 3 - 1;
  };
  const tri = (a: number, b: number, c: number): void => {
    idx.push(a, b, c);
  };

  // Body: elongated hexagonal spindle along Z.
  const ring = (z: number, rx: number, ry: number, yOff: number, region: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      out.push(v(Math.cos(a) * rx, Math.sin(a) * ry + yOff, z, 0, 0, 0, region));
    }
    return out;
  };
  const nose = v(0, 0.015, -0.3, 0, 0, 0, 1);
  const head = ring(-0.2, 0.035, 0.035, 0.012, 1);
  const chest = ring(-0.08, 0.055, 0.055, 0.0, 0);
  const belly = ring(0.06, 0.05, 0.048, -0.004, 0);
  const rump = ring(0.17, 0.028, 0.022, 0.004, 4);
  const tailEnd = v(0, 0.006, 0.28, 0, 0, 0, 4);
  const rings = [head, chest, belly, rump];
  for (let i = 0; i < 6; i++) tri(nose, head[(i + 1) % 6], head[i]);
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r];
    const b = rings[r + 1];
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      tri(a[i], a[j], b[j]);
      tri(a[i], b[j], b[i]);
    }
  }
  for (let i = 0; i < 6; i++) tri(rump[i], rump[(i + 1) % 6], tailEnd);
  // Tail fan (flat).
  const tl = v(-0.07, 0.004, 0.27, 0, 0, 0, 4);
  const tr = v(0.07, 0.004, 0.27, 0, 0, 0, 4);
  const tc = v(0, 0.004, 0.15, 0, 0, 0, 4);
  tri(tc, tr, tl);

  // Wings: inner (shoulder -> wrist) and outer (wrist -> tip) panels, swept back.
  const shoulder = 0.05;
  const wrist = 0.33;
  const tip = 0.68;
  for (const s of [-1, 1]) {
    const x = (d: number): number => s * (shoulder + d);
    const i0 = v(x(0), 0.02, -0.07, s, 0, 1, 2);
    const i1 = v(x(0), 0.02, 0.07, s, 0, 1, 2);
    const w0 = v(x(wrist - shoulder), 0.02, -0.05, s, wrist - shoulder, 1, 2);
    const w1 = v(x(wrist - shoulder), 0.02, 0.1, s, wrist - shoulder, 1, 2);
    const o0 = v(x(wrist - shoulder), 0.02, -0.05, s, wrist - shoulder, 2, 3);
    const o1 = v(x(wrist - shoulder), 0.02, 0.1, s, wrist - shoulder, 2, 3);
    const t0 = v(x(tip - shoulder), 0.02, 0.1, s, tip - shoulder, 2, 3);
    const t1 = v(x(tip - shoulder - 0.08), 0.02, 0.15, s, tip - shoulder - 0.08, 2, 3);
    if (s < 0) {
      tri(i0, w0, w1);
      tri(i0, w1, i1);
      tri(o0, t0, o1);
      tri(o1, t0, t1);
    } else {
      tri(i0, w1, w0);
      tri(i0, i1, w1);
      tri(o0, o1, t0);
      tri(o1, t1, t0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
