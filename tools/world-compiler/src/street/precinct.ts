/**
 * Aya Efimia precinct as street kit (format 1, s1-strip.md §3 heroes, cameras c07-c09): the rendered precinct wall
 * along OSM way 179197257 (barrier=wall, a closed loop around the church), 3.2 m high and 0.5 m thick with mitred
 * corners, a darker ochre band up to 1 m and a stone coping; the gabled gate with an arched fanlight, a cross and a grey
 * double door facing the junction plaza (on the c08 view ray), the wooden double gate under a moulded hood on Yasa Cd
 * (on the c09 view ray), the Sürmeli Ali Paşa fountain (1693/94: küfeki stone frame about 2.4 m wide, pointed-arch
 * niche 1.2 x 2.2 m, inscription panel, marble basin) at about (424.5, 6036.5) facing 200°, the large plane tree
 * behind the wall, and their night light (warm wash on the gate, the fountain lit warm).
 */
import { pointInRing, ringArea } from '../../../../src/world/osm/shared/geometry';
import { headingYaw } from '../instances';
import { LOD0, LOD1, type Vec3 } from '../mesh';
import type { AreaContext, CompileStep, TileContext } from '../registry';
import { inTile, streetContext, streetTile } from './common';
import { beam, obox } from './shapes';

const WALL_ID = 179197257;
const HEIGHT = 3.2;
const HALF = 0.25;
const BAND = 1.0;
/** Gate A (gabled, junction plaza) and gate B (wooden, Yasa Cd): points on the wall from the c08 / c09 view rays. */
const GATE_A = { x: 414.5, z: 6026.7, width: 2.3 };
const GATE_B = { x: 422.2, z: 6037.6, width: 1.9 };
const FOUNTAIN = { x: 424.5, z: 6036.5, heading: 200 };
const PLANE_TREE = { x: 421.5, z: 6030.5 };

interface Opening {
  seg: number;
  u0: number;
  u1: number;
}

interface WallPlan {
  ring: number[];
  /** Outward normal side: +1 = right-hand side of the ring direction. */
  out: number;
  openings: Opening[];
  /** Fountain position, pushed out of the wall along its heading so its back stands against the outer face. */
  fountain: [number, number];
}

