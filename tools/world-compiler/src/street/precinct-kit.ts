/**
 * The two hero pieces of the Aya Efimia precinct wall (precinct.ts), built with the hero kit (hero/kit.ts) from the
 * photos c08-day, c09-day / c09-night and context/fountain-night-close, context/church-gate-2011:
 * - Sürmeli Ali Paşa Çeşmesi (1693/94): a smooth light-grey küfeki ashlar front 2.5 m wide and 3.6 m high set flush
 *   into the wall (0.28 m proud), a raised border, a pointed-arch niche 1.2 m wide with ablaq voussoirs (alternating
 *   light and dark stones) and ablaq jamb courses, a spout plaque in the niche, two carved rosettes flanking a black
 *   inscription panel with gilt calligraphy strokes (not lit), a moulded cornice and a marble trough;
 * - gate A on the junction plaza: a rendered gate house projecting 0.12 m from the wall with a segmental gable edged
 *   in red tiles, a round-arched opening with an iron-grille fanlight (warm glass behind the grille, lit at night)
 *   and a gilt cross, a painted steel double door (plank grooves, two brass bands, ring handles), a dark board over
 *   the arch and a white cross on the gable.
 * Frames: u = outward (the piece faces its heading), v right of it; faces use the kit's (s, y, d).
 */
import { archCurve, Batch, faceBox, type Face, Frame, grow, type Opening, outline, riseOf, shape, span, type V2, wall } from '../hero/kit';
import type { TileMesh } from '../mesh';

const KUFEKI = 'st_kufeki';
const KUFEKI_DARK = 'st_kufeki_dark';

/** Front face of a piece at u = d0 (the outer wall face plus its projection), s centred (s = 0 on the axis). */
function frontFace(f: Frame, half: number, d0: number): { face: Face; s: (c: number) => number } {
  const sp = span(f, [d0, half], [d0, -half]);
  return { face: sp.face, s: (c: number) => c + half };
}

/** Ablaq voussoirs round an arch: `n` stones between the opening and the opening grown by `w`, alternating stone. */
function voussoirs(mesh: TileMesh, face: Face, o: Opening, w: number, n: number, d: number): void {
  const inner = archCurve(o, n * 4);
  const outer = archCurve(grow(o, w), n * 4);
  for (let k = 0; k < n; k++) {
    const a = k * 4;
    const b = (k + 1) * 4;
    const poly: V2[] = [...inner.slice(a, b + 1), ...outer.slice(a, b + 1).reverse()];
    shape(mesh, k % 2 ? KUFEKI_DARK : KUFEKI, face, poly, [], d);
  }
}

