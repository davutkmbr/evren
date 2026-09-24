/**
 * Café shell (L3 interior, `shell: 'cafe/1'`): a parametric room fitted behind one street door of its building.
 *
 * Fitting: the room runs along the door's façade edge between the building corner or the midpoints to the next
 * doors on that edge (party walls 0.25 m), and inwards to the far side of the footprint (rays at both side walls
 * and the door, minus 0.3 m, capped at 11 m). Floor = the door threshold, ceiling 3.35 m above it.
 *
 * Layout (Kadıköy çarşı type, deep and narrow): a counter across the back with a marble top, an espresso machine and
 * a çaydanlık stand-in, the barista zone and steel shelves against the back wall, a chalk menu board above them;
 * bistro sets (approved outdoor_table_chair_set_01) along both side walls, pendants (modern_ceiling_lamp_01) over the
 * aisle and the counter, plants (potted_plant_04); the street door stands open inwards; an A-frame chalkboard
 * (standing_chalkboard_01) outside. Mannequins stand in for the NPCs of the slots (barista and three guests).
 */
import type { DoorRec, XYZ } from '../format';
import { LOD0, type TileMesh } from '../mesh';
import type { TileContext } from '../registry';
import { Batch, box, Face, faceBox, Frame, hpoly, lathe, type Opening, span, wall, type V2, dressOpening } from '../hero/kit';

export const CAFE_CEILING = 3.35;
/** Clear width of the café's street door; the shopfront lane is asked to frame its door opening at this width. */
export const CAFE_DOOR_W = 1.0;

export interface CafeCell {
  id: string;
  name: string;
  poi: string;
  building: string;
  door: string;
}