function wallPlan(a: AreaContext): WallPlan | null {
  const known = a.shared.get('precinct') as WallPlan | null | undefined;
  if (known !== undefined) {
    return known;
  }
  const line = a.data.lines.find((l) => l.id === WALL_ID);
  let plan: WallPlan | null = null;
  if (line) {
    let ring = [...line.pts];
    if (ring.length >= 4 && Math.hypot(ring[0] - ring[ring.length - 2], ring[1] - ring[ring.length - 1]) < 0.01) {
      ring = ring.slice(0, -2);
    }
    const out = ringArea(ring) > 0 ? 1 : -1;
    const n = ring.length / 2;
    const openings: Opening[] = [];
    for (const g of [GATE_A, GATE_B]) {
      let best: Opening | null = null;
      let bestD = 3;
      for (let i = 0; i < n; i++) {
        const ax = ring[i * 2];
        const az = ring[i * 2 + 1];
        const bx = ring[((i + 1) % n) * 2];
        const bz = ring[((i + 1) % n) * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const t = Math.max(0, Math.min(1, ((g.x - ax) * (bx - ax) + (g.z - az) * (bz - az)) / (len * len)));
        const d = Math.hypot(ax + (bx - ax) * t - g.x, az + (bz - az) * t - g.z);
        if (d < bestD) {
          const hu = g.width / 2 / len;
          bestD = d;
          best = { seg: i, u0: Math.max(0.05, t - hu), u1: Math.min(0.95, t + hu) };
        }
      }
      if (best) {
        openings.push(best);
      }
    }
    // The fountain keeps the photo heading (200°); push it out along that heading until its back clears the wall.
    const outer: number[] = [];
    for (let i = 0; i < n; i++) {
      outer.push(...offsetVertex(ring, out, i, HALF + 0.02));
    }
    const h = (FOUNTAIN.heading * Math.PI) / 180;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const rx = -fz;
    const rz = fx;
    let fpos: [number, number] = [FOUNTAIN.x, FOUNTAIN.z];
    for (let push = -1; push < 3; push += 0.05) {
      const x = FOUNTAIN.x + fx * push;
      const z = FOUNTAIN.z + fz * push;
      const back = [-1.2, 0, 1.2].map((o) => [x - fx * 0.35 + rx * o, z - fz * 0.35 + rz * o]);
      if (back.every(([bx, bz]) => !pointInRing(outer, bx, bz))) {
        fpos = [x, z];
        break;
      }
    }
    plan = { ring, out, openings, fountain: fpos };
  }
  a.shared.set('precinct', plan);
  return plan;
}

/** Mitred offset point of ring vertex i at signed offset d (positive = outward). */
function offsetVertex(ring: number[], out: number, i: number, d: number): [number, number] {
  const n = ring.length / 2;
  const p = (k: number): [number, number] => [ring[((k + n) % n) * 2], ring[((k + n) % n) * 2 + 1]];
  const [px, pz] = p(i - 1);
  const [cx, cz] = p(i);
  const [nx, nz] = p(i + 1);
  const normal = (ax: number, az: number, bx: number, bz: number): [number, number] => {
    const l = Math.hypot(bx - ax, bz - az) || 1;
    return [((bz - az) / l) * out, (-(bx - ax) / l) * out];
  };
  const n1 = normal(px, pz, cx, cz);
  const n2 = normal(cx, cz, nx, nz);
  let mx = n1[0] + n2[0];
  let mz = n1[1] + n2[1];
  const ml = Math.hypot(mx, mz) || 1;
  mx /= ml;
  mz /= ml;
  const k = Math.max(0.5, mx * n2[0] + mz * n2[1]);
  return [cx + (mx * d) / k, cz + (mz * d) / k];
}

function emitWall(t: TileContext, plan: WallPlan): number {
  const sc = streetContext(t.area);
  const y = sc.groundY;
  const { ring, out } = plan;
  const n = ring.length / 2;
  let segs = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2];
    const az = ring[i * 2 + 1];
    const bx = ring[j * 2];
    const bz = ring[j * 2 + 1];
    if (!inTile(t, (ax + bx) / 2, (az + bz) / 2)) {
      continue;
    }
    segs++;
    const len = Math.hypot(bx - ax, bz - az);
    const nrm: Vec3 = [((bz - az) / len) * out, 0, (-(bx - ax) / len) * out];
    const o0 = offsetVertex(ring, out, i, HALF);
    const o1 = offsetVertex(ring, out, j, HALF);
    const i0 = offsetVertex(ring, out, i, -HALF);
    const i1 = offsetVertex(ring, out, j, -HALF);
    // Pieces of the segment between openings (u along the centre line; the offset lines are mapped the same way).
    const cuts: [number, number][] = [];
    let u = 0;
    for (const o of plan.openings.filter((q) => q.seg === i).sort((p, q) => p.u0 - q.u0)) {
      cuts.push([u, o.u0]);
      u = o.u1;
    }
    cuts.push([u, 1]);
    const lerp = (p: [number, number], q: [number, number], f: number): [number, number] => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
    for (const [f0, f1] of cuts) {
      const A = lerp(o0, o1, f0);
      const B = lerp(o0, o1, f1);
      const C = lerp(i0, i1, f0);
      const D = lerp(i0, i1, f1);
      const ya = y(A[0], A[1]);
      const yb = y(B[0], B[1]);
      const yc = y(C[0], C[1]);
      const yd = y(D[0], D[1]);
      const top = Math.max(ya, yb, yc, yd) + HEIGHT;
      const inward: Vec3 = [-nrm[0], 0, -nrm[2]];
      t.mesh.wall('st_wall_band', A[0], A[1], B[0], B[1], ya - 0.3, ya + BAND, yb - 0.3, yb + BAND, nrm);
      t.mesh.wall('st_wall_yellow', A[0], A[1], B[0], B[1], ya + BAND, top, yb + BAND, top, nrm);
      t.mesh.wall('st_wall_band', D[0], D[1], C[0], C[1], yd - 0.3, yd + BAND, yc - 0.3, yc + BAND, inward);
      t.mesh.wall('st_wall_yellow', D[0], D[1], C[0], C[1], yd + BAND, top, yc + BAND, top, inward);
      // Coping: a stone cap 0.06 m proud on both sides.
      const ox = nrm[0] * 0.06;
      const oz = nrm[2] * 0.06;
      const ct = top + 0.08;
      const pts: Vec3[] = [
        [A[0] + ox, ct, A[1] + oz],
        [B[0] + ox, ct, B[1] + oz],
        [D[0] - ox, ct, D[1] - oz],
        [C[0] - ox, ct, C[1] - oz],
      ];
      t.mesh.flatPolygon('st_wall_cap', pts, [0, 1, 0]);
      t.mesh.wall('st_wall_cap', pts[0][0], pts[0][2], pts[1][0], pts[1][2], top - 0.02, ct, top - 0.02, ct, nrm);
      t.mesh.wall('st_wall_cap', pts[2][0], pts[2][2], pts[3][0], pts[3][2], top - 0.02, ct, top - 0.02, ct, inward);
      // Jambs at openings.
      const tan: Vec3 = [(bx - ax) / len, 0, (bz - az) / len];
      if (f0 > 0) {
        t.mesh.wall('st_wall_yellow', C[0], C[1], A[0], A[1], yc - 0.3, top, ya - 0.3, top, [-tan[0], 0, -tan[2]]);
      }
      if (f1 < 1) {
        t.mesh.wall('st_wall_yellow', B[0], B[1], D[0], D[1], yb - 0.3, top, yd - 0.3, top, tan);
      }
    }
  }
  return segs;
}

