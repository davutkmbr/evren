/**
 * Procedural vehicles for the Rıhtım Cd traffic (s1-strip.md §3, c05 photo; S1 round 2 street lane, item 4): static
 * props, +Z = front, foot at the origin (centre of the wheelbase on the road), no brands or lettering:
 * - `taxi`: yellow sedan (4.6 × 1.78 m) with a plain roof light box;
 * - `car`: the same sedan in white, grey or dark blue (variants car_white, car_grey, car_blue);
 * - `dolmus`: yellow minibus (6.3 × 2.05 × 2.6 m) with a band of side windows (the Kadıköy dolmuş);
 * - `van`: white panel van (5.6 × 2.0 × 2.5 m) with a glazed cab only (delivery van, c05 photo).
 * Bodies are lofts of chamfered cross-sections along +Z (profile per station), with glass, wheels, lights, bumpers,
 * mirrors and plates; about 1.2-1.8k triangles each.
 */
import type { MaterialDef } from '../materials';
import type { MaterialName } from '../materials';
import type { PropDef } from '../props';
import type { TileMesh, Vec3 } from '../mesh';
import { aabox, obox } from './shapes';

export const VEHICLE_MATERIALS: MaterialDef[] = [
  { id: 'st_car_yellow', color: 0xe3b20c, metallic: 0.25, roughness: 0.32, surface: 'metal', castShadow: true },
  { id: 'st_car_white', color: 0xe6e6e2, metallic: 0.2, roughness: 0.35, surface: 'metal', castShadow: true },
  { id: 'st_car_grey', color: 0x8b8f93, metallic: 0.5, roughness: 0.33, surface: 'metal', castShadow: true },
  { id: 'st_car_blue', color: 0x263550, metallic: 0.45, roughness: 0.33, surface: 'metal', castShadow: true },
  { id: 'st_car_glass', color: 0x14191d, metallic: 0.3, roughness: 0.06, surface: 'glass', castShadow: true },
  { id: 'st_car_trim', color: 0x151515, roughness: 0.65, surface: 'other', castShadow: true },
  { id: 'st_car_tyre', color: 0x141414, roughness: 0.92, surface: 'other', castShadow: true },
  { id: 'st_car_rim', color: 0x9fa3a6, metallic: 0.8, roughness: 0.35, surface: 'metal', castShadow: true },
  { id: 'st_car_plate', color: 0xf0f0ec, roughness: 0.5, surface: 'other', castShadow: false },
  { id: 'st_car_head', color: 0xdfe3e6, roughness: 0.1, surface: 'glass', castShadow: false, emissive: { color: 0xfff1dc, nits: 18000, night: true, source: 'lamp' } },
  { id: 'st_car_tail', color: 0x5a0808, roughness: 0.2, surface: 'glass', castShadow: false, emissive: { color: 0xff2010, nits: 900, night: true, source: 'other' } },
];

type XY = [number, number];

/** Chamfered cross-section: half width hw, from y0 to y1, corner chamfers cb (bottom) and ct (top). */
function section(hw: number, y0: number, y1: number, cb: number, ct: number): XY[] {
  return [
    [hw - cb, y0],
    [hw, y0 + cb],
    [hw, y1 - ct],
    [hw - ct, y1],
    [-(hw - ct), y1],
    [-hw, y1 - ct],
    [-hw, y0 + cb],
    [-(hw - cb), y0],
  ];
}