/** Sürmeli Ali Paşa fountain at (x, z) facing `heading` (its back on the wall face), ground gy. */
export function buildFountain(mesh: TileMesh, x: number, z: number, heading: number, gy: number): void {
  const f = new Frame(x, z, gy, heading);
  const batch = new Batch(mesh);
  const HALF = 1.25;
  const D = 0.28;
  const TOP = 3.85;
  const { face, s } = frontFace(f, HALF, D);
  const niche: Opening = { s: s(0), w: 1.2, y0: 0.62, ys: 1.95, kind: 'pointed', rise: 0.78 };
  // Front with the niche cut, the sides back to the wall, the niche reveal and back.
  wall(mesh, KUFEKI, face, 0, 2 * HALF, -0.2, TOP, [niche]);
  for (const side of [-1, 1]) {
    const sp = side < 0 ? span(f, [0, -HALF], [D, -HALF]) : span(f, [D, HALF], [0, HALF]);
    wall(mesh, KUFEKI, sp.face, 0, sp.len, -0.2, TOP);
  }
  const b = batch.of(KUFEKI);
  const loop = outline(niche, 16);
  // Reveal: from the front back to the niche wall 0.26 m deep (just in front of the precinct wall's face).
  for (let k = 0; k < loop.length; k++) {
    const p = loop[k];
    const q = loop[(k + 1) % loop.length];
    const ds = q[0] - p[0];
    const dy = q[1] - p[1];
    const l = Math.hypot(ds, dy) || 1;
    const n = face.dir(-dy / l, ds / l, 0);
    b.flatQuad([face.p(p[0], p[1], 0), face.p(q[0], q[1], 0), face.p(q[0], q[1], -0.26), face.p(p[0], p[1], -0.26)], n);
  }
  shape(mesh, KUFEKI, face, loop, [], -0.26);
  // Ablaq voussoirs and jamb courses.
  voussoirs(mesh, face, niche, 0.24, 9, 0.012);
  for (const side of [-1, 1]) {
    const s0 = side < 0 ? niche.s - niche.w / 2 - 0.24 : niche.s + niche.w / 2;
    for (let k = 0; k < 5; k++) {
      const y0 = niche.y0 + (k * (niche.ys - niche.y0)) / 5;
      const y1 = niche.y0 + ((k + 1) * (niche.ys - niche.y0)) / 5;
      shape(mesh, k % 2 ? KUFEKI_DARK : KUFEKI, face, [[s0, y0], [s0 + 0.24, y0], [s0 + 0.24, y1], [s0, y1]], [], 0.012);
    }
  }
  // Raised border round the front and the cornice.
  const tb = batch.of(KUFEKI);
  faceBox(tb, face, 0.05, 0.2, 0, TOP - 0.1, -0.01, 0.05, false, false);
  faceBox(tb, face, 2 * HALF - 0.2, 2 * HALF - 0.05, 0, TOP - 0.1, -0.01, 0.05, false, false);
  faceBox(tb, face, 0.05, 2 * HALF - 0.05, TOP - 0.25, TOP - 0.1, -0.01, 0.05);
  faceBox(tb, face, -0.08, 2 * HALF + 0.08, TOP - 0.1, TOP, -0.3, 0.1);
  faceBox(tb, face, -0.14, 2 * HALF + 0.14, TOP, TOP + 0.1, -0.3, 0.16);
  // Rosettes flanking the inscription: a disc with eight petals.
  for (const side of [-1, 1]) {
    const cs = s(side * 0.82);
    const cy = 3.28;
    const disc: V2[] = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const r = 0.22 * (0.82 + 0.18 * Math.cos(a * 8));
      disc.push([cs + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    shape(mesh, KUFEKI, face, disc, [], 0.035);
    const rim = batch.of(KUFEKI);
    for (let k = 0; k < disc.length; k++) {
      const p = disc[k];
      const q = disc[(k + 1) % disc.length];
      const ds = q[0] - p[0];
      const dy = q[1] - p[1];
      const l = Math.hypot(ds, dy) || 1;
      rim.flatQuad([face.p(p[0], p[1], 0), face.p(q[0], q[1], 0), face.p(q[0], q[1], 0.035), face.p(p[0], p[1], 0.035)], face.dir(dy / l, -ds / l, 0));
    }
    const core: V2[] = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      core.push([cs + Math.cos(a) * 0.06, cy + Math.sin(a) * 0.06]);
    }
    shape(mesh, KUFEKI_DARK, face, core, [], 0.045);
  }
  // Inscription panel: black with a gilt border and gilt calligraphy strokes.
  const p0 = s(-0.52);
  const p1 = s(0.52);
  const y0 = 3.05;
  const y1 = 3.52;
  faceBox(batch.of('st_inscription'), face, p0, p1, y0, y1, -0.01, 0.03);
  const gilt = batch.of('st_gilt');
  faceBox(gilt, face, p0 - 0.03, p1 + 0.03, y0 - 0.03, y0, -0.01, 0.035);
  faceBox(gilt, face, p0 - 0.03, p1 + 0.03, y1, y1 + 0.03, -0.01, 0.035);
  faceBox(gilt, face, p0 - 0.03, p0, y0, y1, -0.01, 0.035, false, false);
  faceBox(gilt, face, p1, p1 + 0.03, y0, y1, -0.01, 0.035, false, false);
  const stroke = (pts: V2[]): void => {
    for (let k = 0; k + 1 < pts.length; k++) {
      const [sa, ya] = pts[k];
      const [sb, yb] = pts[k + 1];
      const l = Math.hypot(sb - sa, yb - ya) || 1;
      const px = (-(yb - ya) / l) * 0.009;
      const py = ((sb - sa) / l) * 0.009;
      gilt.flatQuad([face.p(sa - px, ya - py, 0.033), face.p(sb - px, yb - py, 0.033), face.p(sb + px, yb + py, 0.033), face.p(sa + px, ya + py, 0.033)], face.n);
    }
  };
  for (let row = 0; row < 2; row++) {
    const yb = y0 + 0.12 + row * 0.22;
    for (let k = 0; k < 6; k++) {
      const sx = p0 + 0.1 + k * 0.15;
      const hh = 0.08 + 0.1 * ((k * 7 + row * 3) % 5) / 4;
      stroke([
        [sx, yb],
        [sx + 0.02, yb + hh],
        [sx + 0.05, yb + hh * 0.6],
      ]);
      stroke([
        [sx - 0.03, yb + 0.01],
        [sx + 0.04, yb - 0.02],
        [sx + 0.11, yb + 0.02],
      ]);
    }
  }
  // Spout plaque in the niche with a brass spout.
  const plq = batch.of(KUFEKI_DARK);
  faceBox(plq, face, s(-0.18), s(0.18), 1.02, 1.4, -0.26, -0.23);
  const spout = batch.of('st_gilt');
  faceBox(spout, face, s(-0.018), s(0.018), 1.1, 1.14, -0.23, -0.08);
  // Marble trough in front of the niche: outer box, hollow top, a recessed front panel.
  const m = batch.of('st_marble');
  const t0 = s(-0.68);
  const t1 = s(0.68);
  faceBox(m, face, t0, t1, -0.1, 0.58, 0, 0.62);
  faceBox(batch.of('st_groove'), face, t0 + 0.08, t1 - 0.08, 0.5, 0.585, 0.08, 0.54, false, false);
  faceBox(m, face, t0 + 0.12, t1 - 0.12, 0.1, 0.46, 0.62, 0.64);
  batch.flush();
}

/** Gate A (junction plaza) at (x, z) on the wall centre line facing `heading`, ground gy; wall half thickness `hw`. */
export function buildGateA(mesh: TileMesh, x: number, z: number, heading: number, gy: number, wallHalf: number, openingW: number): void {
  const f = new Frame(x, z, gy, heading);
  const batch = new Batch(mesh);
  const HALF = 2.1;
  const D = wallHalf + 0.12;
  const EAVE = 4.3;
  const RISE = 0.55;
  const { face, s } = frontFace(f, HALF, D);
  const W = Math.min(2.24, openingW - 0.06);
  const door: Opening = { s: s(0), w: W, y0: -0.2, ys: 2.5, kind: 'round', door: true };
  // Front with the segmental gable: the top edge rises RISE to the centre.
  const topAt = (c: number): number => EAVE + RISE * (1 - (c / HALF) ** 2);
  const contour: V2[] = [];
  const doorLoop = outline(door, 16);
  contour.push([0, -0.2]);
  contour.push([doorLoop[0][0], -0.2], ...doorLoop.slice(2).reverse(), [doorLoop[1][0], -0.2]);
  contour.push([2 * HALF, -0.2]);
  for (let k = 16; k >= 0; k--) {
    const c = -HALF + (2 * HALF * k) / 16;
    contour.push([s(c), topAt(c)]);
  }
  shape(mesh, 'st_wall_yellow', face, contour, [], 0);
  // Sides back to the wall, a back face on the precinct side (plain), the reveal through the gate house.
  for (const side of [-1, 1]) {
    const sp = side < 0 ? span(f, [-wallHalf, -HALF], [D, -HALF]) : span(f, [D, HALF], [-wallHalf, HALF]);
    wall(mesh, 'st_wall_yellow', sp.face, 0, sp.len, -0.2, EAVE);
  }
  const back = frontFace(f, HALF, -wallHalf);
  shape(mesh, 'st_wall_yellow', back.face, contour.map(([a, b]) => [2 * HALF - a, b] as V2), [], 0, true);
  const rb = batch.of('st_wall_yellow');
  const depth = D + wallHalf;
  for (let k = 2; k < doorLoop.length; k++) {
    const p = doorLoop[k];
    const q = doorLoop[(k + 1) % doorLoop.length];
    if (Math.abs(p[1] - q[1]) < 1e-6 && p[1] <= -0.19) {
      continue;
    }
    const ds = q[0] - p[0];
    const dy = q[1] - p[1];
    const l = Math.hypot(ds, dy) || 1;
    rb.flatQuad([face.p(p[0], p[1], 0), face.p(q[0], q[1], 0), face.p(q[0], q[1], -depth), face.p(p[0], p[1], -depth)], face.dir(-dy / l, ds / l, 0));
  }
  // Tile coping along the gable: short sloped strips following the curve.
  const tile = batch.of('hero_roof_tile');
  for (let k = 0; k < 16; k++) {
    const c0 = -HALF - 0.12 + ((2 * HALF + 0.24) * k) / 16;
    const c1 = -HALF - 0.12 + ((2 * HALF + 0.24) * (k + 1)) / 16;
    const y0 = topAt(Math.max(-HALF, Math.min(HALF, c0)));
    const y1 = topAt(Math.max(-HALF, Math.min(HALF, c1)));
    // Two slopes from the ridge line (mid-thickness) out past the front and the back face.
    for (const dir of [1, -1]) {
      const dd = dir > 0 ? 0.22 : -(depth + 0.22);
      tile.flatQuad([face.p(s(c0), y0 + 0.14, -depth / 2), face.p(s(c1), y1 + 0.14, -depth / 2), face.p(s(c1), y1 - 0.02, dd), face.p(s(c0), y0 - 0.02, dd)], face.dir(0, 1, dir * 0.8));
    }
  }
  // Dark board over the arch.
  faceBox(batch.of('hero_frame'), face, s(-1.35), s(1.35), 3.85, 4.18, -0.01, 0.06);
  // Door: painted steel leaves with plank grooves, brass bands, ring handles.
  const leafD = -0.3;
  const x0 = door.s - W / 2;
  const x1 = door.s + W / 2;
  const steel = batch.of('st_gate_steel');
  steel.flatQuad([face.p(x0, -0.2, leafD), face.p(x1, -0.2, leafD), face.p(x1, door.ys, leafD), face.p(x0, door.ys, leafD)], face.n);
  const grooves = batch.of('st_gate_steel_dark');
  for (let k = 1; k < 12; k++) {
    const sx = x0 + (W * k) / 12;
    faceBox(grooves, face, sx - 0.008, sx + 0.008, 0.15, door.ys - 0.35, leafD, leafD + 0.012, false, false);
  }
  faceBox(steel, face, x0, x1, door.ys - 0.3, door.ys, leafD, leafD + 0.03);
  faceBox(steel, face, x0, x1, -0.2, 0.12, leafD, leafD + 0.03);
  faceBox(grooves, face, door.s - 0.012, door.s + 0.012, -0.2, door.ys, leafD, leafD + 0.04, false, false);
  for (const yb of [1.05, 1.25]) {
    faceBox(batch.of('st_gilt'), face, x0 + 0.05, x1 - 0.05, yb, yb + 0.09, leafD, leafD + 0.025);
  }
  for (const side of [-1, 1]) {
    const cx = door.s + side * 0.16;
    const ring: V2[] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ring.push([cx + Math.cos(a) * 0.07, 1.14 + Math.sin(a) * 0.07]);
    }
    const inner = ring.map(([a, b]) => [cx + (a - cx) * 0.7, 1.14 + (b - 1.14) * 0.7] as V2);
    shape(mesh, 'st_gilt', face, ring, [inner], leafD + 0.04);
  }
  // Fanlight: warm glass behind an iron grille (radial bars, two arcs, scrolls) and a gilt cross.
  const fan: V2[] = archCurve({ ...door, w: W }, 16);
  shape(mesh, 'st_fanlight', face, fan, [], leafD);
  const iron = batch.of('st_iron');
  const cxs = door.s;
  const cy = door.ys;
  const R = W / 2;
  const bar = (a: V2, b: V2, w = 0.022): void => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const px = (-(b[1] - a[1]) / l) * (w / 2);
    const py = ((b[0] - a[0]) / l) * (w / 2);
    iron.flatQuad([face.p(a[0] - px, a[1] - py, leafD + 0.03), face.p(b[0] - px, b[1] - py, leafD + 0.03), face.p(b[0] + px, b[1] + py, leafD + 0.03), face.p(a[0] + px, a[1] + py, leafD + 0.03)], face.n);
  };
  bar([x0, cy], [x1, cy], 0.05);
  for (let k = 1; k < 8; k++) {
    const a = (k / 8) * Math.PI;
    bar([cxs + Math.cos(a) * 0.18, cy + Math.sin(a) * 0.18], [cxs + Math.cos(a) * (R - 0.02), cy + Math.sin(a) * (R - 0.02)]);
  }
  for (const rr of [0.18, R * 0.62, R - 0.03]) {
    for (let k = 0; k < 16; k++) {
      const a0 = (k / 16) * Math.PI;
      const a1 = ((k + 1) / 16) * Math.PI;
      bar([cxs + Math.cos(a0) * rr, cy + Math.sin(a0) * rr], [cxs + Math.cos(a1) * rr, cy + Math.sin(a1) * rr]);
    }
  }
  // Scrolls between the arcs (small loops).
  for (let k = 0; k < 6; k++) {
    const a = ((k + 0.5) / 6) * Math.PI;
    const r0 = R * 0.8;
    const c0: V2 = [cxs + Math.cos(a) * r0, cy + Math.sin(a) * r0];
    for (let q = 0; q < 8; q++) {
      const b0 = (q / 8) * Math.PI * 2;
      const b1 = ((q + 1) / 8) * Math.PI * 2;
      bar([c0[0] + Math.cos(b0) * 0.08, c0[1] + Math.sin(b0) * 0.08], [c0[0] + Math.cos(b1) * 0.08, c0[1] + Math.sin(b1) * 0.08], 0.016);
    }
  }
  const gold = batch.of('st_gilt');
  const crossD = leafD + 0.05;
  faceBox(gold, face, cxs - 0.03, cxs + 0.03, cy + 0.08, cy + riseOf({ ...door, w: W }) * 0.85, crossD - 0.01, crossD);
  faceBox(gold, face, cxs - 0.2, cxs + 0.2, cy + 0.55, cy + 0.6, crossD - 0.01, crossD);
  // White cross on the gable.
  const cross = batch.of('st_sign_white');
  const top = topAt(0) + 0.14;
  faceBox(cross, face, s(-0.05), s(0.05), top, top + 0.9, -depth / 2 - 0.05, -depth / 2 + 0.05);
  faceBox(cross, face, s(-0.28), s(0.28), top + 0.52, top + 0.62, -depth / 2 - 0.05, -depth / 2 + 0.05);
  batch.flush();
}