/** Gabled gate A: pilasters, pediment, arched fanlight, grey double door, cross. Local frame: +Z = outward. */
function gateA(t: TileContext, x: number, z: number, heading: number, gy: number): void {
  const yaw = headingYaw(heading, '+Z');
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Prop-local (lx, ly, lz) -> world, as instances do: +Z turns to the heading.
  const w = (lx: number, ly: number, lz: number): Vec3 => [x + lx * c + lz * s, gy + ly, z - lx * s + lz * c];
  const U: Vec3 = [c, 0, -s];
  const V: Vec3 = [0, 1, 0];
  const W: Vec3 = [s, 0, c];
  const hw = GATE_A.width / 2;
  for (const side of [-1, 1]) {
    obox(t.mesh, 'st_wall_yellow', w(side * (hw + 0.3), 1.85, 0.05), U, V, W, 0.3, 2.15, 0.35);
    obox(t.mesh, 'st_wall_cap', w(side * (hw + 0.3), 3.98, 0.05), U, V, W, 0.36, 0.06, 0.42);
  }
  // Lintel wall above the opening, up to the pediment.
  obox(t.mesh, 'st_wall_yellow', w(0, 3.55, 0.0), U, V, W, hw, 0.45, 0.3);
  obox(t.mesh, 'st_wall_cap', w(0, 4.02, 0.05), U, V, W, hw + 0.66, 0.05, 0.4);
  // Pediment: triangular prism.
  const peak = 1.1;
  for (const [dz, nn] of [
    [0.36, 1],
    [-0.3, -1],
  ] as const) {
    t.mesh.flatPolygon('st_wall_yellow', [w(-hw - 0.6, 4.07, dz), w(hw + 0.6, 4.07, dz), w(0, 4.07 + peak, dz)], [W[0] * nn, 0, W[2] * nn]);
  }
  for (const side of [-1, 1]) {
    const a = w(side * (hw + 0.66), 4.07, 0.42);
    const b = w(0, 4.07 + peak + 0.06, 0.42);
    const a2 = w(side * (hw + 0.66), 4.07, -0.34);
    const b2 = w(0, 4.07 + peak + 0.06, -0.34);
    const up: Vec3 = [-side * c * 0.7, 0.7, side * s * 0.7];
    t.mesh.flatPolygon('st_wall_cap', [a, b, b2, a2], up);
  }
  // Arched fanlight over the door, the door leaves, the cross.
  const arc: Vec3[] = [];
  for (let k = 0; k <= 12; k++) {
    const ang = (k / 12) * Math.PI;
    arc.push(w(Math.cos(ang) * (hw - 0.1), 2.65 + Math.sin(ang) * (hw - 0.1) * 0.8, 0.12));
  }
  t.mesh.flatPolygon('st_fanlight', arc, W);
  for (let k = 1; k < 6; k++) {
    const ang = (k / 6) * Math.PI;
    beam(t.mesh, 'st_sign_white', w(0, 2.65, 0.14), w(Math.cos(ang) * (hw - 0.1), 2.65 + Math.sin(ang) * (hw - 0.1) * 0.8, 0.14), 0.03, 0.02);
  }
  obox(t.mesh, 'st_gate_grey', w(-hw / 2, 1.3, 0.05), U, V, W, hw / 2 - 0.02, 1.32, 0.04);
  obox(t.mesh, 'st_gate_grey', w(hw / 2, 1.3, 0.05), U, V, W, hw / 2 - 0.02, 1.32, 0.04);
  obox(t.mesh, 'st_sign_white', w(0, 4.07 + peak + 0.45, 0.05), U, V, W, 0.04, 0.4, 0.04);
  obox(t.mesh, 'st_sign_white', w(0, 4.07 + peak + 0.55, 0.05), U, V, W, 0.22, 0.04, 0.04);
}