interface Placed {
  ref: string;
  asset: string;
  variant?: string;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const xyz = (p: XYZ): XYZ => [r2(p[0]), r2(p[1]), r2(p[2])];

/** Distance from (x, z) along direction (dx, dz) to the ring (nearest hit beyond 0.3 m), or Infinity. */
function rayToRing(ring: readonly number[], x: number, z: number, dx: number, dz: number): number {
  const n = ring.length / 2;
  let best = Infinity;
  for (let k = 0; k < n; k++) {
    const ax = ring[k * 2];
    const az = ring[k * 2 + 1];
    const bx = ring[((k + 1) % n) * 2];
    const bz = ring[((k + 1) % n) * 2 + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) {
      continue;
    }
    const t = ((ax - x) * ez - (az - z) * ex) / den;
    const s = ((ax - x) * dz - (az - z) * dx) / den;
    if (t > 0.3 && s >= 0 && s <= 1) {
      best = Math.min(best, t);
    }
  }
  return best;
}

export function buildCafe(t: TileContext, cell: CafeCell, ring: readonly number[], door: DoorRec, siblings: readonly DoorRec[]): Record<string, unknown> | null {
  // Façade edge of the door.
  const n = ring.length / 2;
  let edge = -1;
  let bestD = 0.25;
  for (let k = 0; k < n; k++) {
    const ax = ring[k * 2];
    const az = ring[k * 2 + 1];
    const bx = ring[((k + 1) % n) * 2];
    const bz = ring[((k + 1) % n) * 2 + 1];
    const l = Math.hypot(bx - ax, bz - az);
    const nx = (bz - az) / l;
    const nz = -(bx - ax) / l;
    if (nx * door.normal[0] + nz * door.normal[2] < 0.98) {
      continue;
    }
    const d = Math.abs((door.position[0] - ax) * nx + (door.position[2] - az) * nz);
    if (d < bestD) {
      bestD = d;
      edge = k;
    }
  }
  if (edge < 0) {
    return null;
  }
  const ax = ring[edge * 2];
  const az = ring[edge * 2 + 1];
  const bx = ring[((edge + 1) % n) * 2];
  const bz = ring[((edge + 1) % n) * 2 + 1];
  const len = Math.hypot(bx - ax, bz - az);
  const heading = (Math.atan2(bx - ax, -(bz - az)) * 180) / Math.PI;
  const floorY = door.position[1];
  const f = new Frame(ax, az, floorY, heading);
  const [ud] = f.local(door.position[0], door.position[2]);
  // Party walls halfway to the neighbouring doors on this edge.
  let uL = 0.3;
  let uR = len - 0.3;
  for (const s of siblings) {
    if (s.id === door.id || Math.abs(s.normal[0] * door.normal[0] + s.normal[2] * door.normal[2]) < 0.98) {
      continue;
    }
    const [us, vs] = f.local(s.position[0], s.position[2]);
    if (Math.abs(vs) > 0.3) {
      continue;
    }
    const mid = (us + ud) / 2;
    if (us < ud) {
      uL = Math.max(uL, mid + 0.12);
    } else {
      uR = Math.min(uR, mid - 0.12);
    }
  }
  uL = Math.max(uL, ud - 4.5);
  uR = Math.min(uR, ud + 4.5);
  const inward = f.d(0, 0, 1);
  const depthAt = (u: number): number => {
    const p = f.p(u, 0, 0.05);
    return rayToRing(ring, p[0], p[2], inward[0], inward[2]);
  };
  const D = Math.min(11, Math.min(depthAt(uL + 0.1), depthAt(ud), depthAt(uR - 0.1)) - 0.3);
  const w = uR - uL;
  if (D < 5 || w < 3) {
    return null;
  }
  const v0 = 0.33;
  const C = CAFE_CEILING;
  const mesh = t.mesh;
  const placed: Placed[] = [];
  const lightIds: string[] = [];
  const place = (asset: string, u: number, y: number, v: number, du: number, dv: number, opts: { variant?: string; scale?: number; lumens?: number; tag: string }): void => {
    const ref = `${t.id}/${cell.id}/${opts.tag}`;
    t.place(asset, f.p(u, y, v), f.yaw(du, dv), { ...(opts.variant ? { variant: opts.variant } : {}), ...(opts.scale ? { scale: opts.scale } : {}), ref, ...(opts.lumens ? { lights: { lumens: opts.lumens } } : {}) });
    placed.push({ ref, asset, ...(opts.variant ? { variant: opts.variant } : {}) });
  };

  const vc0 = D - 2.6;
  const vc1 = D - 1.95;
  const counterR = uR - 1.25;
  const tables: { id: string; u: number; v: number }[] = [];
  const seats: Record<string, unknown>[] = [];
  const seatAt: { u: number; v: number; dv: number }[] = [];

  mesh.withLod(LOD0, () => {
    const batch = new Batch(mesh);
    shell(mesh, batch, f, uL, uR, v0, D, C);
    counter(batch, f, uL, counterR, vc0, vc1);
    menuBoard(batch, f, uL + 1.3, D, 2.25, 3.1);
    openDoor(batch, f, ud, v0);
    batch.flush();
  });

  // Back bar: steel shelves against the back wall, facing the room.
  place('steel_frame_shelves_01', uL + 0.72, 0, D - 0.28, 0, -1, { tag: 'shelf0' });
  place('steel_frame_shelves_01', uL + 1.9, 0, D - 0.28, 0, -1, { tag: 'shelf1' });
  place('potted_plant_04', counterR - 0.35, 1.04, (vc0 + vc1) / 2, 0, -1, { tag: 'plant-counter' });
  // Bistro sets along the side walls (chairs along the depth), the first right-hand set left out beside the door.
  const pitch = 1.95;
  let k = 0;
  for (const side of [0, 1] as const) {
    const u = side === 0 ? uL + 0.55 : uR - 0.5;
    for (let v = 1.55; v <= vc0 - 1.6; v += pitch) {
      if (side === 1 && v < 2 && Math.abs(u - ud) < 1.6) {
        continue;
      }
      const id = `t${k++}`;
      tables.push({ id, u, v });
      place('outdoor_table_chair_set_01', u, 0, v, 0, 1, { tag: id });
      // Seat hips: chair_01 sits +Z of the table facing -Z, chair_02 -Z facing +Z (prop +X = local +u).
      seats.push({ id: `${id}s0`, table: id, position: xyz(f.p(u - 0.11, 0.47, v + 0.62)), heading: r2(f.heading(0, -1)), yaw: r2(f.yaw(0, -1)) });
      seats.push({ id: `${id}s1`, table: id, position: xyz(f.p(u + 0.07, 0.47, v - 0.57)), heading: r2(f.heading(0, 1)), yaw: r2(f.yaw(0, 1)) });
      seatAt.push({ u: u - 0.11, v: v + 0.62, dv: -1 }, { u: u + 0.07, v: v - 0.57, dv: 1 });
    }
  }
  place('potted_plant_04', uR - 0.45, 0, v0 + 0.55, 0, -1, { scale: 3.2, tag: 'plant0' });
  place('potted_plant_04', uL + 0.4, 0, vc0 - 0.55, 1, 0, { scale: 3.0, tag: 'plant1' });
  // Pendants: over the aisle and the counter (top at the ceiling; the prop hangs 1.17 m).
  const aisle = (uL + uR) / 2 + 0.2;
  const pend: V2[] = [
    [aisle, 2.5],
    [aisle, 4.6],
    [aisle, Math.min(6.7, vc0 - 0.8)],
    [uL + 1.0, vc0 + 0.3],
    [uL + 2.4, vc0 + 0.3],
  ];
  pend.forEach(([u, v], i) => place('modern_ceiling_lamp_01', u, C - 1.173, v, 0, 1, { lumens: 1200, tag: `pendant${i}` }));
  // A-frame menu outside, beside the door.
  const sideSign = ud + 1.35 < len - 0.4 ? ud + 1.35 : ud - 1.35;
  const ap = f.p(sideSign, 0, -0.9);
  const outY = t.area.heights.at(ap[0], ap[2]);
  t.place('standing_chalkboard_01', [ap[0], outY, ap[2]], f.yaw(0, -1), { ref: `${t.id}/${cell.id}/aframe` });
  placed.push({ ref: `${t.id}/${cell.id}/aframe`, asset: 'standing_chalkboard_01' });
  // NPC slots with mannequin stand-ins: barista behind the counter, three guests.
  const barista: V2 = [uL + 1.6, vc1 + 0.55];
  place('mannequin', barista[0], 0, barista[1], 0, -1, { variant: 'standing', tag: 'npc-barista' });
  const guestIdx = [0, 3, seats.length - 2].filter((q, i, a) => q >= 0 && q < seats.length && a.indexOf(q) === i);
  const guestSeats = guestIdx.map((q) => seats[q]);
  guestIdx.forEach((q, i) => {
    const s = seatAt[q];
    place('mannequin', s.u, 0, s.v, 0, s.dv, { variant: 'sitting', tag: `npc-guest${i}` });
  });
  // Interior lights (always on): a warm lamp over the counter and one at the back bar.
  const cl = t.lights.add({ type: 'point', position: f.p((uL + counterR) / 2, 2.5, vc1 + 0.2), kelvin: 2700, lumens: 900, night: false, source: 'interior', ref: `${t.id}/${cell.id}/counter` });
  const bl = t.lights.add({ type: 'point', position: f.p(uL + 1.3, 2.05, D - 0.7), kelvin: 3000, lumens: 500, night: false, source: 'interior', ref: `${t.id}/${cell.id}/backbar` });
  lightIds.push(cl.id, bl.id);

  const polygon = [f.p(uL, 0, v0), f.p(uR, 0, v0), f.p(uR, 0, D), f.p(uL, 0, D)].map((p) => [r2(p[0]), r2(p[2])]);
  const outside = f.p(ud, 0, -1.2);
  const eyeOut = f.p(ud + 0.5, 0, -3.4);
  const eyeOutY = t.area.heights.at(eyeOut[0], eyeOut[2]) + 1.6;
  return {
    id: `${t.id}/${cell.id}`,
    kind: 'cafe',
    shell: 'cafe/1',
    name: cell.name,
    nameNote: 'fictional business name (player-facing, Turkish)',
    poi: cell.poi,
    building: cell.building,
    door: door.id,
    floorY: r2(floorY),
    ceilingY: r2(floorY + C),
    room: { polygon, width: r2(w), depth: r2(D - v0), area: r2(w * (D - v0)) },
    doorLink: {
      door: door.id,
      threshold: xyz(f.p(ud, 0, 0)),
      outside: xyz([outside[0], t.area.heights.at(outside[0], outside[2]), outside[2]]),
      inside: xyz(f.p(ud, 0, 1.4)),
      open: true,
      width: CAFE_DOOR_W,
      swing: 'inward',
      leafAngleDeg: 95,
    },
    counter: { polygon: [f.p(uL, 0, vc0), f.p(counterR, 0, vc0), f.p(counterR, 0, vc1), f.p(uL, 0, vc1)].map((p) => [r2(p[0]), r2(p[2])]), height: 1.04 },
    tables: tables.map((q) => ({ id: q.id, position: xyz(f.p(q.u, 0, q.v)) })),
    seats,
    npcSlots: [
      { id: 'barista', role: 'barista', pose: 'standing', position: xyz(f.p(barista[0], 0, barista[1])), heading: r2(f.heading(0, -1)), area: [f.p(uL + 0.2, 0, vc1 + 0.2), f.p(counterR, 0, vc1 + 0.2), f.p(counterR, 0, D - 0.6), f.p(uL + 0.2, 0, D - 0.6)].map((p) => [r2(p[0]), r2(p[2])]) },
      ...guestSeats.map((s, i) => ({ id: `guest${i}`, role: 'guest', pose: 'sitting', seat: s.id, position: s.position, heading: s.heading })),
    ],
    lights: lightIds,
    /** Every light whose ref starts with this prefix belongs to the cell (the pendants' lights come from their prop template). */
    lightRefPrefix: `${t.id}/${cell.id}/`,
    instances: placed,
    views: {
      street: { position: xyz([eyeOut[0], eyeOutY, eyeOut[2]]), target: xyz(f.p(ud - 0.2, 1.25, D - 2.2)), fovDeg: 46, aspect: 1.5 },
      inside: { position: xyz(f.p(uR - 0.6, 1.6, v0 + 0.7)), target: xyz(f.p(uL + 1.5, 1.2, D - 1.6)), fovDeg: 62, aspect: 1.5 },
      counter: { position: xyz(f.p(uR - 0.7, 1.6, Math.min(4.4, vc0 - 2.5))), target: xyz(f.p(uL + 1.2, 1.3, D - 0.6)), fovDeg: 58, aspect: 1.5 },
    },
  };
}

/* ------------------------------------------------------------------------------------------------------------- */

function shell(mesh: TileMesh, batch: Batch, f: Frame, uL: number, uR: number, v0: number, D: number, C: number): void {
  const rect: V2[] = [
    [uL, v0],
    [uR, v0],
    [uR, D],
    [uL, D],
  ];
  hpoly(mesh, 'int_floor', f, rect, 0.004);
  hpoly(mesh, 'int_ceiling', f, rect, C, true);
  // Walls seen from the room: left (normal +u), right (-u), back (-v), front header above the shopfront (+v).
  const left = span(f, [uL, D], [uL, v0]);
  const right = span(f, [uR, v0], [uR, D]);
  const back = span(f, [uR, D], [uL, D]);
  const front = span(f, [uL, v0], [uR, v0]);
  const backDoor: Opening = { s: 0.55, w: 0.9, y0: 0, ys: 2.1, kind: 'flat', door: true };
  wall(mesh, 'int_brick', left.face, 0, left.len, 0, C);
  wall(mesh, 'int_wall', right.face, 0, right.len, 0, C);
  wall(mesh, 'int_wall', back.face, 0, back.len, 0, C, [backDoor]);
  dressOpening(mesh, batch, back.face, backDoor, { wall: 'int_wall', frame: 'int_wood_dark', pane: 'int_wood_dark', reveal: 0.12, frameW: 0.06 });
  wall(mesh, 'int_wall', front.face, 0, front.len, 3.05, C);
  const wood = batch.of('int_wood_dark');
  for (const e of [left, right, back]) {
    faceBox(wood, e.face, 0, e.len, 0, 0.1, -0.01, 0.015, false, false);
    faceBox(wood, e.face, 0, e.len, C - 0.08, C, -0.01, 0.03, false, false);
  }
  // Wainscot rail on the plaster walls.
  for (const e of [right, back]) {
    faceBox(wood, e.face, 0, e.len, 1.05, 1.1, -0.01, 0.02, false, true);
  }
}

function counter(batch: Batch, f: Frame, u0: number, u1: number, v0: number, v1: number): void {
  const body = batch.of('int_counter');
  box(body, f, u0, u1, 0.1, 1.0, v0, v1);
  box(batch.of('int_wood_dark'), f, u0 + 0.05, u1 - 0.05, 0, 0.1, v0 + 0.06, v1);
  box(batch.of('Marble019'), f, u0 - 0.02, u1 + 0.03, 1.0, 1.04, v0 - 0.05, v1 + 0.02, { bottom: true, top: true });
  // Battens on the front (facing the room, -v).
  const front = span(f, [u1, v0], [u0, v0]);
  for (let s = 0.2; s < front.len - 0.1; s += 0.36) {
    faceBox(body, front.face, s, s + 0.06, 0.16, 0.94, -0.01, 0.025, false, true);
  }
  // Espresso machine (stand-in): steel body, red panel, group heads; çaydanlık on a burner.
  const em = u0 + 0.95;
  const st = batch.of('int_steel');
  box(st, f, em - 0.36, em + 0.36, 1.04, 1.44, v0 + 0.18, v0 + 0.6);
  box(batch.of('int_red'), f, em - 0.3, em + 0.3, 1.2, 1.38, v0 + 0.16, v0 + 0.18);
  for (const du of [-0.18, 0.18]) {
    lathe(st, f, em + du, v0 + 0.12, [
      [0.04, 1.18],
      [0.045, 1.22],
      [0.03, 1.26],
    ], 8);
  }
  const ct = u1 - 0.55;
  box(batch.of('int_wood_dark'), f, ct - 0.18, ct + 0.18, 1.04, 1.12, v0 + 0.15, v0 + 0.5);
  lathe(batch.of('int_brass'), f, ct, v0 + 0.32, [
    [0.12, 1.12],
    [0.14, 1.2],
    [0.12, 1.3],
    [0.08, 1.33],
    [0.09, 1.34],
    [0.07, 1.44],
    [0.04, 1.47],
    [0, 1.48],
  ], 12);
  // Glasses rack (tulip tea glasses read as a row of small cylinders).
  for (let i = 0; i < 6; i++) {
    lathe(batch.of('hero_glass'), f, u0 + 1.55 + i * 0.09, v0 + 0.4, [
      [0.025, 1.04],
      [0.02, 1.08],
      [0.03, 1.13],
    ], 6);
  }
}

/** Chalk menu board on the back wall: wooden frame, board and chalk lines. */
function menuBoard(batch: Batch, f: Frame, uc: number, D: number, y0: number, y1: number): void {
  const back = span(f, [uc + 1.0, D], [uc - 1.0, D]);
  const wood = batch.of('int_wood_dark');
  faceBox(wood, back.face, 0, back.len, y0, y1, -0.01, 0.04, false, true);
  faceBox(batch.of('int_chalk'), back.face, 0.07, back.len - 0.07, y0 + 0.07, y1 - 0.07, 0.035, 0.046, false, true);
  const chalk = batch.of('int_chalk_text');
  const lines = [0.55, 0.5, 0.62, 0.45, 0.58, 0.4];
  faceBox(chalk, back.face, 0.55, 1.45, y1 - 0.2, y1 - 0.16, 0.046, 0.049, false, false);
  lines.forEach((lw, i) => {
    const y = y1 - 0.3 - i * 0.075;
    faceBox(chalk, back.face, 0.18, 0.18 + lw, y, y + 0.022, 0.046, 0.049, false, false);
    faceBox(chalk, back.face, back.len - 0.35, back.len - 0.2, y, y + 0.022, 0.046, 0.049, false, false);
  });
}

/** The street door leaf, open inwards (95°) on its right-hand hinge: aluminium frame and glass. */
function openDoor(batch: Batch, f: Frame, ud: number, v0: number): void {
  const W = CAFE_DOOR_W;
  const H = 2.2;
  const hingeU = ud + W / 2 - 0.02;
  const hingeV = v0 + 0.03;
  const a = (95 * Math.PI) / 180;
  const du = -Math.cos(a);
  const dv = Math.sin(a);
  // Leaf plane through the hinge along (du, dv): s runs from the hinge to the free edge.
  const face = new Face(f, hingeU, hingeV, -dv, du);
  const alu = batch.of('int_alu');
  const L = W - 0.04;
  faceBox(alu, face, 0, 0.07, 0.01, H, -0.025, 0.025, true);
  faceBox(alu, face, L - 0.07, L, 0.01, H, -0.025, 0.025, true);
  faceBox(alu, face, 0.07, L - 0.07, 0.01, 0.3, -0.025, 0.025, true);
  faceBox(alu, face, 0.07, L - 0.07, H - 0.08, H, -0.025, 0.025, true);
  faceBox(alu, face, 0.07, L - 0.07, 1.0, 1.05, -0.03, 0.03, true);
  faceBox(batch.of('hero_glass'), face, 0.07, L - 0.07, 0.3, H - 0.08, -0.006, 0.006, true, false);
}