/** Loft of equal-size cross-sections at stations along +Z, flat-shaded, with capped ends. */
function loftZ(mesh: TileMesh, m: MaterialName, stations: { z: number; s: XY[] }[]): void {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = stations[0].s.length;
  for (let k = 0; k + 1 < stations.length; k++) {
    const A = stations[k];
    const B = stations[k + 1];
    for (let q = 0; q < n; q++) {
      const a0: Vec3 = [A.s[q][0], A.s[q][1], A.z];
      const a1: Vec3 = [A.s[(q + 1) % n][0], A.s[(q + 1) % n][1], A.z];
      const b0: Vec3 = [B.s[q][0], B.s[q][1], B.z];
      const b1: Vec3 = [B.s[(q + 1) % n][0], B.s[(q + 1) % n][1], B.z];
      const base = pos.length / 3;
      pos.push(...a0, ...a1, ...b1, ...b0);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  // Orient every face outwards (away from the loft axis at its height).
  for (let t = 0; t < idx.length; t += 3) {
    const [i, j, k] = [idx[t], idx[t + 1], idx[t + 2]];
    const ux = pos[j * 3] - pos[i * 3];
    const uy = pos[j * 3 + 1] - pos[i * 3 + 1];
    const uz = pos[j * 3 + 2] - pos[i * 3 + 2];
    const vx = pos[k * 3] - pos[i * 3];
    const vy = pos[k * 3 + 1] - pos[i * 3 + 1];
    const vz = pos[k * 3 + 2] - pos[i * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const cx = (pos[i * 3] + pos[j * 3] + pos[k * 3]) / 3;
    const cy = (pos[i * 3 + 1] + pos[j * 3 + 1] + pos[k * 3 + 1]) / 3;
    const nz = ux * vy - uy * vx;
    const my = stations.reduce((s, st) => s + st.s.reduce((q, p) => q + p[1], 0) / n, 0) / stations.length;
    if (nx * cx + ny * (cy - my) + nz * 0 < 0) {
      idx[t + 1] = k;
      idx[t + 2] = j;
    }
  }
  mesh.addMesh(m, { positions: pos, indices: idx });
  for (const [st, dir] of [
    [stations[0], -1],
    [stations[stations.length - 1], 1],
  ] as const) {
    const pts: Vec3[] = st.s.map((p): Vec3 => [p[0], p[1], st.z]);
    const tris: number[] = [];
    for (let q = 1; q + 1 < n; q++) {
      tris.push(0, q, q + 1);
    }
    mesh.flatTriangles(m, pts, tris, [0, 0, dir]);
  }
}

/** Wheel: tyre (12-sided drum with rounded shoulders) and rim, axle along X, centre (x, r, z). */
function wheel(mesh: TileMesh, x: number, z: number, r: number, w: number, outside: number): void {
  const seg = 14;
  const prof: XY[] = [
    [r * 0.62, -w / 2],
    [r * 0.93, -w / 2],
    [r, -w / 2 + w * 0.2],
    [r, w / 2 - w * 0.2],
    [r * 0.93, w / 2],
    [r * 0.62, w / 2],
  ];
  const pos: number[] = [];
  const idx: number[] = [];
  const nrm: number[] = [];
  for (const [rad, ax] of prof) {
    for (let q = 0; q < seg; q++) {
      const a = (q / seg) * Math.PI * 2;
      pos.push(x + ax, r + Math.cos(a) * rad, z + Math.sin(a) * rad);
      nrm.push(0, Math.cos(a), Math.sin(a));
    }
  }
  for (let k = 0; k + 1 < prof.length; k++) {
    for (let q = 0; q < seg; q++) {
      const a = k * seg + q;
      const b = k * seg + ((q + 1) % seg);
      idx.push(a, b, a + seg, b, b + seg, a + seg);
    }
  }
  mesh.addMesh('st_car_tyre', { positions: pos, indices: idx, normals: nrm });
  // Rim disc on the outer face, slightly recessed.
  const face = x + (outside * w) / 2 - outside * 0.02;
  const rim: Vec3[] = [];
  for (let q = 0; q < seg; q++) {
    const a = (q / seg) * Math.PI * 2;
    rim.push([face, r + Math.cos(a) * r * 0.62, z + Math.sin(a) * r * 0.62]);
  }
  const tris: number[] = [];
  for (let q = 1; q + 1 < seg; q++) {
    tris.push(0, q, q + 1);
  }
  mesh.flatTriangles('st_car_rim', rim, tris, [outside, 0, 0]);
}

function sedan(mesh: TileMesh, paint: MaterialName, taxi: boolean): void {
  const hw = 0.89;
  // Lower body: bumper, hood, belt line, boot (station z, top y, half-width factor).
  const lower: [number, number, number][] = [
    [-2.3, 0.72, 0.9],
    [-2.18, 0.93, 0.97],
    [-1.6, 0.97, 1],
    [-1.2, 0.95, 1],
    [0.95, 0.93, 1],
    [1.55, 0.86, 1],
    [2.1, 0.76, 0.97],
    [2.3, 0.62, 0.9],
  ];
  loftZ(mesh, paint, lower.map(([z, y, f]) => ({ z, s: section(hw * f, 0.26, y, 0.1, 0.07) })));
  // Greenhouse: glass from the windscreen to the rear screen, the roof in paint.
  const glass: [number, number, number][] = [
    [-1.5, 0.95, 0.91],
    [-0.95, 1.4, 0.76],
    [0.15, 1.44, 0.76],
    [0.95, 0.94, 0.91],
  ];
  loftZ(mesh, 'st_car_glass', glass.map(([z, y, f]) => ({ z, s: section(hw * f, 0.9, y, 0.02, 0.1) })));
  loftZ(mesh, paint, [
    { z: -0.9, s: section(hw * 0.74, 1.4, 1.46, 0.01, 0.05) },
    { z: 0.1, s: section(hw * 0.74, 1.42, 1.48, 0.01, 0.05) },
  ]);
  // Pillars (paint) over the glass: A, B and C.
  for (const side of [-1, 1]) {
    obox(mesh, paint, [side * hw * 0.84, 1.18, 0.55], [0, 0.46, -0.8].map((v) => v / Math.hypot(0.46, 0.8)) as Vec3, [side, 0, 0], [0, 0.8, 0.46].map((v) => v / Math.hypot(0.46, 0.8)) as Vec3, 0.27, 0.015, 0.05);
    obox(mesh, paint, [side * hw * 0.82, 1.17, -0.38], [0, 1, 0], [side, 0, 0], [0, 0, 1], 0.24, 0.015, 0.06);
    obox(mesh, paint, [side * hw * 0.84, 1.17, -1.2], [0, 0.45, 0.55].map((v) => v / Math.hypot(0.45, 0.55)) as Vec3, [side, 0, 0], [0, -0.55, 0.45].map((v) => v / Math.hypot(0.45, 0.55)) as Vec3, 0.28, 0.015, 0.09);
    // Mirror.
    aabox(mesh, 'st_car_trim', [side > 0 ? hw : -hw - 0.16, 0.98, 0.72], [side > 0 ? hw + 0.16 : -hw, 1.08, 0.8]);
  }
  // Bumpers, lights, plates.
  aabox(mesh, 'st_car_trim', [-hw * 0.9, 0.26, 2.22], [hw * 0.9, 0.42, 2.34]);
  aabox(mesh, 'st_car_trim', [-hw * 0.9, 0.26, -2.34], [hw * 0.9, 0.42, -2.22]);
  for (const side of [-1, 1]) {
    aabox(mesh, 'st_car_head', [side > 0 ? 0.48 : -0.8, 0.62, 2.2], [side > 0 ? 0.8 : -0.48, 0.72, 2.28]);
    aabox(mesh, 'st_car_tail', [side > 0 ? 0.5 : -0.84, 0.8, -2.24], [side > 0 ? 0.84 : -0.5, 0.9, -2.16]);
  }
  aabox(mesh, 'st_car_plate', [-0.26, 0.44, 2.33], [0.26, 0.55, 2.345]);
  aabox(mesh, 'st_car_plate', [-0.26, 0.6, -2.3], [0.26, 0.71, -2.285]);
  for (const [x, z] of [
    [-0.78, 1.38],
    [0.78, 1.38],
    [-0.78, -1.32],
    [0.78, -1.32],
  ]) {
    wheel(mesh, x, z, 0.31, 0.2, Math.sign(x));
  }
  if (taxi) {
    // Roof light box (plain, no lettering) on a black base.
    aabox(mesh, 'st_car_trim', [-0.3, 1.47, -0.42], [0.3, 1.5, -0.18]);
    aabox(mesh, 'st_car_plate', [-0.28, 1.5, -0.4], [0.28, 1.64, -0.2]);
  }
}

/** Minibus / van body: a tall loft with a raked nose; `windows` puts a band of side windows along the saloon. */
function tallBody(mesh: TileMesh, paint: MaterialName, L: number, H: number, windows: boolean, stripe: MaterialName | null): void {
  const hw = 1.0;
  const zf = L / 2;
  const zr = -L / 2;
  const st: [number, number, number][] = [
    [zr, H - 0.05, 0.98],
    [zr + 0.08, H, 1],
    [zf - 1.25, H, 1],
    [zf - 0.85, H - 0.28, 0.99],
    [zf - 0.3, 1.25, 0.98],
    [zf - 0.05, 1.05, 0.95],
    [zf, 0.62, 0.93],
  ];
  loftZ(mesh, paint, st.map(([z, y, f]) => ({ z, s: section(hw * f, 0.34, y, 0.12, 0.12) })));
  const d = 0.006;
  // Windscreen (raked) and cab side windows.
  const wz0 = zf - 0.85;
  const wz1 = zf - 0.32;
  mesh.flatPolygon('st_car_glass', [
    [-hw * 0.9, 1.3, wz1 + d],
    [hw * 0.9, 1.3, wz1 + d],
    [hw * 0.9, H - 0.36, wz0 + d],
    [-hw * 0.9, H - 0.36, wz0 + d],
  ], [0, (wz1 - wz0) / Math.hypot(wz1 - wz0, H - 1.66), (H - 1.66) / Math.hypot(wz1 - wz0, H - 1.66)]);
  for (const side of [-1, 1]) {
    const x = side * (hw + d);
    const win = (z0: number, z1: number, y0: number, y1: number): void =>
      mesh.flatPolygon('st_car_glass', [
        [x, y0, z0],
        [x, y0, z1],
        [x, y1, z1],
        [x, y1, z0],
      ], [side, 0, 0]);
    win(zf - 1.35, zf - 0.55, 1.3, H - 0.45);
    if (windows) {
      for (let z = zr + 0.35; z + 0.9 < zf - 1.5; z += 1.02) {
        win(z, z + 0.9, 1.35, H - 0.5);
      }
    }
    if (stripe) {
      mesh.flatPolygon(stripe, [
        [x + side * 0.002, 0.95, zr + 0.1],
        [x + side * 0.002, 0.95, zf - 0.4],
        [x + side * 0.002, 1.08, zf - 0.4],
        [x + side * 0.002, 1.08, zr + 0.1],
      ], [side, 0, 0]);
    }
    aabox(mesh, 'st_car_trim', [side > 0 ? hw : -hw - 0.2, 1.55, zf - 0.75], [side > 0 ? hw + 0.2 : -hw, 1.8, zf - 0.68]);
  }
  // Rear doors' glass on the minibus, a plain rear on the van.
  if (windows) {
    mesh.flatPolygon('st_car_glass', [
      [hw * 0.8, 1.4, zr - d],
      [-hw * 0.8, 1.4, zr - d],
      [-hw * 0.8, H - 0.45, zr - d],
      [hw * 0.8, H - 0.45, zr - d],
    ], [0, 0, -1]);
  }
  aabox(mesh, 'st_car_trim', [-hw * 0.95, 0.3, zf - 0.02], [hw * 0.95, 0.5, zf + 0.1]);
  aabox(mesh, 'st_car_trim', [-hw * 0.95, 0.3, zr - 0.1], [hw * 0.95, 0.5, zr + 0.02]);
  for (const side of [-1, 1]) {
    aabox(mesh, 'st_car_head', [side > 0 ? 0.55 : -0.85, 0.72, zf - 0.04], [side > 0 ? 0.85 : -0.55, 0.86, zf + 0.01]);
    aabox(mesh, 'st_car_tail', [side > 0 ? 0.82 : -0.98, 0.7, zr - 0.02], [side > 0 ? 0.98 : -0.82, 1.1, zr + 0.01]);
  }
  aabox(mesh, 'st_car_plate', [-0.26, 0.52, zf + 0.1], [0.26, 0.63, zf + 0.115]);
  aabox(mesh, 'st_car_plate', [-0.26, 0.55, zr - 0.115], [0.26, 0.66, zr - 0.1]);
  for (const [x, z] of [
    [-0.86, zf - 0.95],
    [0.86, zf - 0.95],
    [-0.86, zr + 1.05],
    [0.86, zr + 1.05],
  ]) {
    wheel(mesh, x, z, 0.34, 0.22, Math.sign(x));
  }
}

export const VEHICLE_PROPS: PropDef[] = [
  {
    id: 'st_vehicle',
    drawDistance: 250,
    castShadow: true,
    build: (b) => {
      b.variant('taxi', (m) => sedan(m, 'st_car_yellow', true));
      b.variant('car_white', (m) => sedan(m, 'st_car_white', false));
      b.variant('car_grey', (m) => sedan(m, 'st_car_grey', false));
      b.variant('car_blue', (m) => sedan(m, 'st_car_blue', false));
      b.variant('dolmus', (m) => tallBody(m, 'st_car_yellow', 6.3, 2.6, true, 'st_car_trim'));
      b.variant('van', (m) => tallBody(m, 'st_car_white', 5.6, 2.5, false, null));
    },
  },
];

/** Vehicle footprint half-lengths (m) by variant, for spacing in the lane. */
export const VEHICLE_HALF_LENGTH: Record<string, number> = { taxi: 2.35, car_white: 2.35, car_grey: 2.35, car_blue: 2.35, dolmus: 3.2, van: 2.85 };