/** Wooden gate B under a moulded hood. */
function gateB(t: TileContext, x: number, z: number, heading: number, gy: number): void {
  const yaw = headingYaw(heading, '+Z');
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const w = (lx: number, ly: number, lz: number): Vec3 => [x + lx * c + lz * s, gy + ly, z - lx * s + lz * c];
  const U: Vec3 = [c, 0, -s];
  const V: Vec3 = [0, 1, 0];
  const W: Vec3 = [s, 0, c];
  const hw = GATE_B.width / 2;
  obox(t.mesh, 'st_gate_wood', w(-hw / 2, 1.25, 0.0), U, V, W, hw / 2 - 0.02, 1.25, 0.05);
  obox(t.mesh, 'st_gate_wood', w(hw / 2, 1.25, 0.0), U, V, W, hw / 2 - 0.02, 1.25, 0.05);
  obox(t.mesh, 'st_wall_yellow', w(0, 2.85, 0), U, V, W, hw, 0.35, 0.25);
  for (const side of [-1, 1]) {
    obox(t.mesh, 'st_wall_cap', w(side * (hw + 0.08), 1.3, 0.26), U, V, W, 0.1, 1.3, 0.03);
  }
  // Hood: a moulded slab on two brackets.
  obox(t.mesh, 'st_wall_cap', w(0, 2.78, 0.42), U, V, W, hw + 0.45, 0.07, 0.2);
  obox(t.mesh, 'st_wall_cap', w(0, 2.9, 0.38), U, V, W, hw + 0.35, 0.05, 0.16);
  for (const side of [-1, 1]) {
    obox(t.mesh, 'st_wall_cap', w(side * (hw + 0.2), 2.55, 0.35), U, V, W, 0.07, 0.18, 0.1);
  }
}

/** Sürmeli Ali Paşa fountain: küfeki frame with a pointed-arch niche, inscription panel, marble basin. */
function fountain(t: TileContext, x: number, z: number, heading: number, gy: number): void {
  const yaw = headingYaw(heading, '+Z');
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const w = (lx: number, ly: number, lz: number): Vec3 => [x + lx * c + lz * s, gy + ly, z - lx * s + lz * c];
  const U: Vec3 = [c, 0, -s];
  const V: Vec3 = [0, 1, 0];
  const W: Vec3 = [s, 0, c];
  // Frame: two piers and the head block, 0.7 m deep, 2.4 m wide, 3.3 m high; the niche is the gap 1.2 m wide.
  obox(t.mesh, 'st_kufeki', w(-0.9, 1.3, 0), U, V, W, 0.3, 1.3, 0.35);
  obox(t.mesh, 'st_kufeki', w(0.9, 1.3, 0), U, V, W, 0.3, 1.3, 0.35);
  obox(t.mesh, 'st_kufeki', w(0, 2.95, 0), U, V, W, 1.2, 0.35, 0.35);
  obox(t.mesh, 'st_kufeki', w(0, 3.36, 0.05), U, V, W, 1.32, 0.06, 0.42);
  // Pointed arch: two leaning stones closing the niche top (2.2 m).
  for (const side of [-1, 1]) {
    t.mesh.flatPolygon('st_kufeki', [w(side * 0.6, 1.75, 0.34), w(side * 0.6, 2.6, 0.34), w(0, 2.6, 0.34), w(0, 2.22, 0.34), w(side * 0.35, 2.05, 0.34)], W);
  }
  // Niche back wall (recessed 0.35 m) and its floor, darker stone.
  obox(t.mesh, 'st_kufeki', w(0, 1.1, -0.2), U, V, W, 0.6, 1.1, 0.15);
  // Inscription panel with a gilt border.
  obox(t.mesh, 'st_inscription', w(0, 2.95, 0.36), U, V, W, 0.72, 0.25, 0.02);
  for (const dy of [-0.26, 0.26]) {
    obox(t.mesh, 'st_gilt', w(0, 2.95 + dy, 0.37), U, V, W, 0.75, 0.015, 0.02);
  }
  // Spout and the marble basin (trough) in front of the niche.
  beam(t.mesh, 'st_gilt', w(0, 1.05, 0.05), w(0, 1.02, 0.28), 0.03, 0.03);
  obox(t.mesh, 'st_marble', w(0, 0.22, 0.55), U, V, W, 0.62, 0.22, 0.22);
  obox(t.mesh, 'st_groove', w(0, 0.445, 0.55), U, V, W, 0.52, 0.004, 0.14);
}

export const precinctStep: CompileStep = {
  id: 'streetPrecinct',
  tile(t) {
    if (!streetTile(t)) {
      return;
    }
    const plan = wallPlan(t.area);
    if (!plan) {
      return;
    }
    const sc = streetContext(t.area);
    const segs = t.mesh.withLod(LOD0 | LOD1, () => emitWall(t, plan));
    const n = plan.ring.length / 2;
    let gates = 0;
    t.mesh.withLod(LOD0, () => {
      plan.openings.forEach((o, k) => {
        const i = o.seg;
        const j = (i + 1) % n;
        const ax = plan.ring[i * 2];
        const az = plan.ring[i * 2 + 1];
        const bx = plan.ring[j * 2];
        const bz = plan.ring[j * 2 + 1];
        const u = (o.u0 + o.u1) / 2;
        const x = ax + (bx - ax) * u;
        const z = az + (bz - az) * u;
        if (!inTile(t, x, z)) {
          return;
        }
        const len = Math.hypot(bx - ax, bz - az);
        const nx = ((bz - az) / len) * plan.out;
        const nz = (-(bx - ax) / len) * plan.out;
        const heading = ((Math.atan2(nx, -nz) * 180) / Math.PI + 360) % 360;
        const gy = Math.min(sc.groundY(x + nx, z + nz), sc.groundY(x - nx, z - nz));
        (k === 0 ? gateA : gateB)(t, x, z, heading, gy);
        gates++;
        if (k === 0) {
          t.lights.add({ type: 'spot', position: [x + nx * 1.2, gy + 4.6, z + nz * 1.2], direction: [-nx * 0.35, -0.94, -nz * 0.35], kelvin: 3000, lumens: 1400, cone: { inner: 30, outer: 65 }, night: true, source: 'other', ref: 'precinct/gateA' });
        }
      });
      const [qx, qz] = plan.fountain;
      if (inTile(t, qx, qz)) {
        const gy = sc.groundY(qx, qz);
        fountain(t, qx, qz, FOUNTAIN.heading, gy);
        const h = (FOUNTAIN.heading * Math.PI) / 180;
        const fx = Math.sin(h);
        const fz = -Math.cos(h);
        t.lights.add({ type: 'spot', position: [qx + fx * 1.6, gy + 3.4, qz + fz * 1.6], direction: [-fx * 0.55, -0.83, -fz * 0.55], kelvin: 2700, lumens: 1200, cone: { inner: 25, outer: 55 }, night: true, source: 'other', ref: 'precinct/fountain' });
      }
    });
    if (inTile(t, PLANE_TREE.x, PLANE_TREE.z)) {
      t.place('st_tree', [PLANE_TREE.x, sc.groundY(PLANE_TREE.x, PLANE_TREE.z), PLANE_TREE.z], 0.7, { variant: 'plane', ref: 'precinct/plane-tree' });
    }
    if (segs || gates) {
      t.record('streetPrecinct', { wallSegments: segs, gates, fountain: inTile(t, plan.fountain[0], plan.fountain[1]) ? plan.fountain.map((v) => Math.round(v * 100) / 100) : null });
    }
  },
};
